const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadFixture, createEngineRunner } = require('./integration-harness.cjs');

function makeRunner(seed = 91) {
  const fixture = loadFixture();
  const runner = createEngineRunner(fixture, seed);
  runner.api.setup(fixture, runner.random, request => (request.candidates || [])[0] || null, () => true);
  runner.api.setLocalAi(false);
  return { fixture, runner };
}

function setTurn(runner, side) {
  const game = runner.api.state();
  game.turn = side;
  game.firstPlayer = side === 'you' ? 'codex' : 'you';
  game.players.you.turnsTaken = Math.max(1, game.players.you.turnsTaken);
  game.players.codex.turnsTaken = Math.max(1, game.players.codex.turnsTaken);
  game.players[side].supporterPlayedThisTurn = false;
  return game;
}

function takePrintToHand(player, setCode, cardNumber) {
  const zones = [player.hand, player.deck, player.discard, player.prizes];
  for (const zone of zones) {
    const index = zone.findIndex(card => card.setCode === setCode && String(card.cardNumber) === String(cardNumber));
    if (index >= 0) {
      const [card] = zone.splice(index, 1);
      player.hand.push(card);
      return card;
    }
  }
  throw new Error(`Could not prepare ${setCode} ${cardNumber} from the deck fixture.`);
}

function playerFingerprint(player) {
  return JSON.stringify({
    hand: Array.from(player.hand, card => card.id),
    deck: Array.from(player.deck, card => card.id),
    discard: Array.from(player.discard, card => card.id),
    prizes: Array.from(player.prizes, card => card.id),
    active: player.active,
    bench: player.bench,
    supporterPlayedThisTurn: player.supporterPlayedThisTurn,
    stadiumUsage: player.stadiumUsage
  });
}

function gameFingerprint(game) {
  return JSON.stringify({
    turn: game.turn,
    turnNumber: game.turnNumber,
    phase: game.phase,
    stadium: game.stadium,
    stadiumPlayedThisTurn: game.stadiumPlayedThisTurn,
    players: { you: playerFingerprint(game.players.you), codex: playerFingerprint(game.players.codex) }
  });
}

test('unsupported Supporters and Items are rejected for both controllers without consuming anything', async () => {
  for (const [side, print] of [['you', ['PAL', '254']], ['you', ['PAF', '79']], ['codex', ['MEG', '125']]]) {
    const { runner } = makeRunner();
    const game = setTurn(runner, side), p = game.players[side];
    const card = takePrintToHand(p, print[0], print[1]);
    card.meta.effect += ' Unverified extra instruction.';
    const before = gameFingerprint(game);
    await runner.api.playCard(side, card.id);
    assert.equal(gameFingerprint(runner.api.state()), before, `${card.name} must leave the entire game state unchanged`);
    assert.match(runner.document.getElementById('toast').textContent || runner.document.getElementById('toastMessage').textContent || '', /not supported/i);
  }
});

test('unsupported Stadium is not placed, does not replace the current Stadium, and remains in hand', () => {
  const { runner } = makeRunner();
  const game = setTurn(runner, 'you'), p = game.players.you;
  const card = takePrintToHand(p, 'JTG', '150');
  card.meta.effect += ' Unverified extra instruction.';
  game.stadium = { card: { id: 'old-stadium', name: 'Existing Stadium' }, owner: 'codex' };
  const before = gameFingerprint(game);
  runner.api.placeStadium('you', card.id);
  assert.equal(gameFingerprint(runner.api.state()), before);
});

test('unsupported Tools Bravery Charm and Exp. Share remain in hand and are not attached', async () => {
  for (const print of [['PAL', '173'], ['SVI', '174']]) {
    const { runner } = makeRunner();
    const game = setTurn(runner, 'codex'), p = game.players.codex;
    const card = takePrintToHand(p, print[0], print[1]);
    card.meta.effect += ' Unverified extra instruction.';
    const before = gameFingerprint(game);
    await runner.api.playCard('codex', card.id);
    assert.equal(gameFingerprint(runner.api.state()), before);
    assert.ok(p.hand.some(item => item.id === card.id));
    assert.ok([p.active, ...p.bench].every(pokemon => !(pokemon.tools || []).some(tool => tool.id === card.id)));
  }
});

test('unsupported Ability attempts do not mark use, discard cards, or change the board', async () => {
  const { runner } = makeRunner();
  const game = setTurn(runner, 'you');
  const pokemon = runner.api.prepareAttack('you', 'ASC', '72');
  const before = gameFingerprint(game);
  const used = await runner.api.useAbility('you', pokemon.id, 'Flashing Draw', true);
  assert.equal(used, false);
  assert.equal(gameFingerprint(runner.api.state()), before);
});

test('Tiny Charge, Mach Bolt, and Wing Attack cannot use manual attack fallback', async () => {
  const cases = [['you', 'ASC', '69'], ['you', 'ASC', '72'], ['codex', 'OBF', '159']];
  for (const [side, setCode, cardNumber] of cases) {
    const { runner } = makeRunner();
    const game = setTurn(runner, side);
    const attacker = runner.api.prepareAttack(side, setCode, cardNumber);
    const opponent = game.players[side === 'you' ? 'codex' : 'you'];
    const damageBefore = Number(opponent.active.damage || 0);
    const energyBefore = Array.from(attacker.energy, card => card.id);
    const turnBefore = game.turn, attackRestrictionBefore = attacker.cannotAttackUntilTurn;
    assert.equal(runner.api.attackOptions(side).length, 0);
    assert.equal(runner.api.manualAttackOptions(side).length, 0);
    assert.equal(await runner.api.manualAttack(side, 0), false);
    assert.deepEqual(Array.from(attacker.energy, card => card.id), energyBefore);
    assert.equal(Number(opponent.active.damage || 0), damageBefore);
    assert.equal(game.turn, turnBefore);
    assert.equal(attacker.cannotAttackUntilTurn, attackRestrictionBefore);
    assert.equal(game.players[side].attackedThisTurn, false);
  }
});

test('supported exact Trainer and attacks remain available after the fail-closed guards', async () => {
  const fixture = loadFixture(), runner = createEngineRunner(fixture, 8);
  runner.api.setup(fixture, runner.random, request => (request.candidates || [])[0] || null, () => true);
  const game = setTurn(runner, 'codex');
  assert.ok(runner.api.effectAudit().some(card => card.name === 'Nest Ball' && card.setCode === 'PAF' && card.cardNumber === '84' && card.resolution === 'automated'));
  const nestBall = takePrintToHand(game.players.codex, 'PAF', '84');
  assert.equal(runner.context.canPlayTrainerEffect(nestBall, 'codex'), true);
  const attacker = runner.api.prepareAttack('codex', 'OBF', '157', ['Lightning']);
  const attack = runner.api.attackOptions('codex').find(option => option.attack.name === 'Tail Snap');
  assert.ok(attack, 'verified damage-only attack remains legal');
  assert.equal(await runner.api.attack('codex', attack.index), true);
  assert.equal(game.players.you.active.damage, 20);
  assert.ok(game.players.codex.attackedThisTurn);
});

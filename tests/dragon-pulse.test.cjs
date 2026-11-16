const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadFixture, createEngineRunner } = require('./integration-harness.cjs');

function dragonite(fixture) {
  return fixture.cards.find(card => card.name === 'Dragonite' && card.setCode === 'MEW' && card.cardNumber === '149');
}

function dragonPulseAudit(fixture) {
  return createEngineRunner(fixture, 4).api.inspectFixture(fixture).find(card => card.name === 'Dragonite' && card.setCode === 'MEW' && card.cardNumber === '149');
}

function readyRunner(side = 'you', seed = 47) {
  const fixture = loadFixture();
  fixture.decks.human = { ...fixture.decks.ai, id: `dragon-pulse-${side}` };
  const runner = createEngineRunner(fixture, seed);
  runner.api.setup(fixture, runner.random, request => {
    const candidates = request.candidates || [];
    if (request.kind === 'prompt') return request.defaultValue;
    if (request.kind === 'confirm') return true;
    return candidates[0] || null;
  }, () => true);
  runner.api.setLocalAi(false);
  const attacker = runner.api.prepareAttack(side, 'MEW', '149', ['Water', 'Lightning']);
  const opponent = side === 'you' ? 'codex' : 'you';
  runner.api.prepareAttack(opponent, 'ASC', '152', []);
  runner.api.state().turn = side;
  return { fixture, runner, attacker, side, opponent };
}

test('Dragon Pulse is automated only for verified English Dragonite MEW 149 with complete exact metadata', () => {
  const fixture = loadFixture(), card = dragonite(fixture);
  assert.ok(card);
  assert.equal(card.language, 'en');
  const attack = card.meta.attacks.find(item => item.name === 'Dragon Pulse');
  assert.deepEqual(attack.cost, ['Water', 'Lightning']);
  assert.equal(attack.damage, 180);
  assert.equal(attack.effect, 'Discard the top 2 cards of your deck.');
  const supported = dragonPulseAudit(fixture);
  assert.equal(supported.handler.attacks.find(item => item.name === 'Dragon Pulse').handler, 'discard_top_cards');
  assert.equal(supported.resolution, 'automated', 'Jet Cruise and Dragon Pulse are both supported');

  for (const mutate of [
    item => { item.cardNumber = '150'; },
    item => { item.language = 'ja'; },
    item => { item.meta.attacks[0].effect = 'Discard the top card of your deck.'; },
    item => { item.meta.attacks[0].effect += ' Then draw a card.'; },
    item => { item.meta.attacks[0].cost = ['Water', 'Water']; },
    item => { item.meta.attacks[0].damage = 170; },
    item => { item.meta.attacks[0].effect = ''; item.meta.attacks[0].effectTextStatus = 'missing'; }
  ]) {
    const changed = structuredClone(fixture), changedCard = dragonite(changed);
    mutate(changedCard);
    const audit = createEngineRunner(changed, 5).api.inspectFixture(changed).find(item => item.name === 'Dragonite' && item.setCode === changedCard.setCode && item.cardNumber === changedCard.cardNumber);
    assert.notEqual(audit.handler.attacks.find(item => item.name === 'Dragon Pulse').handler, 'discard_top_cards', 'altered identity or metadata must not inherit the handler');
  }
});

test('Dragon Pulse requires Water and Lightning Energy and human resolution deals 180 and discards exactly the top two own cards', async () => {
  const { runner, attacker, side } = readyRunner();
  const attack = runner.api.attackOptions(side).find(option => option.attack.name === 'Dragon Pulse');
  assert.ok(attack, 'the exact attack is legal with its two required Energy types');
  assert.equal(runner.api.canUseAttack({ ...attacker, energy: attacker.energy.slice(0, 1) }, attack.attack), false);
  assert.equal(runner.api.canUseAttack({ ...attacker, energy: attacker.energy.map(card => ({ ...card, name: 'Water Energy', meta: { ...card.meta, energyType: 'Water' } })) }, attack.attack), false);
  const player = runner.api.state().players[side], defenderSide = side === 'you' ? 'codex' : 'you';
  const defender = runner.api.state().players[defenderSide].active;
  const topTwo = player.deck.slice(-2).map(card => card.id), deckBefore = player.deck.length, damageBefore = defender.damage || 0;
  assert.equal(await runner.api.attack(side, attack.index), true);
  assert.equal(defender.damage, damageBefore + 180);
  assert.deepEqual(player.discard.slice(-2).map(card => card.id), topTwo);
  assert.equal(player.deck.length, deckBefore - 2);
  assert.ok(topTwo.every(id => player.discard.some(card => card.id === id)));
  assert.ok(runner.api.state().log.some(entry => entry.message.includes('discarded the top 2 cards of the deck for Dragon Pulse')));
});

test('Dragon Pulse discards only the cards that remain when the deck has fewer than two', async () => {
  for (const remaining of [1, 0]) {
    const { runner, side } = readyRunner(sideFor(remaining), 51 + remaining);
    const player = runner.api.state().players[side], keeper = remaining ? player.deck.slice(-remaining) : [];
    player.hand.push(...player.deck.slice(0, player.deck.length - remaining));
    player.deck = keeper;
    const discardBefore = player.discard.length;
    const option = runner.api.attackOptions(side).find(item => item.attack.name === 'Dragon Pulse');
    assert.ok(option);
    assert.equal(await runner.api.attack(side, option.index), true);
    assert.equal(player.discard.length - discardBefore, remaining);
    assert.equal(player.deck.length, 0);
    assert.ok(runner.api.state().log.some(entry => entry.message.includes(`discarded the top ${remaining} card${remaining === 1 ? '' : 's'} of the deck for Dragon Pulse`)));
  }
});

function sideFor(value) { return value === 0 ? 'codex' : 'you'; }

test('failed Dragon Pulse effect rolls back damage, discard, deck, attack and turn state', async () => {
  const { runner, side, opponent } = readyRunner();
  const option = runner.api.attackOptions(side).find(item => item.attack.name === 'Dragon Pulse');
  const game = runner.api.state(), owner = game.players[side], defender = game.players[opponent];
  const before = {
    deck: Array.from(owner.deck, card => card.id), discard: Array.from(owner.discard, card => card.id),
    damage: defender.active.damage || 0, attacked: owner.attackedThisTurn, turn: game.turn,
    attackerEnergy: Array.from(owner.active.energy, card => card.id)
  };
  const restoreResolver = runner.api.failNextAttackEffectAfterMutation();
  try { assert.equal(await runner.api.attack(side, option.index), false); }
  finally { restoreResolver(); }
  const restoredGame = runner.api.state(), restoredOwner = restoredGame.players[side], restoredDefender = restoredGame.players[opponent];
  assert.deepEqual(Array.from(restoredOwner.deck, card => card.id), before.deck);
  assert.deepEqual(Array.from(restoredOwner.discard, card => card.id), before.discard);
  assert.equal(restoredDefender.active.damage || 0, before.damage);
  assert.equal(restoredOwner.attackedThisTurn, before.attacked);
  assert.equal(restoredGame.turn, before.turn);
  assert.deepEqual(Array.from(restoredOwner.active.energy, card => card.id), before.attackerEnergy);
});

test('AI chooses Dragon Pulse through its normal action selection and authoritative attack handler', async () => {
  const { runner, attacker } = readyRunner('codex', 67);
  const game = runner.api.state(), codex = game.players.codex;
  codex.deck.push(...codex.hand); codex.hand = [];
  codex.energyAttachedThisTurn = true;
  runner.api.setLocalAi(true);
  const topTwo = codex.deck.slice(-2).map(card => card.id), damageBefore = game.players.you.active.damage || 0;
  assert.equal(attacker.name, 'Dragonite');
  await runner.api.aiStep();
  assert.equal(game.players.you.active.damage, damageBefore + 180);
  assert.deepEqual(codex.discard.slice(-2).map(card => card.id), topTwo);
  assert.ok(game.log.some(entry => /Yami used Dragon Pulse with Dragonite for 180 damage/.test(entry.message)));
});

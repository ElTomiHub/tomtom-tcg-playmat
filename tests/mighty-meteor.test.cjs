const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadFixture, createEngineRunner } = require('./integration-harness.cjs');

function dragoniteEx(fixture) {
  return fixture.cards.find(card => card.name === 'Dragonite ex' && card.setCode === 'OBF' && card.cardNumber === '159');
}

function audit(fixture) {
  return createEngineRunner(fixture, 43).api.inspectFixture(fixture).find(card => card.name === 'Dragonite ex' && card.setCode === 'OBF' && card.cardNumber === '159');
}

async function readyRunner(side = 'you', seed = 41) {
  const fixture = loadFixture();
  fixture.decks.human = { ...fixture.decks.ai, id: `mighty-meteor-${side}` };
  const runner = createEngineRunner(fixture, seed);
  runner.api.setup(fixture, runner.random, request => request.candidates?.[0] || null, () => true);
  runner.api.setLocalAi(false);
  const attacker = runner.api.prepareAttack(side, 'OBF', '159', ['Water', 'Lightning']);
  const opponent = side === 'you' ? 'codex' : 'you';
  runner.api.prepareAttack(opponent, 'ASC', '152', []);
  runner.api.state().turn = side;
  return { fixture, runner, attacker, side, opponent };
}

function setCoin(runner, heads, onFlip = () => {}) {
  runner.api.setChoices(runner.random, () => null, () => { onFlip(); return heads; });
}

test('Mighty Meteor is automated only for the exact English Dragonite ex OBF 159 attack record', () => {
  const fixture = loadFixture(), card = dragoniteEx(fixture);
  assert.ok(card);
  assert.equal(card.language, 'en');
  const attack = card.meta.attacks.find(item => item.name === 'Mighty Meteor');
  assert.deepEqual(attack.cost, ['Water', 'Lightning']);
  assert.equal(attack.damage, '140+');
  assert.equal(attack.effect, "Flip a coin. If heads, this attack does 140 more damage. If tails, during your next turn, this Pokémon can't attack.");
  assert.equal(audit(fixture).handler.attacks.find(item => item.name === 'Mighty Meteor').handler, 'coin_bonus_and_attack_lock');

  for (const mutate of [
    item => { item.cardNumber = '159a'; },
    item => { item.language = 'ja'; },
    item => { item.meta.attacks.find(entry => entry.name === 'Mighty Meteor').effect += ' Draw a card.'; },
    item => { item.meta.attacks.find(entry => entry.name === 'Mighty Meteor').effect = ''; },
    item => { item.meta.attacks.find(entry => entry.name === 'Mighty Meteor').cost = ['Water', 'Water']; },
    item => { item.meta.attacks.find(entry => entry.name === 'Mighty Meteor').damage = '140'; }
  ]) {
    const changed = structuredClone(fixture), changedCard = dragoniteEx(changed);
    mutate(changedCard);
    const result = createEngineRunner(changed, 47).api.inspectFixture(changed).find(item => item.name === 'Dragonite ex' && item.setCode === changedCard.setCode && item.cardNumber === changedCard.cardNumber);
    assert.notEqual(result.handler.attacks.find(entry => entry.name === 'Mighty Meteor').handler, 'coin_bonus_and_attack_lock');
  }
});

test('Mighty Meteor requires Water and Lightning; heads deals 280 total damage', async () => {
  const { runner, attacker, side, opponent } = await readyRunner();
  const option = runner.api.attackOptions(side).find(item => item.attack.name === 'Mighty Meteor');
  assert.ok(option);
  assert.equal(runner.api.canUseAttack({ ...attacker, energy: attacker.energy.slice(0, 1) }, option.attack), false);
  const target = runner.api.state().players[opponent].active, before = target.damage || 0;
  let flips = 0; setCoin(runner, true, () => flips++);
  assert.equal(await runner.api.attack(side, option.index), true);
  assert.equal(flips, 1);
  assert.equal(target.damage, before + 280);
  assert.equal(attacker.cannotAttackUntilTurn || 0, 0);
  assert.ok(runner.api.state().log.some(entry => /Mighty Meteor: heads/.test(entry.message)));
  assert.ok(runner.api.state().log.some(entry => /used Mighty Meteor with Dragonite ex for 280 damage/.test(entry.message)));
});

test('tails deals 140, blocks all attacks by this Pokémon for its next turn, then expires', async () => {
  const { runner, attacker, side, opponent } = await readyRunner('you', 53);
  const option = runner.api.attackOptions(side).find(item => item.attack.name === 'Mighty Meteor');
  const attackTurn = runner.api.state().turnNumber, target = runner.api.state().players[opponent].active, before = target.damage || 0;
  setCoin(runner, false);
  assert.equal(await runner.api.attack(side, option.index), true);
  assert.equal(target.damage, before + 140);
  assert.equal(attacker.cannotAttackUntilTurn, attackTurn + 2);
  assert.ok(runner.api.state().log.some(entry => /Mighty Meteor: tails/.test(entry.message)));
  assert.ok(runner.api.state().log.some(entry => /Dragonite ex cannot attack during its controller’s next turn/.test(entry.message)));

  await runner.api.endTurnFor(opponent);
  assert.equal(runner.api.state().turn, side);
  assert.equal(runner.api.state().turnNumber, attackTurn + 2);
  assert.equal(runner.api.canUseAttack(attacker, option.attack), false);
  assert.equal(runner.api.attackOptions(side).some(item => item.attack.name === 'Mighty Meteor'), false, 'availability rules block the Pokémon, not only the UI');
  assert.equal(await runner.api.attack(side, option.index), false, 'the locked Pokémon cannot submit an attack through the engine');

  await runner.api.endTurnFor(side);
  await runner.api.endTurnFor(opponent);
  assert.equal(runner.api.state().turn, side);
  assert.equal(runner.api.state().turnNumber, attackTurn + 4);
  assert.equal(runner.api.canUseAttack(attacker, option.attack), true, 'the restriction expires after the next turn has passed');
  assert.ok(runner.api.attackOptions(side).some(item => item.attack.name === 'Mighty Meteor'));
});

test('invalid attack selection does not flip a coin, damage, lock, or end the turn', async () => {
  const { runner, attacker, side, opponent } = await readyRunner('you', 59);
  let flips = 0; setCoin(runner, false, () => flips++);
  const target = runner.api.state().players[opponent].active, before = target.damage || 0, turn = runner.api.state().turn;
  assert.equal(await runner.api.attack(side, 999), false);
  assert.equal(flips, 0);
  assert.equal(target.damage || 0, before);
  assert.equal(attacker.cannotAttackUntilTurn || 0, 0);
  assert.equal(runner.api.state().turn, turn);
});

test('AI resolves Mighty Meteor through the same authoritative attack pipeline', async () => {
  const { runner, attacker } = await readyRunner('codex', 61);
  const game = runner.api.state(), codex = game.players.codex;
  codex.deck.push(...codex.hand); codex.hand = []; codex.energyAttachedThisTurn = true;
  runner.api.setLocalAi(true);
  setCoin(runner, false);
  await runner.api.aiStep();
  assert.equal(game.players.you.active.damage, 140);
  assert.equal(attacker.cannotAttackUntilTurn, game.turnNumber + 1);
  assert.ok(game.log.some(entry => /Yami used Mighty Meteor with Dragonite ex for 140 damage/.test(entry.message)));
});

test('failed attack transaction rolls back damage and the tails restriction but consumes the random flip', async () => {
  const { runner, attacker, side, opponent } = await readyRunner('you', 71);
  const game = runner.api.state(), owner = game.players[side], target = game.players[opponent].active;
  let flips = 0; setCoin(runner, false, () => flips++);
  const before = { damage: target.damage || 0, turn: game.turn, lock: attacker.cannotAttackUntilTurn || 0 };
  const option = runner.api.attackOptions(side).find(item => item.attack.name === 'Mighty Meteor');
  const restoreResolver = runner.api.failNextAttackEffectAfterResolve();
  try { assert.equal(await runner.api.attack(side, option.index), false); }
  finally { restoreResolver(); }
  const restored = runner.api.state(), restoredAttacker = restored.players[side].active;
  assert.equal(flips, 1, 'the deterministic random source advanced for the coin flip');
  assert.equal(restored.players[opponent].active.damage || 0, before.damage);
  assert.equal(restoredAttacker.cannotAttackUntilTurn || 0, before.lock);
  assert.equal(restored.turn, before.turn);
  assert.equal(restored.players[side].attackedThisTurn, false);
});

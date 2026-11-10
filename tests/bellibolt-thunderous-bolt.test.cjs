const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadFixture, createEngineRunner } = require('./integration-harness.cjs');

const belliboltPrint = card => card.name === "Iono's Bellibolt ex" && card.setCode === 'ASC' && String(card.cardNumber) === '279';
const belliboltRecord = fixture => fixture.cards.find(belliboltPrint);
const auditedBellibolt = fixture => createEngineRunner(fixture, 401).api.inspectFixture(fixture).find(belliboltPrint);

function sameDeckFixture() {
  const fixture = loadFixture();
  fixture.decks.ai = { ...fixture.decks.human, id: 'bellibolt-test-ai' };
  return fixture;
}

function takeOwned(player, predicate) {
  for (const name of ['hand', 'deck', 'discard', 'prizes']) {
    const zone = player[name], index = zone.findIndex(predicate);
    if (index >= 0) return zone.splice(index, 1)[0];
  }
  return null;
}

function getOrBenchTadbulb(player) {
  const existing = player.bench.find(card => card.name === "Iono's Tadbulb" && card.setCode === 'ASC' && card.cardNumber === '69');
  if (existing) return existing;
  const card = takeOwned(player, item => item.name === "Iono's Tadbulb" && item.setCode === 'ASC' && item.cardNumber === '69');
  assert.ok(card, 'prepared state must find an Iono’s Tadbulb');
  player.bench.push(card);
  return card;
}

async function readyRunner(side = 'you', seed = 401) {
  const fixture = sameDeckFixture(), runner = createEngineRunner(fixture, seed);
  runner.api.setup(fixture, runner.random, request => request.candidates?.[0] || null, () => false);
  runner.api.setLocalAi(false);
  const otherSide = side === 'you' ? 'codex' : 'you';
  const attacker = runner.api.prepareAttack(side, 'ASC', '279', ['Lightning', 'Lightning', 'Lightning', 'Lightning']);
  const target = runner.api.prepareAttack(otherSide, 'ASC', '279', []);
  target.meta.weaknesses = [];
  target.meta.resistances = [];
  runner.api.state().players[side].turnsTaken = 1;
  runner.api.state().players[otherSide].turnsTaken = 1;
  runner.api.state().turn = side;
  runner.api.state().players[side].energyAttachedThisTurn = true;
  const attack = attacker.meta.attacks.find(item => item.name === 'Thunderous Bolt');
  assert.ok(attack);
  return { fixture, runner, attacker, target, attack, side, otherSide };
}

test('Thunderous Bolt automation is limited to exact English ASC 279 attack metadata', () => {
  const fixture = loadFixture(), card = belliboltRecord(fixture);
  assert.ok(card);
  assert.equal(card.language, 'en');
  const attack = card.meta.attacks.find(item => item.name === 'Thunderous Bolt');
  assert.deepEqual(attack.cost, ['Lightning', 'Lightning', 'Lightning', 'Colorless']);
  assert.equal(attack.damage, 230);
  assert.equal(attack.effect, "During your next turn, this Pokémon can't attack.");

  const live = auditedBellibolt(fixture);
  assert.equal(live.handler.attacks.find(item => item.name === 'Thunderous Bolt').handler, 'attack_lock_next_turn');
  assert.equal(live.handler.abilities.find(item => item.name === 'Electric Streamer').handler, 'attach_basic_lightning_to_iono');
  assert.equal(live.resolution, 'automated', 'Electric Streamer and Thunderous Bolt are both verified');
  assert.equal(live.implementationStatus, 'implemented');

  for (const mutate of [
    item => { item.setCode = 'JTG'; },
    item => { item.cardNumber = '280'; },
    item => { item.language = 'ja'; },
    item => { item.meta.attacks[0].cost = ['Lightning', 'Lightning', 'Lightning', 'Water']; },
    item => { item.meta.attacks[0].damage = 240; },
    item => { item.meta.attacks[0].effect += ' Draw a card.'; },
    item => { item.meta.attacks[0].effect = ''; }
  ]) {
    const changed = structuredClone(fixture), changedCard = belliboltRecord(changed);
    mutate(changedCard);
    const checked = auditedBellibolt(changed);
    assert.notEqual(checked?.handler.attacks.find(entry => entry.name === 'Thunderous Bolt')?.handler, 'attack_lock_next_turn');
  }
});

test('human Thunderous Bolt deals 230, allows the opponent to attack, blocks Bellibolt next turn, then expires', async () => {
  const { runner, attacker, target, attack, side, otherSide } = await readyRunner('you', 409);
  const attackTurn = runner.api.state().turnNumber;
  assert.equal(attacker.energy.length, 4, 'the fourth Lightning Energy satisfies the Colorless requirement');
  assert.equal(await runner.api.canUseAttack(attacker, attack), true);
  assert.equal(await runner.api.attack(side, 0), true);
  assert.equal(target.damage, 230);
  assert.equal(attacker.cannotAttackUntilTurn, attackTurn + 2);
  assert.equal(runner.api.state().turn, otherSide);

  const opponent = runner.api.prepareAttack(otherSide, 'ASC', '71', ['Lightning']);
  const opposingAttack = runner.api.attackOptions(otherSide).find(item => item.attack.name === 'Quick Attack');
  assert.ok(opposingAttack, 'the opponent is not affected by Bellibolt’s lock');
  const damageBefore = attacker.damage || 0;
  assert.equal(await runner.api.attack(otherSide, opposingAttack.index), true);
  assert.equal(attacker.damage, damageBefore + 10, 'the scripted tails result still resolves the opponent attack normally');
  assert.equal(runner.api.state().turn, side);
  assert.equal(runner.api.state().turnNumber, attackTurn + 2);
  assert.equal(runner.api.canUseAttack(attacker, attack), false);
  assert.equal(runner.api.attackOptions(side).some(item => item.attack.name === 'Thunderous Bolt'), false);
  assert.equal(await runner.api.attack(side, 0), false, 'engine validation also rejects a direct attempt while locked');

  await runner.api.endTurnFor(side);
  await runner.api.endTurnFor(otherSide);
  assert.equal(runner.api.state().turn, side);
  assert.equal(runner.api.state().turnNumber, attackTurn + 4);
  assert.equal(runner.api.canUseAttack(attacker, attack), true);
  assert.ok(runner.api.attackOptions(side).some(item => item.attack.name === 'Thunderous Bolt'));
  assert.equal(opponent.meta.stage, 'Basic');
});

test('AI uses the same Thunderous Bolt resolver and receives the next-turn restriction', async () => {
  const { runner, attacker, target, attack } = await readyRunner('codex', 419);
  const game = runner.api.state(), codex = game.players.codex, startTurn = game.turnNumber;
  codex.deck.push(...codex.hand);
  codex.hand = [];
  runner.api.setLocalAi(true);
  await runner.api.aiStep();
  assert.equal(target.damage, 230);
  assert.equal(attacker.cannotAttackUntilTurn, startTurn + 2);
  assert.ok(game.log.some(entry => /Yami used Thunderous Bolt with Iono's Bellibolt ex for 230 damage/.test(entry.message)));
  runner.api.setLocalAi(false);
  await runner.api.endTurnFor('you');
  assert.equal(runner.api.state().turn, 'codex');
  assert.equal(runner.api.canUseAttack(attacker, attack), false);
});

test('Switching the restricted Bellibolt to the Bench and back preserves its lock', async () => {
  const { runner, attacker, attack, side, otherSide } = await readyRunner('you', 421);
  const owner = runner.api.state().players.you, tadbulb = getOrBenchTadbulb(owner);
  const switches = [];
  for (let index = 0; index < 2; index++) {
    const card = takeOwned(owner, item => item.name === 'Switch' && item.setCode === 'MEG' && item.cardNumber === '130');
    assert.ok(card, 'prepared state needs two verified Switch cards');
    switches.push(card);
  }
  owner.hand.push(...switches);
  const attackTurn = runner.api.state().turnNumber;
  assert.equal(await runner.api.attack(side, 0), true);
  await runner.api.endTurnFor(otherSide);
  assert.equal(runner.api.state().turn, side);
  let intendedTarget = tadbulb.id;
  runner.api.setChoices(runner.random, request => request.kind === 'pokemon-target'
    ? request.candidates.find(card => card.id === intendedTarget) || null
    : request.candidates?.[0] || null, () => true);
  await runner.api.playCard(side, switches[0].id);
  assert.equal(owner.active.id, tadbulb.id);
  assert.equal(owner.bench.some(card => card.id === attacker.id), true);
  assert.equal(attacker.cannotAttackUntilTurn, attackTurn + 2);

  intendedTarget = attacker.id;
  await runner.api.playCard(side, switches[1].id);
  assert.equal(owner.active.id, attacker.id);
  assert.equal(runner.api.canUseAttack(attacker, attack), false);
});

test('evolving a Pokémon preserves its active attack restriction', async () => {
  const fixture = sameDeckFixture(), runner = createEngineRunner(fixture, 431);
  runner.api.setup(fixture, runner.random, request => request.candidates?.[0] || null, () => false);
  runner.api.setLocalAi(false);
  const tadbulb = runner.api.prepareAttack('you', 'ASC', '69', []);
  const game = runner.api.state(), owner = game.players.you, expires = game.turnNumber + 2;
  tadbulb.cannotAttackUntilTurn = expires;
  owner.turnsTaken = 1;
  const bellibolt = takeOwned(owner, belliboltPrint);
  assert.ok(bellibolt);
  owner.hand.push(bellibolt);
  await runner.api.humanAction({ type: 'evolve', cardId: bellibolt.id, targetId: tadbulb.id });
  assert.equal(owner.active.id, bellibolt.id);
  assert.equal(owner.active.cannotAttackUntilTurn, expires);
});

test('Knockout clears the leaving Pokémon lock; replacement and a reused card have no stale restriction', async () => {
  const { runner, attacker, side, otherSide } = await readyRunner('you', 439);
  const owner = runner.api.state().players.you, replacement = getOrBenchTadbulb(owner);
  attacker.damage = 270;
  const attackTurn = runner.api.state().turnNumber;
  assert.equal(await runner.api.attack(side, 0), true);
  assert.equal(attacker.cannotAttackUntilTurn, attackTurn + 2);
  const opposing = runner.api.prepareAttack(otherSide, 'ASC', '71', ['Lightning']);
  const opposingAttack = runner.api.attackOptions(otherSide).find(item => item.attack.name === 'Quick Attack');
  assert.ok(opposingAttack);
  assert.equal(await runner.api.attack(otherSide, opposingAttack.index), true);
  assert.equal(runner.api.state().pendingPromotion, side);
  assert.equal(attacker.cannotAttackUntilTurn, undefined, 'Knockout removes the restriction from the Pokémon leaving play');
  await runner.api.promote();
  assert.notEqual(owner.active.id, attacker.id);
  assert.equal(owner.active.cannotAttackUntilTurn, undefined, 'the replacement does not inherit the Knocked Out Pokémon state');

  // Simulate a later effect reusing this same physical Pokémon object from the discard pile.
  const discardedIndex = owner.discard.findIndex(card => card.id === attacker.id);
  assert.notEqual(discardedIndex, -1);
  owner.discard.splice(discardedIndex, 1);
  const attachedIds = (attacker.energy || []).map(card => card.id);
  owner.discard = owner.discard.filter(card => !attachedIds.includes(card.id));
  owner.deck.push(owner.active);
  owner.active = attacker;
  assert.equal(owner.active.cannotAttackUntilTurn, undefined);
  assert.equal(runner.api.canUseAttack(owner.active, owner.active.meta.attacks.find(item => item.name === 'Thunderous Bolt')), true);
  assert.equal(opposing.meta.stage, 'Basic');
});

test('failed Thunderous Bolt transaction rolls back damage and the newly set lock', async () => {
  const { runner, attacker, target, side } = await readyRunner('you', 443);
  const targetBefore = target.damage || 0, turnBefore = runner.api.state().turn;
  const restore = runner.api.failNextAttackEffectAfterResolve();
  try { assert.equal(await runner.api.attack(side, 0), false); }
  finally { restore(); }
  assert.equal(runner.api.state().players.codex.active.damage || 0, targetBefore);
  assert.equal(runner.api.state().players.you.active.cannotAttackUntilTurn || 0, 0);
  assert.equal(runner.api.state().players.you.attackedThisTurn, false);
  assert.equal(runner.api.state().turn, turnBefore);
});

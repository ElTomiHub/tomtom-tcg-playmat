const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadFixture, createEngineRunner } = require('./integration-harness.cjs');

const findDrampa = fixture => fixture.cards.find(card => card.name === 'Drampa' && card.setCode === 'OBF' && card.cardNumber === '161');
const inspectDrampa = fixture => createEngineRunner(fixture, 131).api.inspectFixture(fixture).find(card => card.name === 'Drampa' && card.setCode === 'OBF' && card.cardNumber === '161');

async function readyRunner(side = 'you', seed = 127) {
  const fixture = loadFixture();
  fixture.decks.human = { ...fixture.decks.ai, id: `drampa-outrage-${side}` };
  fixture.decks.ai = { ...fixture.decks.human, id: `drampa-outrage-ai-${side}` };
  const runner = createEngineRunner(fixture, seed);
  runner.api.setup(fixture, runner.random, request => request.candidates?.find(card => card.name === 'Dratini') || request.candidates?.[0] || null, () => true);
  runner.api.setLocalAi(false);
  for (const owner of ['you', 'codex']) {
    const player = runner.api.state().players[owner];
    const moved = player.bench.filter(card => card.setCode === 'OBF' && card.cardNumber === '161');
    player.bench = player.bench.filter(card => !(card.setCode === 'OBF' && card.cardNumber === '161'));
    player.deck.push(...moved);
  }
  const attacker = runner.api.prepareAttack(side, 'OBF', '161', ['Lightning', 'Water']);
  const opponent = side === 'you' ? 'codex' : 'you';
  const target = runner.api.prepareAttack(opponent, 'OBF', '159', []);
  target.meta.weaknesses = [];
  target.meta.resistances = [];
  runner.api.state().turn = side;
  return { fixture, runner, attacker, target, side, opponent };
}

function attackFor(runner, side) {
  const option = runner.api.attackOptions(side).find(item => item.attack.name === 'Outrage');
  assert.ok(option, 'Outrage should be available to the prepared Active Drampa');
  return option;
}

test('Outrage is automated only for English Drampa OBF 161 with exact complete attack metadata', () => {
  const fixture = loadFixture(), card = findDrampa(fixture);
  assert.ok(card);
  assert.equal(card.language, 'en');
  const attack = card.meta.attacks.find(item => item.name === 'Outrage');
  assert.deepEqual(attack.cost, ['Colorless', 'Colorless']);
  assert.equal(attack.damage, '60+');
  assert.equal(attack.effect, 'This attack does 10 more damage for each damage counter on this Pokémon.');
  assert.equal(inspectDrampa(fixture).handler.attacks.find(item => item.name === 'Outrage').handler, 'bonus_per_damage_counter');

  for (const mutate of [
    item => { item.setCode = 'SVI'; },
    item => { item.cardNumber = '161a'; },
    item => { item.language = 'ja'; },
    item => { item.meta.attacks[0].effect += ' Draw a card.'; },
    item => { item.meta.attacks[0].effect = ''; },
    item => { item.meta.attacks[0].effect = 'This attack does 20 more damage for each damage counter on this Pokémon.'; },
    item => { item.meta.attacks[0].cost = ['Lightning', 'Lightning']; },
    item => { item.meta.attacks[0].damage = '60'; }
  ]) {
    const changed = structuredClone(fixture), changedCard = findDrampa(changed);
    mutate(changedCard);
    const result = createEngineRunner(changed, 137).api.inspectFixture(changed).find(item => item.name === 'Drampa' && item.setCode === changedCard.setCode && item.cardNumber === changedCard.cardNumber);
    assert.notEqual(result?.handler.attacks.find(entry => entry.name === 'Outrage')?.handler, 'bonus_per_damage_counter');
  }
});

test('Outrage costs two Energy units and adds 10 damage per damage counter on Drampa', async () => {
  for (const [counters, expected] of [[0, 60], [1, 70], [3, 90]]) {
    const { runner, attacker, target, side } = await readyRunner('you', 139 + counters);
    const option = attackFor(runner, side);
    attacker.damage = counters * 10;
    assert.equal(runner.api.canUseAttack({ ...attacker, energy: attacker.energy.slice(0, 1) }, option.attack), false, 'two Colorless Energy units are required');
    assert.equal(runner.api.canUseAttack(attacker, option.attack), true);
    assert.equal(await runner.api.attack(side, option.index), true);
    assert.equal(target.damage, expected);
    assert.ok(runner.api.state().log.some(entry => entry.message === `Toma used Outrage with Drampa for ${expected} damage.`));
  }
});

test('AI resolves Outrage through the same attack pipeline using its current damage counters', async () => {
  const { runner, attacker, target } = await readyRunner('codex', 149);
  attacker.damage = 20;
  const codex = runner.api.state().players.codex;
  codex.deck.push(...codex.hand); codex.hand = [];
  runner.api.setLocalAi(true);
  await runner.api.aiStep();
  assert.equal(target.damage, 80);
  assert.ok(runner.api.state().log.some(entry => entry.message === 'Yami used Outrage with Drampa for 80 damage.'));
});

test('invalid attack selection leaves damage and turn unchanged', async () => {
  const { runner, attacker, target, side } = await readyRunner('you');
  attacker.damage = 10;
  const turn = runner.api.state().turn;
  assert.equal(await runner.api.attack(side, 999), false);
  assert.equal(target.damage || 0, 0);
  assert.equal(attacker.damage, 10);
  assert.equal(runner.api.state().turn, turn);
});

test('failed Outrage resolution rolls back damage, attack state, and turn', async () => {
  const { runner, attacker, target, side } = await readyRunner('you', 151);
  attacker.damage = 20;
  const before = { targetDamage: target.damage || 0, attackerDamage: attacker.damage, turn: runner.api.state().turn };
  const option = attackFor(runner, side), restoreResolver = runner.api.failNextAttackEffectAfterResolve();
  try { assert.equal(await runner.api.attack(side, option.index), false); }
  finally { restoreResolver(); }
  const game = runner.api.state();
  assert.equal(game.players.codex.active.damage || 0, before.targetDamage);
  assert.equal(game.players.you.active.damage, before.attackerDamage);
  assert.equal(game.turn, before.turn);
  assert.equal(game.players.you.attackedThisTurn, false);
});


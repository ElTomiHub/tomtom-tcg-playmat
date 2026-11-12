const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadFixture, createEngineRunner } = require('./integration-harness.cjs');

function choiceDriver(request) {
  const candidates = request.candidates || [];
  if (request.kind === 'cards' && Number(request.minCount || 0) > 1) return candidates.slice(0, request.minCount);
  if (request.kind === 'cards') return candidates[0] ? [candidates[0]] : [];
  if (request.kind === 'prompt') return request.defaultValue;
  if (request.kind === 'confirm') return true;
  if (['active-pokemon', 'bench-pokemon'].includes(request.kind) && ['you', 'codex'].includes(request.side)) return candidates.find(card => card.name === 'Dratini') || candidates[0] || null;
  return candidates[0] || null;
}

function dragonairDeckFixture() {
  const fixture = loadFixture();
  fixture.decks.human = { ...fixture.decks.ai, id: 'human-dragonite-test' };
  return fixture;
}

function dragonairAudit(fixture) {
  return createEngineRunner(fixture, 1).api.inspectFixture(fixture).find(card => card.name === 'Dragonair' && card.setCode === 'ASC' && card.cardNumber === '151');
}

test('Dragonair ASC 151 Tail Snap has verified exact attack metadata; its Ability is also supported', () => {
  const fixture = loadFixture();
  const card = fixture.cards.find(item => item.name === 'Dragonair' && item.setCode === 'ASC' && item.cardNumber === '151');
  assert.ok(card);
  const attack = card.meta.attacks.find(item => item.name === 'Tail Snap');
  assert.ok(attack);
  assert.deepEqual(attack.cost, ['Water', 'Lightning']);
  assert.equal(attack.damage, 60);
  assert.equal(attack.effect, '');
  assert.equal(attack.effectTextStatus, 'explicit-empty');
  const audit = dragonairAudit(fixture);
  assert.equal(audit.handler.attacks.length, 1);
  assert.equal(audit.handler.attacks[0].handler, 'none');
  assert.equal(audit.handler.abilities[0].handler, 'search_evolution_pokemon');
  assert.equal(audit.resolution, 'automated', 'Evolutionary Guidance and Tail Snap are both verified');
});

test('missing or incomplete Dragonair attack metadata stays unresolved', () => {
  const fixture = loadFixture();
  const card = fixture.cards.find(item => item.name === 'Dragonair' && item.setCode === 'ASC' && item.cardNumber === '151');
  card.meta.attackMetadataStatus = 'missing';
  delete card.meta.attacks[0].effectTextStatus;
  const audit = dragonairAudit(fixture);
  assert.equal(audit.resolution, 'unresolved');
  assert.equal(audit.handler.attacks[0].handler, 'unresolved');
});

test('exact legacy Dragonair ASC 151 data remains safely supported without old completeness markers', () => {
  const fixture = loadFixture();
  const card = fixture.cards.find(item => item.name === 'Dragonair' && item.setCode === 'ASC' && item.cardNumber === '151');
  delete card.meta.attackMetadataStatus;
  delete card.meta.attacks[0].effectTextStatus;
  const audit = dragonairAudit(fixture);
  assert.equal(audit.handler.attacks[0].handler, 'none');
  assert.equal(audit.resolution, 'automated', 'Evolutionary Guidance is now supported');
});

test('a different Dragonair printing is not granted this fixture printing metadata', () => {
  const fixture = loadFixture();
  const card = fixture.cards.find(item => item.name === 'Dragonair' && item.setCode === 'ASC' && item.cardNumber === '151');
  card.setCode = 'OBF';
  card.cardNumber = '158';
  card.meta.attackMetadataStatus = 'missing';
  delete card.meta.attacks[0].effectTextStatus;
  const audit = createEngineRunner(fixture, 1).api.inspectFixture(fixture).find(item => item.name === 'Dragonair' && item.setCode === 'OBF' && item.cardNumber === '158');
  assert.equal(audit.resolution, 'unresolved');
  assert.equal(audit.handler.attacks[0].handler, 'unresolved');
});

test('Water and Lightning are both required; human Dragonair Tail Snap deals 60 through the engine', async () => {
  const fixture = dragonairDeckFixture();
  const runner = createEngineRunner(fixture, 13);
  runner.api.setup(fixture, runner.random, choiceDriver, () => true);
  let you = runner.api.state().players.you;
  assert.equal(you.active.name, 'Dratini');
  const dragonair = you.hand.find(card => card.name === 'Dragonair' && card.setCode === 'ASC' && card.cardNumber === '151');
  const water = you.hand.find(card => card.name === 'Water Energy');
  const lightning = you.hand.find(card => card.name === 'Lightning Energy');
  assert.ok(dragonair && water && lightning, 'seeded opening hand contains the exact evolution and both required Energy types');
  runner.api.attachFor('you', water.id, you.active.id);
  await runner.api.endTurnFor('you');
  await runner.api.endTurnFor('codex');
  you = runner.api.state().players.you;
  await runner.api.humanAction({ type: 'evolve', cardId: dragonair.id, targetId: you.active.id });
  const afterEvolution = runner.api.state().players.you.active;
  assert.equal(afterEvolution.name, 'Dragonair');
  assert.equal(runner.api.attackOptions('you').some(option => option.attack.name === 'Tail Snap'), false, 'Water alone is insufficient');
  runner.api.attachFor('you', lightning.id, afterEvolution.id);
  const attack = runner.api.attackOptions('you').find(option => option.attack.name === 'Tail Snap');
  assert.ok(attack, 'Tail Snap becomes legal with Water and Lightning attached');
  const target = runner.api.state().players.codex.active;
  const damageBefore = Number(target.damage || 0);
  assert.equal(await runner.api.attack('you', attack.index), true);
  assert.equal(runner.api.state().players.codex.active.damage, damageBefore + 60);
  assert.ok(runner.api.state().log.some(entry => /Toma used Tail Snap with Dragonair for 60 damage/.test(entry.message)));
});

test('invalid Dragonair attack selection leaves damage and turn unchanged', async () => {
  const fixture = dragonairDeckFixture();
  const runner = createEngineRunner(fixture, 13);
  runner.api.setup(fixture, runner.random, choiceDriver, () => true);
  let you = runner.api.state().players.you;
  const dragonair = you.hand.find(card => card.name === 'Dragonair' && card.setCode === 'ASC' && card.cardNumber === '151');
  const water = you.hand.find(card => card.name === 'Water Energy');
  const lightning = you.hand.find(card => card.name === 'Lightning Energy');
  runner.api.attachFor('you', water.id, you.active.id);
  await runner.api.endTurnFor('you');
  await runner.api.endTurnFor('codex');
  you = runner.api.state().players.you;
  await runner.api.humanAction({ type: 'evolve', cardId: dragonair.id, targetId: you.active.id });
  runner.api.attachFor('you', lightning.id, runner.api.state().players.you.active.id);
  const before = { damage: runner.api.state().players.codex.active.damage, turn: runner.api.state().turn };
  assert.equal(await runner.api.attack('you', 999), false);
  assert.equal(runner.api.state().players.codex.active.damage, before.damage);
  assert.equal(runner.api.state().turn, before.turn);
});

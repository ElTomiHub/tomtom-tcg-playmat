const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadFixture, createEngineRunner } = require('./integration-harness.cjs');

function choiceDriver(request) {
  const candidates = request.candidates || [];
  if (request.kind === 'cards' && Number(request.minCount || 0) > 1) return candidates.slice(0, request.minCount);
  if (request.kind === 'cards') return candidates[0] ? [candidates[0]] : [];
  if (request.kind === 'prompt') return request.defaultValue;
  if (request.kind === 'confirm') return true;
  if (request.kind === 'active-pokemon' && request.side === 'codex') return candidates.find(card => card.name === 'Dratini') || candidates[0] || null;
  if (request.kind === 'bench-pokemon' && request.side === 'codex') return candidates.find(card => card.name === 'Dratini') || candidates[0] || null;
  return candidates[0] || null;
}

function fixtureWithVerifiedDratini() {
  const fixture = loadFixture();
  const card = fixture.cards.find(item => item.name === 'Dratini' && item.setCode === 'OBF' && item.cardNumber === '157');
  assert.ok(card, 'the fixture must contain Dratini OBF 157');
  card.meta.attackMetadataStatus = 'present';
  const attack = card.meta.attacks.find(item => item.name === 'Tail Snap');
  assert.ok(attack, 'Dratini OBF 157 must contain Tail Snap');
  attack.effectTextStatus = 'explicit-empty';
  return fixture;
}

test('Dratini OBF 157 Tail Snap has verified attack identity and complete effect-free metadata', () => {
  const fixture = fixtureWithVerifiedDratini();
  const runner = createEngineRunner(fixture, 26);
  const card = runner.api.inspectFixture(fixture).find(item => item.name === 'Dratini' && item.setCode === 'OBF' && item.cardNumber === '157');
  assert.equal(card.resolution, 'automated');
  assert.equal(card.handler.attacks.length, 1);
  assert.equal(card.handler.attacks[0].handler, 'none');
  const attack = fixture.cards.find(item => item.setCode === 'OBF' && item.cardNumber === '157').meta.attacks[0];
  assert.equal(attack.name, 'Tail Snap');
  assert.deepEqual(attack.cost, ['Colorless']);
  assert.equal(attack.damage, 20);
  assert.equal(attack.effect, '');
  assert.equal(attack.effectTextStatus, 'explicit-empty');
});

test('incomplete Dratini attack metadata stays unresolved, while an exact legacy print remains safely identifiable', () => {
  const fixture = fixtureWithVerifiedDratini();
  const dratini = fixture.cards.find(item => item.name === 'Dratini' && item.setCode === 'OBF' && item.cardNumber === '157');
  delete dratini.meta.attacks[0].effectTextStatus;
  dratini.meta.attackMetadataStatus = 'missing';
  const audit = createEngineRunner(fixture, 26).api.inspectFixture(fixture).find(item => item.name === 'Dratini' && item.setCode === 'OBF' && item.cardNumber === '157');
  assert.equal(audit.resolution, 'unresolved');
  assert.equal(audit.handler.attacks[0].handler, 'unresolved');
  dratini.meta.attackMetadataStatus = 'present';
  const legacyAudit = createEngineRunner(fixture, 26).api.inspectFixture(fixture).find(item => item.name === 'Dratini' && item.setCode === 'OBF' && item.cardNumber === '157');
  assert.equal(legacyAudit.handler.attacks[0].handler, 'none');
});

test('wrong printing and incomplete attack records are not mistaken for Dratini OBF 157', () => {
  const fixture = fixtureWithVerifiedDratini();
  const dratini = fixture.cards.find(item => item.name === 'Dratini' && item.setCode === 'OBF' && item.cardNumber === '157');
  dratini.cardNumber = '999';
  dratini.meta.attackMetadataStatus = 'missing';
  delete dratini.meta.attacks[0].effectTextStatus;
  const audit = createEngineRunner(fixture, 26).api.inspectFixture(fixture).find(item => item.name === 'Dratini' && item.setCode === 'OBF' && item.cardNumber === '999');
  assert.equal(audit.resolution, 'unresolved');
});

test('insufficient Energy prevents Tail Snap and a valid attack deals 20 damage through the engine', async () => {
  const fixture = fixtureWithVerifiedDratini();
  const runner = createEngineRunner(fixture, 26);
  runner.api.setup(fixture, runner.random, choiceDriver, () => true);
  assert.equal(runner.api.state().players.codex.active.name, 'Dratini');
  await runner.api.endTurnFor('you');
  const codex = runner.api.state().players.codex;
  assert.equal(runner.api.attackOptions('codex').length, 0, 'no Energy means no legal attack');
  const energy = codex.hand.find(card => card.meta.category === 'Energy');
  assert.ok(energy);
  runner.api.attachFor('codex', energy.id, codex.active.id);
  const options = runner.api.attackOptions('codex');
  const tailSnap = options.find(option => option.attack.name === 'Tail Snap');
  assert.ok(tailSnap, 'the normal legal-attack generator exposes Tail Snap after Energy attachment');
  const target = runner.api.state().players.you.active;
  const damageBefore = Number(target.damage || 0);
  assert.equal(await runner.api.attack('codex', tailSnap.index), true);
  assert.equal(runner.api.state().players.you.active.damage, damageBefore + 20);
  assert.equal(runner.api.state().turn, 'you', 'successful attack hands over the turn through the normal attack pipeline');
  assert.ok(runner.api.state().log.some(entry => /Tail Snap with Dratini for 20 damage/.test(entry.message)));
});

test('human and AI attack paths share authoritative Tail Snap resolution', async () => {
  const fixture = fixtureWithVerifiedDratini();
  fixture.decks.human = { ...fixture.decks.ai, id: 'human-dragonite-test' };
  const humanChoices = request => {
    const candidates = request.candidates || [];
    if (request.kind === 'active-pokemon') return candidates.find(card => card.name === 'Dratini') || candidates[0] || null;
    return choiceDriver(request);
  };
  let selectedSeed = null;
  for (let seed = 1; seed <= 100 && selectedSeed === null; seed++) {
    const candidate = createEngineRunner(fixture, seed);
    candidate.api.setup(fixture, candidate.random, humanChoices, () => true);
    if (candidate.api.state().players.you.active.name === 'Dratini') selectedSeed = seed;
  }
  assert.notEqual(selectedSeed, null, 'deterministic opening choices must permit a human Dratini scenario');
  const runner = createEngineRunner(fixture, selectedSeed);
  runner.api.setup(fixture, runner.random, humanChoices, () => true);
  assert.equal(runner.api.state().players.you.active.name, 'Dratini');
  const you = runner.api.state().players.you;
  const energy = you.hand.find(card => card.meta.category === 'Energy');
  assert.ok(energy, 'test deck opening hand contains an Energy card');
  runner.api.attachFor('you', energy.id, you.active.id);
  await runner.api.endTurnFor('you');
  await runner.api.endTurnFor('codex');
  const options = runner.api.attackOptions('you');
  const tailSnap = options.find(option => option.attack.name === 'Tail Snap');
  assert.ok(tailSnap, 'human legal-attack generator exposes the same verified attack');
  const damageBefore = Number(runner.api.state().players.codex.active.damage || 0);
  assert.equal(await runner.api.attack('you', tailSnap.index), true);
  assert.equal(runner.api.state().players.codex.active.damage, damageBefore + 20);
  assert.ok(runner.api.state().log.some(entry => /Toma used Tail Snap with Dratini for 20 damage/.test(entry.message)));
});

test('invalid attack index does not change damage or turn state', async () => {
  const fixture = fixtureWithVerifiedDratini();
  const runner = createEngineRunner(fixture, 26);
  runner.api.setup(fixture, runner.random, choiceDriver, () => true);
  await runner.api.endTurnFor('you');
  const codex = runner.api.state().players.codex;
  const energy = codex.hand.find(card => card.meta.category === 'Energy');
  runner.api.attachFor('codex', energy.id, codex.active.id);
  const active = runner.api.state().players.you.active;
  const before = { damage: active.damage, turn: runner.api.state().turn, codexHand: codex.hand.map(card => card.id), codexDiscard: codex.discard.map(card => card.id) };
  assert.equal(await runner.api.attack('codex', 999), false);
  assert.equal(runner.api.state().players.you.active.damage, before.damage);
  assert.equal(runner.api.state().turn, before.turn);
  assert.deepEqual(runner.api.state().players.codex.hand.map(card => card.id), before.codexHand);
  assert.deepEqual(runner.api.state().players.codex.discard.map(card => card.id), before.codexDiscard);
});

test('Tail Snap is rejected without an opposing Active target and leaves the attack unused', async () => {
  const fixture = fixtureWithVerifiedDratini();
  const runner = createEngineRunner(fixture, 26);
  runner.api.setup(fixture, runner.random, choiceDriver, () => true);
  await runner.api.endTurnFor('you');
  const codex = runner.api.state().players.codex;
  const energy = codex.hand.find(card => card.meta.category === 'Energy');
  runner.api.attachFor('codex', energy.id, codex.active.id);
  const option = runner.api.attackOptions('codex').find(item => item.attack.name === 'Tail Snap');
  assert.ok(option);
  const attackerId = codex.active.id;
  runner.api.state().players.you.active = null;
  const discardBefore = codex.discard.map(card => card.id);
  assert.equal(await runner.api.attack('codex', option.index), false);
  assert.equal(runner.api.state().players.codex.active.id, attackerId);
  assert.equal(runner.api.state().players.codex.attackedThisTurn, false);
  assert.deepEqual(runner.api.state().players.codex.discard.map(card => card.id), discardBefore);
});

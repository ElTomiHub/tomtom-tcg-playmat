const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadFixture, createEngineRunner } = require('./integration-harness.cjs');

function choiceDriver(request) {
  const candidates = request.candidates || [];
  if (request.kind === 'cards' && Number(request.minCount || 0) > 1) return candidates.slice(0, request.minCount);
  if (request.kind === 'cards') return candidates[0] ? [candidates[0]] : [];
  if (request.kind === 'prompt') return request.defaultValue;
  if (request.kind === 'confirm') return true;
  if (['active-pokemon', 'bench-pokemon'].includes(request.kind)) return candidates.find(card => card.name === 'Dratini') || candidates[0] || null;
  return candidates[0] || null;
}

function dragoniteAudit(fixture) {
  return createEngineRunner(fixture, 13).api.inspectFixture(fixture).find(card => card.name === 'Dragonite' && card.setCode === 'SIT' && card.cardNumber === '131');
}

function humanDragoniteFixture() {
  const fixture = loadFixture();
  fixture.decks.human = { ...fixture.decks.ai, id: 'human-dragonite-test' };
  return fixture;
}

test('Dragonite SIT 131 Dragon Claw has exact verified metadata and no additional effect', () => {
  const fixture = loadFixture();
  const card = fixture.cards.find(item => item.name === 'Dragonite' && item.setCode === 'SIT' && item.cardNumber === '131');
  assert.ok(card);
  const attack = card.meta.attacks.find(item => item.name === 'Dragon Claw');
  assert.ok(attack);
  assert.equal(card.language, 'en');
  assert.deepEqual(attack.cost, ['Colorless', 'Colorless', 'Colorless']);
  assert.equal(attack.damage, 80);
  assert.equal(attack.effect, '');
  assert.equal(attack.effectTextStatus, 'explicit-empty');
  const audit = dragoniteAudit(fixture);
  assert.equal(audit.handler.attacks.find(item => item.name === 'Dragon Claw').handler, 'none');
  assert.equal(audit.handler.attacks.find(item => item.name === 'Energy Hurricane').handler, 'search_attach_basic_energy');
  assert.equal(audit.resolution, 'automated', 'both attacks are fully supported for this exact printing');
});

test('missing attack metadata stays unresolved; exact legacy Dragon Claw remains identifiable', () => {
  const fixture = loadFixture();
  const card = fixture.cards.find(item => item.name === 'Dragonite' && item.setCode === 'SIT' && item.cardNumber === '131');
  card.meta.attackMetadataStatus = 'missing';
  card.meta.attacks.find(item => item.name === 'Dragon Claw').effectTextStatus = 'missing';
  let audit = dragoniteAudit(fixture);
  assert.equal(audit.resolution, 'unresolved');
  assert.equal(audit.handler.attacks.find(item => item.name === 'Dragon Claw').handler, 'unresolved');
  card.meta.attackMetadataStatus = 'present';
  card.meta.attacks.find(item => item.name === 'Dragon Claw').effectTextStatus = undefined;
  audit = dragoniteAudit(fixture);
  assert.equal(audit.handler.attacks.find(item => item.name === 'Dragon Claw').handler, 'none');
});

test('another Dragonite printing or altered Dragon Claw cost/damage does not inherit this exact metadata', () => {
  const fixture = loadFixture();
  const card = fixture.cards.find(item => item.name === 'Dragonite' && item.setCode === 'SIT' && item.cardNumber === '131');
  card.setCode = 'SIT';
  card.cardNumber = '999';
  card.meta.attackMetadataStatus = 'missing';
  card.meta.attacks.find(item => item.name === 'Dragon Claw').effectTextStatus = 'missing';
  let audit = createEngineRunner(fixture, 13).api.inspectFixture(fixture).find(item => item.name === 'Dragonite' && item.setCode === 'SIT' && item.cardNumber === '999');
  assert.equal(audit.resolution, 'unresolved');
  card.setCode = 'SIT';
  card.cardNumber = '131';
  card.meta.attackMetadataStatus = 'present';
  const attack = card.meta.attacks.find(item => item.name === 'Dragon Claw');
  attack.effectTextStatus = undefined;
  attack.cost = ['Water', 'Lightning', 'Colorless'];
  audit = dragoniteAudit(fixture);
  assert.notEqual(audit.handler.attacks.find(item => item.name === 'Dragon Claw').handler, 'none');
  attack.cost = ['Colorless', 'Colorless', 'Colorless'];
  attack.damage = 90;
  audit = dragoniteAudit(fixture);
  assert.notEqual(audit.handler.attacks.find(item => item.name === 'Dragon Claw').handler, 'none');
});

test('human evolves into Dragonite SIT, needs three Energy, then deals 80 damage with Dragon Claw', async () => {
  const fixture = humanDragoniteFixture();
  const runner = createEngineRunner(fixture, 13);
  runner.api.setup(fixture, runner.random, choiceDriver, () => true);
  let you = runner.api.state().players.you;
  assert.equal(you.active.name, 'Dratini');
  let dragonair = you.hand.find(card => card.name === 'Dragonair' && card.setCode === 'ASC' && card.cardNumber === '151');
  let firstEnergy = you.hand.find(card => card.meta.category === 'Energy' && card.meta.energyType === 'Water') || you.hand.find(card => card.meta.category === 'Energy' && card.name !== 'Double Dragon Energy');
  assert.ok(dragonair && firstEnergy, 'opening hand provides the first legal evolution and Energy');
  runner.api.attachFor('you', firstEnergy.id, you.active.id);
  await runner.api.endTurnFor('you');
  await runner.api.endTurnFor('codex');

  let actions = 0;
  let attack = null;
  while (!attack && actions++ < 60 && runner.api.phase() === 'play') {
    you = runner.api.state().players.you;
    if (you.active.name === 'Dratini') {
      dragonair = you.hand.find(card => card.name === 'Dragonair' && card.setCode === 'ASC' && card.cardNumber === '151');
      if (dragonair && you.turnsTaken > 0) await runner.api.humanAction({ type: 'evolve', cardId: dragonair.id, targetId: you.active.id });
    }
    you = runner.api.state().players.you;
    if (you.active.name === 'Dragonair') {
      const dragonite = you.hand.find(card => card.name === 'Dragonite' && card.setCode === 'SIT' && card.cardNumber === '131');
      if (dragonite && you.turnsTaken > 0 && you.active.evolvedTurn !== runner.api.state().turnNumber) await runner.api.humanAction({ type: 'evolve', cardId: dragonite.id, targetId: you.active.id });
    }
    you = runner.api.state().players.you;
    if (!you.energyAttachedThisTurn) {
      const energy = you.hand.find(card => card.meta.category === 'Energy' && card.name !== 'Double Dragon Energy');
      if (energy) runner.api.attachFor('you', energy.id, you.active.id);
    }
    you = runner.api.state().players.you;
    if (you.active.name === 'Dragonite' && you.active.setCode === 'SIT' && you.active.cardNumber === '131') {
      attack = runner.api.attackOptions('you').find(option => option.attack.name === 'Dragon Claw') || null;
      if (attack) break;
    }
    await runner.api.endTurnFor('you');
    await runner.api.endTurnFor('codex');
  }
  assert.ok(attack, 'real turn draws and legal evolution/attachment actions eventually make Dragon Claw available');
  const evolvedAttacker = runner.api.state().players.you.active;
  assert.equal(runner.api.canUseAttack({ ...evolvedAttacker, energy: evolvedAttacker.energy.slice(0, 2) }, attack.attack), false, 'two Energy do not satisfy Dragon Claw');
  assert.equal(runner.api.canUseAttack(evolvedAttacker, attack.attack), true, 'three Colorless Energy satisfy Dragon Claw');
  const target = runner.api.state().players.codex.active;
  const before = Number(target.damage || 0);
  assert.equal(await runner.api.attack('you', attack.index), true);
  assert.equal(runner.api.state().players.codex.active.damage, before + 80);
  assert.ok(runner.api.state().log.some(entry => /Toma used Dragon Claw with Dragonite for 80 damage/.test(entry.message)));
});

test('invalid Dragon Claw selection does not change damage or turn state', async () => {
  const fixture = humanDragoniteFixture();
  const runner = createEngineRunner(fixture, 13);
  runner.api.setup(fixture, runner.random, choiceDriver, () => true);
  let you = runner.api.state().players.you;
  const dragonair = you.hand.find(card => card.name === 'Dragonair' && card.setCode === 'ASC' && card.cardNumber === '151');
  const water = you.hand.find(card => card.name === 'Water Energy');
  runner.api.attachFor('you', water.id, you.active.id);
  await runner.api.endTurnFor('you');
  await runner.api.endTurnFor('codex');
  you = runner.api.state().players.you;
  await runner.api.humanAction({ type: 'evolve', cardId: dragonair.id, targetId: you.active.id });
  let legalDragonClaw = false;
  for (let turn = 0; turn < 60; turn++) {
    you = runner.api.state().players.you;
    if (!you.energyAttachedThisTurn) {
      const energy = you.hand.find(card => card.meta.category === 'Energy' && card.name !== 'Double Dragon Energy');
      if (energy) runner.api.attachFor('you', energy.id, you.active.id);
    }
    const dragonite = runner.api.state().players.you.hand.find(card => card.name === 'Dragonite' && card.setCode === 'SIT' && card.cardNumber === '131');
    if (dragonite && runner.api.state().players.you.turnsTaken > 0 && runner.api.state().players.you.active.evolvedTurn !== runner.api.state().turnNumber) await runner.api.humanAction({ type: 'evolve', cardId: dragonite.id, targetId: runner.api.state().players.you.active.id });
    if (runner.api.state().players.you.active.name === 'Dragonite' && runner.api.state().players.you.active.setCode === 'SIT' && runner.api.attackOptions('you').some(option => option.attack.name === 'Dragon Claw')) { legalDragonClaw = true; break; }
    await runner.api.endTurnFor('you');
    await runner.api.endTurnFor('codex');
  }
  assert.equal(legalDragonClaw, true, 'Dragon Claw must be a legal choice before testing an invalid attack index');
  const before = { damage: runner.api.state().players.codex.active.damage, turn: runner.api.state().turn };
  assert.equal(await runner.api.attack('you', 999), false);
  assert.equal(runner.api.state().players.codex.active.damage, before.damage);
  assert.equal(runner.api.state().turn, before.turn);
});

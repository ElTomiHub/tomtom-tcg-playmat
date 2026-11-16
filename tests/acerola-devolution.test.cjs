const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadFixture, createEngineRunner } = require('./integration-harness.cjs');

const prints = [
  { name: "Acerola's Mischief", setCode: 'M1S', cardNumber: '90' },
  { name: 'Technical Machine Devolution', setCode: 'SVK', cardNumber: '29' }
];

function setup(print) {
  const fixture = loadFixture();
  const runner = createEngineRunner(fixture, 71);
  runner.api.setup(fixture, runner.random, runner.choose, () => true);
  runner.api.setLocalAi(false);
  const game = runner.api.state(), { you, codex } = game.players;
  game.phase = 'play';
  game.turn = 'you';
  game.turnNumber = 3;
  you.turnsTaken = 1;
  you.attackedThisTurn = false;
  you.supporterPlayedThisTurn = false;
  const card = { ...print, id: 'new-print', categoryHint: 'Trainer', meta: null };
  runner.api.repairMetadata(card);
  return { runner, fixture, game, you, codex, card };
}

test('both exact Japanese prints are automated and altered effect text fails closed', () => {
  for (const print of prints) {
    const { runner, fixture, card } = setup(print);
    const inspect = () => runner.api.inspectFixture({ ...fixture, cards: [card] })[0].resolution;
    assert.equal(inspect(), 'automated', print.name);
    card.meta.effect += ' Additional effect.';
    assert.notEqual(inspect(), 'automated', print.name);
  }
});

test('Acerola requires at most two opposing Prizes and protects against ex damage for one turn', async () => {
  const { runner, game, you, codex, card } = setup(prints[0]);
  you.hand.push(card);
  codex.prizes = codex.prizes.slice(0, 3);
  await runner.api.playCard('you', card.id);
  assert.ok(you.hand.includes(card));
  assert.equal(you.supporterPlayedThisTurn, false);
  codex.prizes.pop();
  runner.api.setChoices(runner.random, query => query.candidates[0]);
  await runner.api.playCard('you', card.id);
  assert.ok(you.discard.includes(card));
  assert.equal(you.active.exAttackProtectionUntilTurn, 4);
  game.turnNumber = 4;
  const originalName = codex.active.name;
  codex.active.name = 'Test ex';
  const before = you.active.damage;
  await runner.api.damagePokemon('codex', 'you', you.active, 'active', 10);
  assert.equal(you.active.damage, before);
  codex.active.name = originalName.replace(/ ex$/, '');
  await runner.api.damagePokemon('codex', 'you', you.active, 'active', 10);
  assert.ok(you.active.damage > before);
});

test('Devolution removes one stage, retains attachments and damage, and discards the Tool', async () => {
  const { runner, you, codex, card } = setup(prints[1]);
  you.active.tools = [card];
  you.active.energy = [{id:'test-energy', name:'Water Energy', meta:{category:'Energy', energyType:'Water'}}];
  const top = codex.active;
  const base = {...top, id:'previous-stage', damage:undefined, meta:{...top.meta, hp:100}};
  top.evolutionStack = [base];
  top.damage = 20;
  top.energy = [{id:'defender-energy', name:'Water Energy', meta:{category:'Energy', energyType:'Water'}}];
  const attack = runner.api.attackOptions('you').find(option => option.attack.name === 'Devolution');
  assert.ok(attack);
  assert.equal(await runner.api.attack('you', attack.index), true);
  assert.equal(codex.active.id, base.id);
  assert.equal(codex.active.damage, 20);
  assert.equal(codex.active.energy[0].id, 'defender-energy');
  assert.ok(codex.hand.some(item => item.id === top.id));
  assert.ok(you.discard.some(item => item.id === card.id));
});

test('Devolution awards Prizes for the revealed lower stage and promotes after a Knock Out', async () => {
  const { runner, you, codex, card } = setup(prints[1]);
  you.active.tools = [card];
  you.active.energy = [{ id: 'test-energy', name: 'Water Energy', meta: { category: 'Energy', energyType: 'Water' } }];
  const top = codex.active;
  top.evolutionStack = [{ id: 'low-hp', name: top.name, meta: { ...top.meta, hp: 30 } }];
  top.damage = 40;
  codex.bench = [{ ...top, id: 'replacement', evolutionStack: [], damage: 0 }];
  const prizeCount = you.prizes.length;
  const attack = runner.api.attackOptions('you').find(option => option.attack.name === 'Devolution');
  assert.equal(await runner.api.attack('you', attack.index), true);
  assert.equal(codex.active.id, 'replacement');
  assert.ok(codex.discard.some(item => item.id === 'low-hp'));
  assert.equal(you.prizes.length, prizeCount - 1);
});

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createEngineRunner, loadFixture } = require('./integration-harness.cjs');

function setup(style = 'balanced', difficulty = 'competitor') {
  const fixture = loadFixture();
  const runner = createEngineRunner(fixture,15);
  runner.api.setup(fixture,runner.random,runner.choose,() => true,{yamiStyle:style,yamiDifficulty:difficulty});
  const game = runner.api.state(), ai = game.players.codex, foe = game.players.you;
  game.turn = 'codex';
  game.turnNumber = 4;
  game.firstPlayer = 'you';
  ai.turnsTaken = 1;
  ai.attackedThisTurn = false;
  ai.energyAttachedThisTurn = true;
  ai.supporterPlayedThisTurn = false;
  const card = (name,id = name,print) => ({
    ...structuredClone(fixture.cards.find(candidate => candidate.name === name && (!print || candidate.setCode === print))),
    id, energy:[], tools:[], conditions:[], damage:0, enteredTurn:1, evolvedTurn:-1
  });
  const energy = (type,id = type) => ({id,name:type+' Energy',meta:{category:'Energy',energyType:type}});
  ai.active = card('Dratini');
  ai.bench = [];
  ai.hand = [];
  foe.active = card("Iono's Bellibolt ex");
  foe.active.meta.hp = 200;
  foe.active.meta.weaknesses = [];
  foe.active.meta.resistances = [];
  foe.bench = [card("Iono's Wattrel")];
  runner.api.clearVisuals();
  assert.equal(runner.context.hasPeterDragoniteStrategy(),true);
  return {runner,game,ai,foe,card,energy};
}

test('Aggro opens with Dratini and Balanced favors Tatsugiri with Water in hand', () => {
  const {runner,game,card,energy} = setup('aggro','casual');
  const dratini = card('Dratini'), tatsugiri = card('Tatsugiri'), hand = [dratini,tatsugiri,energy('Water')];
  const rank = runner.context.peterDragoniteOpeningScore;
  assert.ok(rank(dratini,hand) > rank(tatsugiri,hand));
  game.yamiStyle = 'balanced';
  assert.ok(rank(tatsugiri,hand) > rank(dratini,hand));
});

test('Balanced resolves Mise en Place on a Benched Dratini and keeps Tatsugiri as the pivot', async () => {
  const {runner,ai,card,energy} = setup('balanced','casual');
  ai.active = card('Tatsugiri');
  ai.active.energy = [energy('Water','active-water')];
  const dratini = card('Dratini');
  ai.bench = [dratini];
  ai.deck = [energy('Water','searched-1'),energy('Water','searched-2'),card('Dragonair')];
  assert.equal(runner.api.aiAction().name,'Mise en Place');
  await runner.api.aiStep();
  assert.deepEqual(dratini.energy.map(card=>card.id),['searched-1','searched-2']);
  assert.equal(ai.active.energy.length,1);
});

test('Balanced uses Evolutionary Guidance before evolving an energized Dragonair', async () => {
  const {runner,ai,card,energy} = setup();
  ai.active = card('Dragonair');
  ai.active.energy = [energy('Water'),energy('Lightning')];
  ai.hand = [card('Dragonite','in-hand','SIT')];
  ai.deck = [card('Dragonite','searched','MEW'),energy('Water','extra-1'),energy('Lightning','extra-2'),energy('Water','extra-3')];
  assert.equal(runner.api.aiAction().abilityName,'Evolutionary Guidance');
  await runner.api.aiStep();
  assert.ok(ai.hand.some(card=>card.id==='searched'));
  assert.equal(runner.api.aiAction().type,'evolve');
});

test('Aggro Competitor plans and plays Rare Candy followed by Double Dragon Energy for a Knock Out', async () => {
  const {runner,ai,foe,card} = setup('aggro','competitor');
  ai.energyAttachedThisTurn = false;
  ai.hand = [card('Rare Candy'),card('Dragonite','evolution','MEW'),card('Double Dragon Energy')];
  foe.active.meta.hp = 160;
  const before = JSON.stringify(runner.api.state());
  const action = runner.api.aiAction();
  assert.equal(action.card.name,'Rare Candy');
  assert.equal(action.targetId.evolutionId,'evolution');
  assert.equal(JSON.stringify(runner.api.state()),before);
  await runner.api.aiStep();
  assert.equal(ai.active.id,'evolution');
  assert.equal(runner.api.aiAction().card.name,'Double Dragon Energy');
  await runner.api.aiStep();
  assert.equal(ai.active.energy.length,1);
  assert.equal(runner.api.aiAction().name,'Dragon Pulse');
});

test('Master uses Sky Transport to promote the prepared attacker instead of the highest-HP Pokémon', async () => {
  const {runner,ai,foe,card,energy} = setup('balanced','master');
  const mega = card('Mega Dragonite ex'), finisher = card('Dragonite','jet','MEW');
  finisher.energy = [energy('Water'),energy('Lightning')];
  ai.bench = [mega,finisher];
  foe.active.meta.hp = 150;
  const action = runner.api.aiAction();
  assert.equal(action.type,'ability');
  assert.equal(action.targetId,'jet');
  await runner.api.aiStep();
  assert.equal(ai.active.id,'jet');
  assert.equal(runner.api.aiAction().name,'Dragon Pulse');
});

test('Competitor chooses the guaranteed Knock Out over Mighty Meteor on a coin flip', () => {
  const {runner,ai,foe,card,energy} = setup('aggro','competitor');
  ai.active = card('Dragonite ex');
  ai.active.energy = [energy('Water'),energy('Lightning')];
  const finisher = card('Dragonite','jet','MEW');
  finisher.energy = [energy('Water','bench-water'),energy('Lightning','bench-lightning')];
  ai.bench = [finisher];
  foe.active.meta.hp = 160;
  assert.equal(runner.api.aiAction().type,'retreat');
  assert.equal(runner.api.aiAction().target,finisher);
});

test('Control saves Dragon Pulse with two cards left unless the Knock Out ends the game', () => {
  const {runner,ai,foe,card,energy} = setup('control','master');
  ai.active = card('Dragonite','jet','MEW');
  ai.active.energy = [energy('Water'),energy('Lightning')];
  ai.deck = [card('Dragonair'),energy('Water','last-water')];
  foe.active.meta.hp = 160;
  assert.equal(runner.api.aiAction().type,'end_turn');
  ai.prizes = ai.prizes.slice(0,1);
  assert.equal(runner.api.aiAction().name,'Dragon Pulse');
});

test('Master plans an Energy Switch from a backup and spends the correct Basic Energy', async () => {
  const {runner,ai,foe,card,energy} = setup('aggro','master');
  ai.active = card('Dragonite','jet','MEW');
  ai.active.energy = [energy('Water')];
  const source = card('Dratini');
  source.energy = [energy('Water','spare-water'),energy('Lightning','needed')];
  ai.bench = [source];
  ai.hand = [card('Energy Switch')];
  foe.active.meta.hp = 150;
  const action = runner.api.aiAction();
  assert.equal(action.card.name,'Energy Switch');
  assert.equal(action.targetId.energyId,'needed');
  await runner.api.aiStep();
  assert.deepEqual(ai.active.energy.map(card=>card.id),['Water','needed']);
  assert.deepEqual(source.energy.map(card=>card.id),['spare-water']);
  assert.equal(runner.api.aiAction().name,'Dragon Pulse');
});

test('Energy Hurricane powers a backup Dragonite with both Energy types', async () => {
  const {runner,ai,card,energy} = setup('balanced','competitor');
  ai.active = card('Dragonite','hurricane','SIT');
  ai.active.energy = [energy('Water'),energy('Water','active-2'),energy('Lightning'),energy('Lightning','active-4')];
  const backup = card('Dragonite','backup','MEW');
  ai.bench = [backup];
  ai.deck = [energy('Water','deck-1'),energy('Water','deck-2'),energy('Lightning','deck-3'),card('Drampa')];
  assert.equal(runner.api.aiAction().name,'Energy Hurricane');
  await runner.api.aiStep();
  assert.equal(ai.active.energy.length,4);
  assert.ok(backup.energy.some(card=>card.name==='Water Energy'));
  assert.ok(backup.energy.some(card=>card.name==='Lightning Energy'));
});

test('Control aims Pokémon Catcher at a stranded target and leaves it in hand on Casual', () => {
  const {runner,game,ai,foe,card,energy} = setup('control','competitor');
  ai.active.energy = [energy('Water')];
  ai.hand = [card('Pokémon Catcher')];
  foe.active.energy = [energy('Lightning')];
  const stalled = card("Iono's Bellibolt ex",'stranded');
  stalled.meta.retreat = 3;
  foe.bench.push(stalled);
  assert.equal(runner.api.aiAction().targetId,'stranded');
  game.yamiDifficulty = 'casual';
  assert.equal(runner.api.aiAction().name,'Tail Snap');
});

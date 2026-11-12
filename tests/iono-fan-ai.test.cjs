const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createEngineRunner, loadFixture } = require('./integration-harness.cjs');

function setup(style = 'balanced', difficulty = 'competitor') {
  const fixture = loadFixture();
  const match = {...fixture, decks: {human:fixture.decks.ai, ai:fixture.decks.human}};
  const runner = createEngineRunner(match, 15);
  runner.api.setup(match, runner.random, runner.choose, () => true, {yamiStyle:style, yamiDifficulty:difficulty});
  const game = runner.api.state(), ai = game.players.codex, foe = game.players.you;
  game.turn = 'codex';
  game.turnNumber = 4;
  game.firstPlayer = 'you';
  ai.turnsTaken = 1;
  ai.attackedThisTurn = false;
  ai.energyAttachedThisTurn = true;
  ai.supporterPlayedThisTurn = false;
  const card = (name,id = name) => ({
    ...structuredClone(fixture.cards.find(candidate => candidate.name === name)),
    id, energy:[], tools:[], conditions:[], damage:0, enteredTurn:1, evolvedTurn:-1
  });
  const lightning = id => ({id,name:'Lightning Energy',meta:{category:'Energy',energyType:'Lightning'}});
  ai.active = card("Iono's Voltorb");
  ai.bench = [];
  ai.hand = [];
  foe.active = card('Drampa');
  foe.active.meta.hp = 200;
  foe.active.meta.weaknesses = [];
  foe.active.meta.resistances = [];
  foe.bench = [];
  runner.api.clearVisuals();
  assert.equal(runner.context.hasIonoFanStrategy(),true);
  return {runner,game,ai,foe,card,lightning};
}

test('Iono Fan Aggro favors Voltorb while Balanced develops Tadbulb from the same hand', () => {
  const {runner,game,ai,card} = setup('aggro','casual');
  ai.active = card("Iono's Wattrel");
  ai.hand = [card("Iono's Tadbulb"),card("Iono's Voltorb")];
  assert.equal(runner.api.aiAction().card.name,"Iono's Voltorb");
  game.yamiStyle = 'balanced';
  assert.equal(runner.api.aiAction().card.name,"Iono's Tadbulb");
});

test('Master sees a two-attachment Electric Streamer Knock Out and executes its first attachment', async () => {
  const {runner,game,ai,foe,card,lightning} = setup('aggro','master');
  ai.active.energy = [lightning('a'),lightning('b')];
  ai.bench = [card("Iono's Bellibolt ex")];
  ai.hand = [lightning('c'),lightning('d')];
  foe.active.meta.hp = 100;
  const before = JSON.stringify(game);
  const planned = runner.context.chooseAiPrizeLine();
  assert.equal(planned?.type,'ability');
  assert.equal(planned.pokemon,ai.bench[0]);
  assert.equal(JSON.stringify(game),before);
  game.yamiDifficulty = 'competitor';
  assert.equal(runner.context.chooseAiPrizeLine(),null);
  game.yamiDifficulty = 'master';
  await runner.api.aiStep();
  assert.equal(ai.hand.length,1);
  assert.ok([ai.active,...ai.bench].some(card=>card.energy.some(energy=>energy.id==='c')));
  assert.equal(runner.context.chooseAiPrizeLine()?.type,'ability');
});

test('Aggro uses Energy Switch to enable Voltaic Chain and moves the planned Energy', async () => {
  const {runner,ai,foe,card,lightning} = setup('aggro','competitor');
  ai.active.energy = [lightning('active-energy')];
  const source = card("Iono's Kilowattrel");
  source.energy = [lightning('energy-to-move')];
  ai.bench = [source];
  ai.hand = [card('Energy Switch')];
  foe.active.meta.hp = 60;
  const action = runner.api.aiAction();
  assert.equal(action.card.name,'Energy Switch');
  assert.equal(action.targetId.sourceId,source.id);
  assert.equal(action.targetId.destinationId,ai.active.id);
  await runner.api.aiStep();
  assert.deepEqual(ai.active.energy.map(energy=>energy.id),['active-energy','energy-to-move']);
  assert.equal(source.energy.length,0);
  assert.equal(runner.api.aiAction().type,'attack');
});

test('Master compares Pokémon Catcher to a guaranteed Knock Out and uses the chosen target on heads', async () => {
  const {runner,ai,foe,card,lightning} = setup('control','master');
  ai.active.energy = [lightning('a'),lightning('b')];
  ai.hand = [card('Pokémon Catcher')];
  const single = card('Dratini'), multi = card('Dragonite ex');
  single.meta.hp = 40; multi.meta.hp = 50;
  foe.bench = [single,multi];
  foe.active.meta.hp = 40;
  assert.equal(runner.context.chooseAiPrizeLine().type,'attack');
  foe.active.meta.hp = 200;
  const action = runner.api.aiAction();
  assert.equal(action.card.name,'Pokémon Catcher');
  assert.equal(action.targetId,multi.id);
  await runner.api.aiStep();
  assert.equal(foe.active.id,multi.id);
});

test('Balanced keeps Lightning attached when Flashing Draw would give up a Knock Out', () => {
  const {runner,ai,foe,card,lightning} = setup('balanced','competitor');
  ai.active.energy = [lightning('a'),lightning('b')];
  const kilowattrel = card("Iono's Kilowattrel");
  kilowattrel.energy = [lightning('draw-cost')];
  ai.bench = [kilowattrel];
  foe.active.meta.hp = 80;
  assert.equal(runner.api.aiAction().type,'attack');
  foe.active.meta.hp = 180;
  assert.equal(runner.api.aiAction().type,'ability');
});

test('Control commits useful Energy before disrupting a large hand with Judge', () => {
  const {runner,ai,foe,card,lightning} = setup('control','competitor');
  ai.active.energy = [lightning('a')];
  ai.hand = [card('Judge'),lightning('attach-before-judge')];
  ai.energyAttachedThisTurn = false;
  foe.hand = Array.from({length:8},(_,index) => card('Dratini','opponent-hand-'+index));
  assert.equal(runner.api.aiAction().type,'attach');
  ai.energyAttachedThisTurn = true;
  assert.equal(runner.api.aiAction().card.name,'Judge');
});

test('Balanced charges a backup Voltorb when the Active can already attack', () => {
  const {runner,ai,card,lightning} = setup('balanced','casual');
  ai.active.energy = [lightning('a'),lightning('b')];
  const backup = card("Iono's Voltorb",'backup-voltorb');
  backup.energy = [lightning('c')];
  ai.bench = [backup];
  ai.hand = [lightning('d')];
  ai.energyAttachedThisTurn = false;
  const action = runner.api.aiAction();
  assert.equal(action.type,'attach');
  assert.equal(action.target,backup);
});

test('Master discounts Thunderous Bolt when it would leave no follow-up attacker', () => {
  const {runner,ai,card,lightning} = setup('balanced','master');
  ai.active = card("Iono's Bellibolt ex");
  ai.active.energy = [lightning('a'),lightning('b'),lightning('c'),lightning('d')];
  const [attack] = ai.active.meta.attacks;
  const withoutBackup = runner.context.aiAttackScore(ai.active,attack);
  const backup = card("Iono's Voltorb",'backup-voltorb');
  backup.energy = [lightning('e'),lightning('f')];
  ai.bench = [backup];
  assert.ok(runner.context.aiAttackScore(ai.active,attack) > withoutBackup);
});

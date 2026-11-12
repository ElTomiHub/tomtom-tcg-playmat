const assert = require('node:assert/strict');
const { test } = require('node:test');
const vm = require('node:vm');
const { createEngineRunner, loadFixture } = require('./integration-harness.cjs');
const {cards: importedCards} = require('./fixtures/imported-print-batch.fixture.json');

const signature = {
  gen1: [['SV4A',192],['SVM',38]], gen2: [['SVM',77],['SVM',78]],
  gen4: [['SVM',82],['SVM',65]], gen5: [['SVM',8],['SVM',10]]
};

function setup(profile, style = 'balanced', difficulty = 'competitor') {
  const fixture = loadFixture();
  const runner = createEngineRunner(fixture,15);
  runner.api.setup(fixture,runner.random,runner.choose,() => true,{yamiStyle:style,yamiDifficulty:difficulty});
  const game = runner.api.state(), ai = game.players.codex, foe = game.players.you;
  const catalog = [...fixture.cards,...importedCards,...vm.runInContext('VERIFIED_NEW_PRINT_DETAILS',runner.context)];
  const card = (set, number, id = set+number) => {
    const found = catalog.find(candidate => candidate.setCode === set && Number(candidate.cardNumber) === number &&
      candidate.meta?.category && (candidate.meta.category !== 'Pokemon' || candidate.meta.hp));
    assert.ok(found, 'missing verified print ' + set + ' ' + number);
    return {...structuredClone(found),id,energy:[],tools:[],conditions:[],damage:0,enteredTurn:1,evolvedTurn:-1};
  };
  const energy = (type,id = type) => ({id,name:type+' Energy',meta:{category:'Energy',energyType:type}});
  game.resumeManifest.codex = signature[profile].map(print => card(...print));
  game.turn = 'codex'; game.turnNumber = 4; game.firstPlayer = 'you';
  ai.turnsTaken = 1; ai.attackedThisTurn = false; ai.energyAttachedThisTurn = true;
  ai.supporterPlayedThisTurn = false;
  ai.active = card('SVM',64);
  ai.bench = []; ai.hand = [];
  foe.active = card('OBF',161);
  foe.active.meta.hp = 210;
  foe.active.meta.weaknesses = []; foe.active.meta.resistances = [];
  foe.bench = [card('ASC',71)];
  runner.api.clearVisuals();
  assert.equal(runner.context.genAiProfile()?.id,profile);
  return {runner,game,ai,foe,card,energy};
}

test('Gen I Master converts Buzzap into a safe knockout when Competitor keeps the single-Prize trade in reserve', async () => {
  const {runner,game,ai,foe,card,energy} = setup('gen1','aggro');
  ai.active = card('SVM',38);
  ai.active.energy = [energy('Lightning','attached')];
  ai.bench = [card('VIV',46)];
  ai.deck = [card('SV4A',192),energy('Lightning','first'),energy('Lightning','second')];
  foe.active.meta.hp = 130;
  assert.equal(runner.api.aiAction().name,'Tail Whap');
  game.yamiDifficulty = 'master';
  const before = JSON.stringify(game);
  assert.equal(runner.api.aiAction().abilityName,'Buzzap Generator');
  assert.equal(JSON.stringify(game),before);
  foe.prizes = foe.prizes.slice(0,1);
  assert.equal(runner.api.aiAction().name,'Tail Whap');
  foe.prizes = [energy('Fire','prize-1'),energy('Fire','prize-2'),energy('Fire','prize-3')];
  await runner.api.aiStep();
  assert.equal(ai.active.energy.length,3);
  assert.equal(foe.prizes.length,2);
  assert.ok(ai.discard.some(card=>card.name==='Electrode'));
  assert.equal(runner.api.aiAction().name,'Thunder');
});

test('Gen I routes Gloom’s found Lightning to Pikachu to power Thunder', async () => {
  const {runner,ai,card,energy} = setup('gen1');
  ai.active = card('SVM',38);
  ai.active.energy = [energy('Lightning','attached')];
  ai.bench = [card('SV4A',191)];
  ai.hand = [card('SV4A',192)];
  ai.deck = [card('S9A',5),energy('Lightning','found-1'),energy('Lightning','found-2')];
  assert.equal(runner.api.aiAction().type,'evolve');
  await runner.api.aiStep();
  assert.equal(ai.bench[0].name,'Gloom');
  assert.equal(ai.active.energy.length,3);
});

test('Gen I applies Heracross’s printed Bench damage to the safest friendly Pokémon', async () => {
  const {runner,ai,foe,card,energy} = setup('gen1','control','master');
  ai.active = card('S9A',5);
  ai.active.energy = [energy('Grass','a'),energy('Grass','b'),energy('Grass','c')];
  const frail = card('SV4A',191), healthy = card('SV4A',193);
  frail.damage = frail.meta.hp - 20;
  ai.bench = [frail,healthy];
  const opposingBench = foe.bench[0];
  foe.active.meta.hp = 110;
  assert.equal(runner.api.aiAction().name,'Overhead Throw');
  await runner.api.aiStep();
  assert.equal(frail.damage,frail.meta.hp-20);
  assert.equal(healthy.damage,30);
  assert.equal(opposingBench.damage,0);
});

test('Gen I Control waits with Snorlax Doll and promotes a powered backup without giving away a Prize', async () => {
  const {runner,ai,foe,card,energy} = setup('gen1','control','master');
  ai.active = card('SV4K',59);
  const pikachu = card('SVM',38);
  ai.bench = [pikachu];
  assert.notEqual(runner.api.aiAction().type,'discard_doll');
  pikachu.energy = [energy('Lightning')];
  assert.equal(runner.api.aiAction().type,'discard_doll');
  const prizes = foe.prizes.length;
  await runner.api.aiStep();
  assert.equal(ai.active,pikachu);
  assert.equal(foe.prizes.length,prizes);
  assert.equal(runner.api.state().pendingPromotion,null);
});

test('Gen II Casual takes immediate damage and Competitor uses Call to Muster to power the Tyranitar line', async () => {
  const {runner,game,ai,card,energy} = setup('gen2','balanced','casual');
  ai.active = card('SVM',77);
  ai.active.energy = [energy('Darkness','active-1'),energy('Water','active-2'),energy('Water','active-3')];
  const larvitar = card('SVM',62);
  ai.bench = [larvitar];
  ai.deck = [card('SVM',78),energy('Darkness','deck-1'),energy('Water','deck-2')];
  assert.equal(runner.api.aiAction().name,'Pitch-Black Fangs');
  game.yamiDifficulty = 'competitor';
  assert.equal(runner.api.aiAction().name,'Call to Muster');
  await runner.api.aiStep();
  assert.equal(larvitar.energy.length,2);
  assert.ok(larvitar.energy.some(energy=>energy.name==='Darkness Energy'));
});

test('Gen II Competitor skips Pupitar when Rare Candy gives Tyranitar a ready attack', async () => {
  const {runner,game,ai,card,energy} = setup('gen2','balanced','casual');
  ai.active = card('SVM',62);
  ai.active.energy = [energy('Darkness'),energy('Water')];
  ai.hand = [card('SVM',63),card('SVM',78),card('MEG',125)];
  assert.equal(runner.api.aiAction().card.name,'Pupitar');
  game.yamiDifficulty = 'competitor';
  assert.equal(runner.api.aiAction().card.name,'Rare Candy');
  await runner.api.aiStep();
  assert.equal(ai.active.name,'Tyranitar ex');
  assert.equal(runner.api.aiAction().name,'Flatten');
});

test('Gen II Control discards the Lightning that powers the opposing attack after Hammer lands heads', async () => {
  const {runner,ai,foe,card,energy} = setup('gen2','control','master');
  ai.hand = [card('M5',104)];
  foe.active = card('ASC',279);
  foe.active.energy = [energy('Water','spare-1'),energy('Water','spare-2'),
    energy('Lightning','live-1'),energy('Lightning','live-2'),energy('Lightning','live-3')];
  assert.equal(runner.api.aiAction().card.name,'Crushing Hammer');
  await runner.api.aiStep();
  assert.equal(foe.active.energy.filter(card=>card.name==='Lightning Energy').length,2);
  assert.ok(foe.discard.some(card=>card.name==='Lightning Energy'));
});

test('Gen IV Competitor develops Bronzong before Lucario on the same Balanced board', () => {
  const {runner,game,ai,card} = setup('gen4','balanced','casual');
  ai.bench = [card('SVM',64,'riolu'),card('SVM',81)];
  ai.hand = [card('SVM',65),card('SVM',82)];
  assert.equal(runner.api.aiAction().card.name,'Lucario ex');
  game.yamiDifficulty = 'competitor';
  assert.equal(runner.api.aiAction().card.name,'Bronzong');
});

test('Gen IV puts Rigid Band on the Stage 1 attacker instead of the Active Basic', async () => {
  const {runner,ai,card,energy} = setup('gen4','control','competitor');
  const attacker = card('SVM',65);
  attacker.energy = [energy('Fighting'),energy('Metal')];
  ai.bench = [attacker,card('SVM',82)];
  ai.hand = [card('SVM',139)];
  assert.equal(runner.api.aiAction().targetId,attacker.id);
  await runner.api.aiStep();
  assert.equal(attacker.tools[0].name,'Rigid Band');
  assert.equal(ai.active.tools.length,0);
});

test('Gen V Aggro benches Reshiram and Balanced builds the Sunny Day line from the same hand', () => {
  const {runner,game,ai,card,energy} = setup('gen5','aggro','casual');
  ai.hand = [card('SVM',22),card('SVM',7),energy('Fire')];
  assert.equal(runner.api.aiAction().card.name,'Reshiram ex');
  game.yamiStyle = 'balanced'; game.yamiDifficulty = 'competitor';
  ai.hand.push(card('SVM',8));
  assert.equal(runner.api.aiAction().card.name,'Petilil');
});

test('Gen V Master uses sleep to reduce a visible game-ending reply while Competitor takes the damage', () => {
  const {runner,game,ai,foe,card,energy} = setup('gen5','control','competitor');
  ai.active = card('SVM',10);
  ai.active.energy = [energy('Grass'),energy('Fire')];
  ai.active.damage = 65;
  foe.active = card('OBF',159);
  foe.active.meta.hp = 240;
  foe.active.energy = [energy('Water'),energy('Lightning')];
  foe.prizes = foe.prizes.slice(0,2);
  const attack = runner.api.aiAction().name;
  assert.notEqual(attack,'Spore Ball');
  game.yamiDifficulty = 'master';
  const before = JSON.stringify(game);
  assert.equal(runner.api.aiAction().name,'Spore Ball');
  assert.equal(JSON.stringify(game),before);
});

test('Gen V Competitor keeps both Fire Energy attached when Scorching Fire can discard a spare Grass', async () => {
  const {runner,ai,foe,card,energy} = setup('gen5','balanced');
  ai.active = card('SVM',22);
  ai.active.energy = [energy('Fire','f1'),energy('Fire','f2'),energy('Grass','g1'),energy('Grass','g2')];
  foe.active.meta.hp = 250;
  const action = runner.api.aiAction();
  assert.equal(action.name,'Scorching Fire');
  assert.equal(action.discardEnergyIds.join(','),'g1');
  await runner.api.aiStep();
  assert.equal(ai.active.energy.filter(card=>card.name==='Fire Energy').length,2);
  assert.ok(ai.discard.some(card=>card.id==='g1'));
});

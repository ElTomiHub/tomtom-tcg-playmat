const assert = require('node:assert/strict');
const {test} = require('node:test');
const vm = require('node:vm');
const {createEngineRunner,loadFixture} = require('./integration-harness.cjs');

function setup(style = 'balanced', difficulty = 'competitor') {
  const fixture = loadFixture();
  const runner = createEngineRunner(fixture,15);
  runner.api.setup(fixture,runner.random,runner.choose,() => true,{yamiStyle:style,yamiDifficulty:difficulty});
  const game = runner.api.state(), ai = game.players.codex, foe = game.players.you;
  const catalog = [...fixture.cards,...vm.runInContext('VERIFIED_NEW_PRINT_DETAILS',runner.context)];
  const card = (set, number, id = set+number) => {
    const source = catalog.find(candidate=>candidate.setCode===set && Number(candidate.cardNumber)===number &&
      candidate.meta?.category && (candidate.meta.category!=='Pokemon' || candidate.meta.hp));
    assert.ok(source,'missing verified print '+set+' '+number);
    return {...structuredClone(source),id,energy:[],tools:[],conditions:[],damage:0,evolutionStack:[],enteredTurn:1,evolvedTurn:-1};
  };
  const waters = (...ids) => ids.map(id=>({id,name:'Water Energy',meta:{category:'Energy',energyType:'Water'}}));
  game.resumeManifest.codex = [card('SV2P',93),card('SV2P',77)];
  game.turn = 'codex'; game.turnNumber = 4; game.firstPlayer = 'you';
  game.vstarPowerUsed.codex = false;
  ai.turnsTaken = 1; ai.attackedThisTurn = false; ai.energyAttachedThisTurn = true;
  ai.supporterPlayedThisTurn = false;
  ai.active = card('SV2P',93);
  ai.bench = []; ai.hand = []; ai.discard = []; ai.deck = [card('SV2P',75,'draw-1'),card('SV2P',75,'draw-2')];
  foe.active = card('OBF',161);
  foe.active.meta.hp = 240; foe.active.meta.weaknesses = []; foe.active.meta.resistances = [];
  foe.bench = [card('ASC',71)];
  runner.api.clearVisuals();
  assert.equal(runner.context.hasChienPaoStrategy(),true);
  return {runner,game,ai,foe,card,waters};
}

test('Chien-Pao Aggro opens with Chien-Pao while Control can open with Palkia and Water', () => {
  const {runner,game,ai,card,waters} = setup('aggro','casual');
  const palkia = card('S10P',71);
  ai.hand = waters('opening-water');
  const score = card => runner.context.chienPaoDevelopmentScore(card,[],true);
  assert.ok(score(ai.active)>score(palkia));
  game.yamiStyle = 'control';
  assert.ok(score(palkia)>score(ai.active));
});

test('Irida fetches the Rare Candy and Baxcalibur pair ahead of Retrieval and evolves the eligible Frigibax', async () => {
  const {runner,ai,card,waters} = setup();
  ai.active.energy = waters('a','b');
  ai.bench = [card('SV2P',75)];
  ai.hand = [card('S10P',77)];
  ai.deck = [card('SV1A',64),card('S10P',71),card('M1S',82),card('SV2P',77),card('SV2P',76)];
  assert.equal(runner.api.aiAction().card.name,'Irida');
  await runner.api.aiStep();
  assert.deepEqual(Array.from(ai.hand,card=>card.name).sort(),['Baxcalibur','Rare Candy']);
  assert.equal(runner.api.aiAction().card.name,'Rare Candy');
  await runner.api.aiStep();
  assert.equal(ai.bench[0].name,'Baxcalibur');
});

test('Hail Blade accounts for Weakness and spends spare Water while keeping Chien-Pao powered', async () => {
  const {runner,ai,foe,card,waters} = setup('aggro','master');
  ai.active.energy = waters('keep-1','keep-2');
  ai.bench = [card('SV2P',77)];
  ai.bench[0].energy = waters('spare-1','spare-2');
  foe.active.meta.hp = 220;
  foe.active.meta.weaknesses = [{type:'Water',value:'×2'}];
  const state = JSON.stringify(runner.api.state());
  assert.equal(runner.api.aiAction().name,'Hail Blade');
  assert.equal(JSON.stringify(runner.api.state()),state);
  await runner.api.aiStep();
  assert.equal(foe.discard.some(card=>card.name==='Drampa'),true);
  assert.deepEqual(Array.from(ai.active.energy,card=>card.id),['keep-1','keep-2']);
  assert.deepEqual(Array.from(ai.discard,card=>card.id).sort(),['spare-1','spare-2']);
});

test('Master pivots to Palkia to save Water for the same knockout that Casual takes with Hail Blade', () => {
  const {runner,game,ai,foe,card,waters} = setup('aggro','casual');
  ai.active.energy = waters('a','b','c','d');
  const palkia = card('S12A',259);
  palkia.energy = waters('p1','p2');
  ai.bench = [palkia,card('SV2P',75),card('SV2P',77)];
  foe.bench.push(card('JTG',47),card('ASC',69));
  foe.active.meta.hp = 150;
  assert.equal(runner.api.aiAction().name,'Hail Blade');
  game.yamiDifficulty = 'master';
  const action = runner.api.aiAction();
  assert.equal(action.type,'retreat');
  assert.equal(action.target,palkia);
});

test('Master Control plans both Shuriken knockouts, including the Bench, ahead of a single Prize', async () => {
  const {runner,ai,foe,card,waters} = setup('control','master');
  ai.active = card('S12A',259);
  ai.active.energy = waters('a','b');
  const greninja = card('SVK',4);
  greninja.energy = waters('g1','g2','g3');
  ai.bench = [greninja];
  foe.active.meta.hp = 100;
  foe.bench = [card('ASC',71),card('JTG',47)];
  const before = ai.prizes.length;
  const action = runner.api.aiAction();
  assert.equal(action.type,'retreat');
  assert.equal(action.target,greninja);
  await runner.api.aiStep();
  assert.equal(runner.api.aiAction().name,'Moonlight Shuriken');
  await runner.api.aiStep();
  assert.equal(ai.prizes.length,before-2);
  assert.equal(foe.bench.length,0);
  assert.equal(foe.active.damage,0);
});

test('Master holds Star Portal when Super Cold can power an attack and spends it on a needed knockout', async () => {
  const {runner,game,ai,foe,card,waters} = setup('balanced','master');
  ai.bench = [card('SV2P',77),card('S12A',259)];
  ai.hand = waters('from-hand-1','from-hand-2','from-hand-3');
  ai.discard = waters('from-trash-1','from-trash-2','from-trash-3');
  foe.active.meta.hp = 170;
  assert.equal(runner.context.chienPaoPortalTarget(),null);
  assert.equal(runner.api.aiAction().abilityName,'Absolute Zero');
  ai.hand = [];
  assert.equal(runner.api.aiAction().abilityName,'Star Portal');
  await runner.api.aiStep();
  assert.equal(game.vstarPowerUsed.codex,true);
  assert.equal(ai.active.energy.length,3);
  assert.equal(runner.api.aiAction().name,'Hail Blade');
});

test('Trembling Cold leaves a card to draw when the last two deck cards are Water', async () => {
  const {runner,ai,waters} = setup('aggro','casual');
  ai.deck = waters('deck-water-1','deck-water-2');
  assert.equal(runner.api.aiAction().abilityName,'Trembling Cold');
  await runner.api.aiStep();
  assert.equal(ai.hand.length,1);
  assert.equal(ai.deck.length,1);
});

test('Competitor saves Superior Energy Retrieval with no setup and uses it when Baxcalibur can attach the Water', async () => {
  const {runner,ai,card,waters} = setup();
  ai.discard = waters('trash-1','trash-2','trash-3','trash-4');
  const retrieval = card('SV1A',64);
  ai.hand = [retrieval,card('PAL',183,'cost-1'),card('PAL',183,'cost-2')];
  ai.deck = waters('no-search');
  assert.equal(runner.context.chienPaoShouldRetrieve(retrieval),false);
  ai.bench = [card('SV2P',77)];
  assert.equal(runner.context.chienPaoShouldRetrieve(retrieval),true);
  assert.equal(runner.api.aiAction().card,retrieval);
  await runner.api.aiStep();
  assert.deepEqual(Array.from(ai.hand,card=>card.id).sort(),['trash-1','trash-2','trash-3','trash-4']);
  assert.equal(runner.api.aiAction().abilityName,'Absolute Zero');
});

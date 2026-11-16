const assert = require('node:assert/strict');
const {test} = require('node:test');
const vm = require('node:vm');
const {createEngineRunner,loadFixture} = require('./integration-harness.cjs');

function setup(style = 'balanced', difficulty = 'competitor') {
  const fixture = loadFixture(), runner = createEngineRunner(fixture,15);
  runner.api.setup(fixture,runner.random,runner.choose,()=>true,{yamiStyle:style,yamiDifficulty:difficulty});
  const game = runner.api.state(), ai = game.players.codex, foe = game.players.you;
  const catalog = [...fixture.cards,...vm.runInContext('VERIFIED_NEW_PRINT_DETAILS',runner.context)];
  const card = (set,number,id=set+number) => {
    const source = catalog.find(card=>card.setCode===set && Number(card.cardNumber)===number &&
      card.meta?.category && (card.meta.category!=='Pokemon' || card.meta.hp));
    assert.ok(source,'missing verified print '+set+' '+number);
    return {...structuredClone(source),id,energy:[],tools:[],conditions:[],damage:0,evolutionStack:[],enteredTurn:1,evolvedTurn:-1};
  };
  const fire = id => ({id,name:'Fire Energy',meta:{category:'Energy',energyType:'Fire'}});
  game.resumeManifest.codex = [card('SV9A',70),card('SVEL',8)];
  game.turn='codex'; game.turnNumber=4; game.firstPlayer='you'; game.stadium=null;
  game.stadiumPlayedThisTurn=false;
  ai.turnsTaken=1; ai.attackedThisTurn=false; ai.energyAttachedThisTurn=true; ai.supporterPlayedThisTurn=false;
  ai.active=card('SV9A',70); ai.active.energy=[fire('active')]; ai.bench=[]; ai.hand=[]; ai.discard=[];
  ai.deck=[card('SV9A',15,'draw-1'),card('SV9A',15,'draw-2'),card('SV9A',15,'draw-3'),card('SV9A',15,'draw-4')];
  foe.active=card('OBF',159);
  foe.active.meta.hp=240; foe.active.meta.weaknesses=[]; foe.active.meta.resistances=[];
  foe.bench=[card('ASC',71)];
  runner.api.clearVisuals();
  assert.equal(runner.context.hasEthanSkeledirgeStrategy(),true);
  return {runner,game,ai,foe,card,fire};
}

test('Aggro and Control prefer different starters when Fire can power a setup attack',()=>{
  const {runner,game,ai,card,fire}=setup('aggro','casual');
  const cyndaquil=card('SV9A',15), dunsparce=card('SVD',92);
  ai.hand=[fire('opening')];
  const rank=card=>runner.context.ethanAiDevelopment(card,[],true);
  assert.ok(rank(cyndaquil)>rank(dunsparce));
  game.yamiStyle='control';
  assert.ok(rank(dunsparce)>rank(cyndaquil));
});

test('Quilava fetches an Adventure before it evolves',async()=>{
  const {runner,ai,card}=setup();
  ai.bench=[card('SV9A',16)];
  ai.hand=[card('SV9A',70,'evolution')];
  ai.deck.push(card('SV9A',84));
  assert.equal(runner.api.aiAction().abilityName,'Bonds of the Journey');
  await runner.api.aiStep();
  assert.ok(ai.hand.some(card=>card.name==="Ethan's Adventure"));
  assert.equal(runner.api.aiAction().type,'evolve');
});

test('Competitor uses Adventure to reach a Buddy Blast knockout and finds Fire and the next evolution',async()=>{
  const {runner,ai,foe,card,fire}=setup('aggro','competitor');
  ai.bench=[card('SV9A',15)];
  ai.hand=[card('SV9A',84,'supporter')];
  ai.deck=[card('SV9A',15,'extra-basic'),card('SV9A',16),fire('search-fire'),card('SV9A',15,'draw')];
  foe.active.meta.hp=90;
  const before=JSON.stringify(runner.api.state());
  assert.equal(runner.api.aiAction().card.name,"Ethan's Adventure");
  assert.equal(JSON.stringify(runner.api.state()),before);
  await runner.api.aiStep();
  assert.ok(ai.hand.some(card=>card.id==='search-fire'));
  assert.ok(ai.hand.some(card=>card.name==="Ethan's Quilava"));
  assert.equal(runner.api.aiAction().name,'Buddy Blast');
  await runner.api.aiStep();
  assert.ok(foe.discard.some(card=>card.name==='Dragonite ex'));
});

test('Master uses two Heat Songs for a reachable knockout where Competitor takes the direct hit',async()=>{
  const {runner,game,ai,foe,card,fire}=setup('aggro','competitor');
  ai.bench=[card('SVEL',8,'song-1'),card('SVEL',8,'song-2')];
  ai.hand=[fire('fuel-1'),fire('fuel-2')];
  ai.discard=[card('SV9A',84)];
  foe.active.meta.hp=210;
  assert.equal(runner.api.aiAction().name,'Buddy Blast');
  game.yamiDifficulty='master';
  assert.equal(runner.api.aiAction().abilityName,'Explosive Heat Song');
  await runner.api.aiStep();
  assert.equal(runner.api.aiAction().abilityName,'Explosive Heat Song');
  await runner.api.aiStep();
  assert.equal(runner.api.aiAction().name,'Buddy Blast');
  await runner.api.aiStep();
  assert.ok(foe.discard.some(card=>card.name==='Dragonite ex'));
  assert.equal(ai.hand.some(card=>card.name==='Fire Energy'),false);
});

test('Master preserves Fire when Buddy Blast already has the knockout',()=>{
  const {runner,ai,foe,card,fire}=setup('aggro','master');
  ai.bench=[card('SVEL',8)];
  ai.hand=[fire('next-attacker')];
  ai.discard=[card('SV9A',84)];
  foe.active.meta.hp=90;
  assert.equal(runner.api.aiAction().name,'Buddy Blast');
});

test('Technical Machine Evolution targets the two Pokémon that can actually evolve',async()=>{
  const {runner,ai,card,fire}=setup('balanced','competitor');
  ai.active=card('SVD',92); ai.active.energy=[fire('machine-cost')];
  ai.bench=[card('SV9A',66),card('SV9A',15),card('SVD',92,'dunsparce-bench')];
  ai.hand=[card('SVP',146)];
  ai.deck.push(card('SV9A',16),card('SV5K',57));
  assert.equal(runner.api.aiAction().card.name,'Technical Machine Evolution');
  await runner.api.aiStep();
  assert.equal(runner.api.aiAction().name,'Evolution');
  await runner.api.aiStep();
  assert.deepEqual(Array.from(ai.bench,card=>card.name),['Shaymin',"Ethan's Quilava",'Dudunsparce']);
});

test('Control places Neutral Center to protect Typhlosion against a powered ex',async()=>{
  const {runner,game,ai,foe,card,fire}=setup('control','master');
  ai.hand=[card('SV6A',63)];
  foe.active.energy=[fire('opposing-fire')];
  assert.equal(runner.api.aiAction().type,'play_stadium');
  await runner.api.aiStep();
  assert.equal(game.stadium.card.name,'Neutral Center');
  const protection=runner.context.calculateAttackDamageModifiers('you','codex',ai.active,'active',180,true,true,foe.active);
  assert.equal(protection.applied,0);
});

test('Balanced recovers a Fire from Nightly Stretcher to power Typhlosion',async()=>{
  const {runner,ai,card,fire}=setup();
  ai.active.energy=[]; ai.energyAttachedThisTurn=false;
  ai.discard=[card('SV9A',66),fire('recovered')];
  ai.hand=[card('M1L',83)];
  assert.equal(runner.api.aiAction().card.name,'Nightly Stretcher');
  await runner.api.aiStep();
  const action=runner.api.aiAction();
  assert.equal(action.type,'attach');
  assert.equal(action.card.id,'recovered');
  assert.equal(action.target,ai.active);
});

test('Master uses the only Rare Candy on Skeledirge when a powered backup can evolve through Quilava',()=>{
  const {runner,game,ai,foe,card,fire}=setup('balanced','competitor');
  ai.active=card('SV9A',15,'active-basic'); ai.active.energy=[fire('active')];
  const backup=card('SV9A',15,'backup-basic'); backup.energy=[fire('backup')];
  ai.bench=[backup,card('SV1A',78)];
  ai.hand=[card('M1S',82),card('SV9A',16),card('SV9A',70),card('SVEL',8)];
  ai.deck.push(card('SVEL',6));
  ai.discard=[card('SV9A',84)];
  foe.active.meta.hp=210;
  assert.equal(runner.api.aiAction().targetId.evolutionId,'SV9A70');
  game.yamiDifficulty='master';
  assert.equal(runner.api.aiAction().targetId.evolutionId,'SVEL8');
});

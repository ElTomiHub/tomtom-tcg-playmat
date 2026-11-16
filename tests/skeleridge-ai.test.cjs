const assert = require('node:assert/strict');
const {test} = require('node:test');
const vm = require('node:vm');
const {createEngineRunner,loadFixture} = require('./integration-harness.cjs');

function setup(style = 'balanced', difficulty = 'competitor') {
  const fixture = loadFixture(), runner = createEngineRunner(fixture,15);
  runner.api.setup(fixture,runner.random,runner.choose,()=>true,{yamiStyle:style,yamiDifficulty:difficulty});
  const catalog = [...fixture.cards,...vm.runInContext('VERIFIED_NEW_PRINT_DETAILS',runner.context)];
  let nextId = 0;
  function card(set,number) {
    const source = catalog.find(item=>item.setCode===set && Number(item.cardNumber)===number && item.meta?.category);
    assert.ok(source,'Missing verified print '+set+' '+number);
    const copy = {...structuredClone(source),id:'skeleridge-test-'+ ++nextId,energy:[],tools:[],conditions:[],
      damage:0,evolutionStack:[],enteredTurn:1,evolvedTurn:-1};
    runner.api.repairMetadata(copy);
    return copy;
  }
  const fire = () => ({id:'skeleridge-fire-'+ ++nextId,name:'Fire Energy',meta:{category:'Energy',energyType:'Fire'}});
  const game = runner.api.state(), ai = game.players.codex, foe = game.players.you;
  game.resumeManifest.codex = [card('SVEL',4),card('SVEL',8)];
  game.turn = 'codex';
  game.turnNumber = 4;
  game.firstPlayer = 'you';
  game.stadium = null;
  game.stadiumPlayedThisTurn = false;
  game.stadiumUsage = {};
  ai.turnsTaken = 1;
  ai.attackedThisTurn = false;
  ai.energyAttachedThisTurn = true;
  ai.supporterPlayedThisTurn = false;
  ai.retreatedThisTurn = false;
  ai.active = card('SVEL',4);
  ai.active.energy = [fire()];
  ai.bench = [];
  ai.hand = [];
  ai.discard = [];
  ai.deck = Array.from({length:12},fire);
  foe.active = card('OBF',159);
  foe.active.meta.hp = 300;
  foe.active.meta.weaknesses = [];
  foe.active.meta.resistances = [];
  foe.bench = [card('ASC',71)];
  runner.api.clearVisuals();
  assert.equal(runner.context.hasSkeleridgeStrategy(),true);
  return {runner,game,ai,foe,card,fire};
}

test('Skeleridge EX matches verified effects, receives a badge, and keeps the Ethan strategy separate',()=>{
  const {runner,game,card} = setup();
  runner.context.manifest = game.resumeManifest.codex;
  const badge = vm.runInContext('registeredCards.push(...manifest); deckStrategyBadge({}, {valid:true,cards:manifest})',runner.context);
  assert.match(badge,/>Strategy<\/span>/);
  const altered = card('SVEL',4);
  altered.meta.attacks[0].effect += ' Draw a card.';
  game.resumeManifest.codex = [altered,card('SVEL',8)];
  assert.equal(runner.context.hasSkeleridgeStrategy(),false);
  game.resumeManifest.codex = [...runner.context.manifest,card('SV9A',70)];
  assert.equal(runner.context.hasSkeleridgeStrategy(),false);
  assert.equal(runner.context.hasEthanSkeledirgeStrategy(),true);
});

for (const [style,difficulty] of [['aggro','casual'],['balanced','competitor'],['control','master']]) {
  test(style+' '+difficulty+' uses Magma Basin before Rare Candy and preserves the attached Fire',async()=>{
    const {runner,game,ai,card,fire} = setup(style,difficulty);
    const fuecoco = card('SVEL',5), rotom = card('SVEL',3), acceleration = fire();
    fuecoco.energy = [fire()];
    ai.bench = [rotom,fuecoco];
    ai.discard = [acceleration];
    ai.hand = [card('SVEL',8),card('M1S',82),card('S9',127)];
    ai.deck.push(card('SVEL',6));

    assert.equal(runner.api.aiAction().type,'play_stadium');
    await runner.api.aiStep();
    assert.equal(game.stadium.card.name,'Magma Basin');
    assert.equal(runner.api.aiAction().type,'stadium');
    await runner.api.aiStep();
    assert.equal(fuecoco.energy.at(-1),acceleration);
    assert.equal(fuecoco.damage,20);
    assert.equal(rotom.energy.length,0);
    assert.equal(runner.api.aiAction().card.name,'Rare Candy');
    await runner.api.aiStep();
    assert.equal(ai.bench[1].name,'Skeledirge ex');
    assert.equal(ai.bench[1].energy.length,2);
    assert.ok(ai.bench[1].energy.includes(acceleration));
  });
}

test('Dual Turbo assigns Fire to two useful distinct targets, including Metal Skeledirge ex',async()=>{
  const {runner,ai,card,fire} = setup();
  const mew = card('S12A',183), skeledirge = card('SVEL',8), fuecoco = card('SVEL',5);
  ai.bench = [mew,skeledirge,fuecoco];
  ai.discard = [fire(),fire()];
  assert.equal(runner.api.aiAction().name,'Dual Turbo');
  await runner.api.aiStep();
  assert.equal(mew.energy.length,0);
  assert.equal(skeledirge.energy.length,1);
  assert.equal(fuecoco.energy.length,1);
  assert.notEqual(skeledirge.energy[0].id,fuecoco.energy[0].id);
});

for (const [style,difficulty,hp,songs] of [
  ['aggro','casual',160,0],['aggro','casual',270,2],['balanced','competitor',210,1],
  ['control','master',270,2],['control','master',300,0]
]) {
  test(style+' '+difficulty+' spends '+songs+' Heat Songs against '+hp+' HP',async()=>{
    const {runner,ai,foe,card,fire} = setup(style,difficulty);
    ai.active = card('SVEL',8);
    ai.active.energy = [fire(),fire()];
    ai.bench = [card('SVEL',8)];
    ai.hand = [fire(),fire()];
    foe.active.meta.hp = hp;
    const before = JSON.stringify(runner.api.state());
    for (let i=0;i<songs;i++) {
      assert.equal(runner.api.aiAction().abilityName,'Explosive Heat Song');
      if (i===0) assert.equal(JSON.stringify(runner.api.state()),before);
      await runner.api.aiStep();
    }
    assert.equal(runner.api.aiAction().name,'Luster Burn');
    assert.equal(ai.hand.filter(card=>card.name==='Fire Energy').length,2-songs);
    assert.equal(ai.discard.filter(card=>card.name==='Fire Energy').length,songs);
  });
}

test('Mysterious Tail takes the Rare Candy that completes the evolution',async()=>{
  const {runner,ai,card} = setup();
  ai.active = card('S12A',183);
  ai.bench = [card('SVEL',5)];
  ai.hand = [card('SVEL',8)];
  const candy = card('M1S',82), switchCard = card('M6A',103);
  ai.deck.push(candy,switchCard);
  assert.equal(runner.api.aiAction().abilityName,'Mysterious Tail');
  await runner.api.aiStep();
  assert.ok(ai.hand.includes(candy));
  assert.ok(ai.deck.includes(switchCard));
});

test('Pokégear prioritizes Nemona when Professor’s Research would discard an evolution piece',async()=>{
  const {runner,ai,card} = setup();
  ai.bench = [card('SVEL',5)];
  const candy = card('M1S',82), gear = card('SVP',247), nemona = card('SV4A',351), research = card('S8A',29);
  ai.hand = [candy,gear];
  ai.deck.push(nemona,research);
  assert.equal(runner.api.aiAction().card.name,'Pokegear');
  await runner.api.aiStep();
  assert.ok(ai.hand.includes(nemona));
  assert.ok(ai.hand.includes(candy));
  assert.ok(ai.deck.includes(research));
});

test('Ultra Ball converts spare Fire into setup fuel while preserving Rare Candy',async()=>{
  const {runner,ai,card,fire} = setup('aggro','competitor');
  ai.bench = [card('SVEL',5),card('S12A',183)];
  const candy = card('M1S',82), excess = fire(), other = fire();
  ai.hand = [card('M2A',216),candy,excess,other,card('S12A',183)];
  const evolution = card('SVEL',8);
  ai.deck.push(evolution,card('SVEL',1));
  assert.equal(runner.api.aiAction().card.name,'Ultra Ball');
  await runner.api.aiStep();
  assert.ok(ai.hand.includes(candy));
  assert.ok(ai.hand.includes(evolution));
  assert.ok(ai.discard.some(card=>card===excess || card===other));
  assert.ok(ai.hand.some(card=>card===excess || card===other));
});

test('Master pivots to a single-Prize attacker for a reachable Knock Out in Control',async()=>{
  const {runner,ai,foe,card,fire} = setup('control','master');
  ai.active = card('SVEL',8);
  ai.active.energy = [fire(),fire()];
  const magmortar = card('SVEL',2);
  magmortar.energy = [fire(),fire(),fire()];
  ai.bench = [magmortar];
  const swap = card('M6A',103);
  ai.hand = [fire(),swap];
  foe.active.meta.hp = 230;
  const next = runner.api.aiAction();
  assert.equal(next.card,swap);
  assert.equal(next.targetId,magmortar.id);
  await runner.api.aiStep();
  assert.equal(ai.active,magmortar);
  assert.equal(runner.api.aiAction().abilityName,'Explosive Heat Song');
  await runner.api.aiStep();
  assert.equal(runner.api.aiAction().name,'Volcanic Heat');
});

test('Control Master holds Basin when it would mostly accelerate the opponent',()=>{
  const {runner,ai,foe,card,fire} = setup('control','master');
  ai.bench = [card('SVEL',5)];
  ai.hand = [card('S9',127)];
  ai.discard = [fire()];
  foe.bench = [card('SVEL',4)];
  foe.discard = [fire()];
  assert.notEqual(runner.api.aiAction().type,'play_stadium');
});

test('Superior Energy Retrieval funds a future attachment and Heat Song without discarding the Candy',async()=>{
  const {runner,ai,card,fire} = setup('balanced','master');
  ai.bench = [card('SVEL',5)];
  const candy = card('M1S',82), recovery = card('SVJP',10);
  const recovered = [fire(),fire(),fire()];
  ai.discard = recovered.slice();
  ai.hand = [candy,recovery,card('SV4A',351),card('SV4A',351)];
  assert.equal(runner.api.aiAction().card,recovery);
  await runner.api.aiStep();
  assert.ok(ai.hand.includes(candy));
  for (const energy of recovered) assert.ok(ai.hand.includes(energy));
});

test('Control uses Iono when it shrinks a larger opposing hand',async()=>{
  const {runner,ai,foe,card,fire} = setup('control','competitor');
  const iono = card('SV2D',96);
  ai.hand = [iono];
  foe.hand = Array.from({length:7},fire);
  foe.prizes = foe.prizes.slice(0,2);
  assert.equal(runner.api.aiAction().card,iono);
  await runner.api.aiStep();
  assert.equal(foe.hand.length,2);
});

test('a Knock Out can promote a replacement while the Skeledirge deck has an empty Active Spot',()=>{
  const {runner,ai,card,fire}=setup();
  ai.active=null;
  ai.bench=[card('SVEL',4),card('SVEL',8)];
  ai.bench[0].energy=[fire()];
  ai.discard=[fire()];
  vm.runInContext('engineTestHooks.choose=null;',runner.context);
  assert.equal(runner.context.promoteCodexAfterKnockout(),true);
  assert.ok(ai.active);
  assert.equal(ai.bench.length,1);
});

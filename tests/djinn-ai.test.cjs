const assert = require('node:assert/strict');
const {test} = require('node:test');
const vm = require('node:vm');
const {createEngineRunner,loadFixture} = require('./integration-harness.cjs');

function setup(style = 'balanced', difficulty = 'competitor') {
  const fixture = loadFixture(), runner = createEngineRunner(fixture,15);
  runner.api.setup(fixture,runner.random,runner.choose,()=>true,{yamiStyle:style,yamiDifficulty:difficulty});
  const catalog = [...fixture.cards,...vm.runInContext('VERIFIED_NEW_PRINT_DETAILS',runner.context)];
  const game = runner.api.state(), ai = game.players.codex, foe = game.players.you;
  let nextId = 0;
  function card(set,number) {
    const source = catalog.find(item=>item.setCode===set && Number(item.cardNumber)===number);
    assert.ok(source,'Missing verified print '+set+' '+number);
    const copy = {...structuredClone(source),id:'djinn-test-'+ ++nextId,energy:[],tools:[],conditions:[],
      damage:0,evolutionStack:[],enteredTurn:1,evolvedTurn:-1};
    runner.api.repairMetadata(copy);
    return copy;
  }
  function energy(type) {
    return {id:'djinn-energy-'+ ++nextId,name:type+' Energy',meta:{category:'Energy',energyType:type}};
  }
  const tornado = () => card('M6',59), thunder = () => card('M6',25);
  const land = () => card('M6',40), love = () => card('M6',83);
  const fullBoard = () => {
    ai.active = tornado();
    ai.bench = [thunder(),land(),love()];
  };
  game.resumeManifest.codex = [tornado(),thunder(),land(),love()];
  game.turn = 'codex';
  game.turnNumber = 4;
  game.firstPlayer = 'you';
  game.stadium = null;
  ai.turnsTaken = 1;
  ai.attackedThisTurn = false;
  ai.energyAttachedThisTurn = true;
  ai.supporterPlayedThisTurn = false;
  ai.retreatedThisTurn = false;
  ai.active = tornado();
  ai.bench = [];
  ai.hand = [];
  ai.discard = [];
  ai.deck = Array.from({length:9},()=>energy('Psychic'));
  foe.active = card('ASC',279);
  foe.active.meta.hp = 280;
  foe.active.meta.weaknesses = [];
  foe.active.meta.resistances = [];
  foe.bench = [card('ASC',71)];
  runner.api.clearVisuals();
  assert.equal(runner.context.hasDjinnStrategy(),true);
  return {runner,game,ai,foe,card,energy,tornado,thunder,land,love,fullBoard};
}

test('4 Seasons Djin matches by exact core effects and gets a Strategy badge',()=>{
  const {runner,game,card,land} = setup();
  runner.context.manifest = game.resumeManifest.codex;
  runner.context.testGloria = card('S8B',276);
  const badge = vm.runInContext(`
    registeredCards.push(...manifest,testGloria);
    const parsed = {valid:true,cards:[...manifest,testGloria]};
    deckStrategyBadge({},parsed);
  `,runner.context);
  assert.match(badge,/>Strategy<\/span>/);
  const altered = land();
  altered.meta.abilities[0].effect += ' Draw a card.';
  game.resumeManifest.codex = [...game.resumeManifest.codex.filter(item=>item.name!=='Landorus'),altered];
  assert.equal(runner.context.hasDjinnStrategy(),false);
});

for (const [style,difficulty] of [['aggro','casual'],['balanced','competitor'],['control','master']]) {
  test(style+' '+difficulty+' uses Gloria to complete four distinct Djinn and pays no Energy for Corkscrew Dive',async()=>{
    const {runner,ai,thunder,land,love,card} = setup(style,difficulty);
    ai.deck.unshift(love(),love(),land(),thunder());
    ai.hand = [card('S8B',276)];
    assert.equal(runner.api.aiAction().card?.name,'Gloria');
    await runner.api.aiStep();
    assert.deepEqual(Array.from(ai.bench,item=>item.name).sort(),['Enamorus','Landorus','Thundurus']);
    assert.equal(runner.api.aiAction().name,'Corkscrew Dive');
    assert.equal(ai.active.energy.length,0);
  });
}

test('Nest Ball picks a missing species ahead of a duplicate',async()=>{
  const {runner,ai,thunder,land,love,card} = setup();
  ai.bench = [thunder(),land()];
  ai.deck.unshift(land(),thunder(),love());
  ai.hand = [card('SVLS',13)];
  assert.equal(runner.api.aiAction().card?.name,'Nest Ball');
  await runner.api.aiStep();
  assert.equal(ai.bench.at(-1).name,'Enamorus');
});

test('Sonia finds a missing fourth species with two Bench Pokémon and can find typed Energy after setup',async()=>{
  const {runner,ai,thunder,land,love,card,energy} = setup();
  ai.bench = [thunder(),land()];
  ai.deck.unshift(land(),love());
  ai.hand = [card('S1A',77)];
  await runner.api.aiStep();
  assert.deepEqual(Array.from(ai.hand,item=>item.name),['Enamorus']);
  await runner.api.aiStep();
  assert.equal(ai.bench.at(-1).name,'Enamorus');

  ai.supporterPlayedThisTurn = false;
  ai.hand = [card('S1A',77)];
  ai.active = ai.bench.pop();
  ai.bench.push(card('M6',59));
  ai.active.energy = [energy('Psychic')];
  ai.deck = [energy('Lightning'),energy('Fighting'),energy('Psychic'),energy('Psychic'),card('M6',83)];
  await runner.api.aiStep();
  const names = Array.from(ai.hand,item=>item.name);
  assert.equal(names.length,2);
  assert.equal(names.filter(name=>name==='Psychic Energy').length,1);
  assert.ok(names.every(name=>name.endsWith('Energy')));
});

test('Balanced puts typed Energy on a backup when Tornadus already attacks for free',()=>{
  const {runner,ai,fullBoard,energy} = setup();
  fullBoard();
  ai.energyAttachedThisTurn = false;
  ai.hand = [energy('Psychic'),energy('Fighting')];
  const choice = runner.api.aiAction();
  assert.equal(choice.type,'attach');
  assert.equal(choice.target.name,choice.card.name==='Psychic Energy' ? 'Enamorus' : 'Landorus');
  assert.ok(runner.api.aiEnergyScore(ai.hand[0],ai.active)<=0);
});

test('a second Luminous Energy cannot be scored as Psychic on Enamorus',()=>{
  const {runner,ai,fullBoard,card,energy} = setup('aggro','master');
  fullBoard();
  const enamorus = ai.bench.at(-1);
  enamorus.energy = [card('SVK',44)];
  const second = card('SVK',44);
  assert.ok(runner.api.aiEnergyScore(second,enamorus)<0);
  assert.ok(runner.api.aiEnergyScore(energy('Psychic'),enamorus)>0);
});

test('Control recovers a missing Djinn from the discard with Super Rod before searching again',async()=>{
  const {runner,ai,thunder,land,love,card,energy} = setup('control','master');
  ai.bench = [thunder(),land()];
  ai.discard = [energy('Psychic'),land(),love()];
  ai.hand = [card('SVG',32),card('SVLS',13)];
  assert.equal(runner.api.aiAction().card?.name,'Super Rod');
  await runner.api.aiStep();
  assert.ok(ai.deck.some(item=>item.name==='Enamorus'));
  assert.ok(ai.discard.some(item=>item.name==='Landorus'));
  assert.equal(runner.api.aiAction().card?.name,'Nest Ball');
  await runner.api.aiStep();
  assert.equal(ai.bench.at(-1).name,'Enamorus');
});

test('Control chooses Landorus to remove an opposing Stadium when Tornadus has a full hand',async()=>{
  const {runner,game,ai,fullBoard,card,energy} = setup('control','competitor');
  fullBoard();
  game.stadium = {owner:'you',card:card('JTG',150)};
  ai.bench.find(pokemon=>pokemon.name==='Landorus').energy = [energy('Fighting')];
  ai.hand = [card('MEG',130),...Array.from({length:5},()=>energy('Psychic'))];
  const action = runner.api.aiAction();
  assert.equal(action.card?.name,'Switch');
  await runner.api.aiStep();
  assert.equal(ai.active.name,'Landorus');
  assert.equal(runner.api.aiAction().name,'Gaia Crush');
  await runner.api.aiStep();
  assert.equal(game.stadium,null);
});

test('Master transfers spare Psychic Energy, then pivots to Enamorus for a Knock Out',async()=>{
  const {runner,ai,foe,fullBoard,card,energy} = setup('aggro','master');
  fullBoard();
  const spare = energy('Psychic');
  ai.active.energy = [spare];
  const enamorus = ai.bench.at(-1);
  enamorus.energy = [energy('Psychic')];
  foe.active.meta.hp = 200;
  ai.hand = [card('M5',103),card('MEG',130)];
  const before = JSON.stringify(runner.api.state());
  const move = runner.api.aiAction();
  assert.equal(move.card?.name,'Energy Switch');
  assert.equal(move.targetId.energyId,spare.id);
  assert.equal(move.targetId.destinationId,enamorus.id);
  assert.equal(JSON.stringify(runner.api.state()),before);
  await runner.api.aiStep();
  assert.equal(runner.api.aiAction().card?.name,'Switch');
  await runner.api.aiStep();
  assert.equal(runner.api.aiAction().name,'Rising Heart');
});

test('Master sees Brave Bangle changes the Prize line against an ex',async()=>{
  const {runner,ai,foe,fullBoard,card,energy} = setup('balanced','master');
  fullBoard();
  const enamorus = ai.bench.pop();
  ai.bench.push(ai.active);
  ai.active = enamorus;
  ai.active.energy = [energy('Psychic'),energy('Psychic')];
  foe.active.meta.hp = 230;
  ai.hand = [card('MP',74)];
  const before = JSON.stringify(runner.api.state());
  const action = runner.api.aiAction();
  assert.equal(action.card?.name,'Brave Bangle');
  assert.equal(action.targetId,enamorus.id);
  assert.equal(JSON.stringify(runner.api.state()),before);
  await runner.api.aiStep();
  assert.equal(runner.api.aiAction().name,'Rising Heart');
});

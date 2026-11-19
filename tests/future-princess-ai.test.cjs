const assert = require('node:assert/strict');
const {test} = require('node:test');
const vm = require('node:vm');
const {createEngineRunner,loadFixture} = require('./integration-harness.cjs');

function setup() {
  const fixture = loadFixture();
  const runner = createEngineRunner(fixture,31);
  runner.api.setup(fixture,runner.random,runner.choose,()=>true);
  const make = (name,setCode,cardNumber) => {
    const card = {id:setCode+'-'+cardNumber,name,setCode,cardNumber,damage:0,energy:[],tools:[],conditions:[]};
    runner.api.repairMetadata(card);
    return card;
  };
  Object.assign(runner.context,{
    gardevoir:make('Mega Gardevoir ex','M1S','87'),
    valiant:make('Iron Valiant ex','SV4M','89'),
    flutter:make('Flutter Mane','SV8','59'),
    ralts:{id:'ralts',name:'Ralts',energy:[],tools:[],meta:{category:'Pokemon',stage:'Basic',types:['Psychic']}},
    booster:make('Future Booster Energy Capsule','SV4M','62'),
    foeCard:make("Team Rocket's Porygon",'SV10','81'),
    swap:{name:'Switch',setCode:'MEG',cardNumber:'130',language:'en',id:'switch',meta:{
      category:'Trainer',trainerType:'Item',language:'en',effect:'Switch your Active Pokémon with 1 of your Benched Pokémon.'
    }},
    psychic:{name:'Psychic Energy',id:'psychic',meta:{category:'Energy',energyType:'Psychic'}}
  });
  const run = code=>vm.runInContext(code,runner.context);
  run([
    "game.resumeManifest={codex:[gardevoir,valiant,flutter,ralts]}",
    "game.phase='play'; game.turn='codex'; game.turnNumber=4; game.firstPlayer='you'",
    "player('codex').turnsTaken=2",
    "player('codex').active=gardevoir; player('codex').bench=[valiant,flutter,ralts]",
    "player('codex').deck=Array.from({length:4},(_,i)=>({...psychic,id:'energy-'+i}))",
    "player('you').active=foeCard; player('you').bench=[]",
    "gardevoir.energy=[psychic]"
  ].join(';'));
  return {run,runner,make};
}

test('Future Princess detects exact core effects and changes board priorities by style', () => {
  const {run} = setup();
  assert.equal(run('stageTwoAiProfile()'),'future_princess');
  assert.equal(run('stageTwoAiProfile([gardevoir,flutter])'),null);
  assert.equal(run('game.yamiStyle="aggro"; stageTwoAiDevelopment(ralts,[])>stageTwoAiDevelopment(flutter,[])'),true);
  assert.equal(run('game.yamiStyle="control"; stageTwoAiDevelopment(flutter,[ralts],true)>stageTwoAiDevelopment(ralts,[ralts],true)'),true);
});

test('Yami uses Wishes to build the board and takes a Knock Out with Mega Symphonia when ready', () => {
  const {run} = setup();
  run('game.yamiStyle="balanced"; game.yamiDifficulty="competitor"');
  assert.equal(run('futureAiWishesCount()'),3);
  assert.ok(run('stageTwoAiEnergyScore(psychic,ralts,0)')>0);
  assert.equal(run('aiAttackScore(gardevoir,gardevoir.meta.attacks[0])>aiAttackScore(gardevoir,gardevoir.meta.attacks[1])'),true);
  run('flutter.energy=[{...psychic,id:"extra"}]');
  assert.equal(run('aiAttackScore(gardevoir,gardevoir.meta.attacks[1])>=1000'),true);
  assert.equal(run('player("codex").deck=player("codex").deck.slice(0,1); futureAiWishesCount()'),0);
});

test('Master uses Switch for a Tachyon Knock Out and retreats Valiant into its better attacker', () => {
  const {run} = setup();
  run('game.yamiStyle="control"; game.yamiDifficulty="master"; player("you").bench=[{...foeCard,id:"bench-foe",damage:foeCard.meta.hp-20}]; player("codex").prizes=player("codex").prizes.slice(0,1); player("codex").hand=[swap]');
  assert.equal(run('futureAiPivot()?.targetId'),run('valiant.id'));
  run('player("you").bench=[]; player("codex").active=valiant; player("codex").bench=[gardevoir,flutter,ralts]; valiant.tools=[booster]; player("codex").hand=[]; ralts.energy=[{...psychic,id:"extra"}]');
  assert.equal(run('futureAiPivot()?.type'),'retreat');
  assert.equal(run('futureAiPivot()?.target.id'),run('gardevoir.id'));
});

test('Peonia priorities adapt to the missing setup, playstyle and difficulty without reading Prize identities',()=>{
  const {run,runner,make} = setup();
  runner.context.peonia = make('Peonia','S6K','82');
  run("player('codex').active=flutter; player('codex').bench=[ralts,valiant]; player('codex').hand=[peonia]; game.yamiStyle='balanced'");
  const casual = run("game.yamiDifficulty='casual'; aiSupporterScore(peonia)");
  const competitor = run("game.yamiDifficulty='competitor'; aiSupporterScore(peonia)");
  const master = run("game.yamiDifficulty='master'; aiSupporterScore(peonia)");
  assert.ok(master>competitor && competitor>casual);
  const control = run("game.yamiStyle='control'; aiSupporterScore(peonia)");
  const aggro = run("game.yamiStyle='aggro'; aiSupporterScore(peonia)");
  assert.notEqual(control,aggro);
  const before = run('aiSupporterScore(peonia)');
  run("player('codex').prizes=player('codex').prizes.map((item,index)=>({...item,id:'hidden-'+index,name:'Unknown '+index}))");
  assert.equal(run('aiSupporterScore(peonia)'),before);
  run("player('codex').active=gardevoir; player('codex').bench=[flutter,valiant]; player('codex').hand=[peonia,swap]");
  assert.equal(run('aiSupporterScore(peonia)'),3);
});

test('Peonia replacement and Refine keep the final Psychic Energy and usable setup pieces',()=>{
  const {run,runner} = setup();
  const fixture = loadFixture();
  runner.context.candy = {...fixture.cards.find(card=>card.name==='Rare Candy'),id:'candy'};
  run("game.yamiDifficulty='master'; game.yamiStyle='control'; player('codex').active=flutter; player('codex').bench=[ralts,valiant]; player('codex').energyAttachedThisTurn=false");
  run("player('codex').hand=[gardevoir,candy,swap,psychic,{id:'junk-a',name:'Unused card',meta:{}},{id:'junk-b',name:'Other unused card',meta:{}}]");
  assert.deepEqual(Array.from(run("futureAiPrizeReturns(player('codex').hand,2).map(card=>card.id)")),['junk-a','junk-b']);
  run("player('codex').hand=[gardevoir,candy,...Array.from({length:4},(_,i)=>({...psychic,id:'psychic-'+i}))]");
  assert.equal(run("futureAiPrizeReturns(player('codex').hand,3).filter(card=>basicEnergyHasType(card,'psychic')).length"),3);
  assert.notEqual(run("futureAiRefineDiscard([psychic,gardevoir]).id"),'psychic');
});

test('Moonlight Hill conserves the last attachment and uses healing thresholds by style and difficulty',()=>{
  const {run,runner,make} = setup();
  runner.context.hill = make('Moonlight Hill','SVP','95');
  run("game.yamiDifficulty='master'; game.yamiStyle='balanced'; player('codex').hand=[psychic]; player('codex').energyAttachedThisTurn=false; gardevoir.damage=30");
  assert.equal(run('futureAiHealingPlan(hill)'),null);
  run("player('codex').energyAttachedThisTurn=true");
  assert.ok(run('futureAiHealingPlan(hill)?.score')>0);
  run("game.yamiStyle='aggro'");
  assert.equal(run('futureAiHealingPlan(hill)'),null);
  run("game.yamiStyle='control'");
  assert.ok(run('futureAiHealingPlan(hill)?.score')>0);
  run("gardevoir.damage=1; game.yamiDifficulty='casual'");
  assert.ok(run('futureAiHealingPlan(hill)?.score')>0);
  run("game.yamiDifficulty='master'");
  assert.equal(run('futureAiHealingPlan(hill)'),null);
});

test('Master attaches its only Psychic Energy before considering Refine or Moonlight Hill',()=>{
  const {run,runner,make} = setup();
  runner.context.kirlia = make('Kirlia','SVF','7');
  runner.context.hill = make('Moonlight Hill','SVP','95');
  run("game.yamiDifficulty='master'; game.yamiStyle='balanced'; player('codex').active=flutter; player('codex').bench=[kirlia,valiant,ralts]; player('codex').hand=[psychic]; player('codex').energyAttachedThisTurn=false; flutter.damage=30; game.stadium={card:hill,owner:'codex'}; player('you').active.meta.hp=500");
  assert.equal(run('chooseLocalAiAction()?.type'),'attach');
});

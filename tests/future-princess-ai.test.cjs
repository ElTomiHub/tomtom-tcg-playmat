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
  return {run};
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

const assert = require('node:assert/strict');
const {test} = require('node:test');
const vm = require('node:vm');
const {createEngineRunner, loadFixture} = require('./integration-harness.cjs');

const prints = [
  [
    "Team Rocket's Murkrow",
    "SV10",
    "106"
  ],
  [
    "Team Rocket's Honchkrow",
    "M2A",
    "103"
  ],
  [
    "Team Rocket's Porygon",
    "SV10",
    "81"
  ],
  [
    "Team Rocket's Porygon2",
    "SV10",
    "82"
  ],
  [
    "Team Rocket's Articuno",
    "M2A",
    "34"
  ],
  [
    "Team Rocket's Petrel",
    "SV10",
    "122"
  ],
  [
    "Team Rocket's Archer",
    "SV10",
    "120"
  ],
  [
    "Team Rocket's Proton",
    "SV10",
    "123"
  ],
  [
    "Team Rocket's Ariana",
    "SV10",
    "128"
  ],
  [
    "Team Rocket's Giovanni",
    "SV10",
    "129"
  ],
  [
    "Roto-Stick",
    "SVP",
    "160"
  ],
  [
    "Team Rocket's Receiver",
    "M2A",
    "217"
  ],
  [
    "Lucky Helmet",
    "SV5A",
    "60"
  ],
  [
    "Team Rocket's Factory",
    "M2A",
    "190"
  ],
  [
    "Ignition Energy",
    "M2",
    "109"
  ],
  [
    "Team Rocket's Energy",
    "MC",
    "742"
  ],
  [
    "Galarian Zigzagoon",
    "S4A",
    "277"
  ],
  [
    "Galarian Linoone",
    "S4A",
    "278"
  ],
  [
    "Galarian Obstagoon",
    "M2A",
    "209"
  ],
  [
    "Rufflet",
    "SI",
    "351"
  ],
  [
    "Rufflet",
    "SV11W",
    "156"
  ],
  [
    "Braviary",
    "SV7A",
    "76"
  ],
  [
    "Mimikyu",
    "SV4A",
    "341"
  ],
  [
    "Daisy's Help",
    "SV2A",
    "198"
  ],
  [
    "Hiding Darkness Energy",
    "SP",
    "154"
  ],
  [
    "Telepath Psychic Energy",
    "M3",
    "79"
  ]
];
test('new deck prints match their exact metadata and supported effects', () => {
  const fixture = loadFixture();
  const runner = createEngineRunner(fixture,17);
  runner.api.setup(fixture,runner.random,runner.choose,()=>true);
  for (const [name,setCode,cardNumber] of prints) {
    const card = {id:setCode+'-'+cardNumber,name,setCode,cardNumber,energy:[],tools:[]};
    runner.api.repairMetadata(card);
    assert.ok(card.meta?.image,name+' '+setCode+' '+cardNumber);
    runner.context.print = card;
    const support = vm.runInContext('effectSupportFor(print)',runner.context);
    assert.equal(support,'automatic',name+' '+setCode+' '+cardNumber);
  }
});

test('Team Rocket Energy pays Psychic and Darkness and Ignition Energy scales with evolution', () => {
  const fixture = loadFixture();
  const runner = createEngineRunner(fixture,17);
  runner.api.setup(fixture,runner.random,runner.choose,()=>true);
  const make = (name,setCode,cardNumber) => {
    const card = {id:setCode+'-'+cardNumber,name,setCode,cardNumber,energy:[],tools:[]};
    runner.api.repairMetadata(card);
    return card;
  };
  const rocket = make("Team Rocket's Energy",'MC','742');
  const ignition = make('Ignition Energy','M2','109');
  const basic = make("Team Rocket's Porygon",'SV10','81');
  const evolved = make("Team Rocket's Porygon2",'SV10','82');
  const supporter = make("Team Rocket's Proton",'SV10','123');
  Object.assign(runner.context,{rocket,ignition,basic,evolved,supporter});
  const run = code => vm.runInContext(code,runner.context);
  assert.deepEqual(Array.from(run('energyUnitsForPokemon(rocket,basic)')),['psychic-darkness','psychic-darkness']);
  assert.equal(run('energyUnitsForPokemon(rocket,{name:"Rufflet",meta:{category:"Pokemon"}}).length'),0);
  assert.equal(run('energyUnitsForPokemon(ignition,basic).length'),1);
  assert.equal(run('energyUnitsForPokemon(ignition,evolved).length'),3);
  assert.equal(run('evolved.energy=[rocket]; canPayAttack(evolved,{cost:["Psychic","Darkness"]})'),true);
  assert.equal(run('canPayAttack(evolved,{cost:["Fire"]})'),false);
  assert.equal(run('player("you").active=evolved; player("you").discard=[supporter]; calculateAttackDamageBeforeModifiers("you",evolved,evolved.meta.attacks.find(move=>move.name==="R Command"))'),20);
});

test('the legacy Hiding Darkness Energy entry resolves to the Japanese promo', () => {
  const fixture = loadFixture();
  const runner = createEngineRunner(fixture,17);
  const legacy = {id:'legacy',name:'Hiding Darkness Energy PR-SW 154',categoryHint:'Energy',meta:null};
  runner.api.loadSavedLibrary([legacy]);
  const restored = runner.api.libraryAudit().find(card => card.id === 'print:SP:154');
  assert.equal(restored?.status,'implemented');
  runner.context.legacy = legacy;
  runner.api.repairMetadata(legacy);
  assert.equal(legacy.id,'print:SP:154');
  assert.match(legacy.meta.image,/038910_E_HAIDOAKUENERUGI/);
  assert.equal(vm.runInContext('effectSupportFor(legacy)',runner.context),'automatic');
  assert.equal(vm.runInContext('parseDeck("1 Hiding Darkness Energy PR-SW 154",{allocateIds:false}).cards[0].setCode',runner.context),'SP');
  assert.equal(vm.runInContext('parseDeck("1 Other Energy PR-SW 154",{allocateIds:false}).cards[0].setCode',runner.context),null);
});

test('Resist Veil stops placed counters and forced switches while preserving attack damage', async () => {
  const fixture = loadFixture();
  const runner = createEngineRunner(fixture,17);
  runner.api.setup(fixture,runner.random,runner.choose,()=>true);
  const make = (name,setCode,cardNumber) => {
    const card = {id:setCode+'-'+cardNumber,name,setCode,cardNumber,damage:0,energy:[],tools:[],conditions:[]};
    runner.api.repairMetadata(card);
    return card;
  };
  const articuno = make("Team Rocket's Articuno",'M2A','34');
  const porygon = make("Team Rocket's Porygon",'SV10','81');
  const porygon2 = make("Team Rocket's Porygon2",'SV10','82');
  const mimikyu = make('Mimikyu','SV4A','341');
  const rufflet = make('Rufflet','SI','351');
  Object.assign(runner.context,{articuno,porygon,porygon2,mimikyu,rufflet});
  const run = code => vm.runInContext(code,runner.context);
  run('player("you").active=mimikyu; player("codex").active=porygon; player("codex").bench=[articuno,porygon2]');
  assert.equal(run('rocketResistVeil("codex",articuno)'),true);
  assert.equal(run('rocketResistVeil("codex",porygon2)'),false);
  assert.equal(run('calculateAttackDamageModifiers("you","codex",porygon,"active",30).applied'),30);
  assert.equal(await run('resolveAttackEffect("you",mimikyu,mimikyu.meta.attacks[0],{defendingPokemon:porygon})'),true);
  assert.equal(porygon.damage,0);
  assert.equal(await run('resolveAttackEffect("you",rufflet,rufflet.meta.attacks[0],{defendingPokemon:porygon})'),true);
  assert.equal(run('player("codex").active'),porygon);
  run('player("codex").bench=[porygon2]');
  assert.equal(await run('resolveAttackEffect("you",mimikyu,mimikyu.meta.attacks[0],{defendingPokemon:porygon})'),true);
  assert.equal(porygon.damage,70);
});

test('Rocketo Dan detects its verified core and changes opening priorities and Feather payment', () => {
  const fixture = loadFixture();
  const runner = createEngineRunner(fixture,17);
  runner.api.setup(fixture,runner.random,runner.choose,()=>true);
  const make = (name,setCode,cardNumber) => {
    const card = {id:setCode+'-'+cardNumber,name,setCode,cardNumber,energy:[],tools:[],conditions:[],damage:0};
    runner.api.repairMetadata(card);
    return card;
  };
  const murkrow = make("Team Rocket's Murkrow",'SV10','106');
  const honchkrow = make("Team Rocket's Honchkrow",'M2A','103');
  const porygon = make("Team Rocket's Porygon",'SV10','81');
  const porygon2 = make("Team Rocket's Porygon2",'SV10','82');
  const articuno = make("Team Rocket's Articuno",'M2A','34');
  const proton = make("Team Rocket's Proton",'SV10','123');
  const archer = make("Team Rocket's Archer",'SV10','120');
  const giovanni = make("Team Rocket's Giovanni",'SV10','129');
  const rocket = make("Team Rocket's Energy",'MC','742');
  Object.assign(runner.context,{murkrow,honchkrow,porygon,porygon2,articuno,proton,archer,giovanni,rocket});
  const run = code=>vm.runInContext(code,runner.context);
  assert.equal(run('game.resumeManifest={codex:[murkrow,honchkrow,porygon,porygon2,articuno]}; stageTwoAiProfile()'),'rocketo_dan');
  assert.equal(run('stageTwoAiProfile([murkrow,honchkrow,articuno])'),null);
  assert.equal(run('game.yamiStyle="aggro"; stageTwoAiDevelopment(murkrow,[])>stageTwoAiDevelopment(porygon,[])'),true);
  assert.equal(run('game.yamiStyle="balanced"; stageTwoAiDevelopment(porygon,[])>stageTwoAiDevelopment(murkrow,[])'),true);
  assert.equal(run('game.yamiStyle="control"; stageTwoAiDevelopment(articuno,[porygon])>stageTwoAiDevelopment(murkrow,[porygon])'),true);
  run('player("codex").active=honchkrow; player("codex").hand=[proton,archer,giovanni]; honchkrow.energy=[rocket]; player("you").active=articuno');
  const payment = 'rocketAiFeatherPayment(honchkrow,honchkrow.meta.attacks[0],articuno,[proton,archer,giovanni]).length';
  assert.equal(run('game.yamiStyle="aggro"; game.yamiDifficulty="casual"; '+payment),3);
  assert.equal(run('game.yamiDifficulty="master"; '+payment),2);
  assert.equal(run('aiEnergyDeficit(honchkrow,{},["Psychic","Darkness"])'),0);
  run('game.turnNumber=4; game.turn="codex"; player("codex").turnsTaken=2; player("codex").prizes=player("codex").prizes.slice(0,1)');
  const line = runner.api.aiAction();
  assert.equal(line?.type,'attack');
  assert.equal(line.name,'Rocket Feather');
  assert.equal(line.matchWinning,true);
});

const assert = require('node:assert/strict');
const {test} = require('node:test');
const vm = require('node:vm');
const {loadFixture,createEngineRunner} = require('./integration-harness.cjs');
const {cards:[bangle]} = require('./fixtures/brave-bangle.fixture.json');

function ready(side='you',source='Dratini',target='Dragonite ex') {
  const f=loadFixture(),r=createEngineRunner(f,25);
  r.api.setup(f,r.random,r.choose,()=>true);r.api.setLocalAi(false);
  const g=r.api.state(),p=g.players[side],foe=g.players[side==='you'?'codex':'you'];
  const make=(name,id=name)=>({ ...structuredClone(f.cards.find(c=>c.name===name)),id,energy:[],tools:[],evolutionStack:[],conditions:[],damage:0,enteredTurn:0,evolvedTurn:-1 });
  p.active=make(source,'attacker');foe.active=make(target,'defender');foe.active.meta.hp=1000;foe.active.meta.weaknesses=[];foe.active.meta.resistances=[];
  p.active.energy=p.active.meta.attacks[0].cost.map((type,i)=>({id:'energy-'+i,name:(type==='Colorless'?'Water':type)+' Energy',meta:{category:'Energy',energyType:type==='Colorless'?'Water':type}}));
  p.bench=[];foe.bench=[];p.hand=[structuredClone(bangle)];p.discard=[];
  g.turn=side;g.turnNumber=5;g.firstPlayer=side==='you'?'codex':'you';p.turnsTaken=2;
  r.api.clearVisuals();return {r,g,p,foe,side,make,tool:p.hand[0]};
}

test('the exact saved Brave Bangle WHT 80 effect becomes Implemented',async()=>{
  const r=createEngineRunner(loadFixture());r.api.loadSavedLibrary([structuredClone(bangle)]);await r.api.checkLibrary();
  assert.equal(r.api.libraryAudit().find(c=>c.name==='Brave Bangle').status,'implemented');
});

for(const mismatch of ['print','set','language','text'])test('Brave Bangle fails closed for changed '+mismatch,async()=>{
  const {r,p,tool}=ready();
  if(mismatch==='print')tool.cardNumber='81';
  if(mismatch==='set')tool.setCode='BLK';
  if(mismatch==='language'){tool.language='ja';tool.meta.language='ja';}
  if(mismatch==='text')tool.meta.effect+=' Draw a card.';
  const before=JSON.stringify(r.api.state());await r.api.playCard('you',tool.id);
  assert.equal(JSON.stringify(r.api.state()),before);assert.ok(p.hand.includes(tool));
  p.active.tools=[tool];assert.equal(r.api.preview('you',0).outcomes[0].damage,20);
});

for(const side of ['you','codex'])test(side+' attaches Brave Bangle using shared transactions and gets matching preview and actual damage',async()=>{
  const {r,p,foe,tool}=ready(side);await r.api.playCard(side,tool.id);
  assert.ok(p.active.tools.includes(tool));assert.ok(!p.hand.includes(tool));
  assert.equal(r.api.preview(side,0).outcomes[0].damage,50);
  assert.equal(await r.api.attack(side,0),true);assert.equal(foe.active.damage,50);
});

test('the bonus is calculated before Weakness, Resistance and damage reduction',async()=>{
  const {r,g,p,foe,tool}=ready();p.active.tools=[tool];p.hand=[];
  foe.active.meta.types=['Metal'];foe.active.meta.weaknesses=[{type:'Dragon',value:'×2'}];foe.active.meta.resistances=[{type:'Dragon',value:'-30'}];
  g.damageReductions=[{side:'codex',type:'metal',amount:30,expiresTurn:5}];
  assert.equal(r.api.preview('you',0).outcomes[0].damage,40);
  assert.equal(await r.api.attack('you',0),true);assert.equal(foe.active.damage,40);
});

test('Brave Bangle may attach to a Rule Box Pokémon, but grants it no bonus',async()=>{
  const {r,p,foe,tool}=ready('you','Dragonite ex');await r.api.playCard('you',tool.id);
  assert.ok(p.active.tools.includes(tool));assert.equal(r.api.preview('you',0).outcomes[0].damage,70);
  assert.equal(await r.api.attack('you',0),true);assert.equal(foe.active.damage,70);
});

test('a non-ex defender, a Pokémon V and an old uppercase EX receive no bonus',()=>{
  for(const name of ['Dratini','Example V','Example EX']){
    const {r,p,foe,tool}=ready();p.active.tools=[tool];foe.active.name=name;
    assert.equal(r.api.preview('you',0).outcomes[0].damage,20,name);
  }
});

test('an evolved Pokémon without a Rule Box receives the bonus; a Rule Box or unknown metadata prevents it',()=>{
  const {r,p,tool}=ready('you','Dragonair');p.active.tools=[tool];
  assert.equal(r.api.preview('you',0).outcomes[0].damage,90);
  p.active.meta.rules=['A Rule Box effect'];assert.equal(r.api.preview('you',0).outcomes[0].damage,60);
  delete p.active.meta.rules;assert.equal(r.api.preview('you',0).outcomes[0].damage,60);
});

test('the bonus applies only to the opposing Active and does not turn a nondamaging attack into damage',()=>{
  const {r,p,foe,tool}=ready();p.active.tools=[tool];foe.bench=[{...structuredClone(foe.active),id:'benched-ex'}];
  assert.equal(vm.runInContext('attackDamageBonusBeforeWeakness("you",player("you").active,player("you").active.meta.attacks[0],player("codex").bench[0])',r.context),0);
  p.active.meta.attacks[0].damage='';assert.equal(vm.runInContext('attackDamageBonusBeforeWeakness("you",player("you").active,player("you").active.meta.attacks[0])',r.context),0);
});

test('cancelling attachment restores the Tool and a full Tool slot blocks attachment',async()=>{
  const {r,p,tool}=ready();r.api.setChoices(r.random,q=>q.kind==='pokemon-target'?null:r.choose(q));
  const before=structuredClone(r.api.state());await r.api.playCard('you',tool.id);
  assert.deepEqual(Object.keys(before).filter(key=>key!=='log' && JSON.stringify(r.api.state()[key])!==JSON.stringify(before[key])),[]);
  const current=r.api.state().players.you;current.active.tools=[structuredClone(tool)];
  await r.api.playCard('you',tool.id);assert.equal(current.hand.length,1);assert.equal(current.active.tools.length,1);
});

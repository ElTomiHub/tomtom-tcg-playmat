const assert = require('node:assert/strict');
const {test} = require('node:test');
const vm = require('node:vm');
const {createEngineRunner,loadFixture} = require('./integration-harness.cjs');

function setup() {
  const f=loadFixture(), r=createEngineRunner(f,13);
  r.api.setup(f,r.random,r.choose,()=>true);
  r.api.setLocalAi(false);
  const g=r.api.state(), p=g.players.you;
  g.phase='play'; g.turn='you'; p.turnsTaken=2; p.supporterPlayedThisTurn=false;
  function print(name,setCode,cardNumber,kind,text) {
    const card={id:name,name,setCode,cardNumber,energy:[],conditions:[],tools:[],damage:0};
    if (text) Object.assign(card,{language:'en',meta:{category:'Trainer',trainerType:kind,effect:text,language:'en'}});
    else r.api.repairMetadata(card);
    return card;
  }
  const run=code=>vm.runInContext(code,r.context);
  return {r,p,print,run};
}

test('Bird Keeper requires a Bench, switches and draws the available cards',async()=>{
  const {p,r,print,run}=setup(), bird=print('Bird Keeper','S4A','193');
  p.hand=[bird]; p.bench=[]; const old=p.active;
  assert.equal(run("canPlayTrainerEffect(player('you').hand[0],'you')"),false);
  const next=print('Dratini','SVD','88'); p.bench=[next]; p.deck=[{id:'draw',name:'Drawn'}];
  await r.api.playCard('you',bird.id);
  assert.equal(p.active,next); assert.ok(p.bench.includes(old)); assert.ok(p.hand.some(c=>c.id==='draw'));
  assert.ok(p.discard.includes(bird));
});

test('Tera Orb can search for Dragonite ex, and Dragon Potion heals only an injured Active Dragon',async()=>{
  const {p,r,print,run}=setup();
  const orb=print('Tera Orb','SSP','189','Item','Search your deck for a Tera Pokémon, reveal it, and put it into your hand. Then, shuffle your deck.');
  const tera=print('Dragonite ex','SVD','90'), mega=print('Mega Dragonite ex','M2A','232');
  p.hand=[orb]; p.deck=[mega,tera];
  r.api.setChoices(r.random,q=>q.kind==='cards' ? q.candidates.slice(0,1) : q.candidates[0],()=>true);
  await r.api.playCard('you',orb.id);
  assert.ok(p.hand.includes(tera)); assert.ok(p.deck.includes(mega)); assert.ok(p.discard.includes(orb));
  const potion=print('Dragon Potion','MC','672');
  p.hand=[potion]; p.active=print('Tatsugiri','SV4A','232'); p.active.damage=30;
  assert.equal(run("canPlayTrainerEffect(player('you').hand[0],'you')"),false);
  p.active=tera; tera.damage=80;
  await r.api.playCard('you',potion.id);
  assert.equal(tera.damage,20); assert.ok(p.discard.includes(potion));
});

test('Crispin PRE 105 picks two distinct Basic types and attaches one without using the manual attachment',async()=>{
  const {p,r,print}=setup();
  const c=print('Crispin','PRE','105','Supporter','Search your deck for up to 2 Basic Energy cards of different types, reveal them, and put 1 of them into your hand. Attach the other to 1 of your Pokémon. Then, shuffle your deck.');
  p.hand=[c]; p.energyAttachedThisTurn=false;
  p.deck=['Water','Water','Lightning'].map((type,i)=>({id:'e'+i,name:type+' Energy',meta:{category:'Energy'}}));
  const [first,,second]=p.deck;
  r.api.setChoices(r.random,q=>q.kind==='cards' ? q.candidates.slice(0,1) : q.candidates[0],()=>true);
  await r.api.playCard('you',c.id);
  assert.ok(p.hand.includes(first)); assert.ok(p.active.energy.includes(second)); assert.equal(p.deck.length,1);
  assert.equal(p.energyAttachedThisTurn,false); assert.ok(p.discard.includes(c));
});

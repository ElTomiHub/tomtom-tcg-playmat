const assert = require('node:assert/strict');
const {test} = require('node:test');
const vm = require('node:vm');
const {createEngineRunner,loadFixture} = require('./integration-harness.cjs');

function setup() {
  const fixture = loadFixture(), r = createEngineRunner(fixture,17);
  r.api.setup(fixture,r.random,r.choose,()=>true);
  const g=r.api.state();
  g.turnNumber=3; g.turn='you'; g.players.you.turnsTaken=1;
  const exact=(name,setCode,cardNumber)=> {
    const card={id:setCode+cardNumber,name,setCode,cardNumber,energy:[],tools:[],conditions:[],damage:0};
    r.api.repairMetadata(card);
    return card;
  };
  return {r,g,exact,you:g.players.you,foe:g.players.codex};
}
test('the three Japanese prints repair to automatic support',()=>{
  const {r,exact}=setup();
  for (const print of [['Sableye','SM11','55'],['Piers','S8B','264'],['Escape Rope','S5I','61']]) {
    r.context.print=exact(...print);
    assert.ok(r.context.print.meta.image);
    assert.equal(vm.runInContext('effectSupportFor(print)',r.context),'automatic');
  }
});
test('Escape Rope gives each owner their own choice in order and enables Assault Gate',async()=>{
  const {r,g,exact,you,foe}=setup();
  const rope=exact('Escape Rope','S5I','61');
  const hoopa={id:'hoopa',name:'Hoopa',setCode:'CRZ',cardNumber:'83',language:'en',damage:0,
    tools:[],conditions:[],energy:[],meta:{category:'Pokemon',hp:120,stage:'Basic',types:['Darkness'],abilities:[],rules:[],
      attacks:[{name:'Assault Gate',cost:['Darkness'],damage:90,effect:"If this Pokémon didn't move from the Bench to the Active Spot this turn, this attack does nothing. This attack's damage isn't affected by Weakness."}]}};
  const target={...structuredClone(foe.active),id:'replacement',meta:{...foe.active.meta,hp:130,weaknesses:[{type:'Darkness',value:'×2'}],resistances:[{type:'Darkness',value:'-20'}]}};
  you.bench=[hoopa]; foe.bench=[target]; you.hand=[rope];
  r.context.hoopa=hoopa;
  const damage=()=>vm.runInContext("attackPreviewFor('you',hoopa,hoopa.meta.attacks[0]).outcomes[0].damage",r.context);
  assert.equal(damage(),0);
  const choices=[];
  r.api.setChoices(r.random,request=>{if(request.kind==='pokemon-target')choices.push(request.side);return r.choose(request);});
  await r.api.playCard('you',rope.id);
  assert.deepEqual(choices,['codex','you']);
  assert.equal(you.active,hoopa);
  assert.equal(foe.active,target);
  assert.ok(you.discard.includes(rope));
  assert.equal(damage(),70);
  g.turnNumber+=2;
  assert.equal(damage(),0);
});
test('Mirror Gem retaliates even when the incoming hit Knocks Out Sableye',async()=>{
  const {r,g,exact,you,foe}=setup();
  const sableye=exact('Sableye','SM11','55');
  you.active=sableye;
  r.context.sableye=sableye;
  assert.equal(await vm.runInContext("resolveAttackEffect('you',sableye,sableye.meta.attacks[0])",r.context),true);
  g.turn='codex'; g.turnNumber=4;
  const attacker=foe.active, before=attacker.damage || 0;
  attacker.meta.hp=200;
  await r.api.damagePokemon('codex','you',sableye,'active',100);
  assert.equal(attacker.damage,before+80);
  assert.ok(you.discard.includes(sableye));
});

test('Piers finds one Energy and one Darkness Pokémon and leaves other Pokémon in the deck',async()=>{
  const {r,exact,you,foe}=setup();
  const piers=exact('Piers','S8B','264'), sableye=exact('Sableye','SM11','55');
  const energy={id:'test-energy',name:'Water Energy',meta:{category:'Energy'}};
  const other={...structuredClone(foe.active),id:'other-type',meta:{...foe.active.meta,types:['Water']}};
  you.hand=[piers]; you.deck=[other,energy,sableye];
  r.api.setChoices(r.random,request=>request.kind==='cards' ? request.candidates.slice(0,1) : r.choose(request));
  await r.api.playCard('you',piers.id);
  assert.ok(you.hand.includes(energy));
  assert.ok(you.hand.includes(sableye));
  assert.deepEqual(Array.from(you.deck,card=>card.id),[other.id]);
  assert.ok(you.discard.includes(piers));
});

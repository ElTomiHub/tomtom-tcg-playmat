const assert=require('node:assert/strict');
const {test}=require('node:test');
const {loadFixture,createEngineRunner}=require('./integration-harness.cjs');
const cards=require('./fixtures/metal-and-japanese-cards.fixture.json').cards;
const base=loadFixture();
const metalList=`Pokémon: 18
3 Duraludon PRE 69
1 Duraludon SSP 129
2 Archaludon PRE 70
2 Archaludon ex SSP 130
2 Varoom PAF 64
2 Varoom OBF 154
2 Revavroom PAF 65
2 Skarmory DRI 141
2 Klefki SSP 128
Trainer: 24
2 Gloria BRS 141
2 Professor's Research BLK 85
2 Shauna FST 240
2 Sonia CPA 65
2 Boss's Orders MEG 114
2 Energy Retrieval CRI 108
2 Arven OBF 186
1 Team Star Grunt OBF 195
1 Cyrano SSP 170
3 Metal Saucer SSH 170
2 Iron Defender MEG 118
2 Leftovers MEW 163
1 Cycling Road MEW 157
Energy: 18
16 Metal Energy
2 Prism Energy BLK 86`;
const unionList=`Pokémon: 16
4 Tornadus M6 59
4 Thundurus M6 25
4 Landorus M6 40
4 Enamorus M6 83
Trainer: 20
4 Gloria BRS 141
4 Professor's Research BLK 85
4 Shauna FST 240
4 Sonia CPA 65
4 Boss's Orders MEG 114
Energy: 24
8 Lightning Energy
8 Fighting Energy
8 Psychic Energy`;
function fixtureFor(list) {
 const energies=['Metal','Lightning','Fighting','Psychic'].map(type=>({name:type+' Energy',setCode:'',cardNumber:'',language:'en',meta:{source:'Built-in rule',category:'Energy',energyType:type,effect:'',attacks:[],abilities:[],rules:[]}}));
 return {...base,cards:[...cards,...energies],decks:{human:{id:'test-metal-human',name:'Synthetic regression deck',decklist:list},ai:{id:'test-metal-ai',name:'Synthetic regression opponent',decklist:list}}};
}
function owned(g,side) {
 const p=g.players[side],out=[...p.deck,...p.hand,...p.prizes,...p.discard,...(p.lost||[])];
 for(const c of[p.active,...p.bench].filter(Boolean))out.push(c,...c.energy,...c.tools,...c.evolutionStack);
 if(g.stadium?.owner===side)out.push(g.stadium.card);return out;
}
function verify(g) {
 for(const side of['you','codex']){const p=g.players[side],all=owned(g,side);assert.equal(all.length,60,side+' physical cards conserved');const ids=all.map(c=>c.id).filter(Boolean);assert.equal(new Set(ids).size,ids.length);assert.ok(p.bench.length<=5);assert.ok(p.prizes.length<=6);if(g.phase==='play')assert.ok(p.active||p.bench.length&&(g.pendingPromotion===side||g.pendingPromotionAfter===side))}
}
for(const [label,list]of[['Metal',metalList],['Japanese Incarnate Union',unionList]])for(const seed of[2,4])test(label+' complete match preserves cards and resolves all choices (seed '+seed+')',async t=>{
 const fixture=fixtureFor(list),r=createEngineRunner(fixture,seed);r.api.setup(fixture,r.random,r.choose,()=>true);let steps=0;
 const seen=new Set(),messages=[];
 while(r.api.phase()==='play'&&steps++<1800){const g=r.api.state();verify(g);const old=new Set(g.log);
  if(g.pendingPromotion)await r.api.promote();
  else if(g.turn==='codex')await r.api.aiStep();
  else {const actions=r.api.snapshot().players.you.legalActions;const order=['play_basic','evolve','attach_energy','attach_tool','play_stadium','use_ability','use_stadium','play_item','play_supporter','attack','end_turn'];const a=order.map(type=>actions.find(a=>a.type===type)).find(Boolean);assert.ok(a);seen.add(a.type);await r.api.humanAction(a)}
  verify(r.api.state());assert.equal(r.api.pendingChoices(),false);messages.push(...r.api.state().log.filter(e=>!old.has(e)).map(e=>e.message));
 }
 const g=r.api.state();assert.equal(g.phase,'finished','match must reach an engine-derived ending');assert.ok(g.winner==='you'||g.winner==='codex');assert.ok(seen.has('attack'));assert.ok(messages.some(m=>m.includes('Knocked Out')));assert.ok(r.api.matchSummary('you'));assert.equal(g.pendingPromotion,null);t.diagnostic(label+' seed '+seed+' finished on turn '+g.turnNumber+' after '+steps+' actions; '+g.winner+' won.');
});

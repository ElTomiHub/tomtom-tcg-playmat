const assert = require('node:assert/strict');
const {test} = require('node:test');
const {loadFixture,createEngineRunner,loadStartupCardContext} = require('./integration-harness.cjs');
const details = require('./fixtures/dialga-ex-svp-180.fixture.json');
const unchecked = () => ({id:'saved-dialga',name:'Dialga ex PR-SV 180',setCode:'',cardNumber:'',categoryHint:'Pokemon',meta:null,lookupError:'Card not found'});
function setup(side='you',types=['Metal']) {
  const f=loadFixture(),r=createEngineRunner(f,78);r.api.setup(f,r.random,r.choose);r.api.setLocalAi(false);
  const c=unchecked();assert.equal(r.api.repairMetadata(c),true);c.energy=types.map((type,i)=>({id:'energy'+i,name:type+' Energy',meta:{category:'Energy',energyType:type}}));c.tools=[];c.conditions=[];c.damage=0;c.evolutionStack=[];c.enteredTurn=0;
  const g=r.api.state(),p=g.players[side],op=g.players[side==='you'?'codex':'you'];p.deck.push(p.active);p.active=c;p.turnsTaken=1;p.energyAttachedThisTurn=true;p.attackedThisTurn=false;g.phase='play';g.turn=side;g.pendingPromotion=null;op.active.meta.hp=9999;op.active.meta.weaknesses=[];op.active.meta.resistances=[];
  return {r,g,p,op,c};
}
const state=g=>JSON.stringify({players:g.players,turn:g.turn,turnNumber:g.turnNumber,phase:g.phase});
test('deck importer recognizes the exact PR-SV promo alias and preserves normal name/print parsing',()=>{
  const api=loadStartupCardContext().startupCardApi;
  for(const print of ['PR-SV','SVP']){const deck=api.parseDeck('Pokémon: 4\n4 Dialga ex '+print+' 180\nEnergy: 56\n56 Metal Energy SVE 8');assert.equal(deck.valid,true);assert.equal(deck.total,60);for(const c of deck.cards.slice(0,4)){assert.equal(c.name,'Dialga ex');assert.equal(c.setCode,'SVP');assert.equal(c.cardNumber,'180')}}
});
test('Update all cards repairs the exact malformed saved record in place with verified complete metadata',async()=>{
  const r=createEngineRunner(loadFixture());r.api.loadSavedLibrary([unchecked()]);const result=await r.api.checkLibrary();const cards=r.api.libraryAudit();assert.equal(cards.length,1);const c=cards[0];
  assert.equal(c.id,'saved-dialga');assert.equal(c.name,'Dialga ex');assert.equal(c.setCode,'SVP');assert.equal(c.cardNumber,'180');assert.equal(c.status,'implemented');assert.equal(c.lookupError,undefined);assert.equal(c.meta.hp,220);assert.equal(c.meta.stage,'Basic');assert.deepEqual(Array.from(c.meta.types),['Metal']);assert.equal(c.meta.retreat,2);assert.equal(c.meta.image,details.image);assert.equal(JSON.stringify(c.meta.attacks),JSON.stringify(details.attacks.map(a=>({...a,effectTextStatus:'present'}))));assert.equal(result.implemented,1);assert.equal(result.registered,0);
});
test('ambiguous, conflicting, non-English or unrelated promo records are never guessed or overwritten',()=>{
  const r=createEngineRunner(loadFixture());for(const mutate of [c=>{c.name='Dialga ex'},c=>{c.name='Palkia ex PR-SV 180'},c=>{c.cardNumber='181'},c=>{c.setCode='SVI'},c=>{c.language='ja'},c=>{c.categoryHint='Trainer'},c=>{c.name='Dialga ex PR-SV 181'},c=>{c.meta={effect:'Unverified effect'}}]){const c=unchecked();mutate(c);const before=JSON.stringify(c);assert.equal(r.api.repairMetadata(c),false);assert.equal(JSON.stringify(c),before)}
});
test('promo metadata copies are independent and existing checked card text is not rewritten',()=>{
  const r=createEngineRunner(loadFixture()),a=unchecked(),b=unchecked();r.api.repairMetadata(a);a.meta.types.push('Fire');r.api.repairMetadata(b);assert.deepEqual(Array.from(b.meta.types),['Metal']);b.meta.attacks[0].effect+=' Draw another card.';const before=JSON.stringify(b);assert.equal(r.api.repairMetadata(b),false);assert.equal(JSON.stringify(b),before);
});
test('both attacks require the verified exact English printing, full text, costs and damage',()=>{
  const {c}=setup();for(const mutate of [c=>{c.setCode='PRE'},c=>{c.cardNumber='181'},c=>{c.language=c.meta.language='ja'},c=>{c.meta.attacks[0].cost=['Colorless']},c=>{c.meta.attacks[1].damage='120+'},c=>{c.meta.attacks[0].effect=''},c=>{c.meta.attacks[1].effect+=' Draw a card.'}]){const changed=structuredClone(c);mutate(changed);const f=loadFixture();f.cards.push(changed);assert.notEqual(createEngineRunner(f).api.inspectFixture(f).find(x=>x.name==='Dialga ex').resolution,'automated')}
});
for(const side of ['you','codex']) test('Time Bellow deals twenty and draws exactly one through the '+side+' pipeline',async()=>{
  const {r,g,p,op,c}=setup(side),top=p.deck.at(-1),before=p.hand.length;if(side==='codex'){p.deck.push(...p.hand.splice(0));const expected=p.deck.at(-1);r.api.setLocalAi(true);await r.api.aiStep();assert.ok(p.hand.includes(expected));assert.equal(p.hand.length,1)}else{assert.equal(await r.api.attack(side,0),true);assert.ok(p.hand.includes(top));assert.equal(p.hand.length,before+1)}assert.equal(op.active.damage,20);assert.equal(g.turn,side==='you'?'codex':'you');
});
test('Time Bellow resolves with an empty deck without inventing a draw or an immediate deck-out',async()=>{
  const {r,g,p,op}=setup();p.discard.push(...p.deck.splice(0));const hand=p.hand.length;assert.equal(await r.api.attack('you',0),true);assert.equal(p.hand.length,hand);assert.equal(op.active.damage,20);assert.equal(g.phase,'play');
});
for(const [types,expected] of [[['Water','Water','Water'],100],[['Metal','Water','Water'],120],[['Metal','Metal','Metal'],160]]) test('Metal Blast computes '+expected+' from the live attached Energy',async()=>{
  const {r,p,op}=setup('you',types);p.bench.push({id:'other',name:'Other',meta:{category:'Pokemon',stage:'Basic',hp:100,types:['Metal']},energy:[{id:'bench-metal',name:'Metal Energy',meta:{category:'Energy',energyType:'Metal'}}],tools:[],conditions:[]});const preview=r.api.attackOptions('you').find(a=>a.index===1);assert.equal(preview.damage,expected);assert.equal(await r.api.attack('you',1),true);assert.equal(op.active.damage,expected);
});
test('AI chooses Metal Blast using the same live damage calculation',async()=>{
  const {r,g,p,op}=setup('codex',['Metal','Metal','Metal']);p.deck.push(...p.hand.splice(0));p.bench=[];r.api.setLocalAi(true);await r.api.aiStep();assert.equal(op.active.damage,160);assert.equal(g.turn,'you');
});
for(const attack of [0,1]) test('Dialga attack '+attack+' rolls damage, draw, zones and turn back on failed resolution',async()=>{
  const {r,g}=setup('you',['Metal','Metal','Metal']),before=state(g),restore=r.api.failNextAttackEffectAfterResolve();assert.equal(await r.api.attack('you',attack),false);restore();assert.equal(state(r.api.state()),before);
});

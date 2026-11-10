const assert=require('node:assert/strict');
const {test}=require('node:test');
const fs=require('node:fs');
const path=require('node:path');
const {loadFixture,createEngineRunner}=require('./integration-harness.cjs');
const extra=require('./fixtures/additional-library-cards.fixture.json').cards;
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function ready(){const f=loadFixture();f.cards.push(...extra);f.decks.ai={...f.decks.human,id:'coin-opponent'};const r=createEngineRunner(f,455);r.api.setup(f,r.random,r.choose,()=>true);r.api.setLocalAi(false);r.api.prepareAttack('you','ASC','71',['Lightning']);r.api.prepareAttack('codex','ASC','279',[]);const g=r.api.state();g.turn='you';g.turnNumber=3;g.players.you.turnsTaken=1;g.players.codex.turnsTaken=1;g.players.codex.active.meta.hp=9999;g.players.codex.active.meta.weaknesses=[];g.players.codex.active.meta.resistances=[];r.api.clearVisuals();return {r,f,g,p:g.players.you,op:g.players.codex}}
function inject(h,name){const c={...structuredClone(h.f.cards.find(c=>c.name===name)),id:'coin-'+name,energy:[],tools:[],conditions:[],evolutionStack:[]};assert.ok(c.meta,name);h.p.hand.push(c);return c}
function ensureBench(h){if(!h.op.bench.length){const c=structuredClone(h.p.active);c.id='op-bench';h.op.bench.push(c)}return h.op.bench[0]}
function gate(h,heads=true,choose=h.r.choose){let release,calls=0;const shown=[];h.r.api.setChoices(h.r.random,choose===null?undefined:choose,()=>{calls++;return typeof heads==='function'?heads(calls):heads},info=>{shown.push(info);return new Promise(resolve=>{release=resolve})});return {shown,release(){assert.ok(release);const r=release;release=null;r()},calls:()=>calls}}
function state(h){const g=h.r.api.state();return JSON.stringify({players:g.players,history:g.matchHistory,lastPlayed:g.lastPlayedCards,turn:g.turn,number:g.turnNumber})}

for(const heads of [true,false])test('Pokémon Catcher '+(heads?'heads':'tails')+' finishes its flip before any target choice or switch',async()=>{
 const h=ready(),b=ensureBench(h),old=h.op.active,c=inject(h,'Pokémon Catcher');let choices=0;const pending=gate(h,heads,q=>{choices++;return q.candidates?.[0]});const playing=h.r.api.playCard('you',c.id);await tick();assert.equal(pending.calls(),1);assert.match(h.r.document.getElementById('coinFlipOverlay').innerHTML,new RegExp(heads?'Heads':'Tails'));assert.equal(choices,0);assert.equal(h.r.api.pendingChoices(),false);assert.equal(h.op.active,old);assert.ok(h.p.hand.includes(c));assert.equal(h.r.document.getElementById('endTurnBtn').disabled,true);await h.r.api.endTurnFor('you');assert.equal(h.g.turn,'you');pending.release();await playing;assert.equal(choices,heads?1:0);assert.equal(h.op.active,heads?b:old);assert.ok(h.p.discard.includes(c));assert.equal(h.r.document.getElementById('coinFlipOverlay').innerHTML,'');assert.equal(pending.calls(),1);
});
test('the board picker opens only after the heads reveal, and cancelling it restores the card and old reference',async()=>{
 const h=ready();ensureBench(h);const c=inject(h,'Pokémon Catcher'),before=state(h),pending=gate(h,true,null);const playing=h.r.api.playCard('you',c.id);await tick();assert.equal(h.r.api.report().context.pendingBoardChoice,null);pending.release();await tick();assert.ok(h.r.api.report().context.pendingBoardChoice);assert.equal(h.r.document.getElementById('coinFlipOverlay').innerHTML,'');h.r.api.cancelActiveBoardChoice();await playing;assert.equal(state(h),before);assert.equal(h.r.api.visualState().active,null);
});
test('Yami’s automatic coin flip keeps Toma’s hand visible and Yami’s private cards hidden', async () => {
  const h = ready(), ball = inject(h, 'Poké Ball');
  h.p.hand = [{ id: 'toma-hand', name: 'Lightning Energy', meta: { category: 'Energy' } }];
  h.op.hand = [ball, { id: 'yami-private', name: 'Water Energy', meta: { category: 'Energy' } }];
  h.g.turn = 'codex';
  h.r.api.setLocalAi(true);
  const pending = gate(h, false), playing = h.r.api.aiStep();
  await tick();
  const doc = h.r.document;
  assert.match(doc.getElementById('coinFlipOverlay').innerHTML, /Tails/);
  assert.match(doc.getElementById('handTitle').innerHTML, /Your hand/);
  assert.match(doc.getElementById('handCards').innerHTML, /data-hand-card="toma-hand"/);
  assert.doesNotMatch(doc.getElementById('handCards').innerHTML, /yami-private|Poké Ball/);
  assert.doesNotMatch(doc.getElementById('cardInspector').innerHTML, /Poké Ball/);
  assert.match(doc.getElementById('codexRow').innerHTML, /Yami’s hand: 2 cards, face down/);
  pending.release();
  await playing;
  assert.ok(h.op.discard.includes(ball));
  assert.match(doc.getElementById('handCards').innerHTML, /data-hand-card="toma-hand"/);
  h.r.api.setLocalAi(false);
  assert.match(doc.getElementById('handTitle').innerHTML, /Yami’s hand/);
  assert.match(doc.getElementById('handCards').innerHTML, /data-hand-card="yami-private"/);
});
for(const heads of [true,false])test('Poké Ball '+(heads?'heads':'tails')+' reveals the result before the search picker',async()=>{
 const h=ready(),c=inject(h,'Poké Ball');let choices=0;const pending=gate(h,heads,q=>{choices++;return q.candidates?.[0]});const playing=h.r.api.playCard('you',c.id);await tick();assert.equal(choices,0);assert.equal(h.r.api.pendingChoices(),false);pending.release();await playing;assert.equal(choices,heads?1:0);assert.ok(h.p.discard.includes(c));
});
for(const heads of [true,false])test('coin attack '+(heads?'heads':'tails')+' reveals before damage and uses exactly one game result',async()=>{
 const h=ready(),pending=gate(h,heads);const attacking=h.r.api.attack('you',0);await tick();assert.equal(h.op.active.damage,0);assert.equal(h.p.attackedThisTurn,false);assert.match(h.r.document.getElementById('coinFlipOverlay').innerHTML,/coin-face-art/);assert.equal(h.r.api.visualState().active,null);pending.release();assert.equal(await attacking,true);assert.equal(h.op.active.damage,heads?30:10);assert.equal(pending.calls(),1);assert.equal(h.r.api.visualState().active.kind,'attack');
});
test('all three Heatmor flips finish before Energy discard selection',async()=>{
 const h=ready();inject(h,'Heatmor');for(let i=0;i<3;i++)h.p.hand.push({id:'fire'+i,name:'Fire Energy',meta:{category:'Energy',energyType:'Fire'}});h.r.api.prepareAttack('you','TEF','31',['Fire','Fire','Fire']);h.p.hand.push(...h.p.deck.splice(0,2));let choices=0;const pending=gate(h,n=>n===1,q=>{choices++;return q.candidates.slice(0,q.minCount||1)});const energy=h.p.active.energy.map(c=>c.id),attacking=h.r.api.attack('you',1);for(let i=0;i<3;i++){await tick();assert.equal(pending.shown.length,i+1);assert.equal(choices,0);assert.equal(h.p.active.energy.length,3);pending.release()}assert.equal(await attacking,true);assert.equal(pending.calls(),3);assert.equal(choices,1);assert.equal(h.p.active.energy.length,1);assert.equal(h.p.discard.filter(c=>energy.includes(c.id)).length,2);
});
test('Drasna shuffles first, then reveals its coin, then draws the printed number',async()=>{
 for(const heads of [true,false]){const h=ready(),c=inject(h,'Drasna'),pending=gate(h,heads);const playing=h.r.api.playCard('you',c.id);await tick();assert.equal(h.p.hand.length,0);assert.equal(h.p.discard.includes(c),false);pending.release();await playing;assert.equal(h.p.hand.length,heads?8:3);assert.ok(h.p.discard.includes(c))}
});
test('Lucian reveals both independent coins before either player draws',async()=>{
 const h=ready(),c=inject(h,'Lucian'),pending=gate(h,n=>n===1);const playing=h.r.api.playCard('you',c.id);for(let i=0;i<2;i++){await tick();assert.equal(h.p.hand.length,0);assert.equal(h.op.hand.length,0);assert.equal(pending.shown.length,i+1);pending.release()}await playing;assert.equal(h.p.hand.length,6);assert.equal(h.op.hand.length,3);assert.equal(pending.calls(),2);
});
test('Lucky Ice Pop heals before flipping, then waits for the result before returning to hand',async()=>{
 const h=ready(),c=inject(h,'Lucky Ice Pop');h.p.active.damage=30;const pending=gate(h,true),playing=h.r.api.playCard('you',c.id);await tick();assert.equal(h.p.active.damage,10);assert.equal(h.p.hand.filter(x=>x===c).length,1);pending.release();await playing;assert.ok(h.p.hand.includes(c));assert.ok(!h.p.discard.includes(c));assert.equal(pending.calls(),1);
});
for(const condition of ['burned','asleep'])test(condition+' check reveals before changing the condition or drawing for the next turn',async()=>{
 const h=ready();h.p.active.conditions=[{type:condition}];h.p.active.damage=0;const before=h.op.hand.length,pending=gate(h,true);const ending=h.r.api.endTurnFor('you');await tick();assert.ok(h.p.active.conditions.some(c=>c.type===condition));assert.equal(h.op.hand.length,before);assert.equal(h.p.active.damage,condition==='burned'?20:0);assert.match(h.r.document.getElementById('playmatTurnStatus').innerHTML,/Pokémon Checkup/);pending.release();await ending;assert.ok(!h.p.active.conditions.some(c=>c.type===condition));assert.equal(h.op.hand.length,before+1);assert.equal(pending.calls(),1);
});
test('undo and another match are blocked during the brief coin reveal',async()=>{
 const h=ready();ensureBench(h);const c=inject(h,'Pokémon Catcher');h.r.api.captureUndo();const pending=gate(h,false),playing=h.r.api.playCard('you',c.id);await tick();h.r.api.undo();await h.r.document.getElementById('startGameBtn').click();assert.equal(h.g,h.r.api.state());assert.equal(h.r.document.getElementById('setupModal').classList.contains('hidden'),true);pending.release();await playing;assert.ok(h.p.discard.includes(c));
});
test('a failed attack clears the already-shown coin and rolls back all attack changes',async()=>{
 const h=ready(),before=state(h),pending=gate(h,true),restore=h.r.api.failNextAttackEffectAfterResolve(),attacking=h.r.api.attack('you',0);await tick();assert.match(h.r.document.getElementById('coinFlipOverlay').innerHTML,/Heads/);pending.release();try{assert.equal(await attacking,false)}finally{restore()}assert.equal(state(h),before);assert.equal(h.r.document.getElementById('coinFlipOverlay').innerHTML,'');assert.equal(h.r.api.visualState().active,null);
});
test('effects-off and reduced motion retain a static result before the following choice',async()=>{
 for(const reduced of [false,true]){const h=ready();ensureBench(h);if(reduced)h.r.context.window.matchMedia=()=>({matches:true});else await h.r.document.getElementById('playmatEffectsBtn').click();const c=inject(h,'Pokémon Catcher'),pending=gate(h,true),playing=h.r.api.playCard('you',c.id);await tick();assert.equal(h.r.document.getElementById('coinFlipOverlay').classList.contains('reduced-motion'),true);assert.match(h.r.document.getElementById('coinFlipOverlay').innerHTML,/Heads/);assert.equal(h.r.api.pendingChoices(),false);pending.release();await playing}
});
test('all thirteen heads designs and the supplied tails are local verified image files',()=>{
 const root=path.join(__dirname,'..'),sources=require('../assets/coins/sources.json');assert.equal(sources.heads.length,13);assert.equal(new Set(sources.heads.map(c=>c.image)).size,13);for(const c of sources.heads){assert.match(c.source,/^https:\/\/www\.serebii\.net\/tcgpocket\/coin\//);const bytes=fs.readFileSync(path.join(root,c.image));assert.equal(bytes.readUInt16BE(0),0xffd8)}assert.equal(fs.readFileSync(path.join(root,sources.tails.image)).subarray(0,8).toString('hex'),'89504e470d0a1a0a');
});
test('artwork changes cannot consume the game random source or change the tails picture',()=>{
 const h=ready();let gameRandoms=0;h.r.api.setChoices(()=>{gameRandoms++;return .9},h.r.choose,()=>false);const designs=new Set();for(let i=0;i<13;i++){h.r.api.clearVisuals();assert.equal(h.r.api.flipVisualCoin(),false);const html=h.r.document.getElementById('playmatEffects').innerHTML;assert.match(html,/assets\/coins\/tails.png/);assert.match(html,/--coin-end:1620deg/);designs.add(html.match(/src="(assets\/coins\/[^\"]+\.jpg)"/)[1])}assert.equal(designs.size,13);assert.equal(gameRandoms,0);
});
test('a missing coin visual cannot block the engine or alter its result',async()=>{
 const h=ready(),original=h.r.document.getElementById;h.r.document.getElementById=function(id){if(id==='coinFlipOverlay')throw new Error('Display unavailable');return original.call(this,id)};h.r.api.setChoices(h.r.random,h.r.choose,()=>false);assert.equal(await h.r.api.attack('you',0),true);assert.equal(h.op.active.damage,10);
});
for(const mode of ['normal','reduced','fast'])test('the production '+mode+' coin timer finishes before resolution',async()=>{
 const h=ready();ensureBench(h);const c=inject(h,'Pokémon Catcher');let choices=0;h.r.api.setChoices(h.r.random,q=>{choices++;return q.candidates[0]},()=>true);h.r.context.window.__POKEMON_TCG_TEST__=false;if(mode==='reduced')h.r.context.window.matchMedia=()=>({matches:true});if(mode==='fast')await h.r.document.getElementById('fastEffectsBtn').click();const timers=new Map();let next=100;h.r.context.setTimeout=(fn,ms)=>{timers.set(++next,{fn,ms});return next};h.r.context.clearTimeout=id=>timers.delete(id);const playing=h.r.api.playCard('you',c.id);await tick();assert.equal(choices,0);const display=[...timers.values()].find(timer=>timer.ms===({normal:1450,reduced:450,fast:650}[mode]));assert.ok(display);assert.match(h.r.document.getElementById('coinFlipOverlay').innerHTML,/Heads/);display.fn();await playing;assert.equal(choices,1);assert.ok(h.p.discard.includes(c));assert.equal(h.r.document.getElementById('coinFlipOverlay').innerHTML,'');
});
test('turning effects off releases an in-flight presentation without rerolling or leaving a stale timer',async()=>{
 const h=ready();ensureBench(h);const c=inject(h,'Pokémon Catcher');let calls=0;h.r.api.setChoices(h.r.random,h.r.choose,()=>{calls++;return false});h.r.context.window.__POKEMON_TCG_TEST__=false;const timers=[];h.r.context.setTimeout=(fn,ms)=>{timers.push({fn,ms});return timers.length};h.r.context.clearTimeout=()=>{};const playing=h.r.api.playCard('you',c.id);await tick();const old=timers.find(t=>t.ms===1450);await h.r.document.getElementById('playmatEffectsBtn').click();await playing;old.fn();assert.equal(calls,1);assert.ok(h.p.discard.includes(c));assert.equal(h.r.document.getElementById('coinFlipOverlay').innerHTML,'');
});
test('card text is revalidated after the coin presentation before a Trainer can commit',async()=>{
 const h=ready();ensureBench(h);const c=inject(h,'Pokémon Catcher'),before=state(h),pending=gate(h,true),playing=h.r.api.playCard('you',c.id);await tick();c.meta.effect+=' Draw a card.';pending.release();await playing;assert.equal(state(h),before);assert.equal(h.r.document.getElementById('coinFlipOverlay').innerHTML,'');assert.equal(h.r.api.visualState().active,null);
});

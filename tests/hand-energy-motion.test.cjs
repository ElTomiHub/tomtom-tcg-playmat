const assert=require('node:assert/strict');
const {test}=require('node:test');
const fs=require('node:fs');
const path=require('node:path');
const {loadFixture,createEngineRunner}=require('./integration-harness.cjs');
const newCards=require('./fixtures/metal-and-japanese-cards.fixture.json').cards;
function ready(setupOnly=false){const f=loadFixture();f.cards.push(...newCards);f.decks.ai={...f.decks.human,id:'motion-opponent'};const r=createEngineRunner(f,455);r.api.setup(f,r.random,r.choose,()=>true,{setupOnly});r.api.setLocalAi(false);const g=r.api.state();if(!setupOnly){r.api.prepareAttack('you','ASC','71',['Lightning']);r.api.prepareAttack('codex','ASC','279',[]);g.turn='you';g.turnNumber=3;g.players.you.turnsTaken=1;g.players.codex.turnsTaken=1;g.players.codex.active.meta.hp=9999;g.players.codex.active.meta.weaknesses=[];g.players.codex.active.meta.resistances=[]}r.api.clearVisuals();let n=120;const timers=new Map();r.context.setTimeout=(fn,ms)=>{timers.set(++n,{fn,ms});return n};r.context.clearTimeout=id=>timers.delete(id);return {r,f,g,p:g.players.you,op:g.players.codex,timers}}
function instance(c,id){return {...structuredClone(c),id,energy:[],tools:[],conditions:[],evolutionStack:[],enteredTurn:0,evolvedTurn:-1,damage:0}}
function inject(h,name,id=name){const source=h.f.cards.find(c=>c.name===name);assert.ok(source,name);const c=instance(source,'motion-'+id);h.p.hand.push(c);return c}
function energy(id,type='Lightning'){return {id,name:type+' Energy',meta:{category:'Energy',energyType:type,image:''}}}
function effects(h){const v=h.r.api.visualState();return [v.active,...v.queued].filter(Boolean)}
function advance(h){const id=h.r.api.visualState().timer,t=h.timers.get(id);assert.ok(t,'visual timer exists');h.timers.delete(id);t.fn()}
function drain(h){let n=0;while(h.r.api.visualState().active&&n++<100)advance(h);assert.ok(n<100,'visuals finish')}
function state(h){const g=h.r.api.state();return JSON.stringify({players:g.players,history:g.matchHistory,lastPlayed:g.lastPlayedCards,turn:g.turn,number:g.turnNumber})}
async function drag(h,card,target,side='you'){
 h.r.api.selectHandCard('you',card.id);let prevented=false;const data={setData(){},effectAllowed:''};await h.r.document.getElementById('handCards').dispatchEvent({type:'dragstart',dataTransfer:data,preventDefault(){prevented=true},target:{closest:s=>s==='[data-hand-card]'?{dataset:{handCard:card.id}}:null}});
 await h.r.document.getElementById('battleCenter').dispatchEvent({type:'drop',dataTransfer:data,preventDefault(){},target:{closest:s=>s==='[data-card]'?{dataset:{side,card:target.id,zone:'active'}}:null}});return prevented;
}

for(const count of [0,1,5,14,60])test('opponent hand shows '+count+' without exposing identities or making hidden cards selectable',()=>{
 const h=ready();h.op.hand=Array.from({length:count},(_,i)=>({id:'SECRET_ID_'+i,name:'SECRET_NAME_'+i,meta:{category:'Energy',image:'https://assets.tcgdex.net/SECRET_IMAGE/low.webp'}}));h.r.api.render();const html=h.r.document.getElementById('codexRow').innerHTML;assert.match(html,new RegExp('Yami’s hand: '+count+' card'));assert.match(html,new RegExp('<strong>'+count+'</strong>'));assert.equal((html.match(/class="hidden-hand-back"/g)||[]).length,Math.min(count,10));assert.doesNotMatch(html,/SECRET_|data-hand-card|draggable/);if(count===0)assert.match(html,/Empty hand/);if(count>10)assert.ok(html.includes('+'+(count-10)));
});
test('opponent hand count changes after the actual turn draw and remains face down during setup',async()=>{
 const h=ready(),before=h.op.hand.length;await h.r.api.endTurnFor('you');assert.match(h.r.document.getElementById('codexRow').innerHTML,new RegExp('Yami’s hand: '+(before+1)+' cards'));const setup=ready(true);assert.match(setup.r.document.getElementById('codexRow').innerHTML,/hidden-hand-back/);assert.match(setup.r.document.getElementById('codexActiveZone').innerHTML,/face-down-card/);
});
for (const type of ['Grass','Fire','Water','Lightning','Psychic','Fighting','Darkness','Metal']) test(type+' Energy uses bundled 30th Celebration artwork without changing its metadata',()=>{
 const {r}=ready(),card=energy('energy',type),before=JSON.stringify(card);
 const image=r.api.imageUrl(card);
 assert.equal(image,'assets/energy-30th/'+type.toLowerCase()+'.webp');
 const bytes=fs.readFileSync(path.join(__dirname,'..',image));
 assert.equal(bytes.toString('ascii',0,4),'RIFF');
 assert.equal(bytes.toString('ascii',8,12),'WEBP');
 assert.equal(JSON.stringify(card),before);
});
test('imported Basic Energy symbols use anniversary artwork in the hand',()=>{
 const {r,p}=ready(),card={id:'imported-metal',name:'Basic {M} Energy',categoryHint:'Energy'};
 p.hand=[card];
 r.api.selectHandCard('you',card.id);
 assert.match(r.document.getElementById('handCards').innerHTML,/assets\/energy-30th\/metal\.webp/);
});
test('verified print artwork and Energy types outside the anniversary set keep their own illustrations',()=>{
 const h=ready(),card=energy('real');
 card.meta.image='https://assets.tcgdex.net/en/sve/12/low.webp';
 assert.equal(h.r.api.imageUrl(card),card.meta.image);
 for (const type of ['Fairy','Colorless']) {
  const image=h.r.api.imageUrl(energy('legacy',type));
  assert.match(image,/^data:image\/svg\+xml/);
  assert.ok(decodeURIComponent(image).includes(type+' Energy'));
 }
 const special=inject(h,'Prism Energy');
 assert.match(decodeURIComponent(h.r.api.imageUrl(special)),/Special Energy/);
});
test('dragging Energy to an owned Pokémon uses the existing manual attachment limit and statistics',async()=>{
 const h=ready(),e=energy('first'),second=energy('second');h.p.hand.push(e,second);h.p.energyAttachedThisTurn=false;const count=h.g.matchHistory.players.you.energyAttached;assert.equal(await drag(h,e,h.p.active),false);assert.ok(h.p.active.energy.includes(e));assert.equal(h.p.energyAttachedThisTurn,true);assert.equal(h.g.matchHistory.players.you.energyAttached,count+1);assert.equal(await drag(h,second,h.p.active),true);assert.ok(h.p.hand.includes(second));assert.equal(h.g.matchHistory.players.you.energyAttached,count+1);
});
test('Energy drag rejects the opponent and a stale hand source',async()=>{
 for(const stale of [false,true]){const h=ready(),e=energy('drag');h.p.hand.push(e);h.p.energyAttachedThisTurn=false;if(!stale){const before=state(h);await drag(h,e,h.op.active,'codex');assert.equal(state(h),before)}else{h.r.api.selectHandCard('you',e.id);await h.r.document.getElementById('handCards').dispatchEvent({type:'dragstart',dataTransfer:{setData(){}},preventDefault(){},target:{closest:()=>({dataset:{handCard:e.id}})}});h.p.hand=h.p.hand.filter(c=>c!==e);h.p.deck.push(e);const before=state(h);await h.r.document.getElementById('battleCenter').dispatchEvent({type:'drop',preventDefault(){},target:{closest:()=>({dataset:{side:'you',card:h.p.active.id}})}});assert.equal(state(h),before)}}
});
test('Electric Streamer attaches a selected batch to one Iono Pokémon and remains repeatable',async()=>{
 const h=ready(),bell=inject(h,"Iono's Bellibolt ex",'bell'),target=h.p.active;h.p.hand=h.p.hand.filter(c=>c!==bell);h.p.bench.push(bell);const chosen=[energy('a'),energy('b'),energy('c')];h.p.hand.push(...chosen,energy('wrong','Water'));h.p.energyAttachedThisTurn=true;const count=h.g.matchHistory.players.you.energyAttached;
 h.r.api.setChoices(h.r.random,q=>q.kind==='cards'?chosen:target);assert.equal(await h.r.api.useAbility('you',bell.id,'Electric Streamer',false),true);assert.ok(chosen.every(c=>target.energy.includes(c)));assert.equal(h.g.matchHistory.players.you.energyAttached,count+3);assert.equal(h.p.energyAttachedThisTurn,true);
 const next=energy('again');h.p.hand.push(next);h.r.api.setChoices(h.r.random,q=>q.kind==='cards'?[next]:target);assert.equal(await h.r.api.useAbility('you',bell.id,'Electric Streamer',false),true);assert.ok(target.energy.includes(next));
});
for(const failure of ['cancel','foreign-energy','stale-energy','foreign-target'])test('Electric Streamer batch '+failure+' rolls back every attachment and count',async()=>{
 const h=ready(),bell=inject(h,"Iono's Bellibolt ex",'bell');h.p.hand=h.p.hand.filter(c=>c!==bell);h.p.bench.push(bell);const selected=[energy('a'),energy('b')],water=energy('water','Water');h.p.hand.push(...selected,water);const before=state(h);h.r.api.setChoices(h.r.random,q=>{if(q.kind==='cards')return failure==='foreign-energy'?[water]:selected;if(failure==='cancel')return null;if(failure==='stale-energy')h.p.hand=h.p.hand.filter(c=>c!==selected[1]);return failure==='foreign-target'?h.op.active:h.p.active});assert.equal(await h.r.api.useAbility('you',bell.id,'Electric Streamer',false),false);assert.equal(state(h),before);
});
test('draw and hand-return movements use backs and aggregate counts without hidden names or IDs',async()=>{
 const h=ready(),judge=inject(h,'Judge');await h.r.api.playCard('you',judge.id);const moves=effects(h).filter(e=>e.kind==='zone-move' && e.faceDown);assert.ok(moves.some(e=>e.side==='you'&&e.fromZone==='hand'&&e.toZone==='deck'));assert.ok(moves.some(e=>e.side==='codex'&&e.fromZone==='deck'&&e.toZone==='hand'&&e.count===4));for(const m of moves){assert.equal(m.name,undefined);assert.equal(m.image,undefined);assert.equal(m.cardId,undefined)}
});
test('discard recovery shows public Energy moving from discard to hand, with no duplicate physical cards',async()=>{
 const h=ready(),retrieval=inject(h,'Energy Retrieval'),cards=[energy('discard1'),energy('discard2','Metal')];h.p.discard.push(...cards);h.r.api.setChoices(h.r.random,q=>q.candidates.slice(0,2));await h.r.api.playCard('you',retrieval.id);for(const c of cards){assert.ok(h.p.hand.includes(c));const moves=effects(h).filter(e=>e.kind==='zone-move'&&e.cardId===c.id);assert.equal(moves.length,1);assert.equal(moves[0].fromZone,'discard');assert.equal(moves[0].toZone,'hand');assert.ok(moves[0].image)}
});
test('a failed Trainer emits no committed draw, discard or deck-return movement',async()=>{
 const h=ready(),c=inject(h,'Judge'),before=state(h),restore=h.r.api.failNextSupporterAfterResolve();try{await h.r.api.playCard('you',c.id)}finally{restore()}assert.equal(state(h),before);assert.equal(effects(h).length,0);
});
for (const fast of [false, true]) test('Knock Out, Prize arrival, and AI promotion stay in order with ' + (fast ? 'fast' : 'normal') + ' effects', async () => {
  const h = ready(), old = h.op.active;
  const replacement = instance(h.f.cards.find(card => card.name === "Iono's Tadbulb"), 'new-active');
  h.op.bench = [replacement];
  old.meta.hp = 10;
  const prizeId = h.p.prizes.at(-1).id;
  h.r.api.setLocalAi(true);
  h.r.api.stagedKnockouts(true);
  if (fast) await h.r.document.getElementById('fastEffectsBtn').click();
  assert.equal(await h.r.api.attack('you', 0), true);
  const active = h.r.document.getElementById('codexActiveZone');
  const bench = h.r.document.getElementById('codexRow');
  const hand = h.r.document.getElementById('handCards');
  assert.equal(h.op.active, replacement);
  assert.doesNotMatch(active.innerHTML, /Knocked Out/);
  assert.match(bench.innerHTML, /data-card="new-active"/);
  assert.ok(!hand.innerHTML.includes(prizeId));
  assert.equal(h.r.api.visualState().active.kind, 'attack');
  assert.match(active.innerHTML, /Damage 0/);
  advance(h);
  assert.equal(h.r.api.visualState().active.kind, 'damage');
  assert.match(active.innerHTML, /Remaining HP 0/);
  advance(h);
  assert.equal(h.r.api.visualState().active.kind, 'knockout');
  assert.match(active.innerHTML, /Knocked Out/);
  advance(h);
  assert.match(active.innerHTML, /Collecting Prizes/);
  while (h.r.api.visualState().active.kind !== 'prize') advance(h);
  assert.match(bench.innerHTML, /data-card="new-active"/);
  assert.ok(!hand.innerHTML.includes(prizeId));
  advance(h);
  assert.ok(hand.innerHTML.includes(prizeId));
  while (h.r.api.visualState().active.kind !== 'promotion') advance(h);
  assert.doesNotMatch(bench.innerHTML, /data-card="new-active"/);
  assert.match(active.innerHTML, /Moving to Active/);
  advance(h);
  assert.match(active.innerHTML, /data-card="new-active"/);
  assert.equal(h.r.api.visualTransitions().length, 0);
  drain(h);
});
test('a human cannot promote until the opponent finishes collecting Prizes', async () => {
  const h = ready(), replacement = instance(h.f.cards.find(card => card.name === "Iono's Tadbulb"), 'your-new-active');
  h.p.active.meta.hp = 10;
  h.p.bench = [replacement];
  h.g.turn = 'codex';
  h.r.api.prepareAttack('codex', 'ASC', '71', ['Lightning']);
  h.r.api.stagedKnockouts(true);
  assert.equal(await h.r.api.attack('codex', 0), true);
  assert.equal(h.g.pendingPromotion, 'you');
  while (h.r.api.visualState().active.kind !== 'prize') advance(h);
  await h.r.api.promote();
  assert.equal(h.p.active, null);
  advance(h);
  await h.r.api.promote();
  assert.equal(h.p.active, replacement);
  drain(h);
  assert.match(h.r.document.getElementById('youActiveZone').innerHTML, /your-new-active/);
});
test('a Benched Knockout remains on the mat until it reaches the discard pile', async () => {
  const h = ready(), victim = instance(h.op.active, 'bench-victim');
  victim.meta.hp = 10;
  h.op.bench = [victim];
  h.r.api.stagedKnockouts(true);
  const before = h.op.discard.length;
  await h.r.api.damagePokemon('you', 'codex', victim, 'bench', 30);
  h.r.api.render();
  const row = h.r.document.getElementById('codexRow');
  assert.match(row.innerHTML, /Remaining HP 0/);
  assert.match(row.innerHTML, new RegExp('discard pile, ' + before + ' cards'));
  assert.equal(h.r.api.visualTransitions()[0].zone, 'bench');
  advance(h);
  assert.equal(h.r.api.visualState().active.kind, 'knockout');
  assert.match(row.innerHTML, /was Knocked Out/);
  advance(h);
  assert.match(row.innerHTML, new RegExp('discard pile, ' + (before + 1) + ' cards'));
  assert.doesNotMatch(row.innerHTML, /was Knocked Out/);
  drain(h);
});
test('reopening the library restores visible cards after an empty search', async () => {
  const { r } = ready();
  const doc = r.document;
  await doc.getElementById('menuManageCards').click();
  const search = doc.getElementById('registeredCardSearch');
  search.value = 'no matching Pokémon';
  await search.dispatchEvent({ type: 'input' });
  assert.match(doc.getElementById('cardLibraryResults').innerHTML, /No registered cards match/);
  await doc.getElementById('closeCardLibraryBtn').click();
  await doc.getElementById('menuManageCards').click();
  assert.equal(search.value, '');
  assert.match(doc.getElementById('cardLibraryResults').innerHTML, /data-registered-card=/);
});
test('failed Knockouts and undo clear staged transitions, with no stale promotion replay',async()=>{
 for(const failure of ['rollback','undo']){const h=ready();h.op.active.meta.hp=10;h.op.bench=[instance(h.p.active,'replacement')];h.r.api.stagedKnockouts(true);h.r.api.captureUndo();const before=state(h);const restore=failure==='rollback'?h.r.api.failNextAttackEffectAfterResolve():null;try{await h.r.api.attack('you',0)}finally{restore?.()}const stale=[...h.timers.values()].map(t=>t.fn);if(failure==='undo')h.r.api.undo();for(const fn of stale)fn();assert.equal(state(h),before);assert.equal(h.r.api.visualTransitions().length,0);assert.equal(effects(h).length,0)}
});
test('effects off reveals the actual promoted Pokémon immediately and leaves no presentation lock',async()=>{
 const h=ready(),replacement=instance(h.p.active,'new-active');h.op.active.meta.hp=10;h.op.bench=[replacement];h.r.api.stagedKnockouts(true);await h.r.document.getElementById('playmatEffectsBtn').click();assert.equal(await h.r.api.attack('you',0),true);assert.equal(h.r.api.visualTransitions().length,0);assert.equal(h.op.active,replacement);assert.match(h.r.document.getElementById('codexActiveZone').innerHTML,/new-active/);
});
test('a complete match has identical rules outcomes with staged Knockouts enabled or disabled',async()=>{
 const results=[];
 for(const staged of [false,true]){
  const f=loadFixture(),r=createEngineRunner(f,2);r.api.setup(f,r.random,r.choose,()=>true);r.api.clearVisuals();r.api.stagedKnockouts(staged);const timers=new Map();let id=500;r.context.setTimeout=(fn,ms)=>{timers.set(++id,{fn,ms});return id};r.context.clearTimeout=id=>timers.delete(id);const h={r,timers};let steps=0;
  const owned=(g,side)=>{const p=g.players[side],cards=[...p.hand,...p.deck,...p.prizes,...p.discard,...p.lost];for(const c of [p.active,...p.bench].filter(Boolean))cards.push(c,...c.energy,...c.tools,...c.evolutionStack);if(g.stadium?.owner===side)cards.push(g.stadium.card);return cards};
  while(r.api.phase()==='play'&&steps++<1800){drain(h);const g=r.api.state();for(const side of ['you','codex'])assert.equal(owned(g,side).length,60);if(g.pendingPromotion)await r.api.promote();else if(g.turn==='codex')await r.api.aiStep();else{const actions=r.api.snapshot().players.you.legalActions,order=['play_basic','evolve','attach_energy','play_item','play_supporter','attack','end_turn'];const a=order.map(type=>actions.find(a=>a.type===type)).find(Boolean);assert.ok(a);await r.api.humanAction(a)}}
  drain(h);const g=r.api.state();assert.equal(g.phase,'finished');assert.equal(r.api.visualTransitions().length,0);for(const side of ['you','codex']){const cards=owned(g,side);assert.equal(cards.length,60);const ids=cards.map(c=>c.id).filter(Boolean);assert.equal(new Set(ids).size,ids.length)}results.push(JSON.stringify({players:g.players,winner:g.winner,turn:g.turnNumber,reason:g.finishReason,counts:g.matchHistory.players}));
 }
 assert.equal(results[0],results[1]);
});

function movementAnchors(h,{fan=true}={}) {
 const rect=(left,top,width,height)=>({getBoundingClientRect:()=>({left,top,width,height})});
 const lower=rect(400,680,320,160),top=rect(470,92,100,30),display=rect(430,88,160,40),deck=rect(810,100,56,78),discard=rect(745,100,56,78),prizes=rect(90,100,100,94),row=rect(60,60,900,210);
 h.r.document.getElementById('handCards').getBoundingClientRect=lower.getBoundingClientRect;
 h.r.document.getElementById('codexRow').getBoundingClientRect=row.getBoundingClientRect;
 h.r.document.getElementById('codexActiveZone').getBoundingClientRect=rect(550,300,96,134).getBoundingClientRect;
 const owner=h.r.document.getElementById('codexRow'),original=owner.querySelector;
 owner.querySelector=selector=>selector==='.opponent-hand-fan'?(fan?top:null):selector==='.opponent-hand-display'?display:selector==='.pile-zone .pile-card'?deck:selector==='.discard-pile-card'?discard:selector==='.prize-display'?prizes:original(selector);
 const center=element=>{const b=element.getBoundingClientRect();return {x:b.left+b.width/2,y:b.top+b.height/2}};
 return {top:center(top),display:center(display),lower:center(lower),deck:center(deck),discard:center(discard),prizes:center(prizes)};
}
for(const action of ['Basic Pokémon','Energy','Supporter','Tool','Evolution']) test('AI '+action+' movement starts at its own upper hand while the bottom hand still belongs to you',async()=>{
 const h=ready(),g=h.r.api.state(),p=g.players.codex,anchors=movementAnchors(h);g.turn='codex';g.turnNumber=4;p.turnsTaken=1;p.bench=[];p.hand=[];p.energyAttachedThisTurn=true;
 let card;
 if(action==='Basic Pokémon'){card=instance(h.f.cards.find(c=>c.name==="Iono's Voltorb"),'ai-basic');p.hand=[card];}
 if(action==='Energy'){h.r.api.prepareAttack('codex','ASC','71',[]);card=energy('ai-energy');p.hand=[card];p.energyAttachedThisTurn=false;}
 if(action==='Supporter'){card=instance(h.f.cards.find(c=>c.name==='Nemona'),'ai-supporter');p.hand=[card];p.supporterPlayedThisTurn=false;}
 if(action==='Tool'){card=instance(h.f.cards.find(c=>c.name==='Bravery Charm'),'ai-tool');p.hand=[card];}
 if(action==='Evolution'){h.r.api.prepareAttack('codex','ASC','69',[]);p.active.enteredTurn=0;p.active.evolvedTurn=-1;card=instance(h.f.cards.find(c=>c.name==="Iono's Bellibolt ex"),'ai-evolution');p.hand=[card];}
 g.turn='codex';p.turnsTaken=1;h.r.api.setLocalAi(true);h.r.api.clearVisuals();await h.r.api.aiStep();
 const move=effects(h).find(e=>e.kind==='card-move'&&e.cardId===card.id);assert.ok(move,'the actual AI action emitted its public card movement');assert.deepEqual(JSON.parse(JSON.stringify(move.from)),anchors.top);assert.notDeepEqual(JSON.parse(JSON.stringify(move.from)),anchors.lower);
});
test('both players’ hand shuffle and draw effects use their respective hand anchors and retain hidden-card privacy',async()=>{
 const h=ready(),g=h.r.api.state(),p=g.players.codex,a=movementAnchors(h);g.turn='codex';g.turnNumber=4;p.turnsTaken=1;p.supporterPlayedThisTurn=false;
 const judge=instance(h.f.cards.find(c=>c.name==='Judge'),'ai-judge');p.hand=[judge,energy('PRIVATE_CODEX_HAND')];h.p.hand=[energy('PRIVATE_YOUR_HAND')];h.r.api.clearVisuals();await h.r.api.playCard('codex',judge.id);
 const moves=effects(h).filter(e=>e.kind==='zone-move'&&e.faceDown);
 for(const side of ['you','codex']){const hand=side==='you'?a.lower:a.top,returned=moves.find(e=>e.side===side&&e.fromZone==='hand'&&e.toZone==='deck'),draw=moves.find(e=>e.side===side&&e.fromZone==='deck'&&e.toZone==='hand');assert.ok(returned);assert.ok(draw);assert.deepEqual(JSON.parse(JSON.stringify(returned.from)),hand);assert.deepEqual(JSON.parse(JSON.stringify(draw.point)),hand);}
 assert.doesNotMatch(JSON.stringify(moves),/PRIVATE_|"cardId"|"image"|"name"/);
});
test('opponent discard recovery ends at its own upper hand',async()=>{const h=ready(),g=h.r.api.state(),p=g.players.codex,a=movementAnchors(h);g.turn='codex';g.turnNumber=4;p.turnsTaken=1;const retrieval=instance(h.f.cards.find(c=>c.name==='Energy Retrieval'),'ai-retrieval'),recovered=energy('ai-recovered');p.hand=[retrieval];p.discard=[recovered];h.r.api.clearVisuals();await h.r.api.playCard('codex',retrieval.id);const move=effects(h).find(e=>e.kind==='zone-move'&&e.cardId===recovered.id);assert.ok(move);assert.deepEqual(JSON.parse(JSON.stringify(move.from)),a.discard);assert.deepEqual(JSON.parse(JSON.stringify(move.point)),a.top);});
test('opponent Prize movement stays entirely on the opponent side and reveals no Prize identity',async()=>{const h=ready(),a=movementAnchors(h);h.r.api.prepareAttack('codex','ASC','71',['Lightning']);h.g.turn='codex';h.g.turnNumber=4;h.g.players.codex.turnsTaken=1;h.p.active.meta.hp=10;h.p.bench=[instance(h.f.cards.find(c=>c.name==="Iono's Tadbulb"),'prize-survivor')];h.r.api.clearVisuals();assert.equal(await h.r.api.attack('codex',0),true);const prize=effects(h).find(e=>e.kind==='prize'&&e.side==='codex');assert.ok(prize);assert.deepEqual(JSON.parse(JSON.stringify(prize.from)),a.prizes);assert.deepEqual(JSON.parse(JSON.stringify(prize.point)),a.top);assert.equal(prize.cardId,undefined);assert.equal(prize.image,undefined);assert.equal(prize.name,undefined);});
test('an empty opponent hand uses its upper display as a fallback, never your bottom hand',async()=>{const h=ready(),a=movementAnchors(h,{fan:false}),p=h.g.players.codex;h.g.turn='codex';h.g.turnNumber=4;p.turnsTaken=1;const card=instance(h.f.cards.find(c=>c.name==='Nemona'),'empty-fan-supporter');p.hand=[card];p.supporterPlayedThisTurn=false;h.r.api.clearVisuals();await h.r.api.playCard('codex',card.id);const move=effects(h).find(e=>e.kind==='card-move'&&e.cardId===card.id);assert.ok(move);assert.deepEqual(JSON.parse(JSON.stringify(move.from)),a.display);});

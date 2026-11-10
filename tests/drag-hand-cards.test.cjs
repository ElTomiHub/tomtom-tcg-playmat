const assert = require('node:assert/strict');
const {test} = require('node:test');
const vm = require('node:vm');
const {createEngineRunner,loadFixture} = require('./integration-harness.cjs');
const extra = require('./fixtures/metal-and-japanese-cards.fixture.json').cards;

function ready() {
  const f=loadFixture();f.cards.push(...extra);
  const r=createEngineRunner(f,15);r.api.setup(f,r.random,r.choose,()=>true);r.api.setLocalAi(false);
  const g=r.api.state(),p=g.players.you,foe=g.players.codex;
  const make=(name,id=name)=>{
    const source=f.cards.find(card=>card.name===name);assert.ok(source,name);
    return {...structuredClone(source),id,energy:[],tools:[],conditions:[],evolutionStack:[],damage:0,enteredTurn:0,evolvedTurn:-1};
  };
  g.turn='you';g.turnNumber=3;g.firstPlayer='codex';p.turnsTaken=1;foe.turnsTaken=1;
  p.active=make('Dratini');p.bench=[];p.hand=[];p.discard=[];r.api.clearVisuals();
  return {r,g,p,foe,make};
}
const publicState=r=>JSON.stringify({players:r.api.state().players,turn:r.api.state().turn,stadium:r.api.state().stadium,history:r.api.state().matchHistory,stats:r.api.backup().data.deckStats});
async function start(h,card) {
  let blocked=false;
  await h.r.document.getElementById('handCards').dispatchEvent({type:'dragstart',dataTransfer:{setData(){}},preventDefault(){blocked=true;},target:{closest:s=>s==='[data-hand-card]'?{dataset:{handCard:card.id}}:null}});
  return blocked;
}
async function drop(h,target,root='battleCenter') {
  let accepted=false;
  await h.r.document.getElementById(root).dispatchEvent({type:'drop',preventDefault(){accepted=true;},target});
  return accepted;
}
const pokemonTarget=(card,side='you')=>({closest:s=>s==='[data-card]'?{dataset:{side,card:card.id}}:null});
const playedTarget=(side='you')=>({closest:s=>s==='[data-trainer-drop-side]'?{dataset:{trainerDropSide:side}}:null});
const benchTarget=(side='you')=>({closest:s=>s==='[data-bench-drop-side]'?{dataset:{benchDropSide:side}}:null});
const activeZone={closest:selector=>selector==='#youActiveZone'?{}:null};
async function startBoard(h,card,root='youRow') {
  await h.r.document.getElementById(root).dispatchEvent({
    type:'dragstart',dataTransfer:{setData(){}},target:pokemonTarget(card),
    preventDefault(){assert.fail('Expected an eligible Pokémon to be draggable');}
  });
}
test('opening drag can replace the Active, swap with the Bench and return to hand',async()=>{
  const h=ready(),{g,p}=h;
  g.phase='setup';
  const original=p.active, incoming=h.make('Dratini','incoming'), benched=h.make('Dratini','benched');
  p.hand=[incoming];p.bench=[benched];p.openingBasicIds=[original.id,incoming.id,benched.id];
  assert.equal(await start(h,incoming),false);
  assert.equal(await drop(h,activeZone),true);
  assert.equal(p.active,incoming);assert.ok(p.hand.includes(original));
  await startBoard(h,benched);
  assert.equal(await drop(h,activeZone),true);
  assert.equal(p.active,benched);assert.equal(p.bench[0],incoming);
  await startBoard(h,benched,'battleCenter');
  assert.equal(await drop(h,{closest:s=>s==='#handCards'?{}:null},'handCards'),true);
  assert.equal(p.active,null);assert.ok(p.hand.includes(benched));
});
test('dragging a Benched Pokémon into the vacant Active Spot completes forced promotion',async()=>{
  const h=ready(),{g,p}=h, replacement=h.make('Dratini','replacement');
  p.active=null;p.bench=[replacement];g.pendingPromotion='you';
  await startBoard(h,replacement);
  assert.equal(await drop(h,activeZone),true);
  assert.equal(p.active,replacement);
  assert.equal(g.pendingPromotion,null);
});
const toolPeekTarget=card=>({closest:s=>s==='.pokemon-card-stack'?{querySelector:()=>({dataset:{side:'you',card:card.id}})}:null});

test('a Basic Pokémon dragged onto the Bench is played through the normal placement and Undo flow',async()=>{
  const h=ready(),basic=h.make('Tatsugiri','new-basic'),active=h.p.active;h.p.hand=[basic];
  const count=h.g.matchHistory.players.you.pokemonPlayed;
  assert.equal(await start(h,basic),false);assert.equal(await drop(h,benchTarget(),'youRow'),true);
  assert.ok(h.p.bench.includes(basic));assert.equal(h.p.active,active);assert.equal(basic.enteredTurn,3);assert.equal(h.g.matchHistory.players.you.pokemonPlayed,count+1);
  h.r.api.undo();assert.ok(h.r.api.state().players.you.hand.some(c=>c.id===basic.id));assert.equal(h.r.api.state().players.you.bench.length,0);
});

for(const invalid of ['opponent-bench','full-bench','wrong-turn','occupied-active','source-moved'])test('Basic Pokémon drag rejects '+invalid,async()=>{
  const h=ready(),basic=h.make('Tatsugiri','new-basic');h.p.hand=[basic];
  if(invalid==='full-bench')h.p.bench=Array.from({length:5},(_,i)=>h.make('Dratini','full-'+i));
  if(invalid==='wrong-turn')h.g.turn='codex';
  await start(h,basic);if(invalid==='source-moved'){h.p.hand=[];h.p.deck.push(basic);}
  const before=publicState(h.r),target=invalid==='occupied-active'?pokemonTarget(h.p.active):benchTarget(invalid==='opponent-bench'?'codex':'you');
  assert.equal(await drop(h,target,'youRow'),false);assert.equal(publicState(h.r),before);
});

test('opening Basics can be dragged to Active and Bench before an opponent-first game, and setup placement can be undone',async()=>{
  const h=ready(),active=h.make('Dratini','opening-active'),bench=h.make('Tatsugiri','opening-bench');
  h.g.phase='setup';h.g.turn='codex';h.p.active=null;h.p.hand=[active,bench];h.p.openingBasicIds=[active.id,bench.id];
  assert.equal(await start(h,active),false);
  assert.equal(await drop(h,{closest:s=>s==='[data-place]'?{dataset:{place:'active',side:'you'}}:null}),true);assert.equal(h.p.active,active);
  assert.equal(await start(h,bench),false);assert.equal(await drop(h,benchTarget(),'youRow'),true);assert.equal(bench.enteredTurn,0);
  h.r.api.undo();assert.equal(h.r.api.state().players.you.active.id,active.id);assert.ok(h.r.api.state().players.you.hand.some(c=>c.id===bench.id));
});

test('Energy dropped on a Benched Pokémon’s Tool tab attaches to that Pokémon, without targeting the Active',async()=>{
  const h=ready(),bench=h.make('Dratini','benched'),energy={id:'bench-energy',name:'Water Energy',meta:{category:'Energy',energyType:'Water'}};
  bench.tools=[h.make('Bravery Charm')];h.p.bench=[bench];h.p.hand=[energy];h.p.energyAttachedThisTurn=false;
  assert.equal(await start(h,energy),false);assert.equal(await drop(h,toolPeekTarget(bench),'youRow'),true);assert.ok(bench.energy.includes(energy));assert.equal(h.p.active.energy.length,0);
});

test('an Evolution dropped on a Bench Tool tab evolves its host and keeps the attached Tool',async()=>{
  const h=ready(),bench=h.make('Dratini','benched'),evo=h.make('Dragonair'),tool=h.make('Bravery Charm');
  bench.tools=[tool];h.p.bench=[bench];h.p.hand=[evo];
  assert.equal(await start(h,evo),false);assert.equal(await drop(h,toolPeekTarget(bench),'youRow'),true);assert.equal(h.p.bench[0],evo);assert.ok(evo.tools.includes(tool));assert.equal(h.p.active.name,'Dratini');
});

for(const zone of ['active','bench'])test('dragging an Evolution onto its matching '+zone+' Pokémon preserves attachments and allows Undo',async()=>{
  const h=ready(),evo=h.make('Dragonair'),target=h.p.active;
  if(zone==='bench'){h.p.active=h.make('Tatsugiri');h.p.bench=[target];}
  target.damage=20;target.energy=[{id:'attached',name:'Water Energy',meta:{category:'Energy',energyType:'Water'}}];h.p.hand=[evo];
  assert.equal(await start(h,evo),false);assert.equal(await drop(h,pokemonTarget(target)),true);
  const evolved=zone==='active'?h.p.active:h.p.bench[0];assert.equal(evolved,evo);assert.equal(evolved.damage,20);assert.equal(evolved.energy.length,1);assert.equal(evolved.evolutionStack[0].id,target.id);
  h.r.api.undo();assert.ok(h.r.api.state().players.you.hand.some(c=>c.id===evo.id));
});

for(const invalid of ['opponent','wrong-name','first-turn','entered-this-turn','evolved-this-turn','pending-promotion','setup','turn-changed','source-moved'])test('dragged Evolution fails closed for '+invalid,async()=>{
  const h=ready(),evo=h.make('Dragonair');h.p.hand=[evo];
  if(invalid==='first-turn')h.p.turnsTaken=0;
  if(invalid==='entered-this-turn')h.p.active.enteredTurn=3;
  if(invalid==='evolved-this-turn')h.p.active.evolvedTurn=3;
  if(invalid==='pending-promotion')h.g.pendingPromotion='you';
  if(invalid==='setup')h.g.phase='setup';
  if(invalid==='wrong-name')h.p.active=h.make('Tatsugiri');
  await start(h,evo);
  if(invalid==='turn-changed')h.g.turnNumber++;
  if(invalid==='source-moved'){h.p.hand=[];h.p.deck.push(evo);}
  const before=publicState(h.r);
  assert.equal(await drop(h,pokemonTarget(invalid==='opponent'?h.foe.active:h.p.active,invalid==='opponent'?'codex':'you')),false);
  assert.equal(publicState(h.r),before);
});

test('dropping a Supporter on the last-played area uses its normal effect and allowance',async()=>{
  const h=ready(),card=h.make('Nemona');h.p.hand=[card];h.p.deck=[h.make('Dratini','draw-1'),h.make('Dratini','draw-2'),h.make('Dratini','draw-3')];
  assert.equal(await start(h,card),false);assert.equal(await drop(h,playedTarget()),true);
  assert.equal(h.p.hand.length,3);assert.equal(h.p.supporterPlayedThisTurn,true);assert.ok(h.p.discard.includes(card));assert.equal(h.g.lastPlayedCards.you.card.id,card.id);
});

test('dropping a Trainer on Yami’s last-played area cannot play it',async()=>{
  const h=ready(),card=h.make('Nemona');h.p.hand=[card];await start(h,card);const before=publicState(h.r);
  assert.equal(await drop(h,playedTarget('codex')),false);assert.equal(publicState(h.r),before);
});

for(const restriction of ['supporter-used','first-player-first-turn','unsupported-print','coin-pending','choice-pending'])test('Trainer drag respects '+restriction,async()=>{
  const h=ready(),card=h.make('Nemona');h.p.hand=[card];
  if(restriction==='supporter-used')h.p.supporterPlayedThisTurn=true;
  if(restriction==='first-player-first-turn'){h.g.firstPlayer='you';h.p.turnsTaken=0;}
  if(restriction==='unsupported-print')card.cardNumber='999';
  if(restriction==='coin-pending')vm.runInContext('coinPresentationPending=true;',h.r.context);
  if(restriction==='choice-pending')h.r.api.checkpointLock(true);
  const before=publicState(h.r);assert.equal(await start(h,card),true);assert.equal(await drop(h,playedTarget()),false);assert.equal(publicState(h.r),before);
});

test('an Item cancelled before hidden information is revealed stays in hand with its cost and allowance intact',async()=>{
  const h=ready(),ball=h.make('Ultra Ball'),cost1=h.make('Dratini','cost-1'),cost2=h.make('Dratini','cost-2');h.p.hand=[ball,cost1,cost2];
  h.r.api.setChoices(h.r.random,()=>null);const before=publicState(h.r);
  await start(h,ball);await drop(h,playedTarget());assert.equal(publicState(h.r),before);assert.equal(h.p.supporterPlayedThisTurn,false);
});

test('a Tool may be dropped directly onto a legal Pokémon or used through the usual target picker',async()=>{
  const h=ready(),tool=h.make('Bravery Charm');h.p.hand=[tool];
  h.r.api.setChoices(h.r.random,()=>{throw Error('A direct Tool drop must not ask for another target.');});
  await start(h,tool);assert.equal(await drop(h,pokemonTarget(h.p.active)),true);assert.ok(h.p.active.tools.includes(tool));
  const another=h.make('Bravery Charm','other');h.p.hand=[another];await start(h,another);const before=publicState(h.r);
  assert.equal(await drop(h,pokemonTarget(h.p.active)),false);assert.equal(publicState(h.r),before);
});

test('a Stadium drop uses the shared placement rule and does not bypass same-name or once-per-turn restrictions',async()=>{
  const h=ready(),card=h.make('Levincia');h.p.hand=[card];await start(h,card);
  assert.equal(await drop(h,{closest:s=>s==='#stadiumSlot'?{}:null}),true);assert.equal(h.g.stadium.card,card);
  h.p.hand=[h.make('Levincia','same-name')];assert.equal(await start(h,h.p.hand[0]),true);
});

test('discard and deck pile markup exposes only the deck count, with matching small count badges',()=>{
  const h=ready();h.p.deck=[h.make('Dratini','SECRET_DECK_CARD')];h.p.discard=[h.make('Judge')];h.r.api.render();
  const html=h.r.document.getElementById('youRow').innerHTML;
  assert.match(html,/deck-pile-back/);assert.match(html,/deck, 1 cards, face down/);assert.match(html,/pile-count">1/);assert.doesNotMatch(html,/SECRET_DECK_CARD/);
});

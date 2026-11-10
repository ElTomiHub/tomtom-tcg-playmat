const assert=require('node:assert/strict');
const {test}=require('node:test');
const {loadFixture,createEngineRunner,attackOptionEvent}=require('./integration-harness.cjs');
const extras=require('./fixtures/metal-and-japanese-cards.fixture.json').cards;
function ready(setupOnly=false) {
 const f=loadFixture();f.cards.push(...extras);f.decks.ai={...f.decks.human,id:'flow-opponent'};
 const r=createEngineRunner(f,455);r.api.setup(f,r.random,r.choose,()=>true,{setupOnly});r.api.setLocalAi(false);
 if(!setupOnly){r.api.prepareAttack('you','ASC','71',['Lightning']);r.api.prepareAttack('codex','ASC','279',[]);const g=r.api.state();g.turn='you';g.turnNumber=3;g.players.you.turnsTaken=1;g.players.codex.turnsTaken=1;g.players.codex.active.meta.hp=9999;g.players.codex.active.meta.weaknesses=[];g.players.codex.active.meta.resistances=[]}
 r.api.clearVisuals();const timers=new Map();let n=900;r.context.setTimeout=(fn,delay)=>{timers.set(++n,{fn,delay});return n};r.context.clearTimeout=id=>timers.delete(id);
 for(const [id,x,y]of[['handCards',200,600],['youRow',550,400],['codexRow',150,100],['youLastPlayed',600,300],['codexLastPlayed',150,300],['youActiveZone',450,300],['codexActiveZone',300,300],['stadiumSlot',375,300]])r.document.getElementById(id).getBoundingClientRect=()=>({left:x,top:y,width:80,height:100});
 return {r,f,g:r.api.state(),p:r.api.state().players.you,timers};
}
function inject(h,name,set,num,side='you') {const src=h.f.cards.find(c=>c.name===name&&(!set||c.setCode===set)&&(!num||c.cardNumber===String(num)));assert.ok(src,name);const c={...structuredClone(src),id:'flow-'+side+'-'+name,energy:[],tools:[],conditions:[],evolutionStack:[],damage:0,enteredTurn:0,evolvedTurn:-1};h.g.players[side].hand.push(c);return c}
function visuals(r){const v=r.api.visualState();return [v.active,...v.queued].filter(Boolean)}
function advance(r,timers){const entry=timers.get(r.api.visualState().timer);assert.ok(entry);timers.delete(r.api.visualState().timer);entry.fn()}
function publicState(r){const g=r.api.state();return JSON.stringify({players:g.players,lastPlayed:g.lastPlayedCards,turn:g.turn,number:g.turnNumber,history:g.matchHistory})}

for (const zone of ['active', 'bench']) test(`opening ${zone} placement on the playmat can be undone before the reveal`, async () => {
 const {r,g,p}=ready(true);
 const card=p.active;
 p.hand.push(card);
 p.active=null;
 r.api.selectHandCard('you',card.id);
 const before=publicState(r), beforeLog=JSON.stringify(g.log);
 const board=r.document.getElementById(zone==='active'?'battleCenter':'youRow');
 await board.dispatchEvent({type:'click',target:{closest:selector=>selector==='[data-place]'?{dataset:{side:'you',place:zone}}:null}});
 assert.equal(zone==='active'?p.active.id:p.bench.at(-1).id,card.id);
 assert.equal(r.document.getElementById('undoBtn').disabled,false);
 await r.document.getElementById('undoBtn').click();
 assert.equal(publicState(r),before);
 assert.equal(JSON.stringify(r.api.state().log),beforeLog);
 assert.equal(r.api.state().phase,'setup');
});

test('finishing opening setup clears Undo before any hidden cards are revealed', async () => {
 const {r}=ready(true);
 assert.equal(r.document.getElementById('undoBtn').disabled,false);
 await r.document.getElementById('finishSetupBtn').click();
 assert.equal(r.document.getElementById('undoBtn').disabled,true);
 r.api.undo();
 assert.equal(r.api.state().phase,'play');
});

test('end turn lists a payable attack and available plays, and cancel preserves the turn', async () => {
 const h=ready(),{r,g,p}=h;
 p.hand=[];
 p.bench=[];
 inject(h,'Nemona','SVI',180);
 await r.document.getElementById('controlYou').click();
 const name=p.active.meta.attacks[0].name;
 r.api.setChoices(r.random, null);
 const before=publicState(r);
 const end=r.document.getElementById('endTurnBtn');
 const dialog=r.document.getElementById('playmatConfirmDialog');
 const pending=end.click();
 assert.equal(dialog.open,true);
 const actions=r.document.getElementById('playmatConfirmActions').innerHTML;
 assert.ok(actions.includes(`Attack with ${name}`));
 assert.match(actions,/Play Nemona/);
 dialog.close('cancel');
 await pending;
 assert.equal(publicState(r),before);
 assert.equal(r.document.getElementById('undoBtn').disabled,true);
 const accepted=end.click();
 dialog.close('accept');
 await accepted;
 assert.equal(g.turn,'codex');
});

test('end turn skips the prompt if Energy and board requirements block every available move', async () => {
 const h=ready(),{r,g,p}=h;
 p.hand=[];
 p.bench=[];
 p.active.energy=[];
 g.players.codex.bench=[];
 inject(h,'Pokémon Catcher','POR',82);
 inject(h,'Double Dragon Energy','ROS',97);
 await r.document.getElementById('controlYou').click();
 const messages=[];
 r.api.setChoices(r.random, choice => {
   if (choice.kind==='confirm') { messages.push(choice.message); return false; }
   return r.choose(choice);
 });
 await r.document.getElementById('endTurnBtn').click();
 assert.deepEqual(messages,[]);
 assert.equal(g.turn,'codex');
});

test('clicking a payable attack warns about other plays and uses the chosen attack after confirmation', async () => {
 const h=ready(),{r,g,p}=h;
 p.hand=[];
 p.bench=[];
 inject(h,'Nemona','SVI',180);
 r.api.setChoices(r.random,null);
 r.api.selectBoardCard('you','active',p.active.id);
 assert.match(r.document.getElementById('turnActionStatus').textContent,/Play Nemona/);
 const beforeDamage=g.players.codex.active.damage;
 const pending=attackOptionEvent(r,0);
  const dialog=r.document.getElementById('playmatConfirmDialog');
  assert.equal(dialog.open,true);
  assert.match(r.document.getElementById('playmatConfirmActions').innerHTML,/Play Nemona/);
  assert.equal(g.players.codex.active.damage,beforeDamage);
  dialog.close('accept');
 await pending;
 assert.ok(g.players.codex.active.damage>beforeDamage);
 assert.equal(g.turn,'codex');
});

test('wheel scrolls an overflowing hand and releases normal scrolling at the edges', async () => {
 const {r}=ready(), hand=r.document.getElementById('handCards');
 Object.assign(hand,{clientWidth:400,scrollWidth:640,scrollLeft:0});
 async function wheel(options) {
   let prevented=false;
   await hand.dispatchEvent({type:'wheel',currentTarget:hand,cancelable:true,deltaX:0,deltaY:0,deltaMode:0,
     preventDefault(){prevented=true},...options});
   return prevented;
 }
 assert.equal(await wheel({deltaY:-80}),false);
 assert.equal(await wheel({deltaY:100}),true);
 assert.equal(hand.scrollLeft,100);
 assert.equal(await wheel({deltaY:20,deltaMode:1}),true);
 assert.equal(hand.scrollLeft,240);
 assert.equal(await wheel({deltaY:100}),false);
 assert.equal(await wheel({deltaY:-100,ctrlKey:true}),false);
 assert.equal(await wheel({deltaY:-4,deltaX:16}),false);
 assert.equal(await wheel({deltaY:-1,deltaMode:2}),true);
 assert.equal(hand.scrollLeft,0);
 hand.scrollWidth=hand.clientWidth;
 assert.equal(await wheel({deltaY:40}),false);
});

test('opening opponent Active and Bench show only card backs, with no names, art, IDs or inspection targets',()=>{
 const h=ready(true),op=h.g.players.codex;const c=structuredClone(op.active);c.id='PRIVATE_BENCH_ID';c.name='PRIVATE_BENCH_NAME';c.meta.image='https://assets.tcgdex.net/private-bench/low.webp';op.bench.push(c);op.active.id='PRIVATE_ACTIVE_ID';op.active.name='PRIVATE_ACTIVE_NAME';op.active.meta.image='https://assets.tcgdex.net/private-active/low.webp';h.r.api.render();
 for(const id of ['codexActiveZone','codexRow','codexLastPlayed']){const html=h.r.document.getElementById(id).innerHTML;assert.doesNotMatch(html,/PRIVATE_|private-active|private-bench/)}
 assert.match(h.r.document.getElementById('codexActiveZone').innerHTML,/face-down-card/);assert.match(h.r.document.getElementById('codexRow').innerHTML,/Face down/);assert.doesNotMatch(h.r.document.getElementById('codexActiveZone').innerHTML,/data-card|<img|title=/);assert.match(h.r.document.getElementById('youActiveZone').innerHTML,/data-card/);
 const snapshot=h.r.api.snapshot();assert.equal(snapshot.players.codex.active.faceDown,true);assert.equal(snapshot.players.codex.bench.at(-1).faceDown,true);assert.equal(snapshot.players.codex.hand,null);assert.equal(snapshot.players.codex.remainingCardCounts,null);assert.equal(snapshot.players.codex.attackOptions.length,0);assert.doesNotMatch(JSON.stringify(snapshot),/PRIVATE_|private-active|private-bench/);
 h.r.api.selectBoardCard('codex','active',op.active.id);assert.doesNotMatch(h.r.document.getElementById('cardInspector').innerHTML,/PRIVATE_|private-active/);
});
test('paused AI still cannot reveal opponent setup cards through Control or hand inspection',async()=>{
 const h=ready(true);assert.equal(h.r.document.getElementById('controlCodex').disabled,true);await h.r.document.getElementById('controlCodex').click();assert.match(h.r.document.getElementById('handTitle').innerHTML,/Your hand/);const op=h.g.players.codex;h.r.api.selectHandCard('codex',op.hand[0].id);h.r.api.render();assert.match(h.r.document.getElementById('handCards').innerHTML,/Opponent cards stay hidden/);assert.doesNotMatch(h.r.document.getElementById('cardInspector').innerHTML,new RegExp(op.hand[0].id));
});
test('finishing setup reveals actual opening Pokémon and announces the first player once',()=>{
 const h=ready(true),op=h.g.players.codex,name=op.active.name;h.r.api.finishSetup();assert.equal(h.g.phase,'play');assert.ok(h.r.document.getElementById('codexActiveZone').innerHTML.includes(op.active.id.replaceAll("'",'&#39;')));assert.ok(h.r.document.getElementById('codexActiveZone').innerHTML.includes(name.replaceAll("'",'&#39;')));assert.equal(h.r.api.snapshot().players.codex.active.name,name);assert.match(h.r.document.getElementById('turnDoneBanner').innerHTML,/Turn 1|opening Pokémon are revealed/);const timers=h.timers.size;h.r.api.render();h.r.api.render();assert.equal(h.timers.size,timers);assert.match(h.r.document.getElementById('playmatTurnStatus').innerHTML,/Going first: no attacks or Supporters/);
});
test('last-played cards persist separately for each player and inspection cannot replay the card',async()=>{
 const h=ready();for(const side of ['you','codex']){h.g.turn=side;const c=inject(h,'Nemona','SVI',180,side);await h.r.api.playCard(side,c.id);assert.equal(h.g.lastPlayedCards[side].card.name,'Nemona');assert.ok(h.g.players[side].discard.includes(c));assert.match(h.r.document.getElementById(side+'LastPlayed').innerHTML,/Nemona|Supporter played/)}
 h.r.api.inspectPlayed('you');assert.match(h.r.document.getElementById('cardInspector').innerHTML,/Last played|Draw 3 cards/);assert.equal(h.r.document.getElementById('playTrainerBtn').hidden,true);assert.equal(h.r.document.getElementById('attackPanel').hidden,true);assert.equal(h.g.lastPlayedCards.codex.card.name,'Nemona');
});
test('energy and Tool plays show their recipient and queue movement without changing card rules',async()=>{
 for(const tool of [false,true]){const h=ready(),target=h.p.active;h.p.energyAttachedThisTurn=false;const c=inject(h,tool?'Bravery Charm':'Lightning Energy');if(tool)await h.r.api.playCard('you',c.id);else h.r.api.attachFor('you',c.id,target.id);const entry=h.g.lastPlayedCards.you;assert.equal(entry.card.id,c.id);assert.equal(entry.targetName,target.name);assert.ok((tool?target.tools:target.energy).includes(c));const move=visuals(h.r).find(e=>e.kind==='card-move');assert.equal(move.targetId,target.id);assert.equal(move.destination,'pokemon');assert.match(h.r.document.getElementById('playmatEffects').innerHTML,/fx-moving-card/);assert.match(h.r.document.getElementById('youLastPlayed').innerHTML,/attached/)}
});
test('Bench, Stadium and normal evolution update the last-played reference with their exact print',async()=>{
 for(const kind of ['bench','stadium','evolution']){const h=ready();let c;if(kind==='bench'){h.p.bench=[];c=inject(h,"Iono's Tadbulb",'ASC',69);await h.r.api.humanAction({type:'play_basic',cardId:c.id})}else if(kind==='stadium'){c=inject(h,'Cycling Road');h.r.api.placeStadium('you',c.id)}else{c=inject(h,"Iono's Kilowattrel",'ASC',72);await h.r.api.evolveFor('you',c.id,h.p.active.id)}assert.equal(h.g.lastPlayedCards.you.card.id,c.id);assert.equal(h.g.lastPlayedCards.you.card.cardNumber,c.cardNumber);assert.ok(visuals(h.r).some(e=>e.kind==='card-move'))}
});
test('a cancelled or failed Trainer restores the previous last-played card and discards its movement',async()=>{
 for(const failure of ['cancel','failure']){const h=ready(),first=inject(h,'Nemona');await h.r.api.playCard('you',first.id);h.r.api.clearVisuals();const next=inject(h,'Ultra Ball');const before=publicState(h.r);let restore;if(failure==='cancel')h.r.api.setChoices(h.r.random,()=>null);else{h.r.api.setChoices(h.r.random,h.r.choose);restore=h.r.api.failNextItemAfterResolve()}try{await h.r.api.playCard('you',next.id)}finally{restore?.()}assert.equal(publicState(h.r),before);assert.equal(visuals(h.r).length,0);assert.match(h.r.document.getElementById('youLastPlayed').innerHTML,/Nemona/);assert.doesNotMatch(h.r.document.getElementById('youLastPlayed').innerHTML,/Ultra Ball/)}
});
test('a failed evolution retains the old last-played reference and emits no Energy movement',async()=>{
 const h=ready(),first=inject(h,'Nemona');await h.r.api.playCard('you',first.id);h.r.api.clearVisuals();const basic=inject(h,'Duraludon','PRE',69),evo=inject(h,'Archaludon ex');h.p.hand=h.p.hand.filter(c=>c!==basic);h.p.deck.push(h.p.active);h.p.active=basic;h.p.discard.push({id:'m',name:'Metal Energy',meta:{category:'Energy',energyType:'Metal'}});h.r.api.setChoices(h.r.random,()=>null);const before=publicState(h.r);await h.r.api.evolveFor('you',evo.id,basic.id);assert.equal(publicState(h.r),before);assert.equal(visuals(h.r).length,0);
});
test('Prize-taking movements show a card back and count, never the hidden Prize identity',async()=>{
 const h=ready(),op=h.g.players.codex;op.active.meta.hp=10;h.p.prizes=h.p.prizes.slice(0,1);h.p.prizes[0].name='PRIVATE_PRIZE_NAME';h.p.prizes[0].meta.image='https://assets.tcgdex.net/private-prize/low.webp';assert.equal(await h.r.api.attack('you',0),true);const prize=visuals(h.r).find(e=>e.kind==='prize');assert.equal(prize.count,1);assert.equal(prize.name,undefined);assert.equal(prize.image,undefined);assert.doesNotMatch(JSON.stringify(prize),/PRIVATE_PRIZE|private-prize/);while(h.r.api.visualState().active.kind!=='prize')advance(h.r,h.timers);const html=h.r.document.getElementById('playmatEffects').innerHTML;assert.match(html,/face-down-card|1 Prize card taken/);assert.doesNotMatch(html,/PRIVATE_PRIZE|private-prize|<img/);
});
test('failed final-Prize attacks roll back both Prize movement and the resulting turn state',async()=>{
 const h=ready();h.g.players.codex.active.meta.hp=10;h.p.prizes=h.p.prizes.slice(0,1);const before=publicState(h.r),restore=h.r.api.failNextAttackEffectAfterResolve();try{assert.equal(await h.r.api.attack('you',0),false)}finally{restore()}assert.equal(publicState(h.r),before);assert.equal(visuals(h.r).length,0);
});
test('turn announcements wait for Pokémon Checkup and draw, and ordinary AI actions cannot replace them',async()=>{
 const h=ready();await h.r.api.endTurnFor('you');assert.equal(h.g.turn,'codex');assert.match(h.r.document.getElementById('playmatTurnStatus').innerHTML,/Yami’s turn|Turn 4/);assert.match(h.r.document.getElementById('turnDoneBanner').innerHTML,/Yami’s turn/);const before=h.r.document.getElementById('turnDoneBanner').innerHTML,c=inject(h,'Nemona',null,null,'codex');await h.r.api.playCard('codex',c.id);assert.equal(h.r.document.getElementById('turnDoneBanner').innerHTML,before);assert.equal(h.r.document.getElementById('codexActiveZone').dataset.currentTurn,'true');h.g.pendingCheckup={endingSide:'codex',incomingSide:'you',promotions:['you']};h.g.pendingPromotion='you';h.r.api.render();assert.match(h.r.document.getElementById('playmatTurnStatus').innerHTML,/Pokémon Checkup/);assert.equal(h.r.document.getElementById('codexActiveZone').dataset.currentTurn,'false');
});
test('effects off preserves played-card references and turn notices while suppressing movement',async()=>{
 const h=ready();await h.r.document.getElementById('playmatEffectsBtn').click();const c=inject(h,'Nemona');await h.r.api.playCard('you',c.id);assert.equal(h.g.lastPlayedCards.you.card.name,'Nemona');assert.equal(visuals(h.r).length,0);await h.r.api.endTurnFor('you');assert.match(h.r.document.getElementById('turnDoneBanner').innerHTML,/Yami’s turn/);
});
test('reduced motion gives a static card-play message without a moving card',async()=>{
 const h=ready();h.r.context.window.matchMedia=()=>({matches:true});const c=inject(h,'Nemona');await h.r.api.playCard('you',c.id);assert.match(h.r.document.getElementById('playmatEffects').innerHTML,/Nemona/);assert.doesNotMatch(h.r.document.getElementById('playmatEffects').innerHTML,/fx-moving-card/);assert.match(h.r.document.getElementById('playmatEffectAnnouncement').textContent,/played Nemona/);
});
test('undo restores the old played-card reference and prevents old movement and turn timers replaying',async()=>{
 const h=ready(),c=inject(h,'Nemona');h.r.api.captureUndo();const before=publicState(h.r);await h.r.api.playCard('you',c.id);const stale=[...h.timers.values()].map(t=>t.fn);h.r.api.undo();for(const fn of stale)fn();assert.equal(publicState(h.r),before);assert.equal(visuals(h.r).length,0);assert.equal(h.r.document.getElementById('turnDoneBanner').classList.contains('show'),false);assert.match(h.r.document.getElementById('youLastPlayed').innerHTML,/No card played yet/);
});
test('leaving the match clears movement and the turn announcement without losing the reference',async()=>{
 const h=ready(),c=inject(h,'Nemona');await h.r.api.playCard('you',c.id);await h.r.api.endTurnFor('you');h.r.api.leaveMatch();assert.equal(visuals(h.r).length,0);assert.equal(h.r.document.getElementById('turnDoneBanner').classList.contains('show'),false);assert.equal(h.g.lastPlayedCards.you.card.name,'Nemona');
});
test('the real AI play pipeline updates Codex’s last-played card',async()=>{
 const h=ready(),op=h.g.players.codex;op.deck.push(...op.hand.splice(0));const c=inject(h,'Nemona',null,null,'codex');h.g.turn='codex';h.r.api.setLocalAi(true);await h.r.api.aiStep();assert.ok(op.discard.includes(c));assert.equal(h.g.lastPlayedCards.codex.card.id,c.id);assert.match(h.r.document.getElementById('codexLastPlayed').innerHTML,/Nemona/);
});
test('turns with Knockout promotion announce the next turn only after the promotion completes',async()=>{
 const h=ready(),op=h.g.players.codex;h.g.turn='codex';h.g.turnNumber=4;h.p.active.meta.hp=10;const bench=inject(h,"Iono's Tadbulb",'ASC',69);h.p.hand=h.p.hand.filter(c=>c!==bench);h.p.bench=[bench];h.r.api.prepareAttack('codex','ASC','71',['Lightning']);assert.equal(await h.r.api.attack('codex',0),true);assert.equal(h.g.pendingPromotion,'you');assert.equal(h.r.document.getElementById('turnDoneBanner').classList.contains('show'),false);await h.r.api.promote();assert.equal(h.g.turn,'you');assert.match(h.r.document.getElementById('turnDoneBanner').innerHTML,/Your turn/);assert.equal(h.g.pendingPromotion,null);
});
test('new matches and restores clear the previous last-played cards and stale timers',async()=>{
 const h=ready(),c=inject(h,'Nemona');await h.r.api.playCard('you',c.id);const stale=[...h.timers.values()].map(t=>t.fn);h.r.api.setup(h.f,h.r.random,h.r.choose,()=>true,{setupOnly:true});for(const fn of stale)fn();assert.equal(Object.keys(h.r.api.state().lastPlayedCards).length,0);assert.match(h.r.document.getElementById('youLastPlayed').innerHTML,/Revealed after setup/);assert.equal(visuals(h.r).length,0);h.r.api.restoreBackup(h.r.api.backup());h.r.api.render();assert.equal(h.r.api.state(),null);assert.match(h.r.document.getElementById('codexLastPlayed').innerHTML,/No card played yet/);
});
test('movement decorations do not change randomness, card zones, statistics or turn results',async()=>{
 const results=[];for(const enabled of [true,false]){const h=ready();let randomCalls=0,coins=0;h.r.api.setChoices(()=>{randomCalls++;return h.r.random()},h.r.choose,()=>{coins++;return true});if(!enabled)await h.r.document.getElementById('playmatEffectsBtn').click();const c=inject(h,'Nemona');await h.r.api.playCard('you',c.id);assert.equal(await h.r.api.attack('you',0),true);const g=h.r.api.state();results.push(JSON.stringify({players:g.players,lastPlayed:g.lastPlayedCards,turn:g.turn,history:g.matchHistory.players,randomCalls,coins}))}assert.equal(results[0],results[1]);
});

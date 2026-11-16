const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadFixture, createEngineRunner } = require('./integration-harness.cjs');
const tick = () => new Promise(resolve => setImmediate(resolve));
function ready() {
  const fixture=loadFixture();fixture.decks.ai={...fixture.decks.human,id:'visual-opponent'};
  const r=createEngineRunner(fixture,455);r.api.setup(fixture,r.random,r.choose,()=>true);r.api.setLocalAi(false);
  const a=r.api.prepareAttack('you','ASC','71',['Lightning']),d=r.api.prepareAttack('codex','ASC','279',[]);
  const g=r.api.state();g.turn='you';g.players.you.turnsTaken=1;d.meta.hp=9999;d.meta.weaknesses=[];d.meta.resistances=[];
  r.api.clearVisuals();let id=100;const timers=new Map();
  r.context.setTimeout=(callback,delay)=>{timers.set(++id,{callback,delay});return id};r.context.clearTimeout=key=>timers.delete(key);
  for(const side of ['you','codex'])r.document.getElementById(side+'Row').getBoundingClientRect=()=>({left:100,top:side==='you'?400:100,width:100,height:100});
  return {r,fixture,a,d,g,p:g.players.you,timers};
}
function advance(r,timers) {const timer=timers.get(r.api.visualState().timer);assert.ok(timer);timers.delete(r.api.visualState().timer);timer.callback()}
function take(p,predicate){for(const zone of [p.hand,p.deck,p.discard,p.prizes]){const i=zone.findIndex(predicate);if(i>=0)return zone.splice(i,1)[0]}return null}
test('playmat audio defaults on and follows the attack and damage presentation order',async()=>{
  const {r,timers}=ready(), notes=[];
  const parameter={setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}};
  r.context.window.AudioContext=class {
    currentTime=0;
    state='suspended';
    async resume(){this.state='running'}
    async suspend(){this.state='suspended'}
    createGain(){return {gain:parameter,connect(){},disconnect(){}}}
    createOscillator(){return {frequency:parameter,connect(){},disconnect(){},start(at){notes.push(at)},stop(){}}}
  };
  const toggle=r.document.getElementById('playmatSoundBtn');
  assert.equal(require('node:vm').runInContext('playmatSoundEnabled',r.context),true);
  await r.context.unlockDefaultPlaymatSound({});
  await toggle.click();
  await toggle.click();
  assert.equal(toggle.getAttribute('aria-pressed'),'true');
  notes.length=0;
  r.context.queuePlaymatEffect({kind:'attack',side:'you',name:'Test Pokémon',attack:'Test attack'});
  r.context.queuePlaymatEffect({kind:'damage',side:'codex',name:'Target',amount:30});
  assert.deepEqual(notes,[0,.15]);
  advance(r,timers);
  assert.deepEqual(notes,[0,.15,0]);
  await toggle.click();
  assert.equal(toggle.getAttribute('aria-pressed'),'false');
});
test('Ability banners replace a lingering turn announcement without adding another timer',()=>{
  const {r,timers}=ready();
  r.context.showTurnDoneBanner('Your turn');
  assert.equal(r.document.getElementById('turnDoneBanner').classList.contains('show'),true);
  r.context.queueAbilityVisualEffect('you',r.api.state().players.you.active,'Test Ability');
  assert.equal(r.document.getElementById('turnDoneBanner').classList.contains('show'),false);
  assert.equal(r.document.getElementById('turnDoneBanner').innerHTML,'');
  assert.equal(r.api.visualState().active.kind,'ability');
  assert.ok(timers.has(r.api.visualState().timer));
});
function bench(p){let c=p.bench[0];if(!c){c=take(p,c=>c.meta.category==='Pokemon'&&c.meta.stage==='Basic');assert.ok(c);p.bench.push(c)}return c}
async function click(r,side,zone,card){const element={dataset:{side,zone,card:card.id}};await r.document.getElementById(zone==='active'?'battleCenter':side+'Row').dispatchEvent({type:'click',target:{closest:selector=>selector==='[data-card]'?element:null}})}

test('Electric Streamer announces its Pokémon and Ability before its Energy movements and updates Yami',async()=>{
  const {r,p,timers}=ready();
  const bell=r.api.prepareAttack('you','ASC','279',[]);
  const energies=[take(p,c=>c.name==='Lightning Energy'),take(p,c=>c.name==='Lightning Energy')];
  assert.ok(energies.every(Boolean));
  p.hand=energies;
  r.api.clearVisuals();
  r.api.setChoices(r.random,q=>q.kind==='cards'?q.candidates:q.kind==='pokemon-target'?bell:r.choose(q));
  assert.equal(await r.api.useAbility('you',bell.id,'Electric Streamer',false),true);
  assert.equal(r.api.visualState().active.kind,'ability');
  assert.match(r.document.getElementById('playmatEffects').innerHTML,/fx-ability-caption/);
  assert.match(r.document.getElementById('playmatEffects').innerHTML,/Iono&#39;s Bellibolt ex used Electric Streamer!/);
  assert.doesNotMatch(r.document.getElementById('playmatEffects').innerHTML,/fx-impact|fx-spark|fx-trail/);
  assert.match(r.document.getElementById('yamiSpeech').textContent,/Electric Streamer/);
  assert.equal(r.document.getElementById('yamiPortrait').dataset.expression,'thinking');
  assert.equal(bell.energy.length,2);
  advance(r,timers);
  assert.equal(r.api.visualState().active.kind,'card-move');
});

test('cancelled and unsupported Abilities leave no announcement or reaction in the visual queue',async()=>{
  for(const changed of [false,true]){
    const {r,p}=ready(),bell=r.api.prepareAttack('you','ASC','279',[]);
    const energy=take(p,c=>c.name==='Lightning Energy');
    p.hand=[energy];r.api.clearVisuals();
    if(changed)bell.meta.abilities[0].effect+=' Unverified change.';
    r.api.setChoices(r.random,()=>null);
    const before=JSON.stringify(r.api.state().players);
    assert.equal(await r.api.useAbility('you',bell.id,'Electric Streamer',false),false);
    assert.equal(JSON.stringify(r.api.state().players),before);
    assert.equal(r.api.visualState().active,null);
    assert.equal(r.api.visualState().queued.length,0);
    assert.match(r.document.getElementById('yamiSpeech').textContent,/on pause/);
  }
});

test('switch announcements show outgoing Bench movement before the new Active and use the actual board slots',async()=>{
  const {r,p,fixture,timers}=ready(),outgoing=p.active,incoming=bench(p);
  const slot={getBoundingClientRect:()=>({left:400,top:500,width:100,height:120})};
  const original=r.document.getElementById('youRow').querySelector;
  r.document.getElementById('youRow').querySelector=selector=>selector==='.bench-grid'?{children:[slot]}:original(selector);
  r.document.getElementById('youActiveZone').getBoundingClientRect=()=>({left:500,top:300,width:100,height:120});
  const item=inject(fixture,p,'Switch');
  await r.api.playCard('you',item.id);
  const effects=[r.api.visualState().active,...r.api.visualState().queued];
  const outgoingMove=effects.findIndex(effect=>effect.cardId===outgoing.id && effect.destination==='bench');
  const incomingMove=effects.findIndex(effect=>effect.cardId===incoming.id && effect.destination==='active');
  assert.ok(outgoingMove>=0 && incomingMove>outgoingMove);
  assert.deepEqual(JSON.parse(JSON.stringify(effects[incomingMove].from)),{x:450,y:560});
  assert.deepEqual(JSON.parse(JSON.stringify(effects[outgoingMove].point)),{x:450,y:560});
  while(r.api.visualState().active.cardId!==outgoing.id)advance(r,timers);
  assert.match(r.document.getElementById('playmatEffects').innerHTML,/moved to the Bench!/);
  assert.match(r.document.getElementById('yamiSpeech').textContent,/Rearranging/);
  advance(r,timers);
  assert.match(r.document.getElementById('playmatEffects').innerHTML,/moved to the Active Spot!/);
});

test('announcements escape card text and never expose hidden movement identities',()=>{
  const {r}=ready();
  const html=r.context.playmatEffectMarkup({kind:'ability',side:'codex',name:'<unsafe Pokémon>',ability:'<unsafe Ability>'},false);
  assert.match(html,/&lt;unsafe Pokémon&gt; used &lt;unsafe Ability&gt;!/);
  assert.doesNotMatch(html,/<unsafe/);
  assert.equal(r.context.playmatActionAnnouncement({kind:'zone-move',side:'codex',faceDown:true,toZone:'bench',name:'Hidden'}),'');
});
function inject(fixture,p,name){const c={...structuredClone(fixture.cards.find(c=>c.name===name)),id:'test-'+name};assert.ok(c.meta);p.hand.push(c);return c}

for(const heads of [true,false])test('coin animation uses the existing '+(heads?'heads':'tails')+' result exactly once',()=>{
  const {r}=ready();let calls=0;r.api.setChoices(r.random,undefined,()=>{calls++;return heads});assert.equal(r.api.flipVisualCoin(),heads);assert.equal(calls,1);
  assert.equal(r.api.visualState().active.heads,heads);assert.match(r.document.getElementById('playmatEffects').innerHTML,new RegExp('--coin-end:'+(heads?1440:1620)+'deg'));
});
test('a supported attack emits its Pokémon type and actual damage, and clears its effects after playback',async()=>{
  const {r,a,d,timers}=ready();r.api.setChoices(r.random,r.choose,()=>true);assert.equal(await r.api.attack('you',0),true);assert.equal(d.damage,30);
  assert.equal(r.api.visualState().active.kind,'attack');assert.equal(r.api.visualState().active.element,'lightning');assert.match(r.document.getElementById('playmatEffects').innerHTML,/Lightning attack/);
  advance(r,timers);assert.equal(r.api.visualState().active.amount,30);advance(r,timers);assert.equal(r.api.visualState().active.kind,'zone-move');assert.equal(r.api.visualState().active.faceDown,true);advance(r,timers);assert.equal(r.api.visualState().active,null);assert.equal(r.document.getElementById('playmatEffects').innerHTML,'');assert.equal(a.name,"Iono's Wattrel");
});
test('failed attacks discard their coin, attack and damage animations with the rolled-back game changes',async()=>{
  const {r,p}=ready(),before=JSON.stringify(r.api.state().players);r.api.setChoices(r.random,r.choose,()=>true);const restore=r.api.failNextAttackEffectAfterResolve();
  try {assert.equal(await r.api.attack('you',0),false)} finally {restore()}
  assert.equal(JSON.stringify(r.api.state().players),before);assert.equal(r.api.visualState().active,null);assert.equal(r.api.visualState().queued.length,0);assert.equal(r.api.visualState().batches,0);
});
test('Knockout and victory animations are emitted by the real final-Prize attack, only once',async()=>{
  const {r,g,d,timers}=ready();d.meta.hp=10;g.players.you.prizes=g.players.you.prizes.slice(0,1);r.api.setChoices(r.random,r.choose,()=>true);
  assert.equal(await r.api.attack('you',0),true);assert.equal(g.phase,'finished');const kinds=[r.api.visualState().active,...r.api.visualState().queued].map(e=>e.kind);assert.deepEqual(kinds,['attack','damage','knockout','prize','victory']);
  r.api.finishMatch('you','Repeated');r.api.render();assert.equal(r.api.visualState().queued.filter(e=>e.kind==='victory').length,1);
  assert.match(r.document.getElementById('moveLog').innerHTML, /Took 1 Prize/);
  while(r.api.visualState().active.kind!=='victory')advance(r,timers);
  assert.match(r.document.getElementById('playmatEffects').innerHTML,/fx-confetti/);
  assert.doesNotMatch(r.document.getElementById('playmatTurnStatus').innerHTML,/Victory/);
  advance(r,timers);
  assert.equal(r.api.visualState().active,null);
  assert.match(r.document.getElementById('playmatTurnStatus').innerHTML,/Victory/);
});
test('reduced motion retains results without spinning coins, particles or confetti markup',()=>{
  const {r}=ready();r.context.window.matchMedia=()=>({matches:true});r.api.finishMatch('you','All Prizes');assert.equal(r.document.getElementById('playmatEffects').classList.contains('reduced-motion'),true);assert.doesNotMatch(r.document.getElementById('playmatEffects').innerHTML,/fx-confetti/);assert.match(r.document.getElementById('playmatEffectAnnouncement').textContent,/Victory/);
});
test('turning effects off clears old timers and leaves attack results unchanged',async()=>{
  const {r,d,timers}=ready();r.api.flipVisualCoin();const old=timers.get(r.api.visualState().timer).callback;await r.document.getElementById('playmatEffectsBtn').click();assert.equal(r.document.getElementById('playmatEffectsBtn').textContent,'Effects off');old();assert.equal(r.api.visualState().active,null);
  r.api.setChoices(r.random,r.choose,()=>true);assert.equal(await r.api.attack('you',0),true);assert.equal(d.damage,30);assert.equal(r.api.visualState().active,null);
});
test('a broken visual surface cannot fail a legal attack or change its coin result',async()=>{
  const {r,d}=ready(),original=r.document.getElementById;r.document.getElementById=function(id){if(id==='playmatEffects')throw new Error('Display unavailable');return original.call(this,id)};
  r.api.setChoices(r.random,r.choose,()=>false);assert.equal(await r.api.attack('you',0),true);assert.equal(d.damage,10);
});
test('new restore clears any old animation without replaying its timer',()=>{
  const {r,timers}=ready();r.api.flipVisualCoin();const old=timers.get(r.api.visualState().timer).callback;r.api.restoreBackup(r.api.backup());old();assert.equal(r.api.visualState().active,null);assert.equal(r.api.state(),null);
});
test('Tools target live Pokémon directly on the playmat, while invalid clicks keep the choice open',async()=>{
  const {r,fixture,p,d}=ready(),tool=inject(fixture,p,'Bravery Charm');r.api.setChoices(r.random,undefined);const playing=r.api.playCard('you',tool.id);
  assert.ok(r.api.report().context.pendingBoardChoice);assert.equal(r.api.report().context.pendingCardChoice,null);await click(r,'codex','active',d);assert.equal(r.api.pendingChoices(),true);
  await click(r,'you','active',p.active);await playing;assert.ok(p.active.tools.includes(tool));assert.ok(!p.hand.includes(tool));
});
test('Pokémon Catcher highlights and accepts opposing Bench targets, keeping the Active Pokémon ineligible',async()=>{
  const {r,fixture,p,g,d}=ready(),op=g.players.codex,b=bench(op),card=inject(fixture,p,'Pokémon Catcher');r.api.setChoices(r.random,undefined,()=>true);const playing=r.api.playCard('you',card.id);
  await tick();
  assert.ok(r.api.report().context.pendingBoardChoice.targets.some(c=>c.id===b.id));await click(r,'codex','active',d);assert.equal(r.api.pendingChoices(),true);await click(r,'codex','bench',b);await playing;
  assert.equal(op.active,b);assert.ok(op.bench.includes(d));assert.ok(p.discard.includes(card));
});
test('Energy Switch selects its source Pokémon, Energy card, and different destination in order',async()=>{
  const {r,fixture,p}=ready(),b=bench(p),source=p.active,energy=source.energy[0],card=inject(fixture,p,'Energy Switch');r.api.setChoices(r.random,undefined);const playing=r.api.playCard('you',card.id);
  assert.match(r.api.report().context.pendingBoardChoice.title,/move Basic Energy from/);await click(r,'you','active',source);await tick();const choice=r.api.report().context.pendingCardChoice;assert.ok(choice);assert.equal(r.document.getElementById('cardChoiceOverlay').dataset.docked,'true');r.api.setCardChoiceIds([choice.cards[0].id]);await r.document.getElementById('cardChoiceConfirmBtn').click();await tick();
  assert.ok(r.api.report().context.pendingBoardChoice.targets.every(c=>c.id!==source.id));const attached=r.api.state().matchHistory.players.you.energyAttached;await click(r,'you','active',source);assert.equal(r.api.pendingChoices(),true);await click(r,'you','bench',b);await playing;assert.ok(b.energy.includes(energy));assert.ok(!source.energy.includes(energy));assert.ok(p.discard.includes(card));assert.equal(r.api.state().matchHistory.players.you.energyAttached,attached);
});
test('canceling board targeting preserves the Trainer and all card zones',async()=>{
  const {r,fixture,p}=ready(),card=inject(fixture,p,'Bravery Charm'),before=JSON.stringify(r.api.state().players);r.api.setChoices(r.random,undefined);const playing=r.api.playCard('you',card.id);r.api.cancelActiveBoardChoice();await playing;assert.equal(JSON.stringify(r.api.state().players),before);
});
test('Rare Candy can be canceled at either choice, and its Stage 2 picker docks beside the board', async () => {
  const {r,fixture,g,p}=ready();
  g.turnNumber=3;
  p.active={...structuredClone(fixture.cards.find(card=>card.name==='Dratini')),id:'candy-base',energy:[],tools:[],conditions:[],evolutionStack:[],enteredTurn:0};
  p.bench=[];
  const candy=inject(fixture,p,'Rare Candy'), evolution=inject(fixture,p,'Dragonite');
  r.api.setChoices(r.random,undefined);
  const before=JSON.stringify(r.api.state().players);
  const prompt=r.document.getElementById('boardTargetPrompt');
  let playing=r.api.playCard('you',candy.id);
  assert.equal(prompt.hidden,false);
  await r.document.getElementById('cancelBoardTargetBtn').click();
  await playing;
  assert.equal(JSON.stringify(r.api.state().players),before);
  playing=r.api.playCard('you',candy.id);
  await click(r,'you','active',r.api.state().players.you.active);
  await tick();
  assert.equal(r.document.getElementById('cardChoiceOverlay').dataset.docked,'true');
  assert.equal(r.document.getElementById('cardChoiceCancelBtn').disabled,false);
  await r.document.getElementById('cardChoiceCancelBtn').click();
  await playing;
  assert.equal(JSON.stringify(r.api.state().players),before);
  playing=r.api.playCard('you',candy.id);
  await click(r,'you','active',r.api.state().players.you.active);
  await tick();
  r.api.setCardChoiceIds([evolution.id]);
  await r.document.getElementById('cardChoiceConfirmBtn').click();
  await playing;
  assert.equal(r.api.state().players.you.active.id,evolution.id);
  assert.ok(r.api.state().players.you.discard.some(card=>card.id===candy.id));
});
test('ordinary Evolution can cancel and retry without consuming the card or Undo', async () => {
  const {r,fixture,g,p}=ready();
  g.turnNumber=3;
  p.active={...structuredClone(fixture.cards.find(card=>card.name==='Dratini')),id:'evolve-base',energy:[],tools:[],conditions:[],evolutionStack:[],enteredTurn:0};
  p.bench=[];
  const evolution=inject(fixture,p,'Dragonair');
  r.api.setChoices(r.random,undefined);
  r.api.selectHandCard('you',evolution.id);
  const evolve=r.document.getElementById('evolveBtn');
  const before=JSON.stringify(r.api.state().players);
  const canceled=evolve.click();
  assert.equal(r.api.pendingChoices(),true);
  assert.equal(r.document.getElementById('endTurnBtn').disabled,true);
  await r.document.getElementById('cancelBoardTargetBtn').click();
  await canceled;
  assert.equal(JSON.stringify(r.api.state().players),before);
  assert.equal(r.document.getElementById('undoBtn').disabled,true);
  const committed=evolve.click();
  await click(r,'you','active',p.active);
  await committed;
  assert.equal(r.api.state().players.you.active.id,evolution.id);
  r.api.undo();
  assert.equal(JSON.stringify(r.api.state().players),before);
  assert.equal(r.api.pendingChoices(),false);
});
test('clicking Energy only inspects it, while Attach Energy opens a cancellable target choice', async () => {
  const {r,fixture,p}=ready(), energy=inject(fixture,p,'Lightning Energy');
  p.energyAttachedThisTurn=false;
  r.api.setChoices(r.random,undefined);
  r.api.selectHandCard('you',energy.id);
  assert.match(r.document.getElementById('cardInspector').innerHTML,/Lightning Energy/);
  await click(r,'you','active',p.active);
  assert.ok(p.hand.includes(energy));
  assert.equal(p.energyAttachedThisTurn,false);
  assert.equal(r.api.pendingChoices(),false);
  r.api.selectHandCard('you',energy.id);
  const attach=r.document.getElementById('attachBtn');
  const canceled=attach.click();
  assert.equal(r.api.pendingChoices(),true);
  await r.document.getElementById('cancelBoardTargetBtn').click();
  await canceled;
  assert.ok(p.hand.includes(energy));
  assert.equal(p.energyAttachedThisTurn,false);
  const committed=attach.click();
  await click(r,'you','active',p.active);
  await committed;
  assert.ok(p.active.energy.includes(energy));
  assert.equal(p.energyAttachedThisTurn,true);
});
test('the center contains both Active Pokémon and the Stadium; benches keep their own targets',()=>{
  const {r,p,d}=ready();r.api.render();assert.ok(r.document.getElementById('youActiveZone').innerHTML.includes(p.active.id.replaceAll("'",'&#39;')));assert.ok(r.document.getElementById('codexActiveZone').innerHTML.includes(d.id.replaceAll("'",'&#39;')));assert.doesNotMatch(r.document.getElementById('youRow').innerHTML,/data-zone="active"/);assert.doesNotMatch(r.document.getElementById('codexRow').innerHTML,/data-zone="active"/);
});
test('discard piles show the actual last public card and still open the existing viewer',async()=>{
  const {r,p}=ready(),first=take(p,c=>c.name==='Judge'),last=take(p,c=>c.name==='Great Ball');p.discard.push(first,last);r.api.render();const html=r.document.getElementById('youRow').innerHTML;assert.match(html,/Top: Great Ball/);assert.match(html,/discard-top-name">Great Ball/);assert.match(html,/sv02\/183\/low.webp/);
  await r.document.getElementById('youRow').dispatchEvent({type:'click',target:{closest:s=>s==='[data-discard-side]'?{dataset:{discardSide:'you'}}:null}});assert.match(r.document.getElementById('discardViewerGrid').innerHTML,/Great Ball/);
});
test('Prize positions show remaining and taken cards without leaking hidden card names or artwork',()=>{
  const {r,p}=ready();p.prizes=p.prizes.slice(0,3);for(const c of p.prizes){c.name='HIDDEN_PRIZE_SENTINEL';c.meta.image='https://assets.tcgdex.net/hidden-prize.webp'}r.api.render();const html=r.document.getElementById('youRow').innerHTML;assert.equal((html.match(/class="prize-slot/g)||[]).length,6);assert.equal((html.match(/prize-slot taken/g)||[]).length,3);assert.match(html,/3 Prize cards remaining, 3 taken/);assert.doesNotMatch(html,/HIDDEN_PRIZE_SENTINEL|hidden-prize.webp/);
});

test('the volume slider scales sound cues and zero silences them', async () => {
  const {r} = ready();
  const peaks = [];
  const frequency = {setValueAtTime(){}, exponentialRampToValueAtTime(){}};
  r.context.window.AudioContext = class {
    currentTime = 0;
    state = 'suspended';
    async resume() { this.state = 'running'; }
    createOscillator() { return {frequency, connect(){}, start(){}, stop(){}}; }
    createGain() {
      return {connect(){}, gain: {...frequency, linearRampToValueAtTime(peak) { peaks.push(peak); }}};
    }
  };
  await r.context.unlockDefaultPlaymatSound({});
  const slider = r.document.getElementById('playmatVolume');
  slider.value = '25';
  await slider.dispatchEvent({type:'input'});
  r.context.playPlaymatSound('damage');
  assert.deepEqual(peaks, [.055 * .25]);
  assert.equal(r.document.getElementById('playmatVolumeValue').textContent, '25%');
  assert.equal(r.context.localStorage.getItem('codexPokemonPlaymat.volume.v1'), '25');

  slider.value = '0';
  await slider.dispatchEvent({type:'input'});
  r.context.playPlaymatSound('damage');
  assert.equal(peaks.length, 1);
});

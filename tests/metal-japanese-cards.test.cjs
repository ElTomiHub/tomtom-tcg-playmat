const assert=require('node:assert/strict');
const {test}=require('node:test');
const {loadFixture,createEngineRunner}=require('./integration-harness.cjs');
const additions=require('./fixtures/metal-and-japanese-cards.fixture.json').cards;
const extra=require('./fixtures/additional-library-cards.fixture.json').cards;
const base=loadFixture(),fixture={...base,cards:[...base.cards,...extra,...additions]};
const energy=(id,type='Metal')=>({id,name:type+' Energy',meta:{category:'Energy',energyType:type},energy:[],tools:[]});
const record=(name,set,num)=>additions.find(c=>c.name===name&&(!set||c.setCode===set)&&(!num||c.cardNumber===String(num)));
function instance(original,id='card') {return {...structuredClone(original),id,energy:[],tools:[],conditions:[],damage:0,evolutionStack:[],enteredTurn:0,evolvedTurn:-1}}
function ready(name,set,num,side='you',ai=false) {
 const r=createEngineRunner(fixture,71);r.api.setup(fixture,r.random,r.choose,()=>true);r.api.setLocalAi(ai);
 const g=r.api.state(),p=g.players[side],other=side==='you'?'codex':'you';g.phase='play';g.turn=side;g.turnNumber=3;g.pendingPromotion=null;p.turnsTaken=1;p.supporterPlayedThisTurn=false;p.energyAttachedThisTurn=false;p.attackedThisTurn=false;
 const c=instance(record(name,set,num),'new:'+name);if(c.meta.category==='Pokemon'){p.deck.push(p.active);p.active=c;}else p.hand.push(c);
 const target=g.players[other].active;target.meta.hp=9999;target.meta.weaknesses=[];target.meta.resistances=[];
 return {r,g,p,c,target,side,other};
}
const fingerprint=g=>JSON.stringify({players:g.players,turn:g.turn,turnNumber:g.turnNumber,stadium:g.stadium,usage:g.stadiumUsage,history:g.matchHistory,bonuses:g.damageReductions});
function bench(h,name='Duraludon',set='PRE',num=69,id='bench'){const c=instance(record(name,set,num),id);h.p.bench.push(c);return c}
function cardsInDeck(h,list){h.p.hand.push(...h.p.deck.splice(0));h.p.deck.push(...list);return list}

test('all 28 exact new printings resolve as automated',()=>{const audit=createEngineRunner(fixture).api.inspectFixture(fixture).filter(c=>additions.some(a=>a.name===c.name&&a.setCode===c.setCode&&a.cardNumber===c.cardNumber));assert.equal(audit.length,28);assert.deepEqual(audit.filter(c=>c.resolution!=='automated').map(c=>c.name),[])});
for(const original of additions)for(const mismatch of ['print','language','text'])test(original.name+' '+original.setCode+' '+original.cardNumber+' fails closed for '+mismatch+' mismatch',()=>{
 const f=structuredClone(fixture),c=f.cards.find(c=>c.name===original.name&&c.setCode===original.setCode&&c.cardNumber===original.cardNumber);if(mismatch==='print')c.cardNumber='999';else if(mismatch==='language')c.language=c.language==='ja'?'en':'ja';else if(c.meta.category==='Pokemon')c.meta.attacks[0].effect+=' Extra effect.';else c.meta.effect+=' Extra effect.';
 const audit=createEngineRunner(f).api.inspectFixture(f).find(a=>a.name===c.name&&a.setCode===c.setCode&&a.cardNumber===c.cardNumber);assert.notEqual(audit.resolution,'automated');
});
test('missing damage-only text is repaired only for the verified print, attack cost and damage',async()=>{
 const r=createEngineRunner(fixture),saved=structuredClone(additions.filter(c=>c.language==='en'));
 for(const c of saved)for(const a of c.meta.attacks)if(!a.effect){a.effect=null;a.effectTextStatus='missing'}
 r.api.loadSavedLibrary(saved);await r.api.checkLibrary();for(const c of r.api.libraryAudit().filter(c=>c.id.startsWith('verified:')))assert.equal(c.status,'implemented',c.name);
 const bad=structuredClone(saved.find(c=>c.name==='Duraludon'&&c.setCode==='PRE'));bad.meta.attacks[0].cost=['Fire'];r.api.loadSavedLibrary([bad]);await r.api.checkLibrary();const loaded=r.api.libraryAudit().find(c=>c.id===bad.id);assert.equal(loaded.status,'registered');assert.equal(loaded.meta.attacks[0].effect,null);
});
for(const original of additions.filter(c=>c.language==='ja'))test(original.name+' unchecked Japanese print is repaired offline with English translation and original artwork',async()=>{
 const r=createEngineRunner(fixture),saved={id:'unchecked:'+original.name,name:original.name,setCode:original.setCode,cardNumber:original.cardNumber,categoryHint:'Pokemon',meta:null,lookupError:'NetworkError'};r.api.loadSavedLibrary([saved]);await r.api.checkLibrary();const c=r.api.libraryAudit().find(c=>c.id===saved.id);assert.equal(c.status,'implemented');assert.equal(c.language,'ja');assert.equal(c.meta.textLanguage,'en');assert.match(c.meta.image,/\/tpc\//);assert.equal(c.meta.translationStatus,'unofficial');assert.equal(c.lookupError,undefined);assert.equal((await r.api.fetchDetails(saved)).language,'ja');
});
test('Japanese cards require exact translation provenance; unverified foreign metadata is not silently converted',()=>{
 for(const field of ['textLanguage','translationSource','translationStatus','sourceUrl']){const c=structuredClone(record('Tornadus'));c.meta[field]='unknown';const f={...fixture,cards:[c]};assert.equal(createEngineRunner(f).api.inspectFixture(f)[0].resolution,'manual')}
 const r=createEngineRunner(fixture),c={id:'foreign',name:'Tornadus',setCode:'M6',cardNumber:'59',language:'fr',meta:null};r.api.repairMetadata(c);assert.equal(c.meta,null);assert.equal(c.language,'fr');
});
for(const side of ['you','codex']) {
 test('Gloria benches up to three eligible non-Rule-Box Basics and respects capacity for '+side,async()=>{
  const h=ready('Gloria',null,null,side,side==='codex');h.p.bench=h.p.bench.slice(0,3);while(h.p.bench.length<3)bench(h,'Varoom','PAF',64,'old'+h.p.bench.length);
  const a=instance(record('Duraludon','PRE'),'a'),b=instance(record('Varoom','PAF'),'b'),ex=instance(record('Archaludon ex'),'ex');ex.meta.stage='Basic';const radiant={...instance(a,'radiant'),name:'Radiant Test'};cardsInDeck(h,[a,b,ex,radiant]);h.r.api.setChoices(h.r.random,q=>q.kind==='cards'?q.candidates.slice(0,2):q.candidates[0]);await h.r.api.playCard(side,h.c.id);assert.equal(h.p.bench.length,5);assert.ok(h.p.bench.includes(a)&&h.p.bench.includes(b));assert.ok(h.p.deck.includes(ex)&&h.p.deck.includes(radiant));assert.ok(h.p.discard.includes(h.c));
 });
 test('Professor Research and Shauna use their existing draw transactions for '+side,async()=>{
  for(const [name,count]of[["Professor's Research",7],['Shauna',5]]){const h=ready(name,null,null,side,side==='codex');await h.r.api.playCard(side,h.c.id);assert.equal(h.p.hand.length,count);assert.ok(h.p.discard.includes(h.c));assert.equal(h.p.supporterPlayedThisTurn,true)}
 });
 test('Boss Orders switches an opposing Bench Pokémon through the shared targeting flow for '+side,async()=>{
  const h=ready("Boss's Orders",null,null,side,side==='codex'),op=h.g.players[h.other],old=op.active,b=instance(record('Duraludon','PRE'),'op-bench');op.bench=[b];h.r.api.setChoices(h.r.random,q=>q.candidates[0]);await h.r.api.playCard(side,h.c.id);assert.equal(op.active,b);assert.ok(op.bench.includes(old));assert.ok(h.p.discard.includes(h.c));
 });
 test('Cyrano accepts modern Pokémon ex and excludes older uppercase EX for '+side,async()=>{
  const h=ready('Cyrano',null,null,side,side==='codex'),yes=instance(record('Archaludon ex'),'yes'),no={...instance(yes,'no'),name:'Archaludon-EX'};cardsInDeck(h,[yes,no]);h.r.api.setChoices(h.r.random,q=>q.candidates);await h.r.api.playCard(side,h.c.id);assert.ok(h.p.hand.includes(yes));assert.ok(h.p.deck.includes(no));
 });
 test('Arven selects an Item and a Tool separately for '+side,async()=>{
  const h=ready('Arven',null,null,side,side==='codex'),item=instance(record('Metal Saucer'),'item'),tool=instance(record('Leftovers'),'tool'),supporter=instance(record('Sonia'),'supporter');cardsInDeck(h,[item,tool,supporter]);h.r.api.setChoices(h.r.random,q=>q.candidates.slice(0,1));await h.r.api.playCard(side,h.c.id);assert.ok(h.p.hand.includes(item)&&h.p.hand.includes(tool));assert.ok(h.p.deck.includes(supporter));
 });
 test('Team Star Grunt puts one opposing attached Energy on top of its owner’s deck for '+side,async()=>{
  const h=ready('Team Star Grunt',null,null,side,side==='codex'),op=h.g.players[h.other],e=instance(record('Prism Energy'),'prism');op.active.energy=[e];h.r.api.setChoices(h.r.random,q=>q.candidates[0]);await h.r.api.playCard(side,h.c.id);assert.equal(op.active.energy.length,0);assert.equal(op.deck.at(-1),e);assert.ok(h.p.discard.includes(h.c));
 });
 test('Energy Retrieval recovers Basic Energy and excludes Prism Energy for '+side,async()=>{
  const h=ready('Energy Retrieval',null,null,side,side==='codex'),m=energy('m'),w=energy('w','Water'),prism=instance(record('Prism Energy'),'prism');h.p.discard.push(m,w,prism);h.r.api.setChoices(h.r.random,q=>q.candidates.slice(0,2));await h.r.api.playCard(side,h.c.id);assert.ok(h.p.hand.includes(m)&&h.p.hand.includes(w));assert.ok(h.p.discard.includes(prism)&&h.p.discard.includes(h.c));
 });
 test('Metal Saucer attaches only eligible Metal Energy to a Benched Metal Pokémon for '+side,async()=>{
  const h=ready('Metal Saucer',null,null,side,side==='codex'),target=bench(h),m=energy('m'),prism=instance(record('Prism Energy'),'prism');h.p.discard.push(m,prism);h.r.api.setChoices(h.r.random,q=>q.kind==='pokemon-target'?target:q.candidates[0]);await h.r.api.playCard(side,h.c.id);assert.ok(target.energy.includes(m));assert.ok(h.p.discard.includes(prism));assert.equal(h.p.energyAttachedThisTurn,false);
 });
 test('Rumbling Engine discards Energy from hand, draws to six and is once per Pokémon per turn for '+side,async()=>{
  const h=ready('Revavroom',null,null,side,side==='codex');h.p.deck.push(...h.p.hand.splice(0));const e=instance(record('Prism Energy'),'prism');h.p.hand.push(e);h.r.api.setChoices(h.r.random,q=>q.candidates[0]);assert.equal(await h.r.api.useAbility(side,h.c.id,'Rumbling Engine',false),true);assert.equal(h.p.hand.length,6);assert.ok(h.p.discard.includes(e));assert.equal(await h.r.api.useAbility(side,h.c.id,'Rumbling Engine',false),false);
 });
 test('Cycling Road discards a Basic Energy from hand and tracks each player’s use for '+side,async()=>{
  const h=ready('Cycling Road',null,null,side,side==='codex');h.g.stadium={card:h.c,owner:h.other};h.p.hand=h.p.hand.filter(c=>c!==h.c);h.p.deck.push(...h.p.hand.filter(c=>c.meta?.category==='Energy'));h.p.hand=h.p.hand.filter(c=>c.meta?.category!=='Energy');const e=energy('m');h.p.hand.push(e);const size=h.p.hand.length;h.r.api.setChoices(h.r.random,q=>[e.id]);assert.equal(await h.r.api.useStadium(side),true);assert.equal(h.p.hand.length,size);assert.ok(h.p.discard.includes(e));assert.equal(await h.r.api.useStadium(side),false);
 });
}
for(const mode of ['pokemon','energy'])test('Sonia chooses '+mode+' without mixing the two search categories',async()=>{
 const h=ready('Sonia'),p=instance(record('Varoom','PAF'),'pokemon1'),e=energy('energy1');cardsInDeck(h,[p,e]);h.r.api.setChoices(h.r.random,q=>q.title.includes(' OR ')?[mode]:q.candidates);await h.r.api.playCard('you',h.c.id);assert.ok(h.p.hand.includes(mode==='pokemon'?p:e));assert.ok(h.p.deck.includes(mode==='pokemon'?e:p));
});
for(const name of ['Gloria','Sonia','Arven','Cyrano','Energy Retrieval','Metal Saucer'])test(name+' cancellation rolls back source card, choices and turn allowance',async()=>{
 const h=ready(name);h.p.discard.push(energy('m'));bench(h);h.p.deck.push(instance(record('Varoom','PAF'),'search-basic'),instance(record('Archaludon ex'),'search-ex'),instance(record('Metal Saucer'),'search-item'),instance(record('Leftovers'),'search-tool'));const before=fingerprint(h.g);h.r.api.setChoices(h.r.random,()=>null);await h.r.api.playCard('you',h.c.id);assert.equal(fingerprint(h.r.api.state()),before);
});
test('Arven revalidates a card’s type after the later choice',async()=>{
 const h=ready('Arven'),item=instance(record('Metal Saucer'),'item'),tool=instance(record('Leftovers'),'tool');cardsInDeck(h,[item,tool]);const before=fingerprint(h.g);h.r.api.setChoices(h.r.random,q=>{if(q.title.includes('Tool'))item.meta.trainerType='Supporter';return q.candidates.slice(0,1)});await h.r.api.playCard('you',h.c.id);assert.equal(fingerprint(h.r.api.state()),before);
});
test('Prism supplies one flexible unit only on Basics, changes on evolution and never supplies two units',()=>{
 const h=ready('Duraludon','PRE'),e=instance(record('Prism Energy'),'prism');h.c.energy=[e];assert.deepEqual(Array.from(h.r.api.energyUnits(e,h.c)),['any']);assert.equal(h.r.api.canPay(h.c,{cost:['Water','Lightning']}),false);h.c.meta.stage='Stage1';assert.deepEqual(Array.from(h.r.api.energyUnits(e,h.c)),['colorless']);assert.equal(h.r.api.canPay(h.c,{cost:['Metal']}),false);e.cardNumber='999';assert.deepEqual(Array.from(h.r.api.energyUnits(e,h.c)),[]);
});
test('Metal Bridge checks the recipient’s current Metal Energy provision, including conditional Prism',()=>{
 const h=ready('Archaludon','PRE'),target=bench(h);target.meta.retreat=3;assert.equal(h.r.api.retreatCost(target),3);target.energy=[energy('m')];assert.equal(h.r.api.retreatCost(target),0);target.energy=[instance(record('Prism Energy'),'prism')];assert.equal(h.r.api.retreatCost(target),0);target.meta.stage='Stage1';assert.equal(h.r.api.retreatCost(target),3);h.c.cardNumber='999';target.energy=[energy('m')];assert.equal(h.r.api.retreatCost(target),3);
});
test('an unverified Prism print cannot provide Energy through a misleading Energy type field',()=>{
 const h=ready('Duraludon','PRE'),e=instance(record('Prism Energy'),'prism');e.cardNumber='999';e.meta.energyType='Colorless';assert.deepEqual(Array.from(h.r.api.energyUnits(e,h.c)),[]);
});
test('Assemble Alloy triggers only on hand evolution, attaches up to two discarded Basic Metal in any distribution',async()=>{
 const h=ready('Duraludon','PRE'),evo=instance(record('Archaludon ex'),'evo'),target=bench(h,'Varoom','PAF',64,'target'),m1=energy('m1'),m2=energy('m2'),prism=instance(record('Prism Energy'),'prism');h.p.hand.push(evo);h.p.discard.push(m1,m2,prism);let n=0;h.r.api.setChoices(h.r.random,q=>q.kind==='cards'?q.candidates:q.kind==='pokemon-target'?++n===1?evo:target:q.candidates[0]);await h.r.api.evolveFor('you',evo.id,h.c.id);assert.equal(h.p.active,evo);assert.ok(evo.energy.includes(m1));assert.ok(target.energy.includes(m2));
 const visuals=h.r.api.visualState();
 const events=[visuals.active,...visuals.queued].filter(Boolean);
 const evolution=events.findIndex(event=>event.kind==='card-move' && event.cardId===evo.id);
 const ability=events.findIndex(event=>event.kind==='ability' && event.ability==='Assemble Alloy');
 const attachment=events.findIndex(event=>event.cardId===m1.id);
 assert.ok(evolution>=0 && ability>evolution && attachment>ability);
 assert.ok(h.p.discard.includes(prism));assert.equal(h.p.energyAttachedThisTurn,false);assert.equal(await h.r.api.useAbility('you',evo.id,'Assemble Alloy',false),false);
});
test('canceling Assemble Alloy restores the evolution and all Energy zones',async()=>{
 const h=ready('Duraludon','PRE'),evo=instance(record('Archaludon ex'),'evo');h.p.hand.push(evo);h.p.discard.push(energy('m'));const before=fingerprint(h.g);h.r.api.setChoices(h.r.random,()=>null);await h.r.api.evolveFor('you',evo.id,h.c.id);assert.equal(fingerprint(h.r.api.state()),before);
});
for(const original of additions.filter(c=>c.meta.category==='Pokemon'))for(const a of original.meta.attacks)test(original.name+' '+original.setCode+' '+original.cardNumber+' executes '+a.name,async()=>{
 const h=ready(original.name,original.setCode,original.cardNumber);const type=h.c.meta.types[0]==='Colorless'?'Metal':h.c.meta.types[0];h.c.energy=Array.from({length:6},(_,i)=>energy('cost'+i,type));h.c.damage=a.name==='Raging Hammer'?40:0;h.p.discard.push(energy('recover1'),energy('recover2','Water'));h.r.api.setChoices(h.r.random,q=>q.kind==='cards'?q.candidates.slice(0,q.maxCount??1):q.kind==='confirm'?true:q.candidates?.[0],()=>true);const index=h.c.meta.attacks.findIndex(x=>x.name===a.name),ids=a.name==='Duralubeam'?h.c.energy.slice(0,2).map(c=>c.id):[];assert.equal(await h.r.api.attack('you',index,ids),true,a.name);assert.equal(h.g.turn,'codex');assert.ok(h.g.log.some(e=>e.message.includes(a.name)));
});
test('Roost heals and prevents retreat on the next own turn, while a switching effect removes the lock',async()=>{
 const h=ready('Skarmory');h.c.energy=[energy('m')];h.c.damage=70;bench(h);await h.r.api.attack('you',0);assert.equal(h.c.damage,20);h.g.turn='you';h.g.turnNumber=5;h.p.retreatedThisTurn=false;assert.equal(h.r.api.canRetreat('you'),false);const sw=instance(base.cards.find(c=>c.name==='Switch'),'switch');h.p.hand.push(sw);h.r.api.setChoices(h.r.random,q=>q.candidates[0]);await h.r.api.playCard('you',sw.id);assert.equal(h.c.retreatLockUntilTurn,undefined);
});
test('Iron Defender stacks after Weakness/Resistance, includes newcomers, and expires after the opponent’s turn',async()=>{
 const h=ready('Iron Defender');await h.r.api.playCard('you',h.c.id);const next=instance(record('Iron Defender'),'second');h.p.hand.push(next);await h.r.api.playCard('you',next.id);const target=bench(h);target.meta.hp=9999;target.meta.weaknesses=[{type:'Fire',value:'×2'}];target.meta.resistances=[];h.g.players.codex.active.meta.types=['Fire'];h.g.turn='codex';h.g.turnNumber=4;await h.r.api.damagePokemon('codex','you',target,'bench',100);assert.equal(target.damage,40);h.g.turnNumber=6;await h.r.api.damagePokemon('codex','you',target,'bench',100);assert.equal(target.damage,140);
});
test('Thundurus ignores defensive reductions but respects removed Weakness and printed Resistance',async()=>{
 const h=ready('Thundurus');h.c.energy=[energy('l1','Lightning'),energy('l2','Lightning'),energy('l3','Lightning')];h.target.meta.types=['Metal'];h.target.meta.weaknesses=[{type:'Lightning',value:'×2'}];h.target.meta.resistances=[{type:'Lightning',value:'-30'}];h.target.noWeaknessUntilTurn=3;h.target.attackDamageReduction={expiresTurn:3,amount:30};h.g.damageReductions=[{side:'codex',expiresTurn:3,amount:30,type:'metal'}];assert.equal(await h.r.api.attack('you',0),true);assert.equal(h.target.damage,60);
});
test('Metal Defender and Wild Drift apply only through the next opposing turn and clear when switched',async()=>{
 for(const [name,property]of[['Archaludon ex','noWeaknessUntilTurn'],['Revavroom ex','attackDamageReduction']]){const h=ready(name);h.c.energy=Array.from({length:3},(_,i)=>energy('m'+i));await h.r.api.attack('you',0);assert.ok(h.c[property]);h.g.turn='you';h.g.turnNumber=5;h.p.retreatedThisTurn=false;const target=bench(h),sw=instance(base.cards.find(c=>c.name==='Switch'),'switch');h.p.hand.push(sw);h.r.api.setChoices(h.r.random,q=>q.candidates.find(c=>c.id===target.id)||q.candidates[0]);await h.r.api.playCard('you',sw.id);assert.equal(h.c[property],undefined)}
});
test('Leftovers heals only the ending player’s Active before Poison is checked',async()=>{
 const h=ready('Duraludon','PRE');h.c.damage=120;h.c.conditions=[{type:'poisoned'}];h.c.tools=[instance(record('Leftovers'),'left')];const b=bench(h);b.damage=30;b.tools=[instance(record('Leftovers'),'bench-left')];h.target.damage=30;h.target.tools=[instance(record('Leftovers'),'op-left')];await h.r.api.endTurnFor('you');assert.equal(h.c.damage,110);assert.equal(b.damage,30);assert.equal(h.target.damage,30);assert.notEqual(h.g.phase,'finished');
});
test('Tune-up permits four Tools, prevents a fifth and discards excess Tools when the Ability is lost',async()=>{
 const h=ready('Revavroom ex');h.p.bench=[];h.r.api.setChoices(h.r.random,q=>q.kind==='pokemon-target'?h.c:q.candidates.slice(0,q.minCount||1));for(let i=0;i<5;i++){const tool=instance(record('Leftovers'),'tool'+i);h.p.hand.push(tool);await h.r.api.playCard('you',tool.id)}assert.equal(h.c.tools.length,4);assert.ok(h.p.hand.some(c=>c.id==='tool4'));const current=h.r.api.state().players.you;current.active.meta.abilities=[];assert.equal(await h.r.api.enforceToolCapacity('you',current.active),true);assert.equal(current.active.tools.length,1);assert.equal(current.discard.filter(c=>/^tool[0-3]$/.test(c.id)).length,3);
});
test('Incarnate Union checks all four exact Pokémon names and removes only Colorless attack costs',()=>{
 const h=ready('Thundurus');h.p.bench=[];for(const name of ['Tornadus','Landorus','Enamorus'])bench(h,name,'M6',record(name).cardNumber,name);h.c.energy=[];assert.equal(h.r.api.canPay(h.c,h.c.meta.attacks[0]),false);h.c.energy=[energy('l','Lightning')];assert.equal(h.r.api.canPay(h.c,h.c.meta.attacks[0]),true);h.p.bench.pop();assert.equal(h.r.api.canPay(h.c,h.c.meta.attacks[0]),false);
});
test('a failed new attack rolls back its effects and emits no committed decorations',async()=>{
 const h=ready('Klefki');h.c.energy=[energy('m')];h.r.api.clearVisuals();const before=fingerprint(h.g),restore=h.r.api.failNextAttackEffectAfterResolve();h.r.api.setChoices(h.r.random,q=>q.candidates[0]);try{assert.equal(await h.r.api.attack('you',0),false)}finally{restore()}assert.equal(fingerprint(h.r.api.state()),before);assert.equal(h.r.api.visualState().active,null);
});
for(const original of additions.filter(c=>c.meta.trainerType==='Supporter'))test(original.name+' obeys the opening-turn and once-per-turn Supporter limits',async()=>{
 for(const lock of ['opening','used']){const h=ready(original.name);h.g.firstPlayer='you';h.p.turnsTaken=lock==='opening'?0:1;h.p.supporterPlayedThisTurn=lock==='used';h.target.energy=[energy('op-energy')];h.g.players.codex.bench=[instance(record('Varoom','PAF'),'op-bench')];const before=fingerprint(h.g);await h.r.api.playCard('you',h.c.id);assert.equal(fingerprint(h.r.api.state()),before)}
});
test('verified alternate complete Boss and Prism wordings remain supported without rewriting the saved text',()=>{
 const variants=[["Boss's Orders","Switch in 1 of your opponent's Benched Pokémon to the Active Spot."],['Prism Energy','As long as this card is attached to a Pokémon, it provides {C} Energy.\n\nIf this card is attached to a Basic Pokémon, this card provides every type of Energy but provides only 1 Energy at a time.']];
 for(const [name,effect]of variants){const c=structuredClone(record(name));c.meta.effect=effect;const f={...fixture,cards:[c]},r=createEngineRunner(f);assert.equal(r.api.inspectFixture(f)[0].resolution,'automated');assert.equal(c.meta.effect,effect)}
});
test('Gloria cannot be played with a full Bench; empty optional searches remain valid',async()=>{
 const h=ready('Gloria');while(h.p.bench.length<5)bench(h,'Varoom','PAF',64,'b'+h.p.bench.length);const before=fingerprint(h.g);await h.r.api.playCard('you',h.c.id);assert.equal(fingerprint(h.r.api.state()),before);
 for(const name of ['Gloria','Sonia','Arven','Cyrano']){const h=ready(name);h.p.bench=[];cardsInDeck(h,[]);h.r.api.setChoices(h.r.random,q=>q.title?.includes(' OR ')?['pokemon']:[]);await h.r.api.playCard('you',h.c.id);assert.ok(h.p.discard.includes(h.c));assert.equal(h.p.supporterPlayedThisTurn,true)}
});
test('Arven cancellation at the Tool choice rolls back the previously selected Item',async()=>{
 const h=ready('Arven');cardsInDeck(h,[instance(record('Metal Saucer'),'item'),instance(record('Leftovers'),'tool')]);const before=fingerprint(h.g);h.r.api.setChoices(h.r.random,q=>q.title.includes('Tool')?null:q.candidates);await h.r.api.playCard('you',h.c.id);assert.equal(fingerprint(h.r.api.state()),before);
});
test('Metal Saucer rejects an Active recipient or a target whose type changed after selection',async()=>{
 for(const invalid of ['active','changed']){const h=ready('Metal Saucer'),target=bench(h),m=energy('m');h.p.active.meta.types=['Metal'];h.p.discard.push(m);const before=fingerprint(h.g);h.r.api.setChoices(h.r.random,q=>{if(q.kind==='pokemon-target'){if(invalid==='active')return h.p.active;target.meta.types=['Water'];return target}return [m]});await h.r.api.playCard('you',h.c.id);assert.equal(fingerprint(h.r.api.state()),before)}
});
test('Assemble Alloy rejects stale Energy after assignment and restores the entire evolution',async()=>{
 const h=ready('Duraludon','PRE'),evo=instance(record('Archaludon ex'),'evo'),m=energy('m');h.p.hand.push(evo);h.p.discard.push(m);const before=fingerprint(h.g);h.r.api.setChoices(h.r.random,q=>{if(q.kind==='pokemon-target'){h.p.discard.splice(h.p.discard.indexOf(m),1);return evo}return [m]});await h.r.api.evolveFor('you',evo.id,h.c.id);assert.equal(fingerprint(h.r.api.state()),before);
});
test('Assemble Alloy may attach zero Energy; ability text changes cannot slip through evolution resolution',async()=>{
 const h=ready('Duraludon','PRE'),evo=instance(record('Archaludon ex'),'evo');h.p.hand.push(evo);h.p.discard.push(energy('m'));h.r.api.setChoices(h.r.random,()=>[]);await h.r.api.evolveFor('you',evo.id,h.c.id);assert.equal(h.p.active,evo);assert.equal(evo.energy.length,0);
 const changed=ready('Duraludon','PRE'),e=instance(record('Archaludon ex'),'evo');changed.p.hand.push(e);changed.p.discard.push(energy('m'));const before=fingerprint(changed.g);changed.r.api.setChoices(changed.r.random,()=>{e.meta.abilities[0].effect+=' Extra effect.';return []});await changed.r.api.evolveFor('you',e.id,changed.c.id);assert.equal(fingerprint(changed.r.api.state()),before);
});
test('Rumbling Engine cancellation and stale Energy do not consume its cost or once-per-turn use',async()=>{
 for(const invalid of ['cancel','stale']){const h=ready('Revavroom');h.p.deck.push(...h.p.hand.splice(0));const e=energy('m');h.p.hand.push(e);const before=fingerprint(h.g);h.r.api.setChoices(h.r.random,()=>{if(invalid==='cancel')return null;h.p.hand.splice(h.p.hand.indexOf(e),1);return e});assert.equal(await h.r.api.useAbility('you',h.c.id,'Rumbling Engine',false),false);assert.equal(fingerprint(h.r.api.state()),before)}
});
test('Gaia Crush discards the actual Stadium to its owner and resets its use state',async()=>{
 for(const owner of ['you','codex']){const h=ready('Landorus'),stadium=instance(record('Cycling Road'),'road');h.g.stadium={card:stadium,owner};h.g.stadiumUsage={you:3,codex:2};h.c.energy=Array.from({length:3},(_,i)=>energy('f'+i,'Fighting'));assert.equal(await h.r.api.attack('you',0),true);assert.equal(h.g.stadium,null);assert.equal(Object.keys(h.g.stadiumUsage).length,0);assert.ok(h.g.players[owner].discard.includes(stadium));assert.ok(!h.g.players[owner==='you'?'codex':'you'].discard.includes(stadium))}
});
for(const [targetName,expected]of[['Duraludon',100],['Archaludon ex',200],['Legacy-EX',100]])test('Rising Heart deals '+expected+' to '+targetName,async()=>{
 const h=ready('Enamorus');h.target.name=targetName;h.c.energy=Array.from({length:4},(_,i)=>energy('p'+i,'Psychic'));assert.equal(await h.r.api.attack('you',0),true);assert.equal(h.target.damage,expected);
});
test('Corkscrew Dive can decline drawing and can draw to six after doing damage',async()=>{
 for (const draw of [true,false]) {
   const h=ready('Tornadus');
   h.p.deck.push(...h.p.hand.splice(2));
   h.c.energy=Array.from({length:3},(_,i)=>energy('m'+i));
   h.r.api.setChoices(h.r.random,null);
   const attacking=h.r.api.attack('you',0);
   await new Promise(resolve=>setImmediate(resolve));
   const dialog=h.r.document.getElementById('playmatConfirmDialog');
   assert.equal(dialog.open,true);
   assert.equal(h.r.document.getElementById('playmatConfirmTitle').textContent,'Corkscrew Dive');
   assert.equal(h.r.document.getElementById('playmatConfirmAccept').textContent,'Draw 4 cards');
   assert.equal(h.p.hand.length,2);
   dialog.close(draw?'accept':'cancel');
   assert.equal(await attacking,true);
   assert.equal(h.target.damage,70);
   assert.equal(h.p.hand.length,draw?6:2);
 }
});
test('Incarnate Union allows Tornadus to attack with no Energy while all four are present',async()=>{
 const h=ready('Tornadus');h.p.bench=[];for(const name of ['Thundurus','Landorus','Enamorus'])bench(h,name,'M6',record(name).cardNumber,name);assert.equal(h.r.api.canPay(h.c,h.c.meta.attacks[0]),true);assert.equal(await h.r.api.attack('you',0),true);assert.equal(h.target.damage,70);
});
test('Thundurus still applies an attacker-side Growl penalty before Weakness',async()=>{
 const h=ready('Thundurus');h.c.energy=Array.from({length:3},(_,i)=>energy('l'+i,'Lightning'));h.g.growlReduction={expiresTurn:3,attackerPokemonId:h.c.id,defendingPokemonId:h.target.id,amount:20};h.target.meta.weaknesses=[{type:'Lightning',value:'×2'}];h.target.attackDamageReduction={expiresTurn:3,amount:30};assert.equal(await h.r.api.attack('you',0),true);assert.equal(h.target.damage,140);
});
test('Wild Drift reduction stacks with Iron Defender and expires; Metal Defender removes Weakness for one opposing turn',async()=>{
 const h=ready('Revavroom ex');h.c.energy=Array.from({length:3},(_,i)=>energy('m'+i));await h.r.api.attack('you',0);h.g.damageReductions=[{side:'you',type:'metal',expiresTurn:4,amount:30}];h.c.meta.hp=9999;await h.r.api.damagePokemon('codex','you',h.c,'active',100);assert.equal(h.c.damage,40);h.g.turnNumber=6;await h.r.api.damagePokemon('codex','you',h.c,'active',100);assert.equal(h.c.damage,140);
 const a=ready('Archaludon ex');a.c.energy=Array.from({length:3},(_,i)=>energy('m'+i));a.c.meta.hp=9999;a.g.players.codex.active.meta.types=['Fire'];await a.r.api.attack('you',0);await a.r.api.damagePokemon('codex','you',a.c,'active',100);assert.equal(a.c.damage,100);a.g.turnNumber=6;await a.r.api.damagePokemon('codex','you',a.c,'active',100);assert.equal(a.c.damage,300);
});
test('four Leftovers on Tune-up heal cumulatively without healing beyond full HP',async()=>{
 const h=ready('Revavroom ex');h.c.damage=50;h.c.tools=Array.from({length:4},(_,i)=>instance(record('Leftovers'),'left'+i));await h.r.api.endTurnFor('you');assert.equal(h.c.damage,0);
});

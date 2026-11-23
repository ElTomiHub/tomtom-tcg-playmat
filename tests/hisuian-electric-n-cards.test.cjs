const assert=require('node:assert/strict');
const {test}=require('node:test');
const vm=require('node:vm');
const {createEngineRunner,loadFixture}=require('./integration-harness.cjs');
const verified=require('./fixtures/hisuian-electric-n-cards.fixture.json');

function setup(){
  const f=loadFixture(),r=createEngineRunner(f,73);r.api.setup(f,r.random,r.choose,()=>true);r.api.setLocalAi(false);
  const g=r.api.state();g.phase='play';g.turn='you';g.turnNumber=7;g.firstPlayer='codex';g.pendingPromotion=null;g.pendingCheckup=null;
  for(const p of Object.values(g.players)){p.turnsTaken=3;p.attackedThisTurn=false;p.supporterPlayedThisTurn=false;p.bench=[];p.hand=[];p.discard=[];}
  let id=0;
  const make=(name,set,num)=>{
    const row=verified.cards.find(c=>c.name===name&&(!set||c.setCode===set)&&(!num||c.cardNumber===num));assert.ok(row,'Verified '+name);
    return {...structuredClone(row),id:'new-test-'+(++id),energy:[],tools:[],conditions:[],evolutionStack:[],damage:0,enteredTurn:0,evolvedTurn:-1};
  };
  const energy=(type='Darkness')=>({id:'energy-'+(++id),name:type+' Energy',meta:{category:'Energy',energyType:type}});
  const run=(code,vars={})=>{Object.assign(r.context,vars);return vm.runInContext(code,r.context);};
  const defender=make("N's Zoroark ex");g.players.codex.active=defender;
  const choices=fn=>r.api.setChoices(r.random,request=>fn(request)??r.choose(request),()=>true);
  return {r,g,make,energy,run,choices,p:g.players.you,foe:g.players.codex};
}

for(const row of verified.cards)test('verified support and metadata recovery: '+row.name+' '+row.setCode+' '+row.cardNumber,()=>{
  const {r,run}=setup();const raw={id:'raw',name:row.name,setCode:row.setCode,cardNumber:row.cardNumber,language:row.language};
  assert.equal(r.api.repairMetadata(raw),true);assert.ok(raw.meta.image);
  assert.equal(run('effectSupportFor(c)',{c:raw}),'automatic');
});

test('promo aliases, unnamed Level Ball, and saved missing Scratch resolve without guessing',()=>{
  const {r,run,make}=setup();
  for(const name of ['Professor Laventon PR-SW 284','Escape Rope PR-SW 245']){const c={name,id:name,categoryHint:'Trainer'};r.api.repairMetadata(c);assert.equal(c.setCode,'SP');assert.equal(run('effectSupportFor(c)',{c}),'automatic');}
  const ball={id:'null',name:'null',setCode:'SPZ',cardNumber:'11'};r.api.repairMetadata(ball);assert.equal(ball.name,'Level Ball');assert.equal(run('effectSupportFor(c)',{c:ball}),'automatic');
  const zorua=make("N's Zorua");zorua.meta.attacks[0].effect=null;zorua.meta.attacks[0].effectTextStatus='missing';r.api.repairMetadata(zorua);assert.equal(zorua.meta.attacks[0].effectTextStatus,'explicit-empty');
  const wrong=make("N's Zorua");wrong.meta.attacks[0].damage=999;wrong.meta.attacks[0].effect=null;r.api.repairMetadata(wrong);assert.equal(wrong.meta.attacks[0].effect,null);
});

test('N’s Night Joker pays only Darkness Darkness and invalidates a departed or altered source',()=>{
  const {r,p,make,energy,run}=setup();p.active=make("N's Zoroark ex");const zekrom=make("N's Zekrom");p.bench=[zekrom];p.active.energy=[energy(),energy()];
  const attacks=r.api.attackOptions('you');const copied=attacks.find(e=>e.attack.name==='Rampaging Thunder');assert.ok(copied);assert.equal(copied.attack.cost.length,2);assert.equal(copied.damage,250);
  assert.ok(!attacks.some(e=>e.attack.name==='Night Joker'));
  p.bench=[];assert.equal(run('attackEffectRuleFor(p.active,a)',{p,a:copied.attack}),null);
  p.bench=[zekrom];zekrom.meta.attacks[1].damage=999;assert.equal(run('attackEffectRuleFor(p.active,a)',{p,a:copied.attack}),null);
});

test('Night Joker copied attack resolves through the real transaction and locks its actual attacker',async()=>{
  const {r,p,foe,make,energy}=setup();p.active=make("N's Zoroark ex");p.bench=[make("N's Zekrom")];p.active.energy=[energy(),energy()];
  const option=r.api.attackOptions('you').find(e=>e.attack.name==='Rampaging Thunder');assert.equal(await r.api.attack('you',option.index),true);assert.equal(foe.active.damage,250);assert.ok(p.active.cannotAttackUntilTurn);
});

test('Ditto copies Basic non-Rule-Box discard attacks and still pays their cost',()=>{
  const {r,p,make,energy,run}=setup();p.active=make('Ditto');const source=make("N's Reshiram");p.discard=[source,make("N's Zoroark ex")];
  assert.equal(r.api.attackOptions('you').length,0);p.active.energy=[energy('Fire'),energy('Fire'),energy('Lightning'),energy()];
  const attack=r.api.attackOptions('you').find(e=>e.attack.name==='Virtuous Flame');assert.ok(attack);assert.ok(!r.api.attackOptions('you').some(e=>e.attack.name==='Night Joker'));
  p.discard=[];assert.equal(run('attackEffectRuleFor(p.active,a)',{p,a:attack.attack}),null);
});

test('Reversal Energy updates attack and retreat units with prize counts and Rule Boxes',()=>{
  const {p,foe,make,run}=setup();const e=make('Reversal Energy');p.active=make('Hisuian Arcanine','TWM');p.active.energy=[e];p.prizes=[1,2,3,4];foe.prizes=[1,2];
  assert.equal(run('energyUnitsForPokemon(e,p.active).length',{p,e}),3);assert.equal(run('retreatEnergyUnits(e,p.active)'),3);assert.equal(run("energyProvidesType(e,p.active,'fire')"),true);
  foe.prizes=[1,2,3,4];assert.equal(run('energyUnitsForPokemon(e,p.active).length'),1);
  foe.prizes=[1];p.active=make("N's Zoroark ex");assert.equal(run('energyUnitsForPokemon(e,p.active).length'),1);
  p.active=make('Hisuian Growlithe');assert.equal(run('energyUnitsForPokemon(e,p.active).length'),1);
});

test('Hisuian damage, coin, burn, poison and free attacks have correct values and costs',async()=>{
  const {r,p,foe,make,run}=setup();p.active=make('Hisuian Arcanine','TWM');p.bench=[make('Hisuian Growlithe')];
  assert.equal(r.api.attackOptions('you')[0].damage,30);p.bench[0].damage=10;assert.equal(r.api.attackOptions('you')[0].damage,120);
  p.active=make('Hisuian Growlithe');assert.ok(r.api.attackOptions('you').some(e=>e.attack.name==='Singe'));
  assert.equal(await run("resolveAttackEffect('you',p.active,p.active.meta.attacks[0],{defendingPokemon:foe.active})",{p,foe}),true);assert.equal(foe.active.conditions[0].type,'burned');
  p.active=make('Hisuian Overqwil','ASR');foe.active.conditions=[];
  assert.equal(await run("resolveAttackEffect('you',p.active,p.active.meta.attacks[0],{defendingPokemon:foe.active})"),true);assert.equal(foe.active.conditions[0].damage,50);
  await run("resolveBetweenTurns('codex')");assert.equal(foe.active.damage,50);
});

test('Electric chain requires actual species on the immediately previous own turn',()=>{
  const {r,g,p,make,energy}=setup();p.active=make('Dedenne');p.active.energy=[energy('Lightning')];
  assert.ok(!r.api.attackOptions('you').some(e=>e.attack.name==='Dedeshort'));
  g.lastComboAttacks={you:{pokemonName:'togedemaru',chain:'togedemaru',turnNumber:5}};assert.ok(r.api.attackOptions('you').some(e=>e.attack.name==='Dedeshort'));
  g.lastComboAttacks.you.pokemonName='ditto';assert.ok(!r.api.attackOptions('you').some(e=>e.attack.name==='Dedeshort'));
  p.active=make('Pikachu');p.active.energy=[energy('Lightning')];assert.equal(r.api.attackOptions('you')[0].damage,20);
  g.lastComboAttacks.you={pokemonName:'dedenne',chain:'dedenne',turnNumber:5};assert.equal(r.api.attackOptions('you')[0].damage,200);
  g.lastComboAttacks.you.turnNumber=3;assert.equal(r.api.attackOptions('you')[0].damage,20);
});

test('Morpeko hits all opposing Pokémon after Dedeshort, without Bench Weakness',async()=>{
  const {r,g,p,foe,make,energy}=setup();p.active=make('Morpeko');p.active.energy=[energy('Lightning')];foe.bench=[make("N's Zekrom"),make("N's Reshiram")];
  g.lastComboAttacks={you:{pokemonName:'dedenne',chain:'dedenne',turnNumber:5}};assert.equal(await r.api.attack('you',0),true);
  assert.equal(foe.active.damage,60);assert.ok(foe.bench.every(c=>c.damage===60));assert.equal(g.lastComboAttacks.you.pokemonName,'morpeko');
});

test('Togedash prevents attack prizes only next opposing turn and is cleared on switching',async()=>{
  const {g,p,foe,make,run}=setup();p.active=make('Togedemaru');
  await run("resolveAttackEffect('you',p.active,p.active.meta.attacks[0],{defendingPokemon:foe.active})",{p,foe});g.turn='codex';g.turnNumber=8;
  assert.equal(run('prizeCountFor(p.active)'),0);g.pendingCheckup={};assert.equal(run('prizeCountFor(p.active)'),1);g.pendingCheckup=null;
  run('clearPokemonConditions(p.active)');assert.equal(run('prizeCountFor(p.active)'),1);
});

test('Doom Curse expires at end of defending turn before checkup, and switching removes it',async()=>{
  const {g,p,foe,make,run}=setup();p.active=make('Hisuian Zoroark','LOR');foe.bench=[make("N's Zekrom")];
  await run("resolveAttackEffect('you',p.active,p.active.meta.attacks[0],{defendingPokemon:foe.active})",{p,foe});const marked=foe.active;
  assert.equal(marked.doomCurseUntilTurn,8);g.turn='you';g.turnNumber=9;
  await run("resolveBetweenTurns('codex')");assert.ok(foe.discard.includes(marked));assert.equal(foe.active.name,"N's Zekrom");
  p.active.doomCurseUntilTurn=10;run('clearPokemonConditions(p.active)');assert.equal(p.active.doomCurseUntilTurn,undefined);
});

test('N’s Plan moves two physical Energy cards even if one provides three units',async()=>{
  const {r,p,make,energy,run,choices}=setup();p.active=make("N's Zoroark ex");const host=make("N's Zekrom"),special=make('Reversal Energy'),basic=energy();host.energy=[special,basic];p.bench=[host];const card=make("N's Plan");p.hand=[card];
  choices(q=>q.kind==='cards'?q.candidates:undefined);assert.equal(run("canPlayTrainerEffect(card,'you')",{card}),true);await r.api.playCard('you',card.id);assert.equal(host.energy.length,0);assert.equal(p.active.energy.length,2);
});

test('N’s PP Up attaches only Basic discard Energy to a Benched N’s Pokémon',async()=>{
  const {r,p,make,energy,run}=setup();p.active=make("N's Zoroark ex");const target=make("N's Zekrom");p.bench=[target];const basic=energy(),special=make('Reversal Energy'),card=make("N's PP Up");p.discard=[special,basic];p.hand=[card];
  await r.api.playCard('you',card.id);assert.deepEqual(target.energy,[basic]);assert.ok(p.discard.includes(special));assert.ok(p.discard.includes(card));
  assert.equal(run("canPlayTrainerEffect(card,'you')",{card}),false);
});

test('N’s Resolve looks at six, discards non-Energy and attaches all Basic Energy to one Dragon',async()=>{
  const {r,p,make,energy,choices}=setup();p.active=make("N's Zoroark ex");const target=make("N's Reshiram"),card=make("N's Resolve"),a=energy(),b=energy('Fire'),special=make('Reversal Energy');p.bench=[target];p.hand=[card];p.deck=[make('Pikachu'),a,make('Dedenne'),b,special,make('Ditto'),make('Morpeko')];
  choices(q=>q.kind==='cards'?q.candidates:undefined);await r.api.playCard('you',card.id);assert.deepEqual(target.energy,[a,b]);assert.equal(p.deck.length,1);assert.ok(p.discard.includes(special));
});

test('Marnie puts hands on the bottom and draws five/four; Iscan draws four with Hisuian Active',async()=>{
  const {r,p,foe,make}=setup();p.active=make('Hisuian Growlithe');let card=make('Marnie');p.hand=[card,make('Pikachu')];const foeCard=make('Dedenne');foe.hand=[foeCard];const top=p.deck.at(-1);await r.api.playCard('you',card.id);assert.equal(p.hand.length,5);assert.ok(p.hand.includes(top));assert.equal(foe.hand.length,4);assert.ok(foe.deck.includes(foeCard));
  p.supporterPlayedThisTurn=false;card=make('Iscan');p.hand=[card];await r.api.playCard('you',card.id);assert.equal(p.hand.length,4);
});

test('Grant recovery excludes all Grants as cost and does not consume the Supporter play',async()=>{
  const {p,make,run}=setup();p.active=make('Hisuian Arcanine','TWM');const grant=make('Grant'),otherGrant=make('Grant');p.discard=[grant];p.hand=[otherGrant,make('Pikachu')];
  assert.equal(run("canRecoverGrant('you',grant)",{grant}),false);p.hand.push(make('Dedenne'));assert.equal(await run("recoverGrant('you',grant)"),true);assert.ok(p.hand.includes(otherGrant));assert.ok(p.hand.includes(grant));assert.equal(p.supporterPlayedThisTurn,false);
});

test('Choice Belt boosts attacks against Pokémon V only, not ex; N’s Castle grants named free retreat',()=>{
  const {p,foe,make,run,g}=setup();p.active=make('Hisuian Arcanine','TWM');p.active.tools=[make('Choice Belt')];const attack=p.active.meta.attacks[0];assert.equal(run("attackDamageBonusBeforeWeakness('you',p.active,a)",{p,a:attack}),0);
  foe.active.name='Test VMAX';assert.equal(run("attackDamageBonusBeforeWeakness('you',p.active,a)"),30);
  p.active=make("N's Zekrom");g.stadium={card:make("N's Castle"),owner:'you'};assert.equal(run('retreatCostForPokemon(p.active)'),0);
});

test('Gapejaw Bog places counters only for Basic Pokémon played from hand to Bench',()=>{
  const {r,g,p,make,run}=setup();p.active=make("N's Zoroark ex");const basic=make('Pikachu');p.hand=[basic];g.stadium={card:make('Gapejaw Bog'),owner:'codex'};
  run("controlSide='you';selected={side:'you',zone:'hand',id:basic.id};placeSelected('bench')",{basic});assert.equal(basic.damage,20);assert.ok(p.bench.includes(basic));
});

test('N’s Darmanitan and Reshiram use discard counts and actual attacker damage',async()=>{
  const {p,foe,make,energy,run}=setup();p.active=make("N's Darmanitan");foe.discard=[energy(),energy('Fire'),make('Reversal Energy')];const a=p.active.meta.attacks[0];assert.equal(run('attackDamageValue(a,p.active)',{p,a}),60);
  p.active=make("N's Reshiram");p.active.damage=70;assert.equal(run('attackDamageValue(p.active.meta.attacks[0],p.active)'),140);
});

test('all new prints are Implemented in the library with no match running',async()=>{
  const r=createEngineRunner(loadFixture());r.api.loadSavedLibrary(structuredClone(verified.cards));await r.api.checkLibrary();
  assert.equal(r.api.libraryAudit().filter(c=>c.status!=='implemented').length,0);
});

test('new exact effects reject changed printing, language, cost and text',()=>{
  const {make,run}=setup();
  for(const change of [c=>c.cardNumber='999',c=>c.language='fr',c=>c.meta.attacks[0].cost=['Fire'],c=>c.meta.attacks[0].effect+=' Extra effect.']){
    const c=make("N's Reshiram");change(c);assert.equal(run('attackEffectRuleFor(c,c.meta.attacks[0])',{c}),null);
  }
});

test('Flamebody Cannon discards all Energy and deals its additional Bench damage',async()=>{
  const {r,p,foe,make,energy}=setup();p.active=make("N's Darmanitan");p.active.energy=[energy('Fire'),energy('Fire'),energy(),energy('Water')];const benched=make("N's Zekrom");foe.bench=[benched];
  const index=r.api.attackOptions('you').find(e=>e.attack.name==='Flamebody Cannon').index;assert.equal(await r.api.attack('you',index),true);
  assert.equal(p.active.energy.length,0);assert.equal(foe.active.damage,90);assert.equal(benched.damage,90);assert.equal(p.discard.filter(c=>c.meta.category==='Energy').length,4);
});

test('Thieving Swipe reveals the hand, puts exactly the selected card on the bottom, and leaves others',async()=>{
  const {r,p,foe,make,energy,choices}=setup();p.active=make("N's Purrloin");p.active.energy=[energy(),energy()];const chosen=make('Grant'),other=make('Iscan');foe.hand=[chosen,other];
  choices(q=>q.kind==='cards'?[chosen]:undefined);assert.equal(await r.api.attack('you',0),true);assert.equal(foe.deck[0],chosen);assert.ok(foe.hand.includes(other));assert.ok(!foe.hand.includes(chosen));
});

test('Professor Laventon and Rescue Trolley enforce discard filters and reset recovered Pokémon',async()=>{
  const {r,p,make}=setup();p.active=make("N's Zoroark ex");const hisui=make('Hisuian Arcanine','TWM'),ordinary=make('Pikachu'),card=make('Professor Laventon');hisui.damage=60;p.discard=[ordinary,hisui];p.hand=[card];
  await r.api.playCard('you',card.id);assert.ok(p.hand.includes(hisui));assert.equal(hisui.damage,0);assert.ok(p.discard.includes(ordinary));
  const trolley=make('Rescue Trolley');p.hand=[trolley];await r.api.playCard('you',trolley.id);assert.ok(p.hand.includes(ordinary));
});

test('Lt. Surge’s Deal lets the opponent decline or accept and handles simultaneous final Prizes',async()=>{
  for(const accept of [false,true]){
    const {r,p,foe,make,choices}=setup();p.active=make('Pikachu');const card=make("Lt. Surge's Deal"),a=make('Dedenne'),b=make('Morpeko');p.hand=[card];p.prizes=[a];foe.prizes=[b];
    choices(q=>q.kind==='confirm'?accept:undefined);await r.api.playCard('you',card.id);
    if(accept){assert.equal(r.api.state().phase,'finished');assert.equal(p.prizes.length,0);assert.equal(foe.prizes.length,0);assert.ok(p.hand.includes(a));assert.ok(foe.hand.includes(b));}
    else {assert.equal(p.hand.length,4);assert.equal(p.prizes.length,1);assert.equal(foe.prizes.length,1);}
  }
});

test('Evolution Incense and Level Ball search only their eligible Pokémon',async()=>{
  for(const [name,expected] of [['Evolution Incense',"N's Darmanitan"],['Level Ball','Pikachu']]){
    const {r,p,make,choices}=setup();p.active=make("N's Zoroark ex");const card=make(name),evo=make("N's Darmanitan"),small=make('Pikachu'),large=make("N's Reshiram");p.hand=[card];p.deck=[large,small,evo];
    choices(q=>q.kind==='cards'?[q.candidates.find(c=>c.name===expected)]:undefined);await r.api.playCard('you',card.id);assert.ok(p.hand.some(c=>c.name===expected));assert.equal(p.deck.length,2);
  }
});

test('Yami recognizes and uses an affordable Night Joker copied attack',()=>{
  const {r,g,p,foe,make,energy,run}=setup();g.turn='codex';g.yamiDifficulty='master';g.yamiStyle='aggro';r.api.setLocalAi(true);p.active=make("N's Zoroark ex");foe.active=make("N's Zoroark ex");foe.active.energy=[energy(),energy()];foe.bench=[make("N's Zekrom")];
  assert.ok(run('aiBestAttackScore(player("codex").active)')>=250);const action=r.api.aiAction();assert.equal(action.type,'attack');assert.ok(['Rampaging Thunder','Shred'].includes(action.name));
});

test('Doom Curse pauses for a human promotion, then performs checkup and one incoming draw',async()=>{
  const {r,g,p,foe,make,run}=setup();g.turn='you';g.turnNumber=8;const marked=make('Pikachu'),replacement=make("N's Zekrom");p.active=marked;p.bench=[replacement];marked.doomCurseUntilTurn=8;marked.doomCurseAttackerSide='codex';
  // The opponent's existing poison is checked after the end-of-turn promotion.
  foe.active.conditions=[{type:'poisoned',appliedTurn:7}];const hand=foe.hand.length;
  await r.api.endTurnFor('you');assert.equal(g.pendingPromotion,'you');assert.equal(foe.active.damage,0);assert.equal(foe.hand.length,hand+1);
  await r.api.promote();for(let i=0;i<12;i++)await Promise.resolve();
  assert.equal(p.active,replacement);assert.equal(foe.active.damage,10);assert.equal(foe.hand.length,hand+2); // one Prize, then one turn draw
  assert.equal(g.pendingCheckup,null);assert.equal(g.pendingPromotion,null);
});

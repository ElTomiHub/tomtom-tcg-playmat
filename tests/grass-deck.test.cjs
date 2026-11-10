const assert = require('node:assert/strict');
const { test } = require('node:test');
const vm = require('node:vm');
const { loadFixture, createEngineRunner } = require('./integration-harness.cjs');
const { cards } = require('./fixtures/grass-deck-cards.fixture.json');
const energy = (id,type='Grass') => ({id,name:type+' Energy',meta:{category:'Energy',energyType:type}});

function ready(print='TWM 25', costs=[]) {
  const f=loadFixture(), r=createEngineRunner(f,85);
  r.api.setup(f,r.random,r.choose,()=>true); r.api.setLocalAi(false);
  const g=r.api.state(), p=g.players.you, foe=g.players.codex;
  const make=(ref,id=ref)=>{
    const record=cards.find(card=>card.setCode+' '+card.cardNumber===ref);
    assert.ok(record,ref);
    const card={...structuredClone(record),id,energy:[],tools:[],conditions:[],evolutionStack:[],damage:0,enteredTurn:0,evolvedTurn:-1};
    r.api.repairMetadata(card); return card;
  };
  g.turn='you';g.turnNumber=3;g.firstPlayer='you';p.turnsTaken=1;foe.turnsTaken=1;
  p.active=make(print);p.active.energy=costs.map((type,i)=>energy('paid-'+i,type));p.bench=[];p.hand=[];p.discard=[];
  foe.bench=[];foe.active.meta.hp=1000;foe.active.meta.weaknesses=[];foe.active.meta.resistances=[];
  r.api.clearVisuals();return {r,g,p,foe,make};
}

test('all 18 raw saved printings become Implemented, including missing effect-free metadata',async()=>{
  const r=createEngineRunner(loadFixture());r.api.loadSavedLibrary(structuredClone(cards));await r.api.checkLibrary();
  const audit=r.api.libraryAudit();
  for(const card of cards) assert.equal(audit.find(c=>c.name===card.name&&c.setCode===card.setCode&&c.cardNumber===card.cardNumber)?.status,'implemented',card.name);
});

test('wrong print, cost, damage, language and text stay blocked',()=>{
  const {r,make}=ready();
  const wrongPrint=make('MEG 2');wrongPrint.cardNumber='20';
  const wrongCost=make('MEG 10');wrongCost.meta.attacks[0].cost=['Grass'];
  const wrongDamage=make('ASC 8');wrongDamage.meta.attacks[1].damage=300;
  const wrongLanguage=make('MEG 3');wrongLanguage.language='ja';wrongLanguage.meta.language='ja';
  const wrongText=make('TWM 143');wrongText.meta.effect+=' Draw a card.';
  for(const card of [wrongPrint,wrongCost,wrongDamage,wrongLanguage,wrongText]) assert.notEqual(r.api.inspectFixture({cards:[card]})[0].implementationStatus,'implemented',card.name);
});

test('Wild Growth doubles only own Basic Grass units, does not stack, and supplies attack and retreat costs',()=>{
  const {r,p,foe,make}=ready('MEG 3',['Grass','Grass']);
  assert.equal(r.api.canPay(p.active,p.active.meta.attacks[0]),false);
  p.bench=[make('MEG 10','growth-1'),make('MEG 10','growth-2')];
  assert.deepEqual(Array.from(r.api.energyUnits(p.active.energy[0],p.active)),['grass','grass']);
  assert.equal(r.api.canPay(p.active,p.active.meta.attacks[0]),true);
  assert.deepEqual(Array.from(r.api.energyUnits(energy('foe-grass'),foe.active)),['grass']);
  assert.deepEqual(Array.from(r.api.energyUnits(energy('water','Water'),p.active)),['water']);
  assert.equal(vm.runInContext('retreatEnergyUnits(player("you").active.energy[0],player("you").active)',r.context),2);
});

test('Wild Growth unit totals drive Giant Bouquet and Myriad Leaf Shower consistently',async()=>{
  const a=ready('ASC 10',['Grass','Grass']);a.p.bench=[a.make('MEG 10')];
  const before=a.foe.active.damage;assert.equal(await a.r.api.attack('you',0),true);assert.equal(a.foe.active.damage-before,270);
  const b=ready('TWM 25',['Grass','Grass']);b.p.bench=[b.make('MEG 10')];b.foe.active.energy=[energy('opponent-energy','Water')];
  assert.equal(await b.r.api.attack('you',0),true);assert.equal(b.foe.active.damage,180);
});

test('Teal Dance attaches and draws once per copy without spending the normal attachment',async()=>{
  const {r,p,g,make}=ready(),second=make('TWM 25','second'),firstEnergy=energy('first'),secondEnergy=energy('second-energy');
  p.bench=[second];p.hand=[firstEnergy,secondEnergy];p.deck=[make('MEG 1'),make('ASC 8')];
  assert.equal(await r.api.useAbility('you',p.active.id,'Teal Dance',false),true);
  assert.equal(p.energyAttachedThisTurn,false);assert.equal(p.active.energy.length,1);assert.equal(p.hand.length,2);
  assert.equal(await r.api.useAbility('you',p.active.id,'Teal Dance',false),false);
  assert.equal(await r.api.useAbility('you',second.id,'Teal Dance',false),true);
  assert.equal(r.api.state().matchHistory.players.you.energyAttached,2);
});

test('Solar Transfer moves a physical Basic Grass card repeatedly without recounting attachment',async()=>{
  const {r,p,g,make}=ready('MEG 3'),target=make('TWM 25'),grass=energy('transfer');
  p.active.energy=[grass];p.bench=[target];const count=g.matchHistory.players.you.energyAttached;
  let source=p.active,destination=target;
  r.api.setChoices(r.random,q=>q.kind==='pokemon-target'?q.candidates.includes(source)?source:destination:q.kind==='cards'?[grass]:r.choose(q));
  assert.equal(await r.api.useAbility('you',p.active.id,'Solar Transfer',false),true);
  assert.ok(target.energy.includes(grass));assert.equal(p.active.energy.length,0);
  source=target;destination=p.active;
  assert.equal(await r.api.useAbility('you',p.active.id,'Solar Transfer',false),true);
  assert.ok(p.active.energy.includes(grass));assert.equal(g.matchHistory.players.you.energyAttached,count);
});

test('Solar Transfer cancellation restores the Energy and leaves the Ability usable',async()=>{
  const {r,p,make}=ready('MEG 3',['Grass']);p.bench=[make('ASC 8')];
  const before=JSON.stringify(p);r.api.setChoices(r.random,q=>q.kind==='pokemon-target'?null:r.choose(q));
  assert.equal(await r.api.useAbility('you',p.active.id,'Solar Transfer',false),false);
  assert.equal(JSON.stringify(r.api.state().players.you),before);
});

test('Forest allows consecutive Grass evolutions in a turn but preserves first-turn and Rare Candy guards',async()=>{
  const {r,g,p,make}=ready('MEG 1');p.active.enteredTurn=3;p.hand=[make('MEG 2'),make('MEG 3')];g.stadium={card:make('MEG 117'),side:'you'};
  await r.api.evolveFor('you',p.hand[0].id,p.active.id);assert.equal(p.active.name,'Ivysaur');
  await r.api.evolveFor('you',p.hand[0].id,p.active.id);assert.equal(p.active.name,'Mega Venusaur ex');
  const b=ready('MEG 1');b.g.stadium={card:b.make('MEG 117'),side:'you'};b.p.turnsTaken=0;b.p.hand=[b.make('MEG 2')];
  await b.r.api.evolveFor('you',b.p.hand[0].id,b.p.active.id);assert.equal(b.p.active.name,'Bulbasaur');
  b.p.turnsTaken=1;b.p.active.enteredTurn=3;
  assert.equal(vm.runInContext('pokemonCanUseRareCandyTarget(player("you").active,"you")',b.r.context),false);
});

test('Lillie draws eight with six Prizes and six otherwise',async()=>{
  for(const prizes of [6,5]) {const {r,p,make}=ready(),card=make('MEG 119');p.hand=[card,make('ASC 8')];p.deck=Array.from({length:12},(_,i)=>energy('draw-'+i));p.prizes=Array.from({length:prizes},(_,i)=>energy('prize-'+i));await r.api.playCard('you',card.id);assert.equal(p.hand.length,prizes===6?8:6);assert.ok(p.discard.includes(card));}
});

test('Lana recovers only non-Rule-Box Pokémon and Basic Energy',async()=>{
  const {r,p,make}=ready(),trainer=make('TWM 155'),basic=make('MEG 1'),stage2=make('MEG 10'),grass=energy('grass');
  p.hand=[trainer];p.discard=[basic,stage2,grass,make('TWM 25'),make('MEG 119')];
  r.api.setChoices(r.random,q=>{assert.deepEqual(Array.from(q.candidates),[basic,stage2,grass]);return q.candidates;});
  await r.api.playCard('you',trainer.id);assert.equal(p.hand.length,3);assert.ok(p.hand.includes(stage2));
});

test('Wally heals a damaged Mega ex and returns all attached Energy, leaving Tools in place',async()=>{
  const {r,p,make}=ready('MEG 3',['Grass','Water']),card=make('MEG 132'),tool={id:'tool',name:'Tool'};
  p.active.damage=190;p.active.tools=[tool];p.hand=[card];await r.api.playCard('you',card.id);
  assert.equal(p.active.damage,0);assert.equal(p.active.energy.length,0);assert.equal(p.hand.length,2);assert.equal(p.active.tools[0],tool);
});

test('Bug Catching Set sees only seven cards and accepts only Grass Pokémon and Basic Grass Energy',async()=>{
  const {r,p,make}=ready(),item=make('TWM 143'),grass=energy('grass'),target=make('MEG 10'),bottom=make('MEG 3','bottom');
  p.hand=[item];p.deck=[bottom,energy('water','Water'),make('POR 62'),make('MEG 119'),energy('fire','Fire'),target,grass,make('ASC 142')];
  r.api.setChoices(r.random,q=>{assert.equal(q.maxCount,2);assert.deepEqual(Array.from(q.candidates),[target,grass]);return [target,grass];});
  await r.api.playCard('you',item.id);assert.ok(p.hand.includes(target)&&p.hand.includes(grass));assert.ok(p.deck.includes(bottom));assert.equal(p.deck.length,6);assert.ok(p.discard.includes(item));
});

test('Poké Pad searches evolved non-Rule-Box Pokémon and rejects Pokémon ex',async()=>{
  const {r,p,make}=ready(),item=make('POR 81'),target=make('MEG 10');p.hand=[item];p.deck=[make('TWM 25'),target];
  r.api.setChoices(r.random,q=>{assert.deepEqual(Array.from(q.candidates),[target]);return [target];});
  await r.api.playCard('you',item.id);assert.ok(p.hand.includes(target));
});

test('Bug Catching Set rejects a changed top-seven window and restores the complete action',async()=>{
  const {r,p,make}=ready(),item=make('TWM 143'),target=make('MEG 10');
  p.hand=[item];p.deck=[energy('bottom'),target,energy('top')];const before=JSON.stringify(p);
  r.api.setChoices(r.random,()=>{p.deck.reverse();return [target];});
  await r.api.playCard('you',item.id);assert.equal(JSON.stringify(r.api.state().players.you),before);
});

test('Teal Mask’s verified Tera rule prevents attack damage while Benched',()=>{
  const {r,p,make}=ready(),benched=make('TWM 25','benched');p.bench=[benched];
  r.api.damagePokemon('codex','you',benched,'bench',100);assert.equal(benched.damage,0);
});

test('Unfair Stamp requires the last opposing turn KO and discards itself before drawing five versus two',async()=>{
  const {r,g,p,foe,make}=ready(),item=make('TWM 165');p.hand=[item];p.deck=Array.from({length:10},(_,i)=>energy('own-'+i));foe.hand=[energy('foe-hand')];foe.deck=Array.from({length:10},(_,i)=>energy('foe-'+i));
  await r.api.playCard('you',item.id);assert.ok(p.hand.includes(item));assert.equal(p.discard.length,0);
  g.lastKnockoutTurns={you:2};await r.api.playCard('you',item.id);
  assert.equal(p.hand.length,5);assert.equal(foe.hand.length,2);assert.ok(p.discard.includes(item));assert.ok(!p.hand.includes(item)&&!p.deck.includes(item));
});

test('Last-Ditch Catch triggers from hand to Bench and is shared across copies for the turn',async()=>{
  const {r,g,p,make}=ready(),one=make('POR 62','meowth-one'),two=make('POR 62','meowth-two'),supporter=make('MEG 119');
  p.hand=[one,two];p.deck=[make('MEG 1'),supporter];
  await r.api.humanAction({type:'play_basic',cardId:one.id});assert.ok(p.bench.includes(one));assert.ok(p.hand.includes(supporter));assert.equal(p.lastDitchTurn,g.turnNumber);
  p.deck.push(make('TWM 155'));await r.api.humanAction({type:'play_basic',cardId:two.id});assert.ok(p.bench.includes(two));assert.equal(p.deck.length,2);
});

test('Last-Ditch Catch may be skipped without losing the Bench placement',async()=>{
  const {r,p,make}=ready(),meowth=make('POR 62');p.hand=[meowth];p.deck=[make('MEG 119')];
  r.api.setChoices(r.random,q=>q.kind==='confirm'?false:r.choose(q));await r.api.humanAction({type:'play_basic',cardId:meowth.id});assert.ok(p.bench.includes(meowth));assert.equal(p.lastDitchTurn,undefined);assert.equal(p.deck.length,1);
});

test('Push Down damages first and lets the defending player choose the replacement',async()=>{
  const {r,p,foe,make}=ready('MEG 9',['Grass','Grass']),old=foe.active,next=make('ASC 8');foe.bench=[next];
  r.api.setChoices(r.random,q=>{if(q.kind==='pokemon-target'){assert.equal(q.side,'codex');assert.equal(old.damage,50);return next;}return r.choose(q);});
  assert.equal(await r.api.attack('you',0),true);assert.equal(foe.active,next);assert.ok(foe.bench.includes(old));
});

test('Bind Down locks retreat for the defender’s next turn and Jungle Dump heals after damage',async()=>{
  const a=ready('MEG 1',['Grass']);assert.equal(await a.r.api.attack('you',0),true);assert.equal(a.foe.active.retreatLockUntilTurn,4);assert.equal(a.r.api.canRetreat('codex'),false);
  const b=ready('MEG 3',['Grass','Grass','Grass','Grass']);b.p.active.damage=80;assert.equal(await b.r.api.attack('you',0),true);assert.equal(b.p.active.damage,50);assert.equal(b.foe.active.damage,240);
});

test('Traverse Time chooses Grass Pokémon and Stadiums together',async()=>{
  const {r,p,make}=ready('MEG 12',['Grass']),pokemon=make('MEG 10'),stadium=make('MEG 117');p.deck=[pokemon,stadium,make('MEG 119'),make('POR 62')];
  r.api.setChoices(r.random,q=>{assert.deepEqual(Array.from(q.candidates),[pokemon,stadium]);return q.candidates;});assert.equal(await r.api.attack('you',0),true);assert.ok(p.hand.includes(pokemon)&&p.hand.includes(stadium));
});

test('Unfair Stamp shares the one ACE SPEC per deck limit with Neutralization Zone',()=>{
  const {r}=ready();r.context.deckText='1 Unfair Stamp TWM 165\n1 Neutralization Zone SFA 60\n58 Grass Energy';
  const parsed=vm.runInContext('parseDeck(deckText)',r.context);
  assert.equal(parsed.valid,false);assert.ok(parsed.issues.some(message=>/ACE SPEC/.test(message)));
});

for(const seed of [2,7]) test('complete Grass match conserves cards and finishes with shared AI handlers, seed '+seed,async t=>{
  const base=loadFixture(), exported=structuredClone(cards);
  const list=`Pokémon: 24
4 Chikorita ASC 8
2 Bayleef MEG 9
2 Meganium MEG 10
2 Mega Meganium ex ASC 10
3 Bulbasaur MEG 1
2 Ivysaur MEG 2
2 Mega Venusaur ex MEG 3
3 Teal Mask Ogerpon ex TWM 25
2 Meowth ex POR 62
1 Celebi MEG 12
1 Fezandipiti ex ASC 142
Trainer: 16
2 Lillie's Determination MEG 119
1 Lana's Aid TWM 155
1 Wally's Compassion MEG 132
3 Bug Catching Set TWM 143
3 Poké Pad POR 81
1 Unfair Stamp TWM 165
2 Forest of Vitality MEG 117
3 Rare Candy MEG 125
Energy: 20
20 Grass Energy`;
  const fixture={...base,cards:[...exported,base.cards.find(c=>c.name==='Rare Candy'),{...energy('grass'),setCode:'',cardNumber:'',language:'en'}],decks:{human:{id:'grass-toma',name:'Grass test',decklist:list},ai:{id:'grass-yami',name:'Grass test opponent',decklist:list}}};
  const r=createEngineRunner(fixture,seed);fixture.cards.forEach(card=>r.api.repairMetadata(card));r.api.setup(fixture,r.random,r.choose,()=>true);
  const verify=()=>{
    const g=r.api.state();
    for(const side of ['you','codex']) {
      const p=g.players[side],owned=[...p.hand,...p.deck,...p.prizes,...p.discard,...p.lost];
      for(const card of [p.active,...p.bench].filter(Boolean))owned.push(card,...card.energy,...card.tools,...card.evolutionStack);
      if(g.stadium?.owner===side)owned.push(g.stadium.card);
      assert.equal(owned.length,60,side+' physical cards at step '+steps+'; duplicates: '+owned.filter((c,i)=>owned.findIndex(o=>o.id===c.id)!==i).map(c=>c.name).join(', ')+'; last: '+g.log.slice(0,6).map(e=>e.message).join(' / '));assert.equal(new Set(owned.map(c=>c.id)).size,60);assert.ok(p.bench.length<=5);
    }
  };
  let steps=0;
  while(r.api.phase()==='play'&&steps++<1400) {
    verify();const g=r.api.state();
    if(g.pendingPromotion)await r.api.promote();
    else if(g.turn==='codex')await r.api.aiStep();
    else {
      const actions=r.api.snapshot().players.you.legalActions.filter(a=>a.type!=='use_ability'||a.ability!=='Solar Transfer');
      const order=['play_basic','evolve','attach_energy','play_stadium','use_ability','play_item','play_supporter','attack','end_turn'];
      const action=order.map(type=>actions.find(a=>a.type===type)).find(Boolean);assert.ok(action);await r.api.humanAction(action);
    }
    assert.equal(r.api.pendingChoices(),false);
    if(steps%15===0 && r.api.phase()==='play') {
      assert.equal(r.api.saveMatch(),true);
      assert.doesNotThrow(()=>r.api.validateMatch(r.context.localStorage.getItem('codexPokemonPlaymat.unfinishedMatch.v1')));
    }
  }
  verify();assert.equal(r.api.phase(),'finished');assert.ok(r.api.matchSummary('you'));t.diagnostic('Finished in '+steps+' actions.');
});

const assert = require('node:assert/strict');
const {test} = require('node:test');
const vm = require('node:vm');
const {loadFixture,createEngineRunner} = require('./integration-harness.cjs');
const {cards} = require('./fixtures/water-deck-cards.fixture.json');
const energy = (id,type='Water') => ({id,name:type+' Energy',meta:{category:'Energy',energyType:type}});
function ready(print='PAL 61',cost=['Water','Water']) {
  const f=loadFixture(),r=createEngineRunner(f,71);
  r.api.setup(f,r.random,r.choose,()=>true);r.api.setLocalAi(false);
  const g=r.api.state(),p=g.players.you,foe=g.players.codex;
  function make(ref,id=ref) {
    const raw=cards.find(card=>card.setCode+' '+card.cardNumber===ref);assert.ok(raw,ref);
    const c={...structuredClone(raw),id,energy:[],tools:[],conditions:[],damage:0,evolutionStack:[],enteredTurn:0,evolvedTurn:-1};
    r.api.repairMetadata(c);return c;
  }
  g.turn='you';g.turnNumber=3;g.firstPlayer='you';p.turnsTaken=foe.turnsTaken=1;
  p.active=make(print);p.active.energy=cost.map((type,i)=>energy('paid-'+i,type));
  p.bench=[];p.hand=[];p.discard=[];foe.bench=[];
  foe.active.meta.hp=1000;foe.active.meta.weaknesses=[];foe.active.meta.resistances=[];
  r.api.clearVisuals();return {r,g,p,foe,make};
}
const choices=(r,fn,coin=()=>true)=>r.api.setChoices(r.random,request=>{
  const result=fn(request.kind,request);return result===undefined?r.choose(request):result;
},coin);
const boardFingerprint=r=>JSON.stringify(r.api.state().players);

test('all 13 raw exported cards become Implemented; restore only verified omitted text',async()=>{
  const r=createEngineRunner(loadFixture());r.api.loadSavedLibrary(structuredClone(cards));await r.api.checkLibrary();
  assert.equal(r.api.libraryAudit().filter(c=>c.status==='implemented').length,13);
  const {make}=ready();
  assert.equal(make('ASR 40').meta.abilities[0].name,'Star Portal');
  assert.match(make('ASR 46').meta.rules[0],/1 Radiant/);
  assert.equal(make('PAL 57').meta.attacks[0].effectTextStatus,'explicit-empty');
});
test('wrong print, language, attack text, cost and damage fail closed; omitted abilities stay blocked',()=>{
  const {r,make}=ready();
  const variants=[make('PAL 61'),make('ASR 40'),make('ASR 46'),make('PAL 60'),make('PAL 57'),make('PAL 60')];
  variants[0].cardNumber='62';variants[1].language='ja';variants[1].meta.language='ja';
  variants[2].meta.attacks[0].effect+=' Draw 2 cards.';
  variants[3].meta.attacks[0].cost=['Water'];variants[4].meta.attacks[0].damage=50;variants[5].meta.abilities=[];
  variants.forEach(c=>assert.notEqual(r.api.inspectFixture({cards:[c]})[0].implementationStatus,'implemented',c.name));
  const bad=structuredClone(cards.find(c=>c.cardNumber==='40'));bad.meta.attacks[0].damage='80+';
  r.api.repairMetadata(bad);assert.equal(bad.meta.abilities.length,0);
});
for(const [ref,index,cost,damage] of [
  ['PAL 57',0,['Water','Colorless'],30],['PAL 59',0,['Water','Colorless'],40],
  ['PAL 59',1,['Water','Water','Colorless'],80],['PAL 60',0,['Water','Water','Colorless'],130]
]) test(ref+' damage-only attack '+index,async()=>{
  const {r,foe}=ready(ref,cost);assert.equal(await r.api.attack('you',index),true);assert.equal(foe.active.damage,damage);
});
test('Super Cold batches multiple Basic Water Energy onto different Pokémon without normal attachment',async()=>{
  const {r,p,make}=ready('PAL 60',[]);p.bench=[make('CRZ 111')];
  p.hand=[energy('a'),energy('b'),energy('fire','Fire')];let n=0;
  choices(r,(kind,data)=>kind==='cards'?data.candidates:kind==='pokemon-target'?data.candidates[n++]:undefined);
  assert.equal(await r.api.useAbility('you',p.active.id,'Super Cold',false),true);
  assert.equal(p.active.energy.length,1);assert.equal(p.bench[0].energy.length,1);
  assert.deepEqual(p.hand.map(c=>c.id),['fire']);assert.equal(p.energyAttachedThisTurn,false);
  p.hand.push(energy('c'));choices(r,()=>undefined);
  assert.equal(await r.api.useAbility('you',p.active.id,'Super Cold',false),true);
});
test('Super Cold cancellation, duplicate and stale targets roll back all Energy and history',async()=>{
  for(const mode of ['cancel','duplicate','stale']) {
    const {r,p}=ready('PAL 60',[]);p.hand=[energy('a'),energy('b')];const before=boardFingerprint(r);
    choices(r,(kind,data)=>{
      if(kind==='cards')return mode==='duplicate'?[data.candidates[0],data.candidates[0]]:data.candidates;
      if(kind==='pokemon-target')return mode==='cancel'?null:{id:'foreign'};
    });
    assert.equal(await r.api.useAbility('you',p.active.id,'Super Cold',false),false,mode);
    assert.equal(boardFingerprint(r),before,mode);
  }
});
test('Shivery Chill searches up to two Basic Water, once per copy per turn, only while Active',async()=>{
  const {r,p,make}=ready();p.deck=[energy('w1'),energy('w2'),energy('w3'),energy('f','Fire')];
  choices(r,(kind,data)=>kind==='cards'?data.candidates.slice(0,2):undefined);
  assert.equal(await r.api.useAbility('you',p.active.id,'Shivery Chill',false),true);
  assert.equal(p.hand.length,2);assert.ok(p.hand.every(c=>c.name==='Water Energy'));
  assert.equal(await r.api.useAbility('you',p.active.id,'Shivery Chill',false),false);
  const second=make('PAL 61','second');r.api.state().players.you.bench.push(second);
  assert.equal(await r.api.useAbility('you',second.id,'Shivery Chill',false),false);
});
test('Hail Blade discards chosen physical Water cards across the board and applies selected damage',async()=>{
  const {r,p,foe,make}=ready();p.bench=[make('PAL 60')];p.bench[0].energy=[energy('bench-water'),energy('bench-fire','Fire')];
  choices(r,(kind,data)=>kind==='cards'?[data.candidates[0],data.candidates.at(-1)]:undefined);
  const preview=r.api.preview('you',0);assert.deepEqual(Array.from(preview.outcomes,o=>o.damage),[0,60,120,180]);
  assert.equal(await r.api.attack('you',0),true);assert.equal(foe.active.damage,120);
  assert.equal(p.discard.filter(c=>c.meta.category==='Energy').length,2);
  assert.deepEqual(p.bench[0].energy.map(c=>c.id),['bench-fire']);
  assert.equal(p.active.energy.length,1);
});
test('Hail Blade accepts zero discards and rejects foreign or duplicated Energy',async()=>{
  const a=ready();choices(a.r,(kind)=>kind==='cards'?[]:undefined);
  assert.equal(await a.r.api.attack('you',0),true);assert.equal(a.foe.active.damage,0);assert.equal(a.p.active.energy.length,2);
  for(const invalid of ['foreign','duplicate']) {
    const {r,p}=ready(),before=boardFingerprint(r);
    choices(r,(kind,data)=>kind==='cards'?invalid==='foreign'?[{id:'foreign'}]:[data.candidates[0],data.candidates[0]]:undefined);
    assert.equal(await r.api.attack('you',0),false);assert.equal(boardFingerprint(r),before);
  }
});
test('Hail Blade counts a special card once even if it supplies two Water Energy',async()=>{
  const {r,p,foe,make}=ready();const base=loadFixture().cards.find(c=>c.name==='Double Dragon Energy');
  assert.ok(base);const host=make('PAL 60');host.meta.types=['Dragon'];
  host.energy=[{...structuredClone(base),id:'double'}];p.bench=[host];
  choices(r,(kind,data)=>kind==='cards'?data.candidates.filter(c=>c.id==='double'):undefined);
  assert.equal(await r.api.attack('you',0),true);assert.equal(foe.active.damage,60);
});
test('Rule the Region searches only Stadiums and Hydro Break locks next own turn',async()=>{
  const a=ready('ASR 39',['Water']);a.p.deck=[a.make('SVI 167'),a.make('ASR 147')];
  assert.equal(await a.r.api.attack('you',0),true);assert.equal(a.p.hand[0].name,'Beach Court');
  const b=ready('ASR 39',['Water','Water','Colorless']);
  assert.equal(await b.r.api.attack('you',1),true);assert.equal(b.foe.active.damage,200);assert.equal(b.p.active.cannotAttackUntilTurn,5);
});
test('Subspace Swell includes both Benches in preview and damage',async()=>{
  const {r,p,foe,make}=ready('ASR 40');p.bench=[make('PAL 57'),make('PAL 59')];foe.bench=[make('CRZ 111')];
  assert.equal(r.api.preview('you',0).outcomes[0].damage,120);
  assert.equal(await r.api.attack('you',0),true);assert.equal(foe.active.damage,120);
});
test('Star Portal assigns up to three discard Water to Water Pokémon, once per game across copies',async()=>{
  const {r,g,p,make}=ready('ASR 40',[]);p.bench=[make('ASR 40','second'),make('CRZ 111')];
  p.discard=[energy('d1'),energy('d2'),energy('d3'),energy('fire','Fire')];let n=0;
  choices(r,(kind,data)=>kind==='cards'?data.candidates:kind==='pokemon-target'?data.candidates[n++%2]:undefined);
  assert.equal(await r.api.useAbility('you',p.active.id,'Star Portal',false),true);
  assert.equal(g.vstarPowerUsed.you,true);assert.equal(g.vstarPowerUsed.codex,false);
  assert.equal(p.active.energy.length+p.bench[0].energy.length,3);assert.equal(p.bench[1].energy.length,0);
  assert.equal(p.energyAttachedThisTurn,false);
  p.discard.push(energy('d4'));g.turnNumber+=2;
  assert.equal(await r.api.useAbility('you',p.bench[0].id,'Star Portal',false),false);
});
test('Star Portal cancelled assignments preserve the once-per-game power; untracked legacy power fails closed',async()=>{
  const {r,g,p}=ready('ASR 40',[]);p.discard=[energy('d')];const before=boardFingerprint(r);
  choices(r,(kind)=>kind==='pokemon-target'?null:undefined);
  assert.equal(await r.api.useAbility('you',p.active.id,'Star Portal',false),false);
  assert.equal(boardFingerprint(r),before);assert.equal(r.api.state().vstarPowerUsed.you,false);
  delete r.api.state().vstarPowerUsed;
  assert.equal(await r.api.useAbility('you',r.api.state().players.you.active.id,'Star Portal',false),false);
});
for(const ref of ['CRZ 111','BRS 121']) for(const heads of [false,true]) test(ref+' coin resolves before '+(heads?'heads damage':'tails doing nothing'),async()=>{
  const {r,foe}=ready(ref,['Colorless','Colorless','Colorless']);let observed=false;
  choices(r,()=>undefined,()=>{assert.equal(foe.active.damage,0);observed=true;return heads;});
  const preview=r.api.preview('you',0);assert.equal(preview.coinCount,1);
  assert.equal(await r.api.attack('you',0),true);assert.equal(observed,true);
  assert.equal(foe.active.damage,heads?(ref==='CRZ 111'?30:100):0);
});
test('Carefree Countenance prevents attack damage from either player only on the Bench',async()=>{
  const {r,p,foe,make}=ready();const b=make('CRZ 111');foe.bench=[b];
  await r.api.damagePokemon('you','codex',b,'bench',90);assert.equal(b.damage,0);
  await r.api.damagePokemon('codex','codex',b,'bench',90);assert.equal(b.damage,0);
  foe.active=b;foe.bench=[];b.meta.hp=1000;await r.api.damagePokemon('you','codex',b,'active',30);assert.equal(b.damage,30);
});
test('Industrious Incisors draws to five once per copy; full hand and empty deck are blocked',async()=>{
  const {r,p,make}=ready('BRS 121',[]);p.deck=Array.from({length:12},(_,i)=>energy('draw-'+i));
  assert.equal(await r.api.useAbility('you',p.active.id,'Industrious Incisors',false),true);assert.equal(p.hand.length,5);
  p.hand=[];assert.equal(await r.api.useAbility('you',p.active.id,'Industrious Incisors',false),false);
  const q=r.api.state().players.you,second=make('BRS 121','second');q.bench=[second];
  assert.equal(await r.api.useAbility('you',second.id,'Industrious Incisors',false),true);
});
test('Concealed Cards discards any Energy from hand then draws two, once per turn; Cancel preserves cost',async()=>{
  const a=ready('ASR 46',[]);a.p.hand=[energy('fire','Fire')];a.p.deck=[energy('draw1'),energy('draw2')];
  assert.equal(await a.r.api.useAbility('you',a.p.active.id,'Concealed Cards',false),true);
  assert.equal(a.p.hand.length,2);assert.equal(a.p.discard[0].id,'fire');
  assert.equal(await a.r.api.useAbility('you',a.p.active.id,'Concealed Cards',false),false);
  const b=ready('ASR 46',[]);b.p.hand=[energy('cancel')];const before=boardFingerprint(b.r);
  choices(b.r,(kind)=>kind==='cards'?null:undefined);
  assert.equal(await b.r.api.useAbility('you',b.p.active.id,'Concealed Cards',false),false);assert.equal(boardFingerprint(b.r),before);
});
test('Moonlight Shuriken selects two distinct targets, pays two Energy, and respects bench prevention / active Weakness',async()=>{
  const {r,p,foe,make}=ready('ASR 46',['Water','Water','Colorless']);const b=make('CRZ 111');foe.bench=[b];
  choices(r,(kind,data)=>kind==='cards'?data.candidates.slice(0,2):undefined);
  foe.active.meta.weaknesses=[{type:'Water',value:'×2'}];
  const preview=r.api.preview('you',0);assert.equal(preview.outcomes[0].damage,180);assert.equal(preview.outcomes[1].damage,0);
  assert.equal(await r.api.attack('you',0),true);assert.equal(foe.active.damage,180);assert.equal(b.damage,0);
  assert.equal(p.active.energy.length,1);assert.equal(p.discard.length,2);
});
test('Moonlight Shuriken can damage a sole opposing Pokémon; cancellation or invalid second target leaves everything unchanged',async()=>{
  const a=ready('ASR 46',['Water','Water','Colorless']);
  choices(a.r,(kind,data)=>kind==='cards'?data.candidates.slice(0,2):undefined);
  assert.equal(await a.r.api.attack('you',0),true);assert.equal(a.foe.active.damage,90);
  for(const invalid of [null,{id:'foreign'}]) {
    const {r,p,foe,make}=ready('ASR 46',['Water','Water','Colorless']);foe.bench=[make('PAL 57')];
    const before=boardFingerprint(r);let n=0;
    choices(r,(kind,data)=>kind==='cards'?data.candidates.slice(0,2):kind==='pokemon-target'&&n++===1?invalid:undefined);
    assert.equal(await r.api.attack('you',0),false);assert.equal(boardFingerprint(r),before);
  }
});
test('Moonlight Shuriken resolves both Knock Outs and prizes before replacement',async()=>{
  const {r,p,foe,make}=ready('ASR 46',['Water','Water','Colorless']);
  choices(r,(kind,data)=>kind==='cards'?data.candidates.slice(0,2):undefined);
  foe.active=make('PAL 57','active-victim');foe.bench=[make('PAL 57','bench-victim'),make('PAL 59','survivor')];
  const startingPrizes=p.prizes.length;
  assert.equal(await r.api.attack('you',0),true);
  assert.equal(foe.discard.filter(c=>['active-victim','bench-victim'].includes(c.id)).length,2);
  assert.equal(p.prizes.length,startingPrizes-2);assert.equal(foe.active.id,'survivor');assert.equal(foe.active.damage,0);
  const log=r.api.state().log.map(e=>e.message).reverse();
  const hits=log.map((m,i)=>m.includes('90 damage')?i:-1).filter(i=>i>=0),ko=log.findIndex(m=>m.includes('was Knocked Out'));
  assert.ok(hits.length>=2);assert.ok(hits.at(-1)<ko);
});
test('Moonlight Shuriken finishes both Knock Outs even when the first takes the last Prize',async()=>{
  const {r,p,foe,make}=ready('ASR 46',['Water','Water','Colorless']);
  choices(r,(kind,data)=>kind==='cards'?data.candidates.slice(0,2):undefined);
  foe.active=make('PAL 57','last-active');foe.bench=[make('PAL 57','last-bench')];p.prizes=p.prizes.slice(0,1);
  assert.equal(await r.api.attack('you',0),true);assert.equal(r.api.phase(),'finished');
  assert.equal(r.api.state().winner,'you');assert.equal(foe.discard.filter(c=>['last-active','last-bench'].includes(c.id)).length,2);
});
test('Moonlight Shuriken boosts only damage to the Active Pokémon for an attached Vitality Band',async()=>{
  const {r,p,foe,make}=ready('ASR 46',['Water','Water','Colorless']);
  const raw=require('./fixtures/additional-library-cards.fixture.json').cards.find(c=>c.name==='Vitality Band');
  assert.ok(raw);p.active.tools=[{...structuredClone(raw),id:'band'}];foe.bench=[make('PAL 59')];foe.bench[0].meta.hp=1000;
  const preview=r.api.preview('you',0);assert.equal(preview.outcomes[0].damage,100);assert.equal(preview.outcomes[1].damage,90);
  choices(r,(kind,data)=>kind==='cards'?data.candidates.slice(0,2):undefined);
  assert.equal(await r.api.attack('you',0),true);assert.equal(foe.active.damage,100);assert.equal(foe.bench[0].damage,90);
});
test('Irida searches one Water Pokémon plus one Item, excluding tools and other Pokémon',async()=>{
  const {r,p,make}=ready();const item=structuredClone(loadFixture().cards.find(c=>c.name==='Ultra Ball'));
  assert.ok(item);item.id='item';p.deck=[make('PAL 57'),make('CRZ 111'),item,make('SVI 167')];
  const irida=make('ASR 147');p.hand=[irida];await r.api.playCard('you',irida.id);
  assert.deepEqual(p.hand.map(c=>c.name).sort(),['Frigibax','Ultra Ball']);assert.equal(p.supporterPlayedThisTurn,true);
});
test('Iono PAL 185 uses each players remaining Prize count',async()=>{
  const {r,p,foe,make}=ready();const iono=make('PAL 185');p.hand=[iono,energy('own')];foe.hand=[energy('foe')];
  p.prizes=p.prizes.slice(0,3);foe.prizes=foe.prizes.slice(0,2);
  await r.api.playCard('you',iono.id);assert.equal(p.hand.length,3);assert.equal(foe.hand.length,2);
});
test('Mystery Garden pays before drawing to Psychic Pokémon count, once per side per turn',async()=>{
  const {r,g,p,foe,make}=ready();p.active.meta.types=['Psychic'];p.bench=[make('PAL 57')];p.bench[0].meta.types=['Psychic'];
  p.hand=[energy('cost','Fire'),make('PAL 57','keep')];p.deck=[energy('draw')];
  g.stadium={card:make('ASC 194'),owner:'you'};assert.equal(await r.context.useActiveStadiumAbility('you'),true);
  assert.equal(p.hand.length,2);assert.equal(p.discard[0].id,'cost');assert.equal(await r.context.useActiveStadiumAbility('you'),false);
  const live=r.api.state();live.turn='codex';live.turnNumber=4;live.players.codex.active.meta.types=['Psychic'];live.players.codex.hand=[energy('opponent-cost')];
  assert.equal(await r.context.useActiveStadiumAbility('codex'),true);assert.equal(r.api.state().stadiumUsage.codex,4);
});
test('Mystery Garden cannot discard solely for no draw; Beach Court reduces only Basic retreat on both sides',()=>{
  const {r,g,p,foe,make}=ready();g.stadium={card:make('ASC 194'),owner:'you'};p.hand=[energy('cost')];
  assert.equal(r.context.canUseActiveStadium('you'),false);p.active.meta.types=['Psychic'];p.hand.push(energy('extra'));
  assert.equal(r.context.canUseActiveStadium('you'),false);
  g.stadium={card:make('SVI 167'),owner:'you'};p.active.meta.retreat=2;foe.active.meta.retreat=1;
  assert.equal(r.api.retreatCost(p.active),1);assert.equal(r.api.retreatCost(foe.active),0);
  p.bench=[make('ASR 40')];assert.equal(r.api.retreatCost(p.bench[0]),2);
});
test('Radiant deck restriction spans all Radiant names and printings',()=>{
  const {r}=ready();assert.equal(vm.runInContext('parseDeck("Pokemon: 2\\n1 Radiant Greninja ASR 46\\n1 Radiant Charizard PGO 11\\nEnergy: 58\\n58 Water Energy").valid',r.context),false);
});

function fullFixture() {
  const base=loadFixture(),exported=structuredClone(cards),helper=createEngineRunner(base);
  exported.forEach(card=>helper.api.repairMetadata(card));
  const list=`Pokemon: 19
3 Frigibax PAL 57
2 Arctibax PAL 59
2 Baxcalibur PAL 60
3 Chien-Pao ex PAL 61
2 Origin Forme Palkia V ASR 39
2 Origin Forme Palkia VSTAR ASR 40
2 Bidoof CRZ 111
2 Bibarel BRS 121
1 Radiant Greninja ASR 46
Trainer: 17
3 Irida ASR 147
3 Iono PAL 185
2 Mystery Garden ASC 194
2 Beach Court SVI 167
3 Rare Candy MEG 125
4 Ultra Ball ASC 213
Energy: 24
24 Water Energy`;
  return {...base,cards:[...exported,...base.cards.filter(c=>['Rare Candy','Ultra Ball'].includes(c.name)),{...energy('water'),language:'en'}],
    decks:{human:{id:'water-toma',name:'Water test',decklist:list},ai:{id:'water-yami',name:'Water test opponent',decklist:list}}};
}
for(const seed of [9,37]) test('complete Water match preserves 60 physical cards and resumable power state, seed '+seed,async t=>{
  const fixture=fullFixture(),r=createEngineRunner(fixture,seed);
  choices(r,(kind,data)=>kind==='cards'&&data.title.startsWith('Moonlight Shuriken')?data.candidates.slice(0,2):undefined);
  // setup installs its own hooks; restore the multi-Energy test choices afterwards.
  r.api.setup(fixture,r.random,r.choose,()=>true);
  choices(r,(kind,data)=>kind==='cards'&&data.title.startsWith('Moonlight Shuriken')?data.candidates.slice(0,2):undefined);
  let steps=0,usedPower=false;
  const verify=()=>{
    const g=r.api.state();
    for(const side of ['you','codex']) {
      const p=g.players[side],physical=[...p.hand,...p.deck,...p.prizes,...p.discard,...p.lost];
      for(const card of [p.active,...p.bench].filter(Boolean))physical.push(card,...card.energy,...card.tools,...card.evolutionStack);
      if(g.stadium?.owner===side)physical.push(g.stadium.card);
      assert.equal(physical.length,60,side+' cards at step '+steps);
      assert.equal(new Set(physical.map(c=>c.id)).size,60);assert.ok(p.bench.length<=5);
      if(g.vstarPowerUsed[side]) usedPower=true;
    }
  };
  while(r.api.phase()==='play'&&steps++<900) {
    verify();const g=r.api.state();
    if(g.pendingPromotion)await r.api.promote();
    else if(g.turn==='codex')await r.api.aiStep();
    else {
      const actions=r.api.snapshot().players.you.legalActions;
      const order=['play_basic','evolve','attach_energy','play_stadium','use_ability','play_item','play_supporter','attack','end_turn'];
      const action=order.map(type=>actions.find(a=>a.type===type)).find(Boolean);assert.ok(action);await r.api.humanAction(action);
    }
    assert.equal(r.api.pendingChoices(),false);
    if(steps%15===0&&r.api.phase()==='play') {
      assert.equal(r.api.saveMatch(),true);const saved=r.context.localStorage.getItem('codexPokemonPlaymat.unfinishedMatch.v1');
      assert.doesNotThrow(()=>r.api.validateMatch(saved));
      const malformed=JSON.parse(saved);malformed.game.vstarPowerUsed.you='false';assert.throws(()=>r.api.validateMatch(malformed));
      const power=JSON.stringify(r.api.state().vstarPowerUsed);assert.equal(r.api.resumeMatch(),true);
      assert.equal(JSON.stringify(r.api.state().vstarPowerUsed),power);
    }
  }
  verify();assert.equal(r.api.phase(),'finished');assert.ok(r.api.matchSummary('you'));
  t.diagnostic('Finished in '+steps+' actions; VSTAR Power used: '+usedPower);
});

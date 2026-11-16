const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadFixture, createEngineRunner } = require('./integration-harness.cjs');
const { cards: exported } = require('./fixtures/ethan-psychic-deck-cards.fixture.json');

const energy = (id, type = 'Psychic') => ({ id, name: type + ' Energy', meta: { category:'Energy', energyType:type } });
function ready(print, costs = []) {
  const f = loadFixture(), r = createEngineRunner(f, 48), records = structuredClone(exported);
  for (const card of records) r.api.repairMetadata(card);
  r.api.setup(f,r.random,r.choose,()=>true);
  r.api.setLocalAi(false);
  const g = r.api.state(), p = g.players.you, foe = g.players.codex;
  const make = (reference,id=reference) => {
    const card = records.find(item=>item.setCode+' '+item.cardNumber===reference);
    assert.ok(card,reference);
    return {...structuredClone(card),id,energy:[],tools:[],evolutionStack:[],conditions:[],damage:0,enteredTurn:0,evolvedTurn:-1};
  };
  g.turn = 'you'; g.turnNumber = 3; g.firstPlayer = 'you'; p.turnsTaken = 1; foe.turnsTaken = 1;
  p.active = make(print); p.active.energy = costs.map((type,index)=>energy('paid-'+index,type)); p.bench = []; p.hand = []; p.discard = [];
  foe.bench = []; foe.active.meta.hp = 500; foe.active.meta.weaknesses = []; foe.active.meta.resistances = [];
  r.api.clearVisuals();
  return {r,g,p,foe,make,records};
}

test('every pending exact print becomes Implemented after the saved-card check, including unchecked Giratina', async () => {
  const f = loadFixture(), r = createEngineRunner(f);
  r.api.loadSavedLibrary(structuredClone(exported));
  await r.api.checkLibrary();
  const result = r.api.libraryAudit();
  for (const card of exported) {
    const actual = result.find(item=>item.name===card.name && item.setCode===card.setCode && item.cardNumber===card.cardNumber);
    assert.equal(actual?.status,'implemented',card.name+' '+card.setCode+' '+card.cardNumber);
  }
  const giratina = result.find(card=>card.name==='Giratina');
  assert.equal(giratina.language,'ja');
  assert.equal(giratina.meta.hp,130);
  assert.equal(giratina.meta.attacks[0].name,'Chaos Crawler');
  assert.match(giratina.meta.image,/M6_31_R_JP\.png$/);
});

test('a mismatched reprint, Tool attack or missing damage-only effect stays blocked', () => {
  const {r,make} = ready('DRI 32');
  const ultra = make('SVI 196'); ultra.cardNumber='195';
  const machine = make('PAR 178'); machine.meta.attacks[0].cost=['Psychic'];
  const quilava = make('DRI 33'); quilava.meta.attacks[0].damage=10; quilava.meta.attacks[0].effect=null; quilava.meta.attacks[0].effectTextStatus='missing';
  assert.equal(r.api.repairMetadata(quilava),false);
  assert.ok(r.api.inspectFixture({cards:[ultra,machine,quilava]}).every(card=>card.implementationStatus!=='implemented'));
});

test('Ethan’s Adventure searches only the two printed groups, and Buddy Blast counts Adventure in discard', async () => {
  const {r,p,foe,make} = ready('DRI 34',['Fire']);
  const adventure = make('DRI 165'), cyndaquil = make('DRI 32'), fire = energy('fire','Fire');
  p.hand = [adventure]; p.deck = [fire,energy('not-fire'),cyndaquil,make('PAL 35')];
  let offered;
  r.api.setChoices(r.random, q=>{offered=q.candidates.map(card=>card.id);return q.candidates;});
  await r.api.playCard('you',adventure.id);
  assert.deepEqual(Array.from(offered).sort(),[fire.id,cyndaquil.id].sort());
  assert.ok(p.hand.includes(fire) && p.hand.includes(cyndaquil));
  assert.equal(await r.api.attack('you',0),true);
  assert.equal(foe.active.damage,100);
});

test('Bonded by the Journey reveals Ethan’s Adventure once per copy each turn', async () => {
  const {r,p,make} = ready('DRI 33');
  const adventure = make('DRI 165'), other = make('PAL 35');
  p.deck = [other,adventure];
  assert.equal(await r.api.useAbility('you',p.active.id,'Bonded by the Journey',false),true);
  assert.ok(p.hand.includes(adventure));
  assert.equal(await r.api.useAbility('you',p.active.id,'Bonded by the Journey',false),false);
});

test('Buddy-Buddy Poffin checks printed Basic HP and remaining Bench space', async () => {
  const {r,p,make} = ready('DRI 32');
  const poffin=make('TEF 144'), abra=make('TWM 80'), fuecoco=make('PAL 35'), kadabra=make('MEG 55');
  p.bench=Array.from({length:4},(_,i)=>make('PAL 156','filled-'+i)); p.deck=[fuecoco,kadabra,abra]; p.hand=[poffin];
  r.api.setChoices(r.random,q=>{assert.equal(q.maxCount,1);assert.deepEqual(Array.from(q.candidates),[abra]);return [abra];});
  await r.api.playCard('you',poffin.id);
  assert.equal(p.bench.length,5);
  assert.ok(p.bench.includes(abra) && p.deck.includes(fuecoco) && p.deck.includes(kadabra));
});

test('Teleporter and Run Away Draw shuffle the whole Pokémon stack and keep the turn', async () => {
  const a = ready('TWM 80',['Psychic']);
  const abra=a.p.active, host=a.make('PAL 156');a.p.bench=[host];
  assert.equal(await a.r.api.useAbility('you',abra.id,'Teleporter',false),true);
  assert.equal(a.g.pendingPromotion,'you');
  await a.r.api.promote();
  assert.equal(a.p.active,host);
  assert.equal(a.g.turn,'you');
  assert.ok(a.p.deck.includes(abra));
  const h = ready('DRI 32'), duns=h.make('TEF 129'), base=h.make('PAL 156');
  duns.evolutionStack=[base];duns.energy=[energy('tucked')];duns.tools=[h.make('TEF 159')];
  h.p.bench=[duns];h.p.deck=[h.make('DRI 165')];
  assert.equal(await h.r.api.useAbility('you',duns.id,'Run Away Draw',false),true);
  assert.equal(h.p.hand.length,1);
  assert.equal(h.p.bench.length,0);
  assert.deepEqual(Array.from(h.p.deck,item=>item.id).sort(),['PAL 156','TEF 129','TEF 159','tucked']);
});

test('Flower Curtain protects non-rule-box Bench from Cruel Arrow, but permits damage counters', async () => {
  const {r,g,p,foe,make} = ready('SFA 38',['Darkness','Darkness','Darkness']);
  const shaymin=make('DRI 10'), victim=make('TWM 80');foe.bench=[shaymin,victim];
  r.api.setChoices(r.random,()=>victim);
  assert.equal(await r.api.attack('you',0),true);
  assert.equal(victim.damage,0);
  g.turn='you';g.turnNumber=5;p.attackedThisTurn=false;
  p.active=make('PRE 43');p.active.energy=[energy('p1'),energy('p2'),energy('p3')];
  assert.equal(await r.api.attack('you',0),true);
  assert.equal(victim.damage,20);
});

test('Flip the Script is shared across copies and checks the opposing turn, not an old Knockout', async () => {
  const {r,g,p,make} = ready('SFA 38');
  const second=make('SFA 38','second');p.bench=[second];g.lastKnockoutTurns={you:1};
  assert.equal(await r.api.useAbility('you',p.active.id,'Flip the Script',false),false);
  r.api.state().lastKnockoutTurns.you=2;
  assert.equal(await r.api.useAbility('you',p.active.id,'Flip the Script',false),true);
  assert.equal(r.api.state().players.you.hand.length,3);
  assert.equal(await r.api.useAbility('you',second.id,'Flip the Script',false),false);
});

test('Alakazam ex uses Dimensional Hand from the Bench without switching or using Mind Jack', async () => {
  const {r,p,foe,make} = ready('DRI 32');
  const active=p.active, alakazam=make('MEW 65');
  alakazam.energy=[energy('p1'),energy('p2')];p.bench=[alakazam];
  const options=r.api.snapshot().players.you.legalActions.filter(action=>action.type==='attack');
  assert.deepEqual(Array.from(options,action=>action.attack),['Dimensional Hand']);
  assert.equal(await r.api.attack('you',0,[],alakazam.id),false);
  assert.equal(await r.api.attack('you',1,[],alakazam.id),true);
  assert.equal(p.active,active);
  assert.equal(foe.active.damage,120);
});

test('Technical Machine grants an attack, evolves from the deck and discards at turn end', async () => {
  const {r,p,make} = ready('DRI 32',['Fire']);
  const machine=make('PAR 178'), abra=make('TWM 80'), kadabra=make('MEG 55');
  p.active.tools=[machine];p.bench=[abra];p.deck=[kadabra,energy('stay-in-deck')];
  r.api.setChoices(r.random,q=>q.candidates.slice(0,1));
  const move=r.api.snapshot().players.you.legalActions.find(action=>action.attack==='Evolution');
  assert.ok(move);
  assert.equal(await r.api.attack('you',move.attackIndex),true);
  assert.equal(p.bench[0],kadabra);
  assert.equal(p.hand.length,0,'evolving from deck does not trigger Psychic Draw');
  assert.equal(p.active.tools.length,0);
  assert.ok(p.discard.includes(machine));
});

test('Memory Helix copies printed Bench moves, pays the cost on Mew, and respects Midnight Fluttering', async () => {
  const {r,p,foe,make} = ready('30C 66',['Psychic','Psychic','Psychic']);
  p.bench=[make('30C 63')];foe.active=make('PRE 43');foe.active.meta.hp=500;
  assert.deepEqual(Array.from(r.api.attackOptions('you'),entry=>entry.attack.name),['Teleportation Burst']);
  foe.active=make('PAL 35');foe.active.meta.hp=500;
  const copy=r.api.attackOptions('you').find(entry=>entry.attack.name==='Psydrive');
  assert.ok(copy);
  const paid=p.active.energy[0];
  assert.equal(await r.api.attack('you',copy.index,[paid.id]),true);
  assert.ok(p.discard.includes(paid));
  assert.equal(p.active.energy.length,2);
  assert.equal(p.bench[0].energy.length,0);
  assert.equal(foe.active.damage,120);
});

test('Midnight Fluttering makes the owner of a suppressed Revavroom ex discard excess Tools', async () => {
  const {r,p,foe,make} = ready('DRI 32');
  const flutter=make('PRE 43'), board=make('TEF 159'), machine=make('PAR 178');
  const revavroom=structuredClone(require('./fixtures/metal-and-japanese-cards.fixture.json').cards.find(card=>card.name==='Revavroom ex'));
  assert.ok(revavroom);
  Object.assign(revavroom,{id:'revavroom-active',damage:0,conditions:[],energy:[],evolutionStack:[],tools:[board,machine]});
  foe.active=revavroom; p.bench=[flutter];
  const switching=loadFixture().cards.find(card=>card.name==='Switch');
  p.hand=[{...structuredClone(switching),id:'switch-card'}];
  let toolChoice;
  r.api.setChoices(r.random,q=>{
    if (q.kind==='pokemon-target') return flutter;
    toolChoice=q;
    return [machine];
  });
  await r.api.playCard('you','switch-card');
  assert.equal(p.active,flutter);
  assert.equal(toolChoice.side,'codex');
  assert.deepEqual(Array.from(foe.active.tools),[board]);
  assert.ok(foe.discard.includes(machine));
});

test('Chaos Crawler shields Giratina for the opposing turn and locks the next Chaos Crawler across copies', async () => {
  const {r,g,p,make} = ready('M6 31',['Psychic','Psychic','Psychic']);
  assert.equal(await r.api.attack('you',0),true);
  const first=p.active;
  await r.api.damagePokemon('codex','you',first,'active',90);
  assert.equal(first.damage,0);
  await r.api.endTurnFor('codex');
  const replacement=make('M6 31','second-giratina');replacement.energy=[energy('p1'),energy('p2'),energy('p3')];p.active=replacement;
  assert.equal(r.api.attackOptions('you').length,0);
  g.turnNumber+=2;
  assert.equal(r.api.attackOptions('you').length,1);
});

test('Alluring Dance Confuses the switched Pokémon, and tails cancel its next attack with self-damage', async () => {
  const {r,p,foe,make} = ready('LOR 68',['Psychic','Psychic']);
  const target=make('DRI 32');target.energy=[energy('fire','Fire')];foe.bench=[target];
  r.api.setChoices(r.random,()=>target,()=>false);
  assert.equal(await r.api.attack('you',0),true);
  assert.equal(foe.active,target);
  assert.ok(target.conditions.some(item=>item.type==='confused'));
  assert.equal(await r.api.attack('codex',0,[target.energy[0].id]),true);
  assert.equal(target.damage,30);
  assert.equal(p.active.damage,0);
  assert.equal(target.energy.length,1);
});

test('Horoscope attaches chosen Energy and puts the remaining top cards in the requested order', async () => {
  const {r,p,make} = ready('CRZ 65',['Psychic']);
  const a=make('PAL 156'), b=make('TEF 129'), selected=energy('to-attach');
  p.deck=[energy('bottom'),a,b,selected];
  r.api.setChoices(r.random,q=>q.candidates.includes(selected)?[selected]:a);
  assert.equal(await r.api.attack('you',0),true);
  assert.ok(p.active.energy.includes(selected));
  assert.deepEqual(Array.from(p.deck,item=>item.id),['bottom',b.id,a.id]);
});

test('Telepathic Psychic Energy searches the Psychic Bench while Old Cemetery damages non-Psychic targets', async () => {
  const a=ready('TWM 80'), tele=a.make('POR 88'), target=a.make('LOR 68'), other=a.make('DRI 32');
  a.p.hand=[tele];a.p.deck=[target,other];a.g.stadium={owner:'codex',card:a.make('CRE 147')};
  assert.equal(await a.r.api.attachFor('you',tele.id,a.p.active.id),true);
  assert.ok(a.p.bench.includes(target) && a.p.deck.includes(other));
  assert.equal(a.p.active.damage,0);
  assert.deepEqual(Array.from(a.r.api.energyUnits(tele,a.p.active)),['psychic']);
  const b=ready('DRI 32'), fire=energy('fire','Fire');b.p.hand=[fire];b.g.stadium={owner:'codex',card:b.make('CRE 147')};
  assert.equal(await b.r.api.attachFor('you',fire.id,b.p.active.id),true);
  assert.equal(b.p.active.damage,20);
});

test('Neutralization Zone stops opposing Pokémon ex damage to Pokémon without Rule Boxes on either side', async () => {
  const {r,g,p,foe,make} = ready('SFA 38',['Darkness','Darkness','Darkness']);
  g.stadium={owner:'you',card:make('SFA 60')};
  const basic=make('LOR 68');foe.active=basic;
  await r.api.damagePokemon('you','codex',basic,'active',90);
  assert.equal(basic.damage,0);
  const ex=make('MEW 65');foe.bench=[ex];
  await r.api.damagePokemon('you','codex',ex,'bench',90);
  assert.equal(ex.damage,90);
  foe.active=ex;
  const target=make('PAL 35');p.bench=[target];
  await r.api.damagePokemon('codex','you',target,'bench',90);
  assert.equal(target.damage,0);
});

test('representative Ethan and Psychic decks play a full match with valid checkpoints and 60 cards per side', async () => {
  const f=loadFixture(), records=structuredClone(exported), r=createEngineRunner(f,133);
  for (const card of records) r.api.repairMetadata(card);
  const byPrint=Object.fromEntries(records.map(card=>[card.setCode+' '+card.cardNumber,card]));
  const decklist=(counts,type,basicCount)=>Object.entries(counts).map(([print,count])=>count+' '+byPrint[print].name+' '+print).concat(basicCount+' '+type+' Energy').join('\n');
  f.decks.human={id:'ethan-integration',name:'Ethan Test Deck',decklist:decklist({
    'DRI 32':4,'DRI 33':4,'DRI 34':4,'PAL 35':2,'PAL 156':3,'TEF 129':3,'DRI 10':1,'SFA 38':1,
    'DRI 165':4,'SVI 189':2,'PAL 172':2,'SVI 196':2,'TEF 144':2,'SVI 181':2,'SVI 171':2,
    'SFA 61':1,'SVI 191':1,'PAR 163':1,'PAR 178':1,'TEF 159':1,'PAL 171':1,'SFA 60':1
  },'Fire',15)};
  f.decks.ai={id:'psychic-integration',name:'Psychic Test Deck',decklist:decklist({
    'TWM 80':4,'MEG 55':3,'MEW 65':3,'PRE 43':2,'MEG 64':2,'LOR 68':1,'30C 63':2,'CRZ 65':1,'30C 66':1,'M6 31':2,
    'MEG 131':4,'SVI 191':2,'PAF 81':1,'CRE 147':1,'SVI 189':3,'SVI 181':2,'TEF 144':2,'TEF 159':2,
    'PAL 172':2,'PAR 178':1,'SVI 171':2,'PAR 163':1,'POR 88':4
  },'Psychic',12)};
  f.cards=[...records,...['Fire','Psychic'].map(type=>({...energy('basic-'+type,type),language:'en',categoryHint:'Energy',meta:{category:'Energy',energyType:type,language:'en'}}))];
  r.api.setup(f,r.random,q=>q.kind==='cards'?q.candidates.slice(0,q.maxCount):q.kind==='confirm'?true:r.choose(q),()=>true);
  let steps=0, saves=0;
  while (r.api.phase()==='play' && steps++ < 500) {
    const state=r.api.state();
    if (state.pendingPromotion) await r.api.promote();
    else if (state.turn==='codex') await r.api.aiStep();
    else {
      const available=r.api.snapshot().players.you.legalActions;
      const order=['play_basic','evolve','use_ability','attach_energy','play_item','play_supporter','attack','end_turn'];
      const action=order.map(type=>available.find(item=>item.type===type)).find(Boolean);
      assert.ok(action);
      await r.api.humanAction(action);
    }
    r.api.clearVisuals();
    const current=r.api.state();
    for (const side of ['you','codex']) {
      const player=current.players[side], owned=[...player.deck,...player.hand,...player.discard,...player.lost,...player.prizes];
      for (const card of [player.active,...player.bench].filter(Boolean)) owned.push(card,...card.energy,...card.tools,...card.evolutionStack);
      if (current.stadium?.owner===side) owned.push(current.stadium.card);
      assert.equal(owned.length,60);
      assert.equal(new Set(owned.map(card=>card.id)).size,60);
    }
    if (current.phase==='play' && steps%5===0) { assert.equal(r.api.saveMatch(),true);saves++; }
  }
  assert.equal(r.api.phase(),'finished');
  assert.ok(saves>0);
});

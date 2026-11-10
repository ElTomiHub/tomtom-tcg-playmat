const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createEngineRunner, loadFixture } = require('./integration-harness.cjs');
const { cards } = require('./fixtures/psychic-deck-cards.fixture.json');
const base = loadFixture();
const fixture = { ...base, cards: [...base.cards, ...cards] };

function make(name, id = name) {
  const card = { ...structuredClone(cards.find(item => item.name === name)), id, damage: 0, energy: [], tools: [], conditions: [], evolutionStack: [], enteredTurn: 0, evolvedTurn: -1 };
  card.meta.attacks.forEach(attack => {
    if (attack.effect === null) { attack.effect = ''; attack.effectTextStatus = 'explicit-empty'; }
  });
  if (name === 'Switch') card.meta.effect = 'Switch your Active Pokémon with 1 of your Benched Pokémon.';
  return card;
}
function energy(id, type = 'Psychic') { return { id, name: type + ' Energy', meta: { category: 'Energy', energyType: type } }; }
function ready(active = 'Ralts') {
  const r = createEngineRunner(fixture, 57);
  r.api.setup(fixture, r.random, r.choose, () => true);
  r.api.setLocalAi(false);
  const g = r.api.state(), p = g.players.you, foe = g.players.codex;
  g.turn = 'you'; g.firstPlayer = 'you'; g.turnNumber = 3; p.turnsTaken = 1; p.supporterPlayedThisTurn = false;
  p.active = make(active); p.bench = []; p.hand = []; p.discard = [];
  p.deck = Array.from({length:12}, (_, i) => energy('deck-' + i));
  foe.active.meta.hp = 9999; foe.active.meta.weaknesses = []; foe.active.meta.resistances = [];
  return { r, g, p, foe };
}

test('all 19 exact saved printings update without rewriting complete effects', async () => {
  const r = createEngineRunner(fixture);
  r.api.loadSavedLibrary(cards);
  await r.api.checkLibrary();
  const audit = r.api.libraryAudit().filter(record => cards.some(card => card.id === record.id));
  assert.equal(audit.length, 19);
  assert.deepEqual(Array.from(audit.filter(record => record.status !== 'implemented'), record => record.name), []);
  for (const record of audit) {
    const original = cards.find(card => card.id === record.id);
    if (original.meta.effect) assert.equal(record.meta.effect, original.meta.effect);
    for (let i = 0; i < original.meta.attacks.length; i++) {
      if (original.meta.attacks[i].effect !== null) assert.equal(record.meta.attacks[i].effect, original.meta.attacks[i].effect);
    }
  }
  const wrong = make('Mega Gardevoir ex');
  wrong.meta.attacks[1].effect += ' Draw a card.';
  assert.notEqual(r.api.inspectFixture({cards:[wrong]})[0].resolution, 'automated');
});

test('Refinement discards one chosen card, draws two and can only be used once', async () => {
  const {r,p}=ready('Kirlia'), paid=energy('paid');
  p.hand=[paid];
  r.api.setChoices(r.random,q=>q.kind==='cards'?[paid]:r.choose(q));
  assert.equal(await r.api.useAbility('you',p.active.id,'Refinement'),true);
  assert.equal(p.hand.length,2);
  assert.ok(p.discard.includes(paid));
  assert.equal(await r.api.useAbility('you',p.active.id,'Refinement'),false);
});

test('Overflowing Wishes gives one Basic Psychic Energy per Benched Pokémon and Mega Symphonia counts the whole board', async () => {
  const {r,g,p}=ready('Mega Gardevoir ex');
  const a=make('Ralts','a'), b=make('Flutter Mane','b');
  p.bench=[a,b]; p.active.energy=[energy('attached')];
  p.deck.push(energy('fire','Fire')); b.energy=[energy('unrelated','Fire')];
  assert.equal(await r.api.attack('you',0),true);
  assert.equal(a.energy.length,1);
  assert.equal(b.energy.length,2);
  assert.equal(p.active.energy.length,1);
  g.turn='you'; g.turnNumber=5; p.attackedThisTurn=false;
  assert.equal(r.api.preview('you',1).outcomes[0].damage,150);
});

test('Switch into Iron Valiant ex can place counters on an opponent’s Bench only once per copy each turn', async () => {
  const {r,p,foe}=ready(), valiant=make('Iron Valiant ex'), target=make('Ralts','foe-bench');
  p.bench=[valiant]; foe.bench=[target];
  r.api.setChoices(r.random,q=>q.kind==='pokemon-target'?(q.title.includes('Tachyon')?target:q.candidates[0]):r.choose(q));
  for (let i=0; i<3; i++) {
    const item=make('Switch','switch-'+i);
    p.hand.push(item);
    await r.api.playCard('you',item.id);
    assert.ok(p.discard.includes(item));
    if (i===0) {
      const effects=[r.api.visualState().active,...r.api.visualState().queued].filter(Boolean);
      const entrance=effects.findIndex(effect=>effect.cardId===valiant.id && effect.destination==='active');
      const ability=effects.findIndex(effect=>effect.kind==='ability' && effect.ability==='Tachyon Bits');
      const damage=effects.findIndex(effect=>effect.kind==='damage' && effect.cardId===target.id);
      assert.ok(entrance>=0 && ability>entrance && damage>ability);
    }
  }
  assert.equal(p.active,valiant);
  assert.equal(target.damage,20);
  assert.equal(foe.active.damage,0);
});

test('Perplexing Transfer offers only damaged Ancient Bench Pokémon and moves counters without damage modifiers', async () => {
  const {r,p,foe}=ready('Flutter Mane'), ancient=make('Flutter Mane','ancient'), other=make('Ralts','other');
  ancient.damage=30; other.damage=50; p.bench=[ancient,other]; p.active.energy=[energy('first'),energy('second')];
  foe.active.meta.weaknesses=[{type:'Psychic',value:'×2'}];
  r.api.setChoices(r.random,q=>{
    if(q.kind==='pokemon-target') { assert.deepEqual(Array.from(q.candidates,c=>c.id),['ancient']); return ancient; }
    return r.choose(q);
  });
  assert.equal(await r.api.attack('you',0),true);
  assert.equal(ancient.damage,0);
  assert.equal(other.damage,50);
  assert.equal(foe.active.damage,30);
});

test('Moonblast reduces damage before Weakness and applies to the original defending Pokémon', async () => {
  const {r,p,foe}=ready('Flutter Mane');
  p.active.energy=[energy('first'),energy('second')];
  p.active.meta.hp=9999;
  p.active.meta.weaknesses=[{type:'Psychic',value:'×2'}];
  foe.active=make('Iron Valiant ex','defender');
  foe.active.energy=[energy('f1'),energy('f2'),energy('f3')];
  assert.equal(await r.api.attack('you',1),true);
  assert.equal(r.api.preview('codex',0).outcomes[0].damage,340);
  assert.equal(await r.api.attack('codex',0),true);
  assert.equal(p.active.damage,340);
});

test('Furisode Girl Benches the selected Basic, then switches only that Pokémon', async () => {
  const {r,p}=ready(), original=p.active, chosen=make('Ralts','from-deck'), card=make('Furisode Girl');
  p.deck.push(chosen); p.hand.push(card);
  r.api.setChoices(r.random,q=>q.kind==='cards'?[chosen]:r.choose(q));
  await r.api.playCard('you',card.id);
  assert.equal(p.active,chosen);
  assert.equal(p.bench[0],original);
  assert.ok(p.discard.includes(card));
});

test('Sada attaches to distinct Ancient Pokémon and draws three only after attaching', async () => {
  const {r,p}=ready('Flutter Mane'), card=make("Professor Sada's Vitality");
  const other=make('Flutter Mane','second'), ordinary=make('Ralts','ordinary');
  p.bench=[other,ordinary]; p.hand=[card]; p.discard=[energy('discard1'),energy('discard2','Fire')];
  await r.api.playCard('you',card.id);
  assert.equal(p.active.energy.length,1);
  assert.equal(other.energy.length,1);
  assert.equal(ordinary.energy.length,0);
  assert.equal(p.hand.length,3);
});

test('Japanese Sada attaches to Japanese Flutter Mane, then draws three', async () => {
  const {r,p}=ready();
  const japanese=(name,setCode,cardNumber)=>({
    id:setCode+':'+cardNumber,name,setCode,cardNumber,meta:null,energy:[],tools:[],conditions:[],damage:0
  });
  const flutter=japanese('Flutter Mane','SV8','59');
  const sada=japanese("Professor Sada's Vitality",'SV4K','85');
  assert.equal(r.api.repairMetadata(flutter),true);
  assert.equal(r.api.repairMetadata(sada),true);
  const ordinary=p.active, basic=energy('discard-basic');
  p.bench=[flutter];
  p.hand=[sada];
  p.discard=[basic];
  await r.api.playCard('you',sada.id);
  assert.deepEqual(flutter.energy,[basic]);
  assert.equal(ordinary.energy.length,0);
  assert.equal(p.hand.length,3);
  assert.ok(p.discard.includes(sada));
});

test('Drayton takes at most one Pokémon and one Trainer from only the top seven', async () => {
  const {r,p}=ready(), card=make('Drayton'), mon=make('Flutter Mane','eligible'), trainer=make('Sacred Ash','trainer');
  const outside=make('Mega Gardevoir ex','outside');
  p.deck=[outside,...Array.from({length:5},(_,i)=>energy('e'+i)),mon,trainer]; p.hand=[card];
  let choices = 0;
  r.api.setChoices(r.random, request => {
    assert.equal(request.kind, 'cards');
    choices++;
    assert.deepEqual(Array.from(request.candidates, item => item.id).sort(), ['eligible','trainer']);
    return [mon, trainer];
  });
  await r.api.playCard('you',card.id);
  assert.equal(choices, 1);
  assert.deepEqual(Array.from(p.hand,item=>item.id).sort(),['eligible','trainer']);
  assert.ok(p.deck.includes(outside));
});

test('Drayton can take just a Trainer from a short deck and rejects two Trainers', async () => {
  for (const duplicateCategory of [false, true]) {
    const {r,p} = ready(), card = make('Drayton');
    const trainers = [make('Sacred Ash','first'), make('Sacred Ash','second')];
    p.deck = trainers.slice();
    p.hand = [card];
    r.api.setChoices(r.random, () => duplicateCategory ? trainers : trainers.slice(0, 1));
    await r.api.playCard('you',card.id);
    const live = r.api.state().players.you;
    assert.deepEqual(Array.from(live.hand, item => item.id), [duplicateCategory ? card.id : 'first']);
    assert.equal(live.deck.length, duplicateCategory ? 2 : 1);
    assert.equal(live.supporterPlayedThisTurn, !duplicateCategory);
  }
});

test('Lillie draws eight with all six Prizes left and six otherwise', async () => {
  for (const count of [6,5]) {
    const {r,p}=ready(), card=make("Lillie's Determination");
    p.hand=[card,energy('shuffle')]; p.prizes=p.prizes.slice(0,count);
    await r.api.playCard('you',card.id);
    assert.equal(p.hand.length,count===6?8:6);
  }
});
test('Lillie shuffles the deck even when it is the only card in hand', async () => {
  const {r,p}=ready(), card=make("Lillie's Determination");
  p.hand=[card];
  r.api.setChoices(()=>0,r.choose);
  await r.api.playCard('you',card.id);
  assert.equal(p.hand[0].id,'deck-0');
  assert.equal(p.hand.length,8);
});

test('Morty requires a Psychic Knockout on the immediately preceding opposing turn', async () => {
  const {r,g,p,foe}=ready(), card=make('Morty');
  p.hand=[card]; foe.hand=[energy('one'),energy('two'),energy('three')];
  await r.api.playCard('you',card.id);
  assert.ok(p.hand.includes(card));
  g.turn='codex'; g.turnNumber=2;
  p.bench=[make('Flutter Mane','replacement')];
  foe.active=make('Iron Valiant ex','knockout-attacker');
  foe.active.energy=[energy('e1'),energy('e2'),energy('e3')];
  assert.equal(await r.api.attack('codex',0),true);
  assert.equal(g.psychicKnockoutTurns.you,2);
  await r.api.promote();
  assert.equal(g.turn,'you');
  await r.api.playCard('you',card.id);
  assert.ok(p.discard.includes(card));
  assert.equal(foe.hand.length,2);
  assert.equal(foe.deck.filter(item=>['one','two','three'].includes(item.id)).length,2);
});

test('Sacred Ash recovers Pokémon but leaves Basic Energy in the discard', async () => {
  const {r,p}=ready(), card=make('Sacred Ash'), target=make('Ralts','recover'), oldEnergy=energy('left');
  p.hand=[card]; p.discard=[target,oldEnergy]; target.damage=80;
  await r.api.playCard('you',card.id);
  assert.ok(p.deck.includes(target));
  assert.equal(target.damage,0);
  assert.ok(p.discard.includes(oldEnergy));
});

for (const [name,targetName] of [['Fog Crystal','Flutter Mane'],['Mega Signal','Mega Gardevoir ex'],['Techno Radar','Iron Valiant ex']]) {
  test(`${name} searches only eligible cards and pays its printed cost`,async()=>{
    const {r,p}=ready(), card=make(name), target=make(targetName,'found'), invalid=make('Kirlia','wrong'), cost=energy('payment');
    p.hand=[card,cost]; p.deck=[target,invalid];
    await r.api.playCard('you',card.id);
    assert.ok(p.hand.includes(target));
    assert.ok(p.deck.includes(invalid));
    assert.equal(p.discard.includes(cost),name==='Techno Radar');
    assert.equal(r.document.getElementById('endTurnBtn').disabled,false);
  });
}

test('Booster Capsules are conditional and Ancient Booster removes existing conditions', async()=>{
  const {r,p}=ready('Flutter Mane'), ancient=p.active, future=make('Iron Valiant ex','future');
  const ancientTool=make('Ancient Booster Energy Capsule'), futureTool=make('Future Booster Energy Capsule');
  p.bench=[future]; p.hand=[ancientTool,futureTool]; ancient.conditions=[{type:'poisoned'}];
  r.api.setChoices(r.random,q=>q.kind==='pokemon-target'?(q.title.includes('Future')?future:ancient):r.choose(q));
  await r.api.playCard('you',ancientTool.id);
  await r.api.playCard('you',futureTool.id);
  assert.equal(r.api.effectiveHp(ancient),150);
  assert.equal(ancient.conditions.length,0);
  assert.equal(r.api.retreatCost(future),0);
  assert.equal(r.api.effectiveHp(future),220);
});

test('Japanese Iron Valiant ex can retreat without Energy with its verified Future Booster', ()=>{
  const {r,p}=ready('Flutter Mane');
  p.bench=[p.active];
  const valiant={id:'japanese-valiant',name:'Iron Valiant ex',setCode:'SV4M',cardNumber:'89',meta:null,energy:[],tools:[],conditions:[],damage:0};
  const tool={id:'japanese-capsule',name:'Future Booster Energy Capsule',setCode:'SV4M',cardNumber:'62',meta:null};
  assert.equal(r.api.repairMetadata(valiant),true);
  assert.equal(r.api.repairMetadata(tool),true);
  p.active=valiant;
  valiant.tools=[tool];
  assert.equal(r.api.retreatCost(valiant),0);
  assert.equal(r.api.canRetreat('you'),true);
  p.retreatedThisTurn=true;
  assert.equal(r.api.canRetreat('you'),false);
  assert.equal(r.api.retreatCost({...valiant,cardNumber:'999'}),2);
});

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadFixture, createEngineRunner } = require('./integration-harness.cjs');

const fixture = loadFixture();
const printing = { Clavell: { setCode: 'PAL', cardNumber: '177' }, Lance: { setCode: 'SIT', cardNumber: '159' } };

function setupSupporter(name, side = 'you') {
  const runner = createEngineRunner(fixture, 43);
  runner.api.setup(fixture, runner.random, runner.choose);
  const game = runner.api.state(), owner = game.players[side], wanted = printing[name];
  let card = null;
  for (const zone of [owner.deck, owner.hand, owner.discard, owner.prizes]) {
    const index = zone.findIndex(item => item.setCode === wanted.setCode && String(item.cardNumber) === wanted.cardNumber);
    if (index >= 0) { card = zone.splice(index, 1)[0]; break; }
  }
  if (!card) {
    const other = game.players[side === 'you' ? 'codex' : 'you'];
    for (const zone of [other.deck, other.hand, other.discard, other.prizes]) {
      const index = zone.findIndex(item => item.setCode === wanted.setCode && String(item.cardNumber) === wanted.cardNumber);
      if (index >= 0) { card = zone.splice(index, 1)[0]; break; }
    }
  }
  assert.ok(card, `${name} should be available from the prepared fixture zones`);
  if (side === 'codex') {
    owner.deck.push(...owner.hand);
    owner.hand = [];
    owner.active.energy = [];
  }
  owner.hand.push(card);
  owner.turnsTaken = 1;
  owner.supporterPlayedThisTurn = false;
  game.phase = 'play';
  game.turn = side;
  game.pendingPromotion = null;
  return { runner, game, owner, card };
}

function zones(owner) {
  return JSON.stringify({ hand: owner.hand.map(card => card.id), deck: owner.deck.map(card => card.id), discard: owner.discard.map(card => card.id), supporterPlayedThisTurn: owner.supporterPlayedThisTurn });
}


for (const name of ['Clavell', 'Lance']) {
  const eligible = c => c.meta?.category === 'Pokemon' && (name === 'Lance' ? c.meta.types?.includes('Dragon') : c.meta.stage === 'Basic' && Number(c.meta.hp) > 0 && Number(c.meta.hp) <= 120);
  test(name + ' requires its exact English print and complete effect text', async () => {
    for (const mutate of [c=>{c.setCode='XXX'},c=>{c.cardNumber='999'},c=>{c.language='ja'},c=>{c.meta.effect=''},c=>{c.meta.effect+=' Draw a card.'}]) {
      const {runner,owner,card}=setupSupporter(name);
      assert.equal(runner.api.supporterStatus(card).resolution,'automated');
      mutate(card); const before=zones(owner);
      assert.notEqual(runner.api.supporterStatus(card).resolution,'automated');
      await runner.api.playCard('you',card.id);
      assert.equal(zones(runner.api.state().players.you),before);
    }
  });
  for (const count of [0,1,3]) test(name+' searches '+count+' eligible Pokémon and shuffles',async()=>{
    const {runner,owner,card}=setupSupporter(name);
    runner.api.setLocalAi(false);
    const sample = owner.deck.find(eligible) || fixture.cards.find(eligible);
    assert.ok(sample);
    const targets=Array.from({length:3},(_,i)=>({...structuredClone(sample),id:'search-target-'+i}));
    owner.deck.push(...targets);
    const before=owner.deck.map(c=>c.id), chosen=targets.slice(0,count);
    runner.api.setChoices(runner.random,r=>{assert.ok(r.candidates.every(eligible));return chosen.map(c=>c.id)});
    await runner.api.playCard('you',card.id);
    const p=runner.api.state().players.you;
    assert.ok(chosen.every(c=>p.hand.some(h=>h.id===c.id)));
    assert.equal(p.deck.length,before.length-count);
    assert.ok(p.discard.some(c=>c.id===card.id));assert.equal(p.supporterPlayedThisTurn,true);
    assert.notDeepEqual(p.deck.map(c=>c.id),before.filter(id=>!chosen.some(c=>c.id===id)));
  });
  for (const choice of [null,['invalid'],['duplicate','duplicate'],['a','b','c','d']]) test(name+' locks cancellation after revealing the deck and rejects invalid choice '+JSON.stringify(choice),async()=>{
    const {runner,owner,card}=setupSupporter(name);runner.api.setLocalAi(false);
    if(!owner.deck.some(eligible)) owner.deck.push({...structuredClone(fixture.cards.find(eligible)),id:'eligible'});
    const before=zones(owner);
    if(choice===null){runner.api.setChoices(runner.random,undefined);const playing=runner.api.playCard('you',card.id);assert.equal(runner.api.pendingChoices(),true);runner.api.cancelActiveCardChoice();assert.equal(runner.api.pendingChoices(),true);runner.api.confirmRawChoice([]);await playing;assert.ok(runner.api.state().players.you.discard.some(c=>c.id===card.id));assert.equal(runner.api.state().players.you.supporterPlayedThisTurn,true);return;}
    else {runner.api.setChoices(runner.random,r=>choice);await runner.api.playCard('you',card.id);}
    assert.equal(zones(runner.api.state().players.you),before);
  });
  test(name+' rolls back a failed Supporter transaction',async()=>{
    const {runner,owner,card}=setupSupporter(name);const before=zones(owner),restore=runner.api.failNextSupporterAfterMutation();
    await runner.api.playCard('you',card.id);restore();assert.equal(zones(runner.api.state().players.you),before);
  });
  test(name+' rejects stale selected cards',async()=>{
    const {runner,owner,card}=setupSupporter(name);runner.api.setLocalAi(false);
    if(!owner.deck.some(eligible)) owner.deck.push({...structuredClone(fixture.cards.find(eligible)),id:'eligible'});
    const before=zones(owner);runner.api.setChoices(runner.random,r=>{const c=r.candidates[0];owner.discard.push(owner.deck.splice(owner.deck.indexOf(c),1)[0]);return [c.id]});
    await runner.api.playCard('you',card.id);assert.equal(zones(runner.api.state().players.you),before);
  });
  test(name+' handles an empty deck and consumes the Supporter',async()=>{
    const {runner,owner,card}=setupSupporter(name);owner.discard.push(...owner.deck.splice(0));
    await runner.api.playCard('you',card.id);assert.equal(owner.deck.length,0);assert.ok(owner.discard.includes(card));assert.equal(owner.supporterPlayedThisTurn,true);
  });
  test(name+' respects first-turn and once-per-turn Supporter restrictions',async()=>{
    for(const first of [true,false]){const {runner,owner,card,game}=setupSupporter(name);if(first){game.firstPlayer='you';owner.turnsTaken=0}else owner.supporterPlayedThisTurn=true;
    const before=zones(owner);await runner.api.playCard('you',card.id);assert.equal(zones(runner.api.state().players.you),before)}
  });
  test(name+' resolves through the AI pipeline',async()=>{
    const {runner,owner,card}=setupSupporter(name,'codex');runner.api.setLocalAi(true);await runner.api.aiStep();assert.ok(owner.discard.some(c=>c.id===card.id));assert.equal(owner.supporterPlayedThisTurn,true);
  });
}

for (const name of ['Clavell','Lance']) test(name+' enforces filter boundary values',async()=>{
  const {runner,owner,card}=setupSupporter(name);runner.api.setLocalAi(false);
  const make=(id,stage,hp,types,category='Pokemon')=>({id,name:id,meta:{category,stage,hp,types}});
  const records=[make('basic120','Basic',120,['Dragon']),make('basic130','Basic',130,['Lightning']),make('stage1','Stage 1',100,['Dragon']),make('missinghp','Basic','',['Lightning']),make('trainer','Basic',60,['Dragon'],'Trainer')];
  owner.discard.push(...owner.deck.splice(0));owner.deck.push(...records);
  const expected=name==='Clavell'?['basic120']:['basic120','stage1'];
  runner.api.setChoices(runner.random,r=>{assert.deepEqual(Array.from(r.candidates,c=>c.id),expected);return expected});
  await runner.api.playCard('you',card.id);
  assert.ok(expected.every(id=>owner.hand.some(c=>c.id===id)));
  assert.equal(owner.deck.length,records.length-expected.length);
});

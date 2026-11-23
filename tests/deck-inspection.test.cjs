const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {createEngineRunner,loadFixture}=require('./integration-harness.cjs');
const ids=cards=>Array.from(cards,card=>card.id);
function setup(side='you') {
  const fixture=loadFixture(),r=createEngineRunner(fixture,113);
  r.api.setup(fixture,r.random,r.choose);r.api.setLocalAi(false);
  const game=r.api.state(),owner=game.players[side];game.phase='play';game.turn=side;game.turnNumber=5;game.firstPlayer='codex';
  owner.turnsTaken=2;owner.supporterPlayedThisTurn=false;game.pendingPromotion=null;
  return {r,game,owner,fixture};
}
function recordChoices(r,choose) {
  const calls=[];r.api.setChoices(r.random,request=>{calls.push(request);return choose(request);});return calls;
}
function engine(r,expression){return vm.runInContext(expression,r.context);}
function putEnergySearchInHand(game,owner) {
  for(const p of Object.values(game.players)) for(const zone of [p.hand,p.deck,p.discard,p.prizes]) {
    const index=zone.findIndex(card=>card.name==='Energy Search');
    if(index>=0) {const card=zone.splice(index,1)[0];owner.hand.push(card);return card;}
  }
  throw Error('Energy Search fixture missing');
}
test('a real deck search shows the complete own deck while only Basic Energy can be selected',async()=>{
  const {r,game,owner}=setup(),card=putEnergySearchInHand(game,owner),before=ids(owner.deck);
  const calls=recordChoices(r,q=>{
    assert.deepEqual(ids(q.visibleCards),before);
    assert.ok(q.candidates.length<q.visibleCards.length);
    assert.ok(q.candidates.every(card=>card.meta.category==='Energy'));
    assert.ok(q.visibleCards.every(card=>owner.deck.includes(card)));
    assert.ok(q.visibleCards.every(card=>!game.players.codex.deck.includes(card) && !owner.prizes.includes(card)));
    return [q.candidates[0]];
  });
  await r.api.playCard('you',card.id);
  assert.equal(calls.length,1);assert.ok(owner.discard.includes(card));
});
test('an attempted selection of a visible but ineligible card is rejected without changing card zones',async()=>{
  const {r,game,owner}=setup(),card=putEnergySearchInHand(game,owner);
  const before=JSON.stringify([owner.deck,owner.hand,owner.discard]);
  recordChoices(r,q=>[q.visibleCards.find(card=>!q.candidates.includes(card))]);
  await r.api.playCard('you',card.id);
  assert.equal(JSON.stringify([r.api.state().players.you.deck,r.api.state().players.you.hand,r.api.state().players.you.discard]),before);
});
test('a search with no eligible cards still permits reviewing the entire deck and finishing with no selection',async()=>{
  const {r,game,owner}=setup(),card=putEnergySearchInHand(game,owner);
  const energies=owner.deck.filter(card=>card.meta.category==='Energy');owner.deck=owner.deck.filter(card=>!energies.includes(card));owner.discard.push(...energies);
  const before=ids(owner.deck).sort();
  const calls=recordChoices(r,q=>{assert.equal(q.candidates.length,0);assert.deepEqual(ids(q.visibleCards).sort(),before);return [];});
  await r.api.playCard('you',card.id);
  assert.equal(calls.length,1);assert.ok(owner.discard.includes(card));assert.deepEqual(ids(owner.deck).sort(),before);
});
for(const position of ['top','bottom']) for(const matches of [true,false]) test(position+' search shows all and only the permitted window, including '+(matches?'nonmatching cards':'a window without Pokémon'),async()=>{
  const {r,owner}=setup();
  const trainer={id:'window-search',name:'Window search',meta:{category:'Trainer'}};owner.hand.push(trainer);
  const pokemon={id:'visible-pokemon',name:'Visible Pokémon',meta:{category:'Pokemon',stage:'Basic'}};
  const other={id:'visible-trainer',name:'Visible Trainer',meta:{category:'Trainer'}};
  const energy={id:'visible-energy',name:'Water Energy',meta:{category:'Energy',energyType:'Water'}};
  const window=matches?[other,pokemon,energy]:[other,energy,{...energy,id:'second-energy'}];
  const hidden={id:'unseen-pokemon',name:'Outside the window',meta:{category:'Pokemon',stage:'Basic'}};
  owner.deck=position==='top'?[hidden,...window]:[...window,hidden];
  const calls=recordChoices(r,q=>{assert.deepEqual(ids(q.visibleCards),ids(window));assert.ok(!q.visibleCards.includes(hidden));assert.equal(q.candidates.length,matches?1:0);return matches?[pokemon]:[];});
  assert.equal(await engine(r,`resolvePokemonSearchToHand(player('you').hand.find(card=>card.id==='window-search'),'you',{look:3,position:'${position}'})`),true);
  assert.equal(calls.length,1);assert.equal(owner.hand.includes(pokemon),matches);assert.ok(owner.deck.includes(hidden));
});
test('top-card reordering never expands the remaining window to reveal the rest of the deck',async()=>{
  const {r,owner}=setup();
  owner.deck=[{id:'unseen',name:'Hidden'},{id:'top-1',name:'One'},{id:'top-2',name:'Two'}];
  recordChoices(r,q=>{assert.deepEqual(ids(q.visibleCards),['top-1','top-2']);return [q.candidates[0]];});
  const result=await engine(r,"pickEffectCard('you','Reorder',player('you').deck.slice(-2),null,player('you').deck.slice(-2))");
  assert.equal(result.id,'top-1');
});
test('the real picker highlights eligible cards, leaves other artwork readable and cannot cancel after inspection',async()=>{
  const {r,owner}=setup();r.api.setChoices(r.random,null);
  const eligible=owner.deck.find(card=>card.meta.category==='Energy');
  const choosing=engine(r,"chooseCardsInApp('you','Search',player('you').deck.filter(card=>card.meta.category==='Energy'),0,1)");
  const grid=r.document.getElementById('cardChoiceGrid').innerHTML;
  assert.equal((grid.match(/data-choice-card=/g)||[]).length,owner.deck.length);
  assert.match(grid,/class="choice-card eligible"/);assert.match(grid,/class="choice-card view-only"[^>]* disabled/);
  assert.match(grid,/Eligible/);assert.match(grid,/View only/);
  assert.equal(r.document.getElementById('cardChoiceCancelBtn').disabled,true);
  r.api.confirmRawChoice([eligible.id]);assert.deepEqual(ids(await choosing),[eligible.id]);
});
test('Master Yami uses strategic keep values within the inspection scope instead of taking the first listed card',async()=>{
  const {r,game,owner}=setup('codex');r.api.setChoices(r.random,null);r.api.setLocalAi(true);game.yamiDifficulty='master';
  owner.deck=[{id:'low',name:'Low-value card',meta:{category:'Energy'}},{id:'useful',name:'Nemona',meta:{category:'Trainer',trainerType:'Supporter'}}];
  // Isolate the generic strategy (specialized deck profiles are tested separately).
  engine(r,'hasIonoFanStrategy=()=>false;hasSkeleridgeStrategy=()=>false;stageTwoAiProfile=()=>null;hasEthanSkeledirgeStrategy=()=>false;hasChienPaoStrategy=()=>false;genAiProfile=()=>null;hasPeterDragoniteStrategy=()=>false;');
  assert.deepEqual(ids(await engine(r,"chooseUpToEffectCards('codex','Search',player('codex').deck,1)")),['useful']);
  // The better card is not a legal choice when the effect only inspects the bottom card.
  assert.deepEqual(ids(await engine(r,"chooseCardsInApp('codex','Look bottom',player('codex').deck.slice(0,1),0,1,player('codex').deck.slice(0,1))")),['low']);
  game.yamiDifficulty='casual';
  assert.deepEqual(ids(await engine(r,"chooseUpToEffectCards('codex','Search',player('codex').deck,1)")),['low']);
});

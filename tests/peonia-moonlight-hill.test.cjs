const assert = require('node:assert/strict');
const {test} = require('node:test');
const vm = require('node:vm');
const {createEngineRunner,loadFixture} = require('./integration-harness.cjs');

const peonia = {name:'Peonia',setCode:'S6K',cardNumber:'82'};
const hill = {name:'Moonlight Hill',setCode:'SVP',cardNumber:'95'};

function setup(print) {
  const r = createEngineRunner(loadFixture(),72);
  r.api.setup(loadFixture(),r.random,r.choose,()=>true);
  r.api.setLocalAi(false);
  const game = r.api.state();
  Object.assign(game,{phase:'play',turn:'you',turnNumber:3,pendingPromotion:null});
  game.players.you.turnsTaken = 1;
  game.players.you.supporterPlayedThisTurn = false;
  const card = {...print,id:'new-print',categoryHint:'Trainer',meta:null};
  r.api.repairMetadata(card);
  r.context.testCard = card;
  return {r,game,p:game.players.you,foe:game.players.codex,card};
}
const ordinary = (id,name=id) => ({id,name,meta:{category:'Energy',energyType:'Psychic'}});
const tick = () => new Promise(resolve=>setImmediate(resolve));

test('both exact Japanese prints load verified artwork and automated rules while changed text fails closed',()=>{
  for (const print of [peonia,hill]) {
    const {r,card} = setup(print);
    assert.equal(card.language,'ja');
    assert.equal(card.meta.trainerType,print===peonia?'Supporter':'Stadium');
    assert.match(card.meta.image,new RegExp('/'+print.setCode+'_'+print.cardNumber+'_R_JP.png$'));
    assert.equal(vm.runInContext('effectSupportFor(testCard)',r.context),'automatic');
    card.meta.effect += ' Changed effect.';
    assert.notEqual(vm.runInContext('effectSupportFor(testCard)',r.context),'automatic');
  }
});

test('previously unresolved exact records repair on library load without using network lookup',()=>{
  const {r} = setup(peonia);
  r.api.loadSavedLibrary([peonia,hill].map((print,index)=>({...print,id:'saved:'+index,meta:null})));
  const audit = r.api.libraryAudit();
  for(const id of ['saved:0','saved:1']) assert.equal(audit.find(card=>card.id===id)?.status,'implemented');
});

test('Peonia hides Prize identities then exchanges an equal number without changing deck or Prize count',async()=>{
  const {r,game,p,card} = setup(peonia);
  const prizes = ['secret-a','secret-b','secret-c','secret-d'].map(id=>ordinary(id,'Hidden '+id));
  const returned = [ordinary('hand-a'),ordinary('hand-b')];
  p.prizes = prizes.slice();
  p.hand = [card,...returned];
  const deck = p.deck.map(card=>card.id);
  let choice = 0;
  r.api.setChoices(r.random,request=>{
    if (++choice===1) {
      assert.equal(request.maxCount,3);
      assert.ok(request.candidates.every(card=>card.name.startsWith('Face-down Prize ')));
      assert.ok(request.candidates.every(card=>!prizes.some(prize=>prize.id===card.id)));
      return [request.candidates[0],request.candidates[2]];
    }
    assert.ok(p.hand.includes(prizes[0]) && p.hand.includes(prizes[2]));
    assert.ok(!request.candidates.includes(card));
    return returned;
  });
  await r.api.playCard('you',card.id);
  assert.equal(choice,2);
  assert.equal(p.prizes.length,4);
  assert.deepEqual(Array.from(p.prizes,item=>item.id),['hand-a','secret-b','hand-b','secret-d']);
  assert.ok(p.hand.includes(prizes[0]) && p.hand.includes(prizes[2]));
  assert.ok(p.discard.includes(card));
  assert.equal(p.supporterPlayedThisTurn,true);
  assert.deepEqual(p.deck.map(card=>card.id),deck);
  assert.equal(game.phase,'play');
  assert.ok(!game.log.some(event=>/Hidden secret/.test(event.message)));
});

test('Peonia permits zero Prizes and cannot be played with no Prizes or after another Supporter',async()=>{
  const {r,p,card} = setup(peonia);
  p.hand = [card];
  p.prizes = [];
  assert.equal(vm.runInContext('canPlayTrainerEffect(testCard,"you")',r.context),false);
  p.prizes = [ordinary('prize')];
  p.supporterPlayedThisTurn = true;
  assert.equal(vm.runInContext('canPlayTrainerEffect(testCard,"you")',r.context),false);
  p.supporterPlayedThisTurn = false;
  r.api.setChoices(r.random,()=>[]);
  await r.api.playCard('you',card.id);
  assert.equal(p.prizes.length,1);
  assert.equal(p.supporterPlayedThisTurn,true);
  assert.ok(p.discard.includes(card));
});

test('Yami resolves Peonia automatically and returns the required number of cards',async()=>{
  const {r,game,foe,card} = setup(peonia);
  game.turn = 'codex';
  foe.turnsTaken = 1;
  foe.supporterPlayedThisTurn = false;
  foe.prizes = [ordinary('prize-a'),ordinary('prize-b')];
  foe.hand = [card,ordinary('existing-hand')];
  r.api.setLocalAi(true);
  await r.api.playCard('codex',card.id);
  const current = r.api.state().players.codex;
  assert.equal(current.prizes.length,2);
  assert.equal(current.hand.length,1);
  assert.ok(current.discard.some(item=>item.id===card.id));
  assert.equal(current.supporterPlayedThisTurn,true);
  assert.equal(new Set([...current.prizes,...current.hand].map(item=>item.id)).size,3);
});

test('Peonia can be cancelled before revealing Prizes and requires the replacement after revealing',async()=>{
  const {r,p,card} = setup(peonia);
  p.prizes = [ordinary('prize','Secret Prize')];
  p.hand = [card,ordinary('replacement')];
  r.api.setChoices(r.random,undefined);
  let playing = r.api.playCard('you',card.id);
  await tick();
  assert.ok(!r.document.getElementById('cardChoiceGrid').innerHTML.includes('Secret Prize'));
  r.api.cancelActiveCardChoice();
  await playing;
  const current = r.api.state().players.you;
  assert.ok(current.hand.some(item=>item.id===card.id));
  assert.equal(current.supporterPlayedThisTurn,false);
  playing = r.api.playCard('you',card.id);
  await tick();
  r.api.confirmRawChoice(['prize-slot:0']);
  await tick();
  assert.equal(r.document.getElementById('cardChoiceCancelBtn').disabled,true);
  r.api.cancelActiveCardChoice();
  assert.equal(r.api.pendingChoices(),true);
  r.api.confirmRawChoice(['replacement']);
  await playing;
  assert.equal(r.api.state().players.you.prizes[0].id,'replacement');
});

test('Moonlight Hill consumes only Basic Psychic Energy and heals each Pokémon once per player turn',async()=>{
  const {r,game,p,foe,card} = setup(hill);
  game.stadium = {owner:'you',card};
  const psychic = ordinary('psychic','Psychic Energy');
  p.hand = [psychic];
  p.active.damage = 50;
  p.bench = [{...p.active,id:'bench-heal-test',damage:20,energy:[],tools:[],conditions:[]}];
  foe.active.damage = 70;
  await r.api.useStadium('you');
  assert.equal(p.active.damage,20);
  assert.equal(p.bench[0].damage,0);
  assert.equal(foe.active.damage,70);
  assert.ok(p.discard.includes(psychic));
  p.hand.push(ordinary('psychic-2','Psychic Energy'));
  assert.equal(await r.api.useStadium('you'),false);
  const next = r.api.state();
  next.turnNumber++;
  next.turn = 'codex';
  next.players.codex.hand = [ordinary('foe-psychic','Psychic Energy')];
  assert.equal(await r.api.useStadium('codex'),true);
  assert.equal(r.api.state().players.codex.active.damage,40);
  next.turnNumber++;
  next.turn = 'you';
  next.players.you.hand = [{id:'special',name:'Hiding Darkness Energy',meta:{category:'Energy',energyType:'Psychic',special:true}}];
  assert.equal(await r.api.useStadium('you'),false);
});

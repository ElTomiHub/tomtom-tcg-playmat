const assert = require('node:assert/strict');
const {test} = require('node:test');
const vm = require('node:vm');
const {createEngineRunner,loadFixture} = require('./integration-harness.cjs');

function setup(name,setCode,cardNumber) {
  const fixture = loadFixture(), runner = createEngineRunner(fixture,19);
  runner.api.setup(fixture,runner.random,runner.choose,()=>true);
  runner.api.setLocalAi(false);
  const card = {id:'tested-supporter',name,setCode,cardNumber};
  runner.api.repairMetadata(card);
  const game = runner.api.state(), p = game.players.you;
  game.phase = 'play';
  game.turn = 'you';
  p.turnsTaken = 2;
  p.supporterPlayedThisTurn = false;
  p.hand = [card];
  const hint = () => {
    vm.runInContext("renderTurnActionStatus('you',true)",runner.context);
    return runner.document.getElementById('turnActionStatus').textContent;
  };
  return {runner,game,p,card,hint};
}

test("Bill's Teleport appears in the hint and resolves after leaving the hand", async () => {
  const {runner,p,card,hint} = setup("Bill's Teleport",'SV2A','199');
  const found = {...p.active,id:'search-result',energy:[],tools:[],conditions:[]};
  p.deck = [found];
  assert.equal(hint(),'Play Trainer');
  await runner.api.playCard('you',card.id);
  assert.ok(p.hand.includes(found));
  assert.ok(p.discard.includes(card));
  assert.equal(hint(),'');
});

test("Morty's Confidence only appears with its discard cost, opposing Bench and cards to draw", async () => {
  const {runner,game,p,card,hint} = setup("Morty's Confidence",'SV5K','97');
  const opponent = game.players.codex;
  const payment = {id:'payment',name:'Test card'}, drawn = {id:'drawn',name:'Drawn card'};
  opponent.bench = [{...opponent.active,id:'bench-target'}];
  p.deck = [drawn];
  assert.equal(hint(),'');
  p.hand.push(payment);
  opponent.bench = [];
  assert.equal(hint(),'');
  opponent.bench = [{...opponent.active,id:'bench-target'}];
  p.deck = [];
  assert.equal(hint(),'');
  p.deck = [drawn];
  assert.equal(hint(),'Play Trainer');
  await runner.api.playCard('you',card.id);
  assert.ok(p.discard.includes(payment));
  assert.ok(p.discard.includes(card));
  assert.ok(p.hand.includes(drawn));
  assert.equal(hint(),'');
});

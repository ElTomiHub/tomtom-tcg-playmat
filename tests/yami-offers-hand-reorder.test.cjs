const assert = require('node:assert/strict');
const {test} = require('node:test');
const vm = require('node:vm');
const {createEngineRunner,loadFixture} = require('./integration-harness.cjs');

function setup(answer) {
  const fixture = loadFixture(), runner = createEngineRunner(fixture,29), choices = [];
  runner.api.setup(fixture,runner.random,request=>{
    if (request.kind === 'yami-finish-offer') { choices.push(request); return answer; }
    return runner.choose(request);
  },()=>true);
  const run = code => vm.runInContext(code,runner.context);
  run([
    "game.phase='play'; game.turn='codex'; game.turnNumber=6; game.pendingCheckup=null; game.pendingStartDrawSide=null",
    "player('codex').turnsTaken=2; player('you').turnsTaken=2",
    "player('codex').attackedThisTurn=false; controlSide='you'"
  ].join(';'));
  const game = runner.api.state();
  const make = (name,setCode,cardNumber) => {
    const card = {id:setCode+'-'+cardNumber,name,setCode,cardNumber,damage:0,energy:[],tools:[],conditions:[]};
    runner.api.repairMetadata(card);
    return card;
  };
  const staryu = make('Staryu','M3','20'), snorunt = make('Snorunt','M2A','200');
  staryu.energy = [{id:'water',name:'Water Energy',meta:{category:'Energy',energyType:'Water'}}];
  return {runner,run,game,choices,staryu,snorunt};
}

test('Yami can offer its visible win once and preserve the match on decline', async () => {
  const {run,game,choices,staryu,snorunt} = setup(false);
  game.players.codex.active = staryu;
  game.players.you.active = snorunt;
  game.players.you.bench = [];
  snorunt.damage = 50;
  assert.equal(await run('offerYamiMatchFinish()'),false);
  assert.equal(game.phase,'play');
  assert.equal(snorunt.damage,50);
  assert.equal(await run('offerYamiMatchFinish()'),false);
  assert.equal(choices.length,1);
  assert.match(choices[0].message,/Water Gun/);
});

test('accepting a Yami concession records the player win', async () => {
  const {run,game,choices,staryu,snorunt} = setup(true);
  game.players.you.active = staryu;
  game.players.codex.active = snorunt;
  game.players.codex.bench = [];
  game.players.codex.hand = [];
  snorunt.damage = 50;
  assert.equal(await run('offerYamiMatchFinish()'),true);
  assert.equal(game.phase,'finished');
  assert.equal(game.winner,'you');
  assert.equal(game.finishReason,'Yami conceded');
  assert.equal(choices.length,1);
});

test('hand reordering changes just the order and works on Yami’s turn', () => {
  const {run,game} = setup(false);
  const p = game.players.you;
  const cards = p.hand.slice();
  assert.ok(cards.length>=3);
  assert.equal(run("reorderHandCard('you',player('you').hand[0],player('you').hand[2])"),true);
  assert.deepEqual(Array.from(p.hand),[cards[1],cards[2],cards[0],...cards.slice(3)]);
  assert.equal(p.attackedThisTurn,false);
  assert.equal(game.turn,'codex');
});

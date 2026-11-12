const assert = require('node:assert/strict');
const {test} = require('node:test');
const vm = require('node:vm');
const {createEngineRunner,loadFixture} = require('./integration-harness.cjs');

function setup() {
  const fixture = loadFixture(), runner = createEngineRunner(fixture,13);
  runner.api.setup(fixture,runner.random,runner.choose,()=>true,{yamiDifficulty:'master'});
  const game = runner.api.state(), id = game.deckIds.you;
  return {runner, game, id, run:source=>vm.runInContext(source,runner.context)};
}

test('a clean Master-tagged win awards only Toma’s deck, updates the summary and survives backup restore',()=>{
  const {runner,game,id,run} = setup();
  const rival = game.deckIds.codex;
  game.masteryOpponentCategory = 'Master';
  game.players.codex.prizes.length = 1;
  run("finishMatch('you','all Prize cards taken')");
  const progress = runner.context.masteryProgress(id);
  assert.equal(progress.dedication,1);
  assert.equal(progress.flawless,1);
  assert.equal(progress.comeback,1);
  assert.equal(progress.master,1);
  assert.equal(progress.boss,1);
  assert.equal(runner.context.masteryProgress(rival).dedication,undefined);
  assert.deepEqual(Array.from(run('buildMatchSummary().masteryAwards')),
    ['flawless-1','comeback-1','master-1','boss-1']);
  assert.match(run('matchSummaryMarkup(buildMatchSummary())'),/New deck awards.*Flawless Victory/s);
  const backup = runner.api.backup();
  runner.api.restoreBackup(backup);
  assert.equal(runner.context.masteryProgress(id).boss,1);
  runner.context.renderDeckLibrary();
  assert.match(runner.document.getElementById('deckLibraryGrid').innerHTML,/Deck mastery/);
});

for (const result of ["finishMatch('codex','Toma forfeited')","finishMatch(null,'No result recorded',{cancelled:true})"]) {
  test('mastery excludes '+result,()=>{
    const {runner,id,run} = setup();
    run(result);
    assert.equal(runner.context.masteryProgress(id).dedication,undefined);
  });
}

test('finishing the last applicable milestone unlocks the trophy exactly once',()=>{
  const {game,id,run} = setup();
  game.masteryOpponentCategory = 'Master';
  run("statsForDeck(game.deckIds.you).mastery = {dedication:49, flawless:1, comeback:1, master:14, boss:14, chain:1}");
  run("finishMatch('you','all Prize cards taken'); finishMatch('you','all Prize cards taken')");
  assert.deepEqual(Array.from(run('buildMatchSummary().masteryAwards')),['dedication-50','master-15','boss-15','trophy-1']);
  assert.equal(run('masteryProgress(game.deckIds.you).trophy'),1);
});

test('a Voltaic Chain Knock Out needs same-turn Streamer to qualify',()=>{
  const {game,runner,run} = setup();
  const attacker = runner.api.prepareAttack('you','JTG','47',['Lightning','Lightning']);
  game.turn = 'you';
  const target = game.players.codex.active;
  target.meta.weaknesses=[];
  target.meta.resistances=[];
  target.meta.hp=80;
  const attack = attacker.meta.attacks[0];
  runner.context.badgeTestAttack = {attacker,attack,target};
  const attempt = damage=>run("recordMasteryAttack('you',badgeTestAttack.attacker,badgeTestAttack.attack,badgeTestAttack.target,"+damage+",{type:'bonus_per_iono_lightning_energy'})");
  game.matchHistory.mastery.streamerTurn = game.turnNumber-1;
  attempt(100);
  assert.equal(game.matchHistory.mastery.chain,undefined);
  game.matchHistory.mastery.streamerTurn = game.turnNumber;
  attempt(60);
  assert.equal(game.matchHistory.mastery.chain,undefined);
  attempt(100);
  assert.equal(game.matchHistory.mastery.chain,true);
});

test('Encore only counts when the attack needs both boosts',()=>{
  const {game,runner,run} = setup();
  const attacker = runner.api.prepareAttack('you','JTG','47',['Lightning','Lightning']);
  const target = game.players.codex.active;
  target.meta.weaknesses=[];
  target.meta.resistances=[];
  target.meta.hp=210;
  runner.context.encoreCase = {attacker,target};
  game.matchHistory.mastery = {songTurn:game.turnNumber,songs:2};
  const attempt = damage=>run("recordMasteryAttack('you',encoreCase.attacker,encoreCase.attacker.meta.attacks[0],encoreCase.target,"+damage+",{type:'none'})");
  attempt(200);
  assert.equal(game.matchHistory.mastery.encore,undefined);
  attempt(280);
  assert.equal(game.matchHistory.mastery.encore,undefined);
  attempt(250);
  assert.equal(game.matchHistory.mastery.encore,true);
});

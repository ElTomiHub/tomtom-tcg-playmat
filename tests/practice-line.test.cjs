const assert = require('node:assert/strict');
const { test } = require('node:test');
const vm = require('node:vm');
const { createEngineRunner, loadFixture } = require('./integration-harness.cjs');

test('a stamped position replays independently of the official result and recording', async () => {
  const fixture = loadFixture(), runner = createEngineRunner(fixture, 15);
  runner.api.setup(fixture, runner.random, runner.choose, () => true);
  const run = code => vm.runInContext(code, runner.context);
  run("game.phase='play'; game.turn='you'; game.turnNumber=3; controlSide='you'; captureLinePoint(false)");
  run("player('you').energyAttachedThisTurn=true; captureLinePoint(true); captureLinePoint(true)");
  assert.equal(run("game.linePoints.includes('3-stamp')"),false);
  run("captureLinePoint(true); const deckOrder=JSON.stringify(player('you').deck); const originalGame=game");
  assert.equal(await run("startPracticeLine(game.matchHistory.id,'3-stamp')"),false);
  run("finishMatch('you','original');captureRecordedStep(); const officialRecording=pendingRecording; const officialStats=JSON.stringify(deckStats)");
  const markup=run("matchSummaryMarkup(buildMatchSummary())");
  assert.match(markup,/Try another line/);
  assert.doesNotMatch(markup,/Prize timeline|Post.match coach/i);
  assert.equal(await run("startPracticeLine(game.matchHistory.id,'3-stamp')"),true);
  assert.equal(run("game.practiceLine && localAiEnabled && player('you').energyAttachedThisTurn && JSON.stringify(player('you').deck)===deckOrder"),true);
  run("player('you').deck.pop(); finishMatch('codex','alternative');captureRecordedStep()");
  assert.equal(run("leavePracticeLine()"),true);
  assert.equal(run("game===originalGame && game.winner==='you' && pendingRecording===officialRecording && JSON.stringify(deckStats)===officialStats && JSON.stringify(player('you').deck)===deckOrder"),true);
});

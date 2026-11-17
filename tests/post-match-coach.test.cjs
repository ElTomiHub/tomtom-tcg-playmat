const assert = require('node:assert/strict');
const {test} = require('node:test');
const vm = require('node:vm');
const {createEngineRunner,loadFixture} = require('./integration-harness.cjs');

function match() {
  const fixture = loadFixture(), runner = createEngineRunner(fixture);
  runner.api.setup(fixture,runner.random,runner.choose,()=>true);
  const run = code => vm.runInContext(code,runner.context);
  run(`game.phase='play'; game.turn='you'; controlSide='you'; localAiEnabled=false;
       game.turnNumber=5; player('you').turnsTaken=2; game.pendingPromotion=null;
       const tadbulbForCoach = [...player('you').deck,...player('you').bench,player('you').active]
         .find(card=>card?.name==="Iono's Tadbulb");
       const coachEnergy = player('you').deck.find(card=>card.name==='Lightning Energy');
       player('you').active = {...tadbulbForCoach,energy:[coachEnergy,coachEnergy]};
       player('codex').active.damage = effectivePokemonHp(player('codex').active)-20;
       player('you').energyAttachedThisTurn=true;`);
  return run;
}

test('the coach points to a verified knockout and opens the exact recorded step',async()=>{
  const run = match();
  assert.equal(run('coachMomentBeforeAction().moment.kind'),'missed-knockout');
  assert.match(run('coachMomentBeforeAction().moment.alternative'),/Tiny Charge/);
  run("rememberCoachMoment(coachMomentBeforeAction().moment);finishMatch('you','Test result');captureRecordedStep();");
  assert.equal(run('validSavedMatchSummary(buildMatchSummary())'),true);
  assert.equal(run('buildMatchSummary().coach.length'),1);
  assert.equal(run('pendingRecording.steps.some(step=>step.sequence===buildMatchSummary().coach[0].step && step.phase==="play")'),true);
  assert.match(run('matchCoachMarkup(buildMatchSummary())'),/See board and hand/);
  await run(`openCoachReplay({dataset:{coachMatch:pendingRecording.id,coachDeck:game.deckIds.you,
    coachStep:String(buildMatchSummary().coach[0].step)}})`);
  assert.match(run("$('replayStepLabel').textContent"),/Turn 5 · Toma/);
});

test('an attack that cannot be used never appears as a missed knockout',()=>{
  const run = match();
  run("player('you').active.energy=[];");
  assert.equal(run('coachMomentBeforeAction().moment'),undefined);
});

test('a follow-up KO is tied to the same Active on the next opposing turn',()=>{
  const run = match();
  run(`const preview=coachMomentBeforeAction(player('you').active.meta.attacks[0]);
    rememberCoachMoment(preview.moment,preview.attack);
    game.turnNumber=6;
    coachReturnKnockout(player('you').active,player('codex').active);`);
  assert.equal(run('game.matchHistory.coach[0].kind'),'return-knockout');
  assert.equal(run('game.matchHistory.coach[0].turn'),5);
});

test('a legal Basic Energy attachment can prepare a Benched attacker',()=>{
  const run = match();
  run(`const p=player('you');
       p.energyAttachedThisTurn=false;
       p.bench=[{...p.active,id:'coach-benched-tadbulb',energy:[coachEnergy]}];
       p.active.energy=[];
       p.hand=[coachEnergy];`);
  assert.equal(run('coachMomentBeforeAction().moment.kind'),'energy');
  assert.match(run('coachMomentBeforeAction().moment.alternative'),/Tiny Charge/);
  run("player('you').energyAttachedThisTurn=true;");
  assert.equal(run('coachMomentBeforeAction().moment'),undefined);
});

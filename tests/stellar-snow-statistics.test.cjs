const assert = require('node:assert/strict');
const {test} = require('node:test');
const vm = require('node:vm');
const {createEngineRunner,loadFixture} = require('./integration-harness.cjs');

function setup() {
  const fixture = loadFixture(), runner = createEngineRunner(fixture,49);
  runner.api.setup(fixture,runner.random,runner.choose,()=>true);
  const make = (name,setCode,cardNumber) => {
    const card = {id:setCode+'-'+cardNumber,name,setCode,cardNumber,energy:[],tools:[],conditions:[],damage:0};
    runner.api.repairMetadata(card);
    return card;
  };
  Object.assign(runner.context,{
    staryu:make('Staryu','M3','20'), snorunt:make('Snorunt','M2A','200'),
    starmie:make('Mega Starmie ex','M3','111'), froslass:make('Mega Froslass ex','M2A','233'),
    water:{id:'water',name:'Water Energy',meta:{category:'Energy',energyType:'Water'}}
  });
  const run = code=>vm.runInContext(code,runner.context);
  run("game.phase='play'; game.turn='codex'; game.turnNumber=5; player('codex').turnsTaken=2; game.resumeManifest={codex:[staryu,snorunt,starmie,froslass]}");
  return {runner,run};
}

test('Stellar Snow uses verified attack effects and favors different openings by style',()=>{
  const {run} = setup();
  assert.equal(run('stageTwoAiProfile()'),'stellar_snow');
  assert.equal(run('stageTwoAiProfile([starmie,snorunt])'),null);
  assert.equal(run('game.yamiStyle="aggro"; stageTwoAiDevelopment(staryu,[],true)>stageTwoAiDevelopment(snorunt,[],true)'),true);
  assert.equal(run('game.yamiStyle="control"; stageTwoAiDevelopment(snorunt,[],true)>stageTwoAiDevelopment(staryu,[],true)'),true);
});

test('Master identifies Jet Blow prizes on both opponents and keeps a large hand for Resentful Song',()=>{
  const {run} = setup();
  run("game.yamiDifficulty='master'; game.yamiStyle='control'; player('codex').active=starmie; player('codex').bench=[froslass]; starmie.energy=[water]; froslass.energy=[water]; player('codex').prizes=player('codex').prizes.slice(0,2); player('you').active=staryu; player('you').bench=[snorunt]; snorunt.damage=20; player('you').hand=Array(6).fill(staryu)");
  assert.equal(run("stellarAiAttackPlan(starmie,starmie.meta.attacks[0],staryu,attackEffectRuleFor(starmie,starmie.meta.attacks[0]).effect).wins"),true);
  assert.equal(run("chooseLocalAiAction().name"),'Jet Blow');
  assert.equal(run('stellarAiShouldResetHand()'),false);
  assert.equal(run("player('codex').bench=[]; stellarAiShouldResetHand()"),true);
});

test('Statistics counts the Toma seat once, ranks its opponents and suggests an unplayed pairing',()=>{
  const {runner,run} = setup();
  run(`registeredDecks = ['alpha','beta','gamma'].map(id=>({...registeredDecks[0],id,name:id}));
       deckStats.alpha = {matchups:{beta:{bySide:{you:{wins:12,losses:3,draws:1},codex:{wins:18}}}}};
       deckStats.beta = { matchups:{alpha:{bySide:{codex:{
         styles:{control:{wins:7,losses:8}}, difficulties:{competitor:{styles:{control:{wins:3,losses:2}}}}
       }}}} };
       $('statisticsDeck').value='alpha';
       renderMatchupStatistics();`);
  assert.deepEqual(Array.from(run("matchupUsageFor('alpha')"),pair=>pair.games),[0,5,0]);
  assert.match(runner.document.getElementById('statisticsUsage').innerHTML,/beta · 5/);
  assert.match(runner.document.getElementById('statisticsSuggestions').innerHTML,/New matchup[\s\S]*gamma/);
  assert.match(runner.document.getElementById('statisticsSuggestions').innerHTML,/Rematch[\s\S]*2 W · 3 L/);
  assert.match(runner.document.getElementById('statisticsSuggestions').innerHTML,/Try Master[\s\S]*beta[\s\S]*data-statistics-difficulty="master"/);
  run("openStartGame({suggestedMatchup:{you:'alpha',codex:'beta',difficulty:'master'}});");
  assert.equal(run("$('yamiDifficultySelect').value"),'master');
  assert.equal(run("$('codexRegisteredDeck').value"),'beta');
});

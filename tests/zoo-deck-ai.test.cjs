const assert = require('node:assert/strict');
const {test} = require('node:test');
const vm = require('node:vm');
const {createEngineRunner,loadFixture} = require('./integration-harness.cjs');

function setup(profile) {
  const fixture = loadFixture(), runner = createEngineRunner(fixture,103);
  runner.api.setup(fixture,runner.random,runner.choose,()=>true);
  const print = (name,setCode,cardNumber) => {
    const card = {id:setCode+'-'+cardNumber,name,setCode,cardNumber,energy:[],tools:[],conditions:[],damage:0};
    runner.api.repairMetadata(card);
    return card;
  };
  Object.assign(runner.context,{
    zig:print('Galarian Zigzagoon','S4A','277'), obstagoon:print('Galarian Obstagoon','M2A','209'),
    munkidori:print('Munkidori','SV6','107'), mimikyu:print('Mimikyu','SV4A','341'),
    abra:print('Abra','SV4A','253'), kadabra:print('Kadabra','M1S','37'),
    alakazam:print('Alakazam ex','SV2A','203'), mime:print('Mr. Mime','SV2A','179'),
    xerneas:print('Xerneas','M1S','46'), flutter:print('Flutter Mane','SV5K','76'),
    cemetery:print('Ancient Cemetery','S6K','68'),
    dark:{id:'dark',name:'Darkness Energy',meta:{category:'Energy',energyType:'Darkness'}},
    psychic:{id:'psychic',name:'Psychic Energy',meta:{category:'Energy',energyType:'Psychic'}}
  });
  const run = code=>vm.runInContext(code,runner.context);
  run(`game.resumeManifest={codex:${profile==='obstagogo' ? '[zig,obstagoon,munkidori,mimikyu]' : '[abra,kadabra,alakazam,mime,xerneas,flutter]'}};
    game.phase='play'; game.turn='codex'; game.turnNumber=6; game.firstPlayer='you'; game.yamiDifficulty='master';
    controlSide='codex'; player('codex').turnsTaken=2; player('codex').hand=[];
    player('you').active={...xerneas,id:'enemy',damage:0,energy:[],tools:[],conditions:[],meta:{...xerneas.meta,hp:180,weaknesses:[],resistances:[]}};
    player('you').bench=[{...abra,id:'rival-bench'}];`);
  return {run,runner};
}

test('Obstagogo detects the counter engine and Master converts Adrena-Brain into a Scar Shout Knock Out',async()=>{
  const {run}=setup('obstagogo');
  assert.equal(run('stageTwoAiProfile()'),'obstagogo');
  assert.equal(run('stageTwoAiProfile([zig,obstagoon])'),null);
  run(`game.yamiStyle='balanced'; player('codex').active=obstagoon; player('codex').bench=[munkidori,mimikyu];
       obstagoon.energy=[dark,psychic]; munkidori.energy=[{...dark,id:'dark-bench'}]; mimikyu.damage=30;`);
  assert.equal(run("obstagogoCounterTarget([player('you').bench[0],player('you').active],30).id"),'enemy');
  assert.equal(run('chooseLocalAiAction().abilityName'),'Adrena-Brain');
  run('delete engineTestHooks.choose');
  assert.equal(await run("usePokemonAbility('codex',munkidori,'Adrena-Brain')"),true);
  assert.equal(run("player('you').active.damage"),30);
  assert.equal(run('chooseLocalAiAction().name'),'Scar Shout');
  assert.equal(run("game.yamiDifficulty='casual'; obstagogoCounterValue(player('you').active,10)"),20);
});

test('Rafa Psy Zoo develops Abra with Geo Gate and takes a Knock Out using Alakazam from the Bench',()=>{
  const {run}=setup('rafa_psy_zoo');
  assert.equal(run('stageTwoAiProfile()'),'rafa_psy_zoo');
  run(`game.yamiStyle='aggro'; player('codex').active=xerneas; player('codex').bench=[];
    player('codex').deck=[abra,mime,flutter,psychic]; xerneas.energy=[psychic];`);
  assert.equal(run('chooseLocalAiAction().name'),'Geo Gate');
  assert.equal(run('rafaGeoTargets([mime,flutter,abra],2)[0].id'),run('abra.id'));
  run(`game.yamiStyle='control'; player('codex').active=mime; player('codex').bench=[alakazam];
    alakazam.energy=[psychic,{...psychic,id:'second'}]; player('you').active.damage=70;`);
  assert.equal(run('chooseLocalAiAction().name'),'Dimensional Hand');
  assert.equal(run('chooseLocalAiAction().attackerId'),run('alakazam.id'));
  assert.ok(run("zooAiDefenderValue('rafa_psy_zoo',mime)")>0);
  assert.equal(run("mime.energy=[psychic]; zooAiDefenderValue('rafa_psy_zoo',mime)"),0);
});


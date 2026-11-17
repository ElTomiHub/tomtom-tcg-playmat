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


test('Master takes the guaranteed Scar Shout instead of gusting a harmless Basic',()=>{
  const {run}=setup('obstagogo');
  run(`game.yamiStyle='control'; player('codex').active=obstagoon; player('codex').bench=[munkidori];
    obstagoon.energy=[dark,psychic]; obstagoon.damage=150;
    player('you').active.damage=150; player('you').active.energy=[{...psychic,id:'foe-energy'}];
    const boss={id:'boss',name:"Boss's Command",setCode:'S2',cardNumber:'106'};
    integrationApi.repairMetadata(boss); player('codex').hand=[boss];`);
  assert.equal(run('chooseAiPrizeLine().guaranteedKnockout'),true);
  assert.equal(run('chooseLocalAiAction().name'),'Scar Shout');
  run(`player('you').active=player('you').bench[0]; player('you').bench=[xerneas];
    player('codex').hand=[]; player('codex').supporterPlayedThisTurn=true; player('codex').energyAttachedThisTurn=true;`);
  assert.equal(run('canRetreatPokemon(obstagoon,"codex")'),true);
  assert.equal(run('chooseLocalAiAction().type'),'end_turn');
});

test('Master plans Darkness attachment, Adrena-Brain, Switch and Scar Shout as one line',async()=>{
  const {run}=setup('obstagogo');
  run(`game.yamiStyle='control'; player('codex').active=mimikyu; player('codex').bench=[munkidori,obstagoon];
    mimikyu.damage=40; obstagoon.energy=[{...dark,id:'on-obstagoon'},psychic];
    player('you').active.meta.hp=220;
    const swap={id:'swap',name:'Switch',setCode:'M6A',cardNumber:'103'};
    integrationApi.repairMetadata(swap); player('codex').hand=[dark,swap];`);
  assert.equal(run('chooseLocalAiAction().type'),'attach');
  assert.equal(run('chooseLocalAiAction().target.id'),run('munkidori.id'));
  assert.equal(run("player('you').active.damage"),0);
  run(`munkidori.energy=[dark]; player('codex').hand.shift(); player('codex').energyAttachedThisTurn=true; delete engineTestHooks.choose;`);
  assert.equal(run('chooseLocalAiAction().abilityName'),'Adrena-Brain');
  assert.equal(run('chooseLocalAiAction().targetId'),'enemy');
  assert.equal(await run("usePokemonAbility('codex',munkidori,'Adrena-Brain',false,'enemy')"),true);
  assert.equal(run('chooseLocalAiAction().card.name'),'Switch');
  run(`player('codex').active=obstagoon; player('codex').bench=[munkidori,mimikyu];`);
  assert.equal(run('chooseLocalAiAction().name'),'Scar Shout');
});

test('Master avoids switching to Mimikyu when the opposing Bench can answer Safeguard',()=>{
  const {run}=setup('obstagogo');
  run(`game.yamiStyle='control'; player('codex').active=obstagoon; player('codex').bench=[mimikyu];
    obstagoon.energy=[dark,psychic,{...dark,id:'second-dark'}];
    player('you').active={...alakazam,id:'opposing-ex',energy:[]};
    const flutterCounter={id:'counter',name:'Flutter Mane',setCode:'SV8',cardNumber:'59',energy:[{...psychic,id:'foe-energy'}],damage:0,tools:[],conditions:[]};
    integrationApi.repairMetadata(flutterCounter); player('you').bench=[flutterCounter];
    const swap={id:'swap',name:'Switch',setCode:'M6A',cardNumber:'103'};
    integrationApi.repairMetadata(swap); player('codex').hand=[swap];`);
  assert.equal(run('aiVisibleReplyDamage(mimikyu,true)'),70);
  assert.equal(run('chooseLocalAiAction().name'),'Punk Smash');
});

const assert = require('node:assert/strict');
const {test} = require('node:test');
const vm = require('node:vm');
const {createEngineRunner,loadFixture} = require('./integration-harness.cjs');

test('PikaClone opens the chain, prepares Dedenne and picks a finisher for the board',()=>{
  const fixture=loadFixture(), runner=createEngineRunner(fixture,27);
  runner.api.setup(fixture,runner.random,runner.choose,()=>true);
  const run=code=>vm.runInContext(code,runner.context);
  for (const [name,number] of [['Togedemaru','69'],['Dedenne','45'],['Morpeko','62'],['Pikachu','24']]) {
    const card={id:name,name,setCode:'S12',cardNumber:number,damage:0,energy:[],tools:[],conditions:[]};
    runner.api.repairMetadata(card);
    runner.context[name]=card;
  }
  run(`game.phase='play'; game.turnNumber=6; game.turn='codex'; game.yamiDifficulty='master'; game.yamiStyle='aggro';
    game.resumeManifest={codex:[Togedemaru,Dedenne,Morpeko,Pikachu]};
    player('codex').active=Togedemaru; player('codex').bench=[Dedenne,Morpeko,Pikachu];
    player('you').active={...Togedemaru,id:'opposing',meta:{...Togedemaru.meta,hp:250}};
    player('you').bench=[]; player('codex').prizes=[{}];
    for(const card of game.resumeManifest.codex) card.energy=[{name:'Lightning Energy',meta:{category:'Energy',energyType:'Basic'}}];
    game.lastComboAttacks={};`);
  assert.equal(run('stageTwoAiProfile()'),'pikaclone');
  assert.equal(run('stageTwoAiProfile([Pikachu,Morpeko])'),null);
  assert.ok(run('stageTwoAiDevelopment(Togedemaru,[],true)>stageTwoAiDevelopment(Dedenne,[],true)'));
  assert.equal(run('aiAttackScore(Dedenne,Dedenne.meta.attacks.at(-1))'),-1);
  run("game.lastComboAttacks.codex={turnNumber:4,pokemonName:'togedemaru',chain:'togedemaru'}");
  assert.ok(run('aiAttackScore(Dedenne,Dedenne.meta.attacks.at(-1))>aiAttackScore(Togedemaru,Togedemaru.meta.attacks[0])'));
  run("game.lastComboAttacks.codex={turnNumber:4,pokemonName:'dedenne',chain:'dedenne'}");
  assert.ok(run('aiAttackScore(Pikachu,Pikachu.meta.attacks[0])>aiAttackScore(Morpeko,Morpeko.meta.attacks[0])'));
  run("game.yamiStyle='control';player('you').bench=[{...Pikachu,id:'bench',damage:30}]");
  assert.ok(run('aiAttackScore(Morpeko,Morpeko.meta.attacks[0])>2000'));
  run('game.turnNumber=8');
  assert.equal(run('aiAttackScore(Morpeko,Morpeko.meta.attacks[0])'),-1);
});

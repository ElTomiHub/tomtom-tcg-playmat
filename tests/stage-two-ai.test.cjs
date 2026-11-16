const assert = require('node:assert/strict');
const {test} = require('node:test');
const vm = require('node:vm');
const {createEngineRunner,loadFixture} = require('./integration-harness.cjs');
const {cards: grassCards} = require('./fixtures/grass-deck-cards.fixture.json');

function setup(profile, style='balanced', difficulty='competitor') {
  const fixture=loadFixture(), runner=createEngineRunner(fixture,15);
  runner.api.setup(fixture,runner.random,runner.choose,()=>true,{yamiStyle:style,yamiDifficulty:difficulty});
  const game=runner.api.state(), ai=game.players.codex, foe=game.players.you;
  const catalog=[...fixture.cards,...grassCards,...vm.runInContext('VERIFIED_NEW_PRINT_DETAILS',runner.context)];
  const card=(set,number,id=set+number)=>{
    const matches=catalog.filter(item=>item.setCode===set && Number(item.cardNumber)===number && item.meta?.category);
    const source=matches.find(item=>item.meta.category!=='Pokemon' || item.meta.hp) || matches[0];
    assert.ok(source,'missing verified print '+set+' '+number);
    const copy={...structuredClone(source),id,energy:[],tools:[],conditions:[],damage:0,evolutionStack:[],enteredTurn:1,evolvedTurn:-1};
    runner.api.repairMetadata(copy);
    return copy;
  };
  const energy=(type,id)=>({id,name:type+' Energy',meta:{category:'Energy',energyType:type}});
  const leaves=profile==='mega_leaves';
  game.resumeManifest.codex=leaves ? [card('TWM',25),card('MEG',10),card('MEG',3)] : [card('SV4A',349),card('SV3',136)];
  game.turn='codex'; game.turnNumber=4; game.firstPlayer='you'; game.stadium=null; game.stadiumPlayedThisTurn=false;
  ai.turnsTaken=1; ai.energyAttachedThisTurn=true; ai.attackedThisTurn=false; ai.supporterPlayedThisTurn=false;
  ai.active=leaves?card('TWM',25):card('M2',11); ai.bench=[]; ai.hand=[]; ai.discard=[];
  ai.deck=[card('ASC',71,'draw-1'),card('ASC',71,'draw-2'),card('ASC',71,'draw-3')];
  foe.active=card('ASC',279); foe.active.meta.hp=280; foe.active.meta.weaknesses=[]; foe.active.meta.resistances=[];
  foe.bench=[card('ASC',71)];
  runner.api.clearVisuals();
  assert.equal(runner.context.stageTwoAiProfile(),profile);
  return {runner,game,ai,foe,card,energy};
}

test('a revised deck still matches by verified core effects, while an unsupported core print falls back',()=>{
  const {runner,game,card}=setup('dracaufeu');
  const core=Array.from(game.resumeManifest.codex);
  game.resumeManifest.codex=[card('SV4A',304),...core,card('SV3',118)];
  assert.equal(runner.context.stageTwoAiProfile(),'dracaufeu');
  const altered=structuredClone(core[0]);
  altered.meta.abilities[0].effect+=' Draw a card.';
  game.resumeManifest.codex=[altered,core[1],card('SV3',118)];
  assert.equal(runner.context.stageTwoAiProfile(),null);
});

test('Mega Leaves plays Forest to turn a freshly benched Chikorita into Wild Growth Meganium',async()=>{
  const {runner,game,ai,card}=setup('mega_leaves');
  const basic=card('ASC',8);
  basic.enteredTurn=game.turnNumber;
  ai.bench=[basic];
  ai.hand=[card('MEG',117),card('MEG',9),card('MEG',10),card('ASC',10)];
  assert.equal(runner.api.aiAction().type,'play_stadium');
  await runner.api.aiStep();
  assert.equal(runner.api.aiAction().card.name,'Bayleef');
  await runner.api.aiStep();
  assert.equal(runner.api.aiAction().card.name,'Meganium');
});

test('Mega Leaves stays on Ogerpon when Wild Growth gives it the same knockout as a Mega',()=>{
  const {runner,ai,foe,card,energy}=setup('mega_leaves','aggro','master');
  ai.active.energy=[energy('Grass','one'),energy('Grass','two')];
  const mega=card('ASC',10);
  mega.energy=[energy('Grass','mega-one'),energy('Grass','mega-two')];
  ai.bench=[mega,card('MEG',10)];
  foe.active.meta.hp=150;
  assert.equal(runner.api.aiAction().name,'Myriad Leaf Shower');
});

test('Solar Transfer powers Venusaur while leaving the backup Ogerpon ready',async()=>{
  const {runner,ai,card,energy}=setup('mega_leaves','balanced','master');
  ai.active=card('MEG',3); ai.active.energy=[energy('Grass','active')];
  const ogerpon=card('TWM',25); ogerpon.energy=[energy('Grass','backup-1'),energy('Grass','backup-2')];
  const support=card('MEG',10); support.energy=[energy('Grass','spare')];
  ai.bench=[ogerpon,support];
  assert.equal(runner.api.aiAction().abilityName,'Solar Transfer');
  await runner.api.aiStep();
  assert.equal(ai.active.energy.at(-1).id,'spare');
  assert.equal(ogerpon.energy.length,2);
});

test('Master heals a threatened Mega with Wally when Teal Dance and Solar Transfer can restore its attack',async()=>{
  const {runner,game,ai,foe,card,energy}=setup('mega_leaves','control','master');
  ai.active=card('MEG',3); ai.active.damage=270;
  ai.active.energy=[energy('Grass','returned-1'),energy('Grass','returned-2')];
  ai.bench=[card('MEG',10),card('TWM',25)];
  ai.hand=[card('MEG',132)];
  ai.energyAttachedThisTurn=false;
  foe.active.energy=[...Array.from({length:4},(_,i)=>energy('Lightning','foe-'+i))];
  foe.prizes=foe.prizes.slice(0,3);
  const action=runner.api.aiAction();
  assert.equal(action.card.name,"Wally's Compassion");
  assert.equal(action.targetId,ai.active.id);
  await runner.api.aiStep();
  assert.equal(ai.active.damage,0);
  assert.equal(ai.active.energy.length,0);
  assert.equal(ai.hand.filter(card=>card.name==='Grass Energy').length,2);
  assert.equal(game.players.codex.supporterPlayedThisTurn,true);
  for(let i=0;i<4 && ai.active.energy.length<2;i++) await runner.api.aiStep();
  assert.equal(ai.active.energy.length,2);
  assert.equal(runner.api.aiAction().name,'Jungle Dump');
});

test('Dracaufeu plans Rare Candy with Fire acceleration and funds Burning Dark on the evolved attacker',async()=>{
  const {runner,ai,foe,card,energy}=setup('dracaufeu','aggro','competitor');
  ai.bench=[card('SV3',118)];
  ai.hand=[card('M1S',82),card('SV4A',349)];
  ai.deck.push(card('MP',45),energy('Fire','first'),energy('Fire','second'),energy('Fire','third'));
  foe.active.meta.hp=175;
  const before=JSON.stringify(runner.api.state());
  assert.equal(runner.api.aiAction().card.name,'Rare Candy');
  assert.equal(JSON.stringify(runner.api.state()),before);
  await runner.api.aiStep();
  assert.equal(ai.active.name,'Charizard ex');
  assert.ok(ai.active.energy.filter(card=>card.name==='Fire Energy').length>=2);
  assert.equal(runner.api.aiAction().name,'Burning Dark');
});

test('Mach Search chooses Rare Candy to complete the hand evolution',async()=>{
  const {runner,ai,card,energy}=setup('dracaufeu','balanced','competitor');
  ai.bench=[card('SV3',136)];
  ai.hand=[card('SV4A',349)];
  const candy=card('M1S',82);
  ai.deck.push(energy('Fire','other-card'),card('MP',45),candy);
  assert.equal(runner.api.aiAction().abilityName,'Mach Search');
  await runner.api.aiStep();
  assert.ok(ai.hand.includes(candy));
});

test('Crispin puts Psychic in hand and attaches the Fire needed for Burning Dark',async()=>{
  const {runner,ai,card,energy}=setup('dracaufeu','balanced','competitor');
  ai.active=card('SV4A',349); ai.active.energy=[energy('Fire','attached')];
  ai.hand=[card('SV7',123)];
  ai.deck.push(energy('Fire','fire'),energy('Psychic','psychic'));
  assert.equal(runner.api.aiAction().card.name,'Crispin');
  await runner.api.aiStep();
  assert.equal(ai.active.energy.at(-1).id,'fire');
  assert.ok(ai.hand.some(card=>card.id==='psychic'));
});

test('Control Master uses Counter Catcher for a knockout while saving the Supporter',async()=>{
  const {runner,ai,foe,card,energy}=setup('dracaufeu','control','master');
  ai.active=card('SV4A',349); ai.active.energy=[energy('Fire','one'),energy('Fire','two')];
  const weak=card('OBF',159); weak.meta.hp=180;
  foe.bench=[weak];
  foe.prizes=foe.prizes.slice(0,5);
  ai.hand=[card('SV4M',59),card('S2',106)];
  const action=runner.api.aiAction();
  assert.equal(action.card.name,'Counter Catcher');
  assert.equal(action.targetId,weak.id);
  await runner.api.aiStep();
  assert.equal(foe.active,weak);
  assert.equal(ai.supporterPlayedThisTurn,false);
  assert.equal(runner.api.aiAction().name,'Burning Dark');
});

test('Control Master protects a wounded Charizard from a game-ending ex attack with Acerola',async()=>{
  const {runner,game,ai,foe,card,energy}=setup('dracaufeu','control','master');
  ai.active=card('SV4A',349); ai.active.damage=250; ai.active.energy=[energy('Fire','one'),energy('Fire','two')];
  foe.active.meta.hp=330;
  foe.active.energy=[...Array.from({length:4},(_,i)=>energy('Lightning','foe-'+i))];
  foe.prizes=foe.prizes.slice(0,2);
  ai.hand=[card('M1S',90)];
  const action=runner.api.aiAction();
  assert.equal(action.card.name,"Acerola's Mischief");
  assert.equal(action.targetId,ai.active.id);
  await runner.api.aiStep();
  assert.equal(ai.active.exAttackProtectionUntilTurn,game.turnNumber+1);
});

test('Dracaufeu plays Devolution when damage on two evolved Pokémon turns into two knockouts',async()=>{
  const {runner,ai,foe,card,energy}=setup('dracaufeu','control','master');
  ai.active=card('SV4A',349); ai.active.energy=[energy('Fire','one'),energy('Fire','two')];
  ai.hand=[card('SVK',29)];
  const active=card('ASC',279), bench=card('SV3',136);
  active.evolutionStack=[card('ASC',69)]; active.damage=80;
  bench.evolutionStack=[card('SV3',118)]; bench.damage=90;
  foe.active=active; foe.bench=[bench,card('ASC',71)];
  const prizes=ai.prizes.length;
  assert.equal(runner.api.aiAction().card.name,'Technical Machine Devolution');
  await runner.api.aiStep();
  assert.equal(runner.api.aiAction().name,'Devolution');
  await runner.api.aiStep();
  assert.equal(ai.prizes.length,prizes-2);
});

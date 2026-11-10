const assert=require('node:assert/strict'),{test}=require('node:test');
const {createEngineRunner,loadFixture}=require('./integration-harness.cjs');
const fixture=loadFixture(),key='codexPokemonPlaymat.unfinishedMatch.v1';
function setup(seed=5){const r=createEngineRunner(fixture,seed);r.api.setup(fixture,r.random,r.choose,()=>true);r.api.setLocalAi(false);return r;}
function clone(v){return JSON.parse(JSON.stringify(v));}
function record(name,set,num){return clone(fixture.cards.find(c=>c.name===name&&c.setCode===set&&c.cardNumber===num));}
function pokemon(name,set,num,id){return {...record(name,set,num),id,energy:[],tools:[],conditions:[],evolutionStack:[],damage:0,enteredTurn:0,evolvedTurn:0};}
function energy(id,type){return {id,name:type+' Energy',meta:{category:'Energy',energyType:type}};}
test('unfinished match survives a fresh app instance without redealing, redrawing or duplicating deck stats',()=>{
 const r=setup();assert.equal(r.api.saveMatch(),true);const raw=r.context.localStorage.getItem(key),before=clone(r.api.state()),backup=r.api.backup();
 const fresh=createEngineRunner(fixture);fresh.api.restoreBackup(backup);fresh.context.localStorage.setItem(key,raw);assert.equal(fresh.api.resumeMatch(),true);
 assert.deepEqual(clone(fresh.api.state()),before);assert.deepEqual(clone(fresh.api.backup().data.deckStats),clone(backup.data.deckStats));
 assert.equal(fresh.document.getElementById('matchSaveStatus').textContent,'');assert.equal(fresh.api.saveMatch(),true);
});
test('setup checkpoint resumes with opponent Pokémon still hidden',()=>{
 const r=createEngineRunner(fixture,6);r.api.setup(fixture,r.random,r.choose,()=>true,{setupOnly:true});assert.equal(r.api.saveMatch(),true);assert.equal(r.api.resumeMatch(),true);
 assert.equal(r.api.state().phase,'setup');assert.match(r.document.getElementById('codexActiveZone').innerHTML,/Face-down opponent/);assert.doesNotMatch(r.document.getElementById('codexActiveZone').innerHTML,/data-card=/);
});
test('transaction, pending choice, and failed effect never replace the last settled checkpoint',async()=>{
 const r=setup();r.api.saveMatch();const raw=r.context.localStorage.getItem(key);
 r.api.checkpointLock(true);r.api.state().players.you.hand.reverse();assert.equal(r.api.saveMatch(),false);assert.equal(r.context.localStorage.getItem(key),raw);r.api.checkpointLock(false);r.api.state().players.you.hand.reverse();
 await r.api.transaction(async()=>{const p=r.api.state().players.you;p.discard.push(p.deck.pop());assert.equal(r.api.saveMatch(),false);return false;});
 assert.equal(r.context.localStorage.getItem(key),raw);assert.equal(r.api.saveMatch(),true);assert.doesNotThrow(()=>r.api.validateMatch(r.context.localStorage.getItem(key)));
});
for(const [label,mutate] of [
 ['engine version',d=>d.engineVersion='old'],['duplicate physical card',d=>d.game.players.you.deck[0]=d.game.players.you.hand[0]],
 ['card text',d=>d.game.players.codex.active.meta.attacks[0].effect='Draw 100 cards.'],['invalid turn',d=>d.game.turn='third'],
 ['invalid temporary effect',d=>d.game.players.you.active.attackDamageReduction={amount:-30,expiresTurn:5}],['invalid turn bonus',d=>d.game.players.you.active.nextTurnAttackBonus={ownerSide:'codex',activeTurn:3,amount:100,attackName:'Unprinted attack'}],['corrupt statistics',d=>d.deckStats[d.game.deckIds.you].wins=-1],['corrupt history',d=>d.game.matchHistory.players.you.attacks=-1],['missing card',d=>d.game.players.you.deck.pop()],['deck identity',d=>d.game.resumeDecks.you.decklist+='\n1 Bad Card'],
])test('resume rejects '+label+' without changing the current game',()=>{const r=setup();r.api.saveMatch();const d=JSON.parse(r.context.localStorage.getItem(key)),before=JSON.stringify(r.api.state());mutate(d);r.context.localStorage.setItem(key,JSON.stringify(d));assert.equal(r.api.resumeMatch(),false);assert.equal(JSON.stringify(r.api.state()),before);});
test('save failures are reported and retain the previous checkpoint',()=>{const r=setup();r.api.saveMatch();const raw=r.context.localStorage.getItem(key),original=r.context.localStorage.setItem;r.context.localStorage.setItem=()=>{throw Error('full');};r.api.state().turnNumber++;assert.equal(r.api.saveMatch(),false);assert.match(r.document.getElementById('matchSaveStatus').textContent,/could not/);r.context.localStorage.setItem=original;assert.equal(r.context.localStorage.getItem(key),raw);});
test('finishing a game removes the unfinished checkpoint',()=>{const r=setup();r.api.saveMatch();r.api.state().phase='finished';assert.equal(r.api.saveMatch(),true);assert.equal(r.context.localStorage.getItem(key),null);});
test('resuming an older checkpoint applies the current names while retaining saved moves', () => {
 const r = setup();
 assert.equal(r.api.state().players.you.name, 'Toma');
 assert.equal(r.api.state().players.codex.name, 'Yami');
 assert.equal(r.api.saveMatch(), true);
 const checkpoint = JSON.parse(r.context.localStorage.getItem(key));
 checkpoint.game.players.you.name = 'You';
 checkpoint.game.players.codex.name = 'Codex';
 checkpoint.game.log[0].message = 'Codex drew a card.';
 r.context.localStorage.setItem(key, JSON.stringify(checkpoint));
 assert.equal(r.api.resumeMatch(), true);
 assert.equal(r.api.state().players.you.name, 'Toma');
 assert.equal(r.api.state().players.codex.name, 'Yami');
 assert.equal(r.api.state().log[0].message, 'Codex drew a card.');
});
test('temporary reminders show source and expiry, then disappear without altering rule flags',()=>{
 const r=setup(),g=r.api.state(),p=g.players.you.active;g.turnNumber=5;p.cannotAttackUntilTurn=7;p.attackLockSource='Thunderous Bolt';p.noWeaknessUntilTurn=6;p.noWeaknessSource='Metal Defender';
 let list=clone(r.api.reminders(p,'you'));assert.ok(list.some(x=>x.label==='Cannot attack'&&x.source==='Thunderous Bolt'&&x.expiry.includes('7')));assert.ok(list.some(x=>x.label==='No Weakness'));
 r.api.render();assert.match(r.document.getElementById('youActiveZone').innerHTML,/Cannot attack/);assert.match(r.api.reminderMarkup(p,'you'),/Thunderous Bolt/);
 g.turnNumber=8;assert.equal(r.api.reminders(p,'you').length,0);assert.equal(p.cannotAttackUntilTurn,7);
});
test('AI chooses the Energy type that unlocks its attack, regardless of hand order',()=>{
 const r=setup(),g=r.api.state(),p=g.players.codex;g.turn='codex';g.firstPlayer='you';p.turnsTaken=2;p.active=pokemon('Dragonair','ASC','151','ai-active');p.active.energy=[energy('water','Water')];p.active.abilityUses={'Evolutionary Guidance':g.turnNumber};p.hand=[energy('wrong','Water'),energy('right','Lightning')];p.bench=[];p.energyAttachedThisTurn=false;
 const a=r.api.aiAction();assert.equal(a.type,'attach');assert.equal(a.card.id,'right');assert.equal(a.target.id,p.active.id);
});
test('AI preserves a ready attack when an evolution would remove all payable attacks',()=>{
 const r=setup(),g=r.api.state(),p=g.players.codex;g.turn='codex';g.firstPlayer='you';p.turnsTaken=2;p.active=pokemon('Dratini','OBF','157','ai-active');p.active.energy=[energy('colorless','Colorless')];p.hand=[{...record('Dragonair','ASC','151'),id:'evolution'}];p.bench=[];p.energyAttachedThisTurn=true;
 assert.notEqual(r.api.aiAction().type,'evolve');
});
test('AI can retreat a healthy but stalled Active into a ready stronger attacker',()=>{
 const r=setup(),g=r.api.state(),p=g.players.codex;g.turn='codex';g.firstPlayer='you';p.turnsTaken=2;p.active=pokemon('Dratini','OBF','157','stalled');p.active.energy=[energy('pay','Colorless')];p.active.meta.retreat=1;
 const ready=pokemon('Dragonite','SIT','131','ready');ready.energy=[energy('w','Water'),energy('l','Lightning'),energy('c','Colorless')];p.bench=[ready];p.hand=[];p.energyAttachedThisTurn=true;
 assert.equal(r.api.aiAction().type,'retreat');
});
test('AI planning neither rolls coins nor depends on opposing hidden card identities',()=>{
 const r=setup(),g=r.api.state(),p=g.players.codex;g.turn='codex';g.firstPlayer='you';p.turnsTaken=2;p.hand=[];p.energyAttachedThisTurn=true;
 r.api.setChoices(()=>{throw Error('Planning rolled randomness');},r.choose,()=>{throw Error('Planning flipped a coin');});const before=JSON.stringify(g),first=JSON.stringify(r.api.aiAction());assert.equal(JSON.stringify(g),before);
 const other=g.players.you;other.hand=other.hand.map((c,i)=>({...c,name:'Hidden '+i,meta:{}}));other.deck.reverse();other.prizes.reverse();assert.equal(JSON.stringify(r.api.aiAction()),first);
});

function prizePosition() {
  const r = setup(), g = r.api.state(), p = g.players.codex, foe = g.players.you;
  g.turn = 'codex';
  g.turnNumber = 4;
  g.firstPlayer = 'you';
  p.turnsTaken = 1;
  p.energyAttachedThisTurn = false;
  p.retreatedThisTurn = false;
  p.supporterPlayedThisTurn = false;
  p.active = pokemon('Dratini','OBF','157','stalled');
  p.active.meta.retreat = 1;
  p.active.energy = [energy('retreat','Water')];
  const attacker = pokemon('Dragonair','ASC','151','backup');
  attacker.energy = [energy('water','Water')];
  attacker.abilityUses = { 'Evolutionary Guidance': g.turnNumber };
  p.bench = [attacker];
  p.hand = [energy('lightning','Lightning')];
  foe.active = pokemon("Iono's Tadbulb",'ASC','69','defender');
  foe.bench = [];
  r.api.setLocalAi(true);
  return { r, p, foe, attacker };
}

test('AI attaches to a Benched attacker, pays Retreat, and takes a Prize through the real turn flow', async () => {
  const { r, p, attacker } = prizePosition();
  const before = JSON.stringify(r.api.state());
  assert.equal(r.api.aiAction().target.id, attacker.id);
  assert.equal(JSON.stringify(r.api.state()), before);
  const prizes = p.prizes.length;
  await r.api.aiStep();
  assert.equal(r.api.aiAction().type, 'retreat');
  await r.api.aiStep();
  assert.equal(p.active.id, attacker.id);
  assert.equal(r.api.aiAction().type, 'attack');
  await r.api.aiStep();
  assert.equal(p.prizes.length, prizes - 1);
});

test('Random style learns from a Yami loss only for the same ordered deck matchup', () => {
  const {runInContext} = require('node:vm');
  const {r} = prizePosition();
  const game = r.api.state();
  game.deckIds = {you:'toma-test',codex:'yami-test'};
  game.yamiStyle = 'aggro';
  const weights = (yami, toma) => Array.from(runInContext(
    `yamiStyleWeights(${JSON.stringify(yami)}, ${JSON.stringify(toma)})`, r.context));
  assert.deepEqual(weights('yami-test','toma-test'), [0.5,0.5,0.5]);
  runInContext("recordDeckResult('you'); recordDeckResult('you');", r.context);
  assert.deepEqual(weights('yami-test','toma-test'), [0.4,0.5,0.5]);
  assert.deepEqual(weights('toma-test','yami-test'), [0.5,0.5,0.5]);
  assert.deepEqual(weights('yami-test','other-deck'), [0.5,0.5,0.5]);
  r.api.setChoices(() => 0.3, r.choose);
  assert.equal(runInContext("chooseYamiStyle('random','yami-test','toma-test')", r.context), 'balanced');
  assert.equal(runInContext("chooseYamiStyle('aggro','yami-test','toma-test')", r.context), 'aggro');
});

test('Random difficulty learns per matchup and a Casual loss leaves Master style odds alone', () => {
  const {runInContext} = require('node:vm');
  const {r} = prizePosition();
  const game = r.api.state();
  game.deckIds = {you:'toma-difficulty',codex:'yami-difficulty'};
  game.yamiDifficulty = 'casual';
  game.yamiStyle = 'control';
  runInContext("recordDeckResult('you')", r.context);
  const read = expression => Array.from(runInContext(expression,r.context));
  assert.deepEqual(read("yamiStyleWeights('yami-difficulty','toma-difficulty','casual')"), [0.5,0.5,0.4]);
  assert.deepEqual(read("yamiStyleWeights('yami-difficulty','toma-difficulty','master')"), [0.5,0.5,0.5]);
  r.api.setChoices(() => 0.3, r.choose);
  assert.equal(runInContext("chooseYamiDifficulty('random','yami-difficulty','toma-difficulty')",r.context), 'competitor');
  assert.equal(runInContext("chooseYamiDifficulty('random','yami-difficulty','other')",r.context), 'casual');
  assert.equal(runInContext("chooseYamiDifficulty('master','yami-difficulty','toma-difficulty')",r.context), 'master');
  assert.ok(r.api.validateBackup(r.api.backup()));
});

test('Casual skips projected Prize lines while Master can plan without changing the live board', () => {
  const {r,p,attacker} = prizePosition();
  const game = r.api.state();
  game.yamiDifficulty = 'casual';
  p.hand.push(pokemon('Dratini','OBF','157','bench-development'));
  assert.equal(r.api.aiAction().type, 'bench');
  game.yamiDifficulty = 'master';
  const before = JSON.stringify(game);
  assert.equal(r.api.aiAction().target.id, attacker.id);
  assert.equal(JSON.stringify(game), before);
});

test('Aggro takes an immediate Prize line before bench development while Balanced develops first', () => {
  const {r,p,attacker} = prizePosition();
  p.active = attacker;
  attacker.energy.push(energy('lightning','Lightning'));
  p.bench = [];
  p.hand = [pokemon('Dratini','OBF','157','development')];
  const game = r.api.state();
  game.yamiStyle = 'balanced';
  assert.equal(r.api.aiAction().type, 'bench');
  game.yamiStyle = 'aggro';
  assert.equal(r.api.aiAction().type, 'attack');
  game.firstPlayer = 'codex';
  p.turnsTaken = 0;
  assert.notEqual(r.api.aiAction().type, 'attack');
});

test('Control uses Boss to strand an unpowered target even without an immediate Knock Out', async () => {
  const {r,p,foe} = prizePosition();
  p.hand = [{ ...clone(require('./fixtures/metal-and-japanese-cards.fixture.json').cards.find(card => card.name === "Boss's Orders")), id:'gust' }];
  p.bench = [];
  foe.active.meta.hp = 180;
  foe.active.energy = [energy('opponent-energy','Lightning')];
  const target = pokemon('Dragonite','SIT','131','stranded');
  target.meta.retreat = 3;
  foe.bench = [target];
  const game = r.api.state();
  game.yamiStyle = 'balanced';
  assert.notEqual(r.api.aiAction().type, 'supporter');
  game.yamiStyle = 'control';
  assert.equal(r.api.aiAction().targetId, target.id);
  await r.api.aiStep();
  assert.equal(foe.active.id, target.id);
});

test('AI gusts the two-Prize target instead of the easier one-Prize target', async () => {
  const { r, p, foe, attacker } = prizePosition();
  p.active = attacker;
  p.bench = [];
  attacker.energy.push(energy('lightning','Lightning'));
  const boss = require('./fixtures/metal-and-japanese-cards.fixture.json').cards.find(card => card.name === "Boss's Orders");
  p.hand = [{ ...clone(boss), id: 'gust' }];
  foe.active.meta.hp = 180;
  const easy = pokemon('Dratini','OBF','157','easy');
  easy.damage = 40;
  const valuable = pokemon("Iono's Bellibolt ex",'ASC','279','valuable');
  valuable.damage = Number(valuable.meta.hp) - 60;
  foe.bench = [easy, valuable];
  assert.equal(r.api.aiAction().targetId, valuable.id);
  await r.api.aiStep();
  assert.equal(foe.active.id, valuable.id);
  const prizes = p.prizes.length;
  await r.api.aiStep();
  assert.equal(p.prizes.length, prizes - 2);
});

test('AI uses Switch to reach a ready attacker when Retreat is blocked', async () => {
  const { r, p, attacker } = prizePosition();
  attacker.energy.push(energy('lightning','Lightning'));
  p.active.conditions = [{ type: 'asleep' }];
  p.hand = [{ ...record('Switch','MEG','130'), id: 'switch' }];
  assert.equal(r.api.aiAction().targetId, attacker.id);
  await r.api.aiStep();
  assert.equal(p.active.id, attacker.id);
  assert.equal(r.api.aiAction().type, 'attack');
});

test('AI spends Fire Energy on Incendiary Song only when needed for this Knock Out', () => {
  const { r, p, foe } = prizePosition();
  const skeledirge = require('./fixtures/fire-deck-cards.fixture.json').cards.find(card => card.name === 'Skeledirge ex');
  p.active = { ...clone(skeledirge), id: 'song', energy: [energy('f1','Fire'), energy('f2','Fire')], damage: 0 };
  p.bench = [];
  p.hand = [energy('extra','Fire')];
  p.energyAttachedThisTurn = true;
  foe.active.meta.hp = 160;
  assert.equal(r.api.aiAction().type, 'attack');
  foe.active.meta.hp = 200;
  assert.equal(r.api.aiAction().abilityName, 'Incendiary Song');
});

test('history inspection opens the original public attack card and does not offer a play action', async () => {
  const { r, p, attacker } = prizePosition();
  p.active = attacker;
  p.bench = [];
  attacker.energy.push(energy('lightning','Lightning'));
  await r.api.attack('codex', 0);
  const log = r.document.getElementById('moveLog');
  assert.match(log.innerHTML, /Inspect Dragonair/);
  const index = r.api.state().log.findIndex(item => item.reference?.card.id === attacker.id);
  await log.dispatchEvent({ type: 'click', target: { closest: () => ({ dataset: { historyIndex: String(index) } }) } });
  assert.match(r.document.getElementById('cardInspector').innerHTML, /Match history/);
  assert.equal(r.document.getElementById('attackPanel').hidden, true);
});

test('the move log shows older retained events and can inspect their public cards',async()=>{
  const r=setup(), game=r.api.state(), card=game.players.you.active;
  game.log=Array.from({length:40},(_,index)=>({time:new Date(),message:'Move '+index}));
  game.log[39].reference={side:'you',card};
  r.api.render();
  const log=r.document.getElementById('moveLog');
  assert.equal(r.document.getElementById('logCount').textContent,'40 events');
  assert.match(log.innerHTML,/Move 39/);
  await log.dispatchEvent({type:'click',target:{closest:()=>({dataset:{historyIndex:'39'}})}});
  assert.match(r.document.getElementById('cardInspector').innerHTML,/Match history/);
});
test('History starts visible and can be hidden and reopened without changing the match',async()=>{const r=setup(),before=JSON.stringify(r.api.state()),button=r.document.getElementById('matchLogBtn'),panel=r.document.getElementById('matchActivityPanel');assert.equal(panel.classList.contains('log-open'),true);await button.click();assert.equal(panel.classList.contains('log-open'),false);await button.click();assert.equal(panel.classList.contains('log-open'),true);assert.equal(JSON.stringify(r.api.state()),before);});
test('an attack returning its user to hand does not queue promotion after a final-Prize win',async()=>{const r=setup(),g=r.api.state();r.api.prepareAttack('codex','SVI','62',['Water']);g.turn='codex';g.players.codex.turnsTaken=2;g.firstPlayer='you';g.players.codex.prizes=g.players.codex.prizes.slice(0,1);g.players.you.active.damage=Number(g.players.you.active.meta.hp)-10;assert.equal(await r.api.attack('codex',1),true);assert.equal(g.phase,'finished');assert.equal(g.pendingPromotion,null);assert.equal(g.pendingAttackTurn,null);});

test('matchup statistics show Toma’s results by Yami difficulty and archetype', () => {
  const {runInContext} = require('node:vm');
  const {r} = prizePosition();
  const game = r.api.state();
  const [toma, yami] = runInContext('registeredDecks', r.context);
  game.deckIds = {you:toma.id, codex:yami.id};
  game.yamiDifficulty = 'casual';
  game.yamiStyle = 'control';
  runInContext("recordDeckResult('you')", r.context);
  game.statsRecorded = false;
  game.yamiDifficulty = 'competitor';
  game.yamiStyle = 'aggro';
  runInContext("recordDeckResult('codex')", r.context);
  const html = runInContext('matchupStatisticsMarkup(game.deckIds.you)', r.context);
  const row = html.match(/<tr><th scope="row">.*?<\/th><td>1 W · 1 L · 0 D<\/td>(.*?)<\/tr>/)?.[1];
  assert.ok(row);
  assert.deepEqual(Array.from(row.matchAll(/<td[^>]*>([^<]*)<\/td>/g), match => match[1]),
    ['—','—','1 W · 0 L','0 W · 1 L','—','—','—','—','—']);
});

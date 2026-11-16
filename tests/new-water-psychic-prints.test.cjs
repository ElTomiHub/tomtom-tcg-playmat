const assert = require('node:assert/strict');
const {test} = require('node:test');
const vm = require('node:vm');
const {createEngineRunner,loadFixture} = require('./integration-harness.cjs');

const prints = [["Staryu","M3","20"],["Mega Starmie ex","M3","111"],["Snorunt","M2A","200"],["Mega Froslass ex","M2A","233"],["Salvatore","SV5M","96"],["Hilda","SV11W","173"],["Special Red Card","M4","106"],["Battle Colosseum","M2","108"],["Surfing Beach","M4","112"],["Abra","SV4A","253"],["Kadabra","M1S","37"],["Mr. Mime","SV2A","179"],["Flutter Mane","SV5K","76"],["Xerneas","M1S","46"],["Mewtwo","MF","10"],["Hatterene V","S12A","65"],["Mew","M6A","56"],["Jacinthe","M3","108"],["Dawn","M2","115"],["Ancient Cemetery","S6K","68"],["Mew ex","30C","152"]];
test('all 21 new deck printings repair to an exact playable card', () => {
  const fixture = loadFixture(), runner = createEngineRunner(fixture,41);
  runner.api.setup(fixture,runner.random,runner.choose,()=>true);
  for (const [name,setCode,cardNumber] of prints) {
    const card = {id:setCode+'-'+cardNumber,name,setCode,cardNumber};
    runner.api.repairMetadata(card);
    assert.ok(card.meta?.image,name+' '+setCode+' '+cardNumber);
    runner.context.print = card;
    assert.equal(vm.runInContext('effectSupportFor(print)',runner.context),'automatic',name+' '+setCode+' '+cardNumber);
  }
});

function playSetup() {
  const fixture = loadFixture(), runner = createEngineRunner(fixture,42);
  runner.api.setup(fixture,runner.random,runner.choose,()=>true);
  runner.api.setLocalAi(false);
  const game = runner.api.state();
  game.turn = 'you'; game.phase = 'play'; game.turnNumber = 6;
  game.players.you.turnsTaken = 2;
  game.players.you.attackedThisTurn = false;
  game.players.you.supporterPlayedThisTurn = false;
  const make = (name,setCode,cardNumber) => {
    const card = {id:setCode+'-'+cardNumber,name,setCode,cardNumber,energy:[],tools:[],conditions:[],damage:0};
    runner.api.repairMetadata(card);
    return card;
  };
  const run = code=>vm.runInContext(code,runner.context);
  return {runner,game,make,run};
}

test('Salvatore evolves a newly played Staryu into Mega Starmie ex', async () => {
  const {runner,game,make} = playSetup();
  const supporter = make('Salvatore','SV5M','96'), star = make('Staryu','M3','20'), mega = make('Mega Starmie ex','M3','111');
  star.enteredTurn = game.turnNumber;
  const owner = game.players.you;
  owner.active = star; owner.bench = []; owner.hand = [supporter]; owner.deck = [mega];
  await runner.api.playCard('you',supporter.id);
  assert.equal(owner.active,mega);
  assert.equal(owner.discard.at(-1),supporter);
});

test('Battle Colosseum blocks Psypower on the Bench only, and Mimic Barrier blocks matching damage', async () => {
  const {runner,game,make,run} = playSetup();
  const mime = make('Mr. Mime','SV2A','179'), stadium = make('Battle Colosseum','M2','108');
  const star = make('Staryu','M3','20'), frost = make('Snorunt','M2A','200');
  game.players.you.active = mime; game.players.codex.active = star; game.players.codex.bench = [frost];
  game.stadium = {card:stadium,owner:'you'};
  Object.assign(runner.context,{mime,star,frost});
  assert.equal(run("calculateAttackDamageModifiers('codex','you',mime,'active',50).applied"),0);
  assert.equal(await run("resolveAttackEffect('you',mime,mime.meta.attacks[0],{defendingPokemon:star,counterTargets:[star,frost,frost]})"),true);
  assert.equal(star.damage,10);
  assert.equal(frost.damage,0);
  frost.energy = [{name:'Water Energy',meta:{category:'Energy',energyType:'Water'}}];
  mime.energy = frost.energy.slice();
  assert.equal(run("calculateAttackDamageModifiers('codex','you',mime,'active',50).applied"),50);
});

test('Mew ex 152 copies only affordable attacks from its Bench', () => {
  const {runner,game,make} = playSetup();
  const mew = make('Mew ex','30C','152'), staryu = make('Staryu','M3','20');
  game.players.you.active = mew; game.players.you.bench = [staryu];
  assert.equal(runner.api.attackOptions('you').some(({attack})=>attack.name==='Water Gun'),false);
  mew.energy = [{name:'Water Energy',meta:{category:'Energy',energyType:'Water'}}];
  assert.equal(runner.api.attackOptions('you').some(({attack})=>attack.name==='Water Gun'),true);
});

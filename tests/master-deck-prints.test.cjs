const assert = require('node:assert/strict');
const {test} = require('node:test');
const vm = require('node:vm');
const {createEngineRunner,loadFixture} = require('./integration-harness.cjs');

const prints = [
  {"name":"Dreepy","setCode":"M2A","cardNumber":"211"},
  {"name":"Drakloak","setCode":"M2A","cardNumber":"212"},
  {"name":"Dragapult ex","setCode":"SV8A","cardNumber":"221"},
  {"name":"Torchic","setCode":"SV10","cardNumber":"18"},
  {"name":"Combusken","setCode":"SV10","cardNumber":"19"},
  {"name":"Blaziken ex","setCode":"SVM","cardNumber":"16"},
  {"name":"Munkidori","setCode":"SV6","cardNumber":"107"},
  {"name":"Budew","setCode":"M2A","cardNumber":"196"},
  {"name":"Meowth ex","setCode":"M3","cardNumber":"114"},
  {"name":"Chi-Yu","setCode":"SV5A","cardNumber":"18"},
  {"name":"Poké Pad","setCode":"M3","cardNumber":"103"},
  {"name":"Poké Pad","setCode":"M6A","cardNumber":"102"},
  {"name":"Unfair Stamp","setCode":"MA","cardNumber":"11"},
  {"name":"Team Rocket's Watchtower","setCode":"SV10","cardNumber":"96"},
  {"name":"Riolu","setCode":"M1L","cardNumber":"68"},
  {"name":"Mega Lucario ex","setCode":"M1L","cardNumber":"88"},
  {"name":"Solrock","setCode":"MC","cardNumber":"372"},
  {"name":"Makuhita","setCode":"MP","cardNumber":"4"},
  {"name":"Hariyama","setCode":"MP","cardNumber":"167"},
  {"name":"Lunatone","setCode":"M1L","cardNumber":"26"},
  {"name":"Wally's Compassion","setCode":"M1S","cardNumber":"91"},
  {"name":"Fight Gong","setCode":"M1L","cardNumber":"82"},
  {"name":"Premium Power Pro","setCode":"M1L","cardNumber":"81"},
  {"name":"Secret Box","setCode":"SV6","cardNumber":"92"},
  {"name":"Balloon","setCode":"M1L","cardNumber":"84"},
  {"name":"Gravity Mountain","setCode":"SV8","cardNumber":"138"},
];

function setup() {
  const fixture = loadFixture();
  const runner = createEngineRunner(fixture, 17);
  runner.api.setup(fixture, runner.random, runner.choose, ()=>true);
  const card = (name, setCode, cardNumber) => {
    const result = {id:setCode+'-'+cardNumber,name,setCode,cardNumber,damage:0,energy:[],tools:[],conditions:[],evolutionStack:[]};
    runner.api.repairMetadata(result);
    return result;
  };
  return {runner,card,game:runner.api.state()};
}

test('all 26 master deck prints repair and resolve using their exact card metadata', () => {
  const {runner,card} = setup();
  for (const {name,setCode,cardNumber} of prints) {
    const print = card(name,setCode,cardNumber);
    assert.ok(print.meta?.image, name+' '+setCode+' '+cardNumber);
    runner.context.print = print;
    assert.equal(vm.runInContext('effectSupportFor(print)',runner.context),'automatic',name+' '+setCode+' '+cardNumber);
  }
});

test('Yami matches both archetypes by verified core effects and rejects a changed effect', () => {
  const {runner,card} = setup();
  const dragapult = [card('Dragapult ex','SV8A','221'),card('Drakloak','M2A','212'),card('Blaziken ex','SVM','16')];
  const lucario = [card('Mega Lucario ex','M1L','88'),card('Solrock','MC','372'),card('Lunatone','M1L','26')];
  assert.equal(runner.context.stageTwoAiProfile(dragapult),'dragapult_blaziken');
  assert.equal(runner.context.stageTwoAiProfile(lucario),'mega_lucario');
  const edited = structuredClone(lucario);
  edited[0].meta.attacks[0].effect += ' Draw a card.';
  assert.equal(runner.context.stageTwoAiProfile(edited),null);
});

test('Cosmo Beam requires a Benched Lunatone and ignores weakness and resistance', () => {
  const {runner,card,game} = setup();
  const solrock = card('Solrock','MC','372'), lunatone = card('Lunatone','M1L','26');
  const target = game.players.you.active;
  target.meta.weaknesses = [{type:'Fighting',value:'×2'}];
  target.meta.resistances = [{type:'Fighting',value:'-30'}];
  game.players.codex.active = solrock;
  game.players.codex.bench = [];
  runner.context.solrock = solrock;
  runner.context.target = target;
  assert.equal(vm.runInContext("calculateAttackDamageBeforeModifiers('codex',solrock,solrock.meta.attacks[0])",runner.context),0);
  game.players.codex.bench = [lunatone];
  assert.equal(vm.runInContext("attackPreviewFor('codex',solrock,solrock.meta.attacks[0]).outcomes[0].damage",runner.context),70);
});

test('Itchy Pollen locks only the opponent’s Items for one turn', async () => {
  const {runner,card,game} = setup();
  runner.context.budew = card('Budew','M2A','196');
  runner.context.pad = card('Poké Pad','M3','103');
  runner.context.wally = card("Wally's Compassion",'M1S','91');
  game.turn = 'you';
  game.turnNumber = 3;
  game.players.you.active = runner.context.budew;
  const defender = game.players.codex;
  defender.deck.push(card('Dreepy','M2A','211'));
  defender.bench.push(card('Mega Lucario ex','M1L','88'));
  defender.bench.at(-1).damage = 100;
  defender.supporterPlayedThisTurn = false;
  assert.equal(await vm.runInContext("resolveAttackEffect('you',budew,budew.meta.attacks[0])",runner.context),true);
  game.turn = 'codex';
  game.turnNumber = 4;
  assert.equal(vm.runInContext("canPlayTrainerEffect(pad,'codex')",runner.context),false);
  assert.equal(vm.runInContext("canPlayTrainerEffect(wally,'codex')",runner.context),true);
  game.turnNumber = 6;
  assert.equal(vm.runInContext("canPlayTrainerEffect(pad,'codex')",runner.context),true);
});

test('Gravity Mountain immediately knocks out a damaged Stage 2 when played', async () => {
  const {runner,card,game} = setup();
  game.turn = 'you';
  game.turnNumber = 3;
  game.phase = 'play';
  const stadium = card('Gravity Mountain','SV8','138');
  const knockedOut = card('Dragapult ex','SV8A','221');
  knockedOut.damage = 300;
  game.players.you.hand.push(stadium);
  game.players.codex.bench.push(knockedOut);
  const prizes = game.players.you.prizes.length;
  runner.context.stadium = stadium;
  await vm.runInContext("controlSide='you'; selected={side:'you',zone:'hand',id:stadium.id}; placeSelected('stadium')",runner.context);
  assert.equal(game.stadium?.card.id,stadium.id);
  assert.equal(game.players.codex.bench.some(card=>card.id===knockedOut.id),false);
  assert.equal(game.players.you.prizes.length,prizes-2);
});

test('Surveillance takes exactly one of the top two and bottoms the other once per turn', async () => {
  const {runner,card,game} = setup();
  const p = game.players.you;
  const drakloak = card('Drakloak','M2A','212');
  const lower = card('Torchic','SV10','18'), middle = card('Dreepy','M2A','211'), top = card('Budew','M2A','196');
  p.bench.push(drakloak);
  p.deck = [lower,middle,top];
  game.phase = 'play';
  game.turn = 'you';
  game.turnNumber = 3;
  runner.context.drakloak = drakloak;
  const action = "controlSide='you'; usePokemonAbility('you',drakloak,'Surveillance')";
  assert.equal(await vm.runInContext(action,runner.context),true);
  assert.equal(p.deck[1],lower);
  assert.ok(p.deck[0]===middle && p.hand.includes(top) || p.deck[0]===top && p.hand.includes(middle));
  assert.equal(await vm.runInContext(action,runner.context),false);
});

test('Aura Jab can attach multiple discarded Basic Fighting Energy to the same Benched Pokémon', async () => {
  const {runner,card,game} = setup();
  const p = game.players.codex;
  const lucario = card('Mega Lucario ex','M1L','88'), riolu = card('Riolu','M1L','68');
  const energy = id => ({id,name:'Fighting Energy',meta:{category:'Energy',energyType:'Fighting'}});
  p.active = lucario;
  p.bench = [riolu];
  p.discard = [energy('f1'),energy('f2'),energy('f3'),energy('f4')];
  game.phase = 'play';
  game.turn = 'codex';
  game.turnNumber = 4;
  runner.context.lucario = lucario;
  assert.equal(await vm.runInContext("localAiEnabled=true; resolveAttackEffect('codex',lucario,lucario.meta.attacks[0])",runner.context),true);
  assert.deepEqual(Array.from(riolu.energy,item=>item.id),['f1','f2','f3']);
  assert.equal(p.discard.length,1);
});

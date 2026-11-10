const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function engineFunction(name) {
  const start = html.search(new RegExp(`^    (?:async )?function ${name}\\(`, 'm'));
  assert.notEqual(start, -1, `Could not find ${name}`);
  const rest = html.slice(start), next = rest.slice(1).search(/^    (?:async )?function [\w$]+\(/m);
  return next === -1 ? rest : rest.slice(0, next + 1);
}
const registryStart = html.indexOf('    const CARD_EFFECT_REGISTRY = {');
const registryEnd = html.indexOf('    const DEFAULT_DECKS = [', registryStart);
const exactText = 'Search your deck for a Basic Pokémon and put it onto your Bench. Then, shuffle your deck.';
const cleanCardKey = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[’‘]/g, "'").replace(/[-‐‑–—]/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
const normalizeCollectorNumber = value => { const raw = String(value || '').trim().toUpperCase().split('/')[0].replace(/\s+/g, ''); const match = raw.match(/^0*(\d+)([A-Z]?)$/); return match ? `${Number(match[1])}${match[2]}` : raw; };

function makeHarness({ side = 'you', deck = [], bench = [], chooseId = null, localAiEnabled = false, print = 'PAF 84' } = {}) {
  const players = {
    you: { name: 'You', active: pokemon('you-active', 'Active', 'Basic'), bench: [], hand: [], deck: [], discard: [], lost: [], prizes: [], energyAttachedThisTurn: false, supporterPlayedThisTurn: false, turnsTaken: 1 },
    codex: { name: 'Codex', active: pokemon('codex-active', 'AI Active', 'Basic'), bench: [], hand: [], deck: [], discard: [], lost: [], prizes: [], energyAttachedThisTurn: false, supporterPlayedThisTurn: false, turnsTaken: 1 }
  };
  players[side].deck = deck;
  players[side].bench = bench;
  const [setCode, cardNumber] = print.split(' ');
  const nest = { id: 'nest-ball', name: 'Nest Ball', setCode, cardNumber, language: 'en', meta: { category: 'Trainer', trainerType: 'Item', effect: exactText } };
  players[side].hand = [nest];
  const context = vm.createContext({
    players, player: currentSide => players[currentSide], deckStats: {}, persistDeckStats: () => true, scheduleLocalAiTurn: () => {}, oppositeSide: currentSide => currentSide === 'you' ? 'codex' : 'you',
    game: { phase: 'play', turn: side, firstPlayer: side, turnNumber: 2, damageBonuses: [], stadium: null, stadiumPlayedThisTurn: false, log: [], players },
    controlSide: side, selected: { side, zone: 'hand', id: nest.id }, localAiEnabled, localAiTimer: null,
    activeCardChoice: null, activeCardChoiceResolver: null, activeBoardChoice: null, activeBoardChoiceResolver: null,
    logs: [], toasts: [], renderCount: 0, statEvents: [], chooseId,
    window: { __POKEMON_TCG_TEST__: true }, Math, Number, Set, Map, Error, console,
    cleanCardKey, normalizeCollectorNumber,
    normalizeCategory: value => /^pokemon/i.test(value) ? 'Pokemon' : /^trainer/i.test(value) ? 'Trainer' : /^energy/i.test(value) ? 'Energy' : 'Unknown',
    logEvent: message => context.logs.push(message), showToast: message => context.toasts.push(message), render: () => { context.renderCount++; },
    recordDeckCardStat: (currentSide, card, event) => context.statEvents.push([currentSide, card.id, event]),
    hasVerifiedCardData: () => true,
    availablePokemonAbilities: () => [], canUseActiveStadium: () => false,
    imageFor: () => '', escapeHtml: value => String(value),
    $: () => ({ textContent: '', classList: { add() {}, remove() {} }, dataset: {}, setAttribute() {}, querySelectorAll: () => [] })
  });
  vm.runInContext('let engineTestHooks = null;', context);
  vm.runInContext(html.slice(registryStart, registryEnd) + '\nglobalThis.registry = CARD_EFFECT_REGISTRY;', context);
  const functions = [
    'installEngineTestHooks', 'engineRandom', 'engineTestChoice', 'normalizeScriptedCards', 'matchEffectRule',
    'itemEffectRuleFor', 'effectHandlerIsImplemented', 'cardEffectIsSafelyImplemented', 'effectSupportFor', 'effectResolutionFor', 'resolveSearchAndMoveOperation', 'isBasicEnergy', 'basicPokemon', 'removeCardFromHand', 'consumeResolvedItem', 'snapshotResolutionState', 'restoreResolutionState', 'runResolutionTransaction', 'runEffectTransaction',
    'shuffled', 'chooseCardsInApp', 'pickEffectCard', 'canPlayTrainerEffect', 'resolveBuiltInItem', 'playTrainerSelected', 'chooseLocalAiAction', 'canEvolveNormally', 'stadiumEffectRuleFor', 'pokemonHasType'
  ];
  for (const name of functions) vm.runInContext(engineFunction(name), context);
  vm.runInContext('globalThis.testGame = () => game; player = side => game.players[side];', context);
  context.installEngineTestHooks({ random: () => 0, choose: () => chooseId });
  return { context, players, nest, side };
}

function pokemon(id, name, stage = 'Basic') {
  return { id, name, setCode: 'TST', cardNumber: id, meta: { category: 'Pokemon', stage, hp: 70, types: ['Colorless'], evolveFrom: stage === 'Basic' ? '' : 'Basic' }, energy: [], tools: [], conditions: [], damage: 0 };
}
function nestCard(setCode = 'PAF', cardNumber = '84') {
  return { name: 'Nest Ball', setCode, cardNumber, language: 'en', meta: { category: 'Trainer', trainerType: 'Item', effect: exactText } };
}

async function play(harness) {
  await harness.context.playTrainerSelected();
}

test('PAF 84 exact full-text rule is registered; a same-name other printing stays manual', async () => {
  const exact = makeHarness();
  assert.equal(exact.context.itemEffectRuleFor(nestCard()).effect.operation, 'searchAndMove');
  assert.ok(exact.context.registeredOperationFor(exact.context.itemEffectRuleFor(nestCard()).effect));
  assert.equal(exact.context.effectSupportFor(nestCard()), 'automatic');
  assert.equal(exact.context.effectResolutionFor(nestCard()).key, 'automated');
  assert.equal(exact.context.registeredOperationFor({ ...exact.context.itemEffectRuleFor(nestCard()).effect, benchCapacity: 6 }), null);
  const missingLanguage = nestCard(); delete missingLanguage.language;
  assert.equal(exact.context.itemEffectRuleFor(missingLanguage), null);
  const wrong = makeHarness({ print: 'SVI 182' });
  assert.equal(wrong.context.itemEffectRuleFor(nestCard('SVI', '182')), null);
  assert.equal(wrong.context.effectSupportFor(nestCard('SVI', '182')), 'manual');
  assert.equal(wrong.context.effectResolutionFor(nestCard('SVI', '182')).key, 'manual');
  const basic = pokemon('wrong-print-basic', 'Basic Pokémon');
  const wrongPlay = makeHarness({ deck: [basic], print: 'SVI 182' });
  await play(wrongPlay);
  assert.equal(wrongPlay.players.you.bench.length, 0);
  assert.equal(wrongPlay.players.you.deck.length, 1);
  assert.match(wrongPlay.context.toasts.at(-1), /not supported yet/);
});

test('human uses the in-app choice path to find a Basic Pokémon, bench it, and shuffle the remaining deck', async () => {
  const a = pokemon('basic-a', 'Basic A'), b = pokemon('basic-b', 'Basic B');
  const nonPokemon = { id: 'trainer', name: 'Draw Trainer', meta: { category: 'Trainer' } };
  const harness = makeHarness({ deck: [a, nonPokemon, b], chooseId: b.id });
  assert.equal(harness.context.canPlayTrainerEffect(harness.nest, 'you'), true);
  await play(harness);
  assert.equal(harness.players.you.bench.some(card => card.id === b.id), true);
  assert.equal(harness.players.you.deck.length, 2);
  assert.deepEqual(Array.from(harness.players.you.deck, card => card.id), ['trainer', 'basic-a']);
  assert.equal(harness.players.you.hand.length, 0);
  assert.deepEqual(Array.from(harness.players.you.discard, card => card.id), ['nest-ball']);
  assert.equal(harness.context.logs.some(message => message.includes('revealed Basic B') && message.includes('shuffled the deck')), true);
});

test('player can select a different eligible Basic Pokémon', async () => {
  for (const chosenId of ['basic-a', 'basic-b']) {
    const deck = [pokemon('basic-a', 'Basic A'), pokemon('basic-b', 'Basic B')];
    const harness = makeHarness({ deck, chooseId: chosenId });
    await play(harness);
    assert.equal(harness.players.you.bench.some(card => card.id === chosenId), true);
    assert.equal(harness.players.you.deck.length, 1);
  }
});

test('AI uses the same item handler and chooses an eligible Basic Pokémon using its evolution preference', async () => {
  const a = pokemon('basic-a', 'Basic A'), b = pokemon('basic-b', 'Basic B');
  const evolution = pokemon('evolution-b', 'Evolution B', 'Stage 1'); evolution.meta.evolveFrom = 'Basic B';
  const harness = makeHarness({ side: 'codex', deck: [a, b], localAiEnabled: true });
  harness.players.codex.hand.push(evolution);
  const action = harness.context.chooseLocalAiAction();
  assert.equal(action.type, 'trainer');
  assert.equal(action.card.id, 'nest-ball');
  await play(harness);
  assert.equal(harness.players.codex.bench.some(card => card.id === 'basic-b'), true);
  assert.equal(harness.players.codex.deck.length, 1);
  assert.deepEqual(Array.from(harness.players.codex.discard, card => card.id), ['nest-ball']);
});

test('no Basic Pokémon or an empty deck completes the search without a choice and shuffles safely', async () => {
  const noBasic = makeHarness({ deck: [pokemon('stage1', 'Stage One', 'Stage 1'), { id: 'trainer', name: 'Trainer', meta: { category: 'Trainer' } }] });
  assert.equal(noBasic.context.canPlayTrainerEffect(noBasic.nest, 'you'), true);
  await play(noBasic);
  assert.equal(noBasic.players.you.deck.length, 2);
  assert.equal(noBasic.players.you.hand.length, 0);
  assert.deepEqual(Array.from(noBasic.players.you.discard, card => card.id), ['nest-ball']);
  assert.match(noBasic.context.logs[0], /found no Basic Pokémon; the deck was shuffled/);
  const empty = makeHarness();
  await play(empty);
  assert.equal(empty.players.you.deck.length, 0);
  assert.deepEqual(Array.from(empty.players.you.discard, card => card.id), ['nest-ball']);
  assert.match(empty.context.logs[0], /found no Basic Pokémon/);
});

test('full Bench prevents playing Nest Ball and leaves the card and deck unchanged', async () => {
  const bench = Array.from({ length: 5 }, (_, index) => pokemon(`bench-${index}`, `Bench ${index}`));
  const basic = pokemon('deck-basic', 'Deck Basic');
  const harness = makeHarness({ deck: [basic], bench });
  assert.equal(harness.context.canPlayTrainerEffect(harness.nest, 'you'), false);
  await play(harness);
  assert.equal(harness.players.you.hand.some(card => card.id === 'nest-ball'), true);
  assert.deepEqual(Array.from(harness.players.you.deck, card => card.id), ['deck-basic']);
  assert.equal(harness.players.you.bench.length, 5);
});

test('cancelled or invalid selection does not consume Nest Ball or change deck contents', async () => {
  for (const chooseId of [null, 'not-in-the-deck']) {
    const harness = makeHarness({ deck: [pokemon('basic-a', 'Basic A')], chooseId });
    await play(harness);
    assert.equal(harness.players.you.hand.some(card => card.id === 'nest-ball'), true);
    assert.equal(harness.players.you.deck.length, 1);
    assert.equal(harness.players.you.bench.length, 0);
    assert.equal(harness.players.you.discard.length, 0);
  }
});

test('Nest Ball revalidates the selected Basic and rolls back deck, Bench, and discard if execution fails', async () => {
  const stale = makeHarness({ deck: [pokemon('basic-a', 'Basic A')], chooseId: 'basic-a' });
  stale.context.installEngineTestHooks({ choose: ({ candidates }) => { stale.players.you.deck = []; return candidates[0].id; } });
  assert.equal(await stale.context.resolveBuiltInItem(stale.nest, 'you'), false);
  assert.equal(stale.players.you.bench.length, 0);
  assert.equal(stale.players.you.hand.includes(stale.nest), true);
  assert.equal(stale.players.you.discard.length, 0);

  const failing = makeHarness({ deck: [pokemon('basic-b', 'Basic B')], chooseId: 'basic-b' });
  const before = JSON.stringify(failing.context.testGame().players.you);
  failing.context.shuffled = () => { throw new Error('shuffle failure'); };
  assert.equal(await failing.context.resolveBuiltInItem(failing.nest, 'you'), false);
  assert.deepEqual(JSON.parse(JSON.stringify(failing.context.testGame().players.you)), JSON.parse(before));
});

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
const effectText = 'Switch your Active Pokémon with 1 of your Benched Pokémon.';
const cleanCardKey = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[’‘]/g, "'").replace(/[-‐‑–—]/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
const normalizeCollectorNumber = value => { const raw = String(value || '').trim().toUpperCase().split('/')[0].replace(/\s+/g, ''); const m = raw.match(/^0*(\d+)([A-Z]?)$/); return m ? `${Number(m[1])}${m[2]}` : raw; };

function pokemon(id, name, hp = 120) {
  return { id, name, meta: { category: 'Pokemon', stage: 'Basic', hp, types: ['Colorless'] }, energy: [], tools: [], damage: 0, conditions: [], evolutionStack: [], growlReduction: null };
}
function switchCard({ setCode = 'MEG', cardNumber = '130', text = effectText, language = 'en' } = {}) {
  return { id: 'switch-meg130', name: 'Switch', setCode, cardNumber, language, meta: { category: 'Trainer', trainerType: 'Item', effect: text } };
}
function makeHarness({ side = 'you', benchCount = 1, targetChoice = 'bench-1', localAiEnabled = false, print = {} } = {}) {
  const active = pokemon('active', 'Active Pokémon', 110);
  active.energy = [{ id: 'active-energy', name: 'Lightning Energy' }];
  active.tools = [{ id: 'active-tool', name: 'Bravery Charm' }];
  active.damage = 30;
  active.conditions = ['poisoned'];
  active.growlReduction = { amount: 10 };
  active.evolutionStack = [{ name: 'Previous Active', meta: { category: 'Pokemon' } }];
  const bench = Array.from({ length: benchCount }, (_, index) => pokemon(`bench-${index + 1}`, `Bench Pokémon ${index + 1}`, 90 + index * 10));
  const card = switchCard(print);
  const players = {
    you: { name: 'You', active: null, bench: [], hand: [], deck: [], discard: [], lost: [], prizes: [], turnsTaken: 1 },
    codex: { name: 'Codex', active: null, bench: [], hand: [], deck: [], discard: [], lost: [], prizes: [], turnsTaken: 1 }
  };
  players[side].active = active; players[side].bench = bench; players[side].hand = [card];
  const context = vm.createContext({
    players, player: current => players[current], deckStats: {}, persistDeckStats: () => true, scheduleLocalAiTurn: () => {}, oppositeSide: current => current === 'you' ? 'codex' : 'you',
    game: { phase: 'play', turn: side, firstPlayer: side, turnNumber: 3, damageBonuses: [], stadium: null, log: [], players },
    controlSide: side, selected: { side, zone: 'hand', id: card.id }, localAiEnabled,
    activeCardChoice: null, activeCardChoiceResolver: null, activeBoardChoice: null, activeBoardChoiceResolver: null,
    registeredCards: [], logs: [], toasts: [], statEvents: [], window: { __POKEMON_TCG_TEST__: true }, Math, Number, Set, Map, Error, console,
    cleanCardKey, normalizeCollectorNumber,
    logEvent: message => context.logs.push(message), showToast: message => context.toasts.push(message), render: () => {},
    recordDeckCardStat: (...args) => context.statEvents.push(args), isBasicEnergy: name => /basic energy/i.test(name),
    hasVerifiedCardData: () => true, imageFor: () => '', escapeHtml: value => String(value),
    $: () => ({ textContent: '', hidden: true, classList: { add() {}, remove() {} }, setAttribute() {}, querySelectorAll: () => [] })
  });
  vm.runInContext('let engineTestHooks = null;', context);
  vm.runInContext(html.slice(registryStart, registryEnd), context);
  for (const name of ['installEngineTestHooks', 'engineTestChoice', 'normalizeScriptedCards', 'matchEffectRule', 'itemEffectRuleFor', 'effectHandlerIsImplemented', 'cardEffectIsSafelyImplemented', 'effectSupportFor', 'effectResolutionFor', 'resolveSwitchPositionsOperation', 'choosePokemonOnBoard', 'clearPokemonConditions', 'canPlayTrainerEffect', 'resolveBuiltInItem', 'removeCardFromHand', 'consumeResolvedItem', 'snapshotResolutionState', 'restoreResolutionState', 'runResolutionTransaction', 'runEffectTransaction', 'playTrainerSelected']) vm.runInContext(engineFunction(name), context);
  vm.runInContext('globalThis.testGame = () => game; player = side => game.players[side];', context);
  context.installEngineTestHooks({ choose: () => targetChoice });
  return { context, players, p: players[side], card, active, bench, side };
}

test('MEG 130 exact print and complete text are automated; other Switch prints or altered text are not', () => {
  const h = makeHarness();
  assert.equal(h.context.itemEffectRuleFor(h.card).effect.operation, 'switchPositions');
  assert.ok(h.context.registeredOperationFor(h.context.itemEffectRuleFor(h.card).effect));
  assert.equal(h.context.effectSupportFor(h.card), 'automatic');
  assert.equal(h.context.effectResolutionFor(h.card).key, 'automated');
  assert.equal(h.context.registeredOperationFor({ ...h.context.itemEffectRuleFor(h.card).effect, count: 2 }), null);
  const missingLanguage = switchCard(); delete missingLanguage.language;
  assert.equal(h.context.itemEffectRuleFor(missingLanguage), null);
  for (const wrong of [switchCard({ setCode: 'SVI', cardNumber: '194' }), switchCard({ text: `${effectText} Then draw a card.` })]) {
    assert.equal(h.context.itemEffectRuleFor(wrong), null);
    assert.notEqual(h.context.effectSupportFor(wrong), 'automatic');
  }
});

test('successful use swaps the Active and selected Bench Pokémon, preserves card state, and discards Switch', async () => {
  const h = makeHarness();
  const target = h.bench[0]; target.energy = [{ id: 'bench-energy', name: 'Water Energy' }]; target.tools = [{ id: 'bench-tool', name: 'Exp. Share' }]; target.damage = 20; target.evolutionStack = [{ name: 'Bench Basic', meta: {} }];
  await h.context.playTrainerSelected();
  assert.equal(h.p.active, target);
  assert.equal(h.p.bench[0], h.active);
  assert.deepEqual(Array.from(h.p.active.energy, item => item.id), ['bench-energy']);
  assert.deepEqual(Array.from(h.p.active.tools, item => item.id), ['bench-tool']);
  assert.equal(h.p.active.damage, 20);
  assert.deepEqual(Array.from(h.p.active.evolutionStack, item => item.name), ['Bench Basic']);
  assert.deepEqual(Array.from(h.p.bench[0].energy, item => item.id), ['active-energy']);
  assert.deepEqual(Array.from(h.p.bench[0].tools, item => item.id), ['active-tool']);
  assert.equal(h.p.bench[0].damage, 30);
  assert.deepEqual(Array.from(h.p.bench[0].evolutionStack, item => item.name), ['Previous Active']);
  assert.deepEqual(Array.from(h.p.bench[0].conditions), [], 'the Active Pokémon recovers from Special Conditions when moved to the Bench');
  assert.deepEqual(Array.from(h.p.discard, item => item.id), ['switch-meg130']);
  assert.equal(h.p.hand.length, 0);
});

test('Switch cannot be played when there is no Benched Pokémon', async () => {
  const h = makeHarness({ benchCount: 0 });
  assert.equal(h.context.canPlayTrainerEffect(h.card, h.side), false);
  await h.context.playTrainerSelected();
  assert.equal(h.p.active, h.active);
  assert.equal(h.p.hand.includes(h.card), true);
  assert.equal(h.p.discard.length, 0);
});

test('cancelled or invalid target selection leaves board and card zones unchanged', async () => {
  for (const targetChoice of [null, 'not-on-bench']) {
    const h = makeHarness({ targetChoice });
    const originalBench = h.p.bench.slice();
    await h.context.playTrainerSelected();
    assert.equal(h.p.active, h.active);
    assert.deepEqual(Array.from(h.p.bench), originalBench);
    assert.equal(h.p.hand.includes(h.card), true);
    assert.equal(h.p.discard.length, 0);
  }
});

test('human and AI resolve through the same handler; AI target is selected from the legal Bench', async () => {
  const human = makeHarness();
  assert.equal(await human.context.resolveBuiltInItem(human.card, 'you'), true);
  assert.equal(human.p.active.id, 'bench-1');
  const ai = makeHarness({ side: 'codex', localAiEnabled: true });
  ai.context.installEngineTestHooks({});
  assert.equal(await ai.context.resolveBuiltInItem(ai.card, 'codex'), true);
  assert.equal(ai.p.active.id, 'bench-1');
  assert.equal(ai.p.bench[0], ai.active);
});

test('stale target resolution fails without moving Pokémon or consuming Switch', async () => {
  const h = makeHarness();
  h.context.installEngineTestHooks({ choose: () => 'removed-target' });
  const beforeBench = h.p.bench.slice();
  assert.equal(await h.context.resolveBuiltInItem(h.card, h.side), false);
  assert.equal(h.p.active, h.active);
  assert.deepEqual(Array.from(h.p.bench), beforeBench);
  assert.equal(h.p.hand.includes(h.card), true);
  assert.equal(h.p.discard.length, 0);
});

test('Switch revalidates a live target and rolls back partial condition/position changes on failure', async () => {
  const stale = makeHarness();
  stale.context.installEngineTestHooks({ choose: ({ kind, candidates }) => {
    if (kind === 'pokemon-target') { stale.p.bench = []; return candidates[0].id; }
    return null;
  } });
  assert.equal(await stale.context.resolveBuiltInItem(stale.card, 'you'), false);
  assert.equal(stale.p.active, stale.active);
  assert.equal(stale.p.hand.includes(stale.card), true);
  assert.equal(stale.p.discard.length, 0);

  const failing = makeHarness();
  const before = JSON.stringify(failing.context.testGame().players.you);
  failing.context.clearPokemonConditions = pokemonCard => { pokemonCard.conditions = []; throw new Error('switch failure'); };
  assert.equal(await failing.context.resolveBuiltInItem(failing.card, 'you'), false);
  assert.deepEqual(JSON.parse(JSON.stringify(failing.context.testGame().players.you)), JSON.parse(before));
  const restored = failing.context.testGame().players.you;
  assert.deepEqual(Array.from(restored.active.conditions), ['poisoned']);
  assert.equal(restored.active.id, 'active');
  assert.equal(restored.bench[0].id, 'bench-1');
  assert.equal(restored.hand.some(card => card.id === failing.card.id), true);
});

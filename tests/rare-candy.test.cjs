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
const effectText = "Choose 1 of your Basic Pokémon in play. If you have a Stage 2 card in your hand that evolves from that Pokémon, put that card on the Basic Pokémon. (This counts as evolving that Pokémon.) You can't use this card during your first turn or on a Basic Pokémon that was put into play this turn.";

const cleanCardKey = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[’‘]/g, "'").replace(/[-‐‑–—]/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
const normalizeCollectorNumber = value => { const raw = String(value || '').trim().toUpperCase().split('/')[0].replace(/\s+/g, ''); const m = raw.match(/^0*(\d+)([A-Z]?)$/); return m ? `${Number(m[1])}${m[2]}` : raw; };

function makePokemon(id, name, stage, evolveFrom = '', extra = {}) {
  return { id, name, setCode: 'TST', cardNumber: id, meta: { category: 'Pokemon', stage, evolveFrom, hp: 180, types: ['Dragon'], ...extra }, energy: [], tools: [], conditions: [], damage: 0, evolutionStack: [], enteredTurn: 1 };
}
function candyCard({ setCode = 'MEG', cardNumber = '125', text = effectText, language = 'en' } = {}) {
  return { id: 'rare-candy', name: 'Rare Candy', setCode, cardNumber, language, meta: { category: 'Trainer', trainerType: 'Item', effect: text } };
}
function makeHarness({ side = 'you', targetChoice = 'basic', evolutionChoice = 'dragonite', turnsTaken = 1, enteredTurn = 1, localAiEnabled = false, print = {} } = {}) {
  const basic = makePokemon('basic', 'Dratini', 'Basic'); basic.enteredTurn = enteredTurn;
  const dragonair = makePokemon('dragonair', 'Dragonair', 'Stage 1', 'Dratini');
  const dragonite = makePokemon('dragonite', 'Dragonite', 'Stage 2', 'Dragonair');
  const candy = candyCard(print);
  const players = {
    you: { name: 'You', active: null, bench: [], hand: [], deck: [], discard: [], lost: [], prizes: [], turnsTaken: 1 },
    codex: { name: 'Codex', active: null, bench: [], hand: [], deck: [], discard: [], lost: [], prizes: [], turnsTaken: 1 }
  };
  const p = players[side]; p.active = basic; p.hand = [candy, dragonite]; p.turnsTaken = turnsTaken;
  const context = vm.createContext({
    players, player: current => players[current], deckStats: {}, persistDeckStats: () => true, scheduleLocalAiTurn: () => {}, oppositeSide: current => current === 'you' ? 'codex' : 'you',
    game: { phase: 'play', turn: side, firstPlayer: side, turnNumber: 2, damageBonuses: [], stadium: null, log: [], players },
    controlSide: side, selected: { side, zone: 'hand', id: candy.id }, localAiEnabled, activeCardChoice: null,
    activeCardChoiceResolver: null, activeBoardChoice: null, activeBoardChoiceResolver: null, registeredCards: [dragonair],
    logs: [], toasts: [], statEvents: [], renderCount: 0, window: { __POKEMON_TCG_TEST__: true }, Math, Number, Set, Map, Error, console,
    cleanCardKey, normalizeCollectorNumber,
    logEvent: message => context.logs.push(message), showToast: message => context.toasts.push(message), render: () => { context.renderCount++; },
    recordDeckCardStat: (...args) => context.statEvents.push(args), isDoubleDragonEnergyCard: () => false,
    effectivePokemonHp: card => Number(card?.meta?.hp || 0), resolveOnEvolveAbilities: () => {},
    resolveKnockout: () => {}, resolveBenchKnockout: () => {},
    hasVerifiedCardData: () => true, imageFor: () => '', escapeHtml: value => String(value),
    $: () => ({ textContent: '', hidden: true, classList: { add() {}, remove() {} }, setAttribute() {}, querySelectorAll: () => [] })
  });
  vm.runInContext('let engineTestHooks = null;', context);
  vm.runInContext(html.slice(registryStart, registryEnd) + '\nglobalThis.registry = CARD_EFFECT_REGISTRY;', context);
  for (const name of ['installEngineTestHooks', 'engineTestChoice', 'normalizeScriptedCards', 'normalizePokemonStage', 'basicPokemon', 'matchEffectRule', 'itemEffectRuleFor', 'effectHandlerIsImplemented', 'cardEffectIsSafelyImplemented', 'effectSupportFor', 'effectResolutionFor', 'resolveEvolutionOperation', 'pokemonCanUseRareCandyTarget', 'pokemonCanEvolveFrom', 'removeCardFromHand', 'consumeResolvedItem', 'snapshotResolutionState', 'restoreResolutionState', 'runResolutionTransaction', 'runEffectTransaction', 'choosePokemonOnBoard', 'chooseCardsInApp', 'pickEffectCard', 'insertEvolution', 'normalizedEnergyType', 'resolveBuiltInItem', 'canPlayTrainerEffect', 'playTrainerSelected']) vm.runInContext(engineFunction(name), context);
  vm.runInContext('globalThis.testGame = () => game; player = side => game.players[side];', context);
  context.installEngineTestHooks({ choose: ({ kind }) => kind === 'pokemon-target' ? targetChoice : [evolutionChoice] });
  return { context, players, p, basic, dragonair, dragonite, candy, side };
}

test('MEG 125 exact full text and identity are automated; same-name alternate print or altered text is not', () => {
  const h = makeHarness();
  assert.equal(h.context.itemEffectRuleFor(h.candy).effect.operation, 'evolve');
  assert.ok(h.context.registeredOperationFor(h.context.itemEffectRuleFor(h.candy).effect));
  assert.equal(h.context.effectSupportFor(h.candy), 'automatic');
  assert.equal(h.context.effectResolutionFor(h.candy).key, 'automated');
  assert.equal(h.context.registeredOperationFor({ ...h.context.itemEffectRuleFor(h.candy).effect, countsAsEvolution: false }), null);
  const missingLanguage = candyCard(); delete missingLanguage.language;
  assert.equal(h.context.itemEffectRuleFor(missingLanguage), null);
  for (const wrong of [candyCard({ setCode: 'PAF', cardNumber: '89' }), candyCard({ text: `${effectText} Additional instruction.` })]) {
    assert.equal(h.context.itemEffectRuleFor(wrong), null);
    assert.notEqual(h.context.effectSupportFor(wrong), 'automatic');
  }
});

test('Rare Candy evolves a legal Basic directly to its matching Stage 2 and preserves attached state', async () => {
  const h = makeHarness();
  h.basic.energy = [{ id: 'energy', name: 'Lightning Energy', meta: { category: 'Energy' } }];
  h.basic.tools = [{ id: 'tool', name: 'Bravery Charm', meta: { category: 'Trainer' } }];
  h.basic.damage = 40;
  assert.equal(h.context.canPlayTrainerEffect(h.candy, h.side), true);
  assert.equal(await h.context.playTrainerSelected(), undefined);
  assert.equal(h.players.you.active.id, 'dragonite');
  assert.deepEqual(Array.from(h.players.you.active.energy, card => card.id), ['energy']);
  assert.deepEqual(Array.from(h.players.you.active.tools, card => card.id), ['tool']);
  assert.equal(h.players.you.active.damage, 40);
  assert.deepEqual(Array.from(h.players.you.active.evolutionStack, card => card.name), ['Dratini']);
  assert.equal(h.players.you.hand.length, 0);
  assert.deepEqual(Array.from(h.players.you.discard, card => card.id), ['rare-candy']);
});

test('only matching evolution families can be selected, and a wrong family cannot be played', async () => {
  const h = makeHarness();
  const wrongFamily = makePokemon('wrong-family', 'Charizard', 'Stage 2', 'Charmeleon');
  h.players.you.hand.push(wrongFamily);
  assert.equal(h.context.canPlayTrainerEffect(h.candy, h.side), true);
  h.context.installEngineTestHooks({ choose: ({ kind }) => kind === 'pokemon-target' ? 'basic' : ['wrong-family'] });
  await h.context.resolveBuiltInItem(h.candy, h.side);
  assert.equal(h.players.you.active.name, 'Dratini');
  assert.equal(h.players.you.hand.includes(wrongFamily), true);
});

test('Rare Candy is unavailable without a legal Basic target or a matching Stage 2 in hand', () => {
  const noBasic = makeHarness(); noBasic.players.you.active = makePokemon('stage1', 'Dragonair', 'Stage 1', 'Dratini');
  assert.equal(noBasic.context.canPlayTrainerEffect(noBasic.candy, noBasic.side), false);
  const noStage2 = makeHarness(); noStage2.players.you.hand = [noStage2.candy];
  assert.equal(noStage2.context.canPlayTrainerEffect(noStage2.candy, noStage2.side), false);
});

test('already-evolved Pokémon cannot be used as the Basic target', () => {
  const h = makeHarness(); h.players.you.active.meta.stage = 'Stage 1';
  assert.equal(h.context.canPlayTrainerEffect(h.candy, h.side), false);
});

test('first turn and a Basic Pokémon played this turn are both restricted', () => {
  const firstTurn = makeHarness({ turnsTaken: 0 });
  assert.equal(firstTurn.context.canPlayTrainerEffect(firstTurn.candy, firstTurn.side), false);
  const justPlayed = makeHarness({ enteredTurn: 2 });
  assert.equal(justPlayed.context.canPlayTrainerEffect(justPlayed.candy, justPlayed.side), false);
});

test('human uses the in-app target and Stage 2 choices; invalid or cancelled choices leave state untouched', async () => {
  const valid = makeHarness({ targetChoice: 'basic', evolutionChoice: 'dragonite' });
  await valid.context.resolveBuiltInItem(valid.candy, valid.side);
  assert.equal(valid.players.you.active.id, 'dragonite');
  for (const [targetChoice, evolutionChoice] of [['not-a-target', 'dragonite'], ['basic', 'not-in-hand']]) {
    const h = makeHarness({ targetChoice, evolutionChoice });
    assert.equal(await h.context.resolveBuiltInItem(h.candy, h.side), false);
    assert.equal(h.players.you.active.id, 'basic');
    assert.equal(h.players.you.hand.includes(h.dragonite), true);
  }
});

test('AI resolves through the same handler and chooses only a legal Basic and corresponding Stage 2', async () => {
  const h = makeHarness({ side: 'codex', localAiEnabled: true });
  const unrelated = makePokemon('unrelated', 'Pidgey', 'Basic'); unrelated.enteredTurn = 1;
  h.players.codex.bench.push(unrelated);
  assert.equal(h.context.canPlayTrainerEffect(h.candy, 'codex'), true);
  assert.equal(await h.context.resolveBuiltInItem(h.candy, 'codex'), true);
  assert.equal(h.players.codex.active.id, 'dragonite');
  assert.equal(h.players.codex.bench[0].id, 'unrelated');
});

test('Rare Candy revalidates both choices and rolls back a failed evolution without consuming either card', async () => {
  const stale = makeHarness({ targetChoice: 'basic', evolutionChoice: 'dragonite' });
  stale.context.installEngineTestHooks({ choose: ({ kind, candidates }) => {
    if (kind === 'pokemon-target') return 'basic';
    stale.players.you.active.enteredTurn = stale.context.game.turnNumber;
    return ['dragonite'];
  } });
  assert.equal(await stale.context.resolveBuiltInItem(stale.candy, 'you'), false);
  assert.equal(stale.players.you.active.id, 'basic');
  assert.equal(stale.players.you.hand.includes(stale.candy), true);
  assert.equal(stale.players.you.hand.includes(stale.dragonite), true);
  assert.equal(stale.players.you.discard.length, 0);

  const failing = makeHarness();
  failing.basic.energy = [{ id: 'attached', name: 'Lightning Energy' }];
  failing.basic.damage = 30;
  const before = JSON.stringify(failing.context.testGame().players.you);
  failing.context.insertEvolution = async (side, target, evolution) => {
    failing.context.player(side).hand.splice(failing.context.player(side).hand.indexOf(evolution), 1);
    target.damage = 999;
    return false;
  };
  assert.equal(await failing.context.resolveBuiltInItem(failing.candy, 'you'), false);
  assert.deepEqual(JSON.parse(JSON.stringify(failing.context.testGame().players.you)), JSON.parse(before));
});

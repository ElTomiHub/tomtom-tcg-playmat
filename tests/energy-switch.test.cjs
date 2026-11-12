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
const effectText = 'Move a Basic Energy from 1 of your Pokémon to another of your Pokémon.';
const cleanCardKey = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[’‘]/g, "'").replace(/[-‐‑–—]/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
const normalizeCollectorNumber = value => { const raw = String(value || '').trim().toUpperCase().split('/')[0].replace(/\s+/g, ''); const m = raw.match(/^0*(\d+)([A-Z]?)$/); return m ? `${Number(m[1])}${m[2]}` : raw; };

function energy(id, name, category = 'Energy') { return { id, name, meta: { category, energyType: name.replace(/ Energy/i, '') } }; }
function pokemon(id, name, attacks = []) { return { id, name, meta: { category: 'Pokemon', stage: 'Basic', hp: 100, types: ['Colorless'], attacks }, energy: [], tools: [], conditions: [], damage: 0, evolutionStack: [] }; }
function energySwitchCard({ setCode = 'MEG', cardNumber = '115', text = effectText, language = 'en' } = {}) {
  return { id: 'energy-switch-meg115', name: 'Energy Switch', setCode, cardNumber, language, meta: { category: 'Trainer', trainerType: 'Item', effect: text } };
}
function makeHarness({ side = 'you', sourceEnergy = [energy('basic-lightning', 'Lightning Energy')], benchCount = 1, energyChoice = 'auto', sourceChoice = 'active', targetChoice = null, localAiEnabled = false, print = {} } = {}) {
  const active = pokemon('active', 'Active Pokémon'), bench = Array.from({ length: benchCount }, (_, i) => pokemon(`bench-${i + 1}`, `Bench Pokémon ${i + 1}`));
  active.energy = sourceEnergy;
  const card = energySwitchCard(print);
  const players = {
    you: { name: 'You', active: null, bench: [], hand: [], deck: [], discard: [], lost: [], prizes: [], turnsTaken: 1, energyAttachedThisTurn: false },
    codex: { name: 'Codex', active: null, bench: [], hand: [], deck: [], discard: [], lost: [], prizes: [], turnsTaken: 1, energyAttachedThisTurn: false }
  };
  const p = players[side]; p.active = active; p.bench = bench; p.hand = [card];
  const context = vm.createContext({
    players, player: current => players[current], oppositeSide: current => current === 'you' ? 'codex' : 'you',
    game: { phase: 'play', turn: side, firstPlayer: side, turnNumber: 3, damageBonuses: [], stadium: null, log: [], players },
    controlSide: side, selected: { side, zone: 'hand', id: card.id }, localAiEnabled, effectResolutionPending: false, deckStats: {},
    activeCardChoice: null, activeCardChoiceResolver: null, activeBoardChoice: null, activeBoardChoiceResolver: null,
    registeredCards: [], logs: [], toasts: [], statEvents: [], window: { __POKEMON_TCG_TEST__: true }, Math, Number, Set, Map, Error, console,
    cleanCardKey, normalizeCollectorNumber,
    logEvent: message => context.logs.push(message), showToast: message => context.toasts.push(message), render: () => {}, persistDeckStats: () => true, scheduleLocalAiTurn: () => {},
    recordDeckCardStat: (...args) => context.statEvents.push(args), isDoubleDragonEnergyCard: () => false,
    hasVerifiedCardData: () => true, hasWildGrowthFor: () => false, imageFor: () => '', escapeHtml: value => String(value),
    $: () => ({ textContent: '', hidden: true, classList: { add() {}, remove() {} }, setAttribute() {}, querySelectorAll: () => [] })
  });
  vm.runInContext('let engineTestHooks = null;', context);
  vm.runInContext(html.slice(registryStart, registryEnd), context);
  for (const name of ['installEngineTestHooks', 'engineTestChoice', 'normalizeScriptedCards', 'matchEffectRule', 'itemEffectRuleFor', 'effectHandlerIsImplemented', 'cardEffectIsSafelyImplemented', 'effectSupportFor', 'effectResolutionFor', 'resolveTransferAttachedEnergyOperation', 'choosePokemonOnBoard', 'chooseCardsInApp', 'pickEffectCard', 'canPlayTrainerEffect', 'resolveBuiltInItem', 'removeCardFromHand', 'consumeResolvedItem', 'playTrainerSelected', 'isBasicEnergy', 'transferAttachedBasicEnergy', 'snapshotResolutionState', 'restoreResolutionState', 'runResolutionTransaction', 'runEffectTransaction', 'normalizedEnergyType', 'basicEnergyHasType', 'energyUnitsForPokemon', 'retreatEnergyUnits', 'retreatPaymentCards', 'canPayAttack', 'attachSelected']) vm.runInContext(engineFunction(name), context);
  vm.runInContext('globalThis.testGame = () => game; player = side => game.players[side];', context);
  context.installEngineTestHooks({ choose: ({ kind, title, candidates }) => kind === 'cards' ? (energyChoice === 'auto' ? candidates[0]?.id : energyChoice) : title.includes('move Basic Energy from') ? sourceChoice : targetChoice });
  return { context, players, p, active, bench, card, side };
}

async function resolve(h) { return h.context.resolveBuiltInItem(h.card, h.side); }

test('MEG 115 exact print and complete effect are automated; other Energy Switch printings are not', () => {
  const h = makeHarness();
  assert.equal(h.context.itemEffectRuleFor(h.card).effect.operation, 'transferAttachedEnergy');
  assert.ok(h.context.registeredOperationFor(h.context.itemEffectRuleFor(h.card).effect));
  assert.equal(h.context.effectSupportFor(h.card), 'automatic');
  assert.equal(h.context.effectResolutionFor(h.card).key, 'automated');
  assert.equal(h.context.registeredOperationFor({ ...h.context.itemEffectRuleFor(h.card).effect, preserveIdentity: false }), null);
  const missingLanguage = energySwitchCard(); delete missingLanguage.language;
  assert.equal(h.context.itemEffectRuleFor(missingLanguage), null);
  for (const wrong of [energySwitchCard({ setCode: 'SVI', cardNumber: '173' }), energySwitchCard({ text: `${effectText} Draw a card.` })]) {
    assert.equal(h.context.itemEffectRuleFor(wrong), null);
    assert.notEqual(h.context.effectSupportFor(wrong), 'automatic');
  }
});

test('Energy Switch transfers the selected Basic Energy object to a different Pokémon and preserves its identity/type', async () => {
  const lightning = energy('lightning', 'Lightning Energy'), water = energy('water', 'Water Energy');
  const h = makeHarness({ sourceEnergy: [lightning, water], energyChoice: 'active:water', targetChoice: 'bench-1' });
  h.active.damage = 30; h.active.tools = [{ id: 'tool' }]; h.active.conditions = ['poisoned']; h.active.evolutionStack = [{ name: 'Dratini' }];
  h.bench[0].damage = 20; h.bench[0].tools = [{ id: 'bench-tool' }]; h.bench[0].evolutionStack = [{ name: 'Other Basic' }];
  assert.equal(h.context.canPlayTrainerEffect(h.card, h.side), true);
  assert.equal(await h.context.playTrainerSelected(), undefined);
  assert.deepEqual(Array.from(h.active.energy, item => item.id), ['lightning']);
  assert.equal(h.bench[0].energy[0], water);
  assert.equal(h.bench[0].energy[0].meta.energyType, 'Water');
  assert.equal(h.active.damage, 30); assert.equal(h.active.tools[0].id, 'tool');
  assert.deepEqual(Array.from(h.active.conditions), ['poisoned']);
  assert.deepEqual(Array.from(h.active.evolutionStack, item => item.name), ['Dratini']);
  assert.equal(h.bench[0].damage, 20); assert.equal(h.bench[0].tools[0].id, 'bench-tool');
  assert.deepEqual(Array.from(h.bench[0].evolutionStack, item => item.name), ['Other Basic']);
  assert.deepEqual(Array.from(h.p.discard, item => item.id), ['energy-switch-meg115']);
});

test('source and destination must be different Pokémon; the active and any Benched Pokémon are otherwise valid', async () => {
  const h = makeHarness({ targetChoice: 'active' });
  assert.equal(await resolve(h), false);
  assert.equal(h.active.energy.length, 1);
  assert.equal(h.bench[0].energy.length, 0);
  const fromBench = makeHarness({ targetChoice: 'active' });
  const benchEnergy = energy('bench-energy', 'Fire Energy'); fromBench.bench[0].energy.push(benchEnergy);
  fromBench.context.installEngineTestHooks({ choose: ({ kind, title, candidates }) => kind === 'cards' ? candidates.find(item => item.sourcePokemon.id === 'bench-1')?.id : title.includes('move Basic Energy from') ? 'bench-1' : 'active' });
  assert.equal(await resolve(fromBench), true);
  assert.equal(fromBench.bench[0].energy.includes(benchEnergy), false);
  assert.equal(fromBench.p.active.energy.includes(benchEnergy), true);
});

test('no attached Basic Energy, no legal source, or no different destination prevents playing the card', async () => {
  for (const sourceEnergy of [[], [energy('special', 'Double Dragon Energy')]]) {
    const h = makeHarness({ sourceEnergy });
    assert.equal(h.context.canPlayTrainerEffect(h.card, h.side), false);
    assert.equal(await h.context.playTrainerSelected(), undefined);
    assert.equal(h.p.hand.includes(h.card), true);
  }
  const onePokemon = makeHarness({ benchCount: 0 });
  assert.equal(onePokemon.context.canPlayTrainerEffect(onePokemon.card, onePokemon.side), false);
});

test('invalid or cancelled Energy/source/destination choices do not move Energy or consume the Item', async () => {
  for (const [energyChoice, targetChoice] of [[null, 'bench-1'], ['not-an-attached-card', 'bench-1'], ['active:basic-lightning', null], ['active:basic-lightning', 'not-a-pokemon']]) {
    const h = makeHarness({ energyChoice, targetChoice });
    const originalEnergy = h.active.energy[0];
    const success = await resolve(h);
    assert.equal(success, false);
    assert.equal(h.active.energy[0], originalEnergy);
    assert.equal(h.bench[0].energy.length, 0);
    assert.equal(h.p.hand.includes(h.card), true);
    assert.equal(h.p.discard.length, 0);
  }
});

test('human and AI use the same transfer handler and AI transfers only to a legal other Pokémon', async () => {
  const human = makeHarness({ targetChoice: 'bench-1' });
  const humanEnergy = human.active.energy[0];
  assert.equal(await resolve(human), true);
  assert.equal(human.bench[0].energy[0], humanEnergy);
  const ai = makeHarness({ side: 'codex', localAiEnabled: true }); ai.context.installEngineTestHooks({});
  const energyCard = ai.active.energy[0];
  assert.equal(await resolve(ai), true);
  assert.equal(ai.p.active.energy.includes(energyCard), false);
  assert.equal(ai.p.bench[0].energy[0], energyCard);
});

test('transfer revalidates stale source, Energy, and destination before mutating either Energy array', async () => {
  const h = makeHarness({ targetChoice: 'bench-1' }), energyCard = h.active.energy[0];
  h.context.installEngineTestHooks({ choose: ({ kind, title, candidates }) => {
    if (title.includes('move Basic Energy from')) return 'active';
    if (kind === 'cards') return candidates[0].id;
    h.p.bench = [];
    return 'bench-1';
  } });
  assert.equal(await resolve(h), false);
  assert.equal(h.bench[0].energy.length, 0);
  assert.equal(h.active.energy[0], energyCard);
  assert.equal(h.p.discard.length, 0);
  assert.equal(h.p.hand.includes(h.card), true);
  const staleEnergy = makeHarness({ targetChoice: 'bench-1' }), detached = staleEnergy.active.energy[0];
  staleEnergy.context.installEngineTestHooks({ choose: ({ kind, title, candidates }) => {
    if (title.includes('move Basic Energy from')) return 'active';
    if (kind === 'cards') return candidates[0].id;
    staleEnergy.active.energy.splice(0, 1);
    return 'bench-1';
  } });
  assert.equal(await resolve(staleEnergy), false);
  assert.equal(staleEnergy.bench[0].energy.length, 0);
  assert.equal(staleEnergy.p.discard.length, 0);
  assert.equal(staleEnergy.p.hand.includes(staleEnergy.card), true);
  assert.equal(staleEnergy.active.energy.includes(detached), false, 'the Energy was removed externally during the prompt and is not duplicated by resolution');
});

test('shared effect transaction rolls back partial mutations on false result or exception', async () => {
  for (const failure of ['false', 'throw']) {
    const h = makeHarness();
    const snapshot = JSON.stringify(h.context.testGame());
    assert.equal(await h.context.runResolutionTransaction(async () => {
      h.context.testGame().players.you.active.damage = 40;
      h.context.testGame().log.push('partial');
      if (failure === 'throw') throw new Error('resolver error');
      return false;
    }, { label: 'test Item' }), false);
    const restored = JSON.parse(JSON.stringify(h.context.testGame()));
    restored.log.pop();
    assert.deepEqual(restored, JSON.parse(snapshot));
    assert.equal(h.context.player(h.side).active.damage, 0);
    assert.equal(h.context.testGame().log.includes('partial'), false);
  }
});

test('Energy Switch transaction consumes the Item only on success and rolls back partial execution failure', async () => {
  const h = makeHarness({ targetChoice: 'bench-1' }), energyCard = h.active.energy[0];
  const transfer = h.context.transferAttachedBasicEnergy;
  h.context.transferAttachedBasicEnergy = (side, source, energy, destination) => { source.energy.splice(0, 1); destination.energy.push(energy); return false; };
  assert.equal(await resolve(h), false);
  assert.equal(h.context.player(h.side).hand.some(card => card.id === h.card.id), true);
  assert.equal(h.context.player(h.side).discard.some(card => card.id === h.card.id), false);
  assert.equal(h.context.player(h.side).active.energy.length, 1);
  assert.equal(h.context.player(h.side).bench[0].energy.length, 0);
  h.context.transferAttachedBasicEnergy = transfer;
  assert.equal(await resolve(h), true);
  const current = h.context.player(h.side);
  assert.equal(current.hand.some(card => card.id === h.card.id), false);
  assert.equal(current.discard.filter(card => card.id === h.card.id).length, 1);
  assert.equal(current.bench[0].energy[0].id, energyCard.id);
});

test('existing Energy attachment, attack payment, and retreat payment still recognize transferred Basic Energy', async () => {
  const h = makeHarness({ targetChoice: 'bench-1' });
  const lightning = h.active.energy[0];
  assert.equal(await resolve(h), true);
  const recipient = h.bench[0];
  const attack = { cost: ['Lightning'] };
  assert.equal(h.context.canPayAttack(recipient, attack), true);
  assert.deepEqual(Array.from(h.context.retreatPaymentCards(recipient, 1)), [lightning]);
  const additional = energy('additional', 'Water Energy'); h.p.hand.push(additional);
  h.context.controlSide = h.side; h.context.selected = { side: h.side, zone: 'hand', id: additional.id };
  h.context.attachSelected(recipient.id);
  assert.equal(recipient.energy.includes(additional), true);
  assert.equal(h.context.canPayAttack(recipient, { cost: ['Water'] }), true);
});

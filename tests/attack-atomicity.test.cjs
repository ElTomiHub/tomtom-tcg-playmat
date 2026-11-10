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

const definitions = {
  power: { attackName: 'Power Burn', effectTextExact: 'Discard 1 Energy from this Pokémon.', effect: { type: 'discard_attached_energy', count: 1 } },
  target: { attackName: 'Bench Shot', effectTextExact: 'Choose 1 of your opponent’s Pokémon. This attack does 20 damage to that Pokémon.', effect: { type: 'selected_opponent_damage', amount: 20, benchIgnoresModifiers: true } },
  search: { attackName: 'Energy Search', effectTextExact: 'Search your deck for a Basic Energy card and put it into your hand.', effect: { type: 'search_basic_energy' } },
  lock: { attackName: 'Overload', effectTextExact: 'During your next turn, this Pokémon can’t attack.', effect: { type: 'attack_lock_next_turn' } },
  return: { attackName: 'Self Return', effectTextExact: 'Put this Pokémon and all attached cards into your hand.', effect: { type: 'return_attacker_to_hand' } }
};

function makeHarness({ side = 'you', targetSelection, pickResult, prizes = 6, activeHp = 100, benchHp = 100 } = {}) {
  const attackByName = Object.values(definitions).find(item => item.attackName === targetSelection?.attackName);
  const attacker = pokemon('attacker', 0, 200, side === 'codex' ? 'Codex attacker' : 'Your attacker');
  const defendingSide = side === 'you' ? 'codex' : 'you';
  const defenderActive = pokemon('def-active', 0, activeHp, 'Defending active');
  const defenderBench = pokemon('def-bench', 0, benchHp, 'Defending bench');
  const players = {
    you: makePlayer('You', side === 'you' ? attacker : defenderActive, side === 'you' ? [pokemon('ally', 0, 100, 'Ally')] : [defenderBench], side === 'you' ? prizes : 6),
    codex: makePlayer('Codex', side === 'codex' ? attacker : defenderActive, side === 'codex' ? [pokemon('ally-ai', 0, 100, 'AI ally')] : [defenderBench], side === 'codex' ? prizes : 6)
  };
  const game = { phase: 'play', winner: null, turn: side, firstPlayer: side, turnNumber: 3, log: [], players, pendingPromotion: null, pendingPromotionAfter: null, pendingAttackTurn: null, growlReduction: null, damageBonuses: [] };
  const effects = [];
  const deckStats = {};
  let endTurnCount = 0;
  let context;
  const currentGame = () => context?.game || game;
  context = vm.createContext({
    game, players, deckStats, effects,
    attackResolutionPending: false,
    controlSide: side, selected: null,
    localAiEnabled: false, localAiTimer: null,
    targetSelection: targetSelection?.target || (defendering(players, side).active),
    pickResult,
    player: currentSide => currentGame().players[currentSide],
    oppositeSide: currentSide => currentSide === 'you' ? 'codex' : 'you',
    cleanCardKey: value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[’‘]/g, "'").replace(/[-‐‑–—]/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' '),
    normalizeCollectorNumber: value => { const raw = String(value || '').trim().toUpperCase().split('/')[0].replace(/\s+/g, ''); const match = raw.match(/^0*(\d+)([A-Z]?)$/); return match ? `${Number(match[1])}${match[2]}` : raw; },
    isBasicEnergy: name => /^Lightning Energy$/i.test(name),
    normalizedEnergyType: value => String(value || '').toLowerCase(),
    isDoubleDragonEnergyCard: () => false,
    hasCondition: () => false,
    effectivePokemonHp: card => Number(card?.meta?.hp || 0),
    matchDamageModifier: () => null,
    abilityEffectRuleFor: () => null,
    toolEffectRuleFor: () => null,
    normalizePokemonStage: value => String(value || '').toLowerCase(),
    resolveExpShare: async () => {},
    prizeCountFor: () => 1,
    finishMatch: (winner, reason) => { currentGame().phase = 'finished'; currentGame().winner = winner; currentGame().reason = reason; },
    promoteCodexAfterKnockout: () => { const codex = currentGame().players.codex; if (codex.bench.length) codex.active = codex.bench.shift(); },
    logEvent: message => currentGame().log.push(message),
    recordDeckCardStat: () => {},
    persistDeckStats: () => true,
    render: () => {},
    $: () => ({ textContent: '' }),
    scheduleLocalAiTurn: () => {},
    showToast: message => { effects.push(`toast:${message}`); },
    scheduleLocalAiTurn: () => {},
    clearTimeout: () => {},
    endTurn: async () => { endTurnCount++; currentGame().turn = currentGame().turn === 'you' ? 'codex' : 'you'; currentGame().turnNumber++; return true; },
    resolveAttackDamage: (currentSide, pokemonCard, attack) => Number(String(attack.damage || '').match(/^\d+/)?.[0] || 0),
    shuffled: cards => cards,
    selectedOpponentPokemonForAttack: async () => context.targetSelection,
    canUseAttack: () => true,
    playableAttacks: (currentSide, allowManual) => {
      if (currentSide !== side || currentGame().turn !== currentSide || currentGame().players[currentSide].active.attackedThisTurn) return [];
      return attacker.meta.attacks.map((attack, index) => ({ attack, index, damage: Number(String(attack.damage || '').match(/^\d+/)?.[0] || 0), manual: false }));
    },
    pickEffectCard: async (currentSide, message, choices) => context.pickResult === undefined ? choices[0] || null : context.pickResult,
    pickEffectCards: async () => [],
    pickEffectCardsUpTo: async (currentSide, message, choices) => choices,
    choosePokemonOnBoard: async (currentSide, message, choices) => choices[0] || null,
    window: { prompt: () => '1' },
    showToast: message => effects.push(`toast:${message}`)
  });
  vm.runInContext(html.slice(registryStart, registryEnd) + '\nglobalThis.registry = CARD_EFFECT_REGISTRY;', context);
  for (const entry of Object.values(definitions)) context.registry.attacks.push({ cardName: 'testmon', setCode: 'TST', cardNumber: '1', ...entry });
  const functionNames = [
    'matchEffectRule', 'effectHandlerIsImplemented', 'attackEffectRuleFor', 'attackBaseDamage', 'attackEffectChoiceCount',
    'attackChoicesAreValid', 'snapshotResolutionState', 'restoreResolutionState', 'runResolutionTransaction', 'snapshotAttackState', 'restoreAttackState', 'runAttackTransaction',
    'resolveAttackEffect', 'recordAttackDamageKnockout', 'resolveKnockout', 'resolveBenchKnockout', 'calculateAttackDamageModifiers', 'applyDamageToPokemon',
    'performAttackResolution', 'useAttack', 'pokemonAbilitiesSuppressed', 'livePokemonAbilities', 'pokemonAbilityEffectType'
  ];
  for (const name of functionNames) vm.runInContext(engineFunction(name), context);
  context.endTurnCount = () => endTurnCount;
  return { context, game, players, attacker, defender: players[defendingSide], defenderActive, defenderBench, effects, currentGame };
}

function pokemon(id, damage, hp, name) {
  return { id, name, meta: { hp, types: ['Lightning'], stage: 'Basic', weaknesses: [], resistances: [], abilities: [], rules: [], attacks: [] }, damage, energy: [], tools: [], evolutionStack: [], conditions: [] };
}
function makePlayer(name, active, bench, prizeCount) {
  return { name, active, bench, hand: [], deck: [], discard: [], prizes: Array.from({ length: prizeCount }, (_, i) => ({ id: `${name}-prize-${i}` })), turnsTaken: 1, attackedThisTurn: false, energyAttachedThisTurn: true, retreatedThisTurn: false };
}
function defendering(players, side) { return players[side === 'you' ? 'codex' : 'you']; }
function setAttack(attacker, key, damage = '') {
  const definition = definitions[key];
  attacker.name = 'Testmon'; attacker.setCode = 'TST'; attacker.cardNumber = '1';
  attacker.meta.attacks = [{ name: definition?.attackName || 'Basic Strike', cost: [], damage, effect: definition?.effectTextExact || '', effectTextStatus: definition?.effectTextExact ? 'present' : 'explicit-empty' }];
  return attacker.meta.attacks[0];
}

test('basic human and AI attacks apply damage and end the acting turn once', async () => {
  for (const side of ['you', 'codex']) {
    const h = makeHarness({ side }); setAttack(h.attacker, 'none', '20');
    assert.equal(await h.context.useAttack(side, 0), true);
    assert.equal(h.defender.active.damage, 20);
    assert.equal(h.context.player(side).attackedThisTurn, true);
    assert.equal(h.context.endTurnCount(), 1);
  }
});

test('supported additional effect resolves and attack cost discard commits with damage', async () => {
  const h = makeHarness(); setAttack(h.attacker, 'power', '30');
  const energy = { id: 'cost-energy', name: 'Lightning Energy' }; h.attacker.energy.push(energy);
  assert.equal(await h.context.useAttack('you', 0, [energy.id]), true);
  assert.equal(h.defender.active.damage, 30);
  assert.equal(h.attacker.energy.length, 0);
  assert.deepEqual(h.players.you.discard.map(card => card.id), [energy.id]);
  assert.equal(h.context.endTurnCount(), 1);
});

test('attack requiring target selection damages the chosen Benched Pokémon', async () => {
  const h = makeHarness({ targetSelection: { target: null } }); setAttack(h.attacker, 'target', '');
  h.context.targetSelection = h.defender.bench[0];
  assert.equal(await h.context.useAttack('you', 0), true);
  assert.equal(h.defender.bench[0].damage, 20);
  assert.equal(h.defender.active.damage, 0);
});

test('attack requiring a card selection searches and adds that card to hand', async () => {
  const h = makeHarness(); setAttack(h.attacker, 'search', '');
  const energy = { id: 'deck-energy', name: 'Lightning Energy', meta: { category: 'Energy', energyType: 'Lightning' } };
  h.players.you.deck.push(energy); h.context.pickResult = energy;
  assert.equal(await h.context.useAttack('you', 0), true);
  assert.equal(h.players.you.deck.length, 0);
  assert.equal(h.players.you.hand[0].id, energy.id);
});

test('cancelled and invalid target selection leave the attack unused and state untouched', async () => {
  const cancelled = makeHarness(); setAttack(cancelled.attacker, 'target', '');
  cancelled.context.targetSelection = null;
  assert.equal(await cancelled.context.useAttack('you', 0), false);
  assert.equal(cancelled.defender.active.damage, 0);
  assert.equal(cancelled.context.player('you').attackedThisTurn, false);
  assert.equal(cancelled.context.endTurnCount(), 0);

  const invalid = makeHarness(); setAttack(invalid.attacker, 'target', '');
  invalid.context.targetSelection = { id: 'not-on-board', name: 'Invalid target' };
  assert.equal(await invalid.context.useAttack('you', 0), false);
  assert.equal(invalid.defender.active.damage, 0);
  assert.equal(invalid.context.player('you').attackedThisTurn, false);
  assert.equal(invalid.context.endTurnCount(), 0);
});

test('an asynchronous target prompt blocks a duplicate attack until it resolves', async () => {
  const h = makeHarness(); setAttack(h.attacker, 'target', '');
  let chooseTarget;
  h.context.targetSelection = new Promise(resolve => { chooseTarget = resolve; });
  const first = h.context.useAttack('you', 0);
  await Promise.resolve();
  assert.equal(await h.context.useAttack('you', 0), false);
  chooseTarget(h.defender.bench[0]);
  assert.equal(await first, true);
  assert.equal(h.defender.bench[0].damage, 20);
  assert.equal(h.context.endTurnCount(), 1);
});

test('failed resolver rolls back damage, discarded cards, logs and attack state', async () => {
  const h = makeHarness(); setAttack(h.attacker, 'power', '30');
  h.attacker.energy.push({ id: 'energy', name: 'Lightning Energy' });
  h.context.resolveAttackEffect = async (side, pokemonCard) => {
    pokemonCard.energy.pop(); h.players.you.discard.push({ id: 'partial' }); h.defender.active.damage = 70; h.game.log.push('partial resolver log'); return false;
  };
  const beforeLog = h.game.log.slice();
  assert.equal(await h.context.useAttack('you', 0, ['energy']), false);
  assert.equal(h.context.player('codex').active.damage, 0);
  assert.deepEqual(Array.from(h.context.player('you').active.energy, card => card.id), ['energy']);
  assert.deepEqual(Array.from(h.context.player('you').discard), []);
  assert.equal(h.context.player('you').attackedThisTurn, false);
  assert.equal(h.context.endTurnCount(), 0);
  assert.deepEqual(Array.from(h.context.game.log.slice(0, beforeLog.length)), beforeLog);
});

test('Active and Benched Knockouts from attacks preserve prize ownership and final-Prize wins', async () => {
  const active = makeHarness({ activeHp: 20, prizes: 2 }); setAttack(active.attacker, 'none', '20');
  assert.equal(await active.context.useAttack('you', 0), true);
  assert.equal(active.players.you.hand.filter(card => card.id.startsWith('You-prize')).length, 1);
  assert.equal(active.players.codex.hand.filter(card => card.id.startsWith('Codex-prize')).length, 0);
  assert.equal(active.defender.active.name, 'Defending bench');
  assert.equal(active.context.endTurnCount(), 1);

  const bench = makeHarness({ benchHp: 20, prizes: 2 }); setAttack(bench.attacker, 'target', '');
  bench.context.targetSelection = bench.defender.bench[0];
  assert.equal(await bench.context.useAttack('you', 0), true);
  assert.equal(bench.players.you.hand.filter(card => card.id.startsWith('You-prize')).length, 1);
  assert.equal(bench.defender.bench.length, 0);

  const finalPrize = makeHarness({ activeHp: 20, prizes: 1 }); setAttack(finalPrize.attacker, 'none', '20');
  assert.equal(await finalPrize.context.useAttack('you', 0), true);
  assert.equal(finalPrize.game.phase, 'finished');
  assert.equal(finalPrize.game.winner, 'you');
  assert.equal(finalPrize.context.endTurnCount(), 0);
});

test('turn-ending attack effect resolves before one turn handoff', async () => {
  const h = makeHarness(); setAttack(h.attacker, 'lock', '10');
  assert.equal(await h.context.useAttack('you', 0), true);
  assert.equal(h.attacker.cannotAttackUntilTurn, h.game.turnNumber + 1);
  assert.equal(h.context.endTurnCount(), 1);
});

test('attack that removes its attacker waits for promotion, then hands off exactly once', async () => {
  const h = makeHarness(); setAttack(h.attacker, 'return', '10');
  assert.equal(await h.context.useAttack('you', 0), true);
  assert.equal(h.players.you.active, null);
  assert.equal(h.game.pendingPromotion, 'you');
  assert.equal(h.game.pendingAttackTurn, 'you');
  assert.equal(h.context.endTurnCount(), 0);
  h.context.selected = { side: 'you', zone: 'bench', id: h.players.you.bench[0].id };
  vm.runInContext(engineFunction('promoteSelected'), h.context);
  await h.context.promoteSelected();
  assert.equal(h.context.endTurnCount(), 1);
  assert.equal(h.game.pendingAttackTurn, null);
});

test('AI attack uses the same validated and atomic pipeline as a human attack', async () => {
  const h = makeHarness({ side: 'codex' }); setAttack(h.attacker, 'power', '15');
  const energy = { id: 'ai-energy', name: 'Lightning Energy' }; h.attacker.energy.push(energy);
  assert.equal(await h.context.useAttack('codex', 0, [energy.id]), true);
  assert.equal(h.defender.active.damage, 15);
  assert.equal(h.attacker.energy.length, 0);
  assert.equal(h.context.endTurnCount(), 1);
});

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
const cleanCardKey = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[’‘]/g, "'").replace(/[-‐‑–—]/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
const normalizeCollectorNumber = value => { const raw = String(value || '').trim().toUpperCase().split('/')[0].replace(/\s+/g, ''); const match = raw.match(/^0*(\d+)([A-Z]?)$/); return match ? `${Number(match[1])}${match[2]}` : raw; };
const doubleDragonText = 'This card can only be attached to Dragon Pokémon. This card provides every type of Energy, but provides only 2 Energy at a time, only while this card is attached to a Dragon Pokémon. (If this card is attached to anything other than a Dragon Pokémon, discard this card.)';

function makeContext() {
  const players = {
    you: { name: 'You', active: null, bench: [], hand: [], discard: [], deck: [], energyAttachedThisTurn: false },
    codex: { name: 'Codex', active: null, bench: [], hand: [], discard: [], deck: [], energyAttachedThisTurn: false }
  };
  const context = vm.createContext({
    players, player: side => players[side], oppositeSide: side => side === 'you' ? 'codex' : 'you',
    game: { phase: 'play', turn: 'you', turnNumber: 2, damageBonuses: [], growlReduction: null }, selected: null, controlSide: 'you',
    registeredCards: [], localAiEnabled: false, logs: [], toasts: [], randoms: [true],
    cleanCardKey, normalizeCollectorNumber,
    normalizeCategory: value => /^pokemon/i.test(value) ? 'Pokemon' : /^trainer/i.test(value) ? 'Trainer' : /^energy/i.test(value) ? 'Energy' : 'Unknown',
    isBasicEnergy: name => /^(basic\s+)?(grass|fire|water|lightning|psychic|fighting|darkness|metal|fairy|colorless)(\s+energy)?$/i.test(String(name || '').trim()),
    normalizedEnergyType: value => cleanCardKey(value).replace(/ energy$/, '').replace('electric', 'lightning'),
    logEvent: message => context.logs.push(message), showToast: message => context.toasts.push(message), render: () => {},
    randomCoin: () => context.randoms.shift() ?? true,
    pickEffectCard: async (_side, _message, choices) => choices[0] || null,
    effectivePokemonHp: pokemon => Number(pokemon?.meta?.hp || 0),
    hasCondition: () => false, hasWildGrowthFor: () => false,
    clearGrowlForPokemon: () => {}, clearPokemonConditions: pokemon => { pokemon.conditions = []; },
    recordDeckCardStat: () => {}, hasVerifiedCardData: () => true,
    sideForPokemon: pokemon => players.you.active?.id === pokemon?.id || players.you.bench.some(item => item.id === pokemon?.id) ? 'you' : 'codex',
    crypto: { getRandomValues: array => array }
  });
  vm.runInContext(html.slice(registryStart, registryEnd) + '\nglobalThis.registry = CARD_EFFECT_REGISTRY;', context);
  const functions = [
    'saveCardMetadata', 'repairBasicEnergyType', 'matchEffectRule', 'itemEffectRuleFor', 'toolEffectRuleFor', 'abilityEffectRuleFor',
    'isDoubleDragonEnergy', 'isDoubleDragonEnergyCard', 'hasCompleteAttackEffectMetadata', 'effectHandlerIsImplemented', 'effectSupportFor', 'effectResolutionFor',
    'verifiedEffectFreeAttack', 'attackEffectRuleFor', 'attackBaseDamage', 'attackDamageValue', 'attackDamageBonusBeforeWeakness',
    'calculateAttackDamageBeforeModifiers', 'resolveAttackDamage', 'canUseAttack', 'resolveBuiltInItem', 'resolveGustOpponent', 'energyUnitsForPokemon',
    'basicEnergyHasType', 'retreatEnergyUnits', 'retreatPaymentCards', 'canPayAttack', 'removeCardFromHand', 'attachSelected', 'insertEvolution',
    'verifiedWaterPrintFor', 'waterPrintMetadataComplete'
  ];
  for (const name of functions) vm.runInContext(engineFunction(name), context);
  context.resolveOnEvolveAbilities = () => {};
  return context;
}

function doubleDragon(overrides = {}) {
  return { id: 'dde', name: 'Double Dragon Energy', setCode: 'ROS', cardNumber: '97', language: 'en', meta: { category: 'Energy', energyType: 'Special', effect: doubleDragonText }, ...overrides };
}
function pokemon(id, name, types, abilities = []) {
  return { id, name, meta: { category: 'Pokemon', hp: 100, stage: 'Basic', types, abilities, attacks: [] }, energy: [], tools: [], conditions: [], damage: 0 };
}

test('metadata saving preserves absent attack text separately from explicitly empty text', () => {
  const context = makeContext();
  const absent = { name: 'No effect field', cost: [], damage: 20 };
  const explicit = { name: 'Explicitly no extra effect', cost: [], damage: 20, effect: '' };
  const cardA = { name: 'Testmon', setCode: 'TST', cardNumber: '1' };
  const cardB = { name: 'Testmon', setCode: 'TST', cardNumber: '2' };
  const cardC = { name: 'Testmon', setCode: 'TST', cardNumber: '3' };
  context.saveCardMetadata(cardA, { category: 'Pokémon', attacks: [absent] });
  context.saveCardMetadata(cardB, { category: 'Pokémon', attacks: [explicit] });
  context.saveCardMetadata(cardC, { category: 'Pokémon' });
  assert.equal(cardA.meta.attackMetadataStatus, 'present');
  assert.equal(cardC.meta.attackMetadataStatus, 'missing');
  assert.equal(cardA.meta.attacks[0].effect, null);
  assert.equal(cardA.meta.attacks[0].effectTextStatus, 'missing');
  assert.equal(cardB.meta.attacks[0].effect, '');
  assert.equal(cardB.meta.attacks[0].effectTextStatus, 'explicit-empty');
});

test('missing or legacy empty attack text stays manual; explicitly effect-free attacks remain automated', () => {
  const context = makeContext();
  const card = { name: 'Plainmon', setCode: 'TST', cardNumber: '1', meta: { category: 'Pokemon', hp: 90, stage: 'Basic', types: ['Colorless'], abilities: [], rules: [], attackMetadataStatus: 'present', attacks: [] } };
  const missing = { name: 'Strike', damage: 20, effect: null, effectTextStatus: 'missing' };
  const legacyBlank = { name: 'Strike', damage: 20, effect: '' };
  const explicit = { name: 'Strike', damage: 20, effect: '', effectTextStatus: 'explicit-empty' };
  assert.equal(context.attackEffectRuleFor(card, missing), null);
  assert.equal(context.attackEffectRuleFor(card, legacyBlank), null);
  assert.equal(context.attackDamageValue(missing, card), null);
  assert.equal(context.attackEffectRuleFor(card, explicit).effect.type, 'none');
  assert.equal(context.attackDamageValue(explicit, card), 20);
  card.meta.attacks = [missing];
  context.players.you.active = card; context.players.codex.active = pokemon('target', 'Target', ['water']);
  assert.equal(context.effectSupportFor(card), 'manual');
  assert.equal(context.effectResolutionFor(card).key, 'unresolved');
  assert.equal(context.canUseAttack(card, missing, false), false);
  assert.equal(context.canUseAttack(card, missing, true), false, 'manual mode cannot bypass missing attack effect verification');
  const legacyWithText = { ...card, meta: { ...card.meta, attackMetadataStatus: undefined, attacks: [{ name: 'Texted Strike', damage: 20, effect: 'Discard an Energy from this Pokémon.' }] } };
  assert.equal(context.hasCompleteAttackEffectMetadata(legacyWithText), true);
  assert.equal(context.effectSupportFor(legacyWithText), 'manual');
  card.meta.attacks = [explicit];
  card.meta.attacks[0].effectTextStatus = 'explicit-empty';
  assert.equal(context.effectSupportFor(card), 'automatic');
  assert.equal(context.effectResolutionFor(card).key, 'automated');
});

test('Pokémon Catcher exact printing flips and actually gusts, while tails changes nothing', async () => {
  const context = makeContext(), players = context.players;
  const active = pokemon('active', 'Front Pokémon', ['water']), bench = pokemon('bench', 'Bench Pokémon', ['fire']);
  players.codex.active = active; players.codex.bench = [bench];
  const catcher = { name: 'Pokémon Catcher', setCode: 'POR', cardNumber: '82', language: 'en', meta: { category: 'Trainer', trainerType: 'Item', effect: "Flip a coin. If heads, switch in 1 of your opponent's Benched Pokémon to the Active Spot." } };
  context.randoms = [true];
  assert.equal(await context.resolveBuiltInItem(catcher, 'you'), true);
  assert.equal(players.codex.active.id, 'bench');
  assert.equal(players.codex.bench[0].id, 'active');
  players.codex.active = active; players.codex.bench = [bench]; context.randoms = [false];
  assert.equal(await context.resolveBuiltInItem(catcher, 'you'), true);
  assert.equal(players.codex.active.id, 'active');
  assert.equal(players.codex.bench[0].id, 'bench');
});

test('same-name Pokémon Catcher from a different printing does not execute its registered effect', async () => {
  const context = makeContext(), players = context.players;
  const active = pokemon('active', 'Front Pokémon', ['water']), bench = pokemon('bench', 'Bench Pokémon', ['fire']);
  players.codex.active = active; players.codex.bench = [bench];
  const wrongPrint = { name: 'Pokémon Catcher', setCode: 'SVI', cardNumber: '187', language: 'en', meta: { category: 'Trainer', trainerType: 'Item', effect: "Flip a coin. If heads, switch in 1 of your opponent's Benched Pokémon to the Active Spot." } };
  assert.equal(context.itemEffectRuleFor(wrongPrint), null);
  assert.equal(await context.resolveBuiltInItem(wrongPrint, 'you'), null);
  assert.equal(players.codex.active.id, 'active');
});

test("Lilligant's exact Sunny Day ability boosts Grass/Fire damage to the opposing Active Pokémon", () => {
  const context = makeContext(), players = context.players;
  const ability = { name: 'Sunny Day', effect: "Attacks used by your {G} Pokémon and {R} Pokémon do 20 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance)." };
  const lilligant = pokemon('lilligant', 'Lilligant', ['grass'], [ability]);
  const attacker = pokemon('attacker', 'Grass attacker', ['grass']);
  const defender = pokemon('defender', 'Defender', ['water']);
  players.you.active = attacker; players.you.bench = [lilligant]; players.codex.active = defender;
  const print = { name: 'Lilligant', setCode: 'JTG', cardNumber: '7', language: 'en', meta: { category: 'Pokemon', abilities: [ability] } };
  lilligant.name = print.name; lilligant.setCode = print.setCode; lilligant.cardNumber = print.cardNumber; lilligant.language = print.language; lilligant.meta.abilities = [ability];
  const attack = { name: 'Basic Strike', damage: 30, effect: '', effectTextStatus: 'explicit-empty' };
  assert.equal(context.abilityEffectRuleFor(print, ability).effect.type, 'boost_grass_fire_attacks');
  assert.equal(context.resolveAttackDamage('you', attacker, attack), 50);
  attacker.meta.types = ['water'];
  assert.equal(context.resolveAttackDamage('you', attacker, attack), 30);
  attacker.meta.types = ['fire'];
  assert.equal(context.resolveAttackDamage('you', attacker, attack), 50);
  assert.equal(context.resolveAttackDamage('you', attacker, attack), 50);
  const benchTarget = pokemon('bench-target', 'Bench defender', ['water']);
  players.codex.bench = [benchTarget];
  assert.equal(context.attackDamageBonusBeforeWeakness('you', attacker, attack, benchTarget), 0);
});

test('verified Double Dragon Energy grants two any-type units, Dragon-only attachment, attack payment, and two retreat units', () => {
  const context = makeContext(), players = context.players, energy = doubleDragon();
  const dragon = pokemon('dragon', 'Dragon Pokémon', ['dragon']);
  const nonDragon = pokemon('other', 'Other Pokémon', ['water']);
  players.you.active = dragon; players.you.hand = [energy];
  context.selected = { side: 'you', zone: 'hand', id: energy.id };
  context.attachSelected(nonDragon.id);
  assert.equal(players.you.hand.length, 1);
  assert.equal(nonDragon.energy.length, 0);
  context.attachSelected(dragon.id);
  assert.equal(players.you.hand.length, 0);
  assert.equal(dragon.energy[0].id, energy.id);
  assert.deepEqual(Array.from(context.energyUnitsForPokemon(energy, dragon)), ['any', 'any']);
  assert.equal(context.canPayAttack(dragon, { cost: ['fire', 'lightning'] }), true);
  assert.deepEqual(Array.from(context.retreatPaymentCards(dragon, 2), card => card.id), ['dde']);
  assert.equal(context.effectResolutionFor(energy).key, 'automated');
});

test('verified Double Dragon Energy is discarded if its Pokémon evolves into a non-Dragon', async () => {
  const context = makeContext(), players = context.players, energy = doubleDragon();
  const oldDragon = pokemon('dratini', 'Dratini', ['dragon']); oldDragon.energy = [energy];
  const evolution = pokemon('non-dragon-evolution', 'Changed Type', ['water']);
  evolution.meta.stage = 'Stage 1'; evolution.meta.evolveFrom = 'Dratini';
  players.you.active = oldDragon; players.you.hand = [evolution];
  assert.equal(await context.insertEvolution('you', oldDragon, evolution), true);
  assert.equal(players.you.active.id, evolution.id);
  assert.equal(players.you.active.energy.length, 0);
  assert.deepEqual(Array.from(players.you.discard, card => card.id), ['dde']);
});

test('unverified or wrong-print Double Dragon Energy name receives no special Energy behavior', () => {
  const context = makeContext();
  const pokemonInPlay = pokemon('dragon', 'Dragon Pokémon', ['dragon']);
  const wrongPrint = doubleDragon({ setCode: 'ZZZ', cardNumber: '97' });
  const noText = doubleDragon({ meta: { category: 'Energy', energyType: 'Special', effect: '' } });
  assert.equal(context.isDoubleDragonEnergyCard(wrongPrint), false);
  assert.equal(context.isDoubleDragonEnergyCard(noText), false);
  assert.deepEqual(Array.from(context.energyUnitsForPokemon(wrongPrint, pokemonInPlay)), []);
  assert.equal(context.canPayAttack({ ...pokemonInPlay, energy: [wrongPrint] }, { cost: ['fire', 'lightning'] }), false);
  assert.equal(context.retreatEnergyUnits(wrongPrint, pokemonInPlay), 1);
  assert.equal(context.effectResolutionFor(wrongPrint).key, 'manual');
  context.players.you.active = pokemon('non-dragon', 'Water Pokémon', ['water']);
  context.players.you.hand = [wrongPrint]; context.selected = { side: 'you', zone: 'hand', id: wrongPrint.id };
  context.attachSelected(context.players.you.active.id);
  assert.equal(context.players.you.active.energy.length, 1);
  assert.equal(context.players.you.energyAttachedThisTurn, true);
  assert.deepEqual(Array.from(context.energyUnitsForPokemon(wrongPrint, context.players.you.active)), []);
  const special = { name: 'Unrelated Special Energy', setCode: 'TST', cardNumber: '5', meta: { category: 'Energy', energyType: 'Special', effect: '' } };
  assert.equal(context.isDoubleDragonEnergyCard(special), false);
  assert.deepEqual(Array.from(context.energyUnitsForPokemon(special, pokemonInPlay)), []);
});

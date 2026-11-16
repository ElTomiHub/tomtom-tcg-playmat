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
assert.ok(registryStart >= 0 && registryEnd > registryStart, 'effect registry source is present');

function createContext() {
  const draws = [], logs = [];
  const context = vm.createContext({
    draws, logs, game: { turnNumber: 1, damageBonuses: [] },
    player: side => ({ name: side, hand: [], discard: [], deck: [], prizes: [] }),
    drawCards: (side, count) => { draws.push([side, count]); return count; },
    logEvent: message => logs.push(message),
    shuffleHandIntoDeck: () => 0,
    isBasicEnergy: name => /^(lightning|water|fire|grass|psychic|fighting|darkness|metal) energy$/i.test(name),
    attackDamageBonusBeforeWeakness: () => 0,
    sideForPokemon: () => 'you',
    cleanCardKey: value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[’‘]/g, "'").replace(/[-‐‑–—]/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' '),
    normalizeCollectorNumber: value => { const raw = String(value || '').trim().toUpperCase().split('/')[0].replace(/\s+/g, ''); const m = raw.match(/^0*(\d+)([A-Z]?)$/); return m ? `${Number(m[1])}${m[2]}` : raw; }
  });
  vm.runInContext(html.slice(registryStart, registryEnd) + '\nglobalThis.registry = CARD_EFFECT_REGISTRY;', context);
  const functions = [
    'matchEffectRule', 'supporterEffectRuleFor', 'itemEffectRuleFor', 'toolEffectRuleFor', 'hasCompleteAttackEffectMetadata',
    'stadiumEffectRuleFor', 'abilityEffectRuleFor', 'isDoubleDragonEnergy',
    'isDoubleDragonEnergyCard', 'supportedPokemonRule', 'effectHandlerIsImplemented', 'effectSupportFor',
    'effectResolutionFor', 'resolveBuiltInSupporter', 'verifiedEffectFreeAttack', 'attackEffectRuleFor',
    'attackBaseDamage', 'attackDamageValue', 'hasVerifiedCardData', 'verifiedWaterPrintFor', 'waterPrintMetadataComplete'
  ];
  for (const name of functions) vm.runInContext(engineFunction(name), context);
  return context;
}

const judge = effect => ({ name: 'Judge', setCode: 'SVI', cardNumber: '176', language: 'en', meta: { category: 'Trainer', trainerType: 'Supporter', effect } });
const judgeText = 'Each player shuffles their hand into their deck and draws 4 cards.';

test('exact supported Judge print and complete text are automated and actually resolve', async () => {
  const ctx = createContext(), card = judge(judgeText);
  assert.equal(ctx.effectSupportFor(card), 'automatic');
  assert.equal(ctx.effectResolutionFor(card).key, 'automated');
  assert.equal(await ctx.resolveBuiltInSupporter(card, 'you'), true);
  assert.deepEqual(ctx.draws, [['you', 4], ['codex', 4]]);
});

test('same name from a different printing is never automatically matched', () => {
  const ctx = createContext(), card = { ...judge(judgeText), setCode: 'PAF', cardNumber: '80' };
  assert.equal(ctx.supporterEffectRuleFor(card), null);
  assert.equal(ctx.effectSupportFor(card), 'manual');
  assert.equal(ctx.effectResolutionFor(card).key, 'manual');
});

test('same print with an added instruction is rejected and does not resolve', async () => {
  const ctx = createContext(), card = judge(`${judgeText} Then discard a card from your hand.`);
  assert.equal(await ctx.resolveBuiltInSupporter(card, 'you'), false);
  assert.deepEqual(ctx.draws, []);
  assert.equal(ctx.effectResolutionFor(card).key, 'manual');
});

test('missing text, changed wording, and mismatched language fail closed', () => {
  const ctx = createContext();
  assert.equal(ctx.supporterEffectRuleFor(judge('')), null);
  assert.equal(ctx.supporterEffectRuleFor(judge('Each player shuffles their cards into their deck and draws four cards.')), null);
  assert.equal(ctx.supporterEffectRuleFor({ ...judge(judgeText), language: 'ja' }), null);
});

test('legacy fragment-only Trainer rules are manual and unsupported Trainer effects do not resolve', async () => {
  const ctx = createContext();
  const card = { name: 'Nemona', setCode: 'SVI', cardNumber: '180', meta: { category: 'Trainer', trainerType: 'Supporter', effect: 'Draw 3 cards. Then shuffle your hand into your deck.' } };
  assert.equal(ctx.supporterEffectRuleFor(card), null);
  assert.equal(ctx.effectResolutionFor(card).key, 'manual');
  assert.equal(await ctx.resolveBuiltInSupporter(card, 'you'), false);
  assert.deepEqual(ctx.draws, []);
});

test('unsupported Abilities remain manual; unsupported damaging and non-damaging attacks do not resolve automatically', () => {
  const ctx = createContext();
  const pokemon = { name: 'Charizard ex', setCode: 'OBF', cardNumber: '159', meta: { category: 'Pokemon', hp: 330, stage: 'Stage 2', types: ['Fire'], abilities: [{ name: 'Unknown Ability', effect: 'Draw a card.' }], attacks: [{ name: 'Unknown Blast', damage: 100, effect: 'Discard all Energy from this Pokémon.' }] } };
  assert.equal(ctx.abilityEffectRuleFor(pokemon, pokemon.meta.abilities[0]), null);
  assert.equal(ctx.effectSupportFor(pokemon), 'manual');
  assert.equal(ctx.attackDamageValue(pokemon.meta.attacks[0], pokemon), null);
  const nonDamaging = { name: 'Audino', setCode: 'PRE', cardNumber: '12', meta: { category: 'Pokemon', hp: 110, stage: 'Basic', types: ['Colorless'], attacks: [{ name: 'Unknown Search', damage: '', effect: 'Search your deck for any card.' }] } };
  assert.equal(ctx.attackDamageValue(nonDamaging.meta.attacks[0], nonDamaging), null);
});

test('attack with absent effect data is unresolved; explicit no-effect attack text remains supported', () => {
  const ctx = createContext();
  const card = { name: 'Tatsugiri', setCode: 'SVI', cardNumber: '62', meta: { category: 'Pokemon', hp: 70, stage: 'Basic', types: ['Water'] } };
  assert.equal(ctx.attackDamageValue({ name: 'Mise en Place', damage: 0 }, card), null);
  assert.equal(ctx.attackDamageValue({ name: 'Basic Strike', damage: 20, effect: '', effectTextStatus: 'explicit-empty' }, card), 20);
});

test('known basic Energy remains automated without printed effect text', () => {
  const ctx = createContext(), card = { name: 'Lightning Energy', meta: { category: 'Energy', energyType: 'Lightning' } };
  assert.equal(ctx.effectResolutionFor(card).key, 'automated');
});

test('resolution reports assisted Tools separately and missing card records as unresolved', () => {
  const ctx = createContext();
  const tool = { name: 'Unknown Tool', setCode: 'SVI', cardNumber: '1', meta: { category: 'Trainer', trainerType: 'Pokémon Tool', effect: 'Attach this card to one of your Pokémon.' } };
  assert.equal(ctx.effectResolutionFor(tool).key, 'assisted');
  assert.equal(ctx.effectResolutionFor({ name: 'Unknown card', meta: null }).key, 'unresolved');
});

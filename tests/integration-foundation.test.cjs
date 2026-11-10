const assert = require('node:assert/strict');
const fs = require('node:fs');
const { test } = require('node:test');
const { fixturePath, seededRandom, scriptedChoices, loadFixture, loadEngineTestHooks, loadStartupCardContext } = require('./integration-harness.cjs');

test('test random source is reproducible from a seed', () => {
  const a = seededRandom(12345), b = seededRandom(12345), c = seededRandom(54321);
  const sequenceA = Array.from({ length: 12 }, a), sequenceB = Array.from({ length: 12 }, b), sequenceC = Array.from({ length: 12 }, c);
  assert.deepEqual(sequenceA, sequenceB);
  assert.notDeepEqual(sequenceA, sequenceC);
  assert.ok(sequenceA.every(value => value >= 0 && value < 1));
});

test('engine hooks accept deterministic randomness and route scripted choices', () => {
  const context = loadEngineTestHooks(), random = seededRandom(99);
  const choose = scriptedChoices({ 'pokemon-target': ['legal-target'] });
  context.testHooks.installEngineTestHooks({ random, choose });
  const expectedRandom = seededRandom(99);
  const values = [context.testHooks.engineRandom(), context.testHooks.engineRandom()];
  assert.deepEqual(values, [expectedRandom(), expectedRandom()]);
  assert.equal(context.testHooks.engineTestChoice('pokemon-target', { candidates: [{ id: 'legal-target' }] }).value, 'legal-target');
  const invalidContext = loadEngineTestHooks();
  invalidContext.testHooks.installEngineTestHooks({ choose: scriptedChoices({ 'pokemon-target': ['illegal-target'] }) });
  assert.throws(() => invalidContext.testHooks.engineTestChoice('pokemon-target', { candidates: [{ id: 'legal-target' }] }), /not among the offered legal candidates/);
});

test('engineRandom falls back to normal browser randomness when test hooks are absent', () => {
  const context = loadEngineTestHooks();
  const value = context.testHooks.engineRandom();
  assert.equal(Number.isFinite(value), true);
  assert.ok(value >= 0 && value < 1);
});

test('startup deck parsing and loadRegisteredCards complete with hooks uninstalled', () => {
  const html = fs.readFileSync(require('node:path').join(__dirname, '..', 'index.html'), 'utf8');
  assert.ok(html.indexOf('let engineTestHooks = null;') < html.indexOf('let registeredCards = loadRegisteredCards();'), 'engineTestHooks must initialize before startup card loading');
  const context = loadStartupCardContext();
  const parsed = context.startupCardApi.parseDeck(context.DEFAULT_DECKS[0].decklist);
  assert.equal(parsed.valid, true);
  assert.equal(parsed.total, 60);
  const seeded = context.startupCardApi.seedRegisteredCards();
  const loaded = context.startupCardApi.loadRegisteredCards();
  assert.ok(seeded.length > 0);
  assert.equal(loaded.length, seeded.length);
  assert.ok(loaded.every(card => card.name && card.setCode && card.cardNumber));
});

test('registered Iono and Dragonite browser data is exported as a verified fixture', { skip: fs.existsSync(fixturePath) ? false : 'No browser fixture yet. Use Deck library → Export match test data and save it as tests/fixtures/iono-lightning-vs-dragonite.fixture.json.' }, () => {
  const fixture = loadFixture();
  assert.equal(fixture.decks.human.name.toLowerCase().includes('iono'), true);
  assert.match(fixture.decks.ai.name, /dragonite/i);
  assert.ok(fixture.cards.length > 0);
  assert.ok(fixture.cards.every(card => card.meta && card.handlers && card.effectResolution));
});

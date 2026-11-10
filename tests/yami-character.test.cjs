const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createEngineRunner, loadFixture } = require('./integration-harness.cjs');

function setup() {
  const fixture = loadFixture(), runner = createEngineRunner(fixture, 455);
  runner.api.setup(fixture, runner.random, runner.choose, () => true);
  runner.api.setLocalAi(false);
  runner.api.clearVisuals();
  return runner;
}

function reaction(runner) {
  runner.context.renderYamiCharacter();
  return {
    face: runner.document.getElementById('yamiPortrait').dataset.expression,
    message: runner.document.getElementById('yamiSpeech').textContent
  };
}

test('Yami has setup, automatic turn and paused reactions', () => {
  const runner = setup(), game = runner.api.state();
  game.phase = 'setup';
  assert.equal(reaction(runner).face, 'confident');
  assert.match(reaction(runner).message, /Choose your Pokémon/);
  game.phase = 'play';
  game.turn = 'you';
  runner.api.setLocalAi(true);
  assert.match(reaction(runner).message, /Your move, Toma/);
  game.turn = 'codex';
  assert.equal(reaction(runner).face, 'thinking');
  assert.match(reaction(runner).message, /My turn/);
  runner.api.setLocalAi(false);
  assert.match(reaction(runner).message, /on pause/);
});

for (const [side, face] of [['you','surprised'], ['codex','challenging']]) {
  test('Yami reacts to the displayed attack by '+side, () => {
    const runner = setup();
    runner.context.queuePlaymatEffect({kind:'attack', side, name:'Attacker', attack:'Test attack', element:'lightning'});
    assert.equal(reaction(runner).face, face);
    runner.api.clearVisuals();
    assert.match(reaction(runner).message, /on pause/);
  });
}

test('Knockout and Prize reactions follow presentation order before the final result', () => {
  const runner = setup(), game = runner.api.state();
  runner.context.queuePlaymatEffect({kind:'knockout', side:'codex', name:'Pokémon'});
  runner.context.queuePlaymatEffect({kind:'prize', side:'you', count:1});
  game.phase = 'finished';
  game.winner = 'you';
  assert.equal(reaction(runner).face, 'surprised');
  assert.match(reaction(runner).message, /temporary setback/);
  runner.context.showNextPlaymatEffect();
  assert.match(reaction(runner).message, /Prize for you/);
  runner.api.clearVisuals();
  assert.equal(reaction(runner).face, 'defeated');
});

for (const [winner, face] of [['you','defeated'], ['codex','victorious'], [null,'confident']]) {
  test('Yami shows the settled match result for '+winner, () => {
    const runner = setup(), game = runner.api.state();
    game.phase = 'finished';
    game.winner = winner;
    assert.equal(reaction(runner).face, face);
  });
}

test('rendering Yami reads no hidden cards and changes no game state, randomness or timers', () => {
  const runner = setup(), game = runner.api.state();
  const before = JSON.stringify(game), backup = JSON.stringify(runner.api.backup().data);
  const hand = game.players.you.hand, deck = game.players.you.deck;
  Object.defineProperty(game.players.you, 'hand', {get() {throw Error('Hidden hand read');}, configurable:true});
  Object.defineProperty(game.players.you, 'deck', {get() {throw Error('Hidden deck read');}, configurable:true});
  runner.api.setChoices(() => {throw Error('Game randomness consumed');}, () => {throw Error('Choice opened');});
  const originalSetTimeout = runner.context.setTimeout;
  runner.context.setTimeout = () => {throw Error('Character timer created');};
  for (let count = 0; count < 20; count++) {
    assert.match(runner.context.yamiCharacterReaction()[1], /on pause/);
    runner.context.renderYamiCharacter();
  }
  runner.context.setTimeout = originalSetTimeout;
  Object.defineProperty(game.players.you, 'hand', {value:hand, configurable:true, writable:true});
  Object.defineProperty(game.players.you, 'deck', {value:deck, configurable:true, writable:true});
  assert.equal(JSON.stringify(game), before);
  assert.equal(JSON.stringify(runner.api.backup().data), backup);
});

test('missing character elements cannot block rendering the playmat', () => {
  const runner = setup(), original = runner.document.getElementById;
  runner.document.getElementById = id => ['yamiPortrait','yamiSpeech'].includes(id) ? null : original(id);
  assert.doesNotThrow(() => runner.api.render());
});

test('both row headers show escaped deck names in place of their status counters', () => {
  const runner = setup(), game = runner.api.state();
  for (const side of ['you','codex']) game.players[side].deckName = '<Deck & name>';
  runner.api.render();
  for (const side of ['you','codex']) {
    const html = runner.document.getElementById(side+'Row').innerHTML;
    assert.match(html, /row-deck-name" title="&lt;Deck &amp; name&gt;">&lt;Deck &amp; name&gt;/);
    assert.doesNotMatch(html, /class="stat/);
    assert.match(html, /Prize cards remaining/);
    assert.match(html, /View .* discard pile/);
  }
});

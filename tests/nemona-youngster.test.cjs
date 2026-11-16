const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadFixture, createEngineRunner } = require('./integration-harness.cjs');

const fixture = loadFixture();
const printing = {
  Nemona: { setCode: 'SVI', cardNumber: '180', text: 'Draw 3 cards.' },
  Youngster: { setCode: 'SVI', cardNumber: '198', text: 'Shuffle your hand into your deck. Then, draw 5 cards.' }
};

function setupSupporter(name, side = 'you') {
  const runner = createEngineRunner(fixture, 43);
  runner.api.setup(fixture, runner.random, runner.choose);
  const game = runner.api.state(), owner = game.players[side], wanted = printing[name];
  let card = null;
  for (const zone of [owner.deck, owner.hand, owner.discard, owner.prizes]) {
    const index = zone.findIndex(item => item.setCode === wanted.setCode && String(item.cardNumber) === wanted.cardNumber);
    if (index >= 0) { card = zone.splice(index, 1)[0]; break; }
  }
  if (!card) {
    const other = game.players[side === 'you' ? 'codex' : 'you'];
    for (const zone of [other.deck, other.hand, other.discard, other.prizes]) {
      const index = zone.findIndex(item => item.setCode === wanted.setCode && String(item.cardNumber) === wanted.cardNumber);
      if (index >= 0) { card = zone.splice(index, 1)[0]; break; }
    }
  }
  assert.ok(card, `${name} should be available from the prepared fixture zones`);
  if (side === 'codex') {
    owner.deck.push(...owner.hand);
    owner.hand = [];
    owner.active.energy = [];
  }
  owner.hand.push(card);
  owner.turnsTaken = 1;
  owner.supporterPlayedThisTurn = false;
  game.phase = 'play';
  game.turn = side;
  game.pendingPromotion = null;
  return { runner, game, owner, card };
}

function zones(owner) {
  return JSON.stringify({ hand: owner.hand.map(card => card.id), deck: owner.deck.map(card => card.id), discard: owner.discard.map(card => card.id), supporterPlayedThisTurn: owner.supporterPlayedThisTurn });
}

for (const name of ['Nemona', 'Youngster']) {
  test(`${name} SVI printing matches only its exact English card and complete text`, async () => {
    const { runner, owner, card } = setupSupporter(name);
    assert.equal(JSON.stringify(runner.api.supporterStatus(card)), JSON.stringify({ support: 'automatic', resolution: 'automated', handler: name === 'Nemona' ? 'draw_cards' : 'shuffle_draw' }));
    const altered = { ...card, meta: { ...card.meta, effect: card.meta.effect + ' Then discard a card.' } };
    const unsupported = JSON.stringify({ support: 'manual', resolution: 'manual', handler: null });
    assert.equal(JSON.stringify(runner.api.supporterStatus(altered)), unsupported);
    assert.equal(JSON.stringify(runner.api.supporterStatus({ ...card, setCode: 'PAF', cardNumber: '80' })), unsupported);
    assert.equal(JSON.stringify(runner.api.supporterStatus({ ...card, language: 'ja' })), unsupported);
    const before = zones(owner);
    card.meta.effect = altered.meta.effect;
    await runner.api.playCard('you', card.id);
    assert.equal(zones(runner.api.state().players.you), before, 'altered text must be rejected before any card or turn state changes');
  });

  for (const side of ['you', 'codex']) {
    test(`${name} resolves through the ${side === 'you' ? 'human' : 'AI'} path and consumes the Supporter only on success`, async () => {
      const { runner, owner, card } = setupSupporter(name, side);
      const oldHand = owner.hand.filter(item => item.id !== card.id).map(item => item.id);
      const beforeDeck = owner.deck.length;
      if (side === 'you') await runner.api.playCard(side, card.id);
      else { runner.api.setLocalAi(true); await runner.api.aiStep(); }
      assert.ok(owner.discard.some(item => item.id === card.id));
      assert.equal(owner.supporterPlayedThisTurn, true);
      if (name === 'Nemona') {
        assert.equal(owner.hand.length, oldHand.length + 3);
        assert.equal(owner.deck.length, beforeDeck - 3);
      } else {
        assert.equal(owner.hand.length, 5);
        assert.equal(owner.deck.length, beforeDeck + oldHand.length - 5);
        const finalIds = new Set([...owner.hand, ...owner.deck].map(item => item.id));
        for (const id of oldHand) assert.ok(finalIds.has(id), `Youngster should preserve shuffled card ${id}`);
      }
    });
  }
}

test('Nemona draws as many cards as are available, including from an empty deck', async () => {
  for (const remaining of [0, 2]) {
    const { runner, owner, card } = setupSupporter('Nemona');
    if (owner.deck.length > remaining) owner.discard.push(...owner.deck.splice(0, owner.deck.length - remaining));
    const beforeHand = owner.hand.length;
    await runner.api.playCard('you', card.id);
    assert.equal(owner.hand.length, beforeHand - 1 + remaining);
    assert.equal(owner.deck.length, 0);
    assert.ok(owner.discard.some(item => item.id === card.id));
  }
});

test('Youngster shuffles the remaining hand back before drawing and handles an empty deck', async () => {
  const { runner, game, owner, card } = setupSupporter('Youngster');
  owner.deck.push(...owner.hand.filter(item => item.id !== card.id));
  owner.hand = [card];
  owner.discard.push(...owner.deck.splice(0));
  game.turn = 'you';
  await runner.api.playCard('you', card.id);
  assert.equal(owner.hand.length, 0);
  assert.ok(owner.discard.some(item => item.id === card.id));
  assert.equal(owner.supporterPlayedThisTurn, true);
});

for (const name of ['Nemona', 'Youngster']) {
  test(`${name} failed resolution rolls back hand, deck, discard, and Supporter allowance`, async () => {
    const { runner, owner, card } = setupSupporter(name);
    const before = zones(owner);
    const restore = runner.api.failNextSupporterAfterMutation();
    await runner.api.playCard('you', card.id);
    restore();
    assert.equal(zones(runner.api.state().players.you), before);
  });
}

test('Judge, Nest Ball, Pokémon Catcher, Switch, and Energy Switch remain automated', () => {
  const audit = createEngineRunner(fixture).api.inspectFixture(fixture);
  for (const [name, setCode, cardNumber] of [['Judge', 'SVI', '176'], ['Nest Ball', 'PAF', '84'], ['Pokémon Catcher', 'POR', '82'], ['Switch', 'MEG', '130'], ['Energy Switch', 'MEG', '115']]) {
    assert.equal(audit.find(card => card.name === name && card.setCode === setCode && card.cardNumber === cardNumber)?.resolution, 'automated');
  }
});

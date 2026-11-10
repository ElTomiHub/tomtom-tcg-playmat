const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadFixture, createEngineRunner } = require('./integration-harness.cjs');

const fixture = loadFixture();
const cards = {
  'Great Ball': { setCode: 'PAL', cardNumber: '183', text: 'Look at the top 7 cards of your deck. You may reveal a Pokémon you find there and put it into your hand. Shuffle the other cards back into your deck.' },
  'Ultra Ball': { setCode: 'ASC', cardNumber: '213', text: 'You can use this card only if you discard 2 other cards from your hand.\nSearch your deck for a Pokémon, reveal it, and put it into your hand. Then, shuffle your deck.' }
};

function setup(name, side = 'you') {
  const runner = createEngineRunner(fixture, 93);
  runner.api.setup(fixture, runner.random, runner.choose);
  runner.api.setLocalAi(false);
  const game = runner.api.state(), owner = game.players[side], print = cards[name];
  let card = null;
  for (const player of [owner, game.players[side === 'you' ? 'codex' : 'you']]) {
    for (const zone of [player.hand, player.deck, player.discard, player.prizes]) {
      const index = zone.findIndex(item => item.setCode === print.setCode && String(item.cardNumber) === print.cardNumber);
      if (index >= 0) { card = zone.splice(index, 1)[0]; break; }
    }
    if (card) break;
  }
  assert.ok(card, `${name} must be available in the fixture's zones`);
  if (side === 'codex') {
    owner.deck.push(...owner.hand);
    owner.hand = [];
    owner.active.energy = [];
  }
  owner.hand.push(card);
  owner.turnsTaken = 1;
  owner.supporterPlayedThisTurn = false;
  owner.energyAttachedThisTurn = true;
  game.phase = 'play'; game.turn = side; game.pendingPromotion = null;
  return { runner, game, owner, card };
}

function takeCards(owner, count, predicate = () => true) {
  const found = [];
  for (const zone of [owner.deck, owner.hand, owner.discard, owner.prizes]) {
    for (let i = zone.length - 1; i >= 0 && found.length < count; i--) {
      if (predicate(zone[i])) found.push(zone.splice(i, 1)[0]);
    }
    if (found.length === count) break;
  }
  assert.equal(found.length, count, `test setup needs ${count} matching cards`);
  return found;
}

function setChoice(runner, choose) { runner.api.setChoices(runner.random, choose); }
function zoneIds(owner) { return JSON.stringify({ hand: owner.hand.map(card => card.id), deck: owner.deck.map(card => card.id), discard: owner.discard.map(card => card.id) }); }

for (const choice of [null, ['not-a-card']]) {
  test(`Great Ball ${choice === null ? 'locks cancellation after revealing the deck' : 'rejects invalid optional selection without consuming or shuffling'}`, async () => {
    const { runner, owner, card } = setup('Great Ball');
    const pokemon = takeCards(owner, 1, item => item.meta?.category === 'Pokemon')[0];
    owner.deck.push(pokemon);
    const before = zoneIds(owner);
    if (choice === null) {
      runner.api.setChoices(runner.random, undefined);
      const playing = runner.api.playCard('you', card.id);
      assert.equal(runner.api.pendingChoices(), true);
      runner.api.cancelActiveCardChoice();
      assert.equal(runner.api.pendingChoices(),true);
      runner.api.confirmRawChoice([]);
      await playing;
      assert.ok(runner.api.state().players.you.discard.some(c=>c.id===card.id));
      return;
    } else {
      setChoice(runner, request => request.kind === 'cards' ? choice : request.defaultValue);
      await runner.api.playCard('you', card.id);
    }
    assert.equal(zoneIds(runner.api.state().players.you), before);
  });
}

test('Great Ball permits an explicit empty selection even when a Pokémon is available', async () => {
  const { runner, owner, card } = setup('Great Ball');
  const pokemon = takeCards(owner, 1, item => item.meta?.category === 'Pokemon')[0];
  owner.deck.push(pokemon);
  const beforeHand = owner.hand.filter(item => item.id !== card.id).map(item => item.id);
  setChoice(runner, request => request.kind === 'cards' ? [] : request.defaultValue);
  await runner.api.playCard('you', card.id);
  const current = runner.api.state().players.you;
  assert.deepEqual(current.hand.map(item => item.id), beforeHand);
  assert.ok(current.deck.some(item => item.id === pokemon.id));
  assert.ok(current.discard.some(item => item.id === card.id));
});

for (const name of ['Great Ball', 'Ultra Ball']) {
  for (const change of [card => { card.setCode = 'SVI'; }, card => { card.cardNumber = '999'; }, card => { card.language = 'ja'; card.meta.language = 'ja'; }, card => { card.meta.effect = ''; }]) {
    test(`${name} rejects mismatched print, language, or missing text (${change.toString()})`, async () => {
      const { runner, owner, card } = setup(name);
      change(card);
      assert.notEqual(runner.api.itemStatus(card).resolution, 'automated');
      const before = zoneIds(owner);
      await runner.api.playCard('you', card.id);
      assert.equal(zoneIds(runner.api.state().players.you), before);
    });
  }
}

for (const name of ['Great Ball', 'Ultra Ball']) {
  test(`${name} exact English printing and complete text are required`, async () => {
    const { runner, owner, card } = setup(name);
    const handler = name === 'Great Ball' ? 'look_seven_search_pokemon' : 'discard_two_search_pokemon';
    assert.equal(JSON.stringify(runner.api.itemStatus(card)), JSON.stringify({ support: 'automatic', resolution: 'automated', handler }));
    const before = zoneIds(owner);
    card.meta.effect += ' Then discard a card.';
    assert.equal(JSON.stringify(runner.api.itemStatus(card)), JSON.stringify({ support: 'manual', resolution: 'manual', handler: null }));
    await runner.api.playCard('you', card.id);
    assert.equal(zoneIds(runner.api.state().players.you), before);
  });
}

test('Great Ball selects only a Pokémon among the top seven and returns the rest shuffled', async () => {
  const { runner, owner, card } = setup('Great Ball');
  const pokemon = owner.deck.find(item => item.meta?.category === 'Pokemon');
  const topNonPokemon = owner.deck.filter(item => item.meta?.category !== 'Pokemon').slice(0, 6);
  assert.ok(pokemon && topNonPokemon.length === 6);
  const topSet = new Set([pokemon.id, ...topNonPokemon.map(item => item.id)]);
  owner.deck = [...owner.deck.filter(item => !topSet.has(item.id)), pokemon, ...topNonPokemon];
  const beforeDeck = owner.deck.map(item => item.id), topIds = new Set(beforeDeck.slice(-7));
  setChoice(runner, request => request.kind === 'cards' ? [pokemon.id] : request.defaultValue);
  await runner.api.playCard('you', card.id);
  const current = runner.api.state().players.you;
  assert.ok(current.hand.some(item => item.id === pokemon.id));
  assert.ok(!current.deck.some(item => item.id === pokemon.id));
  for (const id of topIds) if (id !== pokemon.id) assert.ok(current.deck.some(item => item.id === id), `unselected top card ${id} returns to deck`);
  assert.notDeepEqual(current.deck.map(item => item.id), beforeDeck.filter(id => id !== pokemon.id), 'the returned cards are shuffled back');
  assert.ok(current.discard.some(item => item.id === card.id));
});

test('Great Ball never sees a Pokémon below the top seven and shuffles all seven back if none qualify', async () => {
  const { runner, owner, card } = setup('Great Ball');
  const pokemon = owner.deck.find(item => item.meta?.category === 'Pokemon');
  const nonPokemon = owner.deck.filter(item => item.meta?.category !== 'Pokemon').slice(0, 7);
  assert.ok(pokemon && nonPokemon.length === 7);
  const removed = new Set([pokemon.id, ...nonPokemon.map(item => item.id)]);
  owner.deck = [...owner.deck.filter(item => !removed.has(item.id)), pokemon, ...nonPokemon];
  const beforeHand = owner.hand.filter(item => item.id !== card.id).map(item => item.id), top = owner.deck.slice(-7).map(item => item.id);
  await runner.api.playCard('you', card.id);
  const current = runner.api.state().players.you;
  assert.deepEqual(current.hand.map(item => item.id), beforeHand);
  assert.ok(current.deck.some(item => item.id === pokemon.id), 'the eighth card is outside the search scope');
  assert.ok(top.every(id => current.deck.some(item => item.id === id)), 'all non-Pokémon top cards return to the deck');
});

test('Great Ball searches fewer than seven remaining cards correctly', async () => {
  const { runner, owner, card } = setup('Great Ball');
  const pokemon = owner.deck.find(item => item.meta?.category === 'Pokemon');
  const other = owner.deck.find(item => item.id !== pokemon?.id);
  assert.ok(pokemon && other);
  const keep = new Set([pokemon.id, other.id]);
  owner.discard.push(...owner.deck.filter(item => !keep.has(item.id)));
  owner.deck = [pokemon, other];
  setChoice(runner, request => request.kind === 'cards' ? [pokemon.id] : request.defaultValue);
  await runner.api.playCard('you', card.id);
  const current = runner.api.state().players.you;
  assert.ok(current.hand.some(item => item.id === pokemon.id));
  assert.deepEqual(Array.from(current.deck, item => item.id), [other.id]);
});

test('Ultra Ball pays exactly two other cards, searches a Pokémon, and shuffles', async () => {
  const { runner, owner, card } = setup('Ultra Ball');
  const [costA, costB] = takeCards(owner, 2, item => item.id !== card.id && item.meta?.category !== 'Pokemon');
  owner.hand.push(costA, costB);
  const pokemon = owner.deck.find(item => item.meta?.category === 'Pokemon');
  assert.ok(pokemon);
  const beforeDeck = owner.deck.map(item => item.id);
  setChoice(runner, request => {
    if (request.kind !== 'cards') return request.defaultValue;
    if (request.title.includes('choose 2 cards')) return [costA.id, costB.id];
    return [pokemon.id];
  });
  await runner.api.playCard('you', card.id);
  const current = runner.api.state().players.you;
  assert.ok(current.discard.some(item => item.id === costA.id));
  assert.ok(current.discard.some(item => item.id === costB.id));
  assert.ok(current.discard.some(item => item.id === card.id));
  assert.ok(current.hand.some(item => item.id === pokemon.id));
  assert.ok(!current.deck.some(item => item.id === pokemon.id));
  assert.notDeepEqual(current.deck.map(item => item.id), beforeDeck.filter(id => id !== pokemon.id));
});

test('Ultra Ball cannot be played without two other cards or with an invalid discard selection', async () => {
  const { runner, owner, card } = setup('Ultra Ball');
  owner.deck.push(...owner.hand.filter(item => item.id !== card.id));
  owner.hand = [card];
  const before = zoneIds(owner);
  await runner.api.playCard('you', card.id);
  assert.equal(zoneIds(runner.api.state().players.you), before);

  const costs = takeCards(owner, 2, item => item.id !== card.id);
  owner.hand.push(...costs);
  const beforeInvalid = zoneIds(owner);
  setChoice(runner, request => request.kind === 'cards' ? ['not-a-card', 'also-not-a-card'] : request.defaultValue);
  await runner.api.playCard('you', card.id);
  assert.equal(zoneIds(runner.api.state().players.you), beforeInvalid);
});

test('Ultra Ball still pays its cost and shuffles when the deck has no Pokémon', async () => {
  const { runner, owner, card } = setup('Ultra Ball');
  const costs = takeCards(owner, 2, item => item.id !== card.id);
  owner.hand.push(...costs);
  owner.discard.push(...owner.deck.splice(0));
  setChoice(runner, request => request.kind === 'cards' ? costs.map(item => item.id) : request.defaultValue);
  await runner.api.playCard('you', card.id);
  const current = runner.api.state().players.you;
  assert.ok(costs.every(item => current.discard.some(cardInDiscard => cardInDiscard.id === item.id)));
  assert.ok(current.discard.some(item => item.id === card.id));
  assert.equal(current.deck.length, 0);
});

for (const name of ['Great Ball', 'Ultra Ball']) {
  test(`${name} rolls back all zone changes when the shared Item transaction rejects resolution`, async () => {
    const { runner, owner, card } = setup(name);
    if (name === 'Ultra Ball') {
      const costs = takeCards(owner, 2, item => item.id !== card.id);
      costs.forEach(item => { if (item.meta?.category === 'Trainer') item.meta.effect += ' Unverified extra instruction.'; });
      owner.hand.push(...costs);
      const pokemon = owner.deck.find(item => item.meta?.category === 'Pokemon');
      setChoice(runner, request => request.kind !== 'cards' ? request.defaultValue : request.title.includes('choose 2 cards') ? costs.map(item => item.id) : [pokemon.id]);
    }
    const before = zoneIds(owner);
    const restore = runner.api.failNextItemAfterResolve();
    await runner.api.playCard('you', card.id);
    restore();
    assert.equal(zoneIds(runner.api.state().players.you), before);
  });
}

for (const name of ['Great Ball', 'Ultra Ball']) {
  test(`${name} is usable through the AI action pipeline`, async () => {
    const { runner, owner, card } = setup(name, 'codex');
    const benchBasics = takeCards(owner, 5 - owner.bench.length, item => item.meta?.category === 'Pokemon' && item.meta?.stage === 'Basic');
    owner.bench.push(...benchBasics);
    if (name === 'Ultra Ball') {
      const costs = takeCards(owner, 2, item => item.id !== card.id);
      costs.forEach(item => { if (item.meta?.category === 'Trainer') item.meta.effect += ' Unverified extra instruction.'; });
      owner.hand.push(...costs);
      const pokemon = owner.deck.find(item => item.meta?.category === 'Pokemon');
      assert.ok(pokemon);
      const manualNames = ['Iono', 'Drasna', 'Bravery Charm', 'Exp. Share'];
      for (const name of manualNames) {
        const record = takeCards(owner, 1, item => item.name === name)[0];
        record.meta.effect += ' Unverified extra instruction.';
        owner.hand.push(record);
      }
    }
    const beforeDiscardCount = owner.discard.length;
    runner.api.setLocalAi(true);
    await runner.api.aiStep();
    const current = runner.api.state().players.codex;
    assert.ok(current.discard.some(item => item.id === card.id));
    if (name === 'Ultra Ball') assert.equal(current.discard.length, beforeDiscardCount + 3, 'Ultra Ball and exactly two other cards are discarded');
  });
}

test('existing automated Trainer effects remain automated', () => {
  const audit = createEngineRunner(fixture).api.inspectFixture(fixture);
  for (const [name, setCode, cardNumber] of [['Nest Ball', 'PAF', '84'], ['Judge', 'SVI', '176'], ['Pokémon Catcher', 'POR', '82'], ['Energy Switch', 'MEG', '115'], ['Switch', 'MEG', '130']]) {
    assert.equal(audit.find(item => item.name === name && item.setCode === setCode && item.cardNumber === cardNumber)?.resolution, 'automated');
  }
  for (const name of ['Drasna', 'Iono', 'Youngster', 'Nemona']) assert.equal(audit.filter(item => item.name === name).some(item => item.resolution === 'automated'), true);
});

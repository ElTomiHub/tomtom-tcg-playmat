const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadFixture, createEngineRunner } = require('./integration-harness.cjs');

function setup(side = 'you') {
  const fixture = loadFixture(), runner = createEngineRunner(fixture, 93);
  runner.api.setup(fixture, runner.random, runner.choose);
  runner.api.setLocalAi(false);
  const game = runner.api.state(), owner = game.players[side];
  let card;
  for (const p of Object.values(game.players)) {
    for (const zone of [p.hand, p.deck, p.discard, p.prizes]) {
      const i = zone.findIndex(c => c.name === 'Energy Search');
      if (i >= 0) { card = zone.splice(i, 1)[0]; break; }
    }
    if (card) break;
  }
  assert.ok(card);
  owner.hand.push(card);
  game.phase = 'play'; game.turn = side; game.pendingPromotion = null;
  owner.turnsTaken = 1;
  return { runner, owner, card };
}
const zones = p => JSON.stringify([p.hand, p.deck, p.discard]);

test('Energy Search requires the exact English POR 72 print and complete text', async () => {
  for (const mutate of [c => { c.setCode = 'SVI'; }, c => { c.cardNumber = '73'; }, c => { c.language = c.meta.language = 'ja'; }, c => { c.meta.effect = ''; }, c => { c.meta.effect += ' Draw a card.'; }]) {
    const { runner, owner, card } = setup();
    assert.equal(runner.api.itemStatus(card).resolution, 'automated');
    mutate(card);
    assert.notEqual(runner.api.itemStatus(card).resolution, 'automated');
    const before = zones(owner);
    await runner.api.playCard('you', card.id);
    assert.equal(zones(runner.api.state().players.you), before);
  }
});

test('Energy Search reveals one Basic Energy, excludes Special Energy, and shuffles', async () => {
  const { runner, owner, card } = setup();
  const energy = owner.deck.find(c => c.meta.category === 'Energy');
  assert.ok(energy);
  owner.deck.push({ id: 'special-energy', name: 'Double Dragon Energy', meta: { category: 'Energy' } });
  const before = owner.deck.map(c => c.id);
  runner.api.setChoices(runner.random, request => {
    if (request.kind !== 'cards') return request.defaultValue;
    assert.ok(request.candidates.every(c => c.meta.category === 'Energy' && c.name !== 'Double Dragon Energy'));
    return [energy.id];
  });
  await runner.api.playCard('you', card.id);
  const p = runner.api.state().players.you;
  assert.ok(p.hand.some(c => c.id === energy.id));
  assert.ok(p.discard.some(c => c.id === card.id));
  assert.equal(p.deck.length, before.length - 1);
  assert.notDeepEqual(p.deck.map(c => c.id), before.filter(id => id !== energy.id));
});

for (const choice of [null, ['invalid-card']]) {
  test(`Energy Search rejects ${choice === null ? 'cancellation' : 'invalid selection'} atomically`, async () => {
    const { runner, owner, card } = setup();
    const before = zones(owner);
    runner.api.setChoices(runner.random, request => request.kind === 'cards' ? choice : request.defaultValue);
    await runner.api.playCard('you', card.id);
    assert.equal(zones(runner.api.state().players.you), before);
  });
}

test('Energy Search revalidates a selected Energy that left the deck during the choice', async () => {
  const { runner, owner, card } = setup();
  const before = zones(owner);
  runner.api.setChoices(runner.random, request => {
    const chosen = request.candidates[0];
    owner.discard.push(owner.deck.splice(owner.deck.indexOf(chosen), 1)[0]);
    return [chosen.id];
  });
  await runner.api.playCard('you', card.id);
  assert.equal(zones(runner.api.state().players.you), before);
});

test('Energy Search rolls back a failed shared Item transaction', async () => {
  const { runner, owner, card } = setup();
  const before = zones(owner), restore = runner.api.failNextItemAfterResolve();
  await runner.api.playCard('you', card.id);
  restore();
  assert.equal(zones(runner.api.state().players.you), before);
});

for (const empty of [true, false]) {
  test(`Energy Search handles ${empty ? 'an empty deck' : 'a deck without Basic Energy'}`, async () => {
    const { runner, owner, card } = setup();
    owner.discard.push(...owner.deck.splice(0));
    if (!empty) owner.deck.push({ id: 'special-only', name: 'Double Dragon Energy', meta: { category: 'Energy' } });
    await runner.api.playCard('you', card.id);
    assert.ok(runner.api.state().players.you.discard.some(c => c.id === card.id));
    assert.equal(runner.api.state().players.you.deck.length, empty ? 0 : 1);
  });
}

test('AI plays Energy Search through its normal action pipeline', async () => {
  const { runner, owner, card } = setup('codex');
  owner.deck.push(...owner.hand.filter(c => c !== card)); owner.hand = [card];
  owner.energyAttachedThisTurn = true;
  runner.api.setLocalAi(true);
  await runner.api.aiStep();
  assert.ok(runner.api.state().players.codex.discard.some(c => c.id === card.id));
});

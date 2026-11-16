const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadFixture, createEngineRunner } = require('./integration-harness.cjs');

function dragonite(fixture) {
  return fixture.cards.find(card => card.name === 'Dragonite' && card.setCode === 'SIT' && card.cardNumber === '131');
}

function audit(fixture) {
  return createEngineRunner(fixture, 29).api.inspectFixture(fixture).find(card => card.name === 'Dragonite' && card.setCode === 'SIT' && card.cardNumber === '131');
}

async function readyRunner(side = 'you', seed = 33) {
  const fixture = loadFixture();
  fixture.decks.human = { ...fixture.decks.ai, id: `energy-hurricane-${side}` };
  const runner = createEngineRunner(fixture, seed);
  runner.api.setup(fixture, runner.random, request => {
    const candidates = request.candidates || [];
    if (request.kind === 'prompt') return request.defaultValue;
    if (request.kind === 'confirm') return true;
    return candidates[0] || null;
  }, () => true);
  runner.api.setLocalAi(false);
  const attacker = runner.api.prepareAttack(side, 'SIT', '131', ['Water', 'Lightning', 'Lightning', 'Lightning']);
  const opponent = side === 'you' ? 'codex' : 'you';
  runner.api.prepareAttack(opponent, 'ASC', '152', []);
  runner.api.state().turn = side;
  if (side === 'you' && !runner.api.state().players.you.bench.length) {
    const owner = runner.api.state().players.you, basicIndex = owner.deck.findIndex(card => card.meta?.category === 'Pokemon' && card.meta?.stage === 'Basic');
    if (basicIndex >= 0) {
      const [basic] = owner.deck.splice(basicIndex, 1); owner.hand.push(basic);
      await runner.api.humanAction({ type: 'play_basic', cardId: basic.id });
    }
  }
  runner.api.state().turn = side;
  return { fixture, runner, attacker, side, opponent };
}

function scriptedSelection(runner, side, count = 3, destinationFor = index => index === 1 ? 'bench' : 'active', hooks = {}) {
  const player = runner.api.state().players[side], selectedCards = [], assignments = [];
  let targetRequest = 0;
  const random = hooks.random || (() => 0.37);
  runner.api.setChoices(random, request => {
    if (request.kind === 'cards') {
      const selected = request.candidates.slice(0, count);
      selectedCards.push(...selected);
      return selected;
    }
    if (request.kind === 'pokemon-target') {
      if (hooks.onTarget) hooks.onTarget(request, selectedCards, player);
      const desired = destinationFor(targetRequest++);
      const target = desired === 'bench' ? request.candidates.find(card => player.bench.some(item => item.id === card.id)) : player.active;
      const value = hooks.target ? hooks.target(request, target, targetRequest) : target;
      assignments.push(value?.id || null);
      return value;
    }
    if (request.kind === 'prompt') return request.defaultValue;
    if (request.kind === 'confirm') return true;
    return request.candidates?.[0] || null;
  });
  return { selectedCards, assignments };
}

test('Dragonite SIT 131 Energy Hurricane exact English metadata identifies only its verified attack', () => {
  const fixture = loadFixture(), card = dragonite(fixture);
  assert.ok(card);
  assert.equal(card.language, 'en');
  const attack = card.meta.attacks.find(item => item.name === 'Energy Hurricane');
  assert.deepEqual(attack.cost, ['Water', 'Lightning', 'Colorless', 'Colorless']);
  assert.equal(attack.damage, 180);
  assert.equal(attack.effect, 'Search your deck for up to 3 basic Energy cards and attach them to your Pokémon in any way you like. Then, shuffle your deck.');
  const supported = audit(fixture);
  assert.equal(supported.handler.attacks.find(item => item.name === 'Energy Hurricane').handler, 'search_attach_basic_energy');
  assert.equal(supported.handler.attacks.find(item => item.name === 'Dragon Claw').handler, 'none');
  assert.equal(supported.resolution, 'automated');
  assert.equal(supported.implementationStatus, 'implemented');

  for (const mutate of [
    item => { item.cardNumber = '149'; },
    item => { item.language = 'ja'; },
    item => { item.meta.attacks.find(entry => entry.name === 'Energy Hurricane').effect += ' Draw a card.'; },
    item => { item.meta.attacks.find(entry => entry.name === 'Energy Hurricane').effect = ''; },
    item => { item.meta.attacks.find(entry => entry.name === 'Energy Hurricane').cost = ['Water', 'Lightning', 'Colorless']; },
    item => { item.meta.attacks.find(entry => entry.name === 'Energy Hurricane').damage = 170; }
  ]) {
    const changed = structuredClone(fixture), changedCard = dragonite(changed);
    mutate(changedCard);
    const result = createEngineRunner(changed, 31).api.inspectFixture(changed).find(entry => entry.name === 'Dragonite' && entry.setCode === changedCard.setCode && entry.cardNumber === changedCard.cardNumber);
    assert.notEqual(result.handler.attacks.find(entry => entry.name === 'Energy Hurricane').handler, 'search_attach_basic_energy');
  }
});

test('Energy Hurricane needs Water, Lightning and two additional Energy units; it deals 180 damage', async () => {
  const { runner, attacker, side, opponent } = await readyRunner();
  const option = runner.api.attackOptions(side).find(item => item.attack.name === 'Energy Hurricane');
  assert.ok(option);
  assert.equal(runner.api.canUseAttack({ ...attacker, energy: attacker.energy.slice(0, 3) }, option.attack), false);
  const target = runner.api.state().players[opponent].active, damageBefore = target.damage || 0;
  const choices = scriptedSelection(runner, side, 0);
  assert.equal(await runner.api.attack(side, option.index), true);
  assert.equal(target.damage, damageBefore + 180);
  assert.equal(choices.selectedCards.length, 0);
});

test('human can choose and distribute one, two or three Basic Energy across own Pokémon', async () => {
  for (const count of [1, 2, 3]) {
    const { runner, attacker, side } = await readyRunner('you', 33 + count);
    const owner = runner.api.state().players[side];
    assert.ok(owner.bench.length, 'the distribution scenario has a legal Benched destination');
    const option = runner.api.attackOptions(side).find(item => item.attack.name === 'Energy Hurricane');
    const beforeEligible = owner.deck.filter(card => card.meta?.category === 'Energy' && /^(Lightning|Water) Energy$/i.test(card.name));
    const choice = scriptedSelection(runner, side, count, index => index % 2 ? 'bench' : 'active');
    const deckOrderBeforeShuffle = owner.deck.map(card => card.id).filter(id => !choice.selectedCards.some(card => card.id === id));
    let randomCalls = 0;
    runner.api.setChoices(() => { randomCalls++; return 0.37; }, request => {
      if (request.kind === 'cards') { choice.selectedCards.push(...request.candidates.slice(0, count)); return request.candidates.slice(0, count); }
      if (request.kind === 'pokemon-target') {
        const wantBench = choice.assignments.length % 2 === 1;
        const target = wantBench ? request.candidates.find(card => owner.bench.some(item => item.id === card.id)) : owner.active;
        choice.assignments.push(target.id); return target;
      }
      return request.candidates?.[0] || null;
    });
    assert.ok(beforeEligible.length >= count);
    assert.equal(await runner.api.attack(side, option.index), true);
    assert.equal(choice.selectedCards.length, count);
    for (let index = 0; index < count; index++) {
      const energy = choice.selectedCards[index], targetId = choice.assignments[index];
      const target = [owner.active, ...owner.bench].find(item => item.id === targetId);
      assert.ok(target.energy.includes(energy), 'the original Energy card object is attached to its chosen Pokémon');
      assert.equal(owner.deck.some(card => card.id === energy.id), false);
    }
    assert.ok(randomCalls > 0, 'the deck is shuffled after searching');
    assert.notDeepEqual(owner.deck.map(card => card.id), deckOrderBeforeShuffle, 'the remaining deck order changes under the deterministic test shuffle');
  }
});

test('search attaches fewer than three eligible cards and no Energy cards still resolves and shuffles', async () => {
  for (const available of [1, 2, 0]) {
    const { runner, side } = await readyRunner('you', 58 + available);
    const owner = runner.api.state().players[side];
    const isBasic = card => card.meta?.category === 'Energy' && /^(Lightning|Water) Energy$/i.test(card.name);
    const allAvailable = [owner.hand, owner.discard, owner.prizes].flat().filter(isBasic);
    while (owner.deck.filter(isBasic).length < available && allAvailable.length) {
      const card = allAvailable.shift();
      for (const zone of [owner.hand, owner.discard, owner.prizes]) {
        const index = zone.findIndex(item => item.id === card.id);
        if (index >= 0) { zone.splice(index, 1); break; }
      }
      owner.deck.push(card);
    }
    const basics = owner.deck.filter(isBasic);
    const keep = new Set(basics.slice(0, available).map(card => card.id));
    const movedOut = owner.deck.filter(card => card.meta?.category === 'Energy' && /^(Lightning|Water) Energy$/i.test(card.name) && !keep.has(card.id));
    owner.hand.push(...movedOut);
    owner.deck = owner.deck.filter(card => !movedOut.some(item => item.id === card.id));
    const selected = scriptedSelection(runner, side, 3);
    const option = runner.api.attackOptions(side).find(item => item.attack.name === 'Energy Hurricane');
    assert.equal(await runner.api.attack(side, option.index), true, `attack should resolve with ${available} eligible Energy cards`);
    assert.equal(selected.selectedCards.length, available, `only ${selected.selectedCards.length} card(s) were offered for ${available} requested`);
    assert.equal([owner.active, ...owner.bench].flatMap(pokemon => pokemon.energy).filter(card => keep.has(card.id)).length, available);
    assert.ok(runner.api.state().log.some(entry => entry.message.includes('shuffled')));
  }
});

test('revealed deck choices must finish; invalid Energy and target choices stop before damage or attachment', async () => {
  {
    const { runner, side, opponent } = await readyRunner();
    const owner = runner.api.state().players[side], target = runner.api.state().players[opponent].active;
    const beforeDamage = target.damage || 0, beforeDeck = owner.deck.map(card => card.id);
    const option = runner.api.attackOptions(side).find(item => item.attack.name === 'Energy Hurricane');
    runner.api.setChoices(runner.random, null);
    const pending = runner.api.attack(side, option.index);
    assert.equal(runner.api.pendingChoices(), true);
    runner.api.cancelActiveCardChoice();
    assert.equal(runner.api.pendingChoices(),true);
    runner.api.confirmRawChoice([]);
    assert.equal(await pending,true);
    assert.equal(target.damage || 0,beforeDamage+180);
    assert.deepEqual([...owner.deck.map(card=>card.id)].sort(),[...beforeDeck].sort());
    assert.equal(runner.api.pendingChoices(), false);
  }
  {
    const { runner, side, opponent } = await readyRunner('you', 46);
    const owner = runner.api.state().players[side], target = runner.api.state().players[opponent].active;
    const beforeDamage = target.damage || 0, option = runner.api.attackOptions(side).find(item => item.attack.name === 'Energy Hurricane');
    const choice = scriptedSelection(runner, side, 1, () => 'active', { target: () => ({ id: 'stale-pokemon' }) });
    assert.equal(await runner.api.attack(side, option.index), false);
    assert.equal(target.damage || 0, beforeDamage);
    assert.ok(owner.deck.some(card => card.id === choice.selectedCards[0].id));
    assert.equal(owner.active.energy.some(card => card.id === choice.selectedCards[0].id), false);
  }
  {
    const { runner, side, opponent } = await readyRunner('you', 48);
    const owner = runner.api.state().players[side], target = runner.api.state().players[opponent].active;
    const beforeDamage = target.damage || 0, option = runner.api.attackOptions(side).find(item => item.attack.name === 'Energy Hurricane');
    let selected;
    runner.api.setChoices(runner.random, request => {
      if (request.kind === 'cards') { selected = request.candidates[0]; return [selected]; }
      if (request.kind === 'pokemon-target') { selected.meta.category = 'Trainer'; return owner.active; }
      return request.candidates?.[0] || null;
    });
    assert.equal(await runner.api.attack(side, option.index), false, 'a stale no-longer-Energy card is rejected during live revalidation');
    assert.equal(target.damage || 0, beforeDamage);
    assert.ok(owner.deck.some(card => card.id === selected.id));
    assert.equal(owner.active.energy.some(card => card.id === selected.id), false);
  }
});

test('AI uses the same Energy Hurricane handler and attaches legal Basic Energy cards', async () => {
  const { runner, attacker } = await readyRunner('codex', 69);
  const game = runner.api.state(), owner = game.players.codex;
  owner.deck.push(...owner.hand); owner.hand = []; owner.energyAttachedThisTurn = true;
  runner.api.setLocalAi(true);
  const before = owner.deck.filter(card => card.meta?.category === 'Energy' && /^(Lightning|Water) Energy$/i.test(card.name)).map(card => card.id);
  await runner.api.aiStep();
  assert.ok(attacker.energy.length >= 4);
  const attachedFromDeck = owner.active.energy.filter(card => before.includes(card.id));
  assert.equal(attachedFromDeck.length, 3);
  assert.ok(attachedFromDeck.every(card => card.meta.category === 'Energy' && /^(Lightning|Water) Energy$/i.test(card.name)));
  assert.ok(game.log.some(entry => /Yami used Energy Hurricane with Dragonite for 180 damage/.test(entry.message)));
});

test('failed Energy Hurricane resolution rolls back damage, attachments, deck, discard and turn state', async () => {
  const { runner, side, opponent } = await readyRunner('you', 77);
  const owner = runner.api.state().players[side], target = runner.api.state().players[opponent].active;
  const before = { deck: Array.from(owner.deck, card => card.id), discard: Array.from(owner.discard, card => card.id), energy: Array.from(owner.active.energy, card => card.id), damage: target.damage || 0, turn: runner.api.state().turn };
  const choice = scriptedSelection(runner, side, 3);
  let randomCalls = 0;
  runner.api.setChoices(() => { randomCalls++; return 0.37; }, request => {
    if (request.kind === 'cards') { choice.selectedCards.push(...request.candidates.slice(0, 3)); return request.candidates.slice(0, 3); }
    if (request.kind === 'pokemon-target') { choice.assignments.push(runner.api.state().players[side].active.id); return runner.api.state().players[side].active; }
    return request.candidates?.[0] || null;
  });
  const option = runner.api.attackOptions(side).find(item => item.attack.name === 'Energy Hurricane');
  const restoreResolver = runner.api.failNextAttackEffectAfterResolve();
  try { assert.equal(await runner.api.attack(side, option.index), false); }
  finally { restoreResolver(); }
  const restored = runner.api.state(), restoredOwner = restored.players[side], restoredTarget = restored.players[opponent].active;
  assert.deepEqual(Array.from(restoredOwner.deck, card => card.id), before.deck);
  assert.deepEqual(Array.from(restoredOwner.discard, card => card.id), before.discard);
  assert.deepEqual(Array.from(restoredOwner.active.energy, card => card.id), before.energy);
  assert.equal(restoredTarget.damage || 0, before.damage);
  assert.equal(restored.turn, before.turn);
  assert.ok(randomCalls > 0, 'the failed transaction shuffled before rolling back game state');
});

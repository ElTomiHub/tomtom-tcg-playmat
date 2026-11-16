const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadFixture, createEngineRunner } = require('./integration-harness.cjs');

function countOwnedCards(game, side) {
  const player = game.players[side];
  const cards = [...player.deck, ...player.hand, ...player.prizes, ...player.discard, ...(player.lost || [])];
  for (const pokemon of [player.active, ...player.bench].filter(Boolean)) {
    cards.push(pokemon, ...(pokemon.energy || []), ...(pokemon.tools || []), ...(pokemon.evolutionStack || []));
  }
  if (game.stadium?.owner === side) cards.push(game.stadium.card);
  return cards;
}

function assertStateInvariants(game, initialOwner = null) {
  assert.ok(['setup', 'play', 'finished'].includes(game.phase), `unexpected phase ${game.phase}`);
  assert.ok(['you', 'codex'].includes(game.turn));
  for (const side of ['you', 'codex']) {
    const player = game.players[side];
    assert.ok(player.bench.length <= 5, `${side} Bench exceeded five Pokémon`);
    assert.ok(player.prizes.length <= 6, `${side} has more than six Prize cards`);
    assert.equal(countOwnedCards(game, side).length, 60, `${side} must retain all 60 cards across zones and evolution stacks`);
    const ids = countOwnedCards(game, side).map(card => card.id).filter(Boolean);
    assert.equal(new Set(ids).size, ids.length, `${side} has a duplicated physical card id`);
    if (initialOwner) for (const id of ids) assert.equal(initialOwner.get(id), side, `${id} moved into the wrong player's zones`);
  }
  if (game.phase === 'play') {
    for (const side of ['you', 'codex']) {
      assert.ok(game.players[side].active || ((game.pendingPromotion === side || game.pendingPromotionAfter === side) && game.players[side].bench.length > 0), `${side} must have an Active Pokémon except while choosing a Knockout promotion`);
    }
  }
  if (game.phase === 'finished') {
    assert.ok(game.winner === 'you' || game.winner === 'codex' || game.winner === null, 'finished match must have a rules-derived result');
    assert.equal(game.pendingPromotion || null, null, 'finished match cannot retain a promotion choice');
    assert.equal(game.pendingCheckup || null, null, 'finished match cannot retain a Checkup choice');
  }
}

function choiceDriver(request, options = {}) {
  const candidates = request.candidates || [];
  if (request.kind === 'cards' && Number(request.minCount || 0) > 1) return candidates.slice(0, request.minCount);
  if (request.kind === 'cards') return candidates[0] ? [candidates[0]] : [];
  if (request.kind === 'prompt') return request.defaultValue;
  if (request.kind === 'confirm') return true;
  if (request.kind === 'active-pokemon' && request.side === 'codex' && options.codexActiveName) return candidates.find(card => card.name === options.codexActiveName) || candidates[0] || null;
  if (request.kind === 'active-pokemon' && request.side === 'codex') return candidates.find(card => card.name === 'Dratini') || candidates[0] || null;
  if (request.kind === 'bench-pokemon' && request.side === 'codex') return candidates.find(card => card.name === 'Dratini') || candidates[0] || null;
  return candidates[0] || null;
}

async function executeFullMatch(fixture, seed, coinFlip, options = {}) {
  const runner = createEngineRunner(fixture, seed);
  runner.api.setup(fixture, runner.random, request => choiceDriver(request, options), coinFlip);
  const opening = runner.api.state();
  assert.equal(opening.phase, 'play');
  assert.equal(opening.players.you.prizes.length, 6);
  assert.equal(opening.players.codex.prizes.length, 6);
  for (const side of ['you', 'codex']) {
    assert.ok(opening.players[side].active && ['Basic', ''].includes(opening.players[side].active.meta.stage));
    assert.ok(opening.players[side].bench.length <= 5);
  }
  assert.equal(runner.api.snapshot().firstPlayerCannotAttack, true, 'the actual engine must enforce the opening first-turn attack restriction');
  const initialOwner = new Map();
  for (const side of ['you', 'codex']) for (const card of countOwnedCards(runner.api.state(), side)) if (card.id) initialOwner.set(card.id, side);
  let steps = 0;
  const events = [], promotions = [], attackPrints = [];
  if (options.beforeTurns) await options.beforeTurns({ runner, events, attackPrints });
  while (runner.api.phase() === 'play' && steps++ < 1800) {
    const game = runner.api.state();
    assertStateInvariants(game, initialOwner);
    if (game.pendingPromotion) {
      const side = game.pendingPromotion, turnNumber = game.turnNumber;
      const oldLog = new Set(game.log);
      await runner.api.promote();
      events.push(...runner.api.state().log.filter(entry => !oldLog.has(entry)).map(entry => entry.message));
      promotions.push({ side, turnNumber, step: steps, activeAfter: runner.api.state().players[side].active?.name || null, phaseAfter: runner.api.phase() });
      continue;
    }
    if (game.turn === 'codex') {
      const oldLog = new Set(game.log);
      const activeBefore = game.players.codex.active ? { id: game.players.codex.active.id, name: game.players.codex.active.name, setCode: game.players.codex.active.setCode, cardNumber: game.players.codex.active.cardNumber, evolutionStack: (game.players.codex.active.evolutionStack || []).map(stage => ({ name: stage.name, setCode: stage.setCode, cardNumber: stage.cardNumber })) } : null;
      const attackTurnNumber = game.turnNumber;
      await runner.api.aiStep();
      const added = runner.api.state().log.filter(entry => !oldLog.has(entry)).map(entry => entry.message);
      events.push(...added);
      for (const message of added.filter(entry => /used (?:Dragon Pulse|Energy Hurricane|Dragon Claw|Mighty Meteor|Quick Attack)/.test(entry))) {
        const attack = message.match(/used (Dragon Pulse|Energy Hurricane|Dragon Claw|Mighty Meteor|Quick Attack)/)?.[1];
        const coinFace = added.map(entry => entry.match(new RegExp(`${attack}: (heads|tails)`, 'i'))?.[1]?.toLowerCase()).find(Boolean) || null;
        const postAttacker = runner.api.state().players.codex.active;
        attackPrints.push({ ...activeBefore, attack, turnNumber: attackTurnNumber, coinFace: attack === 'Mighty Meteor' ? coinFace : null, lockUntilTurn: postAttacker?.id === activeBefore?.id ? Number(postAttacker.cannotAttackUntilTurn || 0) : null });
      }
    } else {
      const snapshot = runner.api.snapshot();
      const actions = snapshot.players.you.legalActions;
      const order = ['play_basic', 'evolve', 'attach_energy', 'play_item', 'play_supporter', 'attack', 'end_turn'];
      const action = order.map(type => actions.find(item => item.type === type)).find(Boolean);
      assert.ok(action, 'the human side must have at least one legal action');
      const oldLog = new Set(game.log);
      await runner.api.humanAction(action);
      events.push(...runner.api.state().log.filter(entry => !oldLog.has(entry)).map(entry => entry.message));
    }
    assertStateInvariants(runner.api.state(), initialOwner);
    assert.equal(runner.api.pendingChoices(), false, 'a completed engine action must not leave an unresolved modal choice');
  }
  const result = runner.api.state();
  assert.equal(result.phase, 'finished', `seed ${seed} did not reach a rules-based terminal state within ${steps} engine actions`);
  assert.ok(result.winner === 'you' || result.winner === 'codex', 'match result must come from an engine win condition');
  assertStateInvariants(result, initialOwner);
  return { result, events, promotions, attackPrints, steps, firstPlayer: result.firstPlayer, mulligans: { you: opening.players.you.mulligans, codex: opening.players.codex.mulligans, youBonus: opening.players.you.bonusDraws, codexBonus: opening.players.codex.bonusDraws } };
}

test('fixture preflight validates every deck print and recomputes support against the current engine', t => {
  const fixture = loadFixture();
  assert.equal(fixture.decks.human.name, 'Iono Fan');
  assert.equal(fixture.decks.ai.name, 'Peter Dragonite');
  assert.equal(fixture.cards.length, 40);
  assert.ok(fixture.cards.every(card => card.language === 'en'));
  const missingSources = fixture.cards.filter(card => !card.meta.source);
  const noArtwork = fixture.cards.filter(card => !card.meta.image);
  t.diagnostic(`Fixture preflight: 60 cards per deck, ${fixture.cards.length} unique prints, English language recorded on all records; ${missingSources.length} records lack a metadata-source label; ${noArtwork.length} Basic Energy records have no card image.`);
  const runner = createEngineRunner(fixture, 99);
  const live = runner.api.inspectFixture(fixture);
  const operationCards = new Map(live.filter(card => ['Nest Ball', 'Rare Candy', 'Switch', 'Energy Switch'].includes(card.name)).map(card => [card.name, card]));
  assert.equal(operationCards.get('Nest Ball').effect.operation, 'searchAndMove');
  assert.equal(operationCards.get('Switch').effect.operation, 'switchPositions');
  assert.equal(operationCards.get('Energy Switch').effect.operation, 'transferAttachedEnergy');
  // MEG 125 now has independently verified complete printed text.
  assert.equal(operationCards.get('Rare Candy').resolution, 'automated');
  assert.equal(operationCards.get('Rare Candy').effect.operation, 'evolve');
  const dratini = live.find(card => card.name === 'Dratini' && card.setCode === 'OBF' && card.cardNumber === '157');
  assert.equal(dratini.resolution, 'automated', 'verified Dratini OBF 157 metadata enables its effect-free Tail Snap');
  assert.equal(dratini.handler.attacks.length, 1);
  assert.equal(dratini.handler.attacks[0].handler, 'none');
  assert.equal(fixture.cards.find(card => card.setCode === 'OBF' && card.cardNumber === '157').meta.attacks[0].effectTextStatus, 'explicit-empty');
  const dragonair = live.find(card => card.name === 'Dragonair' && card.setCode === 'ASC' && card.cardNumber === '151');
  assert.equal(dragonair.handler.attacks[0].handler, 'none');
  assert.equal(dragonair.handler.abilities[0].handler, 'search_evolution_pokemon');
  assert.equal(dragonair.resolution, 'automated');
  const dragonite = live.find(card => card.name === 'Dragonite' && card.setCode === 'SIT' && card.cardNumber === '131');
  assert.equal(dragonite.handler.attacks.find(attack => attack.name === 'Dragon Claw').handler, 'none');
  assert.equal(dragonite.handler.attacks.find(attack => attack.name === 'Energy Hurricane').handler, 'search_attach_basic_energy');
  assert.equal(dragonite.resolution, 'automated', 'both attacks are covered for this exact print');
  assert.equal(dragonite.implementationStatus, 'implemented');
  const dragonPulse = live.find(card => card.name === 'Dragonite' && card.setCode === 'MEW' && card.cardNumber === '149');
  assert.equal(dragonPulse.handler.attacks.find(attack => attack.name === 'Dragon Pulse').handler, 'discard_top_cards');
  assert.equal(dragonPulse.resolution, 'automated');
  const dragoniteEx = live.find(card => card.name === 'Dragonite ex' && card.setCode === 'OBF' && card.cardNumber === '159');
  assert.equal(dragoniteEx.handler.attacks.find(attack => attack.name === 'Mighty Meteor').handler, 'coin_bonus_and_attack_lock');
  assert.equal(dragoniteEx.handler.attacks.find(attack => attack.name === 'Wing Attack').handler, 'none', 'Wing Attack metadata was independently verified');
  for (const card of fixture.cards) {
    const liveCard = live.find(item => item.setCode === card.setCode && item.cardNumber === card.cardNumber && item.name === card.name);
    assert.ok(liveCard, `live engine registry should inspect ${card.name}`);
    assert.equal(card.effectResolution, liveCard.resolution, `${card.name} has refreshed effect support status`);
    assert.equal(card.implementationStatus, liveCard.implementationStatus, `${card.name} has refreshed implementation status`);
    assert.equal(JSON.stringify(card.handlers), JSON.stringify(liveCard.handler), `${card.name} handler metadata matches the current engine`);
  }
});

test('seeded real-engine matches initialize, evolve, use supported Items, and reach legitimate terminal states', async t => {
  const fixture = loadFixture();
  const results = [];
  for (const seed of [2, 8, 17]) results.push(await executeFullMatch(fixture, seed));
  assert.equal(results.length, 3);
  for (const match of results) {
    const prizesTaken = match.events.reduce((total, message) => total + Number(message.match(/took (\d+) Prize card/i)?.[1] || 0), 0);
    assert.equal(match.result.players.you.prizes.length + match.result.players.codex.prizes.length + prizesTaken, 12, 'remaining Prizes plus actual Prize cards taken must equal the original twelve');
    assert.ok(match.result.log.some(entry => /wins — (?:the active player could not draw|all Prize cards taken|no Pokémon left in play)/.test(entry.message)), 'matches must end through an actual Pokémon TCG win condition');
  }
  assert.ok(results.some(match => match.mulligans.you + match.mulligans.codex > 0), 'at least one deterministic game must exercise the actual mulligan path');
  t.diagnostic(`Complete matches: ${results.map((match, index) => `seed ${[2, 8, 17][index]} / first ${match.firstPlayer} → ${match.result.winner} at turn ${match.result.turnNumber} (${match.result.log.at(-1)?.message})`).join('; ')}. Each reached an engine-resolved win condition.`);
  assert.ok(results[0].events.some(message => message.includes('evolved')));
  assert.ok(results[0].events.some(message => message.includes('Nest Ball')));
  assert.ok(results.some(match => match.events.some(message => message.includes('Energy Switch'))));
  t.diagnostic(`The newly enabled attack path can now naturally produce a Knockout and Prize in a seeded run.`);
});

test('verified AI Tail Snap produces a real Knockout, Prize, promotion, and continued play in a complete match', async t => {
  const fixture = loadFixture();
  const match = await executeFullMatch(fixture, 2, () => true);
  const tailSnap = match.events.filter(message => message.includes('Tail Snap'));
  assert.ok(tailSnap.some(message => /used Tail Snap with Dratini for 20 damage/i.test(message)), 'AI must use Dratini OBF 157 through the normal attack handler');
  assert.ok(match.events.some(message => /Toma[’']s .* was Knocked Out\./i.test(message)), 'the match must include an engine-resolved Knockout');
  assert.ok(match.events.some(message => /Yami took 1 Prize card\./i.test(message)), 'the attacking AI must take its Prize from its own Prize pile');
  const promotion = match.promotions.find(entry => entry.side === 'you');
  assert.ok(promotion, 'the defender must promote a Benched Pokémon after the Knockout');
  assert.ok(promotion.activeAfter, 'a legal Benched Pokémon becomes Active');
  assert.equal(promotion.phaseAfter, 'play');
  assert.ok(match.steps > promotion.step + 2, 'the match must continue through further engine actions after promotion');
  assert.equal(match.result.phase, 'finished', 'the scenario must eventually reach an engine-derived terminal state');
  t.diagnostic(`Complete attack match: seed 2; Yami used Dratini OBF 157 Tail Snap ${tailSnap.length} times; ${match.promotions.length} promotions; ended by the engine with “${match.result.log[0].message}”.`);
});

test('Dragonair ASC 151 Tail Snap is used by AI in a complete match with normal Knockout and Prize flow', async t => {
  const fixture = loadFixture();
  const match = await executeFullMatch(fixture, 1, () => true, {
    beforeTurns: async ({runner}) => {
      const {players:{you,codex}} = runner.api.state();
      await runner.api.endTurnFor('you');
      const dragonair = runner.api.prepareAttack('codex','ASC','151',['Water','Lightning']);
      dragonair.evolvedTurn = runner.api.state().turnNumber;
      codex.deck.push(...codex.hand);
      codex.hand = [];
      assert.ok(you.bench.length, 'the defender has a legal promotion target');
      you.active.damage = Math.max(0,runner.api.effectiveHp(you.active) - 60);
    }
  });
  assert.ok(match.events.some(message => /Yami used Tail Snap with Dragonair for 60 damage/.test(message)), 'AI must use Dragonair Tail Snap through the actual attack pipeline');
  assert.ok(match.events.some(message => /Toma[’']s .* was Knocked Out\./i.test(message)), 'the match must include an engine-resolved Knockout');
  assert.ok(match.events.some(message => /Yami took 1 Prize card\./i.test(message)), 'the attacker must take the Prize through normal Knockout handling');
  const promotion = match.promotions.find(entry => entry.side === 'you');
  assert.ok(promotion?.activeAfter, 'the human must promote a Benched Pokémon');
  assert.equal(promotion.phaseAfter, 'play');
  assert.ok(match.steps > promotion.step + 2, 'play must continue after promotion');
  assert.equal(match.result.phase, 'finished');
  t.diagnostic(`Complete Dragonair attack match: seed 1 with a prepared attacker; AI Tail Snap dealt 60 damage ${match.events.filter(message => /Tail Snap with Dragonair for 60 damage/.test(message)).length} times; Knockout, Prize, promotion, and continued play occurred before ${match.result.winner} won.`);
});

function prepareDragonairEvolution(setCode, energyTypes) {
  return async ({runner}) => {
    await runner.api.endTurnFor('you');
    const {players:{codex},turnNumber} = runner.api.state();
    const dragonair = runner.api.prepareAttack('codex','ASC','151',energyTypes);
    dragonair.abilityUses = {[dragonair.meta.abilities[0].name]:turnNumber};
    codex.deck.push(...codex.hand);
    const index = codex.deck.findIndex(card => card.name === 'Dragonite' && card.setCode === setCode);
    assert.ok(index >= 0, 'the prepared seed has the evolution available');
    codex.hand = codex.deck.splice(index,1);
  };
}

test('Dragonite SIT 131 evolves and uses Dragon Claw in a deterministic complete match', async t => {
  const fixture = loadFixture();
  const seed = 1, match = await executeFullMatch(fixture, seed, () => true, {
    beforeTurns:prepareDragonairEvolution('SIT',['Lightning','Lightning','Lightning'])
  });
  assert.ok(match.attackPrints.some(print => print.setCode === 'SIT' && print.cardNumber === '131' && print.attack === 'Dragon Claw'), 'the deterministic match must still exercise Dragon Claw after Energy Hurricane is enabled');
  const evolutionIndex = match.events.findIndex(message => /Yami evolved Dragonair into Dragonite/.test(message));
  const attackIndex = match.events.findIndex(message => /Yami used Dragon Claw with Dragonite for 80 damage/.test(message));
  assert.ok(evolutionIndex >= 0, 'the AI must evolve into Dragonite through normal gameplay');
  assert.ok(attackIndex > evolutionIndex, 'Dragonite must use Dragon Claw after evolving');
  assert.ok(match.events.some(message => /was Knocked Out\./i.test(message)), 'any Knockouts must arise through normal match gameplay');
  assert.ok(match.events.some(message => /took \d+ Prize card/i.test(message)), 'Prize collection must use normal Knockout resolution');
  assert.equal(match.result.phase, 'finished', 'the match must reach a legitimate engine terminal state');
  assert.ok(match.result.winner === 'you' || match.result.winner === 'codex');
  t.diagnostic(`Complete Dragon Claw match: seed ${seed}; Yami evolved Dragonair into Dragonite, used Dragon Claw ${match.events.filter(message => /Yami used Dragon Claw with Dragonite for 80 damage/.test(message)).length} times, and the match naturally resolved Knockouts, Prizes, and an engine-derived ending.`);
});

test('Dragonite MEW 149 evolves and uses Dragon Pulse in a complete match through the real engine', async t => {
  const fixture = loadFixture();
  const seed = 1, match = await executeFullMatch(fixture, seed, () => true, {
    beforeTurns:prepareDragonairEvolution('MEW',['Water','Lightning'])
  });
  assert.ok(match.attackPrints.some(print => print.setCode === 'MEW' && print.cardNumber === '149' && print.attack === 'Dragon Pulse'), 'AI must use the exact MEW 149 printing');
  const attackIndex = match.events.findIndex(message => /Yami used Dragon Pulse with Dragonite for 180 damage/.test(message));
  const discardIndex = match.events.findIndex(message => /Yami discarded the top 2 cards of the deck for Dragon Pulse/.test(message));
  assert.ok(attackIndex >= 0, 'AI must use the verified Dragon Pulse through the normal attack handler');
  assert.ok(discardIndex >= 0, 'the engine must discard two cards from the AI deck for Dragon Pulse');
  assert.ok(match.result.turnNumber > match.attackPrints.find(print => print.setCode === 'MEW' && print.cardNumber === '149').turnNumber, 'the match must continue after Dragon Pulse');
  assert.equal(match.result.phase, 'finished', 'the match must reach a rules-derived terminal state');
  assert.ok(match.result.winner === 'you' || match.result.winner === 'codex');
  assert.ok(match.result.players.codex.discard.length > 0, 'the AI discard pile retains cards after its own deck discard');
  const pulse = match.attackPrints.find(print => print.setCode === 'MEW' && print.cardNumber === '149' && print.attack === 'Dragon Pulse');
  assert.ok(pulse.evolutionStack.some(stage => stage.name === 'Dragonair'), 'the attack must follow a normal Dragonair evolution');
  assert.ok(match.events.some(message => /was Knocked Out\./i.test(message)), 'the complete match must resolve a normal Knockout');
  assert.ok(match.events.some(message => /Yami took \d+ Prize card/i.test(message) || /Toma took \d+ Prize card/i.test(message)), 'Prize collection must remain in the normal match flow');
  assert.ok(match.promotions.some(promotion => promotion.activeAfter && promotion.phaseAfter === 'play'), 'a Knockout promotion must complete and the match continue');
  assertStateInvariants(match.result);
  t.diagnostic(`Complete Dragon Pulse match: seed ${seed}; Yami used Dragon Pulse with exact printing MEW 149, discarded the top two cards, continued playing, and reached an engine-derived ending.`);
});

test('Dragonite SIT 131 uses Energy Hurricane in a complete deterministic match', async t => {
  const fixture = loadFixture();
  const seed = 4, match = await executeFullMatch(fixture, seed, () => true);
  assert.ok(match.attackPrints.some(print => print.setCode === 'SIT' && print.cardNumber === '131' && print.attack === 'Energy Hurricane'), 'the AI must use the exact SIT 131 printing');
  const hurricane = match.attackPrints.find(print => print.setCode === 'SIT' && print.cardNumber === '131' && print.attack === 'Energy Hurricane');
  assert.equal(hurricane.name, 'Dragonite');
  assert.ok(match.events.some(message => /Yami used Energy Hurricane with Dragonite for 180 damage/.test(message)));
  assert.ok(match.events.some(message => /Yami used Energy Hurricane to attach .* then shuffled/.test(message)), 'the engine must search, attach Energy, and shuffle');
  assert.ok(match.result.turnNumber > hurricane.turnNumber, 'the match continues after the attack');
  assert.ok(match.events.some(message => /was Knocked Out\./i.test(message)), 'the match must retain normal Knockout handling');
  assert.ok(match.events.some(message => /Yami took \d+ Prize card/i.test(message) || /Toma took \d+ Prize card/i.test(message)), 'the match must retain normal Prize collection');
  assert.ok(match.promotions.some(promotion => promotion.activeAfter && promotion.phaseAfter === 'play'), 'promotion must finish and play must continue');
  assert.equal(match.result.phase, 'finished');
  assertStateInvariants(match.result);
  t.diagnostic(`Complete Energy Hurricane match: seed ${seed}; the AI used Dragonite SIT 131, attached searched Basic Energy, shuffled, and continued to a rules-derived result.`);
});

test('complete match resolves Mighty Meteor heads through the real engine', async t => {
  const fixture = loadFixture();
  let match = null, seed = null;
  for (let candidate = 1; candidate <= 60; candidate++) {
    const result = await executeFullMatch(fixture, candidate, () => true);
    if (result.attackPrints.some(print => print.setCode === 'OBF' && print.cardNumber === '159' && print.attack === 'Mighty Meteor' && print.coinFace === 'heads' && print.turnNumber < result.result.turnNumber)) { match = result; seed = candidate; break; }
  }
  assert.ok(match, 'a seeded complete match must naturally use Mighty Meteor with heads');
  const attack = match.attackPrints.find(print => print.setCode === 'OBF' && print.cardNumber === '159' && print.attack === 'Mighty Meteor' && print.coinFace === 'heads');
  assert.ok(match.events.some(message => /Mighty Meteor: heads/.test(message)));
  assert.ok(match.events.some(message => /Yami used Mighty Meteor with Dragonite ex for 280 damage/.test(message)));
  assert.equal(attack.lockUntilTurn, 0, 'heads creates no next-turn attack restriction');
  assert.ok(match.result.turnNumber > attack.turnNumber, 'the match continues after the attack');
  assert.equal(match.result.phase, 'finished');
  assertStateInvariants(match.result);
  t.diagnostic(`Complete Mighty Meteor heads match: seed ${seed}; OBF 159 dealt 280 damage and the match continued to its rules-derived result.`);
});

test('complete match resolves Mighty Meteor tails and enforces the next-turn restriction', async t => {
  const fixture = loadFixture();
  let match = null, seed = null;
  for (let candidate = 1; candidate <= 60; candidate++) {
    const result = await executeFullMatch(fixture, candidate, () => false);
    if (result.attackPrints.some(print => print.setCode === 'OBF' && print.cardNumber === '159' && print.attack === 'Mighty Meteor' && print.coinFace === 'tails' && print.turnNumber < result.result.turnNumber)) { match = result; seed = candidate; break; }
  }
  assert.ok(match, 'a seeded complete match must naturally use Mighty Meteor with tails');
  const attack = match.attackPrints.find(print => print.setCode === 'OBF' && print.cardNumber === '159' && print.attack === 'Mighty Meteor' && print.coinFace === 'tails');
  assert.ok(match.events.some(message => /Yami used Mighty Meteor with Dragonite ex for 140 damage/.test(message)));
  assert.equal(attack.lockUntilTurn, attack.turnNumber + 2, 'tails locks this exact Pokémon through its controller’s next turn');
  assert.equal(match.attackPrints.some(print => print.id === attack.id && print.turnNumber === attack.lockUntilTurn), false, 'the locked Dragonite ex cannot attack on the next turn');
  assert.ok(match.result.turnNumber > attack.turnNumber, 'the match continues after the tails result');
  assert.equal(match.result.phase, 'finished');
  assertStateInvariants(match.result);
  t.diagnostic(`Complete Mighty Meteor tails match: seed ${seed}; OBF 159 dealt 140 damage, was unable to attack during its next turn, and play continued to an engine-derived ending.`);
});

async function executeWattrelFullMatch(heads) {
  const fixture = loadFixture();
  let flips = 0;
  const coinFlip = () => flips++ === 0 ? false : heads;
  const match = await executeFullMatch(fixture, 7, coinFlip, {
    beforeTurns: async ({ runner, events, attackPrints }) => {
      runner.api.setLocalAi(false);
      assert.equal(runner.api.state().turn, 'codex', 'scripted setup coin places Yami first');
      await runner.api.endTurnFor('codex');
      assert.equal(runner.api.state().turn, 'you');
      const human = runner.api.state().players.you;
      const moved = human.bench.filter(card => card.setCode === 'ASC' && card.cardNumber === '71');
      human.bench = human.bench.filter(card => !(card.setCode === 'ASC' && card.cardNumber === '71'));
      human.deck.push(...moved);
      const attacker = runner.api.prepareAttack('you', 'ASC', '71', ['Lightning']);
      const turnNumber = runner.api.state().turnNumber;
      const target = runner.api.state().players.codex.active, targetDamageBefore = Number(target.damage || 0);
      const option = runner.api.attackOptions('you').find(item => item.attack.name === 'Quick Attack');
      assert.ok(option, 'the second player may attack with its legal Active Pokémon');
      const oldLog = new Set(runner.api.state().log);
      await runner.api.attack('you', option.index);
      const added = runner.api.state().log.filter(entry => !oldLog.has(entry)).map(entry => entry.message);
      events.push(...added);
      assert.ok(added.includes(`Toma used Quick Attack with Iono's Wattrel for ${heads ? 30 : 10} damage.`));
      const coinFace = added.map(message => message.match(/Quick Attack: (heads|tails)/i)?.[1]?.toLowerCase()).find(Boolean) || null;
      const damageApplied = Number(target.damage || 0) - targetDamageBefore;
      assert.ok(damageApplied >= (heads ? 30 : 10), 'the engine must apply the conditional attack damage to the opposing Active Pokémon');
      attackPrints.push({ id: attacker.id, name: attacker.name, setCode: attacker.setCode, cardNumber: attacker.cardNumber, attack: 'Quick Attack', turnNumber, coinFace, damageApplied });
      runner.api.setLocalAi(true);
    }
  });
  return { match, seed: 7 };
}

test('complete match resolves Iono’s Wattrel ASC 71 Quick Attack heads through the real engine', async t => {
  const { match, seed } = await executeWattrelFullMatch(true);
  const attack = match.attackPrints.find(print => print.setCode === 'ASC' && print.cardNumber === '71' && print.attack === 'Quick Attack' && print.coinFace === 'heads');
  assert.ok(attack, 'Yami must use the exact ASC 71 attack with heads');
  assert.ok(match.events.includes('Quick Attack: heads.'));
  assert.ok(match.events.includes("Toma used Quick Attack with Iono's Wattrel for 30 damage."));
  assert.ok(match.result.turnNumber > attack.turnNumber, 'the game continues beyond the attack');
  assert.equal(match.result.phase, 'finished');
  assertStateInvariants(match.result);
  t.diagnostic(`Complete Quick Attack heads match: seed ${seed}; ASC 71 dealt 30 damage and play continued to a rules-derived result.`);
});

test('complete match resolves Iono’s Wattrel ASC 71 Quick Attack tails through the real engine', async t => {
  const { match, seed } = await executeWattrelFullMatch(false);
  const attack = match.attackPrints.find(print => print.setCode === 'ASC' && print.cardNumber === '71' && print.attack === 'Quick Attack' && print.coinFace === 'tails');
  assert.ok(attack, 'Yami must use the exact ASC 71 attack with tails');
  assert.ok(match.events.includes('Quick Attack: tails.'));
  assert.ok(match.events.includes("Toma used Quick Attack with Iono's Wattrel for 10 damage."));
  assert.ok(match.result.turnNumber > attack.turnNumber, 'the game continues beyond the attack');
  assert.equal(match.result.phase, 'finished');
  assertStateInvariants(match.result);
  t.diagnostic(`Complete Quick Attack tails match: seed ${seed}; ASC 71 dealt 10 damage and play continued to a rules-derived result.`);
});

test('prepared Drampa OBF 161 Outrage resolves before a legitimate full-match ending', async t => {
  const fixture = loadFixture();
  const match = await executeFullMatch(fixture, 1, () => true, {
    beforeTurns: async ({ runner, events, attackPrints }) => {
      runner.api.setLocalAi(false);
      assert.equal(runner.api.state().turn, 'you');
      await runner.api.endTurnFor('you');
      assert.equal(runner.api.state().turn, 'codex');
      assert.ok(runner.api.state().players.you.bench.length > 0, 'the deterministic setup supplies a legal human promotion target after the prepared Knockout');
      const codex = runner.api.state().players.codex;
      const moved = codex.bench.filter(card => card.setCode === 'OBF' && card.cardNumber === '161');
      codex.bench = codex.bench.filter(card => !(card.setCode === 'OBF' && card.cardNumber === '161'));
      codex.deck.push(...moved);
      const attacker = runner.api.prepareAttack('codex', 'OBF', '161', ['Lightning', 'Water']);
      attacker.damage = 20; // Prepared state: two existing damage counters on Drampa.
      codex.deck.push(...codex.hand); codex.hand = [];
      runner.api.setLocalAi(true);
      const turnNumber = runner.api.state().turnNumber;
      const target = runner.api.state().players.you.active, damageBefore = Number(target.damage || 0);
      let added = [];
      for (let tries = 0; tries < 24 && runner.api.state().turn === 'codex' && !added.some(message => /used Outrage with Drampa/.test(message)); tries++) {
        const oldLog = new Set(runner.api.state().log);
        await runner.api.aiStep();
        added.push(...runner.api.state().log.filter(entry => !oldLog.has(entry)).map(entry => entry.message));
      }
      events.push(...added);
      assert.ok(added.includes('Yami used Outrage with Drampa for 80 damage.'), 'AI must resolve the prepared attack through the real damage pipeline');
      const damageApplied = Number(target.damage || 0) - damageBefore;
      assert.ok(damageApplied >= 80, 'the two counters on Drampa must raise Outrage from 60 to 80 damage');
      attackPrints.push({ id: attacker.id, name: attacker.name, setCode: attacker.setCode, cardNumber: attacker.cardNumber, attack: 'Outrage', turnNumber, damageApplied, preparedDamageCounters: 2 });
      runner.api.setLocalAi(true);
    }
  });
  const outrage = match.attackPrints.find(print => print.setCode === 'OBF' && print.cardNumber === '161' && print.attack === 'Outrage');
  assert.ok(outrage);
  assert.equal(outrage.preparedDamageCounters, 2);
  assert.ok(match.events.some(message => /Yami used Outrage with Drampa for 80 damage/.test(message)));
  assert.equal(match.result.phase, 'finished', 'the match must reach a legitimate engine-derived ending');
  const promotion = match.promotions.find(entry => entry.side === 'you');
  assert.ok(promotion?.activeAfter, 'the human promotes after the prepared Outrage Knockout');
  assert.equal(promotion.phaseAfter, 'play');
  assert.ok(match.steps > promotion.step, 'the engine continues match processing after promotion');
  assert.ok(match.result.log.some(entry => /wins — (?:all Prize cards taken|no Pokémon left in play|the active player could not draw)/.test(entry.message)), 'match ends through an actual win condition');
  assertStateInvariants(match.result);
  t.diagnostic(`Prepared full match: seed 1; Yami Drampa OBF 161 started with two damage counters and dealt 80 Outrage damage; final result: ${match.result.log[0]?.message}`);
});

test('prepared Iono board resolves JTG 47 Voltaic Chain before a legitimate full-match ending', async t => {
  const fixture = loadFixture();
  const match = await executeFullMatch(fixture, 1, () => false, {
    beforeTurns: async ({ runner, events, attackPrints }) => {
      runner.api.setLocalAi(false);
      assert.equal(runner.api.state().turn, 'codex', 'seeded setup has Yami act first');
      await runner.api.endTurnFor('codex');
      assert.equal(runner.api.state().turn, 'you');
      const human = runner.api.state().players.you;
      const movedVoltorbs = human.bench.filter(card => card.setCode === 'JTG' && card.cardNumber === '47');
      human.bench = human.bench.filter(card => !(card.setCode === 'JTG' && card.cardNumber === '47'));
      human.deck.push(...movedVoltorbs);
      const attacker = runner.api.prepareAttack('you', 'JTG', '47', ['Lightning', 'Lightning']);
      let support = human.bench.find(card => card.name.startsWith("Iono's "));
      if (!support) {
        const zones = ['hand', 'deck', 'discard', 'prizes']; let card = null;
        for (const zoneName of zones) {
          const zone = human[zoneName], index = zone.findIndex(item => item.meta?.category === 'Pokemon' && item.name.startsWith("Iono's ") && item.id !== attacker.id);
          if (index >= 0) { card = zone.splice(index, 1)[0]; break; }
        }
        assert.ok(card, 'prepared setup must find another Iono Pokémon');
        if (human.bench.length >= 5) human.deck.push(human.bench.pop());
        human.bench.push(card); support = card;
      }
      const energyIndex = human.deck.findIndex(card => card.meta?.category === 'Energy' && String(card.meta?.energyType || '').toLowerCase() === 'lightning');
      assert.notEqual(energyIndex, -1, 'prepared setup needs a Basic Lightning Energy for another Iono Pokémon');
      support.energy.push(human.deck.splice(energyIndex, 1)[0]);
      const turnNumber = runner.api.state().turnNumber;
      const target = runner.api.state().players.codex.active, targetDamageBefore = Number(target.damage || 0);
      const option = runner.api.attackOptions('you').find(item => item.attack.name === 'Voltaic Chain');
      assert.ok(option);
      const oldLog = new Set(runner.api.state().log);
      await runner.api.attack('you', option.index);
      const added = runner.api.state().log.filter(entry => !oldLog.has(entry)).map(entry => entry.message);
      events.push(...added);
      assert.ok(added.includes("Toma used Voltaic Chain with Iono's Voltorb for 80 damage."), 'two payment Energy and one Energy on the Iono Bench Pokémon produce three increments over base damage');
      const damageApplied = Number(target.damage || 0) - targetDamageBefore;
      assert.ok(damageApplied >= 80);
      attackPrints.push({ id: attacker.id, name: attacker.name, setCode: attacker.setCode, cardNumber: attacker.cardNumber, attack: 'Voltaic Chain', turnNumber, damageApplied, qualifyingEnergy: 3 });
      runner.api.setLocalAi(true);
    }
  });
  const voltaic = match.attackPrints.find(print => print.setCode === 'JTG' && print.cardNumber === '47' && print.attack === 'Voltaic Chain');
  assert.ok(voltaic);
  assert.equal(voltaic.qualifyingEnergy, 3);
  assert.ok(match.events.some(message => /Toma used Voltaic Chain with Iono's Voltorb for 80 damage/.test(message)));
  assert.ok(match.result.turnNumber > voltaic.turnNumber, 'the match continues after the prepared attack');
  assert.equal(match.result.phase, 'finished');
  assert.match(match.result.log[0]?.message || '', /wins — (?:all Prize cards taken|no Pokémon left in play|the active player could not draw)/);
  assertStateInvariants(match.result);
  t.diagnostic(`Prepared full match: seed 1; Iono's Voltorb JTG 47 used two attached Lightning Energy to pay its Colorless cost and counted one more Lightning Energy on a different Iono Pokémon, dealing 80 damage; match reached ${match.result.log[0]?.message}`);
});

test('prepared Iono Bellibolt uses Thunderous Bolt, observes its next-turn lock, then reaches a rules-derived match ending', async t => {
  const fixture = loadFixture();
  const match = await executeFullMatch(fixture, 1, () => false, {
    beforeTurns: async ({ runner, events, attackPrints }) => {
      runner.api.setLocalAi(false);
      assert.equal(runner.api.state().turn, 'codex', 'seeded setup gives Yami the first turn');
      await runner.api.endTurnFor('codex');
      assert.equal(runner.api.state().turn, 'you');

      const attacker = runner.api.prepareAttack('you', 'ASC', '279', ['Lightning', 'Lightning', 'Lightning', 'Lightning']);
      const target = runner.api.prepareAttack('codex', 'ASC', '152', []);
      target.meta.weaknesses = [];
      target.meta.resistances = [];
      runner.api.state().turn = 'you';
      const turnNumber = runner.api.state().turnNumber;
      const damageBefore = Number(target.damage || 0);
      const option = runner.api.attackOptions('you').find(item => item.attack.name === 'Thunderous Bolt');
      assert.ok(option, 'the prepared English ASC 279 attack must be legal');
      const previousLogLength = runner.api.state().log.length;
      assert.equal(await runner.api.attack('you', option.index), true);
      const applied = Number(target.damage || 0) - damageBefore;
      assert.equal(applied, 230);
      assert.equal(attacker.cannotAttackUntilTurn, turnNumber + 2);
      assert.equal(runner.api.state().turn, 'codex');
      events.push(...runner.api.state().log.slice(previousLogLength).map(entry => entry.message));
      attackPrints.push({ id: attacker.id, name: attacker.name, setCode: attacker.setCode, cardNumber: attacker.cardNumber, attack: 'Thunderous Bolt', turnNumber, damageApplied: applied, lockUntilTurn: attacker.cannotAttackUntilTurn });

      await runner.api.endTurnFor('codex');
      assert.equal(runner.api.state().turn, 'you');
      assert.equal(runner.api.state().turnNumber, turnNumber + 2);
      assert.equal(runner.api.canUseAttack(attacker, option.attack), false, 'the restriction applies on Bellibolt’s controller’s next turn');
      assert.equal(runner.api.attackOptions('you').some(item => item.attack.name === 'Thunderous Bolt'), false);

      await runner.api.endTurnFor('you');
      await runner.api.endTurnFor('codex');
      assert.equal(runner.api.state().turn, 'you');
      assert.equal(runner.api.state().turnNumber, turnNumber + 4);
      assert.equal(runner.api.canUseAttack(attacker, option.attack), true, 'the restriction expires after that turn passes');
      runner.api.setLocalAi(true);
    }
  });
  const bolt = match.attackPrints.find(print => print.setCode === 'ASC' && print.cardNumber === '279' && print.attack === 'Thunderous Bolt');
  assert.ok(bolt);
  assert.equal(bolt.damageApplied, 230);
  assert.equal(bolt.lockUntilTurn, bolt.turnNumber + 2);
  assert.ok(match.events.some(message => /Toma used Thunderous Bolt with Iono's Bellibolt ex for 230 damage/.test(message)));
  assert.equal(match.result.phase, 'finished');
  assert.ok(match.result.winner === 'you' || match.result.winner === 'codex');
  assertStateInvariants(match.result);
  t.diagnostic(`Prepared full match: seed 13; Toma’s Iono's Bellibolt ex ASC 279 dealt 230 damage, allowed Yami’s turn, was blocked on its next turn, then recovered; the match ended with ${match.result.winner} winning through normal game rules.`);
});

test('real setup assigns six Prizes each and actual Dratini attack path can complete a Knockout promotion', async () => {
  const fixture = loadFixture();
  const runner = createEngineRunner(fixture, 2);
  runner.api.setup(fixture, runner.random, choiceDriver, () => true);
  let game = runner.api.state();
  assert.equal(game.firstPlayer, 'you');
  assert.equal(game.players.you.prizes.length, 6);
  assert.equal(game.players.codex.prizes.length, 6);
  assert.equal(game.players.codex.active.name, 'Dratini', 'the deterministic opening hand should produce Dratini Active without changing the board directly');
  const attacker = runner.api.state().players.codex.active;
  const userTarget = runner.api.state().players.you.active;
  let setupSteps = 0;
  while (!runner.api.state().players.you.bench.length && setupSteps++ < 12) {
    game = runner.api.state();
    if (game.turn === 'you') {
      const basic = runner.api.snapshot().players.you.legalActions.find(action => action.type === 'play_basic');
      if (basic) await runner.api.humanAction(basic);
      else await runner.api.endTurnFor('you');
    } else await runner.api.endTurnFor('codex');
  }
  assert.ok(runner.api.state().players.you.bench.length > 0, 'the promotion scenario requires a legal Bench choice');
  await runner.api.endTurnFor('you');
  game = runner.api.state();
  assert.equal(game.turn, 'codex');
  let energy = game.players.codex.hand.find(card => card.meta?.category === 'Energy');
  while (!energy && game.turnNumber < 8) {
    await runner.api.endTurnFor('codex');
    await runner.api.endTurnFor('you');
    game = runner.api.state();
    energy = game.players.codex.hand.find(card => card.meta?.category === 'Energy');
  }
  assert.ok(energy, 'Yami must draw an Energy through normal turns before the attack');
  assert.equal(runner.api.attachFor('codex', energy.id, attacker.id), undefined);
  if (runner.api.state().players.codex.turnsTaken === 0) {
    await runner.api.endTurnFor('codex');
    await runner.api.endTurnFor('you');
    game = runner.api.state();
  }
  const codexPrizesBefore = game.players.codex.prizes.length, humanPrizesBefore = game.players.you.prizes.length;
  let attackCount = 0;
  while (runner.api.state().players.you.active && !runner.api.state().pendingPromotion && attackCount++ < 5) {
    game = runner.api.state();
    const attack = runner.api.attackOptions('codex').find(option => option.attack.name === 'Tail Snap');
    assert.ok(attack, 'the verified Dratini attack must be available when its cost is met');
    await runner.api.attack('codex', attack.index);
    if (runner.api.state().pendingPromotion) break;
    await runner.api.endTurnFor('you');
  }
  game = runner.api.state();
  assert.equal(game.players.codex.prizes.length, codexPrizesBefore - 1);
  assert.equal(game.players.you.prizes.length, humanPrizesBefore);
  assert.equal(game.players.you.active, null);
  assert.equal(game.pendingPromotion, 'you');
  await runner.api.promote();
  game = runner.api.state();
  assert.ok(game.players.you.active);
  assert.equal(game.pendingPromotion, null);
  assertStateInvariants(game);
});

test('cancelled Nest Ball choice leaves the actual game state and Item card unchanged', async () => {
  const fixture = loadFixture();
  const runner = createEngineRunner(fixture, 5);
  runner.api.setup(fixture, runner.random, choiceDriver, () => false);
  runner.api.setLocalAi(false);
  const player = runner.api.state().players.codex;
  const nestIndex = player.deck.findIndex(card => card.setCode === 'PAF' && card.cardNumber === '84');
  assert.notEqual(nestIndex, -1, 'fixture deck contains Nest Ball PAF 84');
  const [nestBall] = player.deck.splice(nestIndex, 1);
  player.hand.push(nestBall);
  const deckBefore = Array.from(player.deck, card => card.id), handBefore = Array.from(player.hand, card => card.id), benchBefore = Array.from(player.bench, card => card.id);
  runner.api.setChoices(runner.random, request => request.kind === 'cards' ? null : choiceDriver(request));
  await runner.api.playCard('codex', nestBall.id);
  const after = runner.api.state().players.codex;
  assert.deepEqual(Array.from(after.deck, card => card.id), deckBefore);
  assert.deepEqual(Array.from(after.hand, card => card.id), handBefore);
  assert.deepEqual(Array.from(after.bench, card => card.id), benchBefore);
  assert.equal(runner.api.pendingChoices(), false);
  assertStateInvariants(runner.api.state());
});

test('an exact supported Supporter resolves through the actual game pipeline', async () => {
  const fixture = loadFixture();
  const runner = createEngineRunner(fixture, 11);
  runner.api.setup(fixture, runner.random, choiceDriver, () => true);
  let you = runner.api.state().players.you;
  const judgeIndex = you.deck.findIndex(card => card.setCode === 'SVI' && card.cardNumber === '176');
  assert.notEqual(judgeIndex, -1, 'fixture contains Judge SVI 176');
  const [judge] = you.deck.splice(judgeIndex, 1);
  you.hand.push(judge);
  await runner.api.endTurnFor('you');
  await runner.api.endTurnFor('codex');
  let game = runner.api.state();
  assert.equal(game.turn, 'you');
  assert.ok(game.players.you.turnsTaken > 0, 'the first-turn Supporter restriction has expired');
  assert.equal(runner.api.effectAudit().find(card => card.name === 'Judge' && card.setCode === 'SVI' && card.cardNumber === '176').resolution, 'automated');
  await runner.api.playCard('you', judge.id);
  game = runner.api.state();
  assert.equal(game.players.you.hand.length, 4);
  assert.equal(game.players.codex.hand.length, 4);
  assert.ok(game.players.you.discard.some(card => card.id === judge.id));
  assertStateInvariants(game);
});

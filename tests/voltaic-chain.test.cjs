const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadFixture, createEngineRunner } = require('./integration-harness.cjs');

const findVoltorb = fixture => fixture.cards.find(card => card.name === "Iono's Voltorb" && card.setCode === 'JTG' && card.cardNumber === '47');
const inspectVoltorb = fixture => createEngineRunner(fixture, 163).api.inspectFixture(fixture).find(card => card.name === "Iono's Voltorb" && card.setCode === 'JTG' && card.cardNumber === '47');

function testFixture() {
  const fixture = loadFixture();
  const iono = fixture.decks.human.decklist
    .replace("2 Iono's Wattrel ASC 71", "1 Iono's Wattrel ASC 71\n1 Dratini OBF 157")
    .replace('11 Lightning Energy SVE 12', '9 Lightning Energy SVE 12\n2 Water Energy MEE 3');
  fixture.decks.human = { ...fixture.decks.human, id: 'voltaic-chain-human', decklist: iono };
  fixture.decks.ai = { ...fixture.decks.human, id: 'voltaic-chain-ai' };
  return fixture;
}

function takeOwned(player, predicate) {
  for (const zoneName of ['hand', 'deck', 'discard', 'prizes']) {
    const zone = player[zoneName], index = zone.findIndex(predicate);
    if (index >= 0) return zone.splice(index, 1)[0];
  }
  return null;
}

function addBasicToBench(player, name, setCode, cardNumber) {
  const existing = player.bench.find(card => card.name === name && card.setCode === setCode && card.cardNumber === cardNumber);
  if (existing) return existing;
  if (player.active?.name === name && player.active?.setCode === setCode && player.active?.cardNumber === cardNumber) {
    const active = player.active; player.active = null;
    if (player.bench.length < 5) { player.bench.push(active); return active; }
    player.deck.push(active);
  }
  const card = takeOwned(player, item => item.name === name && item.setCode === setCode && String(item.cardNumber) === String(cardNumber));
  assert.ok(card, `test setup must find ${name} ${setCode} ${cardNumber}`);
  if (player.bench.length >= 5) player.deck.push(player.bench.pop());
  player.bench.push(card);
  return card;
}

function attachEnergyFromOwned(player, pokemon, energyType) {
  const energy = takeOwned(player, card => card.meta?.category === 'Energy' && String(card.meta?.energyType || '').toLowerCase() === energyType.toLowerCase());
  assert.ok(energy, `test setup must find ${energyType} Energy in the owner's zones`);
  pokemon.energy.push(energy);
  return energy;
}

async function readyRunner(side = 'you', seed = 157, paidEnergy = ['Water', 'Water']) {
  const fixture = testFixture(), runner = createEngineRunner(fixture, seed);
  runner.api.setup(fixture, runner.random, request => request.candidates?.find(card => card.name === "Iono's Voltorb") || request.candidates?.[0] || null, () => true);
  runner.api.setLocalAi(false);
  const owner = runner.api.state().players[side];
  const benchedVoltorbs = owner.bench.filter(card => card.setCode === 'JTG' && card.cardNumber === '47');
  owner.bench = owner.bench.filter(card => !(card.setCode === 'JTG' && card.cardNumber === '47'));
  owner.deck.push(...benchedVoltorbs);
  const attacker = runner.api.prepareAttack(side, 'JTG', '47', paidEnergy);
  const otherSide = side === 'you' ? 'codex' : 'you';
  const target = runner.api.prepareAttack(otherSide, 'ASC', '279', []);
  target.meta.weaknesses = []; target.meta.resistances = [];
  runner.api.state().turn = side;
  const wattrel = addBasicToBench(owner, "Iono's Wattrel", 'ASC', '71');
  const tadbulb = addBasicToBench(owner, "Iono's Tadbulb", 'ASC', '69');
  const dratini = addBasicToBench(owner, 'Dratini', 'OBF', '157');
  return { fixture, runner, attacker, target, side, otherSide, owner, wattrel, tadbulb, dratini };
}

function attackFor(runner, side) {
  const option = runner.api.attackOptions(side).find(item => item.attack.name === 'Voltaic Chain');
  assert.ok(option, 'Voltaic Chain should be available for the prepared Active Voltorb');
  return option;
}

test('Voltaic Chain is automated only for English Iono’s Voltorb JTG 47 and exact complete attack metadata', () => {
  const fixture = loadFixture(), card = findVoltorb(fixture);
  assert.ok(card);
  assert.equal(card.language, 'en');
  const attack = card.meta.attacks.find(item => item.name === 'Voltaic Chain');
  assert.deepEqual(attack.cost, ['Colorless', 'Colorless']);
  assert.equal(attack.damage, '20+');
  assert.equal(attack.effect, "This attack does 20 more damage for each {L} Energy attached to all of your Iono's Pokémon.");
  assert.equal(inspectVoltorb(fixture).handler.attacks.find(item => item.name === 'Voltaic Chain').handler, 'bonus_per_iono_lightning_energy');

  for (const mutate of [
    item => { item.setCode = 'ASC'; item.cardNumber = '47'; },
    item => { item.cardNumber = '48'; },
    item => { item.language = 'ja'; },
    item => { item.meta.attacks[0].effect += ' Draw a card.'; },
    item => { item.meta.attacks[0].effect = ''; },
    item => { item.meta.attacks[0].effect = "This attack does 20 more damage for each Energy attached to all of your Iono's Pokémon."; },
    item => { item.meta.attacks[0].cost = ['Lightning', 'Lightning']; },
    item => { item.meta.attacks[0].damage = '20'; }
  ]) {
    const changed = structuredClone(fixture), changedCard = findVoltorb(changed);
    mutate(changedCard);
    const result = createEngineRunner(changed, 167).api.inspectFixture(changed).find(item => item.name === "Iono's Voltorb" && item.setCode === changedCard.setCode && item.cardNumber === changedCard.cardNumber);
    assert.notEqual(result?.handler.attacks.find(entry => entry.name === 'Voltaic Chain')?.handler, 'bonus_per_iono_lightning_energy');
  }
});

test('Voltaic Chain gets 20 base damage when no attached Energy provides Lightning', async () => {
  const { runner, target, side, attacker } = await readyRunner();
  const option = attackFor(runner, side);
  assert.equal(attacker.energy.length, 2, 'two Water Energy pay the Colorless attack cost without contributing to the bonus');
  assert.equal(await runner.api.attack(side, option.index), true);
  assert.equal(target.damage, 20);
  assert.ok(runner.api.state().log.some(entry => entry.message === "Toma used Voltaic Chain with Iono's Voltorb for 20 damage."));
});

test('one qualifying Lightning Energy on another Iono Pokémon adds one damage increment', async () => {
  const { runner, owner, wattrel, target, side } = await readyRunner('you', 173);
  attachEnergyFromOwned(owner, wattrel, 'Lightning');
  const option = attackFor(runner, side);
  assert.equal(await runner.api.attack(side, option.index), true);
  assert.equal(target.damage, 40);
  assert.ok(runner.api.state().log.some(entry => entry.message === "Toma used Voltaic Chain with Iono's Voltorb for 40 damage."));
});

test('multiple qualifying Lightning Energy across Iono Pokémon are counted once each', async () => {
  const { runner, owner, attacker, wattrel, tadbulb, target, side } = await readyRunner('you', 179);
  attachEnergyFromOwned(owner, attacker, 'Lightning');
  attachEnergyFromOwned(owner, wattrel, 'Lightning');
  attachEnergyFromOwned(owner, tadbulb, 'Lightning');
  const option = attackFor(runner, side);
  assert.equal(await runner.api.attack(side, option.index), true);
  assert.equal(target.damage, 80);
  assert.ok(runner.api.state().log.some(entry => entry.message === "Toma used Voltaic Chain with Iono's Voltorb for 80 damage."));
});

test('Lightning attached to a non-Iono Pokémon is excluded; Energy used to pay attack cost counts exactly once', async () => {
  const excluded = await readyRunner('you', 181);
  attachEnergyFromOwned(excluded.owner, excluded.dratini, 'Lightning');
  attachEnergyFromOwned(excluded.owner, excluded.dratini, 'Lightning');
  const noBonus = attackFor(excluded.runner, excluded.side);
  assert.equal(await excluded.runner.api.attack(excluded.side, noBonus.index), true);
  assert.equal(excluded.target.damage, 20, 'non-Iono Dratini Energy contributes nothing');

  const paidWithLightning = await readyRunner('you', 191, ['Lightning', 'Lightning']);
  const counted = attackFor(paidWithLightning.runner, paidWithLightning.side);
  assert.equal(await paidWithLightning.runner.api.attack(paidWithLightning.side, counted.index), true);
  assert.equal(paidWithLightning.target.damage, 60, 'both Lightning cards paying the Colorless cost are included once each in the board count');
});

test('attack requires two Energy units and AI resolves through the same live-board calculation', async () => {
  const human = await readyRunner('you', 193);
  const option = attackFor(human.runner, 'you');
  assert.equal(human.runner.api.canUseAttack({ ...human.attacker, energy: human.attacker.energy.slice(0, 1) }, option.attack), false);

  const { runner, attacker, owner, wattrel, tadbulb, target } = await readyRunner('codex', 197);
  attachEnergyFromOwned(owner, attacker, 'Lightning');
  attachEnergyFromOwned(owner, wattrel, 'Lightning');
  attachEnergyFromOwned(owner, tadbulb, 'Lightning');
  const codex = runner.api.state().players.codex;
  codex.deck.push(...codex.hand); codex.hand = [];
  runner.api.setLocalAi(true);
  await runner.api.aiStep();
  assert.equal(target.damage, 80);
  assert.ok(runner.api.state().log.some(entry => entry.message === "Yami used Voltaic Chain with Iono's Voltorb for 80 damage."));
});

test('invalid attack selection leaves the board unchanged', async () => {
  const { runner, attacker, target, side } = await readyRunner();
  const turn = runner.api.state().turn;
  assert.equal(await runner.api.attack(side, 999), false);
  assert.equal(target.damage || 0, 0);
  assert.equal(attacker.energy.length, 2);
  assert.equal(runner.api.state().turn, turn);
});

test('failed Voltaic Chain transaction rolls back damage and preserves the attached Energy', async () => {
  const { runner, attacker, target, side } = await readyRunner('you', 199);
  attachEnergyFromOwned(runner.api.state().players.you, attacker, 'Lightning');
  const energyIds = attacker.energy.map(card => card.id), option = attackFor(runner, side);
  const restoreResolver = runner.api.failNextAttackEffectAfterResolve();
  try { assert.equal(await runner.api.attack(side, option.index), false); }
  finally { restoreResolver(); }
  const game = runner.api.state();
  assert.equal(game.players.codex.active.damage || 0, 0);
  assert.equal(JSON.stringify(Array.from(game.players.you.active.energy, card => card.id)), JSON.stringify(energyIds));
  assert.equal(game.players.you.attackedThisTurn, false);
  assert.equal(game.turn, side);
});


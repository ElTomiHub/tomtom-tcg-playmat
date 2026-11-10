const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadFixture, createEngineRunner } = require('./integration-harness.cjs');

const findWattrel = fixture => fixture.cards.find(card => card.name === "Iono's Wattrel" && card.setCode === 'ASC' && card.cardNumber === '71');
const inspectWattrel = fixture => createEngineRunner(fixture, 89).api.inspectFixture(fixture).find(card => card.name === "Iono's Wattrel" && card.setCode === 'ASC' && card.cardNumber === '71');

async function readyRunner(side = 'you', seed = 83) {
  const fixture = loadFixture();
  fixture.decks.human = { ...fixture.decks.human, id: `wattrel-quick-attack-${side}` };
  fixture.decks.ai = { ...fixture.decks.human, id: `wattrel-quick-attack-ai-${side}` };
  const runner = createEngineRunner(fixture, seed);
  runner.api.setup(fixture, runner.random, request => request.candidates?.find(card => card.name !== "Iono's Wattrel") || request.candidates?.[0] || null, () => true);
  runner.api.setLocalAi(false);
  for (const owner of ['you', 'codex']) {
    const player = runner.api.state().players[owner];
    if (player.active?.setCode === 'ASC' && player.active.cardNumber === '71') { player.deck.push(player.active); player.active = null; }
    const moved = player.bench.filter(card => card.setCode === 'ASC' && card.cardNumber === '71');
    player.bench = player.bench.filter(card => !(card.setCode === 'ASC' && card.cardNumber === '71'));
    player.deck.push(...moved);
    if (!player.active && owner !== side) {
      const basicIndex = player.deck.findIndex(card => card.meta?.category === 'Pokemon' && card.meta?.stage === 'Basic');
      assert.notEqual(basicIndex, -1, 'test setup must retain a legal opposing Basic Pokémon');
      player.active = player.deck.splice(basicIndex, 1)[0];
    }
  }
  const attacker = runner.api.prepareAttack(side, 'ASC', '71', ['Lightning']);
  const opponent = side === 'you' ? 'codex' : 'you';
  runner.api.state().turn = side;
  return { fixture, runner, attacker, side, opponent };
}

function setCoin(runner, heads, onFlip = () => {}) {
  runner.api.setChoices(runner.random, () => null, () => { onFlip(); return heads; });
}

test('Quick Attack is automated only for English Iono’s Wattrel ASC 71 with exact complete metadata', () => {
  const fixture = loadFixture(), card = findWattrel(fixture);
  assert.ok(card);
  assert.equal(card.language, 'en');
  const attack = card.meta.attacks.find(item => item.name === 'Quick Attack');
  assert.deepEqual(attack.cost, ['Lightning']);
  assert.equal(attack.damage, '10+');
  assert.equal(attack.effect, 'Flip a coin. If heads, this attack does 20 more damage.');
  assert.equal(inspectWattrel(fixture).handler.attacks.find(item => item.name === 'Quick Attack').handler, 'coin_bonus_damage');

  for (const mutate of [
    item => { item.setCode = 'JTG'; item.cardNumber = '71'; },
    item => { item.setCode = 'JTG'; item.cardNumber = '54'; },
    item => { item.language = 'ja'; },
    item => { item.meta.attacks[0].effect += ' Draw a card.'; },
    item => { item.meta.attacks[0].effect = ''; },
    item => { item.meta.attacks[0].cost = ['Water']; },
    item => { item.meta.attacks[0].damage = '10'; }
  ]) {
    const changed = structuredClone(fixture), changedCard = findWattrel(changed);
    mutate(changedCard);
    const result = createEngineRunner(changed, 97).api.inspectFixture(changed).find(item => item.name === "Iono's Wattrel" && item.setCode === changedCard.setCode && item.cardNumber === changedCard.cardNumber);
    assert.notEqual(result?.handler.attacks.find(entry => entry.name === 'Quick Attack')?.handler, 'coin_bonus_damage');
  }
});

test('Quick Attack costs one Lightning; heads deals 30 damage and tails deals 10', async () => {
  for (const [heads, expected] of [[true, 30], [false, 10]]) {
    const { runner, attacker, side, opponent } = await readyRunner('you', heads ? 101 : 103);
    const option = runner.api.attackOptions(side).find(item => item.attack.name === 'Quick Attack');
    assert.ok(option);
    assert.equal(runner.api.canUseAttack({ ...attacker, energy: [] }, option.attack), false, 'one Lightning Energy is required');
    const target = runner.api.state().players[opponent].active, before = target.damage || 0;
    let flips = 0;
    setCoin(runner, heads, () => flips++);
    assert.equal(await runner.api.attack(side, option.index), true);
    assert.equal(flips, 1);
    assert.equal(target.damage, before + expected);
    assert.ok(runner.api.state().log.some(entry => new RegExp(`Quick Attack: ${heads ? 'heads' : 'tails'}`).test(entry.message)));
    assert.ok(runner.api.state().log.some(entry => new RegExp(`used Quick Attack with Iono's Wattrel for ${expected} damage`).test(entry.message)));
  }
});

test('AI resolves both Quick Attack coin outcomes through the same authoritative attack pipeline', async () => {
  for (const [heads, expected] of [[true, 30], [false, 10]]) {
    const { runner, attacker } = await readyRunner('codex', heads ? 107 : 109);
    const game = runner.api.state(), codex = game.players.codex;
    codex.deck.push(...codex.hand); codex.hand = []; codex.energyAttachedThisTurn = true;
    runner.api.setLocalAi(true);
    setCoin(runner, heads);
    await runner.api.aiStep();
    assert.equal(game.players.you.active.damage, expected);
    assert.ok(game.log.some(entry => new RegExp(`Yami used Quick Attack with Iono's Wattrel for ${expected} damage`).test(entry.message)));
  }
});

test('invalid attack selection does not consume the coin flip or change damage or turn', async () => {
  const { runner, attacker, side, opponent } = await readyRunner();
  let flips = 0; setCoin(runner, true, () => flips++);
  const target = runner.api.state().players[opponent].active, before = target.damage || 0, turn = runner.api.state().turn;
  assert.equal(await runner.api.attack(side, 999), false);
  assert.equal(flips, 0);
  assert.equal(target.damage || 0, before);
  assert.equal(attacker.damage || 0, 0);
  assert.equal(runner.api.state().turn, turn);
});

test('failed Quick Attack transaction rolls damage back while the injected random source remains consumed', async () => {
  const { runner, side, opponent } = await readyRunner();
  const game = runner.api.state(), target = game.players[opponent].active;
  let flips = 0; setCoin(runner, true, () => flips++);
  const before = target.damage || 0, option = runner.api.attackOptions(side).find(item => item.attack.name === 'Quick Attack');
  const restoreResolver = runner.api.failNextAttackEffectAfterResolve();
  try { assert.equal(await runner.api.attack(side, option.index), false); }
  finally { restoreResolver(); }
  assert.equal(flips, 1);
  assert.equal(runner.api.state().players[opponent].active.damage || 0, before);
  assert.equal(runner.api.state().turn, side);
  assert.equal(runner.api.state().players[side].attackedThisTurn, false);
});


const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const htmlPath = path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');

function engineFunction(name) {
  const startPattern = new RegExp(`^    (?:async )?function ${name}\\(`, 'm');
  const start = html.search(startPattern);
  assert.notEqual(start, -1, `Could not find ${name} in index.html`);
  const rest = html.slice(start);
  const nextFunction = rest.slice(1).search(/^    (?:async )?function [\w$]+\(/m);
  return nextFunction === -1 ? rest : rest.slice(0, nextFunction + 1);
}

function pokemon(id, damage = 0, conditions = []) {
  return {
    id,
    name: id,
    meta: { hp: 70, rules: [] },
    damage,
    conditions: conditions.map(type => ({ type, expiresTurn: 2 })),
    energy: [],
    tools: [],
    evolutionStack: []
  };
}

function makePlayer(name, active, bench = [], prizeCount = 6) {
  return {
    name,
    active,
    bench,
    prizes: Array.from({ length: prizeCount }, (_, i) => ({ id: `${name}-prize-${i + 1}` })),
    hand: [],
    deck: [{ id: `${name}-draw-card` }],
    discard: [],
    lost: [],
    turnsTaken: 0,
    energyAttachedThisTurn: true,
    supporterPlayedThisTurn: true,
    retreatedThisTurn: true,
    attackedThisTurn: true
  };
}

function makeEngine({ endingSide = 'you', youActive, codexActive, youBench = [], codexBench = [], youPrizes = 6, codexPrizes = 6, coinFlips = [] }) {
  const players = {
    you: makePlayer('You', youActive, youBench, youPrizes),
    codex: makePlayer('Codex', codexActive, codexBench, codexPrizes)
  };
  const game = {
    phase: 'play',
    winner: null,
    turn: endingSide,
    firstPlayer: endingSide,
    turnNumber: 1,
    firstTurn: false,
    players,
    pendingPromotion: null,
    pendingPromotionAfter: null,
    pendingAttackTurn: null,
    pendingStartDrawSide: null,
    pendingCheckup: null,
    stadiumPlayedThisTurn: false,
    growlReduction: null,
    log: []
  };
  const drawCalls = [];
  const scheduledAiTurns = [];
  const banners = [];
  const ui = new Map();
  const context = vm.createContext({
    game,
    player: side => players[side],
    oppositeSide: side => side === 'you' ? 'codex' : 'you',
    cleanCardKey: value => String(value || '').toLowerCase(),
    effectivePokemonHp: card => Number(card?.meta?.hp || 0),
    hasCondition: (card, type) => (card?.conditions || []).some(condition => condition.type === type),
    randomCoin: () => coinFlips.shift() ?? true,
    logEvent: message => game.log.push(message),
    resolveExpShare: async () => {},
    drawCard: side => drawCalls.push(side),
    render: () => {},
    showTurnDoneBanner: message => banners.push(message),
    scheduleLocalAiTurn: delay => scheduledAiTurns.push(delay),
    $: id => {
      if (!ui.has(id)) ui.set(id, {});
      return ui.get(id);
    },
    clearTimeout: () => {},
    localAiTimer: null,
    recordDeckResult: () => {},
    controlSide: endingSide,
    selected: null,
    localAiEnabled: true,
    localAiActionCount: 0,
    drawCalls,
    scheduledAiTurns,
    banners
  });
  vm.runInContext([
    engineFunction('prizeCountFor'),
    engineFunction('finishMatch'),
    engineFunction('promoteCodexAfterKnockout'),
    engineFunction('recordAttackDamageKnockout'),
    engineFunction('resolveKnockout'),
    engineFunction('checkupWinner'),
    engineFunction('advanceCheckupPromotions'),
    engineFunction('completePendingCheckupTransition'),
    engineFunction('resolveBetweenTurns'),
    engineFunction('endTurn'),
    engineFunction('promoteSelected')
  ].join('\n'), context);
  return { context, game, players, drawCalls, banners, scheduledAiTurns };
}

test('Poison Checkup pauses for human promotion, then starts the incoming turn once', async () => {
  const state = makeEngine({
    endingSide: 'codex',
    youActive: pokemon('Poisoned You Active', 60, ['poisoned']),
    codexActive: pokemon('Codex Active'),
    youBench: [pokemon('You Reserve')]
  });

  await state.context.endTurn();

  assert.equal(state.game.turn, 'you');
  assert.equal(state.players.you.active, null);
  assert.equal(state.players.you.discard[0].id, 'Poisoned You Active');
  assert.equal(state.players.codex.prizes.length, 5);
  assert.equal(state.players.you.prizes.length, 6);
  assert.equal(state.game.pendingPromotion, 'you');
  assert.equal(state.game.pendingAttackTurn, null);
  assert.deepEqual(Array.from(state.context.game.pendingCheckup.promotions), ['you']);
  assert.deepEqual(state.drawCalls, []);

  state.context.selected = { side: 'you', zone: 'bench', id: 'You Reserve' };
  await state.context.promoteSelected();

  assert.equal(state.players.you.active.id, 'You Reserve');
  assert.equal(state.game.turn, 'you');
  assert.equal(state.game.turnNumber, 2);
  assert.equal(state.game.pendingPromotion, null);
  assert.equal(state.game.pendingCheckup, null);
  assert.equal(state.game.pendingStartDrawSide, null);
  assert.deepEqual(state.drawCalls, ['you']);
  assert.equal(state.context.completePendingCheckupTransition(), false);
  assert.deepEqual(state.drawCalls, ['you']);
});

test('Burn Checkup KOs the AI Active, auto-promotes its Bench, and draws for Codex once', async () => {
  const state = makeEngine({
    endingSide: 'you',
    youActive: pokemon('You Active'),
    codexActive: pokemon('Burned Codex Active', 50, ['burned']),
    codexBench: [pokemon('Codex Reserve')],
    coinFlips: [true]
  });

  await state.context.endTurn();

  assert.equal(state.game.turn, 'codex');
  assert.equal(state.players.codex.active.id, 'Codex Reserve');
  assert.equal(state.players.codex.discard[0].id, 'Burned Codex Active');
  assert.equal(state.players.codex.prizes.length, 6);
  assert.equal(state.players.you.prizes.length, 5);
  assert.equal(state.game.pendingPromotion, null);
  assert.equal(state.game.pendingAttackTurn, null);
  assert.equal(state.game.pendingCheckup, null);
  assert.deepEqual(state.drawCalls, ['codex']);
  assert.equal(state.game.phase, 'play');
});

test('simultaneous Active Knockouts finish processing before promotion and incoming draw', async () => {
  const state = makeEngine({
    endingSide: 'you',
    youActive: pokemon('Poisoned You Active', 60, ['poisoned']),
    codexActive: pokemon('Poisoned Codex Active', 60, ['poisoned']),
    youBench: [pokemon('You Reserve')],
    codexBench: [pokemon('Codex Reserve')]
  });

  await state.context.endTurn();

  assert.equal(state.game.turn, 'codex');
  assert.equal(state.players.you.active, null);
  assert.equal(state.players.codex.active.id, 'Codex Reserve');
  assert.ok(state.players.you.discard.some(card => card.id === 'Poisoned You Active'));
  assert.ok(state.players.codex.discard.some(card => card.id === 'Poisoned Codex Active'));
  assert.equal(state.players.you.prizes.length, 5);
  assert.equal(state.players.codex.prizes.length, 5);
  assert.equal(state.game.pendingAttackTurn, null);
  assert.equal(state.game.pendingPromotion, 'you');
  assert.deepEqual(Array.from(state.context.game.pendingCheckup.promotions), ['you']);
  assert.deepEqual(state.drawCalls, []);

  state.context.selected = { side: 'you', zone: 'bench', id: 'You Reserve' };
  await state.context.promoteSelected();

  assert.equal(state.players.you.active.id, 'You Reserve');
  assert.equal(state.game.turn, 'codex');
  assert.equal(state.players.codex.turnsTaken, 0);
  assert.equal(state.players.you.turnsTaken, 1);
  assert.equal(state.game.pendingPromotion, null);
  assert.equal(state.game.pendingCheckup, null);
  assert.deepEqual(state.drawCalls, ['codex']);
});

test('when You are next after simultaneous Active Knockouts, You promote before the AI', async () => {
  const state = makeEngine({
    endingSide: 'codex',
    youActive: pokemon('Poisoned You Active', 60, ['poisoned']),
    codexActive: pokemon('Poisoned Codex Active', 60, ['poisoned']),
    youBench: [pokemon('You Reserve')],
    codexBench: [pokemon('Codex Reserve')]
  });

  await state.context.endTurn();

  assert.equal(state.game.turn, 'you');
  assert.equal(state.game.pendingPromotion, 'you');
  assert.equal(state.players.codex.active, null);
  assert.deepEqual(state.drawCalls, []);

  state.context.selected = { side: 'you', zone: 'bench', id: 'You Reserve' };
  await state.context.promoteSelected();

  assert.equal(state.players.you.active.id, 'You Reserve');
  assert.equal(state.players.codex.active.id, 'Codex Reserve');
  assert.equal(state.game.turn, 'you');
  assert.deepEqual(state.drawCalls, ['you']);
});

test('simultaneous Checkup win conditions resolve as a draw when both players lose their last Pokémon and Prize', async () => {
  const state = makeEngine({
    endingSide: 'you',
    youActive: pokemon('Poisoned You Active', 60, ['poisoned']),
    codexActive: pokemon('Poisoned Codex Active', 60, ['poisoned']),
    youPrizes: 1,
    codexPrizes: 1
  });

  await state.context.endTurn();

  assert.equal(state.game.phase, 'finished');
  assert.equal(state.game.winner, null);
  assert.ok(state.game.log.includes('The match is a draw — simultaneous Pokémon Checkup win conditions.'));
  assert.deepEqual(state.drawCalls, []);
});

test('a Benched Pokémon is not affected by Active-only Poison processing during Checkup', async () => {
  const bench = pokemon('Damaged Bench', 60);
  const state = makeEngine({
    endingSide: 'you',
    youActive: pokemon('You Active'),
    codexActive: pokemon('Codex Active'),
    youBench: [bench]
  });

  await state.context.endTurn();

  assert.equal(state.players.you.bench[0].damage, 60);
  assert.equal(state.players.you.active.id, 'You Active');
  assert.equal(state.players.you.discard.length, 0);
  assert.deepEqual(state.drawCalls, ['codex']);
});

test('Checkup applies each Special Condition to both players in the rulebook order', async () => {
  const state = makeEngine({
    endingSide: 'you',
    youActive: pokemon('You Active', 0, ['poisoned', 'burned', 'asleep']),
    codexActive: pokemon('Codex Active', 0, ['poisoned', 'burned', 'asleep']),
    coinFlips: [false, false, true, true]
  });

  await state.context.endTurn();

  const events = state.game.log;
  assert.equal(state.players.you.active.damage, 30);
  assert.equal(state.players.codex.active.damage, 30);
  assert.deepEqual(events.slice(1).map(message => message.match(/^(.*?) (?:took|flipped)/)?.[1]), [
    'You Active', 'Codex Active', 'You Active', 'Codex Active', 'You Active', 'Codex Active'
  ]);
  assert.deepEqual(state.drawCalls, ['codex']);
});

test('normal attack Knockout still waits for human promotion, then ends the attacker turn once', async () => {
  const state = makeEngine({
    endingSide: 'codex',
    youActive: pokemon('Knocked Out You Active'),
    codexActive: pokemon('Codex Active'),
    youBench: [pokemon('You Reserve')]
  });

  await state.context.resolveKnockout('codex', 'you', true);

  assert.equal(state.game.pendingPromotion, 'you');
  assert.equal(state.game.pendingAttackTurn, 'codex');
  assert.equal(state.game.pendingCheckup, null);
  assert.deepEqual(state.drawCalls, []);

  state.context.selected = { side: 'you', zone: 'bench', id: 'You Reserve' };
  await state.context.promoteSelected();

  assert.equal(state.players.you.active.id, 'You Reserve');
  assert.equal(state.game.turn, 'you');
  assert.equal(state.players.codex.turnsTaken, 1);
  assert.equal(state.game.pendingAttackTurn, null);
  assert.deepEqual(state.drawCalls, ['you']);
});

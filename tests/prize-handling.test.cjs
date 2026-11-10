const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const htmlPath = path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');

// The app is a self-contained HTML file. Load the real engine functions in a
// small VM with only the game-state services those handlers need.
function engineFunction(name) {
  const startPattern = new RegExp(`^    (?:async )?function ${name}\\(`, 'm');
  const start = html.search(startPattern);
  assert.notEqual(start, -1, `Could not find ${name} in index.html`);
  const rest = html.slice(start);
  const nextFunction = rest.slice(1).search(/^    (?:async )?function [\w$]+\(/m);
  return nextFunction === -1 ? rest : rest.slice(0, nextFunction + 1);
}

function prizePokemon(prizeValue) {
  const names = { 1: 'Tatsugiri', 2: 'Charizard ex', 3: 'Mega Charizard ex' };
  return {
    id: `knocked-out-${prizeValue}`,
    name: names[prizeValue],
    meta: { rules: [] },
    energy: [{ id: 'attached-energy', name: 'Lightning Energy' }],
    tools: [{ id: 'attached-tool', name: 'Bravery Charm' }],
    evolutionStack: [{ id: 'evolution-card', name: 'Charmeleon' }]
  };
}

function makePlayer(name, prizes) {
  return { name, prizes, hand: [], active: null, bench: [], discard: [] };
}

function makeEngine(attackerSide, defenderSide, targetZone, prizeValue, attackerPrizeCount = 6) {
  const attackerPrizeCards = Array.from({ length: attackerPrizeCount }, (_, i) => ({ id: `own-prize-${i + 1}` }));
  const defenderPrizeCards = Array.from({ length: 6 }, (_, i) => ({ id: `opponent-prize-${i + 1}` }));
  const attacker = makePlayer(attackerSide, attackerPrizeCards.slice());
  const defender = makePlayer(defenderSide, defenderPrizeCards.slice());
  const knockedOut = prizePokemon(prizeValue);
  const survivor = { id: 'survivor', name: 'Bench Survivor', meta: { hp: 70 }, energy: [], tools: [], evolutionStack: [] };

  if (targetZone === 'active') {
    defender.active = knockedOut;
    defender.bench = [survivor];
  } else {
    defender.active = survivor;
    defender.bench = [knockedOut];
  }

  const game = {
    phase: 'play',
    winner: null,
    pendingPromotion: null,
    pendingAttackTurn: null,
    players: { you: null, codex: null }
  };
  game.players[attackerSide] = attacker;
  game.players[defenderSide] = defender;
  const logs = [];
  const finishes = [];
  const context = vm.createContext({
    game,
    player: side => game.players[side],
    oppositeSide: side => side === 'you' ? 'codex' : 'you',
    cleanCardKey: value => String(value || '').toLowerCase(),
    logEvent: message => logs.push(message),
    resolveExpShare: async () => {},
    promoteCodexAfterKnockout: () => {},
    finishMatch: (winner, reason) => {
      finishes.push({ winner, reason });
      game.phase = 'finished';
      game.winner = winner;
    },
    controlSide: null,
    selected: null
  });
  vm.runInContext([
    engineFunction('prizeCountFor'),
    engineFunction('recordAttackDamageKnockout'),
    engineFunction('resolveKnockout'),
    engineFunction('resolveBenchKnockout')
  ].join('\n'), context);

  return {
    context,
    game,
    attacker,
    defender,
    knockedOut,
    attackerPrizeCards,
    defenderPrizeCards,
    logs,
    finishes
  };
}

for (const attackerSide of ['you', 'codex']) {
  const defenderSide = attackerSide === 'you' ? 'codex' : 'you';
  for (const targetZone of ['active', 'bench']) {
    for (const prizeValue of [1, 2, 3]) {
      test(`${attackerSide} takes ${prizeValue} Prize${prizeValue === 1 ? '' : 's'} from own pile for ${targetZone} Knockout`, async () => {
        const state = makeEngine(attackerSide, defenderSide, targetZone, prizeValue);
        if (targetZone === 'active') {
          await state.context.resolveKnockout(attackerSide, defenderSide);
        } else {
          state.context.resolveBenchKnockout(attackerSide, defenderSide, state.knockedOut.id);
        }

        assert.equal(state.attacker.prizes.length, 6 - prizeValue);
        assert.deepEqual(state.attacker.hand.map(card => card.id), state.attackerPrizeCards.slice(-prizeValue).reverse().map(card => card.id));
        assert.deepEqual(state.defender.prizes.map(card => card.id), state.defenderPrizeCards.map(card => card.id));
        assert.ok(state.defender.discard.some(card => card.id === state.knockedOut.id));
        assert.ok(state.defender.discard.some(card => card.id === 'attached-energy'));
        assert.ok(state.defender.discard.some(card => card.id === 'attached-tool'));
        assert.ok(state.defender.discard.some(card => card.id === 'evolution-card'));
        assert.equal(state.finishes.length, 0);
      });
    }

    test(`${attackerSide} wins when a ${targetZone} Knockout takes its final Prize`, async () => {
      const state = makeEngine(attackerSide, defenderSide, targetZone, 3, 3);
      if (targetZone === 'active') {
        await state.context.resolveKnockout(attackerSide, defenderSide);
      } else {
        state.context.resolveBenchKnockout(attackerSide, defenderSide, state.knockedOut.id);
      }

      assert.equal(state.attacker.prizes.length, 0);
      assert.deepEqual(state.defender.prizes.map(card => card.id), state.defenderPrizeCards.map(card => card.id));
      assert.equal(state.game.phase, 'finished');
      assert.equal(state.game.winner, attackerSide);
      assert.deepEqual(state.finishes, [{ winner: attackerSide, reason: 'all Prize cards taken' }]);
    });
  }
}

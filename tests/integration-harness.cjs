const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const appPath = path.join(__dirname, '..', 'index.html');
const fixturePath = path.join(__dirname, 'fixtures', 'iono-lightning-vs-dragonite.fixture.json');
const html = fs.readFileSync(appPath, 'utf8');

function createBrowserStub() {
  const noop = () => {};
  function element() {
    const classes = new Set(), listeners = new Map(), attributes = new Map(), styles = new Map(), captures = new Set();
    return { value: '', textContent: '', innerHTML: '', dataset: {}, style: { setProperty: (key,value) => styles.set(key,String(value)), getPropertyValue: key => styles.get(key) || '' }, disabled: false, checked: false, hidden: false, files: [],
      classList: { add: (...names) => names.forEach(name => classes.add(name)), remove: (...names) => names.forEach(name => classes.delete(name)), toggle: (name, force) => { const value = force ?? !classes.has(name); if (value) classes.add(name); else classes.delete(name); return value; }, contains: name => classes.has(name) },
      addEventListener(type, callback) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(callback); }, removeEventListener: noop,
      dispatchEvent(event) { event.target ||= this; return Promise.all((listeners.get(event.type) || []).map(callback => callback(event))); },
      click() { window.__downloadFilename = this.download || null; return this.dispatchEvent({ type: 'click', target: this }); },
      open: false, returnValue: '', showModal() { this.open = true; }, close(value = '') { this.returnValue = value; this.open = false; this.onclose?.(); },
      appendChild: noop, remove: noop, focus: noop, select: noop, setAttribute: (key,value) => attributes.set(key,String(value)), getAttribute: key => attributes.get(key) ?? null, setPointerCapture: id => captures.add(id), releasePointerCapture: id => captures.delete(id), hasPointerCapture: id => captures.has(id), closest: () => null, querySelectorAll: () => [], querySelector: () => element(), getBoundingClientRect: () => ({ width: 100, height: 100 }) };
  }
  const elements = new Map(), storage = new Map();
  const document = { getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); }, querySelectorAll: () => [], createElement: element, addEventListener: noop, body: element(), documentElement: element(), execCommand: () => true };
  const localStorage = { getItem: key => storage.has(key) ? storage.get(key) : null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) };
  const windowListeners=new Map();
  const window = { __POKEMON_TCG_TEST__: true, innerWidth:1280, addEventListener(type,callback) { if(!windowListeners.has(type))windowListeners.set(type,[]);windowListeners.get(type).push(callback); }, removeEventListener: noop, dispatchEvent(event) { return Promise.all((windowListeners.get(event.type) || []).map(callback=>callback(event))); }, matchMedia: () => ({ matches: false, addEventListener: noop }), confirm: () => true };
  class BrowserURL extends URL { static createObjectURL(blob) { window.__downloadBlob = blob; return 'blob:test'; } static revokeObjectURL() {} }
  const context = vm.createContext({ window, document, localStorage, console, Math, Date, Number, String, Array, Object, Set, Map, JSON, RegExp, Promise, Error, URL: BrowserURL, Blob, Intl, structuredClone, fetch: async () => { throw new Error('Unexpected network request from offline match runner.'); }, setTimeout: () => 1, clearTimeout: noop, requestAnimationFrame: callback => callback(), navigator: { clipboard: { writeText: async value => { window.__copiedText = value; } } } });
  return { context, document };
}

function createEngineRunner(fixture, seed = 1) {
  const { context, document } = createBrowserStub();
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  if (!script) throw new Error('Could not find the embedded application script.');
  vm.runInContext(script, context, { timeout: 10000 });
  const bootstrap = String.raw`
    globalThis.integrationApi = {
      setup(fixture, random, choose, coinFlip, options = {}) {
        installEngineTestHooks({ random, choose, ...(coinFlip ? { coinFlip } : {}) });
        registeredDecks = [fixture.decks.human, fixture.decks.ai].map(deck => ({ ...deck }));
        registeredCards = fixture.cards.map(card => ({ ...card, id: 'print:' + card.setCode + ':' + card.cardNumber + ':' + card.name.toLowerCase(), language: card.language || 'en', meta: { ...card.meta, language: card.language || 'en' } }));
        const parsed = {};
        for (const [side, key] of [['you', 'human'], ['codex', 'ai']]) {
          const deck = fixture.decks[key], result = parseDeck(deck.decklist);
          if (!result.valid || result.total !== 60) throw new Error(deck.name + ' did not parse as a valid 60-card deck.');
          for (const card of result.cards) {
            const saved = registeredCardForPrint(card);
            if (!saved?.meta) throw new Error('No fixture metadata for ' + card.name + ' (' + card.setCode + ' ' + card.cardNumber + ').');
            card.meta = structuredClone(saved.meta); card.language = saved.language;
          }
          parsed[side] = result;
        }
        resolvedDecks = { ...parsed, raw: { you: fixture.decks.human.decklist, codex: fixture.decks.ai.decklist }, deckIds: { you: fixture.decks.human.id, codex: fixture.decks.ai.id } };
        $('youRegisteredDeck').value = fixture.decks.human.id; $('codexRegisteredDeck').value = fixture.decks.ai.id;
        $('youDeck').value = fixture.decks.human.decklist; $('codexDeck').value = fixture.decks.ai.decklist;
        $('yamiStyleSelect').value = options.yamiStyle || 'balanced';
        $('yamiDifficultySelect').value = options.yamiDifficulty || 'competitor';
        localAiEnabled = true; flipCoin(); startMatch();
        controlSide = 'you'; placeSelected('active');
        while (player('you').bench.length < 5 && player('you').hand.some(card => basicPokemon(card) && player('you').openingBasicIds.includes(card.id))) placeSelected('bench');
        controlSide = 'codex';
        while (player('codex').bench.length < 5 && player('codex').hand.some(card => basicPokemon(card) && player('codex').openingBasicIds.includes(card.id))) placeSelected('bench');
        if (options.setupOnly) { controlSide='you';render();return; }
        finishPokemonSetup();
      },
      state() { return game; }, snapshot() { return stateSnapshot(); },
      panelPreferences() { return jsonSnapshot(panelLayoutSettings); },
      panelWidths(width,preferences) { return constrainedPanelWidths(width,preferences); },
      applyPanels() { return applyPanelLayout(); },
      reloadPanelPreferences() { panelLayoutSettings=loadPanelLayoutSettings();return applyPanelLayout(); },
      saveMatch() { return saveMatchCheckpoint(); }, resumeMatch() { return resumeSavedMatch(); },
      validateMatch(data) { return validateMatchCheckpoint(data); }, clearSavedMatch,
      reminders(pokemon,side) { return pokemonEffectReminders(pokemon,side); },
      reminderMarkup(pokemon,side) { return effectReminderMarkup(pokemon,side); },
      aiAction() { return chooseLocalAiAction(); }, aiEnergyScore(energy,target) { return aiEnergyPlacementScore(energy,target); },
      transaction(callback) { return runEffectTransaction(callback,{label:'Checkpoint test'}); },
      checkpointLock(enabled) { window.effectResolutionPending=enabled; },
      finishSetup() { return finishPokemonSetup(); },
      captureUndo() { return captureUndoSnapshot(); },
      inspectPlayed(side) { return inspectLastPlayed(side); },
      leaveMatch() { return setView('menu'); },
      stagedKnockouts(enabled) { engineTestHooks.stageKnockouts=enabled; },
      visualTransitions() { return jsonSnapshot(activeVisualTransitions); },
      imageUrl(card) { return imageFor(card); },
      preview(side,index,energyIds=[]) { const pokemon=player(side).active;return attackPreviewFor(side,pokemon,pokemon.meta.attacks[index],energyIds); },
      markup(card,side='you',zone='active') { return cardMarkup(card,side,zone); },
      inspectTool(side,hostId,toolId) { return inspectAttachedTool(side,hostId,toolId); },
      inspectPokemon(side,id) {const p=player(side);selected={side,zone:p.active?.id===id?'active':'bench',id};render();},
      renderNow() {render();},
      rawChoice(side,cards,min,max) {return chooseCardsInApp(side,'Test selection',cards,min,max);},
      rawBoardChoice(side,targets) {return choosePokemonOnBoard(side,'Test target',targets);},
      confirmRawChoice(ids) {finishCardChoice(activeCardChoice.cards.filter(card=>ids.includes(card.id)));},
      resetInformationReveal() {resolutionInformationRevealed=false;},
      retreatPrompt(side) {controlSide=side;return retreatSelected();},
      inspectFixture(fixture) {
        registeredCards = fixture.cards.map(card => ({ ...card, id: 'print:' + card.setCode + ':' + card.cardNumber + ':' + card.name.toLowerCase(), language: card.language || 'en', meta: { ...card.meta, language: card.language || 'en' } }));
        return this.effectAudit();
      },
      phase() { return game?.phase; }, turn() { return game?.turn; },
      pendingChoices() { return !!(activeCardChoiceResolver || activeBoardChoiceResolver); },
      cancelActiveCardChoice() { finishCardChoice(null); },
      cancelActiveBoardChoice() { finishBoardChoice(null); },
      async promote() { controlSide = game.pendingPromotion; await promoteSelected(); },
      async endTurnFor(side) { controlSide = side; await endTurn(); },
      attachFor(side, cardId, pokemonId) { controlSide = side; selected = { side, zone: 'hand', id: cardId }; return attachSelected(pokemonId); },
      manualAttackOptions(side) { return playableAttacks(side, true).filter(option => option.manual && !String(option.attack.effect || '').trim()); },
      async manualAttack(side, index) { controlSide = side; return useAttack(side, index, [], true); },
      async useAbility(side, pokemonId, abilityName, allowManual = true) {
        const p = player(side), pokemon = [p?.active, ...(p?.bench || [])].find(card => card?.id === pokemonId);
        controlSide = side;
        return pokemon ? usePokemonAbility(side, pokemon, abilityName, allowManual) : false;
      },
      placeStadium(side, cardId) { controlSide = side; selected = { side, zone: 'hand', id: cardId }; return placeSelected('stadium'); },
      useStadium(side) { controlSide = side; return useActiveStadiumAbility(side); },
      retreatCost(pokemon) { return retreatCostForPokemon(pokemon); },
      energyUnits(energy,pokemon) { return energyUnitsForPokemon(energy,pokemon); },
      canPay(pokemon,attack) { return canPayAttack(pokemon,attack); },
      canRetreat(side) { return canRetreatPokemon(player(side).active,side); },
      toolCapacity(pokemon) { return pokemonToolCapacity(pokemon); },
      enforceToolCapacity(side,pokemon) { return enforcePokemonToolCapacity(side,pokemon); },
      fetchDetails(card) { return fetchDetailedCard(card); },
      async evolveFor(side,cardId,targetId) { controlSide=side;pendingEvolutionId=cardId;return evolveAt(side,targetId===player(side).active?.id?'active':'bench',targetId); },
      effectiveHp(pokemon) { return effectivePokemonHp(pokemon); },
      openingPokemon(card) { return openingPokemon(card); },
      placeActive(side, id) { controlSide = side; selected = {side,zone:'hand',id}; return placeSelected('active'); },
      discardOpeningDoll(side, card) { return discardOpeningDoll(side, card); },
      applyCondition(pokemon, condition) { return applyPokemonCondition(pokemon, condition); },
      repairMetadata(card) { return repairVerifiedSavedMetadata(card); },
      loadSavedLibrary(cards) {
        localStorage.setItem(CARD_STORAGE_KEY, JSON.stringify(cards));
        registeredCards = loadRegisteredCards();
      },
      backup() { return buildLibraryBackup(); },
      validateBackup(input) { return validateLibraryBackup(input); },
      parseBackup(text) { return parseLibraryBackup(text); },
      restoreBackup(input) { return restoreLibraryBackup(input); },
      report(description) { return buildProblemReport(description); },
      openReport() { return openProblemReport(); },
      downloadReport() { return downloadProblemReport(); },
      previewBackupFile(file) { return previewRestoreFile(file); },
      clearRestorePreview() { return resetRestorePreview(); },
      applyRestore() { return applyStagedRestore(); },
      openBackupTools() { return openBackupTools(); },
      unavailable(action, options) { return actionUnavailableReason(action, options); },
      selectHandCard(side, cardId) { controlSide = side; selectHand(cardId); },
      selectBoardCard(side, zone, cardId) { controlSide = side; selectBoard(side, zone, cardId); },
      notify(message) { showToast(message); },
      diagnostic(kind, message, details) { recordDiagnostic(kind, message, details); },
      visualState() { return jsonSnapshot({ active: activePlaymatEffect, queued: playmatEffectQueue, batches: playmatEffectBatches.length, timer: playmatEffectTimer }); },
      clearVisuals() { clearPlaymatEffects(); },
      flipVisualCoin() { return randomCoin(); },
      finishMatch(winner, reason) { finishMatch(winner, reason); },
      matchSummary(side) { return buildMatchSummary(side); },
      render() { render(); },
      setCardChoiceIds(ids) { if (activeCardChoice) activeCardChoice.selected = new Set(ids); },
      undo() { undoLastAction(); },
      checkLibrary() { return checkAllCardImplementations(); },
      libraryAudit() { return registeredCards.filter(card => card.meta).map(card => ({ ...card, status: cardImplementationState(card).key })); },
      async pendingLibraryExport() { await copyMissingEffectsQueue(); return window.__copiedText || null; },
      damagePokemon(attackerSide, defenderSide, target, zone, damage) { return applyDamageToPokemon(attackerSide, defenderSide, target, zone, damage, true, 'Test attack'); },
      expShare(side, pokemon) { return resolveExpShare(side, pokemon); },
      failNextAbilityAfterResolve() {
        const original = resolvePokemonAbility;
        resolvePokemonAbility = async (...args) => { await original(...args); return false; };
        return () => { resolvePokemonAbility = original; };
      },
      canUseAttack(pokemon, attack, allowManual = false) { return canUseAttack(pokemon, attack, allowManual); },
      attackOptions(side) { return playableAttacks(side); },
      async attack(side, index, energyIds = [], attackerId = null) { controlSide = side; return useAttack(side, index, energyIds, false, attackerId); },
      prepareAttack(side, setCode, cardNumber, energyTypes = []) {
        const p = player(side);
        const findOwned = predicate => {
          for (const zone of [p.hand, p.deck, p.discard, p.prizes]) {
            const index = zone.findIndex(predicate);
            if (index >= 0) return zone.splice(index, 1)[0];
          }
          return null;
        };
        if (p.active) p.deck.push(p.active);
        const attacker = findOwned(card => card.setCode === setCode && String(card.cardNumber) === String(cardNumber));
        if (!attacker) throw new Error('Test setup could not find ' + setCode + ' ' + cardNumber + ' in ' + side + "'s zones.");
        attacker.energy = []; attacker.tools = []; attacker.conditions = []; attacker.damage = 0; attacker.evolutionStack = [];
        attacker.enteredTurn = 0; attacker.evolvedTurn = -1;
        for (const type of energyTypes) {
          const energy = findOwned(card => card.meta?.category === 'Energy' && card.meta?.energyType?.toLowerCase() === String(type).toLowerCase());
          if (!energy) throw new Error('Test setup could not find ' + type + ' Energy in ' + side + "'s zones.");
          attacker.energy.push(energy);
        }
        p.active = attacker; p.turnsTaken = Math.max(1, p.turnsTaken); p.energyAttachedThisTurn = true; p.attackedThisTurn = false;
        game.phase = 'play'; game.turn = side; game.pendingPromotion = null; game.pendingAttackTurn = null;
        controlSide = side;
        return attacker;
      },
      failNextAttackEffectAfterMutation() {
        const original = resolveAttackEffect;
        let pending = true;
        resolveAttackEffect = async (...args) => {
          if (!pending) return original(...args);
          pending = false;
          const owner = player(args[0]), removed = owner.deck.pop();
          if (removed) owner.discard.push(removed);
          return false;
        };
        return () => { resolveAttackEffect = original; };
      },
      failNextAttackEffectAfterResolve() {
        const original = resolveAttackEffect;
        let pending = true;
        resolveAttackEffect = async (...args) => {
          const result = await original(...args);
          if (pending && result === true) { pending = false; return false; }
          return result;
        };
        return () => { resolveAttackEffect = original; };
      },
      setChoices(random, choose, coinFlip, presentCoin) { installEngineTestHooks({ random, choose, ...(coinFlip ? { coinFlip } : {}), ...(presentCoin ? {presentCoin} : {}) }); },
      effectAudit() { return registeredCards.map(card => ({ name: card.name, setCode: card.setCode, cardNumber: card.cardNumber, resolution: effectResolutionFor(card).key, implementationStatus: cardImplementationState(card).key, effect: itemEffectRuleFor(card)?.effect || null, handler: integrationFixtureCardHandlers(card) })); },
      supporterStatus(card) { return { support: effectSupportFor(card), resolution: effectResolutionFor(card).key, handler: supporterEffectRuleFor(card)?.effect?.type || null }; },
      itemStatus(card) { return { support: effectSupportFor(card), resolution: effectResolutionFor(card).key, handler: itemEffectRuleFor(card)?.effect?.type || itemEffectRuleFor(card)?.effect?.operation || null }; },
      failNextSupporterAfterMutation() {
        const original = resolveBuiltInSupporter;
        let pending = true;
        resolveBuiltInSupporter = async (...args) => {
          if (!pending) return original(...args);
          pending = false;
          const owner = player(args[1]), removed = owner.deck.pop();
          if (removed) owner.discard.push(removed);
          return false;
        };
        return () => { resolveBuiltInSupporter = original; };
      },
      failNextSupporterAfterResolve() {
        const original = resolveBuiltInSupporter;
        resolveBuiltInSupporter = async (...args) => { await original(...args); return false; };
        return () => { resolveBuiltInSupporter = original; };
      },
      throwNextSupporterAfterResolve(message) {
        const original = resolveBuiltInSupporter;
        resolveBuiltInSupporter = async (...args) => { await original(...args); throw new Error(message); };
        return () => { resolveBuiltInSupporter = original; };
      },
      failNextItemAfterResolve() {
        const original = resolveBuiltInItem;
        let pending = true;
        resolveBuiltInItem = async (...args) => {
          const result = await original(...args);
          if (pending && result === true) { pending = false; return false; }
          return result;
        };
        return () => { resolveBuiltInItem = original; };
      },
      async playCard(side, cardId) { controlSide = side; selected = { side, zone: 'hand', id: cardId }; return playTrainerSelected(); },
      async aiStep() { await runLocalAiStep(); },
      setLocalAi(enabled) { setLocalAiEnabled(enabled); },
      async humanAction(action) {
        controlSide = 'you';
        if (action.type === 'play_basic') { selected = { side: 'you', zone: 'hand', id: action.cardId }; return placeSelected('bench'); }
        if (action.type === 'attach_energy') { selected = { side: 'you', zone: 'hand', id: action.cardId }; return attachSelected(action.targetIds[0]); }
        if (action.type === 'evolve') { pendingEvolutionId = action.cardId; return evolveAt('you', action.targetId === player('you').active?.id ? 'active' : 'bench', action.targetId); }
        if (action.type === 'play_item' || action.type === 'play_supporter' || action.type === 'attach_tool') { selected = { side: 'you', zone: 'hand', id: action.cardId }; return playTrainerSelected(); }
        if (action.type === 'play_stadium') { selected = { side: 'you', zone: 'hand', id: action.cardId }; return placeSelected('stadium'); }
        if (action.type === 'use_ability') return this.useAbility('you',action.pokemonId,action.ability,false);
        if (action.type === 'use_stadium') return useActiveStadiumAbility('you');
        if (action.type === 'attack') {
          const p=player('you'), pokemon=[p.active,...p.bench].find(card=>card?.id===action.attackerId) || p.active;
          const option=attackEntries('you',pokemon).find(item=>item.index===action.attackIndex);
          const count=attackEffectChoiceCount(pokemon,option?.attack);
          return useAttack('you',action.attackIndex,pokemon.energy.slice(0,count).map(card=>card.id),false,pokemon.id);
        }
        if (action.type === 'end_turn') return endTurn();
        throw new Error('Unsupported human integration action ' + action.type + '.');
      }
    };
  `;
  vm.runInContext(bootstrap, context, { timeout: 10000 });
  const random = seededRandom(seed);
  const choose = request => {
    const candidates = request.candidates || [];
    if (request.kind === 'cards' && Number(request.minCount || 0) > 1) return candidates.slice(0, request.minCount);
    if (request.kind === 'cards') return candidates[0] ? [candidates[0]] : [];
    if (request.kind === 'prompt') return request.defaultValue;
    if (request.kind === 'confirm') return true;
    return candidates[0] || null;
  };
  return { context, document, api: context.integrationApi, random, choose };
}

function engineFunction(name) {
  const start = html.search(new RegExp(`^    (?:async )?function ${name}\\(`, 'm'));
  if (start < 0) throw new Error(`Could not find application function ${name}.`);
  const rest = html.slice(start), next = rest.slice(1).search(/^    (?:async )?function [\w$]+\(/m);
  return next < 0 ? rest : rest.slice(0, next + 1);
}

function seededRandom(seed) {
  let state = Number(seed) >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function scriptedChoices(sequence = {}) {
  const remaining = new Map(Object.entries(sequence).map(([kind, values]) => [kind, [...(Array.isArray(values) ? values : [values])]]));
  return request => {
    const queue = remaining.get(request.kind);
    if (!queue?.length) throw new Error(`No scripted choice remains for ${request.kind}.`);
    const choice = queue.shift();
    const candidates = request.candidates || [];
    if (candidates.length && !candidates.some(card => card.id === (typeof choice === 'string' ? choice : choice?.id))) {
      throw new Error(`Scripted ${request.kind} choice is not among the offered legal candidates.`);
    }
    return choice;
  };
}

function loadFixture(file = fixturePath) {
  if (!fs.existsSync(file)) return null;
  const fixture = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (fixture.schemaVersion !== 1 || fixture.kind !== 'pokemon-tcg-playmat-integration-fixture') throw new Error('Unsupported integration fixture format.');
  for (const side of ['human', 'ai']) {
    const deck = fixture.decks?.[side];
    if (!deck?.decklist) throw new Error(`Fixture is missing the ${side} decklist.`);
    const count = deck.decklist.split(/\r?\n/).reduce((sum, line) => sum + (line.match(/^\s*(\d+)\s+/)?.[1] ? Number(line.match(/^\s*(\d+)\s+/)[1]) : 0), 0);
    if (count !== 60) throw new Error(`${side} deck must contain 60 cards; fixture contains ${count}.`);
  }
  const prints = new Map();
  for (const card of fixture.cards || []) {
    if (!card.name || !card.setCode || !card.cardNumber || !card.meta || !card.implementationStatus || !card.effectResolution || !card.handlers) throw new Error('Fixture contains a card without verified print identity, metadata, or handler status.');
    const key = `${card.setCode}:${card.cardNumber}`;
    if (prints.has(key)) throw new Error(`Fixture repeats print identity ${key}.`);
    if (!['Pokemon', 'Trainer', 'Energy'].includes(card.meta.category)) throw new Error(`Fixture card ${card.name} (${key}) has no usable card category.`);
    if (card.meta.category === 'Pokemon' && (!card.meta.stage || !Number(card.meta.hp) || !Array.isArray(card.meta.attacks) || !Array.isArray(card.meta.abilities))) throw new Error(`Fixture Pokémon ${card.name} (${key}) is missing stage, HP, attacks, or abilities metadata.`);
    if (card.meta.category === 'Trainer' && (!card.meta.trainerType || typeof card.meta.effect !== 'string')) throw new Error(`Fixture Trainer ${card.name} (${key}) is missing subtype or complete effect text.`);
    if (card.meta.category === 'Trainer' && !card.meta.effect.trim()) throw new Error(`Fixture Trainer ${card.name} (${key}) has empty effect text.`);
    if (card.meta.category === 'Pokemon' && card.meta.attacks.some(attack => !attack.name || !Array.isArray(attack.cost) || typeof attack.effect !== 'string' || !(typeof attack.damage === 'number' || typeof attack.damage === 'string'))) throw new Error(`Fixture Pokémon ${card.name} (${key}) has incomplete attack metadata.`);
    if (card.meta.category === 'Pokemon' && card.meta.abilities.some(ability => !ability.name || typeof ability.effect !== 'string')) throw new Error(`Fixture Pokémon ${card.name} (${key}) has incomplete Ability metadata.`);
    if (card.meta.category === 'Energy' && !card.meta.energyType && !/energy$/i.test(card.name)) throw new Error(`Fixture Energy ${card.name} (${key}) is missing its Energy type.`);
    const languageProvenance = ['TCGdex', 'Limitless', 'Built-in rule'].includes(card.meta.source) || String(card.meta.image || '').startsWith('https://assets.tcgdex.net/en/');
    if (!languageProvenance || card.language?.toLowerCase() !== 'en') throw new Error(`Fixture card ${card.name} (${key}) is missing explicit English-language metadata provenance.`);
    prints.set(key, card);
  }
  const referenced = new Set();
  for (const side of ['human', 'ai']) {
    for (const line of fixture.decks[side].decklist.split(/\r?\n/)) {
      const cardLine = line.trim().match(/^\d+\s+(.+?)\s+([A-Z0-9]{2,5})\s+([A-Z0-9-]+)$/i);
      if (!cardLine) continue;
      const key = `${cardLine[2].toUpperCase()}:${cardLine[3].toUpperCase()}`;
      const record = prints.get(key);
      if (!record) throw new Error(`${side} deck print ${cardLine[2]} ${cardLine[3]} has no verified metadata record in the fixture.`);
      if (record.name.toLowerCase() !== cardLine[1].toLowerCase()) throw new Error(`${side} deck name ${cardLine[1]} conflicts with fixture identity ${record.name} (${key}).`);
      referenced.add(key);
    }
  }
  const unused = [...prints.keys()].filter(key => !referenced.has(key));
  if (unused.length) throw new Error(`Fixture contains card records not used by either deck: ${unused.join(', ')}.`);
  return fixture;
}

function loadEngineTestHooks() {
  const context = vm.createContext({ window: { __POKEMON_TCG_TEST__: true }, Math, Number, Set, Map, Error, console });
  vm.runInContext('let engineTestHooks = null;', context);
  for (const name of ['installEngineTestHooks', 'engineRandom', 'engineTestChoice']) vm.runInContext(engineFunction(name), context);
  vm.runInContext('globalThis.testHooks = { installEngineTestHooks, engineRandom, engineTestChoice };', context);
  return context;
}

function loadStartupCardContext() {
  const store = new Map();
  const context = vm.createContext({
    window: { __POKEMON_TCG_TEST__: true }, Math, Number, Set, Map, Error, console,
    localStorage: { getItem: key => store.has(key) ? store.get(key) : null, setItem: (key, value) => store.set(key, value) }
  });
  const deckStart = html.indexOf('    const DEFAULT_DECKS = [');
  const deckEnd = html.indexOf('    ];', deckStart) + 7;
  if (deckStart < 0 || deckEnd < 7) throw new Error('Could not find the application default deck data.');
  vm.runInContext(html.slice(deckStart, deckEnd) + '\nglobalThis.DEFAULT_DECKS = DEFAULT_DECKS;', context);
  vm.runInContext('let engineTestHooks = null;', context);
  for (const name of ['engineRandom', 'cleanName', 'normalizeCategory', 'normalizeCollectorNumber', 'cleanCardKey', 'isBasicEnergy', 'normalizedEnergyType', 'parseDeck', 'cardCatalogKey', 'seedRegisteredCards', 'readSavedCards', 'restoreLegacyCardLanguage', 'repairBasicEnergyType', 'loadRegisteredCards']) vm.runInContext(engineFunction(name), context);
  vm.runInContext("const CARD_STORAGE_KEY = 'cards'; const DELETED_CARDS_STORAGE_KEY = 'deleted-cards'; const deletedCardIds = new Set(); const registeredDecks = DEFAULT_DECKS; globalThis.startupCardApi = { parseDeck, seedRegisteredCards, loadRegisteredCards };", context);
  return context;
}

function attackOptionEvent(runner, index, type = 'click') {
  const button = {dataset:{attackIndex:String(index)}};
  return runner.document.getElementById('attackOptions').dispatchEvent({
    type, target:{closest: selector=>selector==='[data-attack-index]'?button:null}
  });
}

module.exports = { fixturePath, seededRandom, scriptedChoices, loadFixture, loadEngineTestHooks, loadStartupCardContext, createEngineRunner, attackOptionEvent };

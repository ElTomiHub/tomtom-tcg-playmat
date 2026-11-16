const assert = require('node:assert/strict');
const {test} = require('node:test');
const vm = require('node:vm');
const {createEngineRunner,loadFixture} = require('./integration-harness.cjs');

function setup() {
  const fixture = loadFixture();
  const runner = createEngineRunner(fixture,15);
  runner.api.setup(fixture,runner.random,runner.choose,()=>true);
  vm.runInContext('for (const card of registeredCards) card.id = cardCatalogKey(card)',runner.context);
  return {runner,deck:fixture.decks.ai};
}

function deckArticle(runner,id) {
  runner.context.renderDeckLibrary();
  return runner.document.getElementById('deckLibraryGrid').innerHTML.split('</article>')
    .find(article=>article.includes('data-deck-details="'+id+'"')) || '';
}

function editInBuilder(runner,id,change) {
  runner.context.loadDeckIntoBuilder(id);
  if (change) vm.runInContext(change,runner.context);
  runner.context.saveDeckBuilder();
}

function replaceDragonairWithLightning() {
  const dragonair = registeredCardForPrint({name:'Dragonair',setCode:'ASC',cardNumber:'151'}).id;
  const lightning = registeredCardForPrint({name:'Lightning Energy',setCode:'MEE',cardNumber:'4'}).id;
  const count = deckBuilderCounts.get(dragonair);
  deckBuilderCounts.delete(dragonair);
  deckBuilderCounts.set(lightning,deckBuilderCounts.get(lightning)+count);
}

test('the deck manager shows Strategy beside Playable for a matching verified deck',()=>{
  const {runner,deck}=setup();
  const html=deckArticle(runner,deck.id);
  assert.match(html,/>Playable<\/span><span class="deck-readiness deck-strategy active"[^>]*>Strategy<\/span>/);
  assert.equal(JSON.stringify(runner.api.backup().data.decks.find(item=>item.id===deck.id)),JSON.stringify(deck));
});

test('renaming and reordering the same list preserves Strategy, while a quantity edit shows Modified',()=>{
  const {runner,deck}=setup();
  editInBuilder(runner,deck.id,`
    $('deckNameInput').value='Renamed Dragonite';
    $('deckBuilderCategory').value='Master';
    deckBuilderCounts = new Map([...deckBuilderCounts].reverse());
  `);
  let html=deckArticle(runner,deck.id);
  assert.match(html,/Renamed Dragonite/);
  assert.match(html,/>Strategy<\/span>/);
  editInBuilder(runner,deck.id,`
    const water = registeredCardForPrint({name:'Water Energy',setCode:'MEE',cardNumber:'3'}).id;
    const lightning = registeredCardForPrint({name:'Lightning Energy',setCode:'MEE',cardNumber:'4'}).id;
    deckBuilderCounts.set(water,deckBuilderCounts.get(water)-1);
    deckBuilderCounts.set(lightning,deckBuilderCounts.get(lightning)+1);
  `);
  html=deckArticle(runner,deck.id);
  assert.match(html,/>Playable<\/span><span class="deck-readiness deck-strategy modified"[^>]*>Modified<\/span>/);
  assert.doesNotMatch(html,/>Strategy<\/span>/);
});

test('Modified survives a missing core card and a backup restore, then clears when the list is restored',()=>{
  const {runner,deck}=setup();
  editInBuilder(runner,deck.id,'('+replaceDragonairWithLightning.toString()+')()');
  assert.match(deckArticle(runner,deck.id),/>Modified<\/span>/);
  const reloaded=createEngineRunner(loadFixture(),27);
  reloaded.api.restoreBackup(runner.api.backup());
  assert.match(deckArticle(reloaded,deck.id),/>Modified<\/span>/);
  editInBuilder(reloaded,deck.id,`
    const dragonair = registeredCardForPrint({name:'Dragonair',setCode:'ASC',cardNumber:'151'}).id;
    const lightning = registeredCardForPrint({name:'Lightning Energy',setCode:'MEE',cardNumber:'4'}).id;
    deckBuilderCounts.set(dragonair,4);
    deckBuilderCounts.set(lightning,deckBuilderCounts.get(lightning)-4);
  `);
  const html=deckArticle(reloaded,deck.id);
  assert.match(html,/>Strategy<\/span>/);
  assert.doesNotMatch(html,/>Modified<\/span>/);
});

test('pasting an edit marks a replacement print as Modified and tracks the previous list',async()=>{
  const {runner,deck}=setup();
  runner.context.loadDeckIntoImport(deck.id);
  const input=runner.document.getElementById('deckImportText');
  assert.match(input.value,/Lightning Energy MEE 4/);
  input.value=input.value.replace('Lightning Energy MEE 4','Lightning Energy SVE 12');
  vm.runInContext(`
    resolveDeckMetadata = async parsed => {
      for (const card of parsed.cards) {
        const original = registeredCardForPrint(card) ||
          registeredCards.find(item => item.name===card.name && card.meta===null && isBasicEnergy(card.name));
        card.meta = original.meta;
      }
      return [];
    };
  `,runner.context);
  await runner.context.importDeckFromText();
  const saved=runner.api.backup().data.decks.find(item=>item.id===deck.id);
  assert.match(saved.decklist,/Lightning Energy SVE 12/);
  assert.match(saved.strategyBaseline,/print:MEE:4:lightning energy/);
  assert.match(deckArticle(runner,deck.id),/>Modified<\/span>/);
});

test('an unprofiled list shows neither badge',()=>{
  const {runner,deck}=setup();
  runner.context.cloneId='without-strategy';
  runner.context.cloneSource=deck.id;
  vm.runInContext(`
    const original = registeredDecks.find(deck=>deck.id===cloneSource);
    registeredDecks.push({...original,id:cloneId,name:'Other list',
      decklist:original.decklist.replace(/^4 Dragonair ASC 151\\r?\\n/m,'').replace('8 Lightning Energy','12 Lightning Energy')});
  `,runner.context);
  const html=deckArticle(runner,'without-strategy');
  assert.match(html,/Other list/);
  assert.doesNotMatch(html,/deck-strategy/);
});

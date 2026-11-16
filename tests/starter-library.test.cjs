const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {test} = require('node:test');
const vm = require('node:vm');
const {buildStarterLibrary} = require('../build-starter-library.cjs');
const {createEngineRunner,loadFixture} = require('./integration-harness.cjs');

const app = path.join(__dirname,'..');
const asset = path.join(app,'assets','starter-library.js');
const source = fs.readFileSync(asset,'utf8');
const fixture = loadFixture();
const start = savedStorage => createEngineRunner(fixture,1,{starterSource:source,savedStorage});
const withApp = (runner, code) => vm.runInContext(code,runner.context);

test('the shipped website seeds a fresh browser with playable decks, covers and no private history',()=>{
  assert.ok(fs.readFileSync(path.join(app,'index.html'),'utf8').includes('src="assets/starter-library.js"'));
  const r = start({});
  const summary = withApp(r,`({
    seeded:starterLibrary().decks.length,
    decks:registeredDecks.map(deck=>({id:deck.id,category:deck.category,ready:deckReadiness(deck).playable,
      cover:!deck.coverCardId || !!registeredCards.find(card=>card.id===deck.coverCardId)?.meta?.image})),
    ids:new Set(registeredCards.map(card=>card.id)).size,
    cardCount:starterLibrary().cards.length,
    privateFields:Object.keys(starterLibrary()),
    history:Object.keys(deckStats).length,
    order:decksInManagerOrder().map(deck=>deck.id),
    sourceOrder:starterLibrary().decks.map(deck=>deck.id)
  })`);
  assert.equal(summary.decks.length,summary.seeded);
  assert.ok(summary.decks.length>0 && summary.cardCount>0);
  assert.ok(summary.ids>=summary.cardCount);
  assert.deepEqual(summary.order,summary.sourceOrder);
  assert.ok(summary.decks.every(deck=>deck.category && deck.cover));
  assert.deepEqual(Array.from(summary.decks.filter(deck=>!deck.ready),deck=>deck.id),[]);
  assert.deepEqual(Array.from(summary.privateFields),['schemaVersion','decks','cards']);
  assert.equal(summary.history,0);
  assert.equal(r.context.localStorage.getItem('codexPokemonPlaymat.decks.v1'),null);
  assert.equal(r.context.localStorage.getItem('codexPokemonPlaymat.cards.v1'),null);
});

test('local deck and card edits, deletions and deck order take precedence after a refresh',()=>{
  const initial = start({});
  const deck = withApp(initial,'starterLibrary().decks[0]');
  const removed = withApp(initial,'starterLibrary().decks[1]');
  const next = withApp(initial,'starterLibrary().decks[2]');
  const card = withApp(initial,'starterLibrary().cards[0]');
  const deleted = withApp(initial,'starterLibrary().cards[1]');
  const r = start({
    'codexPokemonPlaymat.decks.v1':[{id:deck.id,name:'My local deck name',decklist:deck.decklist,category:'R'}],
    'codexPokemonPlaymat.deckOrder.v1':[next.id,deck.id],
    'codexPokemonPlaymat.deletedDecks.v1':[removed.id],
    'codexPokemonPlaymat.cards.v1':[{...card,meta:{...card.meta,hp:999}}],
    'codexPokemonPlaymat.deletedCards.v1':[deleted.id]
  });
  Object.assign(r.context,{testDeck:deck,testRemoved:removed,testNext:next,testCard:card,testDeleted:deleted});
  assert.equal(withApp(r,'registeredDecks.find(deck=>deck.id===testDeck.id).name'),'My local deck name');
  assert.equal(withApp(r,'registeredDecks.find(deck=>deck.id===testDeck.id).coverCardId'),undefined);
  assert.equal(withApp(r,'registeredDecks.some(deck=>deck.id===testRemoved.id)'),false);
  assert.equal(withApp(r,'decksInManagerOrder()[0].id'),next.id);
  assert.equal(withApp(r,'registeredCards.find(card=>card.id===testCard.id).meta.hp'),999);
  assert.equal(withApp(r,'registeredCards.some(card=>card.id===testDeleted.id)'),false);
  assert.equal(withApp(r,'persistSavedDecks() && persistRegisteredCards()'),true);
  assert.equal(JSON.parse(r.context.localStorage.getItem('codexPokemonPlaymat.decks.v1')).length,1);
  const localCards = JSON.parse(r.context.localStorage.getItem('codexPokemonPlaymat.cards.v1'));
  assert.ok(localCards.some(saved=>saved.id===card.id && saved.meta.hp===999));
  assert.ok(localCards.length<10);
});

test('the builder publishes only library fields and preserves the supplied order and exact cover identity',()=>{
  const sourceCard={name:'Dialga ex',setCode:'SVP',cardNumber:'180',meta:{category:'Pokemon',energy:[],image:'https://assets.tcgdex.net/image'}};
  const result = buildStarterLibrary({
    kind:'pokemon-tcg-playmat-backup',schemaVersion:1,
    data:{decks:[{id:'first',name:'One',decklist:'1 Dialga ex SVP 180',coverCardId:'old-id',private:'secret'},
      {id:'second',name:'Two',decklist:'1 Dialga ex SVP 180'}],deckOrder:['second','first'],
      cards:[{...sourceCard,id:'old-id',energy:['private']},{...sourceCard,id:'print:SVP:180'}],deckStats:{private:'secret'},recordings:['secret']}
  });
  assert.deepEqual(result.decks.map(deck=>deck.id),['second','first']);
  assert.equal(result.decks[1].coverCardId,'print:SVP:180');
  assert.equal(result.cards.length,1);
  assert.doesNotMatch(JSON.stringify(result),/private|secret|recordings|deckStats/);
});

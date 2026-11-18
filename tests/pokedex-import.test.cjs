const {test}=require('node:test');
const assert=require('node:assert/strict');
const {parseCSV,convertRows,collectionCounts,selectCollection,mergeCollection,previewCounts,inRegion,normalizeSavedVariants,binderNumber,catalogEntry,entryInRegion,tomaPokemonNames,normalizeSearch,featuredCard,chooseFeaturedCard}=require('../assets/pokedex.js');
require('../assets/pokedex-species-names.js');

test('Pokédex search has English, French and Japanese names for all 1025 species',()=>{
  const names=globalThis.POKEDEX_SPECIES_NAMES;
  assert.equal(names.length,1025);
  assert.ok(names.every(row=>row.length===3 && row.every(Boolean)));
  assert.deepEqual(names[0],['Bulbasaur','Bulbizarre','フシギダネ']);
  assert.equal(normalizeSearch(' FLABÉBÉ '),'flabebe');
  assert.equal(normalizeSearch('ふしぎだね'),'フシギダネ');
  assert.equal(normalizeSearch('ﾌｼｷﾞﾀﾞﾈ'),'フシギダネ');
});

test('featured choices replace the prior selection for one form and retain imported preferences',()=>{
  const cards=[{id:'imported',featured:'t',image:'imported.png'},{id:'new',image:'new.png'},{id:'no-image'}];
  const saved=[{id:'preferences:latest',pokemonKey:'59',normalOnly:true}];
  const base=chooseFeaturedCard(saved,'59','new');
  const withForm=chooseFeaturedCard(base,'59-hisuian','imported');
  const updated=chooseFeaturedCard(withForm,'59','no-image');
  assert.deepEqual(updated,[saved[0],{id:'featured:59',cardId:'no-image'},{id:'featured:59-hisuian',cardId:'imported'}]);
  assert.equal(featuredCard(cards,updated[1].cardId).id,'no-image');
  assert.equal(featuredCard(cards,'other-form').id,'imported');
  assert.equal(featuredCard(cards.slice(1)).id,'new');
  assert.equal(chooseFeaturedCard(updated,'59','no-image'),updated);
});

test('collection CSV supports semicolons, BOM, escaped quotes and multiline fields',()=>{
  const csv='\uFEFFid;name;notes\r\n1;"Mime; Jr.";"First\r\nSecond ""line"""\r\n';
  assert.deepEqual(parseCSV(csv).rows,[{id:'1',name:'Mime; Jr.',notes:'First\r\nSecond "line"'}]);
  assert.throws(()=>parseCSV('id,name\n1,"unfinished'),/quoted field/);
  assert.throws(()=>parseCSV('id,id\n1,2'),/header/);
});

test('preview scopes the import to a chosen collection and repeated imports preserve edits and copies',()=>{
  const data={
    cards:convertRows('cards',
      'id;collection_id;pokemon_id;pokemon_unique_id;set_name;card_number;variant;image_url\n'+
      'one;main;25;25;SV2A;025/165;normal;https://example.com/one.jpg\n'+
      'two;main;25;25;SV2A;025/165;normal;https://example.com/two.jpg\n'+
      'one-other;other;4;4;SV2A;;holo;http://example.com/photo.jpg'),
    binder:[],
    preferences:convertRows('preferences','id;collection_id;pokemon_unique_id;normal_only\np;main;25;true')
  };
  assert.deepEqual(collectionCounts(data).map(({id,cards})=>[id,cards]),[['main',2],['other',1]]);
  const chosen=selectCollection(data,'main');
  assert.deepEqual(previewCounts(chosen,[{setCode:'sv2a',cardNumber:'25'}]),
    {cards:2,binder:0,preferences:1,missingPrint:0,missingPhoto:0,candidates:2});
  const saved=mergeCollection({cards:[],binder:[],preferences:[]},chosen);
  saved.cards[0].notes='changed locally';
  assert.deepEqual(mergeCollection(saved,chosen),saved);
  assert.equal(previewCounts(selectCollection(data,'other')).missingPhoto,1);
});

test('legacy silver variants become normal without collapsing physical copies',()=>{
  const saved={cards:[{id:'1',variant:'normal-silver'},{id:'2',variant:'normal'}],
    binder:[{id:'3',variant:'Normal Silver'}],preferences:[]};
  const migrated=normalizeSavedVariants(saved);
  assert.deepEqual(migrated.cards.map(({id,variant})=>[id,variant]),[['1','normal'],['2','normal']]);
  assert.equal(migrated.binder[0].variant,'normal');
  assert.equal(saved.cards[0].variant,'normal-silver');
  assert.equal(normalizeSavedVariants(migrated),migrated);
});

test('region filter uses National Pokédex boundaries',()=>{
  assert.equal(inRegion(151,'Kanto'),true);
  assert.equal(inRegion(152,'Kanto'),false);
  assert.equal(inRegion(898,'Galar'),true);
  assert.equal(inRegion(899,'Hisui'),true);
  assert.equal(inRegion(906,'Hisui'),false);
  assert.equal(inRegion(1025,'Paldea'),true);
});

test('regional forms own separate prints and keep the original species binder',()=>{
  const standard=catalogEntry({pokemonId:59,pokemonKey:'59'});
  const hisuian=catalogEntry({pokemonId:59,pokemonKey:'59-hisuian'});
  assert.notEqual(standard.key,hisuian.key);
  assert.equal(hisuian.sprite,10230);
  assert.equal(binderNumber(hisuian.id),1);
  assert.equal(entryInRegion(hisuian,'Hisui'),true);
  assert.equal(entryInRegion(hisuian,'Kanto'),false);
  assert.equal(entryInRegion(standard,'Kanto'),true);
  assert.deepEqual([386,387,721,722].map(binderNumber),[1,2,2,3]);
});

test('the Toma marker uses local deck overrides and excludes deleted and non-Toma decks',()=>{
  const deck=(id,category,name)=>({id,category,decklist:'Pokémon: 1\n1 '+name+' S9A 020\nTrainer: 1\n1 Arven SVI 166'});
  const bundled=[deck('one','Toma','Squirtle'),deck('two','Master','Charizard'),deck('three','Toma','Pikachu')];
  const saved=[deck('one','Toma','Hisuian Arcanine V')];
  assert.deepEqual([...tomaPokemonNames(bundled,saved,new Set(['three']),[])],['hisuian arcanine']);
});

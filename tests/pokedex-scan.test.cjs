const {test}=require('node:test');
const assert=require('node:assert/strict');
const {printIdentity,checkCollection,availableVariants,readPrintedClues,makeCatalog,limitlessLink}=require('../assets/pokedex-scan.js');
const names=[['Bulbasaur','Bulbizarre','フシギダネ'],['Pikachu','Pikachu','ピカチュウ']];

test('recognizes a Japanese scan with full-width punctuation and an English set with a language mark',()=>{
  assert.deepEqual(readPrintedClues('たね ピカチュウ HP60\nＳＶ２ａ ０２５／１６５',['SV2a'],names),
    {language:'ja',set:'SV2A',number:'025/165',name:'ピカチュウ'});
  assert.deepEqual(readPrintedClues('Basic Pikachu HP 60\nMEG EN 025/132',['MEG'],names),
    {language:'en',set:'MEG',number:'025/132',name:'Pikachu'});
  assert.deepEqual(readPrintedClues('Basic Pikachu HP 60\n025/165',[],names),
    {language:'en',set:'',number:'025/165',name:'Pikachu'});
});

test('the scan distinguishes regional form, print, and confirmed foil for ownership',()=>{
  const card={name:'ヒスイ ウインディV',dexId:[59],localId:'019',set:{cardCount:{official:68}}};
  const identity=printIdentity(card,'ja','S11a');
  assert.equal(identity.pokemonKey,'59-hisuian');
  assert.equal(identity.printedNumber,'019/68');
  const cards=[
    {id:'one',pokemonKey:'59-hisuian',set:'s11a',number:'19/068',variant:'Pokeball Reverse Holo'},
    {id:'two',pokemonKey:'59',set:'S11a',number:'019',variant:'pokeball-reverse-holo'},
    {id:'three',pokemonKey:'59-hisuian',set:'S11a',number:'019',variant:'normal'}
  ];
  assert.equal(checkCollection(cards,identity,'').exact.length,0);
  assert.deepEqual(checkCollection(cards,identity,'pokeball-reverse-holo').exact.map(row=>row.id),['one']);
  assert.equal(checkCollection(cards,identity,'holo').samePrint.length,2);
  assert.equal(limitlessLink('ja','SV2a','025/165'),'https://limitlesstcg.com/cards/jp/SV2a/25?translate=en');
  assert.equal(limitlessLink('ja','../test','025'),'');
});

test('shared English and French set numbers do not count as the same language print',()=>{
  const identity=printIdentity({name:'Latios',dexId:[381],localId:'101'},'fr','MEG');
  const cards=[
    {pokemonKey:'381',set:'MEG',number:'101/132',variant:'normal',language:'en'},
    {pokemonKey:'381',set:'MEG',number:'101/132',variant:'normal'},
    {pokemonKey:'381',set:'MEG',number:'101/132',variant:'normal',image:'https://assets.tcgdex.net/fr/me/me01/101/high.webp'}
  ];
  const result=checkCollection(cards,identity,'normal');
  assert.equal(result.sameSpecies.length,3);
  assert.equal(result.samePrint.length,2);
  assert.equal(result.exact.length,1);
  assert.equal(result.unknownLanguage,1);
});

test('catalog options retain the Japanese 151 variants and classify illustration rares',()=>{
  assert.deepEqual(availableVariants({variants_detailed:[
    {type:'normal',size:'standard'},{type:'reverse',foil:'pokeball'},{type:'reverse',foil:'masterball'}
  ]}),['normal','pokeball-reverse-holo','masterball-reverse-holo']);
  assert.deepEqual(availableVariants({rarity:'Special illustration rare',variants:{holo:true}}),['illustration-rare']);
});

test('an English set abbreviation resolves the exact number and checks the printed denominator',async()=>{
  const result={id:'me01-101',localId:'101',name:'Latios',set:{id:'me01',cardCount:{official:132}}};
  const catalog=makeCatalog(async url=>{
    const {pathname,searchParams}=new URL(url);
    if (searchParams.get('abbreviation.official')==='eq:MEG') return Response.json([{id:'me01'}]);
    if (pathname.endsWith('/me01/101')) return Response.json(result);
    return new Response(null,{status:404});
  });
  const input={language:'en',set:'MEG',name:'Latios',insistSet:true};
  assert.deepEqual(await catalog.lookup({...input,number:'101/132'}),[{card:result,code:'MEG'}]);
  assert.deepEqual(await catalog.lookup({...input,number:'101/165'}),[]);
});

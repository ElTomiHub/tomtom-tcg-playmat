const {test}=require('node:test');
const assert=require('node:assert/strict');
const p=require('../assets/pokedex-prices.js');
const card={id:'a',set:'SV2a',number:'059/165',variant:'pokeball-reverse-holo'};
function listing(id,title,value){return `<div class="item_data" data-product-id="${id}"><p><span class="goods_name">${title}</span></p><span class="figure">${value}円</span></div>`;}
const normal=listing(1,'ウインディ【U】{059/165} [SV2a]','120');
const ball=listing(2,'ウインディ(モンスターボールミラー)【U】{059/165} [SV2a]','480');
const master=listing(3,'ウインディ(マスターボールミラー)【U】{059/165} [SV2a]','5,480');
test('exact set, denominator, language and variant; graded/damaged and wrong sets never replace the requested finish',()=>{
  const html=normal+ball+master+listing(4,'〔状態B〕ウインディ(モンスターボールミラー)【U】{059/165} [SV2a]','320')+
    listing(5,'ウインディ(モンスターボールミラー)【U】{059/165} [S1]','40');
  assert.equal(p.match(card,html).value,480);
  assert.equal(p.match({...card,variant:'masterball-reverse-holo'},html).value,5480);
  assert.equal(p.match({...card,variant:'normal'},html).value,120);
  assert.equal(p.match({...card,number:'059/193'},html).status,'not_found');
  assert.equal(p.match({...card,language:'en'},html).status,'missing_info');
  assert.equal(p.match({...card,number:'59'},html).status,'not_found');
  assert.equal(p.match(card,normal+master).status,'not_found');
  assert.equal(p.match(card,ball+ball).status,'ambiguous');
  assert.equal(p.match(card,'Just a moment... cf-chl-').status,'blocked');
});
test('cached prices survive failures; totals count copies and include default estimates; deleted manual value does not revive legacy prices',()=>{
  const unknown={...card,number:'060/165'};
  let prefs=p.upsert([],card,{status:'success',value:480,source:'Card Rush'});
  prefs=p.upsert(prefs,card,{status:'blocked',value:null});
  assert.equal(p.quote(card,prefs).value,480);
  assert.deepEqual(p.totals([card,{...card,id:'b'},unknown],prefs),{value:1000,priced:2,missing:1,count:3});
  assert.equal(p.quote({...card,variant:'normal'},prefs),null);
  assert.equal(p.quote({...card,value:'120',currency:'JPY'},[]).value,120);
  assert.equal(p.quote({...card,value:120,currency:'EUR'},[]),null);
  prefs=[{id:p.key(card),value:null,currency:'JPY',status:'removed'}];
  assert.equal(p.quote({...card,value:120,currency:'JPY'},prefs),null);
});
test('identity normalization prevents duplicate cache entries but distinguishes languages and finishes',()=>{
  assert.equal(p.key(card),p.key({...card,set:'sv2a',number:'59 / 165'}));
  assert.notEqual(p.key(card),p.key({...card,variant:'masterball-reverse-holo'}));
  assert.notEqual(p.key(card),p.key({...card,language:'en'}));
  for(const value of [NaN,Infinity,-1,'120',null]) assert.equal(p.validAmount(value),false);
  assert.equal(p.validAmount(0),true);
  assert.equal(p.lookupInput({...card,set:'../../x'}),null);
});
test('value list filters missing prices, includes zero as priced, groups copies and sorts estimates at their displayed value',()=>{
  const expensive={id:'expensive',name:'Évoli',set:'TEST',number:'1',value:500,currency:'JPY'};
  const cheap={id:'cheap',name:'Bulbasaur',set:'TEST',number:'2',value:100,currency:'JPY'};
  const missing={id:'missing',name:'Charmander',set:'TEST',number:'3'};
  const zero={id:'zero',name:'Trainer',set:'TEST',number:'4'};
  const data={cards:[expensive,{...expensive,id:'copy'},cheap,missing],binder:[zero],
    preferences:[{id:p.key(zero),value:0,currency:'JPY'}]};
  const ids=options=>p.valueRows(data,options).map(row=>row.card.id);
  assert.deepEqual(ids({}),['expensive','cheap','missing','zero']);
  assert.equal(p.valueRows(data)[0].count,2);
  assert.deepEqual(ids({sort:'low'}),['zero','missing','cheap','expensive']);
  assert.deepEqual(ids({availability:'missing'}),['missing']);
  assert.deepEqual(ids({availability:'priced',destination:'binder'}),['zero']);
  assert.deepEqual(ids({destination:'cards',search:'evoli'}),['expensive']);
  assert.deepEqual(ids({search:'test 2'}),['cheap']);
  assert.deepEqual(ids({sort:'name'}),['cheap','missing','expensive','zero']);
});
test('default estimates are counted per copy without becoming quotes; manual and fetched prices replace them',()=>{
  const first={id:'first',name:'Unknown',set:'TEST',number:'9',variant:'normal'};
  const copies=[first,{...first,id:'second'}];
  assert.equal(p.quote(first,[]),null);
  assert.deepEqual(p.totals(copies,[]),{value:80,priced:0,missing:2,count:2});
  assert.equal(p.valueRows({cards:copies,binder:[],preferences:[]},{availability:'missing'})[0].count,2);
  const failed=p.upsert([],first,{status:'not_found'});
  assert.equal(p.totals(copies,failed).value,80);
  assert.equal(p.quote(first,failed),null);
  const manual=[{id:p.key(first),value:40,currency:'JPY',source:'Manual value',status:'manual'}];
  assert.deepEqual(p.totals(copies,manual),{value:80,priced:2,missing:0,count:2});
  assert.equal(p.valueRows({cards:copies,binder:[],preferences:manual},{availability:'missing'}).length,0);
  const fetched=p.upsert(failed,first,{status:'success',value:150,source:'Card Rush'});
  assert.deepEqual(p.totals(copies,fetched),{value:300,priced:2,missing:0,count:2});
  assert.deepEqual(p.totals([],[]),{value:0,priced:0,missing:0,count:0});
});
test('imported quotes contain only public print data and retain their historical dates without overriding manual removals',()=>{
  const fs=require('node:fs'),vm=require('node:vm');
  const context={};
  vm.runInNewContext(fs.readFileSync(require.resolve('../assets/pokedex-imported-prices.js'),'utf8'),context);
  assert.equal(context.POKEDEX_IMPORTED_PRICES.length,203);
  for(const row of context.POKEDEX_IMPORTED_PRICES) {
    assert.deepEqual(Object.keys(row).sort(),['set','number','variant','value','currency','source','sourceUrl','checkedAt'].sort());
    assert.ok(Number.isFinite(Date.parse(row.checkedAt)));
    assert.equal(row.currency,'JPY');
  }
  vm.runInNewContext(fs.readFileSync(require.resolve('../assets/pokedex-prices.js'),'utf8'),context);
  const item=context.POKEDEX_IMPORTED_PRICES[0];
  const card={set:item.set,number:item.number,variant:item.variant};
  const prices=context.PokedexPrices;
  assert.equal(prices.quote(card,[]).value,item.value);
  assert.equal(prices.quote(card,[{id:prices.key(card),value:null,currency:'JPY'}]),null);
  assert.equal(prices.quote({...card,language:'en'},[]),null);
});
test('price refresh uses the signed-in owner session and never an anonymous or service key',async()=>{
  const {createLibrarySyncClient}=require('../assets/library-sync.js');
  const rows=new Map(),calls=[];
  const client=createLibrarySyncClient({projectUrl:'https://example.supabase.co',publishableKey:'sb_publishable_test',
    storage:{getItem:key=>rows.get(key),setItem:(key,value)=>rows.set(key,value)},
    fetcher:async(url,options)=>{calls.push({url,options});return {ok:true,status:200,json:async()=>({status:'blocked'})};}});
  await assert.rejects(client.priceLookup('SV2A','59/165'),/Sign in/);
  assert.equal(calls.length,0);
  rows.set(client.sessionKey,JSON.stringify({userId:'owner',access_token:'owner-token',expires_at:9999999999}));
  await client.priceLookup('SV2A','59/165');
  assert.match(calls[0].url,/\/rpc\/playmat_price_lookup$/);
  assert.equal(calls[0].options.headers.Authorization,'Bearer owner-token');
  assert.deepEqual(JSON.parse(calls[0].options.body),{set_code:'SV2A',collector_number:'59/165'});
});
test('saved prices travel in collection backup and sync without changing physical cards',async()=>{
  const {createPokedexStore,parsePokedexBackup}=require('../assets/pokedex-sync.js');
  let raw=null,cloud=null,revision=0;
  const local=createPokedexStore({getItem:()=>raw,setItem:(_,next)=>{raw=next;}},'test');
  const empty={cards:[],binder:[],preferences:[]};
  const collection={cards:[card],binder:[],preferences:p.upsert([],card,{status:'success',value:480})};
  local.save(empty,collection);
  await local.sync({getSession:()=>({userId:'owner'}),readCollection:async()=>({collection:cloud,revision}),
    writeCollection:async(expected,next)=>{assert.equal(expected,revision);cloud=next;return ++revision;}},{userId:'owner'});
  assert.equal(p.totals(cloud.cards,cloud.preferences).value,480);
  const restored=parsePokedexBackup(local.exportBackup());
  assert.equal(p.totals(restored.cards,restored.preferences).value,480);
  assert.deepEqual(restored.cards,[card]);
});

const assert = require('node:assert/strict');
const {test} = require('node:test');
const vm = require('node:vm');
const {librarySyncDecision,canonicalLibraryJson,createLibrarySyncClient} = require('../assets/library-sync.js');
const {createEngineRunner,loadFixture} = require('./integration-harness.cjs');

test('private sync distinguishes initial upload, safe pull and conflicting edits',()=>{
  const remote = {revision:2,hash:'cloud'};
  for (const [input,expected] of [
    [{local:'one',remote:null},'upload'],
    [{local:'blank',remote,empty:true},'download'],
    [{local:'edit',remote},'conflict'],
    [{local:'cloud',remote},'matched'],
    [{local:'edit',remote,baseline:{revision:2,hash:'cloud'}},'upload'],
    [{local:'old',remote,baseline:{revision:1,hash:'old'}},'download'],
    [{local:'edit',remote,baseline:{revision:1,hash:'old'}},'conflict']
  ]) assert.equal(librarySyncDecision(input),expected);
  assert.equal(canonicalLibraryJson({b:2,a:[1,{d:1,c:2}]}),canonicalLibraryJson({a:[1,{c:2,d:1}],b:2}));
  assert.notEqual(canonicalLibraryJson({cards:[1,2]}),canonicalLibraryJson({cards:[2,1]}));
});

test('owner sign-in remembers a refreshable session and sends conditional writes',async()=>{
  const entries = new Map(), requests = [];
  const storage = {getItem:key=>entries.get(key),setItem:(key,value)=>entries.set(key,value),removeItem:key=>entries.delete(key)};
  let now = 1700000000000;
  let ownerAllowed = true;
  const response = (status,body)=>({ok:status<400,status,json:async()=>body});
  const config = {projectUrl:'https://sample.supabase.co',publishableKey:'sb_publishable_example',
    storage,clock:()=>now,fetcher:async(url,options)=>{
      const body = options.body ? JSON.parse(options.body) : undefined;
      requests.push({url,headers:options.headers,body});
      if (url.includes('/token?')) return response(200,{access_token:body.refresh_token ? 'refreshed' : 'initial',
        refresh_token:'refresh',expires_in:120,user:{id:'owner'}});
      if (url.endsWith('playmat_library_read')) return ownerAllowed ?
        response(200,{revision:1,library:{schemaVersion:1}}) : response(403,{});
      if (url.endsWith('playmat_library_write')) return response(200,null);
      return response(204,null);
    }};
  const client = createLibrarySyncClient(config);
  await client.signIn('owner@example.test','test-password');
  assert.equal(client.getSession().userId,'owner');
  assert.ok(!JSON.stringify(Array.from(entries)).includes('test-password'));
  now += 100000;
  assert.equal(await client.write(1,{schemaVersion:1}),null);
  const save = requests.at(-1);
  assert.equal(save.headers.Authorization,'Bearer refreshed');
  assert.equal(save.headers.apikey,'sb_publishable_example');
  assert.equal(save.body.expected_revision,1);
  await client.signOut();
  assert.equal(client.getSession(),null);
  ownerAllowed = false;
  await assert.rejects(client.signIn('other@example.test','test-password'),{status:403});
  assert.equal(client.getSession(),null);
  assert.throws(()=>createLibrarySyncClient({...config,publishableKey:'sb_secret_example'}));
  assert.throws(()=>createLibrarySyncClient({...config,projectUrl:'https://fake.test/supabase.co'}));
});

test('applying an online library keeps match data and writes only library keys',()=>{
  const r = createEngineRunner(loadFixture());
  const run = code=>vm.runInContext(code,r.context);
  run(`for (const id of ['setupModal','deckManagerModal','cardLibraryModal']) $(id).classList.add('hidden');
       $('statisticsPage').classList.add('app-hidden');
       localStorage.setItem(DECK_STATS_STORAGE_KEY,'{"secret":"history"}');
       localStorage.setItem(MATCH_STORAGE_KEY,'{"private":"unfinished"}');
       localStorage.setItem(DECK_STORAGE_KEY,JSON.stringify([{id:'remote',name:'Old local',decklist:'1 Eevee',secret:'private'}]));`);
  const snapshot = run('librarySyncSnapshot()');
  assert.deepEqual(Object.keys(snapshot),['schemaVersion','decks','cards','deckOrder','deletedDeckIds','deletedCardIds']);
  assert.doesNotMatch(JSON.stringify(snapshot),/secret|history|unfinished/);
  r.context.online = {...snapshot,decks:[{id:'remote',name:'Online deck',decklist:'1 Eevee'}],deckOrder:['remote']};
  assert.throws(()=>run("validateSyncedLibrary({...online,deckStats:{private:true}})"));
  run('applySyncedLibrary(validateSyncedLibrary(online))');
  assert.equal(run("registeredDecks.find(deck=>deck.id==='remote').name"),'Online deck');
  assert.equal(run('localStorage.getItem(DECK_STATS_STORAGE_KEY)'),'{"secret":"history"}');
  assert.equal(run('localStorage.getItem(MATCH_STORAGE_KEY)'),'{"private":"unfinished"}');
});

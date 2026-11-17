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

test('completed results from two devices add once, including matchup and badge counters',()=>{
  const {progressStatsDelta,mergePlaymatProgress} = require('../assets/library-sync.js');
  const baseline = {deck:{plays:10,wins:3,losses:7,mastery:{dedication:10},cards:{}}};
  const cloud = {schemaVersion:1,deckStats:baseline,campaign:null,receipts:[]};
  const summary = id=>({id:id+':you',endedAt:'2026-11-17T00:00:00Z',perspective:'you',decks:{you:{id:'deck'}}});
  const win = {id:'match-win',stats:progressStatsDelta(baseline,{deck:{plays:11,wins:4,losses:7,
    mastery:{dedication:11},cards:{pika:{name:'Pikachu',used:2}}}}),summaries:[summary('match-win')]};
  const loss = {id:'match-loss',stats:progressStatsDelta(baseline,{deck:{plays:11,wins:3,losses:8,
    mastery:{dedication:11},cards:{pika:{name:'Pikachu',used:1}}}}),summaries:[summary('match-loss')]};
  const merged = mergePlaymatProgress(mergePlaymatProgress(cloud,[win]),[loss,win,loss]);
  assert.equal(merged.deckStats.deck.plays,12);
  assert.equal(merged.deckStats.deck.wins,4);
  assert.equal(merged.deckStats.deck.losses,8);
  assert.equal(merged.deckStats.deck.mastery.dedication,12);
  assert.equal(merged.deckStats.deck.cards.pika.used,3);
  assert.equal(merged.deckStats.deck.history.length,2);
  assert.equal(cloud.deckStats.deck.plays,10);
  assert.deepEqual(mergePlaymatProgress(merged,[win,loss]),merged);
});

test('campaign progress cannot go backwards and campaign completion counts only once',()=>{
  const {mergePlaymatProgress} = require('../assets/library-sync.js');
  const campaign = {id:'match-100-run',deckId:'deck',results:['win','loss']};
  const cloud = {schemaVersion:1,deckStats:{},campaign,receipts:[]};
  const finish = {...campaign,results:['win','loss','win','win','draw']};
  const conflicting = {...finish,results:['loss','loss','loss','win','draw']};
  const stats = {deck:{campaign:{completed:1,cleared:1,bestWins:3},campaignChampion:true}};
  const merged = mergePlaymatProgress(cloud,[
    {id:'old-round',campaign:{...campaign,results:['win']}},
    {id:'campaign-finish:'+campaign.id,campaign:conflicting,stats},
    {id:'campaign-finish:'+campaign.id,campaign:finish,stats},
    {id:'campaign-finish:'+campaign.id,campaign:finish,stats}
  ]);
  assert.deepEqual(merged.campaign,finish);
  assert.deepEqual(merged.deckStats,stats);
});

test('the progress snapshot excludes recordings and saved games and validates before applying',()=>{
  const r = createEngineRunner(loadFixture());
  const run = code=>vm.runInContext(code,r.context);
  run(`for (const id of ['setupModal','deckManagerModal','campaignModal']) $(id).classList.add('hidden');
       $('statisticsPage').classList.add('app-hidden');
       localStorage.setItem(MATCH_STORAGE_KEY,'{"game":{"phase":"play"}}');`);
  assert.equal(run('canApplyProgressSync()'),false);
  assert.deepEqual(Object.keys(run('progressSnapshot()')),['deckStats','campaign']);
  assert.throws(()=>run("validateSyncedProgress({schemaVersion:1,receipts:[],deckStats:{},campaign:{id:'invalid'}})"));
  run(`localStorage.removeItem(MATCH_STORAGE_KEY);
       applySyncedProgress(validateSyncedProgress({schemaVersion:1,receipts:[],deckStats:{test:{wins:1}},campaign:null}));`);
  assert.equal(run('deckStats.test.wins'),1);
  assert.equal(run('localStorage.getItem(MATCH_STORAGE_KEY)'),null);
});

test('the engine queues only committed results and the queued counters rebuild deck history', async()=>{
  const {progressStatsDelta,mergePlaymatProgress} = require('../assets/library-sync.js');
  const fixture = loadFixture(), r = createEngineRunner(fixture);
  const run = code=>vm.runInContext(code,r.context);
  r.context.progressStatsDelta = progressStatsDelta;
  const seed = run('progressSnapshot()');
  r.api.setup(fixture,r.random,r.choose,()=>true);
  await run("runResolutionTransaction(async()=>{finishMatch('you','Rolled back');return false;})");
  assert.equal(run('Object.keys(progressOutbox()).length'),0);
  run("finishMatch('you','Test win')");
  const events = run('Object.values(progressOutbox())');
  assert.equal(events.length,1);
  assert.equal(events[0].summaries.length,2);
  r.context.merged = mergePlaymatProgress({schemaVersion:1,...seed,receipts:[]},events);
  assert.doesNotThrow(()=>run('validateSyncedProgress(merged)'));
  assert.equal(r.context.merged.deckStats[fixture.decks.human.id].bySide.you.wins,1);
  assert.equal(r.context.merged.deckStats[fixture.decks.ai.id].bySide.codex.losses,1);
  assert.equal(r.context.merged.deckStats[fixture.decks.human.id].history.length,1);
});


test('a storage quota preserves the latest matchup and record by reducing move history',()=>{
  const r = createEngineRunner(loadFixture());
  const run = code=>vm.runInContext(code,r.context);
  const fixture = loadFixture();
  r.api.setup(fixture,r.random,r.choose,()=>true);
  run(`const originalSetItem = localStorage.setItem;
    localStorage.setItem = (key,value)=>{
      if (key===DECK_STATS_STORAGE_KEY && value.includes('too-large-move')) {
        const error = new Error('full'); error.name='QuotaExceededError'; throw error;
      }
      originalSetItem(key,value);
    };
    game.matchHistory.timeline=Array.from({length:100},(_,index)=>({turn:1,message:'too-large-move '+index}));`);
  run("finishMatch('you','Test storage quota')");
  assert.equal(run('game.historySaved'),true);
  assert.equal(run("JSON.parse(localStorage.getItem(DECK_STATS_STORAGE_KEY))[game.deckIds.you].wins"),1);
  assert.equal(run("JSON.parse(localStorage.getItem(DECK_STATS_STORAGE_KEY))[game.deckIds.you].history[0].timelineTrimmed"),true);
  assert.equal(run("JSON.parse(localStorage.getItem(DECK_STATS_STORAGE_KEY))[game.deckIds.you].history[0].decks.codex.id"),fixture.decks.ai.id);
  assert.equal(run("buildMatchSummary().timeline.some(step=>step.message.startsWith('too-large-move'))"),true);
});

test('the sync outbox can survive the tab closing when browser string storage is full',async()=>{
  const r = createEngineRunner(loadFixture());
  const run = code=>vm.runInContext(code,r.context);
  r.context.indexedDB = {};
  run(`const memoryDisk = new Map(), originalSetItem = localStorage.setItem;
    localStorage.setItem = (key,value)=>{
      if (key===PROGRESS_OUTBOX_KEY) { const error = new Error('full'); error.name='QuotaExceededError'; throw error; }
      originalSetItem(key,value);
    };
    recordingTransaction = async (mode,work)=>{
      const store = {
        get(key) { const request = {result:structuredClone(memoryDisk.get(key))}; Promise.resolve().then(()=>request.onsuccess?.()); return request; },
        put(value,key) { memoryDisk.set(key,structuredClone(value)); }
      };
      const request=work(store);
      await Promise.resolve();
      return request?.result;
    };
    queueProgressEvent({id:'test-match-quota',stats:{}});`);
  await run('progressFallbackWrite');
  run('progressMemoryQueue.clear()');
  assert.equal((await run('readPendingProgress()'))[0].id,'test-match-quota');
  await run("acknowledgeProgress(['test-match-quota'])");
  assert.equal((await run('readPendingProgress()')).length,0);
});

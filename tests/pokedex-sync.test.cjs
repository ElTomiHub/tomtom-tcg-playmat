const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createPokedexStore,deletePokedexCard,parsePokedexBackup} = require('../assets/pokedex-sync.js');

const empty = () => ({cards:[],binder:[],preferences:[]});
const withCard = (id, note = '') => ({...empty(),cards:[{id,note}]});
const session = {userId:'owner'};

function device(saved) {
  let value = saved ? JSON.stringify(saved) : null;
  return createPokedexStore({getItem:()=>value,setItem:(_,next)=>{value=next;}},'collection');
}

function server() {
  let revision = 0;
  let collection = null;
  return {
    getSession:()=>session,
    readCollection:async()=>({revision,collection}),
    async writeCollection(expected,next) {
      if (revision !== expected) return null;
      collection = structuredClone(next);
      return ++revision;
    }
  };
}

test('backup recovers card photos, variants, tags, featured prints, and binder order offline',()=>{
  const collection = {
    cards:[{id:'a',pokemonId:25,variant:'holo',image:'data:image/jpeg;base64,AA=='}],
    binder:[{id:'b',tags:['Favorites']},{id:'c'}],
    preferences:[{id:'featured:25',cardId:'a'},{id:'binder:special-order',order:['c','b']}]
  };
  const backup = parsePokedexBackup(device(collection).exportBackup());
  const fresh = device();
  assert.deepEqual(fresh.restoreBackup(backup),collection);
  assert.deepEqual(fresh.restoreBackup(backup),collection);
  assert.deepEqual(fresh.read().recovering,{cards:['a'],binder:['b','c'],preferences:['featured:25','binder:special-order']});
  assert.throws(()=>parsePokedexBackup(JSON.stringify(collection)),/Invalid Pokédex backup/);
  assert.throws(()=>parsePokedexBackup(device(withCard('a')).exportBackup().replace('"id":"a"','"id":"a","variant":1')),/Invalid card/);
});

test('recovery from a fresh device preserves newer cloud edits and recovers cloud-only deletions',async()=>{
  const cloud = server();
  const initial = {...withCard('deleted','original'),binder:[{id:'favorite',note:'old'}]};
  const source = device(initial);
  const backup = parsePokedexBackup(source.exportBackup());
  await source.sync(cloud,session);
  source.save(initial,{...deletePokedexCard(initial,'cards','deleted'),binder:[{id:'favorite',note:'new'}]});
  await source.sync(cloud,session);
  const fresh = device();
  fresh.restoreBackup(backup);
  await fresh.sync(cloud,session);
  assert.deepEqual(fresh.read().collection.cards,[{id:'recovered:1:deleted',note:'original'}]);
  assert.deepEqual(fresh.read().collection.binder,[{id:'favorite',note:'new'}]);
  assert.deepEqual(fresh.read().recovering,empty());
});

test('recovery keeps newer cards and restores a deleted card without reviving its old ID on sync',async()=>{
  const cloud = server();
  const initial = {...withCard('a','original'),preferences:[{id:'featured:25',cardId:'a'}]};
  const local = device(initial);
  await local.sync(cloud,session);
  const backup = parsePokedexBackup(local.exportBackup());
  local.save(initial,deletePokedexCard(initial,'cards','a'));
  const before = local.read().collection;
  local.save(before,{...before,cards:[{id:'newer'}]});
  local.restoreBackup(backup);
  local.restoreBackup(backup);
  await local.sync(cloud,session);
  const second = device();
  await second.sync(cloud,session);
  assert.deepEqual(second.read().collection.cards,[{id:'newer'},{id:'recovered:1:a',note:'original'}]);
  assert.deepEqual(second.read().collection.preferences.find(row=>row.id==='featured:25'),{id:'featured:25',cardId:'recovered:1:a'});
});

test('valid backup can recover from unreadable local data and a failed write leaves saved data intact',()=>{
  let raw = '{truncated';
  let fail = true;
  const local = createPokedexStore({getItem:()=>raw,setItem:(_,next)=>{
    if (fail) throw new Error('Storage full');
    raw = next;
  }},'collection');
  const backup = parsePokedexBackup(device(withCard('a')).exportBackup());
  assert.throws(()=>local.restoreBackup(backup),/Storage full/);
  assert.equal(raw,'{truncated');
  fail = false;
  assert.deepEqual(local.restoreBackup(backup),backup);
});

test('first sync uploads the existing import and brings it to an empty device',async()=>{
  const cloud = server();
  const first = device({...withCard('cards:imported','from Lovable'),
    binder:[{id:'binder:first'}],preferences:[{id:'preferences:first'}]});
  const second = device();
  assert.equal(await first.sync(cloud,session),true);
  assert.equal(await second.sync(cloud,session),true);
  assert.deepEqual(second.read().collection,first.read().collection);
  assert.equal((await cloud.readCollection()).revision,1);
});

test('concurrent additions merge without duplicating imported IDs and preserve edits',async()=>{
  const cloud = server();
  const first = device(withCard('cards:imported'));
  const second = device(withCard('cards:imported'));
  await first.sync(cloud,session);
  await second.sync(cloud,session);
  let before = first.read().collection;
  first.save(before,{...before,cards:[{...before.cards[0],note:'Updated offline'},{id:'manual:phone'}]});
  before = second.read().collection;
  second.save(before,{...before,cards:[...before.cards,{id:'manual:pc'}]});
  const results = await Promise.all([first.sync(cloud,session),second.sync(cloud,session)]);
  assert.deepEqual(results,[true,false]);
  assert.equal(await second.sync(cloud,session),true);
  assert.equal(await first.sync(cloud,session),true);
  assert.deepEqual(first.read().collection,second.read().collection);
  assert.deepEqual(first.read().collection.cards,[
    {id:'cards:imported',note:'Updated offline'},{id:'manual:phone'},{id:'manual:pc'}
  ]);
  assert.deepEqual(second.read().pending,empty());
});

test('a save during an upload stays queued and an interrupted request loses no local cards',async()=>{
  const cloud = server();
  const local = device();
  local.save(empty(),withCard('manual:first'));
  await assert.rejects(local.sync({...cloud,readCollection:async()=>{throw new Error('Offline');}},session),/Offline/);
  const writeCollection = async (revision,data) => {
    const before = local.read().collection;
    local.save(before,{...before,cards:[...before.cards,{id:'manual:new'}]});
    return cloud.writeCollection(revision,data);
  };
  assert.equal(await local.sync({...cloud,writeCollection},session),false);
  assert.deepEqual(local.read().pending.cards,['manual:first','manual:new']);
  assert.equal(await local.sync(cloud,session),true);
  assert.deepEqual((await cloud.readCollection()).collection.cards.map(row=>row.id),['manual:first','manual:new']);
});

test('deleting a copy syncs the deletion across stale edits and repeated imports',async()=>{
  const cloud = server();
  const first = device({...withCard('cards:one'),binder:[{id:'binder:one'}]});
  const second = device();
  await first.sync(cloud,session);
  await second.sync(cloud,session);

  const old = second.read().collection;
  const before = first.read().collection;
  first.save(before,deletePokedexCard(before,'cards','cards:one'));
  await first.sync(cloud,session);
  second.save(old,{...old,cards:[{id:'cards:one',note:'offline edit'},{id:'cards:two'}]});
  await second.sync(cloud,session);
  await first.sync(cloud,session);
  assert.deepEqual(first.read().collection.cards,[{id:'cards:two'}]);
  assert.deepEqual(first.read().collection.binder,[{id:'binder:one'}]);

  const after = second.read().collection;
  second.save(after,{...after,cards:[...after.cards,{id:'cards:one'}]});
  assert.deepEqual(second.read().collection.cards,[{id:'cards:two'}]);
  const withBinder = second.read().collection;
  second.save(withBinder,deletePokedexCard(withBinder,'binder','binder:one'));
  await second.sync(cloud,session);
  await first.sync(cloud,session);
  assert.deepEqual(first.read().collection.binder,[]);
});

test('a stale tab cannot discard an independent addition made by another tab',()=>{
  const local = device(withCard('cards:imported'));
  const first = local.read().collection;
  const second = local.read().collection;
  local.save(first,{...first,cards:[...first.cards,{id:'manual:first-tab'}]});
  local.save(second,{...second,cards:[...second.cards,{id:'manual:second-tab'}]});
  assert.deepEqual(local.read().collection.cards.map(row=>row.id),['cards:imported','manual:first-tab','manual:second-tab']);
});

const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createPokedexStore} = require('../assets/pokedex-sync.js');

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

test('a stale tab cannot discard an independent addition made by another tab',()=>{
  const local = device(withCard('cards:imported'));
  const first = local.read().collection;
  const second = local.read().collection;
  local.save(first,{...first,cards:[...first.cards,{id:'manual:first-tab'}]});
  local.save(second,{...second,cards:[...second.cards,{id:'manual:second-tab'}]});
  assert.deepEqual(local.read().collection.cards.map(row=>row.id),['cards:imported','manual:first-tab','manual:second-tab']);
});

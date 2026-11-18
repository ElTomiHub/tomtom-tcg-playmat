'use strict';

const serializePokedex = typeof module === 'object' && module.exports
  ? require('./library-sync.js').canonicalLibraryJson : canonicalLibraryJson;

const pokedexCollectionTypes = ['cards','binder','preferences'];
const emptyPokedexCollection = () => ({cards:[],binder:[],preferences:[]});

function validPokedexCollection(collection) {
  return pokedexCollectionTypes.every(type => {
    const rows = collection?.[type];
    return Array.isArray(rows) &&
      rows.every(row => typeof row?.id === 'string' && row.id.length > 0) &&
      new Set(rows.map(row => row.id)).size === rows.length;
  });
}

const deletionId = (type,id) => 'deleted:' + type + ':' + id;

function deletePokedexCard(collection,type,id) {
  if (!['cards','binder'].includes(type) || !collection[type].some(row=>row.id===id)) return collection;
  const tombstone = deletionId(type,id);
  const preferences = collection.preferences.some(row=>row.id===tombstone) ?
    collection.preferences : [...collection.preferences,{id:tombstone}];
  return {...collection,[type]:collection[type].filter(row=>row.id!==id),preferences};
}

function mergePokedexCollections(cloud, local, pending) {
  const merged = Object.fromEntries(pokedexCollectionTypes.map(type => {
    const rows = new Map(cloud[type].map(row => [row.id,row]));
    const changed = new Set(pending[type]);
    for (const row of local[type]) {
      if (!rows.has(row.id) || changed.has(row.id)) rows.set(row.id,row);
    }
    return [type,[...rows.values()]];
  }));
  const preferences = new Set(merged.preferences.map(row=>row.id));
  for (const type of ['cards','binder']) merged[type] = merged[type].filter(row=>!preferences.has(deletionId(type,row.id)));
  return merged;
}

function createPokedexStore(storage, key) {
  function read() {
    const raw = storage.getItem(key);
    const saved = raw === null ? emptyPokedexCollection() : JSON.parse(raw);
    if (!validPokedexCollection(saved)) throw new Error('Invalid saved collection');
    const collection = Object.fromEntries(pokedexCollectionTypes.map(type => [type,saved[type]]));
    const pending = Object.fromEntries(pokedexCollectionTypes.map(type => [
      type, Array.isArray(saved.pending?.[type]) ? saved.pending[type].filter(id => typeof id === 'string') : []
    ]));
    return {raw,collection,pending};
  }

  function persist(collection, pending) {
    storage.setItem(key,JSON.stringify({...collection,pending}));
  }

  function save(before, next) {
    const current = read();
    const changes = Object.fromEntries(pokedexCollectionTypes.map(type => {
      const previous = new Map(before[type].map(row => [row.id,row]));
      return [type,next[type].filter(row => row !== previous.get(row.id)).map(row => row.id)];
    }));
    const merged = mergePokedexCollections(current.collection,next,changes);
    for (const type of pokedexCollectionTypes) {
      current.pending[type] = [...new Set([...current.pending[type],...changes[type]])];
    }
    persist(merged,current.pending);
    return merged;
  }

  async function sync(client, session) {
    const sameUser = () => client.getSession()?.userId === session.userId;
    const remote = await client.readCollection();
    if (!sameUser()) return false;
    if (!Number.isSafeInteger(remote?.revision) || remote.revision < 0 ||
        (remote.revision === 0 ? remote.collection !== null :
          remote.collection?.schemaVersion !== 1 || !validPokedexCollection(remote.collection))) {
      throw new Error('Invalid online collection');
    }
    const current = read();
    const cloud = remote.collection || emptyPokedexCollection();
    const merged = mergePokedexCollections(cloud,current.collection,current.pending);
    if (pokedexCollectionTypes.some(type => serializePokedex(cloud[type]) !== serializePokedex(merged[type]))) {
      const revision = await client.writeCollection(remote.revision,{schemaVersion:1,...merged});
      if (revision === null) return false;
      if (revision !== remote.revision+1) throw new Error('Unconfirmed collection save');
    }
    // Edits made during the upload stay queued for the next pass.
    if (!sameUser() || storage.getItem(key) !== current.raw) return false;
    if (pokedexCollectionTypes.some(type => current.pending[type].length || serializePokedex(current.collection[type]) !== serializePokedex(merged[type]))) {
      persist(merged,emptyPokedexCollection());
    }
    return true;
  }

  return {read,save,sync};
}

function mountPokedexSync({store, storageKey, refresh}) {
  const el = id => document.getElementById(id);
  const menu = el('collectionSync');
  const form = el('collectionSyncForm'), controls = el('collectionSyncControls');
  const status = el('collectionSyncStatus'), badge = el('collectionSyncBadge');
  const client = createLibrarySyncClient({...playmatSyncConfig,storage:localStorage,
    fetcher:(url,options)=>fetch(url,{...options,signal:AbortSignal.timeout(12000)})});
  let timer, running = false, signingIn = false;

  function show(label, detail) {
    badge.textContent = label;
    status.textContent = detail;
  }

  function refreshControls() {
    const signedIn = Boolean(client.getSession());
    form.hidden = signedIn;
    controls.hidden = !signedIn;
    el('collectionSyncNow').disabled = running;
    el('collectionSignIn').disabled = signingIn;
    if (!signedIn) show('Sign in','Use your Playmat email and password to sync this collection.');
  }

  function schedule(delay) {
    clearTimeout(timer);
    if (client.getSession()) timer = setTimeout(sync,delay);
  }

  async function sync() {
    const session = client.getSession();
    if (!session || running) return;
    running = true;
    refreshControls();
    show('Syncing','Checking for collection changes online…');
    let delay = 30000;
    try {
      const saved = await store.sync(client,session);
      if (client.getSession()?.userId !== session.userId) return;
      if (saved) {
        refresh();
        show('Synced','Your Pokédex and Binder are up to date.');
      } else {
        show('Syncing','Checking for newer changes…');
        delay = 750;
      }
    } catch (error) {
      if (client.getSession()?.userId !== session.userId) return;
      if (error.status === 404) show('Setup needed','Collection sync is waiting for its database update. Changes are saved on this device.');
      else show('Saved locally','Online sync is unavailable. Changes are saved here and will retry automatically.');
    } finally {
      running = false;
      refreshControls();
      schedule(delay);
    }
  }

  form.addEventListener('submit',async event => {
    event.preventDefault();
    if (signingIn) return;
    signingIn = true;
    refreshControls();
    show('Signing in','Connecting to your Playmat account…');
    const password = el('collectionSyncPassword');
    try {
      await client.signIn(el('collectionSyncEmail').value.trim(),password.value);
      schedule(0);
    } catch {
      show('Sign in','Sign-in failed. Check your Playmat email and password and try again.');
    } finally {
      password.value = '';
      signingIn = false;
      el('collectionSignIn').disabled = false;
      if (client.getSession()) refreshControls();
    }
  });
  el('collectionSyncNow').addEventListener('click',sync);
  el('collectionSyncSignOut').addEventListener('click',async () => {
    try { await client.signOut(); }
    catch { /* The client clears the local session even when offline. */ }
    finally { schedule(0); refreshControls(); }
  });
  document.addEventListener('click',event => {
    if (menu.open && !menu.contains(event.target)) menu.open = false;
  });
  menu.addEventListener('keydown',event => {
    if (!menu.open || event.key !== 'Escape') return;
    menu.open = false;
    menu.querySelector('summary').focus();
    event.preventDefault();
  });
  window.addEventListener('storage',event => {
    if (event.key === storageKey) refresh();
    if (event.key === client.sessionKey) { refreshControls(); schedule(0); }
  });
  window.addEventListener('focus',sync);
  window.addEventListener('online',sync);
  document.addEventListener('visibilitychange',() => { if (!document.hidden) void sync(); });
  refreshControls();
  schedule(0);

  return {changed:()=>schedule(500)};
}

if (typeof module === 'object' && module.exports) {
  module.exports = {createPokedexStore,mergePokedexCollections,validPokedexCollection,deletePokedexCard};
}

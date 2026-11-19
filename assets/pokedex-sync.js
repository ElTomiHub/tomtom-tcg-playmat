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

function parsePokedexBackup(text) {
  const backup = JSON.parse(text);
  if (backup?.format !== 'tomtom-pokedex-backup' || backup.version !== 1 ||
      !validPokedexCollection(backup.collection)) throw new Error('Invalid Pokédex backup');
  for (const card of [...backup.collection.cards,...backup.collection.binder]) {
    if (['name','set','number','variant','image','pokemonKey','createdAt'].some(key =>
      card[key] != null && typeof card[key] !== 'string')) throw new Error('Invalid card in Pokédex backup');
  }
  for (const preference of backup.collection.preferences) {
    if ((preference.id.startsWith('featured:') && typeof preference.cardId !== 'string') ||
        (preference.id === 'binder:special-order' && (!Array.isArray(preference.order) ||
          preference.order.some(id => typeof id !== 'string')))) throw new Error('Invalid preference in Pokédex backup');
  }
  return backup.collection;
}

function mergePokedexBackup(current, backup) {
  const deleted = new Set(current.preferences.map(row => row.id));
  const restoredIds = {};
  const next = {...current};
  for (const type of ['cards','binder']) {
    const rows = new Map(current[type].map(row => [row.id,row]));
    const recovered = new Map();
    for (const card of backup[type]) {
      let id = card.id;
      if (deleted.has(deletionId(type,id))) {
        // A fresh ID lets the restored copy sync without clearing the old deletion.
        let copy = 1;
        do { id = 'recovered:' + copy++ + ':' + card.id; }
        while (deleted.has(deletionId(type,id)));
      }
      recovered.set(card.id,id);
      if (!rows.has(id)) rows.set(id,id === card.id ? card : {...card,id});
    }
    restoredIds[type] = recovered;
    next[type] = [...rows.values()];
  }
  const preferences = new Map(backup.preferences.filter(row => !row.id.startsWith('deleted:')).map(row => [row.id,row]));
  for (const row of current.preferences) preferences.set(row.id,row);
  for (const [id,row] of preferences) {
    const featuredId = restoredIds.cards.get(row.cardId);
    if (id.startsWith('featured:') && featuredId && featuredId !== row.cardId) {
      preferences.set(id,{...row,cardId:featuredId});
    } else if (id === 'binder:special-order' && Array.isArray(row.order)) {
      const order = row.order.map(cardId => restoredIds.binder.get(cardId) ?? cardId);
      if (order.some((cardId,index) => cardId !== row.order[index])) preferences.set(id,{...row,order});
    }
  }
  return {...next,preferences:[...preferences.values()]};
}

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
    const readIds = field => Object.fromEntries(pokedexCollectionTypes.map(type => [
      type, Array.isArray(saved[field]?.[type]) ? saved[field][type].filter(id => typeof id === 'string') : []
    ]));
    return {raw,collection,pending:readIds('pending'),recovering:readIds('recovering')};
  }

  function persist(collection, pending, recovering = emptyPokedexCollection()) {
    storage.setItem(key,JSON.stringify({...collection,pending,recovering}));
  }

  function exportBackup() {
    return JSON.stringify({format:'tomtom-pokedex-backup',version:1,
      exportedAt:new Date().toISOString(),collection:read().collection});
  }

  function restoreBackup(backup) {
    let current;
    try { current = read(); }
    catch (error) {
      if (!(error instanceof SyntaxError) && error.message !== 'Invalid saved collection') throw error;
    }
    const before = current?.collection ?? emptyPokedexCollection();
    const next = mergePokedexBackup(before,backup);
    const pending = current?.pending ?? emptyPokedexCollection();
    const recovering = current?.recovering ?? emptyPokedexCollection();
    for (const type of pokedexCollectionTypes) {
      const previous = new Map(before[type].map(row => [row.id,row]));
      for (const row of next[type]) {
        if (row === previous.get(row.id) || pending[type].includes(row.id) || recovering[type].includes(row.id)) continue;
        if (previous.has(row.id)) pending[type].push(row.id);
        else recovering[type].push(row.id);
      }
    }
    persist(next,pending,recovering);
    return next;
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
      current.recovering[type] = current.recovering[type].filter(id => !changes[type].includes(id));
    }
    persist(merged,current.pending,current.recovering);
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
    // Recovered rows fill gaps in the cloud too, including on a device that was offline at restore time.
    const regular = emptyPokedexCollection();
    const recovered = emptyPokedexCollection();
    for (const type of pokedexCollectionTypes) {
      const ids = new Set(current.recovering[type]);
      for (const row of current.collection[type]) (ids.has(row.id) ? recovered : regular)[type].push(row);
    }
    const merged = mergePokedexBackup(mergePokedexCollections(cloud,regular,current.pending),recovered);
    if (pokedexCollectionTypes.some(type => serializePokedex(cloud[type]) !== serializePokedex(merged[type]))) {
      const revision = await client.writeCollection(remote.revision,{schemaVersion:1,...merged});
      if (revision === null) return false;
      if (revision !== remote.revision+1) throw new Error('Unconfirmed collection save');
    }
    // Edits made during the upload stay queued for the next pass.
    if (!sameUser() || storage.getItem(key) !== current.raw) return false;
    if (pokedexCollectionTypes.some(type => current.pending[type].length || current.recovering[type].length ||
        serializePokedex(current.collection[type]) !== serializePokedex(merged[type]))) {
      persist(merged,emptyPokedexCollection());
    }
    return true;
  }

  return {read,save,sync,exportBackup,restoreBackup};
}

function createPokedexBrowserStore({database, legacy, key, notify = () => {}}) {
  let opened;
  function open() {
    opened ??= new Promise((resolve,reject) => {
      const request = database.open('tomtom-pokedex',1);
      request.onupgradeneeded = () => request.result.createObjectStore('collections');
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); opened = null; };
        resolve(db);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Close older collection tabs and try again.'));
    }).catch(error => { opened = null; throw error; });
    return opened;
  }

  async function transact(operation) {
    const db = await open();
    return new Promise((resolve,reject) => {
      const transaction = db.transaction('collections','readwrite');
      const collections = transaction.objectStore('collections');
      const request = collections.get(key);
      let result, migrated, changed, failure;
      request.onsuccess = () => {
        try {
          const legacyValue = request.result === undefined ? legacy.getItem(key) : null;
          const before = request.result ?? legacyValue;
          const snapshot = pokedexSnapshot(before,key);
          result = operation(snapshot);
          const after = snapshot.raw();
          changed = after !== before;
          if (legacyValue !== null) {
            snapshot.store.read();
            migrated = legacyValue;
          }
          if (changed || migrated !== undefined) collections.put(after,key);
        } catch (error) {
          failure = error;
          transaction.abort();
        }
      };
      transaction.onabort = () => reject(failure ?? transaction.error);
      transaction.oncomplete = () => {
        // Keep the old copy until the database commits successfully.
        try {
          if (migrated !== undefined && legacy.getItem(key) === migrated) legacy.removeItem(key);
        } catch { /* The migrated copy is already committed. */ }
        resolve(result);
        if (changed) notify();
      };
    });
  }

  return {
    read:() => transact(({store}) => store.read()),
    save:(before,next) => transact(({store}) => store.save(before,next)),
    exportBackup:() => transact(({store}) => store.exportBackup()),
    restoreBackup:backup => transact(({store}) => store.restoreBackup(backup)),
    async sync(client,session) {
      const before = await transact(snapshot => snapshot.raw());
      const snapshot = pokedexSnapshot(before,key);
      const synced = await snapshot.store.sync(client,session);
      if (!synced) return false;
      return transact(current => {
        if (client.getSession()?.userId !== session.userId || current.raw() !== before) return false;
        current.replace(snapshot.raw());
        return true;
      });
    }
  };
}

function pokedexSnapshot(value,key) {
  let raw = value;
  const replace = next => { raw = next; };
  return {raw:() => raw,replace,store:createPokedexStore({getItem:() => raw,setItem:(_,next) => replace(next)},key)};
}

function mountPokedexSync({store, refresh}) {
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
  module.exports = {createPokedexStore,mergePokedexCollections,validPokedexCollection,deletePokedexCard,parsePokedexBackup,createPokedexBrowserStore};
}

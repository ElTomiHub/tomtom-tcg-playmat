(() => {
  'use strict';
  const storageKey = 'tomtom.pokedex.collection.v1';
  const menu = document.getElementById('mainMenu');
  const status = document.getElementById('menuCollectionStatus');
  const progress = document.getElementById('menuCollectionProgress');
  const store = createPokedexBrowserStore({database:globalThis.indexedDB,legacy:localStorage,key:storageKey});
  const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel(storageKey) : null;
  const client = createLibrarySyncClient({...playmatSyncConfig,storage:localStorage,
    fetcher:(url,options)=>fetch(url,{...options,signal:AbortSignal.timeout(12000)})});
  let running = false;

  function display(collection) {
    const species = new Set(collection.cards.map(card=>typeof card.pokemonId === 'string' &&
      /^\d+$/.test(card.pokemonId.trim()) ? Number(card.pokemonId) : card.pokemonId)
      .filter(id=>Number.isInteger(id) && id>=1 && id<=1025));
    const count = species.size;
    const percent = (count/1025*100).toFixed(1);
    status.textContent = count.toLocaleString() + ' / 1,025 species collected · ' + percent + '%';
    progress.value = count;
    progress.hidden = false;
  }

  async function refresh(syncOnline = true) {
    if (running || document.hidden || menu.classList.contains('app-hidden')) return;
    running = true;
    try {
      display((await store.read()).collection);
      const session = client.getSession();
      if (syncOnline && session) {
        try {
          if (await store.sync(client,session)) display((await store.read()).collection);
        } catch { /* Keep the saved collection progress visible while offline. */ }
      }
    } catch {
      status.textContent = 'Open Pokédex to check your saved collection.';
      progress.hidden = true;
    } finally { running = false; }
  }

  channel?.addEventListener('message',()=>void refresh(false));
  window.addEventListener('focus',()=>void refresh());
  window.addEventListener('online',()=>void refresh());
  document.addEventListener('visibilitychange',()=>void refresh());
  window.addEventListener('storage',event=>{if(event.key===client.sessionKey) void refresh();});
  new MutationObserver(()=>void refresh()).observe(menu,{attributes:true,attributeFilter:['class']});
  setInterval(()=>void refresh(),30000);
  void refresh();
})();

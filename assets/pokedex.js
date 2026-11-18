(() => {
  'use strict';
  const variants = ['normal','holo','reverse-holo','pokeball-reverse-holo','masterball-reverse-holo','energy-reverse-holo','illustration-rare','special'];
  const storageKey = 'tomtom.pokedex.collection.v1';
  const totalSpecies = 1025;
  const pageSize = 48;
  const generationEnds = [151,251,386,493,649,721,809,905,1025];
  // Form keys and sprite IDs follow the Lovable collection format.
  const forms = [
    [19, 'Alolan', 10091],
    [20, 'Alolan', 10092],
    [26, 'Alolan', 10100],
    [27, 'Alolan', 10101],
    [28, 'Alolan', 10102],
    [37, 'Alolan', 10103],
    [38, 'Alolan', 10104],
    [50, 'Alolan', 10105],
    [51, 'Alolan', 10106],
    [52, 'Alolan', 10107],
    [53, 'Alolan', 10108],
    [74, 'Alolan', 10109],
    [75, 'Alolan', 10110],
    [76, 'Alolan', 10111],
    [88, 'Alolan', 10112],
    [89, 'Alolan', 10113],
    [103, 'Alolan', 10114],
    [105, 'Alolan', 10115],
    [52, 'Galarian', 10161],
    [77, 'Galarian', 10162],
    [78, 'Galarian', 10163],
    [79, 'Galarian', 10164],
    [80, 'Galarian', 10165],
    [83, 'Galarian', 10166],
    [110, 'Galarian', 10167],
    [122, 'Galarian', 10168],
    [144, 'Galarian', 10169],
    [145, 'Galarian', 10170],
    [146, 'Galarian', 10171],
    [199, 'Galarian', 10172],
    [222, 'Galarian', 10173],
    [263, 'Galarian', 10174],
    [264, 'Galarian', 10175],
    [554, 'Galarian', 10176],
    [555, 'Galarian', 10177],
    [562, 'Galarian', 10178],
    [618, 'Galarian', 10179],
    [58, 'Hisuian', 10229],
    [59, 'Hisuian', 10230],
    [100, 'Hisuian', 10231],
    [101, 'Hisuian', 10232],
    [157, 'Hisuian', 10233],
    [211, 'Hisuian', 10234],
    [215, 'Hisuian', 10235],
    [503, 'Hisuian', 10236],
    [549, 'Hisuian', 10237],
    [570, 'Hisuian', 10238],
    [571, 'Hisuian', 10239],
    [628, 'Hisuian', 10240],
    [705, 'Hisuian', 10241],
    [706, 'Hisuian', 10242],
    [713, 'Hisuian', 10243],
    [724, 'Hisuian', 10244],
    [128, 'Paldean Combat', 10250],
    [128, 'Paldean Blaze', 10251],
    [128, 'Paldean Aqua', 10252],
    [194, 'Paldean', 10253],
    [351, 'Sunny', 10013],
    [351, 'Rainy', 10014],
    [351, 'Snowy', 10015],
    [479, 'Heat', 10008],
    [479, 'Wash', 10009],
    [479, 'Frost', 10010],
    [479, 'Fan', 10011],
    [479, 'Mow', 10012],
    [1017, 'Wellspring Mask', 10273],
    [1017, 'Hearthflame Mask', 10274],
    [1017, 'Cornerstone Mask', 10275],
  ];
  const regions = [
    ['Kanto',1,151], ['Johto',152,251], ['Hoenn',252,386], ['Sinnoh',387,493],
    ['Unova',494,649], ['Kalos',650,721], ['Alola',722,809], ['Galar',810,898],
    ['Hisui',899,905], ['Paldea',906,totalSpecies]
  ];
  const regionIcons = {Kanto:'◉', Johto:'❧', Hoenn:'≈', Sinnoh:'▲', Unova:'◆', Kalos:'✧', Alola:'☀', Galar:'♜', Hisui:'❄', Paldea:'✦'};
  function inRegion(id, region) {
    if (!region) return true;
    const range = regions.find(([name]) => name === region);
    return !!range && id >= range[1] && id <= range[2];
  }
  const formRegions = {Alolan:'Alola', Galarian:'Galar', Hisuian:'Hisui', Paldean:'Paldea'};
  const national = Array.from({length:totalSpecies}, (_,i)=>({id:i+1,key:String(i+1),sprite:i+1}));
  const formEntries = forms.map(([id,label,sprite])=>({
    id,label,sprite,key:id+'-'+label.toLowerCase().replaceAll(' ','-'),region:formRegions[label.split(' ')[0]]
  }));
  const catalog = [...national,...formEntries].sort((a,b)=>a.id-b.id);
  const entriesByKey = new Map(catalog.map(entry=>[entry.key,entry]));
  const catalogEntry = card => entriesByKey.get(card.pokemonKey) ||
    {id:card.pokemonId,key:card.pokemonKey || String(card.pokemonId),sprite:card.pokemonId};
  const binderNumber = id => id<=386 ? 1 : id<=721 ? 2 : 3;
  function featuredCard(copies, preferredId) {
    return copies.find(card => card.id === preferredId) ||
      copies.find(card => /^(true|t)$/i.test(card.featured)) ||
      copies.find(card => card.image) || copies[0];
  }

  function chooseFeaturedCard(preferences, entryKey, cardId) {
    const id = 'featured:' + entryKey;
    const current = preferences.find(preference => preference.id === id);
    if (current?.cardId === cardId) return preferences;
    const record = {id,cardId};
    return current ? preferences.map(preference => preference === current ? record : preference) : [...preferences,record];
  }

  function entryInRegion(entry, region) {
    return entry.region && region ? entry.region===region : inRegion(entry.id,region);
  }
  function deckPokemonName(value) {
    return value.normalize('NFKD').toLowerCase().replace(/[\u0300-\u036f]/g,'')
      .replace(/^[^']*['’]s\s+/,'').replace(/^(mega|radiant|shining)\s+/,'')
      .replace(/\s+(ex|gx|vmax|vstar|v|lv\.x|break|prime)(\s+[xy])?$/,'')
      .replace(/[^a-z0-9]+/g,' ').trim();
  }
  function tomaPokemonNames(bundled, saved, deleted, prints) {
    const decks = new Map(bundled.map(deck=>[deck.id,deck]));
    for (const deck of saved) if (deck?.id && typeof deck.decklist==='string') decks.set(deck.id,deck);
    const registeredPokemon = new Set(prints.filter(card=>card.category==='Pokemon' || card.meta?.category==='Pokemon')
      .map(card=>deckPokemonName(card.name)));
    const included = new Set();
    for (const deck of decks.values()) {
      if (deck.category!=='Toma' || deleted.has(deck.id) || typeof deck.decklist!=='string') continue;
      let section = '';
      for (const line of deck.decklist.split(/\r?\n/)) {
        const header = line.trim().match(/^(pok[eé]mon|trainers?|energy)\s*:/i);
        if (header) { section = header[1].toLowerCase(); continue; }
        if (section && !/^pok/.test(section)) continue;
        const raw = line.trim().match(/^\d+\s*[x×]?\s+(.+)$/i)?.[1] || line.trim().match(/^(.+?)\s*[x×]\s*\d+$/i)?.[1];
        if (!raw) continue;
        const name = deckPokemonName(raw.replace(/\s+(?:[A-Z0-9]{2,5}|PR-SV)\s+[A-Z]*\d+[A-Z0-9-]*(?:\/\d+)?$/i,''));
        if (name && (section || registeredPokemon.has(name))) included.add(name);
      }
    }
    return included;
  }
  function normalizeSearch(value) {
    return String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
      .replace(/[\u3041-\u3096]/g,letter=>String.fromCharCode(letter.charCodeAt(0)+0x60))
      .normalize('NFC').toLowerCase().trim();
  }
  function normalizeVariant(value) {
    return /^normal[\s_-]+silver$/i.test(value) ? 'normal' : value;
  }
  function normalizeSavedVariants(data) {
    let next = data;
    for (const type of ['cards','binder']) {
      if (!data[type].some(card => card.variant !== normalizeVariant(card.variant))) continue;
      if (next === data) next = {...data};
      next[type] = data[type].map(card => ({...card, variant:normalizeVariant(card.variant)}));
    }
    return next;
  }

  function safeImage(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
    } catch { return ''; }
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {inRegion,normalizeSavedVariants,binderNumber,catalogEntry,entryInRegion,tomaPokemonNames,normalizeSearch,featuredCard,chooseFeaturedCard};
    return;
  }

  const el = id => document.getElementById(id);
  const empty = () => ({cards: [], binder: [], preferences: []});
  const node = (tag, content, className) => {
    const element = document.createElement(tag);
    if (content != null) element.textContent = content;
    if (className) element.className = className;
    return element;
  };
  const button = (label, handler) => {
    const element = node('button',label);
    element.type = 'button';
    element.addEventListener('click',handler);
    return element;
  };
  const names = globalThis.POKEDEX_SPECIES_NAMES || [];
  const collectionButtons = [...document.querySelectorAll('[data-collection]')];
  let collection = 'all';
  let data = empty(), view = 'cards', speciesFilter = null, speciesReturn, limit = pageSize, editing, damagedStorage = false;
  const collectionStore = createPokedexStore(localStorage,storageKey);
  let collectionRaw, collectionSync, binderView = '1';

  function refreshCollection() {
    try {
      if (localStorage.getItem(storageKey) === collectionRaw) return false;
      const current = collectionStore.read();
      collectionRaw = current.raw;
      data = normalizeSavedVariants(current.collection);
      if (damagedStorage) el('notice').textContent = '';
      damagedStorage = false;
      return true;
    } catch {
      damagedStorage = true;
      el('notice').textContent = 'Saved collection could not be read. This page is in read-only mode.';
      return false;
    }
  }
  refreshCollection();

  function save(next) {
    if (damagedStorage) throw new Error('Saved collection could not be read. Changes are disabled.');
    data = normalizeSavedVariants(collectionStore.save(data,next));
    collectionRaw = localStorage.getItem(storageKey);
    collectionSync?.changed();
  }

  function speciesName(id) { return names[id-1]?.[0] || 'Pokémon #' + id; }
  function entryName(entry) { return [entry.label,speciesName(entry.id)].filter(Boolean).join(' '); }
  function title(card) { return card.name || entryName(catalogEntry(card)); }
  function validSpecies(id) { return id >= 1 && id <= totalSpecies; }
  const variantIcons = {
    normal:'●', holo:'✦', 'reverse-holo':'◈', 'pokeball-reverse-holo':'◉', 'masterball-reverse-holo':'✪',
    'energy-reverse-holo':'ϟ', 'illustration-rare':'▧', special:'★'
  };
  function displayVariant(value) {
    return (value || 'unknown variant').toLowerCase().replace('pokeball','poké-ball')
      .replace('masterball','master-ball').replaceAll('-',' ').replace(/\S+/g,word=>word[0].toUpperCase()+word.slice(1));
  }
  const variantOptionLabel = value => (variantIcons[value] || '◇') + ' ' + displayVariant(value);
  function variantBadge(value) {
    const badge = node('span',null,'variant-badge');
    badge.dataset.variant = value || '';
    const icon = node('span',variantIcons[value] || '◇');
    icon.setAttribute('aria-hidden','true');
    badge.append(icon,node('span',displayVariant(value)));
    return badge;
  }
  function ownedSpecies() { return new Set(data.cards.map(card => card.pokemonId).filter(validSpecies)); }
  function formatProgress(owned, total) { return owned + ' / ' + total; }

  const pokemonSprites = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/';
  function photo(url, fallback) {
    if (!url) return node('span', fallback, 'fallback');
    const image = node('img');
    image.src = url;
    image.alt = '';
    image.loading = 'lazy';
    image.decoding = 'async';
    image.referrerPolicy = 'no-referrer';
    image.addEventListener('error', () => image.replaceWith(node('span',fallback,'fallback')), {once:true});
    return image;
  }

  function cardTile(card, {style = '', choose, featured = false} = {}) {
    const article = node('article',null,style ? 'card ' + style : 'card');
    if (featured) article.append(node('span','Featured card','featured-label'));
    article.append(photo(card.image,'Photo unavailable'), node('h3',title(card)));
    if (card.set || card.number) article.append(node('small',[card.set,card.number].filter(Boolean).join(' · ')));
    article.append(variantBadge(card.variant));
    if (card.notes && !choose) article.append(node('small',card.notes,'print-notes'));
    const actions = node('div',null,'print-actions');
    if (choose) {
      const feature = button('Set as featured',choose);
      feature.className = 'primary';
      feature.setAttribute('aria-label','Set ' + [title(card),card.set,card.number,displayVariant(card.variant)].filter(Boolean).join(' · ') + ' as featured');
      actions.append(feature);
    }
    actions.append(button('Edit card', () => openEditor(card)));
    if (style === 'featured-print' || style === 'alternate-print') {
      actions.append(button('Add variant',() => openCardCapture({entry:catalogEntry(card),print:card})));
    }
    article.append(actions);
    return article;
  }

  function showSpecies(entry) {
    speciesReturn = {search:el('search').value, variant:el('variantFilter').value, limit, scroll:window.scrollY};
    speciesFilter = entry;
    render();
    el('viewHeading').focus({preventScroll:true});
    window.scrollTo(0,0);
  }

  function renderSpeciesDetails(entry, copies, preferredId) {
    const name = entryName(entry);
    const back = button(view === 'binder' ? '← Back to Binder ' + binderView : '← Back to Pokédex', () => {
      const previous = speciesReturn;
      speciesFilter = null;
      speciesReturn = null;
      limit = previous?.limit || pageSize;
      el('search').value = previous?.search || '';
      el('variantFilter').value = previous?.variant || '';
      render();
      window.scrollTo(0,previous?.scroll || 0);
      [...el('results').querySelectorAll('.species-open')].find(item =>
        item.getAttribute('aria-label') === 'View registered cards for ' + name)?.focus({preventScroll:true});
    });
    back.className = 'species-back';
    el('results').append(back);

    const layout = node('div',null,'species-detail');
    const featured = featuredCard(copies,preferredId);
    const info = node('section',null,'card species-info');
    const overview = node('div',null,'species-overview');
    overview.append(photo(pokemonSprites+entry.sprite+'.png',''));
    const namesRow = node('div',null,'species-localized');
    namesRow.append(node('small',dexLabel(entry.id)));
    for (const [index,lang] of ['en','fr','ja'].entries()) {
      const value = index===0 ? name : names[entry.id-1]?.[index];
      if (!value) continue;
      const label = node(index===0?'strong':'span',value);
      label.lang = lang;
      namesRow.append(label);
    }
    const organization = node('div',null,'species-localized');
    organization.append(node('span',generationLabel(entry.id)),node('span','Binder '+binderNumber(entry.id)),
      node('span',copies.length+' '+(copies.length===1?'card':'cards')+' collected'));
    overview.append(namesRow,organization);
    info.append(overview);
    const totals = new Map();
    for (const card of copies) totals.set(card.variant,(totals.get(card.variant) || 0) + 1);
    const counts = node('ul',null,'variant-counts');
    for (const [variant,count] of totals) {
      const row = node('li');
      row.append(variantBadge(variant),node('small','×'+count));
      counts.append(row);
    }
    info.append(counts);
    if (data.preferences.some(preference => preference.normalOnly && preference.pokemonKey === entry.key))
      info.append(node('small','Normal only'));

    const shelf = node('section',null,'species-prints');
    shelf.append(node('h3','Other prints'));
    const grid = node('div',null,'species-print-grid');
    for (const card of copies) {
      if (card === featured) continue;
      grid.append(cardTile(card,{style:'alternate-print',choose:() => {
        try {
          save({...data,preferences:chooseFeaturedCard(data.preferences,entry.key,card.id)});
          render();
          el('results').querySelector('.featured-print button')?.focus({preventScroll:true});
          el('notice').textContent = 'Featured card updated.';
        } catch (error) { el('notice').textContent = 'Could not update the featured card. ' + error.message; }
      }}));
    }
    const add = button('＋ Add card',() => openCardCapture({entry}));
    add.className = 'add-species-print';
    grid.append(add);
    shelf.append(grid);
    if (featured) layout.append(cardTile(featured,{style:'featured-print',featured:true}));
    layout.append(shelf);
    el('results').append(info,layout);
  }

  function speciesTile(entry, copies = [], deckNames = new Set(), variantCount = 0, preferredId) {
    const {id,sprite} = entry;
    const owned = copies.length > 0;
    const name = entryName(entry);
    const article = node('article',null,'card species-card');
    article.dataset.owned = String(owned);
    const sprites = pokemonSprites;
    const artwork = sprites + 'other/official-artwork/' + sprite + '.png';
    const cover = featuredCard(copies,preferredId);
    const image = owned ? cover?.image || artwork : sprites + sprite + '.png';
    const open = button(null, () => {
      if (!owned) { openCardCapture({entry}); return; }
      showSpecies(entry);
    });
    open.className = 'species-open';
    open.setAttribute('aria-label', (owned ? 'View registered cards for ' : 'Add a card for ') + name);
    const picture = photo(image,'No image');
    if (owned && image !== artwork) picture.addEventListener('error', () => {
      open.querySelector('.fallback')?.replaceWith(photo(artwork,'No image'));
    }, {once:true});
    open.append(picture);
    const mark = (position, symbol, explanation) => {
      const badge = node('span',symbol,'tile-marker '+position);
      badge.title = explanation;
      badge.setAttribute('aria-label',explanation);
      open.append(badge);
    };
    if (cover) mark('variant-marker',variantIcons[cover.variant] || '◇',displayVariant(cover.variant));
    const deckAlias = entry.label?.startsWith('Paldean ') ? 'Paldean '+speciesName(id) : name;
    if (deckNames.has(deckPokemonName(name)) || deckNames.has(deckPokemonName(deckAlias)))
      mark('deck-marker','▤','Used in a Toma deck');
    mark('binder-marker','B'+binderNumber(id),'Binder '+binderNumber(id));
    if (variantCount) mark('count-marker','×'+variantCount,variantCount+' distinct variants');
    const heading = node('h3',null,'species-name');
    heading.title = name;
    if (owned) heading.append(photo(sprites + sprite + '.png',''));
    heading.append(node('span',name));
    article.append(open,heading,node('small','#' + String(id).padStart(4,'0')));
    return article;
  }

  function renderProgress(owned) {
    const grid = node('div',null,'grid');
    let first = 1;
    generationEnds.forEach((last,index) => {
      const count = [...owned].filter(id => id >= first && id <= last).length;
      const max = last-first+1;
      const card = node('article',null,'card');
      const label = 'Generation ' + (index+1);
      const bar = node('progress');
      bar.max = max; bar.value = count; bar.setAttribute('aria-label',label);
      card.append(node('h3',label), node('p',formatProgress(count,max)), bar);
      grid.append(card);
      first = last + 1;
    });
    el('results').append(grid);
  }

  function readLocalList(key) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || '[]');
      return Array.isArray(value) ? value : [];
    } catch { return []; }
  }
  const dexLabel = id => '#' + String(id).padStart(4,'0');
  const generationLabel = id => 'Generation ' + ['I','II','III','IV','V','VI','VII','VIII','IX'][generationEnds.findIndex(end=>id<=end)];
  const additionDate = new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'});

  function renderRecent() {
    const rows = [...data.cards.map(card=>({card,destination:'cards'})),
      ...data.binder.map(card=>({card,destination:'binder'}))]
      .map(row=>({...row,time:Date.parse(row.card.createdAt)}))
      .filter(row=>Number.isFinite(row.time)).sort((a,b)=>b.time-a.time);
    if (!rows.length) { el('results').append(node('p','Dated card additions will appear here.','note')); return; }
    const list = node('div',null,'recent-list');
    for (const {card,destination,time} of rows.slice(0,limit)) {
      const item = button(null,()=>openEditor(card,null,{destination}));
      item.className = 'recent-card';
      const date = node('time',additionDate.format(time));
      date.dateTime = new Date(time).toISOString();
      const entry = destination==='cards' && validSpecies(card.pokemonId) ? catalogEntry(card) : null;
      const print = node('span',null,'recent-print');
      print.append(node('strong',title(card)));
      if (entry) print.append(node('small',dexLabel(entry.id)+' '+entryName(entry)));
      const metadata = node('span',null,'recent-print');
      metadata.append(node('small',[card.set,card.number].filter(Boolean).join(' · ')),variantBadge(card.variant));
      const location = node('small',entry ? generationLabel(entry.id)+' · Binder '+binderNumber(entry.id) : 'Other cards');
      item.append(date,photo(card.image,'No image'),print,metadata,location);
      list.append(item);
    }
    el('results').append(list);
    el('more').hidden = limit >= rows.length;
  }

  function render() {
    const owned = ownedSpecies();
    const completion = (owned.size*100/totalSpecies).toFixed(1);
    const remaining = totalSpecies-owned.size;
    const progress = el('collectionProgressBar');
    progress.max = totalSpecies;
    progress.value = owned.size;
    const progressLabel = owned.size+' / '+totalSpecies+' species · '+completion+'% · '+remaining+' missing';
    el('collectionProgressLabel').textContent = progressLabel;
    progress.setAttribute('aria-valuetext',progressLabel);
    const heading = {cards: 'Pokédex', binder: 'Binder', missing: 'Missing Pokémon', progress: 'Progress', recent:'Recent cards'};
    el('viewHeading').textContent = speciesFilter ? entryName(speciesFilter) : heading[view];
    const showingDetails = Boolean(speciesFilter);
    const numberedBinder = view === 'binder' && binderView !== 'other';
    el('collectionProgress').hidden = showingDetails || (view !== 'cards' && view !== 'missing');
    el('binderViews').hidden = view !== 'binder' || showingDetails;
    el('addCard').hidden = view === 'progress' || showingDetails;
    el('filters').hidden = view === 'progress' || view === 'recent' || showingDetails;
    const showCollection = view === 'cards' && !showingDetails;
    el('collectionFilter').hidden = !showCollection;
    for (const button of collectionButtons) button.setAttribute('aria-pressed',String(button.dataset.collection === collection));
    el('variantField').hidden = view === 'missing';
    el('variantFilter').disabled = showCollection && collection === 'missing';
    el('regionField').hidden = view === 'binder' || !!speciesFilter;
    el('results').replaceChildren();
    el('resultCount').textContent = '';
    el('more').hidden = true;
    if (view === 'progress') { renderProgress(owned); return; }
    if (view === 'recent') { renderRecent(); return; }

    const search = normalizeSearch(el('search').value), variant = el('variantFilter').value;
    const region = el('regionFilter').value;
    const filtered = Boolean(search || (!el('variantField').hidden && variant) || (!el('regionField').hidden && region) ||
      (showCollection && collection !== 'all'));
    el('resetFilters').disabled = !filtered;
    const matches = (...values) => !search || values.some(value => normalizeSearch(value).includes(search));
    const matchesSpecies = entry => matches(entry.id,'#'+String(entry.id).padStart(4,'0'),entryName(entry),...(names[entry.id-1] || []));
    let rows, tile;
    const copiesByEntry = new Map();
    for (const card of data.cards) {
      const entry = catalogEntry(card);
      const group = copiesByEntry.get(entry.key) || {entry,cards:[]};
      group.cards.push(card);
      copiesByEntry.set(entry.key,group);
    }
    const featuredByEntry = new Map(data.preferences.filter(preference => preference.cardId)
      .map(preference => [preference.id,preference.cardId]));
    const selectedCardId = entry => featuredByEntry.get('featured:' + entry.key);
    if (speciesFilter) {
      renderSpeciesDetails(speciesFilter,copiesByEntry.get(speciesFilter.key)?.cards || [],selectedCardId(speciesFilter));
      return;
    }

    const matchesCard = card => (!variant || card.variant === variant) &&
      (matches(title(card),card.set,card.number,card.japaneseName,card.frenchName) || matchesSpecies(catalogEntry(card)));
    if (view === 'missing') {
      rows = catalog.filter(entry => !copiesByEntry.has(entry.key) && entryInRegion(entry,region) && matchesSpecies(entry));
      tile = entry => speciesTile(entry);
    } else if (view === 'binder' && !numberedBinder) {
      rows = data.binder.filter(matchesCard);
      tile = card => cardTile(card);
    } else {
      const groups = new Map();
      for (const [key, {cards}] of copiesByEntry) {
        const matching = cards.filter(matchesCard);
        if (matching.length) groups.set(key,matching);
      }
      const extra = [...copiesByEntry.values()].filter(({entry}) => !entriesByKey.has(entry.key)).map(({entry}) => entry);
      rows = [...catalog,...extra].filter(entry => {
        if (numberedBinder) return binderNumber(entry.id) === Number(binderView) && groups.has(entry.key);
        if (!entryInRegion(entry,region)) return false;
        const collected = copiesByEntry.has(entry.key);
        if (collection === 'collected' && !collected || collection === 'missing' && collected) return false;
        return groups.has(entry.key) || !variant && matchesSpecies(entry);
      });
      const library = globalThis.PLAYMAT_STARTER_LIBRARY;
      const deckNames = tomaPokemonNames(library?.decks || [],readLocalList('codexPokemonPlaymat.decks.v1'),
        new Set(readLocalList('codexPokemonPlaymat.deletedDecks.v1')),
        [...(library?.cards || []),...readLocalList('codexPokemonPlaymat.cards.v1')].filter(card => typeof card?.name === 'string'));
      tile = entry => speciesTile(entry,groups.get(entry.key),deckNames,
        new Set((copiesByEntry.get(entry.key)?.cards || []).map(card => card.variant).filter(Boolean)).size,selectedCardId(entry));
    }
    if (filtered) el('resultCount').textContent = rows.length + (rows.length === 1 ? ' result' : ' results');
    if (!rows.length) {
      el('results').append(node('p', 'No results match these filters.', 'note'));
      return;
    }
    const grid = node('div',null,'grid');
    grid.append(...rows.slice(0,limit).map(tile));
    el('results').append(grid);
    el('more').hidden = limit >= rows.length;
  }

  function updateFormChoices(preferred = '') {
    const form = el('editorForm');
    const id = Number(form.elements.namedItem('pokemonId').value);
    const select = form.elements.namedItem('pokemonForm');
    const options = formEntries.filter(entry=>entry.id===id);
    select.replaceChildren(node('option','Original'));
    select.firstElementChild.value = String(id);
    for (const entry of options) {
      const option = node('option',entry.label);
      option.value = entry.key;
      select.append(option);
    }
    if (preferred && ![...select.options].some(option=>option.value===preferred)) {
      const option = node('option','Imported form');
      option.value = preferred;
      select.append(option);
    }
    select.value = preferred || String(id);
    el('formField').hidden = editing?.type==='binder' || select.options.length<=1;
  }
  const editorForm = el('editorForm');
  const editorFields = editorForm.elements;
  const editorNames = new Map();
  for (const entry of catalog) {
    const name = entryName(entry);
    const option = node('option');
    option.value = name;
    option.label = '#' + String(entry.id).padStart(4,'0');
    el('editorPokemonNames').append(option);
    const aliases = entry.label ? [name] : [...(names[entry.id-1] || []),name];
    for (const alias of aliases) editorNames.set(normalizeSearch(alias),entry);
  }

  function updateEditorSpecies() {
    const id = Number(editorFields.pokemonId.value);
    const sprite = el('editorSprite'), organization = el('editorOrganization');
    const pokemon = editing.type==='cards' && validSpecies(id);
    sprite.hidden = organization.hidden = !pokemon;
    if (!pokemon) return;
    const form = catalogEntry({pokemonId:id,pokemonKey:editorFields.pokemonForm.value});
    sprite.replaceChildren(photo(pokemonSprites+form.sprite+'.png',''));
    organization.replaceChildren(node('span',generationLabel(id)),node('span','Binder '+binderNumber(id)));
  }

  function updateEditorArtwork() {
    const figure = el('editorArtwork');
    const selected = editorFields.variant.value;
    const sameReference = editorFields.set.value.trim() === editing.reference.set &&
      editorFields.number.value.trim() === editing.reference.number;
    const choices = sameReference && editing.artworkForVariant ? editing.artworkForVariant(selected) :
      [{url:editing.originalImage,label:sameReference ? 'Card artwork' : 'Artwork from the previous print'}];
    editing.image = choices.map(pick=>safeImage(pick.url)).find(Boolean) || editing.originalImage;
    const show = index => {
      const pick = choices[index];
      if (!pick) {
        figure.replaceChildren(node('figcaption','Card artwork unavailable'));
        return;
      }
      const url = safeImage(pick.url);
      if (!url) { show(index+1); return; }
      const image = node('img');
      image.alt = 'Card artwork preview';
      image.referrerPolicy = 'no-referrer';
      image.addEventListener('error',()=>{ if (image.isConnected) show(index+1); },{once:true});
      editing.image = url;
      image.src = url;
      figure.replaceChildren(image,node('figcaption',pick.label));
    };
    show(0);
  }

  editorFields.name.addEventListener('input',()=>{
    if (editing.type !== 'cards') return;
    const entry = editorNames.get(normalizeSearch(editorFields.name.value));
    if (!entry) return;
    editorFields.pokemonId.value = entry.id;
    updateFormChoices(entry.key);
    updateEditorSpecies();
  });
  editorFields.pokemonId.addEventListener('input',()=>{
    const id = Number(editorFields.pokemonId.value);
    if (validSpecies(id)) editorFields.name.value = speciesName(id);
    updateFormChoices();
    updateEditorSpecies();
  });
  editorFields.pokemonForm.addEventListener('change',()=>{
    const id = Number(editorFields.pokemonId.value);
    if (validSpecies(id)) editorFields.name.value = entryName(catalogEntry({pokemonId:id,pokemonKey:editorFields.pokemonForm.value}));
    updateEditorSpecies();
  });
  for (const key of ['set','number','variant']) editorFields[key].addEventListener('change',updateEditorArtwork);
  function openEditor(card, entry = speciesFilter, draft = null) {
    const values = card || draft;
    const type = draft?.destination || (view === 'binder' && binderView === 'other' ? 'binder' : 'cards');
    editing = {card,language:draft?.language,type,originalImage:safeImage(values?.image),
      reference:{set:values?.set || '',number:values?.number || ''},artworkForVariant:draft?.artworkForVariant};
    editorForm.reset();
    const inferred = type==='cards' && values?.name ? editorNames.get(normalizeSearch(values.name)) : null;
    const id = values?.pokemonId ?? entry?.id ?? inferred?.id;
    const formKey = values?.pokemonKey || entry?.key || inferred?.key;
    editorFields.name.value = values?.name || (type==='cards' && validSpecies(id) ? entryName(catalogEntry({pokemonId:id,pokemonKey:formKey})) : '');
    editorFields.set.value = editing.reference.set;
    editorFields.number.value = editing.reference.number;
    const selected = normalizeVariant(values?.variant || 'normal');
    editorFields.variant.replaceChildren(...[...new Set([...variants,selected])].map(value=>{
      const option = node('option',variantOptionLabel(value));
      option.value = value;
      return option;
    }));
    editorFields.variant.value = selected;
    editorFields.pokemonId.required = type === 'cards';
    editorFields.pokemonId.value = id ?? '';
    el('speciesField').hidden = type !== 'cards';
    el('editorNameLabel').textContent = type === 'cards' ? 'Pokémon' : 'Card name';
    editorFields.name.required = type === 'binder';
    editorFields.name.placeholder = type === 'cards' ? 'Search Pokémon' : '';
    if (type === 'cards') editorFields.name.setAttribute('list','editorPokemonNames');
    else editorFields.name.removeAttribute('list');
    updateFormChoices(formKey);
    updateEditorSpecies();
    updateEditorArtwork();
    el('editorHeading').textContent = card ? 'Edit card' : 'Add card';
    el('deleteCard').hidden = !card;
    el('deleteCardConfirm').hidden = true;
    el('editorStatus').textContent = '';
    el('editor').showModal();
  }
  el('editorForm').addEventListener('submit', event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const read = key => String(form.get(key) || '').trim();
    const {card, type, language} = editing;
    const image = safeImage(editing.image);
    const pokemonId = type === 'cards' ? Number(read('pokemonId')) : null;
    const entry = {...card, ...(language ? {language} : {}), id:card?.id || 'manual:' + crypto.randomUUID(), pokemonId,
      pokemonKey: type === 'cards' ? read('pokemonForm') || String(pokemonId) : '',
      name:read('name'), set:read('set'), number:read('number'), variant:normalizeVariant(read('variant')) || 'normal',
      image, createdAt:card?.createdAt || new Date().toISOString()};
    const updated = card ? data[type].map(item => item.id === card.id ? entry : item) : [...data[type],entry];
    try {
      save({...data,[type]:updated});
      el('editor').close();
      el('notice').textContent = 'Card saved in this browser.';
      render();
    } catch (error) { el('editorStatus').textContent = 'Could not save the card. ' + error.message; }
  });
  el('deleteCard').addEventListener('click',()=>{
    el('deleteCard').hidden = true;
    el('deleteCardConfirm').hidden = false;
    el('keepCard').focus();
  });
  el('keepCard').addEventListener('click',()=>{
    el('deleteCardConfirm').hidden = true;
    el('deleteCard').hidden = false;
    el('deleteCard').focus();
  });
  el('confirmDeleteCard').addEventListener('click',()=>{
    const {type,card} = editing;
    if (!card) return;
    try {
      const next = deletePokedexCard(data,type,card.id);
      if (next !== data) save(next);
      el('editor').close();
      render();
      el('notice').textContent = '';
    } catch (error) {
      el('editorStatus').textContent = 'Could not delete the card. ' + error.message;
    }
  });
  el('cancelEdit').addEventListener('click', () => el('editor').close());
  el('addCard').addEventListener('click', () => openCardCapture({destination:view === 'binder' && binderView === 'other' ? 'binder' : 'cards'}));
  for (const item of document.querySelectorAll('[data-view]')) item.addEventListener('click', () => {
    view = item.dataset.view; speciesFilter = null; speciesReturn = null; collection = 'all'; limit = pageSize;
    for (const other of document.querySelectorAll('[data-view]')) other.setAttribute('aria-pressed',String(other === item));
    el('search').value = ''; el('variantFilter').value = ''; render();
  });
  const binderButtons = [...el('binderViews').querySelectorAll('button')];
  for (const item of binderButtons) item.addEventListener('click', () => {
    binderView = item.dataset.binderView;
    for (const other of binderButtons) other.setAttribute('aria-pressed',String(other === item));
    limit = pageSize;
    render();
  });
  for (const id of ['search','variantFilter','regionFilter']) el(id).addEventListener('input', () => {limit = pageSize; render();});
  for (const item of collectionButtons) item.addEventListener('click', () => {
    collection = item.dataset.collection;
    if (collection === 'missing') el('variantFilter').value = '';
    limit = pageSize;
    render();
  });
  el('resetFilters').addEventListener('click', () => {
    el('search').value = '';
    el('variantFilter').value = '';
    if (!el('regionField').hidden) el('regionFilter').value = '';
    if (!el('collectionFilter').hidden) collection = 'all';
    limit = pageSize;
    render();
  });
  el('more').addEventListener('click', () => {limit += pageSize; render();});
  for (const [region] of regions) {
    const option = node('option',regionIcons[region] + ' ' + region);
    option.value = region;
    el('regionFilter').append(option);
  }
  for (const value of variants) {
    const option = node('option',variantOptionLabel(value)); option.value = value; el('variantFilter').append(option);
  }
  render();
  collectionSync = mountPokedexSync({store:collectionStore,storageKey,refresh:() => {
    if (refreshCollection()) render();
  }});
  const openCardCapture = mountPokedexScanner({
    cards:()=>data.cards,
    savedPrints:()=>[...(globalThis.PLAYMAT_STARTER_LIBRARY?.cards || []),...readLocalList('codexPokemonPlaymat.cards.v1')],
    speciesNames:names,displayVariant,variantOptionLabel,variantBadge,variants,
    openAdd:draft=>openEditor(null,null,draft)
  });
})();

(() => {
  'use strict';
  const fields = {
    cards: ['id','collection_id','pokemon_id','pokemon_unique_id','set_name','card_number','variant','image_url'],
    binder: ['id','collection_id','name','set_name','card_number','variant','image_url'],
    preferences: ['id','collection_id','pokemon_unique_id','normal_only']
  };
  const variants = ['normal','holo','reverse-holo','pokeball-reverse-holo','masterball-reverse-holo','energy-reverse-holo','illustration-rare','special'];
  const storageKey = 'tomtom.pokedex.collection.v1';
  const totalSpecies = 1025;
  const pageSize = 48;
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

  function parseCSV(source) {
    const input = source.replace(/^\uFEFF/, '');
    const firstLine = input.split(/\r?\n/, 1)[0];
    const separator = firstLine.includes(';') ? ';' : ',';
    const rows = [];
    let row = [], field = '', quoted = false, closed = false;
    const pushField = () => { row.push(field); field = ''; closed = false; };
    const pushRow = () => { pushField(); if (row.some(Boolean)) rows.push(row); row = []; };
    for (let i = 0; i < input.length; i++) {
      const char = input[i];
      if (quoted) {
        if (char === '"' && input[i + 1] === '"') { field += '"'; i++; }
        else if (char === '"') { quoted = false; closed = true; }
        else field += char;
      } else if (char === separator) pushField();
      else if (char === '\n' || char === '\r') {
        pushRow();
        if (char === '\r' && input[i + 1] === '\n') i++;
      } else if (char === '"' && !field && !closed) quoted = true;
      else if (closed || char === '"') throw new Error('The CSV has an invalid quoted field.');
      else field += char;
    }
    if (quoted) throw new Error('The CSV ends inside a quoted field.');
    pushRow();
    const header = rows.shift()?.map(value => value.trim());
    if (!header || new Set(header).size !== header.length) throw new Error('The CSV header is missing or invalid.');
    return { header, rows: rows.map((values, index) => {
      if (values.length !== header.length) throw new Error('The CSV has the wrong number of fields in row ' + (index + 2) + '.');
      return Object.fromEntries(header.map((name, i) => [name, values[i]]));
    }) };
  }

  function safeImage(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
    } catch { return ''; }
  }

  function convertRows(type, source) {
    const { header, rows } = parseCSV(source);
    if (!fields[type].every(field => header.includes(field))) throw new Error('The ' + type + ' file has unexpected columns.');
    const seen = new Set();
    return rows.map((row, index) => {
      const read = key => row[key]?.trim() || '';
      const sourceId = read('id'), collection = read('collection_id');
      if (!sourceId || !collection || seen.has(sourceId)) throw new Error('Invalid or repeated ID in ' + type + ' row ' + (index + 2) + '.');
      seen.add(sourceId);
      const identity = {id: type + ':' + sourceId, collection};
      if (type === 'preferences') {
        const pokemonKey = read('pokemon_unique_id'), normalOnly = read('normal_only').toLowerCase();
        if (!pokemonKey || !['true','false','t','f'].includes(normalOnly)) throw new Error('Invalid Pokémon preference in row ' + (index + 2) + '.');
        return { ...identity, pokemonKey, normalOnly: ['true','t'].includes(normalOnly) };
      }
      const pokemonId = Number(read('pokemon_id'));
      if (type === 'cards' && (!Number.isSafeInteger(pokemonId) || pokemonId < 1 || !read('pokemon_unique_id')))
        throw new Error('Invalid Pokémon number or form in row ' + (index + 2) + '.');
      return {
        ...identity, name: read('name'), pokemonId: type === 'cards' ? pokemonId : null, pokemonKey: read('pokemon_unique_id'),
        set: read('set_name'), number: read('card_number'), variant: normalizeVariant(read('variant')), image: safeImage(read('image_url')),
        notes: read('notes'), category: read('category'), tags: read('tags'), featured: read('is_featured'),
        createdAt: read('created_at'), japaneseName: read('japanese_name'), frenchName: read('french_name'),
        value: read('value'), currency: read('currency'), valueUpdatedAt: read('value_updated_at'), priceSource: read('price_source')
      };
    });
  }

  function collectionCounts(data) {
    const counts = new Map();
    for (const type of Object.keys(fields)) for (const row of data[type]) {
      const count = counts.get(row.collection) || {id: row.collection, cards: 0, binder: 0, preferences: 0};
      count[type]++;
      counts.set(row.collection, count);
    }
    return [...counts.values()].sort((a,b) => b.cards + b.binder - a.cards - a.binder);
  }

  function selectCollection(data, collection) {
    return Object.fromEntries(Object.keys(fields).map(type => [type, data[type].filter(row => row.collection === collection)]));
  }

  function mergeCollection(saved, imported) {
    return Object.fromEntries(Object.keys(fields).map(type => {
      const ids = new Set(saved[type].map(row => row.id));
      return [type, [...saved[type], ...imported[type].filter(row => !ids.has(row.id))]];
    }));
  }

  function printKey(set, number) {
    return set.trim().toLowerCase() + '|' + number.trim().toLowerCase().split('/')[0].replace(/^0+(?=[0-9])/, '');
  }

  function possiblePrintLinks(cards, library) {
    const prints = new Map();
    for (const card of library) {
      if (!card.setCode || !card.cardNumber) continue;
      const key = printKey(card.setCode, String(card.cardNumber));
      prints.set(key, prints.has(key) ? null : card);
    }
    return cards.flatMap(card => {
      const print = card.set && card.number && prints.get(printKey(card.set, card.number));
      return print ? [{card, print}] : [];
    });
  }

  function previewCounts(data, library = []) {
    const cards = [...data.cards, ...data.binder];
    const candidates = possiblePrintLinks(cards,library).length;
    return {cards: data.cards.length, binder: data.binder.length, preferences: data.preferences.length,
      missingPrint: cards.filter(card => !card.set || !card.number).length,
      missingPhoto: cards.filter(card => !card.image).length, candidates};
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {parseCSV,convertRows,collectionCounts,selectCollection,mergeCollection,previewCounts,inRegion,normalizeSavedVariants,binderNumber,catalogEntry,entryInRegion,tomaPokemonNames,normalizeSearch};
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
  let data = empty(), pending, view = 'cards', speciesFilter = null, speciesReturn, limit = pageSize, editing, damagedStorage = false;
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (!Object.keys(fields).every(type => Array.isArray(parsed?.[type]) &&
          parsed[type].every(entry => entry && typeof entry.id === 'string'))) throw new Error('Invalid saved collection');
      data = normalizeSavedVariants(parsed);
      if (data !== parsed) {
        try { localStorage.setItem(storageKey, JSON.stringify(data)); } catch { /* Keep the normalized view if storage is full. */ }
      }
    }
  } catch {
    damagedStorage = true;
    el('notice').textContent = 'Saved collection could not be read. This page is in read-only mode.';
  }

  function save(next) {
    if (damagedStorage) throw new Error('Saved collection could not be read. Changes are disabled.');
    localStorage.setItem(storageKey, JSON.stringify(next));
    data = next;
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

  function cardTile(card) {
    const article = node('article',null,'card');
    article.append(photo(card.image,'Photo unavailable'), node('h3',title(card)),
      node('small',[card.set,card.number].filter(Boolean).join(' · ')), variantBadge(card.variant));
    if (card.notes) article.append(node('small',card.notes));
    if (data.preferences.some(preference => preference.normalOnly && preference.pokemonKey === card.pokemonKey))
      article.append(node('small','Normal only'));
    article.append(button('Edit card', () => openEditor(card)));
    return article;
  }

  function speciesTile(entry, copies = [], deckNames = new Set(), variantCount = 0) {
    const {id,sprite} = entry;
    const owned = copies.length > 0;
    const name = entryName(entry);
    const article = node('article',null,'card species-card');
    article.dataset.owned = String(owned);
    const sprites = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/';
    const artwork = sprites + 'other/official-artwork/' + sprite + '.png';
    const featured = copies.find(card => /^(true|t)$/i.test(card.featured) && card.image);
    const cover = featured || copies.find(card => card.image) || copies[0];
    const image = owned ? cover?.image || artwork : sprites + sprite + '.png';
    const open = button(null, () => {
      if (!owned) { openEditor(null,entry); return; }
      speciesReturn = {search:el('search').value, variant:el('variantFilter').value, limit, scroll:window.scrollY};
      speciesFilter = entry;
      el('search').value = '';
      el('variantFilter').value = '';
      limit = pageSize;
      render();
      el('viewHeading').focus();
      window.scrollTo(0,0);
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
    const ends = [151,251,386,493,649,721,809,905,1025];
    const grid = node('div',null,'grid');
    let first = 1;
    ends.forEach((last,index) => {
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
  function render() {
    const owned = ownedSpecies();
    el('summary').replaceChildren(...[
      ['Pokédex species',formatProgress(owned.size,totalSpecies)], ['Card copies',data.cards.length], ['Binder entries',data.binder.length]
    ].map(([label,value]) => {
      const item = node('div');
      item.append(node('strong',value),node('small',label));
      return item;
    }));
    const heading = {cards: 'Pokédex', binder: 'Binder', missing: 'Missing Pokémon', progress: 'Progress'};
    el('viewHeading').textContent = speciesFilter ? entryName(speciesFilter) : heading[view];
    el('addCard').hidden = view === 'progress';
    el('filters').hidden = view === 'progress';
    const showCollection = view === 'cards' && !speciesFilter;
    el('collectionFilter').hidden = !showCollection;
    for (const button of collectionButtons) button.setAttribute('aria-pressed',String(button.dataset.collection === collection));
    el('variantField').hidden = view === 'missing';
    el('variantFilter').disabled = showCollection && collection === 'missing';
    el('regionField').hidden = view === 'binder' || !!speciesFilter;
    el('results').replaceChildren();
    el('resultCount').textContent = '';
    el('more').hidden = true;
    if (view === 'progress') { renderProgress(owned); return; }

    const search = normalizeSearch(el('search').value), variant = el('variantFilter').value;
    const region = el('regionFilter').value;
    el('resetFilters').disabled = !search && !variant && (el('regionField').hidden || !region) &&
      (!showCollection || collection === 'all');
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
    if (view === 'missing') {
      rows = catalog.filter(entry => !copiesByEntry.has(entry.key) && entryInRegion(entry,region) && matchesSpecies(entry));
      tile = entry => speciesTile(entry);
    } else {
      rows = data[view].filter(card => (!variant || card.variant === variant) &&
        (matches(title(card),card.set,card.number,card.japaneseName,card.frenchName) || matchesSpecies(catalogEntry(card))));
      tile = cardTile;
      if (speciesFilter) {
        rows = rows.filter(card => catalogEntry(card).key === speciesFilter.key);
        el('results').append(button('← All Pokémon', () => {
          const previous = speciesReturn;
          const name = entryName(speciesFilter);
          speciesFilter = null;
          speciesReturn = null;
          limit = previous?.limit || pageSize;
          el('search').value = previous?.search || '';
          el('variantFilter').value = previous?.variant || '';
          render();
          window.scrollTo(0,previous?.scroll || 0);
          [...el('results').querySelectorAll('.species-open')].find(item =>
            item.getAttribute('aria-label') === 'View registered cards for ' + name)?.focus({preventScroll:true});
        }));
      } else if (view === 'cards') {
        const groups = new Map();
        for (const card of rows) {
          const key = catalogEntry(card).key;
          const group = groups.get(key) || [];
          group.push(card);
          groups.set(key,group);
        }
        const extra = [...copiesByEntry.values()].filter(({entry})=>!entriesByKey.has(entry.key)).map(({entry})=>entry);
        rows = [...catalog,...extra].filter(entry => {
          if (!entryInRegion(entry,region)) return false;
          const collected = copiesByEntry.has(entry.key);
          if (collection === 'collected' && !collected || collection === 'missing' && collected) return false;
          return groups.has(entry.key) || !variant && matchesSpecies(entry);
        });
        const library = globalThis.PLAYMAT_STARTER_LIBRARY;
        const deckNames = tomaPokemonNames(library?.decks || [],readLocalList('codexPokemonPlaymat.decks.v1'),
          new Set(readLocalList('codexPokemonPlaymat.deletedDecks.v1')),
          [...(library?.cards || []),...readLocalList('codexPokemonPlaymat.cards.v1')].filter(card=>typeof card?.name==='string'));
        tile = entry => speciesTile(entry,groups.get(entry.key),deckNames,
          new Set((copiesByEntry.get(entry.key)?.cards || []).map(card=>card.variant).filter(Boolean)).size);
      }
    }
    el('resultCount').textContent = rows.length + (rows.length === 1 ? ' result' : ' results');
    if (!rows.length) {
      el('results').append(node('p', 'No results match these filters.', 'note'));
      return;
    }
    const grid = node('div',null,speciesFilter ? 'grid registered-prints' : 'grid');
    grid.append(...rows.slice(0,limit).map(tile));
    el('results').append(grid);
    el('more').hidden = limit >= rows.length;
  }

  function updatePreview() {
    const selected = selectCollection(pending, el('collectionSelect').value);
    const library = globalThis.PLAYMAT_STARTER_LIBRARY?.cards || [];
    const counts = previewCounts(selected,library);
    const list = node('p', counts.cards + ' Pokédex copies · ' + counts.binder + ' Binder entries · ' + counts.preferences + ' preferences');
    const review = node('p', counts.missingPrint + ' missing print details · ' + counts.missingPhoto + ' missing photo links · ' +
      counts.candidates + ' possible Playmat print links');
    el('previewCounts').replaceChildren(list,review);
    if (counts.candidates) {
      const reviewLinks = node('details');
      const examples = node('ul');
      const candidates = possiblePrintLinks([...selected.cards,...selected.binder],library);
      for (const {card,print} of candidates.slice(0,25)) {
        examples.append(node('li', [title(card), card.set, card.number, displayVariant(card.variant)].join(' · ') +
          ' → ' + print.name + (print.language ? ' (' + print.language + ')' : '')));
      }
      reviewLinks.append(node('summary','Review possible matches'), node('p','These suggestions are based on set and number. Importing won’t link them automatically.'), examples);
      if (counts.candidates > 25) reviewLinks.append(node('p','Showing 25 of ' + counts.candidates + ' candidates.'));
      el('previewCounts').append(reviewLinks);
    }
  }
  el('importForm').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget, submit = form.querySelector('button');
    el('preview').hidden = true;
    pending = null;
    submit.disabled = true;
    try {
      const snapshot = empty();
      for (const type of Object.keys(fields)) {
        const file = form.elements.namedItem(type).files[0];
        if (file?.size > 15000000) throw new Error('Each CSV must be under 15 MB.');
        if (file) snapshot[type] = convertRows(type, await file.text());
      }
      const collections = collectionCounts(snapshot);
      if (!collections.length) throw new Error('Choose at least one export containing collection rows.');
      el('collectionSelect').replaceChildren(...collections.map((row,i) => {
        const option = node('option','Collection ' + (i+1) + ' · ' + row.cards + ' Pokédex · ' + row.binder + ' Binder');
        option.value = row.id;
        return option;
      }));
      pending = snapshot;
      el('preview').hidden = false;
      el('notice').textContent = '';
      updatePreview();
    } catch (error) { el('notice').textContent = error.message; }
    finally { submit.disabled = false; }
  });
  el('collectionSelect').addEventListener('change',updatePreview);
  el('saveImport').addEventListener('click', () => {
    if (!pending) return;
    try {
      const next = mergeCollection(data, selectCollection(pending,el('collectionSelect').value));
      const added = Object.keys(fields).reduce((sum,type) => sum+next[type].length-data[type].length,0);
      save(next);
      el('notice').textContent = added ? 'Imported ' + added + ' records into this browser.' : 'These records are already in this collection.';
      pending = null;
      el('preview').hidden = true;
      el('importPanel').open = false;
      render();
    } catch (error) { el('notice').textContent = 'Could not save the import. ' + error.message; }
  });

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
  el('editorForm').elements.namedItem('pokemonId').addEventListener('input',()=>updateFormChoices());
  function openEditor(card, entry = speciesFilter) {
    editing = {card, type: view === 'binder' ? 'binder' : 'cards'};
    const form = el('editorForm');
    form.reset();
    for (const key of ['name','set','number','variant','image','notes']) form.elements.namedItem(key).value = card?.[key] || '';
    const number = form.elements.namedItem('pokemonId');
    number.required = editing.type === 'cards';
    number.value = card?.pokemonId ?? entry?.id ?? '';
    updateFormChoices(card?.pokemonKey || entry?.key);
    el('speciesField').hidden = !number.required;
    form.elements.namedItem('name').required = editing.type === 'binder';
    el('editorHeading').textContent = card ? 'Edit card' : 'Add card';
    el('editorStatus').textContent = '';
    el('editor').showModal();
  }
  el('editorForm').addEventListener('submit', event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const read = key => String(form.get(key) || '').trim();
    const {card, type} = editing;
    const image = safeImage(read('image'));
    if (read('image') && !image) { el('editorStatus').textContent = 'Enter an HTTPS photo URL.'; return; }
    const pokemonId = type === 'cards' ? Number(read('pokemonId')) : null;
    const entry = {...card, id:card?.id || 'manual:' + crypto.randomUUID(), pokemonId,
      pokemonKey: type === 'cards' ? read('pokemonForm') || String(pokemonId) : '',
      name:read('name'), set:read('set'), number:read('number'), variant:normalizeVariant(read('variant')) || 'normal',
      image, notes:read('notes'), createdAt:card?.createdAt || new Date().toISOString()};
    const updated = card ? data[type].map(item => item.id === card.id ? entry : item) : [...data[type],entry];
    try {
      save({...data,[type]:updated});
      el('editor').close();
      el('notice').textContent = 'Card saved in this browser.';
      render();
    } catch (error) { el('editorStatus').textContent = 'Could not save the card. ' + error.message; }
  });
  el('cancelEdit').addEventListener('click', () => el('editor').close());
  el('addCard').addEventListener('click', () => openEditor(null));
  for (const item of document.querySelectorAll('[data-view]')) item.addEventListener('click', () => {
    view = item.dataset.view; speciesFilter = null; collection = 'all'; limit = pageSize;
    for (const other of document.querySelectorAll('[data-view]')) other.setAttribute('aria-pressed',String(other === item));
    el('search').value = ''; el('variantFilter').value = ''; render();
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
    const input = node('option'); input.value = value; el('variants').append(input);
    const option = node('option',(variantIcons[value] || '◇') + ' ' + displayVariant(value)); option.value = value; el('variantFilter').append(option);
  }
  render();
})();

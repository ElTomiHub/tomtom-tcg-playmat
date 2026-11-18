(() => {
  'use strict';
  const fields = {
    cards: ['id','collection_id','pokemon_id','pokemon_unique_id','set_name','card_number','variant','image_url'],
    binder: ['id','collection_id','name','set_name','card_number','variant','image_url'],
    preferences: ['id','collection_id','pokemon_unique_id','normal_only']
  };
  const variants = ['normal','holo','reverse-holo','pokeball-reverse-holo','masterball-reverse-holo','energy-reverse-holo','illustration-rare','normal-silver','special'];
  const storageKey = 'tomtom.pokedex.collection.v1';
  const totalSpecies = 1025;
  const pageSize = 48;

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
        set: read('set_name'), number: read('card_number'), variant: read('variant'), image: safeImage(read('image_url')),
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
    module.exports = {parseCSV,convertRows,collectionCounts,selectCollection,mergeCollection,previewCounts};
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
  const names = new Map();
  let data = empty(), pending, view = 'cards', speciesFilter = null, limit = pageSize, editing, damagedStorage = false;
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (!Object.keys(fields).every(type => Array.isArray(parsed?.[type]) &&
          parsed[type].every(entry => entry && typeof entry.id === 'string'))) throw new Error('Invalid saved collection');
      data = parsed;
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

  function speciesName(id) { return names.get(id) || 'Pokémon #' + id; }
  function title(card) { return card.name || speciesName(card.pokemonId); }
  function validSpecies(id) { return id >= 1 && id <= totalSpecies; }
  function displayVariant(value) { return (value || 'Unknown variant').replaceAll('-', ' '); }
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
      node('small',[card.set,card.number,displayVariant(card.variant)].filter(Boolean).join(' · ')));
    if (card.notes) article.append(node('small',card.notes));
    if (data.preferences.some(preference => preference.normalOnly && preference.pokemonKey === card.pokemonKey))
      article.append(node('small','Normal only'));
    article.append(button('Edit card', () => openEditor(card)));
    return article;
  }

  function speciesTile(id, copies) {
    const article = node('article',null,'card species-card');
    const image = copies?.find(card => card.image)?.image ||
      'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/' + id + '.png';
    article.append(photo(image, 'No image'), node('h3',speciesName(id)), node('small','#' + String(id).padStart(4,'0')));
    if (copies) article.append(button(copies.length + (copies.length === 1 ? ' copy' : ' copies'), () => {
      speciesFilter = id; limit = pageSize; render();
    }));
    else article.append(button('Add card', () => openEditor(null,id)));
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
    el('viewHeading').textContent = speciesFilter ? speciesName(speciesFilter) : heading[view];
    el('addCard').hidden = !['cards','binder'].includes(view);
    el('filters').hidden = view === 'progress';
    el('variantField').hidden = view === 'missing';
    el('results').replaceChildren();
    el('resultCount').textContent = '';
    el('more').hidden = true;
    if (view === 'progress') { renderProgress(owned); return; }

    const search = el('search').value.trim().toLowerCase(), variant = el('variantFilter').value;
    const matches = (...values) => !search || values.some(value => String(value ?? '').toLowerCase().includes(search));
    let rows, tile;
    if (view === 'missing') {
      rows = Array.from({length: totalSpecies}, (_,i) => i+1).filter(id => !owned.has(id) && matches(id,speciesName(id)));
      tile = id => speciesTile(id);
    } else {
      rows = data[view].filter(card => (!variant || card.variant === variant) &&
        matches(title(card),card.set,card.number,card.pokemonId,card.japaneseName,card.frenchName));
      tile = cardTile;
      if (speciesFilter) {
        rows = rows.filter(card => card.pokemonId === speciesFilter);
        el('results').append(button('← All Pokémon', () => { speciesFilter = null; limit = pageSize; render(); }));
      } else if (view === 'cards') {
        const groups = new Map();
        for (const card of rows) {
          const group = groups.get(card.pokemonId) || [];
          group.push(card);
          groups.set(card.pokemonId,group);
        }
        rows = [...groups.entries()].sort(([a],[b]) => a-b);
        tile = ([id,copies]) => speciesTile(id,copies);
      }
    }
    el('resultCount').textContent = rows.length + (rows.length === 1 ? ' result' : ' results');
    if (!rows.length) {
      el('results').append(node('p', 'No cards match this view. Import your collection or add a card to get started.', 'note'));
      return;
    }
    const grid = node('div',null,'grid');
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

  function openEditor(card, pokemonId = speciesFilter) {
    editing = {card, type: view === 'binder' ? 'binder' : 'cards'};
    const form = el('editorForm');
    form.reset();
    for (const key of ['name','set','number','variant','image','notes']) form.elements.namedItem(key).value = card?.[key] || '';
    const number = form.elements.namedItem('pokemonId');
    number.required = editing.type === 'cards';
    number.value = card?.pokemonId ?? pokemonId ?? '';
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
      pokemonKey: card?.pokemonId === pokemonId ? card.pokemonKey : String(pokemonId ?? ''),
      name:read('name'), set:read('set'), number:read('number'), variant:read('variant') || 'normal',
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
    view = item.dataset.view; speciesFilter = null; limit = pageSize;
    for (const other of document.querySelectorAll('[data-view]')) other.setAttribute('aria-pressed',String(other === item));
    el('search').value = ''; el('variantFilter').value = ''; render();
  });
  for (const id of ['search','variantFilter']) el(id).addEventListener('input', () => {limit = pageSize; render();});
  el('more').addEventListener('click', () => {limit += pageSize; render();});
  for (const value of variants) {
    const input = node('option'); input.value = value; el('variants').append(input);
    const option = node('option',displayVariant(value)); option.value = value; el('variantFilter').append(option);
  }
  render();
  fetch('https://pokeapi.co/api/v2/pokemon-species/?limit=' + totalSpecies).then(response => {
    if (!response.ok) throw new Error('Catalog unavailable');
    return response.json();
  }).then(catalog => {
    for (const entry of catalog.results || []) {
      const id = Number(entry.url?.match(/\/(\d+)\/$/)?.[1]);
      if (validSpecies(id)) names.set(id, entry.name.split('-').map(word => word[0]?.toUpperCase()+word.slice(1)).join(' '));
    }
    render();
  }).catch(() => { /* Dex numbers and saved card information remain available offline. */ });
})();

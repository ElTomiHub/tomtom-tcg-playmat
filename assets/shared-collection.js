async function mountSharedCollection({catalog,catalogEntry,entryName,featuredCard,safeImage,normalizeSearch,regions,regionIcons,entryInRegion,variants,variantOptionLabel,normalizeVariant,normalizeSpecialTags,specialTagKey}) {
  const get = id => document.getElementById(id);
  const key = new URLSearchParams(location.hash.slice(1)).get('key') || '';
  const status = get('shareStatus');
  if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(key)) {
    status.textContent = 'This collection link is incomplete.';
    return;
  }
  let data;
  try {
    const response = await fetch(playmatSyncConfig.projectUrl+'/rest/v1/rpc/playmat_collection_view',{
      method:'POST',cache:'no-store',credentials:'omit',
      headers:{apikey:playmatSyncConfig.publishableKey,'Content-Type':'application/json'},body:JSON.stringify({link_key:key})
    });
    if (!response.ok) throw Error();
    data = await response.json();
    if (!data) { status.textContent='This collection link is unavailable.'; return; }
  } catch { status.textContent='Could not load the shared collection. Refresh to try again.'; return; }

  const groups = new Map();
  for (const card of data.cards) {
    const key = catalogEntry(card).key;
    if (!groups.has(key)) groups.set(key,[]);
    groups.get(key).push(card);
  }
  const prefs = new Map(data.preferences.map(p=>[p.id,p]));
  const order = new Map((prefs.get('binder:special-order')?.order || []).map((id,i)=>[id,i]));
  const specials = data.binder.sort((a,b)=>(order.get(a.id)??Infinity)-(order.get(b.id)??Infinity));
  const region=get('galleryRegion'), variant=get('galleryVariant'), tag=get('galleryTag'), search=get('gallerySearch');
  for (const [name] of regions) region.add(new Option(regionIcons[name]+' '+name,name));
  for (const finish of variants) variant.add(new Option(variantOptionLabel(finish),finish));
  const tagCounts=new Map(), tagsById=new Map();
  for (const card of specials) {
    const tags=normalizeSpecialTags(card.tags);
    tagsById.set(card.id,tags.map(specialTagKey));
    for (const label of tags) {
      const key=specialTagKey(label), group=tagCounts.get(key) || {label,count:0};
      group.count++; tagCounts.set(key,group);
    }
  }
  tag.add(new Option('All tags ('+specials.length+')',''));
  for (const [key,group] of [...tagCounts].sort((a,b)=>a[1].label.localeCompare(b[1].label)))
    tag.add(new Option(group.label+' ('+group.count+')',key));
  let special=false, limit=48, ownership='all';
  function element(tag,text,cls) {
    const el=document.createElement(tag);
    if (text) el.textContent=text;
    if (cls) el.className=cls;
    return el;
  }
  function artwork(url,label) {
    const src=safeImage(url);
    const fallback=element('span','Artwork unavailable','fallback');
    if (!src) return fallback;
    const img=element('img'); img.loading='lazy'; img.alt=label; img.src=src;
    img.onerror=()=>img.replaceWith(fallback);
    return img;
  }
  function details(name,cards) {
    const dialog=get('sharedPrints'), list=dialog.querySelector('.grid');
    dialog.querySelector('h2').textContent=name;
    list.replaceChildren();
    if (!cards.length) list.append(element('p','Missing from this collection.'));
    for (const c of cards) {
      const row=element('article',null,'card');
      row.append(artwork(c.image,c.name || name),element('strong',c.name || name),
        element('small',[c.set,c.number,c.variant?.replaceAll('-',' ')].filter(Boolean).join(' · ')));
      list.append(row);
    }
    dialog.showModal();
  }
  function render() {
    const query=normalizeSearch(search.value);
    const contains=(...values)=>values.some(value=>normalizeSearch(value).includes(query));
    const matchPrint=c=>contains(c.name,c.set,c.number);
    const speciesMatches=r=>contains(entryName(r),String(r.id),'#'+String(r.id).padStart(4,'0'),...(POKEDEX_SPECIES_NAMES[r.id-1] || []));
    const covers=new Map();
    const matches=special ? specials.filter(c=>(!tag.value || tagsById.get(c.id).includes(tag.value)) &&
      (matchPrint(c) || contains(...(POKEDEX_SPECIES_NAMES[Number(c.pokemonId)-1] || [])))) : catalog.filter(r=>{
      if (!entryInRegion(r,region.value)) return false;
      const cards=groups.get(r.key) || [];
      if (ownership==='missing' && cards.length || ownership==='collected' && !cards.length) return false;
      const byName=speciesMatches(r);
      const matching=cards.filter(c=>(!variant.value || normalizeVariant(c.variant)===variant.value) && (byName || matchPrint(c)));
      if (matching.length) covers.set(r.key,featuredCard(matching,prefs.get('featured:'+r.key)?.cardId));
      return matching.length || (!variant.value && byName);
    });
    const filtered=Boolean(query || (special ? tag.value : region.value || variant.value || ownership!=='all'));
    get('galleryReset').disabled=!filtered;
    get('galleryCount').textContent=filtered ? matches.length+(matches.length===1?' result':' results') : '';
    get('galleryRegionField').hidden=special; get('galleryVariantField').hidden=special;
    get('galleryTagField').hidden=!special; get('collectionFilter').hidden=special;
    variant.disabled=ownership==='missing';
    for (const btn of document.querySelectorAll('[data-status]')) btn.setAttribute('aria-pressed',String(btn.dataset.status===ownership));
    const results=get('galleryResults'); results.replaceChildren();
    for (const r of matches.slice(0,limit)) {
      const cards=special ? [r] : groups.get(r.key) || [];
      const cover=special ? r : covers.get(r.key);
      const name=special ? r.name : entryName(r);
      const tile=element('article',null,'card species-card'); tile.dataset.owned=String(!!cards.length);
      const open=element('button',null,'species-open'); open.setAttribute('aria-label','View '+name);
      open.append(artwork(cover?.image || (!special && 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/'+r.sprite+'.png'),name));
      open.onclick=()=>details(name,cards);
      tile.append(open,element('h3',name),element('small',special ? [r.set,r.number].filter(Boolean).join(' · ') : '#'+String(r.id).padStart(4,'0')));
      results.append(tile);
    }
    if (!matches.length) results.append(element('p','No cards found.'));
    get('galleryMore').hidden=limit>=matches.length;
    get('dexTab').setAttribute('aria-pressed',String(!special)); get('specialTab').setAttribute('aria-pressed',String(special));
  }
  function update() { limit=48; render(); }
  function reset() { search.value=''; region.value=''; variant.value=''; tag.value=''; ownership='all'; update(); }
  for (const [id,value] of [['dexTab',false],['specialTab',true]]) get(id).onclick=()=>{special=value;reset();};
  for (const btn of document.querySelectorAll('[data-status]')) btn.onclick=()=>{
    ownership=btn.dataset.status; if (ownership==='missing') variant.value=''; update();
  };
  for (const field of [region,variant,tag]) field.onchange=update;
  get('galleryReset').onclick=reset;
  search.oninput=update;
  get('galleryMore').onclick=()=>{limit+=48;render();};
  status.textContent='Read-only · '+data.cards.length+' Pokédex cards · '+specials.length+' Special Collection cards';
  get('gallery').hidden=false; render();
}

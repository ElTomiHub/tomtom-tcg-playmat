async function mountSharedCollection({catalog,catalogEntry,entryName,featuredCard,safeImage,normalizeSearch}) {
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
  let special=false, limit=48;
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
    const query=normalizeSearch(get('gallerySearch').value);
    const rows=special ? specials : catalog;
    const matches=rows.filter(r=>{
      const texts=special ? [r.name,r.set,r.number] : [entryName(r),String(r.id),...(POKEDEX_SPECIES_NAMES[r.id-1] || []),
        ...(groups.get(r.key)||[]).flatMap(c=>[c.name,c.set,c.number])];
      return texts.some(s=>normalizeSearch(s).includes(query));
    });
    const results=get('galleryResults'); results.replaceChildren();
    for (const r of matches.slice(0,limit)) {
      const cards=special ? [r] : groups.get(r.key) || [];
      const cover=special ? r : featuredCard(cards,prefs.get('featured:'+r.key)?.cardId);
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
  for (const [id,value] of [['dexTab',false],['specialTab',true]]) get(id).onclick=()=>{
    special=value; limit=48; get('gallerySearch').value=''; render();
  };
  get('gallerySearch').oninput=()=>{limit=48;render();};
  get('galleryMore').onclick=()=>{limit+=48;render();};
  status.textContent='Read-only · '+data.cards.length+' Pokédex cards · '+specials.length+' Special Collection cards';
  get('gallery').hidden=false; render();
}

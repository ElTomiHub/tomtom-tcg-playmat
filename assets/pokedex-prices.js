(function (root) {
  'use strict';
  const clean = value => String(value || '').normalize('NFKC').trim();
  const setCode = value => clean(value).toUpperCase();
  const number = value => clean(value).toUpperCase().replace(/\s/g,'').split('/').map(part=>part.replace(/^0+(?=\d)/,'')).join('/');
  const variant = value => /^normal[\s_-]+silver$/i.test(value) ? 'normal' : value || 'normal';
  const validAmount = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  function identity(card) {
    // Missing language in the imported collection denotes Japanese prints.
    return JSON.stringify([clean(card.language || 'ja').toLowerCase(),setCode(card.set),number(card.number),variant(card.variant)]);
  }
  const key = card => 'price:' + identity(card);
  const imported=new Map();
  for(const item of root.POKEDEX_IMPORTED_PRICES || []) {
    const id=key(item),previous=imported.get(id);
    if(item.currency==='JPY' && validAmount(item.value) && (!previous || Date.parse(item.checkedAt)>Date.parse(previous.checkedAt)))
      imported.set(id,item);
  }
  function lookupInput(card) {
    if (!['ja','jp'].includes(clean(card.language || 'ja').toLowerCase())) return null;
    const set = setCode(card.set), num = number(card.number);
    if (!/^[A-Z0-9][A-Z0-9.-]{0,23}$/.test(set) || !/^[A-Z0-9-]{1,16}(\/[A-Z0-9-]{1,16})?$/.test(num)) return null;
    return {set,number:num,variant:variant(card.variant)};
  }
  function quote(card, preferences) {
    const saved = preferences.find(row=>row.id===key(card));
    if (saved && Object.hasOwn(saved,'value')) return validAmount(saved.value) && saved.currency==='JPY' ? saved : null;
    // Retain old Lovable values, clearly distinguished from refreshed quotes.
    if (Number(card.value)>0 && Number.isFinite(Number(card.value)) && card.currency==='JPY')
      return {value:Number(card.value),currency:'JPY',source:'Imported value',checkedAt:card.value_updated_at || '',sourceUrl:''};
    return imported.get(key(card)) || null;
  }
  function totals(cards, preferences) {
    let value=0,priced=0;
    for (const card of cards) { const item=quote(card,preferences); if(item) {value+=item.value;priced++;} }
    return {value,priced,missing:cards.length-priced,count:cards.length};
  }
  function valueRows(collection,options={}) {
    const normalize=value=>clean(value).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
    const search=normalize(options.search),groups=new Map();
    for(const destination of ['cards','binder']) {
      if(options.destination && options.destination!==destination) continue;
      for(const card of collection[destination]) {
        if(search && !normalize([card.name,card.set,card.number].join(' ')).includes(search)) continue;
        const value=quote(card,collection.preferences);
        if(options.availability==='missing' && value || options.availability==='priced' && !value) continue;
        // Imported per-copy values can differ, so preserve separate rows for those values.
        const id=JSON.stringify([destination,identity(card),normalize(card.name) || card.id,value?.value ?? null]);
        const row=groups.get(id);
        if(row) row.count++;
        else groups.set(id,{card,destination,quote:value,count:1});
      }
    }
    return [...groups.values()].sort((a,b)=>{
      const name=String(a.card.name || '').localeCompare(String(b.card.name || ''));
      if(options.sort==='name') return name;
      if(Boolean(a.quote)!==Boolean(b.quote)) return a.quote?-1:1;
      const delta=(a.quote?.value || 0)-(b.quote?.value || 0);
      return (options.sort==='low'?delta:-delta) || name;
    });
  }
  function upsert(preferences,card,result) {
    const id=key(card), previous=preferences.find(row=>row.id===id);
    const row={...previous,id,lastAttempt:new Date().toISOString(),status:result.status || 'unavailable'};
    if (result.status==='success' && validAmount(result.value)) Object.assign(row,{
      value:result.value,currency:'JPY',source:result.source || 'Card Rush',sourceUrl:result.sourceUrl || '',
      checkedAt:result.checkedAt || new Date().toISOString()});
    return [...preferences.filter(item=>item.id!==id),row];
  }
  function detectVariant(title,rarity) {
    if (/マスターボール/.test(title)) return 'masterball-reverse-holo';
    if (/モンスターボール|モンスボール/.test(title)) return 'pokeball-reverse-holo';
    if (/エネルギー.*ミラー|ミラー.*エネルギー/.test(title)) return 'energy-reverse-holo';
    if (/ミラー|リバース/.test(title)) return 'reverse-holo';
    if (/[（(]/.test(title)) return null;
    if (['C','U','-'].includes(rarity)) return 'normal';
    if (['R','RR','RRR','K','H','ACE'].includes(rarity)) return 'holo';
    if (['AR','SAR','SR','UR','CHR','CSR','HR','S'].includes(rarity)) return 'illustration-rare';
    return null;
  }
  function parseListings(html) {
    const listings=[];
    for(const block of String(html).split(/<div\s+class=["']item_data["']/i).slice(1)) {
      const id=block.match(/data-product-id=["'](\d+)["']/)?.[1];
      const title=clean((block.match(/<span\s+class=["']goods_name["']>([\s\S]*?)<\/p>/)?.[1] || '').replace(/<[^>]*>/g,'').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&'));
      const amount=block.match(/class=["']figure["']>\s*([\d,]+)\s*円/);
      const set=title.match(/\[([^\]]+)\]/)?.[1];
      const num=title.match(/\{([^}]+)\}/)?.[1];
      const rarity=title.match(/[【〖]([^】〗]+)[】〗]/)?.[1];
      if(!id || !title || !amount || !set || !num || !rarity) continue;
      // Only ordinary single-card retail listings. Never substitute a graded or damaged copy.
      if (/〔|状態|傷|キズ|難あり|プレイ用|PSA|BGS|CGC|ARS|鑑定|未開封|パック|BOX|セット|スリーブ|中国語|英語|韓国語/i.test(title)) continue;
      const name=title.split(/[【〖]/)[0];
      listings.push({set:setCode(set),number:number(num),variant:detectVariant(name,rarity),
        value:Number(amount[1].replace(/,/g,'')),sourceUrl:'https://www.cardrush-pokemon.jp/product/'+id,title});
    }
    return listings;
  }
  function match(card,html) {
    const input=lookupInput(card);
    if (!input) return {status:'missing_info'};
    if (/cf-chl-|Just a moment|Enable JavaScript and cookies/i.test(html)) return {status:'blocked'};
    const matches=parseListings(html).filter(item=>item.set===input.set && item.number===input.number && item.variant===input.variant && validAmount(item.value));
    // Multiple different prices are ambiguous; do not silently choose the cheapest.
    if(matches.length!==1) return {status:matches.length?'ambiguous':'not_found'};
    return {...matches[0],status:'success',source:'Card Rush',checkedAt:new Date().toISOString()};
  }
  const api={identity,key,lookupInput,quote,totals,valueRows,upsert,parseListings,match,validAmount};
  if(typeof module!=='undefined' && module.exports) module.exports=api;
  else root.PokedexPrices=api;
})(globalThis);

'use strict';
function createPokedexPricesUI({getData,save,node,button,title,photo,openCard}) {
  const prices=globalThis.PokedexPrices;
  const money=value=>new Intl.NumberFormat('ja-JP',{style:'currency',currency:'JPY',maximumFractionDigits:0}).format(value);
  const client=createLibrarySyncClient({...playmatSyncConfig,storage:localStorage,fetcher:fetch.bind(window)});
  let bindings=[],running=false,stopped=false,message='';
  const filters={search:'',destination:'',availability:'',sort:'high'};
  let listLimit=60;
  const statuses={blocked:'Card Rush is blocking automated access. Saved values are unchanged.',
    setup:'Price lookup needs the one-time Supabase setup (card-prices.sql).',
    signin:'Sign in using the sync menu before checking prices.',
    not_found:'No exact print and variant found.',ambiguous:'More than one matching listing. Set a value manually.',
    missing_info:'Japanese set code and full collector number required for lookup.',
    unavailable:'Price lookup is unavailable. Saved values are unchanged.'};
  function bind(element,update) { bindings.push({element,update}); update(); return element; }
  function refresh() {
    const status=document.getElementById('priceLookupStatus');
    if(status) {status.textContent=message;status.hidden=!message;}
    bindings=bindings.filter(item=>item.element.isConnected);
    for(const item of bindings) item.update();
  }
  function summary(cards,label) {
    const box=node('section',null,'price-summary');
    return bind(box,()=>{
      const result=prices.totals(cards(),getData().preferences);
      box.replaceChildren(node('small',label),node('strong',result.priced?money(result.value):'—'),
        node('small',result.priced+' priced · '+result.missing+' without a value'));
    });
  }
  function cardPrice(card) {
    const box=node('div',null,'card-price');
    return bind(box,()=>{
      const data=getData(),quote=prices.quote(card,data.preferences);
      const saved=data.preferences.find(row=>row.id===prices.key(card));
      const text=node('div',null,'card-price-text');
      text.append(node('strong',quote?money(quote.value):'Price unavailable'));
      if(quote) {
        const source=node('small',quote.source || 'Saved value');
        if(/^https:\/\/www\.cardrush-pokemon\.jp\/product\/\d+$/.test(quote.sourceUrl || '')) {
          const link=node('a',quote.source); link.href=quote.sourceUrl; link.target='_blank'; link.rel='noopener noreferrer'; text.append(link);
        } else text.append(source);
        const date=Date.parse(quote.checkedAt);
        if(Number.isFinite(date)) text.append(node('small',new Date(date).toLocaleDateString()));
      }
      if(saved?.status && !['success','manual','removed'].includes(saved.status))
        text.append(node('small',statuses[saved.status] || statuses.unavailable));
      const edit=button('Set value',()=>editValue(card));
      edit.className='price-small-button';
      const check=button('Check price',()=>void checkCards([card]));
      check.disabled=running; check.className='price-small-button';
      box.replaceChildren(text,edit,check);
    });
  }
  function editValue(card) {
    const dialog=node('dialog'),form=node('form'),input=node('input'),error=node('p');
    input.type='number'; input.min='0'; input.step='1'; input.inputMode='numeric'; input.required=true;
    const current=prices.quote(card,getData().preferences);
    input.value=current?String(current.value):'';
    const label=node('label','Value per copy (¥)'); label.append(input);
    const close=button('Cancel',()=>dialog.close());
    const submit=node('button','Save value','primary'); submit.type='submit';
    const clear=button('Remove saved value',()=>void commit(null));
    const actions=node('footer'); actions.append(clear,close,submit);
    form.append(node('h2','Card value'),node('p',[title(card),card.set,card.number,card.variant].filter(Boolean).join(' · ')),label,error,actions);
    dialog.append(form); document.body.append(dialog);
    dialog.addEventListener('close',()=>dialog.remove(),{once:true});
    async function commit(value) {
      submit.disabled=clear.disabled=true;
      try {
        const data=getData(),id=prices.key(card);
        const row={id,value,currency:'JPY',source:'Manual value',sourceUrl:'',checkedAt:new Date().toISOString(),status:value===null?'removed':'manual'};
        await save({...data,preferences:[...data.preferences.filter(item=>item.id!==id),row]});
        dialog.close(); refresh();
      } catch {error.textContent='Could not save the value. Please try again.';}
      finally {submit.disabled=clear.disabled=false;}
    }
    form.addEventListener('submit',event=>{event.preventDefault(); const value=Number(input.value); if(input.value!=='' && prices.validAmount(value)) void commit(value);});
    dialog.showModal(); input.focus();
  }
  async function checkCards(cards) {
    if(running) return;
    const session=client.getSession();
    if(!session) {message=statuses.signin; refresh(); return;}
    running=true; stopped=false;
    const unique=[...new Map(cards.map(card=>[prices.key(card),card])).values()];
    const pages=new Map(); let completed=0;
    message='Checking prices…'; refresh();
    try {
      for(const card of unique) {
        if(stopped || client.getSession()?.userId!==session.userId) break;
        const input=prices.lookupInput(card);
        const before=JSON.stringify(getData().preferences.find(row=>row.id===prices.key(card)));
        let result={status:'missing_info'};
        if(input) {
          const reference=input.set+':'+input.number;
          if(!pages.has(reference)) pages.set(reference,await client.priceLookup(input.set,input.number));
          const response=pages.get(reference);
          result=response?.status==='success'?prices.match(card,response.html):{status:response?.status || 'unavailable'};
          if(result.status==='success') result.checkedAt=response.checkedAt;
        }
        const data=getData();
        if(client.getSession()?.userId!==session.userId) break;
        // A manual edit, deletion or print change during lookup takes precedence.
        if([...data.cards,...data.binder].some(row=>prices.identity(row)===prices.identity(card)) &&
          before===JSON.stringify(data.preferences.find(row=>row.id===prices.key(card))))
          await save({...data,preferences:prices.upsert(data.preferences,card,result)});
        completed++;
        message='Checked '+completed+' / '+unique.length+' prints.'; refresh();
        if(['blocked','unavailable'].includes(result.status)) {message=statuses[result.status];break;}
      }
    } catch(error) {message=[400,404].includes(error.status)?statuses.setup:statuses.unavailable;}
    finally {running=false; if(stopped) message='Price refresh stopped. Saved values are kept.';refresh();}
  }
  function renderValue(container) {
    const cards=()=>getData().cards,binder=()=>getData().binder;
    const grid=node('div',null,'value-summaries');
    grid.append(summary(cards,'Pokédex'),summary(binder,'Special Collection'),summary(()=>[...cards(),...binder()],'Total collection'));
    const controls=node('section',null,'panel value-controls');
    const refreshButton=button('Refresh collection prices',()=>void checkCards([...cards(),...binder()]));
    const stop=button('Stop',()=>{stopped=true;stop.disabled=true;});
    const status=node('p'); status.setAttribute('role','status');
    bind(controls,()=>{refreshButton.disabled=running;stop.hidden=!running;stop.disabled=stopped;status.textContent=message;});
    controls.append(refreshButton,stop,status,node('p','JPY per physical copy. Totals exclude unknown values. Card Rush retail listings are matched by Japanese set, full number and finish; manual and imported values are also included.','note'));
    const setup=node('details'),setupTitle=node('summary','Price lookup setup');
    const download=node('a','Download the Supabase setup SQL');download.href='card-prices.sql';download.download='card-prices.sql';
    setup.append(setupTitle,node('p','Run the SQL once in your Supabase SQL Editor, then sign in and refresh. Card Rush may block requests; no price is guessed when a lookup fails.'),download);
    controls.append(setup);container.append(grid);
    const browser=node('section',null,'panel value-browser');
    browser.append(node('h3','Card values'));
    const fields=node('div',null,'value-filters');
    const search=node('input');search.type='search';search.placeholder='Name, set or number';search.value=filters.search;
    const searchLabel=node('label','Search cards');searchLabel.append(search);fields.append(searchLabel);
    const choices=[['destination','Collection',[['','Both collections'],['cards','Pokédex'],['binder','Special Collection']]],
      ['availability','Price',[['','All cards'],['missing','Without a price'],['priced','With a price']]],
      ['sort','Sort by',[['high','Value: high to low'],['low','Value: low to high'],['name','Name: A–Z']]]];
    const inputs={search};
    for(const [key,label,options] of choices) {
      const field=node('label',label),select=node('select');
      select.setAttribute('aria-label',label);
      for(const [value,text] of options) {const option=node('option',text);option.value=value;select.append(option);}
      select.value=filters[key];inputs[key]=select;field.append(select);fields.append(field);
    }
    const reset=button('Reset filters',()=>{
      Object.assign(filters,{search:'',destination:'',availability:'',sort:'high'});
      for(const [key,input] of Object.entries(inputs)) input.value=filters[key];
      listLimit=60;draw();
    });
    const count=node('p',null,'note'),list=node('div',null,'value-list');count.setAttribute('role','status');
    const more=button('Show more',()=>{listLimit+=60;draw();});
    function draw() {
      const rows=prices.valueRows(getData(),filters);
      count.textContent=rows.length+' print rows · '+rows.reduce((sum,row)=>sum+row.count,0)+' copies. Values are per copy; totals above include both collections.';
      list.replaceChildren();
      for(const row of rows.slice(0,listLimit)) {
        const {card,destination,quote,count:copies}=row;
        const item=button(null,()=>openCard(card,destination));item.className='value-card';
        item.dataset.cardId=card.id;
        item.setAttribute('aria-label','View '+[title(card),card.set,card.number,card.variant].filter(Boolean).join(' · '));
        const details=node('span',null,'value-card-details');
        details.append(node('strong',title(card)),node('small',[card.set,card.number,card.variant].filter(Boolean).join(' · ')),
          node('small',(destination==='cards'?'Pokédex':'Special Collection')+' · '+copies+(copies===1?' copy':' copies')));
        const amount=node('span',null,'value-card-amount');
        amount.append(node('strong',quote?money(quote.value):'No price'));
        if(quote) amount.append(node('small',quote.source || 'Saved value'));
        item.append(photo(card.image,'No image'),details,amount);list.append(item);
      }
      if(!rows.length) list.append(node('p','No cards match these filters.','note'));
      more.hidden=rows.length<=listLimit;
    }
    for(const [key,input] of Object.entries(inputs)) input.addEventListener(key==='search'?'input':'change',()=>{
      filters[key]=input.value;listLimit=60;draw();
    });
    browser.append(fields,reset,count,list,more);container.append(browser,controls);
    bind(browser,draw);
  }
  return {cardPrice,summary,renderValue,refresh,reset:()=>{bindings=[];}};
}

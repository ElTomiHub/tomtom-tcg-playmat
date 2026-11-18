(() => {
  'use strict';

  const api = 'https://api.tcgdex.net/v2/';
  const ocrScript = 'https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/tesseract.min.js';
  const setKey = value => String(value || '').normalize('NFKC').trim().toUpperCase();
  const cardNumber = value => String(value || '').normalize('NFKC').trim().split('/')[0].trim().toUpperCase()
    .replace(/^([A-Z-]*)0+(?=\d)/,'$1');
  const referencePattern = /^[A-Z0-9]{1,16}(?:[-.][A-Z0-9]{1,12})?$/i;
  const variantKey = value => String(value || '').trim().toLowerCase().replace(/[ _]+/g,'-').replace(/^normal-silver$/,'normal');
  const printSet = (card, fallback) => card.set?.abbreviation?.official || fallback || card.set?.id || '';
  const jpText = /[\u3040-\u30ff\u3400-\u9fff]/;
  const scanNumber = value => value.replace(/^O(?=\d{2}\/\d)/i,'0');
  const formWords = {
    ja:{'アローラ':'alolan','ガラル':'galarian','ヒスイ':'hisuian','パルデア':'paldean',
      'かまどのめん':'hearthflame-mask','いどのめん':'wellspring-mask','いしずえのめん':'cornerstone-mask'},
    en:{Alolan:'alolan',Galarian:'galarian',Hisuian:'hisuian',Paldean:'paldean',
      'Hearthflame Mask':'hearthflame-mask','Wellspring Mask':'wellspring-mask','Cornerstone Mask':'cornerstone-mask'},
    fr:{'d’Alola':'alolan',"d'Alola":'alolan', 'de Galar':'galarian','de Hisui':'hisuian','de Paldea':'paldean'}
  };

  function printIdentity(card, language, code, names = []) {
    const dex = (card.dexId || []).find(value=>Number.isInteger(value) && value>0 && value<=1025);
    const guessedName = readCardName([card.name || ''],names,language);
    const id = dex || (/^pok[eé]mon$/i.test(card.category || '') && guessedName ?
      names.findIndex(row=>row[{en:0,fr:1,ja:2}[language]]===guessedName)+1 : 0);
    const form = Object.entries(formWords[language] || {}).find(([word]) => card.name?.toLowerCase().includes(word.toLowerCase()))?.[1];
    const formKey = id === 128 && form === 'paldean' ?
      ({Fighting:'paldean-combat',Fire:'paldean-blaze',Water:'paldean-aqua'}[card.types?.[0]] || form) : form;
    const number = card.localId;
    const total = card.set?.cardCount?.official;
    return {language,speciesId:id,pokemonKey:id ? [id,formKey].filter(Boolean).join('-') : '',set:code,number,
      printedNumber:/^\d+$/.test(number) && total ? number+'/'+total : number};
  }

  function availableVariants(card) {
    if (/^(?:special |shiny )?illustration rare$|^(?:special )?art rare$/i.test(card.rarity || '')) return ['illustration-rare'];
    const variants = new Set();
    for (const finish of card.variants_detailed || []) {
      if (finish.size && finish.size !== 'standard') continue;
      if (finish.type === 'reverse') {
        const foil = String(finish.foil || '').toLowerCase();
        variants.add(foil.includes('masterball') ? 'masterball-reverse-holo' :
          foil.includes('pokeball') ? 'pokeball-reverse-holo' : foil.includes('energy') ? 'energy-reverse-holo' : 'reverse-holo');
      } else if (finish.type === 'normal' || finish.type === 'holo') variants.add(finish.type);
      else if (finish.type) variants.add('special');
    }
    if (!variants.size) {
      if (card.variants?.normal) variants.add('normal');
      if (card.variants?.holo) variants.add('holo');
      if (card.variants?.reverse) variants.add('reverse-holo');
      if (card.variants?.firstEdition || card.variants?.wPromo) variants.add('special');
    }
    return [...variants];
  }

  function checkCollection(cards, identity, variant, setAliases = []) {
    const aliases = new Set([identity.set,...setAliases].map(setKey));
    const sameSpecies = cards.filter(card => identity.pokemonKey && (card.pokemonKey || String(card.pokemonId)) === identity.pokemonKey);
    const languageOf = card => card.language || /^https:\/\/assets\.tcgdex\.net\/(en|ja|fr)\//i.exec(card.image)?.[1] ||
      ({JP:'ja',EN:'en',FR:'fr'}[/_R_(JP|EN|FR)_/.exec(card.image)?.[1]]);
    const samePrint = sameSpecies.filter(card => aliases.has(setKey(card.set)) &&
      cardNumber(card.number) === cardNumber(identity.number) && (!languageOf(card) || languageOf(card) === identity.language));
    const sameFinish = variant ? samePrint.filter(card => variantKey(card.variant) === variantKey(variant)) : [];
    const exact = sameFinish.filter(card => identity.language === 'ja' || languageOf(card) === identity.language);
    return {sameSpecies,samePrint,exact,unknownLanguage:sameFinish.length-exact.length};
  }

  function readPrintedClues(body, setCodes, speciesNames, language) {
    const normalized = body.normalize('NFKC');
    const rows = normalized.split(/\r?\n/).map(row=>row.trim()).filter(Boolean);
    const lang = language || (jpText.test(normalized) ? 'ja' : 'en');
    const known = new Set(setCodes.map(setKey));
    const pair = /(?:^|\s)([A-Z0-9]{1,5}\d[A-Z0-9.-]{0,12}|[A-Z]{2,6})\s+(?:(?:EN|FR|JP)\s+)?([A-Z]{0,4}\d{1,4})\s*\/\s*(\d{1,4})(?!\d)/ig;
    for (const row of rows) {
      for (const match of row.matchAll(pair)) {
        if (known.has(setKey(match[1])) || /\d/.test(match[1]))
          return {language:lang,set:setKey(match[1]),number:scanNumber(match[2]+'/'+match[3]),name:readCardName(rows,speciesNames,lang)};
      }
    }
    const footer = rows.slice(-7).join(' ');
    const ratio = footer.match(/\b([A-Z]{0,4}\d{1,4})\s*\/\s*(\d{1,4})\b/i);
    const code = [...footer.matchAll(/\b[A-Z0-9][A-Z0-9.-]{1,15}\b/ig)]
      .map(match=>setKey(match[0])).find(token=>known.has(token));
    const solo = code && footer.match(new RegExp('(?:^|\\s)'+code.replace('.', '\\.')+'\\s+(?:(?:JP|EN|FR)\\s+)?([A-Z]*\\d{1,4})(?=\\s|$)','i'));
    return {language:lang,set:code || '',number:ratio ? scanNumber(ratio[1]+'/'+ratio[2]) : solo?.[1] || '',
      name:readCardName(rows,speciesNames,lang)};
  }

  function readCardName(rows, names, language) {
    const index = {en:0,fr:1,ja:2}[language];
    const header = rows.slice(0,5).join(' ').toLowerCase();
    return names.map(row=>row[index]).filter(name => name && (language === 'ja' ?
      header.replace(/\s/g,'').includes(name) : (' '+header.replace(/[^\p{L}\p{N}'’-]/gu,' ')+' ').includes(' '+name.toLowerCase()+' ')))
      .sort((a,b)=>b.length-a.length)[0] || '';
  }

  function limitlessLink(language, set, number) {
    if (!referencePattern.test(set) || !/^[A-Z0-9-]{1,16}$/i.test(cardNumber(number))) return '';
    const route = language === 'ja' ? 'jp/' : language === 'fr' ? 'fr/' : 'en/';
    return 'https://limitlesstcg.com/cards/'+route+encodeURIComponent(set)+'/'+encodeURIComponent(cardNumber(number))+
      (language === 'ja' ? '?translate=en' : '');
  }

  const limitlessImage = (language,set,number) => {
    if (language === 'fr' || !limitlessLink(language,set,number)) return '';
    const folder = language === 'ja' ? 'tpc' : 'tpci';
    return 'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/'+folder+'/'+set+'/'+set+'_'+cardNumber(number)+'_R_'+
      (language === 'ja' ? 'JP' : 'EN')+'_LG.png';
  };

  function makeCatalog(fetcher) {
    const requests = new Map();
    function get(language,path) {
      const url = api+language+path;
      if (!requests.has(url)) requests.set(url,fetcher(url,{signal:AbortSignal.timeout(9000)})
        .then(response => {
          if (response.status === 404) return null;
          if (!response.ok) throw new Error('Card database is temporarily unavailable.');
          return response.json();
        }).catch(error=>{requests.delete(url); throw error;}));
      return requests.get(url);
    }
    async function byId(language,id) { return get(language,'/cards/'+encodeURIComponent(id)); }
    async function lookup({language,set,number,name,insistSet}) {
      const expected = cardNumber(number);
      if (!expected || !/^[A-Z0-9-]{1,16}$/i.test(expected)) return [];
      const total = Number(String(number).normalize('NFKC').split('/')[1]);
      const valid = card => card && (!total || !card.set?.cardCount?.official || card.set.cardCount.official===total);
      if (set) {
        if (!referencePattern.test(set)) return [];
        const aliases = language === 'ja' ? [] : await get(language,'/sets?abbreviation.official=eq:'+encodeURIComponent(set));
        const setIds = [...new Set([set,...(aliases || []).map(s=>s.id)])];
        const results = await Promise.all(setIds.map(id=>get(language,'/sets/'+encodeURIComponent(id)+'/'+encodeURIComponent(expected))));
        const exact = results.filter(card=>valid(card) && cardNumber(card.localId)===expected);
        if (exact.length) return [...new Map(exact.map(card=>[card.id,{card,code:printSet(card,language === 'ja' ? '' : set)}])).values()];
        if (insistSet) return [];
      }
      if (name) {
        const candidates = await get(language,'/cards?name=like:'+encodeURIComponent(name));
        const matches = (candidates || []).filter(card=>cardNumber(card.localId)===expected);
        const exact = (await Promise.all(matches.slice(0,12).map(card=>byId(language,card.id)))).filter(valid);
        if (exact.length) return exact.map(card=>({card,code:printSet(card)}));
      }
      if (!total) return [];
      const sets = (await get(language,'/sets') || []).filter(entry=>entry.cardCount?.official===total);
      if (sets.length > 12) return [];
      const possible = await Promise.all(sets.map(entry=>get(language,'/sets/'+encodeURIComponent(entry.id)+'/'+encodeURIComponent(expected))));
      return possible.filter(card=>valid(card) && cardNumber(card.localId)===expected)
        .map(card=>({card,code:printSet(card)}));
    }
    return {byId,lookup,sets:language=>get(language,'/sets'),
      setDetails:(language,id)=>id ? get(language,'/sets/'+encodeURIComponent(id)) : Promise.resolve(null)};
  }

  function cameraCrop(width,height,viewport,frame) {
    const scale = Math.max(viewport.width/width,viewport.height/height);
    const offsetX = (width*scale-viewport.width)/2;
    const offsetY = (height*scale-viewport.height)/2;
    const padding = frame.width*.06;
    const left = Math.max(0,(frame.left-viewport.left+offsetX-padding)/scale);
    const top = Math.max(0,(frame.top-viewport.top+offsetY-padding)/scale);
    const right = Math.min(width,(frame.right-viewport.left+offsetX+padding)/scale);
    const bottom = Math.min(height,(frame.bottom-viewport.top+offsetY+padding)/scale);
    return {left,top,width:right-left,height:bottom-top};
  }

  async function resolveScannerPrints(catalog,fields) {
    const locales = ['en','fr','ja'];
    const japaneseSet = /^(?:SV|SM|S|M|XY|BW)\d+[A-Z]*$|^(?:SV|S|SM)-P$/i;
    const preferred = fields.language || (jpText.test(fields.name) || japaneseSet.test(fields.set) ? 'ja' : '');
    const lookup = async language => (await catalog.lookup({...fields,language})).map(match=>({...match,language}));
    const failures = [];
    if (preferred) {
      const matches = await lookup(preferred).catch(error=>{failures.push(error); return [];});
      if (matches.length) return matches;
    }
    const retries = locales.filter(language=>language!==preferred);
    const results = await Promise.allSettled(retries.map(lookup));
    const matches = results.flatMap(result=>result.status==='fulfilled' ? result.value : []);
    const query = String(fields.name || '').normalize('NFKC').toLowerCase();
    const named = matches.filter(match=>match.card.name?.normalize('NFKC').toLowerCase().includes(query));
    if (named.length) return named;
    if (!matches.length && failures.length+results.filter(result=>result.status==='rejected').length===locales.length)
      throw failures[0] || results[0].reason;
    return matches;
  }

  if (typeof module === 'object' && module.exports) {
    module.exports = {printIdentity,checkCollection,availableVariants,readPrintedClues,cardNumber,makeCatalog,limitlessLink,cameraCrop,resolveScannerPrints};
    return;
  }

  function element(tag, text, className) {
    const item = document.createElement(tag);
    if (text != null) item.textContent = text;
    if (className) item.className = className;
    return item;
  }

  function action(label, handler, className) {
    const button = element('button',label,className);
    button.type = 'button';
    button.addEventListener('click',handler);
    return button;
  }

  let loadingOcr;
  function loadOcr() {
    if (window.Tesseract) return Promise.resolve(window.Tesseract);
    if (!loadingOcr) loadingOcr = new Promise((resolve,reject) => {
      const script = element('script');
      script.src = ocrScript;
      script.integrity = 'sha384-r1ru3tcf6FhnCFR4B7pIFG+BhFF9LlFtz/P1y4pblWn3AGs9y3lBx5SKLNf4+rED';
      script.crossOrigin = 'anonymous';
      script.addEventListener('load',()=>resolve(window.Tesseract),{once:true});
      script.addEventListener('error',()=>reject(new Error('Could not load photo recognition. Enter the set and number below.')),{once:true});
      document.head.append(script);
    }).catch(error=>{loadingOcr=null; throw error;});
    return loadingOcr;
  }

  async function photoCanvas(file) {
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      const scale = Math.min(1,1800/Math.max(image.naturalWidth,image.naturalHeight));
      const canvas = element('canvas');
      canvas.width = Math.max(1,Math.round(image.naturalWidth*scale));
      canvas.height = Math.max(1,Math.round(image.naturalHeight*scale));
      canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
      return canvas;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function translationFromHtml(html, url) {
    if (!html || !url) return null;
    const template = element('template');
    template.innerHTML = html;
    const title = template.content.querySelector('.card-text-name a');
    if (!title) return null;
    const expected = new URL(url);
    const actual = new URL(title.getAttribute('href'),expected.origin);
    if (actual.origin !== expected.origin || actual.pathname.toLowerCase() !== expected.pathname.toLowerCase() || jpText.test(title.textContent)) return null;
    const skills = kind => [...template.content.querySelectorAll('.card-text-'+kind)].map(section => ({
      name:section.querySelector('.card-text-'+kind+'-info')?.textContent.trim().replace(/\s+/g,' '),
      effect:section.querySelector('.card-text-'+kind+'-effect')?.textContent.trim()
    }));
    const attacks = skills('attack'), abilities = skills('ability');
    const effect = [...template.content.querySelectorAll('.card-text-section > p:not([class])')]
      .map(paragraph=>paragraph.textContent.trim()).filter(Boolean).join('\n');
    return {name:title.textContent.trim(),attacks,abilities,effect};
  }

  function mountPokedexScanner({cards, savedPrints, speciesNames, displayVariant, openAdd}) {
    const el = id => document.getElementById(id);
    const dialog = el('scanner');
    const form = el('scannerLookup');
    const state = el('scannerStatus');
    const candidates = el('scannerCandidates'), result = el('scannerResult');
    const lookup = makeCatalog(window.fetch.bind(window));
    const video = el('scannerVideo'), camera = el('scannerPreview'), take = el('scannerTake');
    const torch = el('scannerTorch'), start = el('scannerStart'), manual = el('scannerManual');
    let client, request = 0, previewUrl = '', cameraVersion = 0, stream, nativeCapture = false;
    try {
      client = createLibrarySyncClient({...playmatSyncConfig,storage:localStorage,
        fetcher:(url,options)=>fetch(url,{...options,signal:AbortSignal.timeout(7500)})});
    } catch { /* Lookup remains available without Playmat sync. */ }

    function clearPhoto() {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = '';
      const image = el('scannerPhoto');
      image.removeAttribute('src');
      image.hidden = true;
    }

    function setManual(open) {
      form.hidden = !open;
      manual.setAttribute('aria-expanded',String(open));
    }

    function stopCamera() {
      cameraVersion++;
      stream?.getTracks().forEach(track=>track.stop());
      stream = null;
      video.srcObject = null;
      camera.hidden = true;
      torch.hidden = true;
      torch.disabled = false;
      torch.setAttribute('aria-pressed','false');
      take.hidden = true;
      take.disabled = true;
      nativeCapture = false;
      start.hidden = false;
    }

    async function startCamera() {
      request++;
      stopCamera();
      clearPhoto();
      candidates.replaceChildren();
      result.replaceChildren();
      setManual(false);
      const job = cameraVersion;
      start.hidden = true;
      camera.hidden = false;
      take.hidden = false;
      state.textContent = 'Opening camera…';
      try {
        const media = await navigator.mediaDevices.getUserMedia({
          audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1440}}
        });
        if (!dialog.open || cameraVersion !== job) {
          media.getTracks().forEach(track=>track.stop());
          return;
        }
        stream = media;
        video.srcObject = stream;
        await video.play();
        if (cameraVersion !== job) return;
        const track = stream.getVideoTracks()[0];
        const capability = track?.getCapabilities?.().torch;
        torch.hidden = capability !== true && !(Array.isArray(capability) && capability.includes(true));
        take.disabled = false;
        state.textContent = 'Line up one card in the frame, then take the photo.';
        track?.addEventListener('ended',()=>{
          if (cameraVersion !== job) return;
          stopCamera();
          state.textContent = 'The camera stopped. You can open it again or enter the card manually.';
        },{once:true});
      } catch {
        if (cameraVersion !== job) return;
        stopCamera();
        nativeCapture = true;
        take.hidden = false;
        take.disabled = false;
        state.textContent = 'Live camera unavailable. Take a photo with your device, choose an image, or enter the card manually.';
      }
    }

    function registerManually() {
      const fields = Object.fromEntries(new FormData(form));
      dialog.close();
      openAdd({name:fields.name.trim(),set:fields.set.trim(),number:fields.number.trim()});
    }

    el('openScanner').addEventListener('click',()=>{
      if (dialog.open) return;
      form.reset();
      dialog.showModal();
      void startCamera();
    });
    el('closeScanner').addEventListener('click',()=>dialog.close());
    dialog.addEventListener('close',()=>{request++; stopCamera(); clearPhoto();});
    window.addEventListener('pagehide',stopCamera);
    document.addEventListener('visibilitychange',()=>{
      if (!document.hidden || !dialog.open || camera.hidden) return;
      stopCamera();
      state.textContent = 'Camera paused. Open it again to continue.';
    });
    start.addEventListener('click',startCamera);
    manual.addEventListener('click',()=>{
      if (!form.hidden) { setManual(false); return; }
      request++;
      stopCamera();
      setManual(true);
      state.textContent = '';
      form.elements.set.focus();
    });
    el('scannerRegister').addEventListener('click',registerManually);
    torch.addEventListener('click',async ()=>{
      const track = stream?.getVideoTracks()[0];
      if (!track) return;
      const enabled = torch.getAttribute('aria-pressed') !== 'true';
      const job = cameraVersion;
      torch.disabled = true;
      try {
        await track.applyConstraints({advanced:[{torch:enabled}]});
        if (cameraVersion === job) torch.setAttribute('aria-pressed',String(track.getSettings?.().torch ?? enabled));
      } catch {
        if (cameraVersion === job) state.textContent = 'The flashlight could not be changed.';
      } finally {
        if (cameraVersion === job) torch.disabled = false;
      }
    });

    take.addEventListener('click',async ()=>{
      if (nativeCapture) { el('scannerCamera').click(); return; }
      if (!stream || !video.videoWidth || !video.videoHeight) return;
      const job = cameraVersion;
      const crop = cameraCrop(video.videoWidth,video.videoHeight,video.getBoundingClientRect(),el('scannerFrame').getBoundingClientRect());
      const canvas = element('canvas');
      canvas.width = Math.round(crop.width);
      canvas.height = Math.round(crop.height);
      canvas.getContext('2d').drawImage(video,crop.left,crop.top,crop.width,crop.height,0,0,canvas.width,canvas.height);
      take.disabled = true;
      const photo = await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.94));
      if (cameraVersion !== job) return;
      if (photo) await scan(photo);
      else {
        take.disabled = false;
        state.textContent = 'The camera could not save that frame. Try again.';
      }
    });
    el('scannerChoose').addEventListener('click',()=>el('scannerFile').click());
    for (const id of ['scannerCamera','scannerFile']) {
      el(id).addEventListener('change',event=>{
        const file = event.target.files[0];
        event.target.value = '';
        if (file) void scan(file);
      });
    }

    async function scan(file) {
      const job = ++request;
      stopCamera();
      form.reset();
      setManual(false);
      result.replaceChildren();
      candidates.replaceChildren();
      clearPhoto();
      if (!file.type.startsWith('image/') || file.size>25000000) {
        state.textContent = 'Choose a photo under 25 MB.';
        return;
      }
      previewUrl = URL.createObjectURL(file);
      el('scannerPhoto').src = previewUrl;
      el('scannerPhoto').hidden = false;
      state.textContent = 'Loading photo recognition…';
      let worker;
      try {
        const [canvas,tesseract] = await Promise.all([photoCanvas(file),loadOcr()]);
        if (job !== request) return;
        worker = await tesseract.createWorker('jpn+eng',1,{logger:event=>{
          if (job === request && event.status === 'recognizing text') state.textContent = 'Reading the card…';
        }});
        await worker.setParameters({tessedit_pageseg_mode:tesseract.PSM.SPARSE_TEXT});
        const {data} = await worker.recognize(canvas,{rotateAuto:true});
        const language = jpText.test(data.text) ? 'ja' :
          /\bPV\s*\d{2,3}\b|\b\d{2,3}\s*PV\b|\bFR\s+\d{1,4}\s*\//i.test(data.text) ? 'fr' : 'en';
        const sets = await lookup.sets(language).catch(()=>[]);
        const codes = [...(sets || []).map(set=>set.id),'MEG','PFL','ASC','POR','PAF','PAL','SVI','OBF','PAR','TEF','TWM','SFA','SCR','SSP','JTG','DRI','BLK','WHT','PRE','CRZ','SIT','LOR','ASR','BRS','FST','EVS','CRE','BST','VIV','DAA'];
        let clues = readPrintedClues(data.text,codes,speciesNames,language);
        if (!clues.set || !clues.number) {
          const top = Math.round(canvas.height*.76);
          const footer = await worker.recognize(canvas,{rectangle:{left:0,top,width:canvas.width,height:canvas.height-top}});
          const footerClues = readPrintedClues(data.text+'\n'+footer.data.text,codes,speciesNames,language);
          clues = {...footerClues,name:clues.name || footerClues.name};
        }
        if (job !== request) return;
        for (const key of ['set','number','name']) form.elements[key].value = clues[key];
        if (clues.number && (clues.set || clues.name || clues.number.includes('/'))) await find(clues,job);
        else {
          setManual(true);
          state.textContent = 'Check the detected text and enter the set code and collector number on the card.';
        }
      } catch (error) {
        if (job === request) {
          setManual(true);
          state.textContent = (error?.message || 'Could not read this photo.')+' You can look up the print manually.';
        }
      } finally {
        if (worker) await worker.terminate().catch(()=>{});
      }
    }

    form.addEventListener('submit',event=>{
      event.preventDefault();
      const fields = Object.fromEntries(new FormData(form));
      fields.set = fields.set.trim();
      fields.name = fields.name.trim();
      stopCamera();
      void find({...fields,insistSet:true},++request);
    });

    async function find(fields, job) {
      state.textContent = 'Looking up the card…';
      result.replaceChildren();
      candidates.replaceChildren();
      try {
        const matches = await resolveScannerPrints(lookup,fields);
        if (job !== request) return;
        if (!matches.length) {
          setManual(true);
          state.textContent = 'No exact print found. Check the set code and collector number.';
          return;
        }
        if (matches.length === 1) {
          await showResult(matches[0],matches[0].language,job);
          return;
        }
        state.textContent = 'Choose the print that matches your card.';
        for (const match of matches) {
          candidates.append(action([match.card.name,match.code,match.card.localId,{en:'English',fr:'French',ja:'Japanese'}[match.language]].join(' · '),()=>{
            void showResult(match,match.language,++request);
          }));
        }
      } catch (error) {
        if (job === request) {
          setManual(true);
          state.textContent = error?.message || 'Could not look up this card.';
        }
      }
    }

    async function showResult(match, language, job) {
      const {card} = match;
      const setDetails = await lookup.setDetails(language,card.set?.id).catch(()=>null);
      if (job !== request) return;
      const code = setDetails?.abbreviation?.official || match.code;
      const identity = printIdentity(card,language,code,speciesNames);
      form.elements.set.value = code;
      form.elements.number.value = identity.printedNumber;
      const link = limitlessLink(language,code,identity.number);
      const catalogArt = /^https:\/\/assets\.tcgdex\.net\//.test(card.image || '') ? card.image+'/high.webp' : '';
      const fallbackArt = limitlessImage(language,code,identity.number);
      let art = catalogArt || fallbackArt;
      const panel = element('section',null,'scan-card');
      if (art) {
        const image = element('img');
        image.alt = card.name+' catalog artwork';
        image.src = art;
        image.referrerPolicy = 'no-referrer';
        image.addEventListener('error',()=>{
          if (fallbackArt && image.src !== fallbackArt) {
            art = fallbackArt;
            image.src = fallbackArt;
          } else {
            art = '';
            image.replaceWith(element('p','Catalog image unavailable.','note'));
          }
        });
        panel.append(image);
      } else panel.append(element('p','Catalog image unavailable.','note'));
      const content = element('div',null,'scan-info');
      const name = element('h3',card.name);
      const metadata = element('p',[code,identity.printedNumber,card.set?.name,card.rarity].filter(Boolean).join(' · '),'note');
      const variantLabel = element('label','Variant');
      const variant = element('select');
      variantLabel.append(variant);
      const finishes = availableVariants(card);
      const allFinishes = ['normal','holo','reverse-holo','pokeball-reverse-holo','masterball-reverse-holo','energy-reverse-holo','illustration-rare','special'];
      const options = [...new Set([...finishes,...allFinishes])];
      const missing = element('option','Confirm the finish');
      missing.value = '';
      variant.append(missing);
      for (const value of options) {
        const option = element('option',displayVariant(value));
        option.value = value;
        variant.append(option);
      }
      if (finishes.length === 1) variant.value = finishes[0];
      const collection = element('p',null,'scan-ownership');
      collection.setAttribute('aria-live','polite');
      const add = action('Add to Pokédex',()=>{
        dialog.close();
        openAdd({name:name.textContent,language,set:code,number:identity.printedNumber,variant:variant.value,image:art,
          pokemonId:identity.speciesId,pokemonKey:identity.pokemonKey});
      },'primary');
      const refreshOwnership = () => {
        const found = checkCollection(cards(),identity,variant.value,[card.set?.id]);
        collection.textContent = !identity.pokemonKey ? 'No Pokédex species is linked to this print.' :
          found.exact.length ? 'In your Pokédex · '+found.exact.length+' exact '+(found.exact.length===1?'copy':'copies') :
          found.unknownLanguage ? 'Matching set, number and finish in your Pokédex. The saved card has no language recorded.' :
          found.samePrint.length && !variant.value ? 'This print is in your Pokédex. Confirm the finish to check exact ownership.' :
          found.samePrint.length ? 'You own this print in another finish.' :
          found.sameSpecies.length ? 'You own a different print of this Pokémon.' : 'This Pokémon is missing from your Pokédex.';
        add.disabled = !variant.value || !identity.speciesId;
      };
      variant.addEventListener('change',refreshOwnership);
      refreshOwnership();
      const translation = element('section',null,'scan-translation');
      content.append(name,metadata,variantLabel,collection,add,translation);
      if (link) {
        const source = element('a',language==='ja'?'English card text on Limitless':'View print on Limitless');
        source.href = link;
        source.target = '_blank';
        source.rel = 'noopener noreferrer';
        content.append(source);
      }
      panel.append(content);
      candidates.replaceChildren();
      result.replaceChildren(panel);
      state.textContent = 'Review the print and finish.';
      const fallbackName = identity.speciesId && speciesNames[identity.speciesId-1]?.[0];
      const originalName = card.name;
      async function loadEnglish() {
        if (language === 'en') return {data:card,label:'English card text · TCGdex'};
        if (language === 'fr') {
          const data = await lookup.byId('en',card.id).catch(()=>null);
          if (data?.id === card.id && cardNumber(data.localId) === cardNumber(card.localId))
            return {data,label:'English card text · TCGdex'};
        }
        const verified = savedPrints().find(row => row?.language === language && setKey(row.setCode) === setKey(code) &&
          cardNumber(row.cardNumber) === cardNumber(card.localId) && row.name && !jpText.test(row.name) &&
          /limitless/i.test([row.source,row.meta?.source,row.meta?.translationSource,row.meta?.sourceUrl].filter(Boolean).join(' ')) &&
          (row.meta?.textLanguage === 'en' || row.meta?.translationStatus === 'translated'));
        if (verified) return {data:{...verified.meta,name:verified.name},label:'English translation · Playmat library'};
        if (language === 'ja' && client?.getSession() && link) {
          const html = await client.scanTranslation(code,cardNumber(card.localId)).catch(()=>null);
          const data = translationFromHtml(html,link);
          if (data) return {data,label:'English translation · Limitless'};
        }
        return null;
      }
      if (language !== 'en' && fallbackName) name.textContent = fallbackName;
      translation.append(element('p','Checking English card text…','note'));
      let english;
      try { english = await loadEnglish(); } catch { /* The source link remains available. */ }
      if (job !== request) return;
      const localized = english?.data || card;
      name.textContent = english?.data.name || fallbackName || originalName;
      translation.replaceChildren(element('h4',english?.label || 'Original card text'));
      if (language !== 'en') translation.append(element('p',originalName,'note'));
      if (!english) translation.append(element('p',language==='ja' ?
        'Open the Limitless link below for English. Inline translations use your Playmat sign-in and the scanner translation setup.' :
        'An English version of this print is unavailable.','note'));
      for (const [section,items] of [['Abilities',localized.abilities],['Attacks',localized.attacks]]) {
        if (!items?.length) continue;
        translation.append(element('h5',section));
        for (const skill of items) {
          const row = element('div',null,'scan-skill');
          row.append(element('strong',[skill.name,skill.damage].filter(Boolean).join(' · ')));
          if (skill.effect) row.append(element('p',skill.effect));
          translation.append(row);
        }
      }
      if (localized.effect) translation.append(element('p',localized.effect));
    }
  }

  window.mountPokedexScanner = mountPokedexScanner;
})();

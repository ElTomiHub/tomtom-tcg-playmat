(() => {
  'use strict';

  const api = 'https://api.tcgdex.net/v2/';
  const ocrScript = 'https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/tesseract.min.js';
  const setKey = value => String(value || '').normalize('NFKC').trim().toUpperCase();
  const cardNumber = value => String(value || '').normalize('NFKC').trim().split('/')[0].trim().toUpperCase()
    .replace(/^([A-Z-]*)0+(?=\d)/,'$1');
  const referencePattern = /^[A-Z0-9]{1,16}(?:[-.][A-Z0-9]{1,12})?$/i;
  const variantKey = value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
    .trim().toLowerCase().replace(/[ _]+/g,'-').replace(/^(poke|master)-ball-/,'$1ball-').replace(/^normal-silver$/,'normal');
  const printSet = (card, fallback) => card.set?.abbreviation?.official || fallback || card.set?.id || '';
  const jpText = /[\u3040-\u30ff\u3400-\u9fff]/;
  const numericOcr = value => value.toUpperCase().replace(/[OQ]/g,'0').replace(/[IL]/g,'1')
    .replace(/S/g,'5').replace(/B/g,'8').replace(/Z/g,'2');
  const printedCollector = value => {
    const text = value.toUpperCase();
    // Gallery and promo prefixes are part of the number. Repair only plausible numeric runs.
    if (/^[0-9OQILSBZ]{1,4}$/.test(text) && /\d/.test(text)) return numericOcr(text);
    const match = text.match(/^([A-Z]{2,4})([0-9OQILSBZ]{1,4})$/);
    if (!match || !/\d/.test(match[2])) return text;
    return (match[1] || '')+numericOcr(match[2]);
  };
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

  function catalogFinish(finish) {
    if (finish.size && finish.size !== 'standard') return '';
    if (finish.type === 'reverse') {
      const foil = String(finish.foil || '').toLowerCase();
      return foil.includes('masterball') ? 'masterball-reverse-holo' :
        foil.includes('pokeball') ? 'pokeball-reverse-holo' : foil.includes('energy') ? 'energy-reverse-holo' : 'reverse-holo';
    }
    if (finish.type === 'normal' || finish.type === 'holo') return finish.type;
    return finish.type ? 'special' : '';
  }

  function variantClue(text) {
    const value = String(text || '').normalize('NFKC').toLowerCase().replace(/[_-]+/g,' ');
    if (/master\s*ball\s*(?:pattern|mirror|reverse)|マスターボールミラー/.test(value)) return 'masterball-reverse-holo';
    if (/pok[eé]\s*ball\s*(?:pattern|mirror|reverse)|モンスターボールミラー/.test(value)) return 'pokeball-reverse-holo';
    if (/energy\s*(?:pattern|reverse)|エネルギーミラー/.test(value)) return 'energy-reverse-holo';
    if (/illustration rare|(?:special )?art rare/.test(value)) return 'illustration-rare';
    if (/reverse holo|mirror foil|ミラー仕様/.test(value)) return 'reverse-holo';
    if (/non\s*holo|normal finish/.test(value)) return 'normal';
    if (/holofoil|holo finish/.test(value)) return 'holo';
    return '';
  }

  function httpsImage(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
    } catch { return ''; }
  }

  function imageUrl(value) {
    const url = httpsImage(value);
    return url.startsWith('https://assets.tcgdex.net/') && !/\.(?:png|jpe?g|webp)(?:\?|$)/i.test(url) ?
      url.replace(/\/$/,'')+'/high.webp' : url;
  }

  function variantArtwork(card, variant, samePrint, baseUrls) {
    if (!variant) return [];
    const entries = card.variants_detailed || [];
    const catalog = entries.filter(finish=>catalogFinish(finish)===variant)
      .map(finish=>imageUrl(finish.image)).filter(Boolean);
    const collection = samePrint.filter(row=>variantKey(row.variant)===variant)
      .map(row=>imageUrl(row.image)).filter(url=>url && !baseUrls.includes(url));
    const found = [...new Set([...catalog,...collection])];
    return found.map(url=>({url,label:catalog.includes(url) ? 'Selected variant · catalog' : 'Selected variant · collection photo'}));
  }

  function selectVisualVariant(sampleByCrop, references, complete = true) {
    if (references.length<2 || !sampleByCrop.length) return '';
    // Require both a close match and visible separation from the other finishes.
    const distance = (a,b) => a.reduce((total,pixel,index)=>total+Math.abs(pixel-b[index]),0)/a.length;
    const scores = references.map(ref=>({variant:ref.variant,
      score:Math.min(...sampleByCrop.map(sample=>distance(sample,ref.pixels)))})).sort((a,b)=>a.score-b.score);
    const [best,runnerUp] = scores;
    const closeEnough = complete ? best.score<=6 : best.variant!=='normal' && best.score<=2;
    return closeEnough && runnerUp.score-best.score>=2.5 ? best.variant : '';
  }

  function availableVariants(card) {
    if (/^(?:special |shiny )?illustration rare$|^(?:special )?art rare$/i.test(card.rarity || '')) return ['illustration-rare'];
    const variants = new Set();
    for (const finish of card.variants_detailed || []) {
      const key = catalogFinish(finish);
      if (key) variants.add(key);
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
    const normalized = body.normalize('NFKC').replace(/[∕⁄]/g,'/');
    const rows = normalized.split(/\r?\n/).map(row=>row.trim()).filter(Boolean);
    const lang = language || (jpText.test(normalized) ? 'ja' : 'en');
    const known = new Set(setCodes.map(setKey));
    const footer = rows.slice(-14).join(' ');
    const name = readCardName(rows,speciesNames,lang);
    const build = (set,number) => ({language:lang,set,number,name});
    const ratios = [...footer.matchAll(/\b([A-Z0-9]{1,8})\s*\/\s*([A-Z0-9]{1,8})\b/ig)];
    const references = ratios.flatMap(match => {
      if (!/\d/.test(match[1]) || !/\d/.test(match[2])) return [];
      const before = footer.slice(0,match.index).replace(/\b(?:EN|FR|JP)\s*$/i,'').trim();
      const tokens = before.match(/[A-Z0-9.-]+/ig)?.slice(-4) || [];
      const possible = tokens.map((_,index)=>setKey(tokens.slice(index).join(''))).reverse();
      const set = possible.find(value=>known.has(value)) || possible.find(value=>/^(?:SV|SM|S|M|XY|BW)\d{1,2}[A-Z]{0,2}$/.test(value)) || '';
      const number = printedCollector(match[1]), total = printedCollector(match[2]);
      if (!/^[A-Z]{0,4}\d{1,4}$/.test(number) || !/^[A-Z]{0,4}\d{1,4}$/.test(total)) return [];
      return [build(set,number+'/'+total)];
    });
    if (references.length) return references.find(reference=>reference.set) || references[0];

    const standalone = footer.matchAll(/\b([A-Z0-9.-]{2,16})\s+(?:(?:JP|EN|FR)\s+)?([A-Z]{0,4}\d{1,4})(?!\s*\/)\b/ig);
    for (const match of standalone) {
      const set = setKey(match[1]);
      if (known.has(set)) return build(set,match[2].toUpperCase());
    }
    return build('','');
  }

  function readCardName(rows, names, language) {
    const index = {en:0,fr:1,ja:2}[language];
    const header = rows.slice(0,8).join(' ').toLowerCase();
    const candidates = names.map(row=>row[index]).filter(Boolean);
    const longest = values => values.sort((a,b)=>b.length-a.length)[0] || '';
    if (language === 'ja') {
      const compact = header.replace(/\s/g,'');
      const exact = longest(candidates.filter(name=>compact.includes(name)));
      if (exact) return exact;
      const unmarked = value => value.normalize('NFKD').replace(/[\u3099\u309a]/g,'');
      const loose = unmarked(compact);
      const similar = candidates.filter(name=>name.length>=4 && loose.includes(unmarked(name)));
      if (similar.length===1) return similar[0];
      return '';
    }
    const words = ' '+header.replace(/[^\p{L}\p{N}'’-]/gu,' ')+' ';
    return longest(candidates.filter(name=>words.includes(' '+name.toLowerCase()+' ')));
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
      if (!expected && name) {
        const aliases = set && language !== 'ja' ?
          await get(language,'/sets?abbreviation.official=eq:'+encodeURIComponent(set)) : [];
        const ids = new Set([set,...(aliases || []).map(row=>row.id)].map(setKey));
        const candidates = await get(language,'/cards?name=like:'+encodeURIComponent(name));
        const matches = (candidates || []).filter(card=>!set || ids.has(setKey(card.id.slice(0,-card.localId.length-1))));
        const exact = matches.filter(card=>setKey(card.name) === setKey(name));
        const best = exact.length ? exact : matches;
        const details = await Promise.all(best.slice(0,8).map(card=>byId(language,card.id)));
        return details.filter(Boolean).map(card=>({card,code:printSet(card)}));
      }
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
        let matches = (candidates || []).filter(card=>cardNumber(card.localId)===expected);
        if (total && matches.length > 12) {
          const sets = (await get(language,'/sets') || []).filter(entry=>entry.cardCount?.official===total);
          const setIds = new Set(sets.map(entry=>entry.id));
          matches = matches.filter(card=>setIds.has(card.id.slice(0,-card.localId.length-1)));
        }
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
      const named = matchingNames(matches,fields.name);
      if (named.length) return named;
      if (matches.length && (fields.insistSet || !fields.name)) return matches;
      if (matches.length) failures.push({matches});
    }
    const retries = locales.filter(language=>language!==preferred);
    const results = await Promise.allSettled(retries.map(lookup));
    const matches = results.flatMap(result=>result.status==='fulfilled' ? result.value : []);
    const named = matchingNames(matches,fields.name);
    if (named.length) return named;
    const unconfirmed = [...failures.flatMap(failure=>failure.matches || []),...matches];
    if (unconfirmed.length) return unconfirmed.map(match=>({...match,confirmName:true}));
    if (failures.length+results.filter(result=>result.status==='rejected').length===locales.length)
      throw failures[0] || results[0].reason;
    return [];
  }

  function matchingNames(matches,name) {
    const normalize = value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f\s]/g,'').toLowerCase();
    const query = normalize(name);
    return matches.filter(match=>normalize(match.card.name).includes(query));
  }

  const energyColors = {
    Grass:'#81d65c', Fire:'#ff8258', Water:'#64c9ff', Lightning:'#ffe158', Psychic:'#deabfb',
    Fighting:'#e9a469', Darkness:'#74acc7', Metal:'#c9dbe2', Fairy:'#faaed0', Dragon:'#edc36e', Colorless:'#def0ff'
  };
  const energyLetters = {G:'Grass',R:'Fire',W:'Water',L:'Lightning',P:'Psychic',F:'Fighting',
    D:'Darkness',M:'Metal',Y:'Fairy',N:'Dragon',C:'Colorless'};

  function parseLimitlessAttack(label,symbols) {
    const normalized = label.trim().replace(/\s+/g,' ');
    const damage = normalized.match(/\s+(\d+(?:\s*[+×x−-])?)$/i);
    return {name:damage ? normalized.slice(0,damage.index) : normalized,
      cost:[...symbols.toUpperCase()].map(letter=>energyLetters[letter]).filter(Boolean),
      damage:damage?.[1]?.replace(/\s/g,'') || ''};
  }

  function ownedVariantCounts(rows) {
    const totals = new Map();
    for (const row of rows) {
      const variant = variantKey(row.variant) || '';
      totals.set(variant,(totals.get(variant) || 0)+1);
    }
    return [...totals];
  }

  if (typeof module === 'object' && module.exports) {
    module.exports = {printIdentity,checkCollection,availableVariants,readPrintedClues,cardNumber,makeCatalog,limitlessLink,cameraCrop,resolveScannerPrints,variantArtwork,variantClue,selectVisualVariant,parseLimitlessAttack,ownedVariantCounts};
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

  function enhanceText(canvas, {x=0,y=.75,w=1,h=.25,binary=false} = {}) {
    const footer = element('canvas');
    const width = Math.max(1,Math.round(canvas.width*w));
    const height = Math.max(1,Math.round(canvas.height*h));
    const scale = Math.min(2.5,1800/width);
    footer.width = Math.max(1,Math.round(width*scale));
    footer.height = Math.max(1,Math.round(height*scale));
    const ctx = footer.getContext('2d',{willReadFrequently:true});
    ctx.drawImage(canvas,Math.round(canvas.width*x),Math.round(canvas.height*y),width,height,0,0,footer.width,footer.height);
    const pixels = ctx.getImageData(0,0,footer.width,footer.height);
    const histogram = new Uint32Array(256);
    for (let i=0;i<pixels.data.length;i+=4) {
      const tone = Math.round(pixels.data[i]*.299+pixels.data[i+1]*.587+pixels.data[i+2]*.114);
      histogram[tone]++;
      pixels.data[i] = tone;
    }
    function percentile(fraction) {
      const target = footer.width*footer.height*fraction;
      let count = 0;
      return histogram.findIndex(value=>(count+=value)>=target);
    }
    const low = percentile(.04);
    const high = Math.max(low+24,percentile(.96));
    for (let i=0;i<pixels.data.length;i+=4) {
      const tone = (pixels.data[i]-low)*255/(high-low);
      pixels.data[i] = pixels.data[i+1] = pixels.data[i+2] = tone;
    }
    if (binary) {
      const {width,height} = footer;
      const stride = width+1;
      const integral = new Uint32Array(stride*(height+1));
      for (let row=1;row<=height;row++) {
        let sum = 0;
        for (let col=1;col<=width;col++) {
          sum += pixels.data[((row-1)*width+col-1)*4];
          integral[row*stride+col] = integral[(row-1)*stride+col]+sum;
        }
      }
      const radius = Math.max(5,Math.round(height/4));
      for (let row=0;row<height;row++) {
        const top = Math.max(0,row-radius), bottom = Math.min(height,row+radius+1);
        for (let col=0;col<width;col++) {
          const left = Math.max(0,col-radius), right = Math.min(width,col+radius+1);
          const sum = integral[bottom*stride+right]-integral[top*stride+right]-
            integral[bottom*stride+left]+integral[top*stride+left];
          const average = sum/((bottom-top)*(right-left));
          const index = (row*width+col)*4;
          const tone = pixels.data[index] < average-12 ? 0 : 255;
          pixels.data[index] = pixels.data[index+1] = pixels.data[index+2] = tone;
        }
      }
    }
    ctx.putImageData(pixels,0,0);
    return footer;
  }

  function photoPixels(image, inset = 0) {
    const canvas = element('canvas');
    canvas.width = 32;
    canvas.height = 44;
    const context = canvas.getContext('2d');
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    context.drawImage(image,width*inset,height*inset,width*(1-2*inset),height*(1-2*inset),0,0,32,44);
    const rgba = context.getImageData(0,0,32,44).data;
    const pixels = [];
    for (let y=7;y<42;y++) {
      for (let x=2;x<30;x++) {
        // Weight the card text and frame, where finish patterns are easier to distinguish.
        if (y<23 && x>4 && x<27) continue;
        const index = (y*32+x)*4;
        pixels.push(.299*rgba[index]+.587*rgba[index+1]+.114*rgba[index+2]);
      }
    }
    return pixels;
  }

  async function visualVariant(photo, variants, artByFinish) {
    if (!photo || variants.length<2 || variants.length>5) return '';
    const candidates = variants.map(variant=>({variant,url:artByFinish(variant)[0]?.url})).filter(row=>row.url);
    const unique = candidates.filter(row=>candidates.filter(candidate=>candidate.url===row.url).length===1);
    if (unique.length<2) return '';
    const results = await Promise.allSettled(unique.map(async ({url,variant})=>{
      const image = element('img');
      image.crossOrigin = 'anonymous';
      image.src = url;
      await image.decode();
      return {variant,pixels:photoPixels(image)};
    }));
    const references = results.flatMap(result=>result.status==='fulfilled' ? [result.value] : []);
    return selectVisualVariant([0,.035,.065].map(inset=>photoPixels(photo,inset)),references,references.length===variants.length);
  }

  function attackHeading(skill) {
    const heading = element('div',null,'scan-attack-heading');
    const costs = Array.isArray(skill.cost) ? skill.cost : [];
    const types = costs.map(cost=>Object.keys(energyColors).find(type=>type.toLowerCase()===String(cost).toLowerCase()) ||
      energyLetters[String(cost).toUpperCase()]).filter(Boolean);
    if (types.length) {
      const group = element('span',null,'scan-attack-cost');
      group.setAttribute('role','img');
      group.setAttribute('aria-label','Attack cost: '+types.join(', '));
      for (const type of types) {
        const badge = element('span',null,'scan-energy');
        badge.dataset.energyType = type.toLowerCase();
        badge.title = type+' Energy';
        badge.style.backgroundColor = energyColors[type];
        const ns = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(ns,'svg');
        svg.setAttribute('viewBox','0 0 24 24');
        svg.setAttribute('aria-hidden','true');
        const glyph = document.createElementNS(ns,'use');
        glyph.setAttribute('href','assets/pokedex-energy.svg#lobby-'+type.toLowerCase());
        svg.append(glyph);
        badge.append(svg);
        group.append(badge);
      }
      heading.append(group);
    }
    heading.append(element('strong',skill.name));
    if (skill.damage != null && skill.damage !== '') heading.append(element('span',skill.damage,'scan-attack-damage'));
    return heading;
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
    const skills = kind => [...template.content.querySelectorAll('.card-text-'+kind)].map(section => {
      const info = section.querySelector('.card-text-'+kind+'-info');
      const effect = section.querySelector('.card-text-'+kind+'-effect')?.textContent.trim();
      if (kind !== 'attack') return {name:info?.textContent.trim().replace(/\s+/g,' '),effect};
      const symbols = [...(info?.querySelectorAll('.ptcg-symbol') || [])];
      const cost = symbols.map(symbol=>symbol.textContent).join('');
      symbols.forEach(symbol=>symbol.remove());
      return {...parseLimitlessAttack(info?.textContent || '',cost),effect};
    });
    const attacks = skills('attack'), abilities = skills('ability');
    const effect = [...template.content.querySelectorAll('.card-text-section > p:not([class])')]
      .map(paragraph=>paragraph.textContent.trim()).filter(Boolean).join('\n');
    return {name:title.textContent.trim(),attacks,abilities,effect};
  }

  function mountPokedexScanner({cards, savedPrints, speciesNames, displayVariant, variantOptionLabel, variantBadge, variants, openAdd}) {
    const el = id => document.getElementById(id);
    const dialog = el('scanner');
    const form = el('scannerLookup');
    const state = el('scannerStatus');
    const candidates = el('scannerCandidates'), result = el('scannerResult');
    const lookup = makeCatalog(window.fetch.bind(window));
    const video = el('scannerVideo'), camera = el('scannerPreview'), take = el('scannerTake');
    const torch = el('scannerTorch'), start = el('scannerStart'), manual = el('scannerManual'), phone = el('scannerPhone');
    const variant = form.elements.variant;
    const mobile = navigator.userAgentData?.mobile === true || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints>1);
    let client, request = 0, previewUrl = '', cameraVersion = 0, stream, supportsTorch = false;
    let context, scanPhoto, scannedVariant, updateVariant, lookupTimer;

    function variantOptions(finishes = []) {
      const selected = variant.value;
      const empty = element('option','Auto / choose a variant');
      empty.value = '';
      variant.replaceChildren(empty);
      for (const value of new Set([...finishes,...variants])) {
        const option = element('option',variantOptionLabel(value));
        option.value = value;
        variant.append(option);
      }
      variant.value = selected;
    }
    manual.hidden = !mobile;
    take.hidden = !mobile;
    el('scannerPasteHint').hidden = mobile;
    el('scannerPaste').hidden = mobile;
    variantOptions();
    try {
      client = createLibrarySyncClient({...playmatSyncConfig,storage:localStorage,
        fetcher:(url,options)=>fetch(url,{...options,signal:AbortSignal.timeout(7500)})});
    } catch { /* Lookup remains available without Playmat sync. */ }

    function clearPhoto() {
      scanPhoto = null;
      scannedVariant = '';
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
      torch.disabled = true;
      torch.setAttribute('aria-pressed','false');
      take.hidden = true;
      take.disabled = true;
      supportsTorch = false;
      phone.hidden = !mobile;
      start.hidden = !mobile;
    }

    async function startCamera() {
      if (!mobile) return;
      request++;
      clearTimeout(lookupTimer);
      updateVariant = null;
      stopCamera();
      clearPhoto();
      candidates.replaceChildren();
      result.replaceChildren();
      setManual(false);
      const job = cameraVersion;
      start.hidden = true;
      phone.hidden = true;
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
        const capabilities = track?.getCapabilities?.() || {};
        const capability = capabilities.torch;
        supportsTorch = capability === true || (Array.isArray(capability) && capability.includes(true));
        if (capabilities.focusMode?.includes('continuous') && track.applyConstraints) {
          const current = track.getConstraints?.() || {};
          await track.applyConstraints({...current,advanced:[...(current.advanced || []),{focusMode:'continuous'}]}).catch(()=>{});
        }
        if (cameraVersion !== job) return;
        phone.hidden = supportsTorch;
        torch.disabled = false;
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
        state.textContent = 'Live camera unavailable. Use Phone camera, choose an image, or enter the card manually.';
      }
    }

    function registerManually() {
      const fields = Object.fromEntries(new FormData(form));
      dialog.close();
      openAdd({name:fields.name.trim(),set:fields.set.trim(),number:fields.number.trim(),variant:fields.variant,
        pokemonId:context.entry?.id,pokemonKey:context.entry?.key,destination:context.destination});
    }

    function open(options = {}) {
      if (dialog.open) return;
      context = {destination:'cards',...options};
      request++;
      updateVariant = null;
      clearPhoto();
      form.reset();
      variant.value = '';
      variantOptions();
      form.elements.set.value = context.print?.set || '';
      form.elements.number.value = context.print?.number || '';
      form.elements.name.value = context.print?.name || '';
      candidates.replaceChildren();
      result.replaceChildren();
      state.textContent = '';
      dialog.showModal();
      if (mobile) void startCamera();
      else {
        setManual(true);
        if (form.elements.set.value && form.elements.number.value) lookUpFields();
      }
    }
    el('closeScanner').addEventListener('click',()=>dialog.close());
    dialog.addEventListener('close',()=>{
      if (dialog.open) return;
      request++;
      clearTimeout(lookupTimer);
      stopCamera();
      clearPhoto();
    });
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
      if (form.elements.set.value && form.elements.number.value && !updateVariant) lookUpFields();
    });
    el('scannerRegister').addEventListener('click',registerManually);
    phone.addEventListener('click',()=>{
      stopCamera();
      state.textContent = 'Turn on flash in your phone’s camera if needed, then take the photo.';
      el('scannerCamera').click();
    });
    function showFlashFallback() {
      phone.hidden = false;
      state.textContent = 'Use Phone camera to turn on flash in your camera app, or choose a photo you already took.';
    }
    torch.addEventListener('click',async ()=>{
      const track = stream?.getVideoTracks()[0];
      if (!track || !supportsTorch) { showFlashFallback(); return; }
      const enabled = torch.getAttribute('aria-pressed') !== 'true';
      const job = cameraVersion;
      torch.disabled = true;
      try {
        const current = track.getConstraints?.() || {};
        delete current.torch;
        const advanced = (current.advanced || []).filter(option=>!Object.hasOwn(option,'torch'));
        const first = await track.applyConstraints({...current,advanced:[...advanced,{torch:enabled}]})
          .then(()=>true,()=>false);
        if (cameraVersion !== job) return;
        if (!first || (track.getSettings?.().torch ?? enabled) !== enabled)
          await track.applyConstraints({...current,advanced,torch:{exact:enabled}});
        if (cameraVersion !== job) return;
        if ((track.getSettings?.().torch ?? enabled) !== enabled) { showFlashFallback(); return; }
        torch.setAttribute('aria-pressed',String(enabled));
      } catch {
        if (cameraVersion === job) showFlashFallback();
      } finally {
        if (cameraVersion === job) torch.disabled = false;
      }
    });

    take.addEventListener('click',async ()=>{
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

    dialog.addEventListener('paste',event=>{
      const clipboard = event.clipboardData;
      const image = [...(clipboard?.files || [])].find(file=>file.type.startsWith('image/')) ||
        [...(clipboard?.items || [])].find(item=>item.kind==='file' && item.type.startsWith('image/'))?.getAsFile();
      if (!image) return;
      event.preventDefault();
      void scan(image);
    });
    el('scannerPaste').addEventListener('click',async ()=>{
      const alive = request;
      try {
        const clipboard = await navigator.clipboard.read();
        for (const item of clipboard) {
          const type = item.types.find(value=>value.startsWith('image/'));
          if (!type) continue;
          const image = await item.getType(type);
          if (dialog.open && alive === request) void scan(image);
          return;
        }
        if (dialog.open && alive === request) state.textContent = 'Copy a card image first, or choose an image.';
      } catch {
        if (dialog.open && alive === request) state.textContent = 'Paste the copied image with Ctrl+V or ⌘V, or choose an image.';
      }
    });

    async function scan(file) {
      const job = ++request;
      clearTimeout(lookupTimer);
      updateVariant = null;
      stopCamera();
      form.reset();
      variant.value = '';
      setManual(!mobile);
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
        scanPhoto = canvas;
        worker = await tesseract.createWorker('jpn+eng',1,{logger:event=>{
          if (job === request && event.status === 'recognizing text') state.textContent = 'Reading the card…';
        }});
        await worker.setParameters({tessedit_pageseg_mode:tesseract.PSM.SPARSE_TEXT});
        const {data} = await worker.recognize(canvas,{rotateAuto:true});
        if (job !== request) return;
        scannedVariant = variantClue(file.name) || variantClue(data.text);
        const language = jpText.test(data.text) ? 'ja' :
          /\bPV\s*\d{2,3}\b|\b\d{2,3}\s*PV\b|\bFR\s+\d{1,4}\s*\//i.test(data.text) ? 'fr' : 'en';
        const sets = await lookup.sets(language).catch(()=>[]);
        const codes = [...(sets || []).map(set=>set.id),'MEG','PFL','ASC','POR','PAF','PAL','SVI','OBF','PAR','TEF','TWM','SFA','SCR','SSP','JTG','DRI','BLK','WHT','PRE','CRZ','SIT','LOR','ASR','BRS','FST','EVS','CRE','BST','VIV','DAA'];
        const full = readPrintedClues(data.text,codes,speciesNames,language);
        if (job !== request) return;
        const options = [];
        const hasReference = clue => clue.number && (clue.set || clue.name || clue.number.includes('/'));
        if (hasReference(full) && full.set && full.name) {
          const matches = await resolveScannerPrints(lookup,full).catch(()=>[]);
          if (job !== request) return;
          if (matches.some(match=>!match.confirmName)) {
            for (const key of ['set','number','name']) form.elements[key].value = full[key];
            await find(full,job,matches);
            return;
          }
        }
        const footer = await worker.recognize(enhanceText(canvas));
        if (job !== request) return;
        const read = readPrintedClues(footer.data.text,codes,[],language);
        if (!full.name && (!full.number || !full.set)) {
          await worker.setParameters({tessedit_pageseg_mode:tesseract.PSM.SINGLE_LINE});
          const header = await worker.recognize(enhanceText(canvas,{x:.075,y:.055,w:.7,h:.095}));
          if (job !== request) return;
          full.name = readCardName(header.data.text.trim().split(/\r?\n/),speciesNames,language);
        }
        const narrowed = [];
        if (!read.number && (!full.number || !full.set)) {
          // Collector numbers and modern set codes are printed in Latin characters.
          await worker.reinitialize('eng',1);
          await worker.setParameters({tessedit_pageseg_mode:tesseract.PSM.SINGLE_LINE,user_defined_dpi:300});
          for (const y of [.887,.926]) {
            const small = await worker.recognize(enhanceText(canvas,{x:.09,y,w:.42,h:.048,binary:true}));
            if (job !== request) return;
            const clue = readPrintedClues(small.data.text,codes,[],language);
            if (clue.number) narrowed.push({...clue,name:full.name});
            if (clue.set && clue.number) break;
          }
        }
        const focused = {...read,name:full.name};
        const complete = clue => (clue.set ? 2 : 0)+(clue.number.includes('/') ? 1 : 0);
        options.push(...[full,focused,...narrowed].filter(hasReference).sort((a,b)=>complete(b)-complete(a)));
        const clues = options[0] || {...full,set:full.set || focused.set,number:full.number || focused.number};
        for (const key of ['set','number','name']) form.elements[key].value = clues[key];
        let unconfirmed = [];
        for (const candidate of options.filter((option,index)=>options.findIndex(row=>row.set===option.set && row.number===option.number)===index)) {
          const matches = await resolveScannerPrints(lookup,candidate).catch(()=>[]);
          if (job !== request) return;
          if (matches.some(match=>!match.confirmName)) { await find(candidate,job,matches); return; }
          if (matches.length) unconfirmed = matches;
        }
        if (unconfirmed.length) { await find(clues,job,unconfirmed); return; }
        if (clues.name) { await find({...clues,set:'',number:''},job); return; }
        setManual(true);
        state.textContent = 'Could not confirm a print. Check the collector number below or retake the photo.';
      } catch (error) {
        if (job === request) {
          setManual(true);
          state.textContent = (error?.message || 'Could not read this photo.')+' You can look up the print manually.';
        }
      } finally {
        if (worker) await worker.terminate().catch(()=>{});
      }
    }

    function lookUpFields() {
      clearTimeout(lookupTimer);
      const fields = Object.fromEntries(new FormData(form));
      fields.set = fields.set.trim();
      fields.number = fields.number.trim();
      fields.name = fields.name.trim();
      if (!fields.name && (!fields.set || !fields.number)) {
        state.textContent = 'Enter a set and collector number, or a printed name.';
        return;
      }
      stopCamera();
      void find({...fields,insistSet:true},++request);
    }

    form.addEventListener('submit',event=>{
      event.preventDefault();
      lookUpFields();
    });
    const refreshReference = () => {
      updateVariant = null;
      candidates.replaceChildren();
      result.replaceChildren();
      request++;
      clearTimeout(lookupTimer);
      if (form.elements.set.value.trim() && form.elements.number.value.trim())
        lookupTimer = setTimeout(lookUpFields,450);
    };
    for (const key of ['set','number']) form.elements[key].addEventListener('input',refreshReference);
    variant.addEventListener('change',()=>{
      if (updateVariant) updateVariant();
      else if (form.elements.set.value.trim() && form.elements.number.value.trim()) lookUpFields();
    });

    async function find(fields, job, found) {
      state.textContent = 'Looking up the card…';
      result.replaceChildren();
      candidates.replaceChildren();
      updateVariant = null;
      try {
        const matches = found || await resolveScannerPrints(lookup,fields);
        if (job !== request) return;
        if (!matches.length) {
          setManual(true);
          state.textContent = 'No exact print found. Check the set code and collector number.';
          return;
        }
        if (matches.length === 1 && fields.number && !matches[0].confirmName) {
          await showResult(matches[0],matches[0].language,job);
          return;
        }
        state.textContent = 'Choose the print that matches your card.';
        for (const match of matches) {
          const choice = action(null,()=>void showResult(match,match.language,++request),'scan-candidate');
          if (/^https:\/\/assets\.tcgdex\.net\//.test(match.card.image || '')) {
            const art = element('img');
            art.src = match.card.image+'/low.webp';
            art.alt = '';
            art.loading = 'lazy';
            art.addEventListener('error',()=>art.remove(),{once:true});
            choice.append(art);
          }
          choice.append(element('span',[match.card.name,match.code,match.card.localId,{en:'English',fr:'French',ja:'Japanese'}[match.language]].join(' · ')));
          candidates.append(choice);
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
      const catalogArt = /^https:\/\/assets\.tcgdex\.net\//.test(card.image || '') ? imageUrl(card.image) : '';
      const fallbackArt = limitlessImage(language,code,identity.number);
      const baseUrls = [catalogArt,fallbackArt].filter(Boolean);
      const panel = element('section',null,'scan-card');
      const picture = element('figure',null,'scan-artwork');
      panel.append(picture);
      const finishes = availableVariants(card);
      variantOptions(finishes);
      setManual(true);
      const structurallyKnown = !variant.value && finishes.length === 1;
      if (!variant.value && scannedVariant && finishes.includes(scannedVariant)) variant.value = scannedVariant;
      if (!variant.value && structurallyKnown) variant.value = finishes[0];
      const artByFinish = selected => {
        const samePrint = checkCollection(cards(),identity,selected,[card.set?.id]).samePrint;
        const exact = variantArtwork(card,selected,samePrint,baseUrls);
        if (!exact.length && (selected==='normal' && finishes.includes('normal') ||
            finishes.length===1 && finishes[0]===selected)) {
          return baseUrls.map(url=>({url,label:'Catalog artwork · '+displayVariant(selected)}));
        }
        return exact;
      };
      const artworkForVariant = selected => {
        const exact = artByFinish(selected);
        const label = selected ? 'Catalog artwork · '+displayVariant(selected)+' image unavailable' : 'Catalog artwork';
        return [...exact,...baseUrls.filter(url=>!exact.some(item=>item.url===url)).map(url=>({url,label}))];
      };
      let art = '';
      function refreshArt() {
        const previews = artworkForVariant(variant.value);
        const showArt = index => {
          if (!previews[index]) {
            art = '';
            picture.replaceChildren(element('p','Card image unavailable.','note'));
            return;
          }
          const {url,label} = previews[index];
          const image = element('img');
          image.alt = card.name+' card artwork';
          image.referrerPolicy = 'no-referrer';
          image.addEventListener('error',()=>{ if (image.isConnected) showArt(index+1); },{once:true});
          art = url;
          picture.replaceChildren(image,element('figcaption',label,'note'));
          image.src = url;
        };
        showArt(0);
      }
      const content = element('div',null,'scan-info');
      const name = element('h3',card.name);
      const metadata = element('p',[code,identity.printedNumber,card.set?.name,card.rarity].filter(Boolean).join(' · '),'note');
      const variantStatus = element('p',variant.value && structurallyKnown ?
        'Variant identified from the catalog.' : variant.value && variant.value === scannedVariant ?
          'Variant suggested from the scan. You can correct it above.' : '','note');
      const collection = element('div',null,'scan-ownership');
      collection.setAttribute('aria-live','polite');
      const add = action(context.destination === 'binder' ? 'Add to Binder' : 'Add to Pokédex',()=>{
        dialog.close();
        openAdd({name:name.textContent,language,set:code,number:identity.printedNumber,variant:variant.value,image:art,artworkForVariant,
          pokemonId:identity.speciesId,pokemonKey:identity.pokemonKey,destination:context.destination});
      },'primary');
      const refreshOwnership = () => {
        const found = checkCollection(cards(),identity,variant.value,[card.set?.id]);
        const ownership = !identity.pokemonKey ? 'No Pokédex species is linked to this print.' :
          found.exact.length ? 'In your Pokédex · '+found.exact.length+' exact '+(found.exact.length===1?'copy':'copies') :
          found.unknownLanguage ? 'Matching set, number and finish in your Pokédex. The saved card has no language recorded.' :
          found.samePrint.length && !variant.value ? 'This print is in your Pokédex. Confirm the finish to check exact ownership.' :
          found.samePrint.length ? 'You own this print in another finish.' :
          found.sameSpecies.length ? 'You own a different print of this Pokémon.' : 'This Pokémon is missing from your Pokédex.';
        collection.replaceChildren(element('p',ownership));
        const counts = ownedVariantCounts(found.samePrint);
        if (counts.length) {
          const list = element('div',null,'owned-variants');
          list.append(element('small','Owned variants'));
          for (const [key,count] of counts) {
            const badge = variantBadge(key);
            if (count>1) badge.append(element('span','×'+count));
            list.append(badge);
          }
          collection.append(list);
        }
        add.disabled = !variant.value || (!identity.speciesId && context.destination !== 'binder');
      };
      updateVariant = ()=>{
        variantStatus.textContent = '';
        variantStatus.hidden = true;
        refreshArt();
        refreshOwnership();
      };
      refreshArt();
      refreshOwnership();
      const translation = element('section',null,'scan-translation');
      variantStatus.hidden = !variantStatus.textContent;
      content.append(name,metadata,variantStatus,collection,add,translation);
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
      state.textContent = variant.value ? 'Review the print and finish.' : 'Review the print and select its variant above.';
      if (!variant.value && scanPhoto) {
        void visualVariant(scanPhoto,finishes,artByFinish).then(suggestion=>{
          if (!suggestion || job !== request || variant.value) return;
          variant.value = suggestion;
          updateVariant?.();
          variantStatus.textContent = 'Variant suggested from matching card photos. You can correct it above.';
          variantStatus.hidden = false;
        }).catch(()=>{});
      }
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
          row.append(section === 'Attacks' ? attackHeading(skill) : element('strong',skill.name));
          if (skill.effect) row.append(element('p',skill.effect));
          translation.append(row);
        }
      }
      if (localized.effect) translation.append(element('p',localized.effect));
    }
    return open;
  }

  window.mountPokedexScanner = mountPokedexScanner;
})();

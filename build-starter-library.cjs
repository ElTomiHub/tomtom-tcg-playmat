const fs = require('node:fs');
const path = require('node:path');

const deckFields = ['id', 'name', 'decklist', 'category', 'coverCardId', 'coverImage', 'strategyBaseline'];
const cardFields = ['id', 'name', 'setCode', 'cardNumber', 'language', 'categoryHint', 'category', 'tcgdexId', 'limitlessId', 'source'];
const metadataFields = ['source', 'language', 'textLanguage', 'translationSource', 'translationStatus', 'sourceUrl',
  'category', 'stage', 'evolveFrom', 'trainerType', 'energyType', 'hp', 'types', 'retreat',
  'weaknesses', 'resistances', 'image', 'effect', 'rules', 'attackMetadataStatus', 'attacks', 'abilities'];
const imageHosts = ['assets.tcgdex.net', 'limitlesstcg.nyc3.cdn.digitaloceanspaces.com', 'www.pokemon-card.com'];
const take = (record, fields) => Object.fromEntries(fields.filter(key => Object.hasOwn(record,key)).map(key => [key,record[key]]));
const validId = id => typeof id === 'string' && id.length > 0 && id.length <= 512 && !['__proto__','constructor','prototype'].includes(id);

function safeImage(value) {
  if (!value) return '';
  if (/^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) return value;
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && !url.username && !url.password && imageHosts.includes(url.hostname)) return value;
  } catch {}
  return '';
}

function buildStarterLibrary(backup) {
  const data = backup?.data;
  if (backup?.kind !== 'pokemon-tcg-playmat-backup' || backup.schemaVersion !== 1 ||
      !Array.isArray(data?.decks) || !Array.isArray(data.cards) || !data.decks.length) {
    throw new Error('Choose a Playmat library backup with saved decks and cards.');
  }
  const cards = new Map(), aliases = new Map(), recordIds = new Set();
  for (const input of data.cards) {
    if (!validId(input?.id) || recordIds.has(input.id) || typeof input.name !== 'string' || !input.name.trim()) throw new Error('Invalid or repeated card ID in the backup.');
    recordIds.add(input.id);
    const card = take(input,cardFields);
    const set = typeof input.setCode === 'string' ? input.setCode.toUpperCase() : '';
    const number = typeof input.cardNumber === 'string' ? input.cardNumber.toUpperCase() : '';
    if (set && number) {
      card.id = 'print:'+set+':'+number;
      card.setCode = set;
      card.cardNumber = number;
    }
    aliases.set(input.id,card.id);
    if (input.meta && typeof input.meta === 'object' && !Array.isArray(input.meta)) {
      const meta = take(input.meta,metadataFields);
      if (meta.image) meta.image = safeImage(meta.image);
      for (const key of ['attacks','abilities','weaknesses','resistances']) if (Array.isArray(meta[key])) {
        const fields = key === 'attacks' ? ['name','cost','damage','effect','effectTextStatus'] :
          key === 'abilities' ? ['name','type','effect'] : ['type','value'];
        meta[key] = meta[key].map(item=>take(item,fields));
      }
      card.meta = meta;
    } else card.meta = null;
    const existing = cards.get(card.id);
    if (existing && existing.name !== card.name) throw new Error('Conflicting card names for '+card.id+'.');
    if (!existing || !existing.meta && card.meta || input.id===card.id && card.meta) cards.set(card.id,card);
  }
  const decks = new Map();
  for (const input of data.decks) {
    if (!validId(input?.id) || decks.has(input.id) || typeof input.name !== 'string' ||
        !input.name.trim() || typeof input.decklist !== 'string') throw new Error('Invalid or repeated deck ID in the backup.');
    const deck = take(input,deckFields);
    if (deck.coverCardId) deck.coverCardId = aliases.get(deck.coverCardId) || deck.coverCardId;
    if (deck.coverImage) {
      deck.coverImage = safeImage(deck.coverImage);
      if (!deck.coverImage) throw new Error('Unsupported cover image for '+deck.name+'.');
    }
    decks.set(deck.id,deck);
  }
  const order = [...new Set([...(Array.isArray(data.deckOrder) ? data.deckOrder : []), ...decks.keys()])];
  return {schemaVersion:1,decks:order.filter(id=>decks.has(id)).map(id=>decks.get(id)),cards:[...cards.values()]};
}

if (require.main === module) {
  const input = process.argv[2];
  if (!input) {
    process.stderr.write('Usage: node build-starter-library.cjs <playmat-backup.json>\n');
    process.exitCode = 1;
  } else {
    const library = buildStarterLibrary(JSON.parse(fs.readFileSync(input,'utf8')));
    const output = path.join(__dirname,'assets','starter-library.js');
    fs.writeFileSync(output,'// Generated from the public library fields by build-starter-library.cjs.\n'+
      'globalThis.PLAYMAT_STARTER_LIBRARY = '+JSON.stringify(library)+';\n');
    process.stdout.write('Bundled '+library.decks.length+' decks and '+library.cards.length+' distinct card records.\n');
  }
}
module.exports = {buildStarterLibrary};

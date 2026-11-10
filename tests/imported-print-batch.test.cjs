const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createEngineRunner, loadFixture } = require('./integration-harness.cjs');
const { cards } = require('./fixtures/imported-print-batch.fixture.json');
const fixture = loadFixture();

test('latest deck prints verify and incomplete effects stay Registered', async () => {
  const prints = [
    ["M2","11","Charmander","Pokemon"],
    ["MP","45","Charmeleon","Pokemon"],
    ["SV4A","349","Charizard ex","Pokemon"],
    ["SV4A","304","Pidgey","Pokemon"],
    ["SV3","118","Pidgey","Pokemon"],
    ["SV4A","305","Pidgeotto","Pokemon"],
    ["SV3","136","Pidgeot ex","Pokemon"],
    ["M1S","89","Mega Kangaskhan ex","Pokemon"],
    ["SV8A","57","Abra","Pokemon"],
    ["SV2A","203","Alakazam ex","Pokemon"],
    ["SV4A","309","Ditto","Pokemon"],
    ["MC","765","Lillie's Clefairy ex","Pokemon"],
    ["M2A","244","Fezandipiti ex","Pokemon"],
    ["SV7","123","Crispin","Trainer"],
    ["SV5M","90","Ciphermaniac's Codebreaking","Trainer"],
    ["M1S","90","Acerola's Mischief","Trainer"],
    ["SV6A","86","Xerosic's Scheme","Trainer"],
    ["SV4M","59","Counter Catcher","Trainer"],
    ["SV8","97","Miracle Headset","Trainer"],
    ["SVK","29","Technical Machine Devolution","Trainer"],
    ["SVP","19","Vital Band","Trainer"],
  ];
  const runner = createEngineRunner(fixture);
  const records = prints.map(([setCode,cardNumber,name,categoryHint])=>({
    id:setCode+' '+cardNumber,setCode,cardNumber,name,categoryHint,meta:null
  }));
  const iono = {id:'sv02-269',name:'Iono',setCode:'PAL',cardNumber:'269',language:'en',
    meta:{category:'Trainer',trainerType:'Supporter',language:'en',effect:"Each player shuffles their hand and puts it on the bottom of their deck. If either player put any cards on the bottom of their deck in this way, each player draws a card for each of their remaining Prize cards.",attacks:[],abilities:[],rules:[]}};
  records.push(iono);
  runner.api.loadSavedLibrary(records);
  await runner.api.checkLibrary();
  const audit = new Map(runner.api.libraryAudit().map(card=>[card.id,card.status]));
  for (const card of records) assert.equal(audit.get(card.id),
    ['M1S 90','SVK 29'].includes(card.id) ? 'registered' : 'implemented',card.id);
});

test('all distinct saved card fixture records pass the library audit together', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const directory = path.join(__dirname,'fixtures'), records = new Map();
  for (const file of fs.readdirSync(directory).filter(name => name.endsWith('.json'))) {
    const {cards = []} = JSON.parse(fs.readFileSync(path.join(directory,file),'utf8'));
    for (const card of cards) {
      if (!card.name) continue;
      const id = [card.language || card.meta?.language, card.setCode, card.cardNumber, card.name].join('|');
      if (!records.get(id)?.meta) records.set(id,{...card,id,meta:card.meta || null});
    }
  }
  const runner = createEngineRunner(fixture);
  runner.api.loadSavedLibrary([...records.values()]);
  await runner.api.checkLibrary();
  const statuses = new Map(runner.api.libraryAudit().map(card => [card.id,card.status]));
  assert.deepEqual([...records.keys()].filter(id => statuses.get(id) !== 'implemented'), []);
});

test('blank Japanese artwork is repaired and renders on older match cards', async () => {
  const { runInContext } = require('node:vm');
  const runner = createEngineRunner(fixture);
  const prints = [['Drampa','SVD','91','Pokemon'],['Tatsugiri','SV4A','232','Pokemon'],
    ["Iono's Bellibolt ex",'SV9','125','Pokemon'],['Electric Generator','SVHK','20','Trainer']];
  runner.api.loadSavedLibrary(prints.map(([name,setCode,cardNumber,categoryHint]) =>
    ({id:setCode+' '+cardNumber,name,setCode,cardNumber,categoryHint,meta:null})));
  await runner.api.checkLibrary();
  for (const card of runner.api.libraryAudit().filter(card => prints.some(([,set,number]) => card.id === set+' '+number))) {
    assert.ok(card.meta.image, card.name);
    const matchCard = structuredClone(card);
    delete matchCard.meta.image;
    runner.context.artworkTestCard = matchCard;
    assert.equal(runInContext("imageFor(artworkTestCard, 'high')", runner.context), card.meta.image);
  }
  assert.equal(runner.api.libraryAudit().filter(card => prints.some(([,set,number]) => card.id === set+' '+number)).length, 4);
});

test('the latest replacement prints verify with exact artwork and existing saved Nemona text', async () => {
  const prints = [
    ["SVM","97","Lugia ex","Pokemon"],
    ["SV11W","134","Purrloin","Pokemon"],
    ["SV4K","48","Liepard","Pokemon"],
    ["M2A","109","Scraggy","Pokemon"],
    ["M2A","241","Mega Scrafty ex","Pokemon"],
    ["M2","52","Seviper","Pokemon"],
    ["SVK","4","Sparkling Greninja","Pokemon"],
    ["M2","105","Grimsley's One Move","Trainer"],
    ["SV2A","197","Giovanni's Charisma","Trainer"],
    ["SV8A","228","Janine's Secret Technique","Trainer"],
    ["SVF","15","Trekking Shoes","Trainer"],
    ["SVHK","24","Dark Patch","Trainer"],
    ["M2","104","Punk Helmet","Trainer"],
    ["M2A","69","Ralts","Pokemon"],
    ["SVF","7","Kirlia","Pokemon"],
    ["M1S","87","Mega Gardevoir ex","Pokemon"],
    ["SV4M","89","Iron Valiant ex","Pokemon"],
    ["SV8","59","Flutter Mane","Pokemon"],
    ["S11A","82","Furisode Girl","Trainer"],
    ["SV4K","85","Professor Sada's Vitality","Trainer"],
    ["SV7A","83","Drayton","Trainer"],
    ["M1L","86","Lillie's Determination","Trainer"],
    ["SPD","9","Fog Crystal","Trainer"],
    ["M3","102","Sacred Ash","Trainer"],
    ["M1S","83","Mega Signal","Trainer"],
    ["SV4M","62","Future Booster Energy Capsule","Trainer"],
    ["SV4K","61","Ancient Booster Energy Capsule","Trainer"],
    ["M1S","86","Mystery Garden","Trainer"],
    ["S8B","276","Gloria","Trainer"],
    ["S7R","77","Shauna","Trainer"],
    ["S1A","77","Sonia","Trainer"],
    ["MC","645","Deduction Kit","Trainer"],
    ["MP","74","Brave Bangle","Trainer"],
    ["SVK","44","Luminous Energy","Energy"],
    ["SV2P","75","Frigibax","Pokemon"],
    ["SV2P","76","Arctibax","Pokemon"],
    ["SV2P","77","Baxcalibur","Pokemon"],
    ["SV2P","93","Chien-Pao ex","Pokemon"],
    ["S10P","71","Palkia Origin Forme V","Pokemon"],
    ["S12A","259","Palkia Origin Forme VSTAR","Pokemon"],
    ["S12A","204","Bidoof","Pokemon"],
    ["S12A","200","Bibarel","Pokemon"],
    ["S10P","77","Irida","Trainer"],
    ["SV1A","64","null","Trainer"],
    ["SV3A","91","Beach Court","Trainer"],
  ];
  const records = prints.map(([setCode, cardNumber, name, categoryHint]) => ({
    id: setCode + ' ' + cardNumber, setCode, cardNumber, name, categoryHint, meta: null
  }));
  records.push({id:'PAF 238',name:'Nemona',setCode:'PAF',cardNumber:'238',language:'en',
    meta:{category:'Trainer',trainerType:'Supporter',language:'en',effect:'Draw 3 cards.',attacks:[],abilities:[],rules:[]}});
  const runner = createEngineRunner(fixture);
  runner.api.loadSavedLibrary(records);
  await runner.api.checkLibrary();
  const audit = runner.api.libraryAudit();
  for (const card of records) {
    const loaded = audit.find(item => item.id === card.id);
    assert.equal(loaded?.status, 'implemented', card.id);
    assert.ok(loaded.meta.image, card.id);
  }
  const energy = audit.find(item => item.id === 'SVK 44');
  assert.deepEqual(Array.from(runner.api.energyUnits(energy,{energy:[energy]})), ['any']);
  assert.deepEqual(Array.from(runner.api.energyUnits(energy,{energy:[energy,{id:'special',name:'Special Energy',meta:{category:'Energy'}}]})), ['colorless']);
});

test('the new metal and grass prints and secret rare Electrode resolve from saved records', async () => {
  const prints = [
    ["SV3","117","Varoom","Pokemon"],
    ["SV6","78","Revavroom","Pokemon"],
    ["SVP","195","Duraludon","Pokemon"],
    ["SV7","113","Archaludon","Pokemon"],
    ["SV10","74","Skarmory","Pokemon"],
    ["SV1S","98","Team Star Grunt","Trainer"],
    ["SV8","127","Cyrano","Trainer"],
    ["SJ","23","Metal Saucer","Trainer"],
    ["M5","102","Iron Defender","Trainer"],
    ["SV2A","160","Leftovers","Trainer"],
    ["SV2A","165","Cycling Road","Trainer"],
    ["SV4A","191","Oddish","Pokemon"],
    ["SV4A","192","Gloom","Pokemon"],
    ["SV4A","193","Vileplume","Pokemon"],
    ["SVC","3","Voltorb","Pokemon"],
    ["S9A","5","Heracross","Pokemon"],
    ["MC","10","Exeggcute","Pokemon"],
    ["SVM","5","Exeggutor","Pokemon"],
    ["SVP","192","Meowth","Pokemon"],
    ["SV6A","75","Persian","Pokemon"],
    ["SVM","38","Pikachu ex","Pokemon"],
    ["SVM","94","Snorlax ex","Pokemon"],
    ["SV2A","199","Bill's Teleport","Trainer"],
    ["MF","28","Potion","Trainer"],
    ["SV4K","59","Snorlax Doll","Trainer"],
  ];
  const electrode = structuredClone(cards.find(card => card.name === 'Electrode'));
  Object.assign(electrode, {id:'swsh6-222',setCode:'CRE',cardNumber:'222'});
  Object.assign(electrode.meta.attacks[0], {effect:null,effectTextStatus:'missing'});
  electrode.meta.attackMetadataStatus = 'missing';
  const runner = createEngineRunner(fixture);
  const records = prints.map(([setCode, cardNumber, name, categoryHint]) => ({
    id: setCode + ' ' + cardNumber, setCode, cardNumber, name, categoryHint, meta: null
  }));
  runner.api.loadSavedLibrary([...records, electrode]);
  await runner.api.checkLibrary();
  const audit = runner.api.libraryAudit();
  for (const card of [...records, electrode]) assert.equal(audit.find(record => record.id === card.id)?.status, 'implemented', card.id);
  const doll = audit.find(record => record.id === 'SV4K 59');
  assert.match(doll.meta.effect, /120-HP Basic/);
  assert.equal(runner.api.openingPokemon(doll), true);
  assert.equal(runner.api.openingPokemon({...doll,cardNumber:'60'}), false);
  const old = structuredClone(doll);
  old.meta.effect = electrode.meta.abilities[0].effect;
  assert.equal(runner.api.openingPokemon(old), false);
  assert.equal(runner.api.repairMetadata(old), true);
  assert.equal(old.meta.effect,doll.meta.effect);
  assert.equal(runner.api.openingPokemon(old), true);
});

test('the new deck export repairs all 42 Japanese print records', async () => {
  const prints = [
    ["SVM","64","Riolu","Pokemon"],
    ["SVM","65","Lucario ex","Pokemon"],
    ["SVM","66","Hippopotas","Pokemon"],
    ["SVM","67","Hippowdon","Pokemon"],
    ["SVM","68","Croagunk","Pokemon"],
    ["SVM","69","Toxicroak","Pokemon"],
    ["SVM","81","Bronzor","Pokemon"],
    ["SVM","82","Bronzong","Pokemon"],
    ["SVM","102","Buneary","Pokemon"],
    ["SVM","103","Lopunny","Pokemon"],
    ["SVM","83","Dialga ex","Pokemon"],
    ["MC","503","Heatran","Pokemon"],
    ["SVM","105","Shaymin","Pokemon"],
    ["SV5A","86","Lucian","Trainer"],
    ["SV4M","85","Roark","Trainer"],
    ["SVM","139","Rigid Band","Trainer"],
    ["SVM","7","Petilil","Pokemon"],
    ["SVM","8","Lilligant","Pokemon"],
    ["SVM","9","Foongus","Pokemon"],
    ["SVM","10","Amoonguss ex","Pokemon"],
    ["SVM","20","Larvesta","Pokemon"],
    ["SVM","21","Volcarona","Pokemon"],
    ["SVM","107","Minccino","Pokemon"],
    ["SVM","108","Cinccino","Pokemon"],
    ["SVM","11","Durant","Pokemon"],
    ["SVM","12","Virizion","Pokemon"],
    ["SVM","18","Victini","Pokemon"],
    ["SV5K","9","Heatmor","Pokemon"],
    ["SVM","22","Reshiram ex","Pokemon"],
    ["SVM","106","Audino","Pokemon"],
    ["SVP","10","null","Trainer"],
    ["SVAW","19","Vital Band","Trainer"],
    ["SVEL","5","Fuecoco","Pokemon"],
    ["SVEL","6","Crocalor","Pokemon"],
    ["SVEL","1","Magmar","Pokemon"],
    ["SVEL","2","Magmortar","Pokemon"],
    ["SVEL","4","Volcanion","Pokemon"],
    ["S12A","183","null","Pokemon"],
    ["SVEL","3","Heat Rotom","Pokemon"],
    ["SVP","247","Pokegear","Trainer"],
    ["SVG","32","Super Rod","Trainer"],
    ["S9","127","Magma Basin","Trainer"],
  ];
  const runner = createEngineRunner(fixture);
  runner.api.loadSavedLibrary(prints.map(([setCode, cardNumber, name, categoryHint]) => ({
    id: setCode + ' ' + cardNumber, setCode, cardNumber, name, categoryHint, meta: null
  })));
  await runner.api.checkLibrary();
  const audit = runner.api.libraryAudit();
  for (const [setCode, cardNumber] of prints) {
    const id = setCode + ' ' + cardNumber;
    const record = audit.find(card => card.id === id);
    assert.equal(record?.status, 'implemented', id);
    assert.equal(record.meta.language, 'ja', id);
  }
});

test('the saved batch resolves every print', async () => {
  const runner = createEngineRunner(fixture);
  runner.api.loadSavedLibrary(structuredClone(cards));
  await runner.api.checkLibrary();
  const audit = runner.api.libraryAudit();
  for (const original of cards) {
    const resolved = audit.find(card => card.id === original.id);
    const expected = 'implemented';
    assert.equal(resolved?.status, expected, original.name + ' ' + original.setCode + ' ' + original.cardNumber);
  }
});

for (const removal of ['discard', 'knockout']) {
  test('Snorlax Doll enters during setup and awards no Prize on ' + removal, async () => {
    const runner = createEngineRunner(fixture);
    runner.api.setup(fixture, runner.random, runner.choose, () => true);
    runner.api.setLocalAi(false);
    const game = runner.api.state();
    const { you, codex } = game.players;
    const doll = structuredClone(cards.find(card => card.name === 'Snorlax Doll'));
    assert.equal(runner.api.openingPokemon(doll), true);
    assert.equal(runner.api.openingPokemon({...doll,cardNumber:'176'}), false);
    assert.equal(runner.api.openingPokemon({...doll,meta:{...doll.meta,effect:doll.meta.effect+' Draw a card.'}}), false);
    you.bench.push(you.active);
    you.active = null;
    you.hand.push(doll);
    you.openingBasicIds.push(doll.id);
    game.phase = 'setup';
    runner.api.placeActive('you', doll.id);
    assert.equal(you.active, doll);
    assert.equal(runner.api.effectiveHp(doll), 120);
    assert.equal(runner.api.discardOpeningDoll('you', doll), false);
    game.phase = 'play';
    game.turn = 'you';
    assert.equal(runner.api.canRetreat('you'), false);
    assert.equal(runner.api.applyCondition(doll, {type:'poisoned',appliedTurn:1}), false);
    const prizes = codex.prizes.length;
    if (removal === 'discard') assert.equal(runner.api.discardOpeningDoll('you', doll), true);
    else await runner.api.damagePokemon('codex','you',doll,'active',120);
    assert.equal(codex.prizes.length, prizes);
    assert.equal(game.pendingPromotion, 'you');
    assert.equal(you.discard.find(card => card.id === doll.id).meta.category, 'Trainer');
    const discarded = you.discard.find(card => card.id === doll.id);
    you.discard.splice(you.discard.indexOf(discarded), 1);
    you.hand.push(discarded);
    game.pendingPromotion = null;
    you.active = you.bench.shift();
    await runner.api.playCard('you', discarded.id);
    assert.ok(you.hand.includes(discarded), 'the Doll cannot re-enter play after setup');
  });
}

test('the three verified placeholder names repair automatically without changing print identity', async () => {
  const runner = createEngineRunner(fixture);
  const placeholders = cards.filter(card => card.name === 'null');
  const wrongPrint = { ...placeholders[0], id: 'unverified-placeholder', cardNumber: '999' };
  const wrongType = { ...placeholders[1], id: 'wrong-category', categoryHint: 'Pokemon' };
  runner.api.loadSavedLibrary(structuredClone([...placeholders, wrongPrint, wrongType]));
  await runner.api.checkLibrary();
  const audit = runner.api.libraryAudit();
  for (const original of placeholders) {
    const resolved = audit.find(card => card.id === original.id);
    assert.equal(resolved?.status, 'implemented', original.id);
    assert.equal(resolved.name, { SVJP: 'Superior Energy Retrieval', WCS23: 'Exp. Share', XY: 'Double Dragon Energy' }[original.setCode]);
    assert.equal(resolved.meta.language, 'ja');
    assert.ok(resolved.meta.image);
  }
  assert.ok(!audit.some(card => [wrongPrint.id, wrongType.id].includes(card.id)));
});

test('Japanese Ultra Ball fails closed for edited text or the wrong source print', async () => {
  const runner = createEngineRunner(fixture);
  const original = structuredClone(cards.find(card => card.name === 'Ultra Ball' && card.setCode === 'M2A'));
  assert.equal(runner.api.repairMetadata(original), true);
  for (const changed of [
    { ...original.meta, effect: original.meta.effect.replace('2', '1') },
    { ...original.meta, sourceUrl: original.meta.sourceUrl.replace('/216?', '/215?') }
  ]) {
    runner.api.loadSavedLibrary([{ ...original, meta: changed }]);
    await runner.api.checkLibrary();
    assert.equal(runner.api.libraryAudit().find(card => card.id === original.id).status, 'registered');
  }
});

test('Miltank unlocks Moomoo Rolling for its next turn by using Rollout', async () => {
  const runner = createEngineRunner(fixture);
  runner.api.setup(fixture, runner.random, runner.choose, () => true);
  runner.api.setLocalAi(false);
  const game = runner.api.state();
  game.phase = 'play';
  game.turn = 'you';
  game.turnNumber = 5;
  const player = game.players.you;
  player.turnsTaken = 2;
  const miltank = structuredClone(cards.find(card => card.name === 'Miltank'));
  assert.equal(runner.api.repairMetadata(miltank), true);
  const energy = player.deck.find(card => card.meta.category === 'Energy');
  assert.ok(energy);
  player.deck = player.deck.filter(card => card !== energy);
  if (player.active) player.deck.push(player.active);
  player.active = {
    ...miltank, damage: 0, energy: [energy, { ...energy, id: 'extra-energy' }],
    tools: [], conditions: [], evolutionStack: [], enteredTurn: 0
  };
  game.players.codex.active.meta.hp = 9999;
  const legal = () => runner.api.attackOptions('you').some(attack => attack.index === 1);
  assert.equal(legal(), false);
  assert.equal(await runner.api.attack('you', 0), true);
  assert.equal(player.active.prerequisiteAttackTurn, 5);
  game.turn = 'you';
  game.turnNumber = 7;
  player.attackedThisTurn = false;
  assert.equal(legal(), true);
  game.turnNumber = 9;
  assert.equal(legal(), false);
});

for (const heads of [true, false]) {
  test('Japanese Crushing Hammer resolves ' + (heads ? 'heads after the coin is shown' : 'tails without target choices'), async () => {
    const runner = createEngineRunner(fixture);
    runner.api.setup(fixture, runner.random, runner.choose, () => heads);
    runner.api.setLocalAi(false);
    const game = runner.api.state();
    game.phase = 'play';
    game.turn = 'you';
    const { you, codex } = game.players;
    const hammer = structuredClone(cards.find(card => card.name === 'Crushing Hammer'));
    assert.equal(runner.api.repairMetadata(hammer), true);
    you.hand.push(hammer);
    const energy = codex.deck.find(card => card.meta.category === 'Energy');
    assert.ok(energy);
    codex.deck = codex.deck.filter(card => card !== energy);
    codex.active.energy = [energy];
    const sequence = [];
    runner.api.setChoices(runner.random, choice => {
      sequence.push(choice.kind);
      assert.ok(codex.active.energy.includes(energy));
      return choice.kind === 'cards' ? [energy.id] : codex.active.id;
    }, () => heads, () => {
      sequence.push('coin');
      assert.ok(codex.active.energy.includes(energy));
    });
    await runner.api.playCard('you', hammer.id);
    assert.deepEqual(sequence, heads ? ['coin', 'pokemon-target', 'cards'] : ['coin']);
    assert.ok(you.discard.includes(hammer));
    assert.equal(codex.discard.includes(energy), heads);
    assert.equal(codex.active.energy.includes(energy), !heads);
  });
}

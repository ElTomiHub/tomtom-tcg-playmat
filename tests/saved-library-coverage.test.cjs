const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadFixture, createEngineRunner } = require('./integration-harness.cjs');
const extra = require('./fixtures/additional-library-cards.fixture.json').cards;
const base = loadFixture();
const fixture = {...base, cards: [...base.cards, ...extra]};
function legacyCards() {
  return fixture.cards.map(original=>{
    const c=structuredClone(original);c.id='legacy:'+c.setCode+':'+c.cardNumber;
    delete c.language; delete c.meta.language; delete c.meta.attackMetadataStatus;
    for(const attack of c.meta.attacks) delete attack.effectTextStatus;
    c.implementationStatus='registered';
    return c;
  });
}
function setup(side='you',record=extra[0],heads=true) {
  const r=createEngineRunner(fixture,87);r.api.setup(fixture,r.random,r.choose,()=>heads);r.api.setLocalAi(false);
  const g=r.api.state(),p=g.players[side];g.phase='play';g.turn=side;g.pendingPromotion=null;p.turnsTaken=1;p.supporterPlayedThisTurn=false;
  const c={...structuredClone(record),id:'test:'+record.setCode+':'+record.cardNumber,energy:[],tools:[],conditions:[],evolutionStack:[],damage:0,enteredTurn:0};
  if(c.meta.category==='Pokemon'){p.deck.push(p.active);p.active=c;}else p.hand.push(c);
  return {r,g,p,c};
}
const zones=g=>JSON.stringify({players:g.players,turn:g.turn,turnNumber:g.turnNumber,pendingPromotion:g.pendingPromotion});
function energy(id,type='Colorless'){return {id,name:type+' Energy',meta:{category:'Energy',energyType:type}};}
function attackBy(c,name){return c.meta.attacks.findIndex(a=>a.name===name);}

test('all 76 verified fixture printings have complete engine support',()=>{
  const audit=createEngineRunner(fixture).api.inspectFixture(fixture);assert.equal(audit.length,76);assert.deepEqual(audit.filter(c=>c.resolution!=='automated').map(c=>c.name),[]);
});
test('loading and Update all cards migrate legacy English metadata without changing saved text',async()=>{
  const r=createEngineRunner(fixture);const cards=legacyCards();r.api.loadSavedLibrary(cards);const counts=await r.api.checkLibrary();
  assert.equal(counts.registered,0);assert.equal(counts.implemented,76);
  const loaded=r.api.libraryAudit();assert.equal(loaded.length,76);
  for(const c of loaded){assert.equal(c.status,'implemented',c.name);const old=cards.find(x=>x.id===c.id);assert.equal(c.meta.effect,old.meta.effect);assert.equal(JSON.stringify(c.meta.attacks),JSON.stringify(old.meta.attacks));}
  const stored=JSON.parse(r.context.localStorage.getItem('codexPokemonPlaymat.cards.v1'));assert.ok(stored.filter(c=>c.meta).every(c=>c.implementationStatus==='implemented'));
});
test('missing language remains rejected without matching English-source evidence, and explicit non-English is preserved',async()=>{
  for(const image of ['', 'https://assets.tcgdex.net/ja/sv/sv01/180/low.webp','https://assets.tcgdex.net.evil.test/en/sv/sv01/180/low.webp','https://assets.tcgdex.net/en/sv/sv01/999/low.webp']) {
    const r=createEngineRunner(fixture),c=legacyCards().find(c=>c.name==='Nemona');c.meta.image=image;r.api.loadSavedLibrary([c]);await r.api.checkLibrary();assert.equal(r.api.libraryAudit()[0].status,'registered');
  }
  const r=createEngineRunner(fixture),c=legacyCards().find(c=>c.name==='Nemona');c.language='ja';r.api.loadSavedLibrary([c]);await r.api.checkLibrary();assert.equal(r.api.libraryAudit()[0].language,'ja');assert.equal(r.api.libraryAudit()[0].status,'registered');
});
test('pending exports now report engine version, language and metadata source',async()=>{
  const r=createEngineRunner(fixture),c=legacyCards().find(c=>c.name==='Nemona');c.meta.effect+=' Draw a card.';r.api.loadSavedLibrary([c]);
  const payload=JSON.parse(await r.api.pendingLibraryExport());assert.equal(payload.engineVersion,'2026-11-03-resume-effects-ai');assert.equal(payload.cards.length,1);assert.equal(payload.cards[0].language,'en');assert.ok(payload.cards[0].metadataSource);
});
for(const original of extra) test(original.name+' '+original.setCode+' '+original.cardNumber+' rejects mismatched print, language, or added text',()=>{
  for(const field of ['print','language','text']){const changed=structuredClone(fixture),c=changed.cards.find(c=>c.name===original.name&&c.setCode===original.setCode&&c.cardNumber===original.cardNumber);if(field==='print')c.cardNumber='999';else if(field==='language')c.language='ja';else if(c.meta.category==='Trainer')c.meta.effect+=' Draw a card.';else c.meta.attacks[0].effect+=' Draw a card.';
    const audit=createEngineRunner(changed).api.inspectFixture(changed).find(x=>x.name===c.name&&x.setCode===c.setCode&&x.cardNumber===c.cardNumber);assert.notEqual(audit.resolution,'automated');
  }
});
for(const original of extra.filter(c=>c.meta.category==='Pokemon')) for(const [index,attack] of original.meta.attacks.entries()) {
  for(const side of ['you','codex']) test(original.name+' '+attack.name+' resolves for '+side,async()=>{
    const {r,g,p,c}=setup(side,original);c.energy=attack.cost.map((type,i)=>energy('payment:'+i,type));const other=g.players[side==='you'?'codex':'you'];other.active.meta.hp=9999;
    if(attack.name==='Reflect Energy'){p.bench=[{...structuredClone(extra.find(x=>x.name==='Buneary')),id:'bench',energy:[],tools:[],conditions:[],damage:0}];}
    if(attack.name==='Beckon'){const supporter={...structuredClone(base.cards.find(x=>x.name==='Nemona')),id:'recovery'};p.discard.push(supporter);}
    r.api.setChoices(r.random,request=>request.kind==='cards'?request.candidates.slice(0,request.minCount||1).map(x=>x.id):request.candidates?.[0]||request.defaultValue,()=>true);
    const costCount=r.context.integrationApi.attackOptions(side).find(a=>a.index===index);assert.ok(costCount,'attack must be legal');
    const ids=attack.name==='Scorching Fire'?[c.energy[0].id]:[];
    assert.equal(await r.api.attack(side,index,ids),true);assert.equal(p.attackedThisTurn,true);
    assert.equal(g.turn,side==='you'?'codex':'you');
    if(attack.effect.includes('Poisoned'))assert.ok(other.active.conditions.some(x=>x.type==='poisoned'));
    if(attack.name==='Iron Buster')assert.equal(c.cannotAttackUntilTurn,g.turnNumber+1);
    if(attack.name==='Tornado Rush')assert.equal(c.nextTurnAttackBonus.activeTurn,g.turnNumber+1);
    if(attack.name==='Reflect Energy')assert.equal(p.bench[0].energy.length,1);
    if(attack.name==='Scorching Fire')assert.equal(c.energy.length,2);
    if(attack.name==='Beckon')assert.ok(p.hand.some(x=>x.id==='recovery'));
    if(attack.name==='Licking Flames')assert.equal(c.energy.length,3);
  });
}

for(const name of ["Professor's Research",'Professor Juniper']) test(name+' discards the entire remaining hand, draws seven, and consumes the Supporter',async()=>{
  const {r,g,p,c}=setup('you',extra.find(c=>c.name===name)),old=p.hand.filter(x=>x!==c),beforeDeck=p.deck.length;
  await r.api.playCard('you',c.id);assert.ok(old.every(x=>p.discard.includes(x)));assert.ok(p.discard.includes(c));assert.equal(p.hand.length,Math.min(7,beforeDeck));assert.equal(p.supporterPlayedThisTurn,true);
});
test('Lucian uses independent coin results after bottoming both hands, preserving the old deck tops',async()=>{
  const {r,g,p,c}=setup('you',extra.find(c=>c.name==='Lucian')),op=g.players.codex,a=p.deck.slice(-6).map(c=>c.id).reverse(),b=op.deck.slice(-3).map(c=>c.id).reverse(),flips=[true,false];
  r.api.setChoices(r.random,r.choose,()=>flips.shift());await r.api.playCard('you',c.id);assert.deepEqual(p.hand.map(c=>c.id),a);assert.deepEqual(op.hand.map(c=>c.id),b);assert.equal(flips.length,0);
});
test('Lucian does not flip or draw when neither player bottoms any cards',async()=>{
  const {r,g,p,c}=setup('you',extra.find(c=>c.name==='Lucian')),op=g.players.codex;p.deck.push(...p.hand.filter(x=>x!==c));p.hand=[c];op.deck.push(...op.hand.splice(0));let flips=0;
  r.api.setChoices(r.random,r.choose,()=>{flips++;return true});await r.api.playCard('you',c.id);assert.equal(flips,0);assert.equal(p.hand.length+op.hand.length,0);
});
test('Roark draws two before offering Basic Energy recovery and rejects a stale or invalid recovery atomically',async()=>{
  for(const valid of [true,false]){const {r,g,p,c}=setup('you',extra.find(c=>c.name==='Roark')),recovered=energy('recover','Water');p.discard.push(recovered);const before=zones(g),beforeHand=p.hand.length;
    r.api.setChoices(r.random,request=>{assert.equal(p.hand.length,beforeHand+1);return valid?[recovered.id]:['invalid']});await r.api.playCard('you',c.id);
    if(valid){assert.ok(p.hand.includes(recovered));assert.ok(p.discard.includes(c));assert.equal(p.hand.length,beforeHand+2)}else assert.equal(zones(r.api.state()),before);
  }
});
for(const name of ["Professor's Research",'Professor Juniper','Lucian','Roark','Ghetsis',"Black Belt's Training"]) test(name+' restores zones and Supporter allowance after a failed shared transaction',async()=>{
  const {r,g,p,c}=setup('you',extra.find(c=>c.name===name)),before=zones(g),restore=r.api.failNextSupporterAfterResolve();await r.api.playCard('you',c.id);restore();assert.equal(zones(r.api.state()),before);
});
test('Ghetsis shuffles only opposing Items into their deck and draws the same number',async()=>{
  const {r,g,p,c}=setup('you',extra.find(c=>c.name==='Ghetsis')),op=g.players.codex;
  op.deck.push(...op.hand.splice(0));const item={...structuredClone(base.cards.find(c=>c.name==='Switch')),id:'item'},tool={...structuredClone(extra.find(c=>c.name==='Rigid Band')),id:'tool'},supporter={...structuredClone(extra.find(c=>c.name==='Roark')),id:'supporter'};op.hand=[item,tool,supporter];const hand=p.hand.length;
  await r.api.playCard('you',c.id);assert.ok(op.deck.includes(item));assert.deepEqual(op.hand.map(c=>c.id),['tool','supporter']);assert.equal(p.hand.length,hand);assert.ok(p.discard.includes(c));
});
for(const heads of [true,false]) test('Poké Ball '+(heads?'heads searches one Pokémon and shuffles':'tails discards without searching or shuffling'),async()=>{
  const {r,g,p,c}=setup('you',extra.find(c=>c.name==='Poké Ball'),heads),before=p.deck.map(c=>c.id);let choice=0;r.api.setChoices(r.random,request=>{choice++;return [request.candidates[0].id]},()=>heads);
  await r.api.playCard('you',c.id);assert.ok(p.discard.includes(c));assert.equal(choice,heads?1:0);assert.equal(p.deck.length,before.length-(heads?1:0));if(!heads)assert.deepEqual(p.deck.map(c=>c.id),before);
});
test('Poké Ball rollback restores its coin search and Item zones on failure',async()=>{
  const {r,g,p,c}=setup('you',extra.find(c=>c.name==='Poké Ball')),before=zones(g),restore=r.api.failNextItemAfterResolve();await r.api.playCard('you',c.id);restore();assert.equal(zones(r.api.state()),before);
});
for(const ex of [true,false]) test('Black Belt and Vitality Band apply before Weakness '+(ex?'against Pokémon ex':'against ordinary Pokémon'),async()=>{
  const record=extra.find(c=>c.name==='Riolu'),{r,g,p,c}=setup('you',record),target=g.players.codex.active;c.energy=[energy('fighting','Fighting')];target.name=ex?'Target ex':'Target';target.meta.hp=9999;target.meta.weaknesses=[{type:'Fighting',value:'×2'}];target.meta.resistances=[];
  const belt={...structuredClone(extra.find(c=>c.name==="Black Belt's Training")),id:'belt'},band={...structuredClone(extra.find(c=>c.name==='Vitality Band')),id:'band'};p.hand.push(belt,band);r.api.setChoices(r.random,request=>request.kind==='pokemon-target'?c.id:[c.id],()=>false);
  await r.api.playCard('you',belt.id);await r.api.playCard('you',band.id);assert.equal(await r.api.attack('you',0),true);assert.equal(target.damage,(10+10+(ex?40:0))*2);
});
test('Sunny Day stacks for Grass/Fire attacks and Protective Bell stacks after Weakness, including on the Bench',async()=>{
  const {r,g,p,c}=setup('you',extra.find(c=>c.name==='Petilil')),op=g.players.codex;c.energy=[energy('g','Grass'),energy('c')];op.active.meta.hp=9999;op.active.meta.weaknesses=[{type:'Grass',value:'×2'}];op.active.meta.resistances=[];
  p.bench=[1,2].map(i=>({...structuredClone(extra.find(x=>x.name==='Lilligant')),id:'lilligant'+i,energy:[],tools:[],conditions:[],damage:0}));op.bench=[1,2].map(i=>({...structuredClone(extra.find(x=>x.name==='Bronzong')),id:'bronzong'+i,energy:[],tools:[],conditions:[],damage:0}));
  assert.equal(await r.api.attack('you',0),true);assert.equal(op.active.damage,(30+40)*2-20);
  await r.api.damagePokemon('you','codex',op.bench[0],'bench',50);assert.equal(op.bench[0].damage,30);
});
test('Rigid Band can attach to a Basic; its reduction applies only at Stage 1',async()=>{
  const {r,g,p,c}=setup('you',extra.find(c=>c.name==='Riolu')),tool={...structuredClone(extra.find(c=>c.name==='Rigid Band')),id:'band'};p.hand.push(tool);c.meta.hp=9999;c.meta.weaknesses=[];c.meta.resistances=[];
  r.api.setChoices(r.random,request=>request.kind==='pokemon-target'?c.id:[c.id]);await r.api.playCard('you',tool.id);assert.ok(c.tools.includes(tool));await r.api.damagePokemon('codex','you',c,'active',100);assert.equal(c.damage,100);c.meta.stage='Stage1';await r.api.damagePokemon('codex','you',c,'active',100);assert.equal(c.damage,170);c.meta.stage='Stage2';await r.api.damagePokemon('codex','you',c,'active',100);assert.equal(c.damage,270);
});
for(const heads of [true,false]) test('Heatmor discards one physical Energy per tails from three coins ('+(heads?'all heads':'all tails')+')',async()=>{
  const {r,g,p,c}=setup('you',extra.find(c=>c.name==='Heatmor'));c.energy=[energy('r1','Fire'),energy('r2','Fire'),energy('c')];g.players.codex.active.meta.hp=9999;r.api.setChoices(r.random,request=>request.candidates.map(x=>x.id),()=>heads);
  assert.equal(await r.api.attack('you',1),true);assert.equal(c.energy.length,heads?3:0);assert.equal(p.discard.filter(c=>['r1','r2','c'].includes(c.id)).length,heads?0:3);
});
for(const heads of [true,false]) test('Durant Energy discard follows the coin ('+(heads?'heads':'tails')+')',async()=>{
  const {r,g,p,c}=setup('you',extra.find(c=>c.name==='Durant')),op=g.players.codex;c.energy=[energy('g','Grass'),energy('c')];op.active.meta.hp=9999;op.active.energy=[energy('defender','Water')];r.api.setChoices(r.random,request=>[request.candidates[0].id],()=>heads);
  assert.equal(await r.api.attack('you',0),true);assert.equal(op.active.energy.length,heads?0:1);assert.equal(op.discard.some(c=>c.id==='defender'),heads);
});
test('Victini discards Special Energy while preserving Basic Energy',async()=>{
  const {r,g,p,c}=setup('you',extra.find(c=>c.name==='Victini')),op=g.players.codex;c.energy=[energy('r','Fire')];op.active.meta.hp=9999;op.active.energy=[energy('basic','Water'),{id:'special',name:'Double Dragon Energy',meta:{category:'Energy'}}];r.api.setChoices(r.random,request=>['special']);
  assert.equal(await r.api.attack('you',1),true);assert.deepEqual(op.active.energy.map(c=>c.id),['basic']);assert.ok(op.discard.some(c=>c.id==='special'));
});
test('Chatot searches at most available Bench slots and revealing the deck requires finishing the attack',async()=>{
  for(const cancel of [true,false]){const {r,g,p,c}=setup('you',extra.find(c=>c.name==='Chatot'));c.energy=[energy('c')];p.bench=[];
    const before=zones(g);if(cancel){r.api.setChoices(r.random,undefined);const playing=r.api.attack('you',0);assert.equal(r.api.pendingChoices(),true);r.api.cancelActiveCardChoice();assert.equal(r.api.pendingChoices(),true);r.api.confirmRawChoice([]);assert.equal(await playing,true);assert.equal(r.api.state().players.you.bench.length,0)}
    else{r.api.setChoices(r.random,request=>{assert.ok(request.candidates.every(c=>c.meta.stage==='Basic'));return request.candidates.slice(0,3).map(c=>c.id)});assert.equal(await r.api.attack('you',0),true);assert.equal(p.bench.length,3)}
  }
});
test('Lucario Tornado Rush bonus is tied to the next turn and matching attack',async()=>{
  const {r,g,p,c}=setup('you',extra.find(c=>c.name==='Lucario ex'));c.energy=[energy('f','Fighting'),energy('c')];const op=g.players.codex;op.active.meta.hp=9999;
  assert.equal(await r.api.attack('you',1),true);assert.equal(op.active.damage,100);await r.api.endTurnFor('codex');assert.equal(await r.api.attack('you',1),true);assert.equal(op.active.damage,300);
});
test('the known complete Rare Candy and Exp. Share export wordings are supported without rewriting text',async()=>{
  const cards=legacyCards().filter(c=>['Rare Candy','Exp. Share'].includes(c.name));cards[0].meta.effect="Choose 1 of your Basic Pokémon in play. If you have a Stage 2 card in your hand that evolves from that Pokémon, put that card onto the Basic Pokémon to evolve it, skipping the Stage 1. You can't use this card during your first turn or on a Basic Pokémon that was put into play this turn.";cards[1].meta.effect="When your Active Pokémon is Knocked Out by damage from an attack from your opponent's Pokémon, you may move a Basic Energy from that Pokémon to the Pokémon this card is attached to.";
  const r=createEngineRunner(fixture);r.api.loadSavedLibrary(cards);await r.api.checkLibrary();for(const c of r.api.libraryAudit()){assert.equal(c.status,'implemented');assert.equal(c.meta.effect,cards.find(x=>x.id===c.id).meta.effect)}
});

for(const original of extra.filter(c=>c.meta.category==='Trainer')) test(original.name+' is selected and resolved by the AI action pipeline',async()=>{
  const {r,g,p,c}=setup('codex',original);p.deck.push(...p.hand.filter(x=>x!==c));p.hand=[c];p.bench=[];p.energyAttachedThisTurn=true;if(original.name==="Black Belt's Training"){g.players.you.active={...structuredClone(extra.find(x=>x.name==='Reshiram ex')),id:'opponent-ex',energy:[],tools:[],conditions:[],damage:0};p.active.energy=p.active.meta.attacks[0].cost.map((type,i)=>energy('ready-'+i,type));}r.api.setLocalAi(true);await r.api.aiStep();
  if(original.meta.trainerType==='Tool')assert.ok(p.active.tools.includes(c));else assert.ok(p.discard.includes(c));
  if(original.meta.trainerType==='Supporter')assert.equal(p.supporterPlayedThisTurn,true);
});
for(const original of extra.filter(c=>c.meta.category==='Pokemon')) test(original.name+' can attack through normal AI action selection',async()=>{
  const {r,g,p,c}=setup('codex',original);p.deck.push(...p.hand.splice(0));p.bench=[];p.energyAttachedThisTurn=true;
  c.energy=original.meta.attacks.flatMap(a=>a.cost).map((type,i)=>energy('ai-energy:'+i,type));g.players.you.active.meta.hp=9999;
  if(original.name==='Shaymin')p.bench.push({...structuredClone(extra.find(x=>x.name==='Buneary')),id:'ai-bench',energy:[],tools:[],conditions:[],damage:0});
  r.api.setLocalAi(true);await r.api.aiStep();assert.equal(p.attackedThisTurn,true);assert.equal(g.turn,'you');
});

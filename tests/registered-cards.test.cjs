const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadFixture, createEngineRunner } = require('./integration-harness.cjs');
const fixture = loadFixture();
function setup(side='you', heads=true) {
  const runner=createEngineRunner(fixture,87);
  runner.api.setup(fixture,runner.random,runner.choose,()=>heads);
  runner.api.setLocalAi(false);
  const game=runner.api.state(),p=game.players[side];
  game.phase='play';game.turn=side;game.pendingPromotion=null;p.turnsTaken=1;p.supporterPlayedThisTurn=false;
  return {runner,game,p};
}
function take(game,name,side='you',number) {
  for(const owner of Object.values(game.players)) for(const zone of [owner.hand,owner.deck,owner.discard,owner.prizes]) {
    const i=zone.findIndex(c=>c.name===name&&(!number||c.cardNumber===number));
    if(i>=0){const c=zone.splice(i,1)[0];game.players[side].hand.push(c);return c;}
  }
  throw Error('Missing '+name);
}
function board(game,name,side='you',number) {
  const c=take(game,name,side,number),p=game.players[side];p.hand=p.hand.filter(x=>x!==c);p.bench.push(c);return c;
}
const fingerprint=game=>JSON.stringify({players:game.players,stadium:game.stadium,stadiumUsage:game.stadiumUsage,turn:game.turn,turnNumber:game.turnNumber});
function energy(id,type='Lightning'){return {id,name:type+' Energy',meta:{category:'Energy',energyType:type}};}

for(const name of ['Drasna','Iono','Volkner','Canari','Electric Generator','Levincia','Lucky Ice Pop','Bravery Charm','Exp. Share']) {
  test(name+' rejects an unverified alternate printing or changed complete text',async()=>{
    for(const field of ['print','text']) {
      const {runner,game,p}=setup(),card=take(game,name);
      if(field==='print')card.cardNumber='999';else card.meta.effect+=' Draw a card.';
      const before=fingerprint(game);await runner.api.playCard('you',card.id);
      assert.equal(fingerprint(runner.api.state()),before);
    }
  });
}
for(const heads of [true,false]) for(const side of ['you','codex']) test('Drasna '+side+' '+(heads?'heads draws eight':'tails draws three'),async()=>{
  const {runner,game,p}=setup(side,heads),card=take(game,'Drasna',side);
  const available=p.deck.length+p.hand.length-1;
  if(side==='codex') {p.deck.push(...p.hand.filter(c=>c!==card));p.hand=[card];runner.api.setLocalAi(true);await runner.api.aiStep();}
  else await runner.api.playCard(side,card.id);
  assert.equal(p.hand.length,Math.min(available,heads?8:3));assert.ok(p.discard.includes(card));assert.equal(p.supporterPlayedThisTurn,true);
});
for(const number of ['254','80']) test('Iono '+number+' preserves deck top order and draws each player’s Prize count',async()=>{
  const {runner,game,p}=setup(),card=take(game,'Iono','you',number),op=game.players.codex;
  const ownTop=p.deck.slice(-2).map(c=>c.id),otherTop=op.deck.slice(-3).map(c=>c.id);
  p.prizes.splice(2);op.prizes.splice(3);
  await runner.api.playCard('you',card.id);
  assert.deepEqual(p.hand.map(c=>c.id),ownTop.reverse());assert.deepEqual(op.hand.map(c=>c.id),otherTop.reverse());assert.ok(p.discard.includes(card));
});
test('Iono draws nothing when neither player returns a card',async()=>{
  const {runner,game,p}=setup(),card=take(game,'Iono'),op=game.players.codex;
  p.deck.push(...p.hand.filter(c=>c!==card));p.hand=[card];op.deck.push(...op.hand.splice(0));const own=p.deck.length,other=op.deck.length;
  await runner.api.playCard('you',card.id);assert.equal(p.hand.length,0);assert.equal(op.hand.length,0);assert.equal(p.deck.length,own);assert.equal(op.deck.length,other);
});
test('Volkner searches an Item and Basic Lightning Energy, excludes other Energy',async()=>{
  const {runner,game,p}=setup(),card=take(game,'Volkner');const chosen=[];
  runner.api.setChoices(runner.random,r=>{assert.ok(r.candidates.every(c=>r.title.includes('Item')?c.meta.trainerType==='Item':c.meta.category==='Energy'&&c.name==='Lightning Energy'));chosen.push(r.candidates[0].id);return [r.candidates[0].id]});
  await runner.api.playCard('you',card.id);assert.equal(chosen.length,2);assert.ok(chosen.every(id=>p.hand.some(c=>c.id===id)));
});
test('Canari pays one other card and searches up to four Lightning Pokémon',async()=>{
  const {runner,game,p}=setup(),card=take(game,'Canari'),cost=p.hand.find(c=>c!==card);let selected=[];
  runner.api.setChoices(runner.random,r=>{if(r.title.includes('discard'))return [cost.id];assert.ok(r.candidates.every(c=>c.meta.category==='Pokemon'&&c.meta.types.includes('Lightning')));selected=r.candidates.slice(0,4);return selected.map(c=>c.id)});
  await runner.api.playCard('you',card.id);assert.ok(p.discard.includes(cost));assert.ok(p.discard.includes(card));assert.ok(selected.every(c=>p.hand.includes(c)));assert.equal(p.supporterPlayedThisTurn,true);
});
test('Canari cannot use itself as cost, and cancellation after cost choice rolls everything back',async()=>{
  for(const invalid of [true,false]){const {runner,game,p}=setup(),card=take(game,'Canari'),cost=p.hand.find(c=>c!==card),before=fingerprint(game);
    runner.api.setChoices(runner.random,r=>r.title.includes('discard')?[invalid?card.id:cost.id]:['invalid']);
    await runner.api.playCard('you',card.id);assert.equal(fingerprint(runner.api.state()),before);
  }
});
for(const heads of [true,false]) test('Lucky Ice Pop heals at most twenty and '+(heads?'returns to hand':'is discarded'),async()=>{
  const {runner,game,p}=setup('you',heads),card=take(game,'Lucky Ice Pop');p.active.damage=15;
  await runner.api.playCard('you',card.id);assert.equal(p.active.damage,0);assert.ok((heads?p.hand:p.discard).includes(card));
});
test('Lucky Ice Pop does not flip a coin when no damage was healed',async()=>{
  const {runner,game,p}=setup(),card=take(game,'Lucky Ice Pop');p.active.damage=0;let flips=0;runner.api.setChoices(runner.random,runner.choose,()=>{flips++;return true});
  await runner.api.playCard('you',card.id);assert.equal(flips,0);assert.ok(p.discard.includes(card));
});
for(const count of [0,1,2]) test('Electric Generator attaches '+count+' of the top five Energy only to Benched Lightning Pokémon',async()=>{
  const {runner,game,p}=setup(),card=take(game,'Electric Generator');const target=board(game,"Iono's Tadbulb");
  const outside=energy('outside'),top=[energy('top1'),energy('water','Water'),energy('top2'),{id:'not-energy',name:'Test',meta:{category:'Trainer'}},energy('top3')];p.deck.push(outside,...top);
  const picked=[top[0],top[2]].slice(0,count);runner.api.setChoices(runner.random,r=>r.kind==='cards'?(assert.ok(!r.candidates.some(c=>c.id===outside.id)),picked.map(c=>c.id)):r.kind==='pokemon-target'?target:r.defaultValue);
  await runner.api.playCard('you',card.id);assert.ok(picked.every(c=>target.energy.includes(c)));assert.ok(p.deck.includes(outside));assert.ok(p.discard.includes(card));assert.ok(top.filter(c=>!picked.includes(c)).every(c=>p.deck.includes(c)));
});
for(const cancel of ['cards','pokemon-target']) test('Electric Generator aborts invalid '+cancel+' choice without mutation',async()=>{
  const {runner,game,p}=setup(),card=take(game,'Electric Generator');board(game,"Iono's Tadbulb");p.deck.push(energy('top'));const before=fingerprint(game);
  runner.api.setChoices(runner.random,r=>r.kind===cancel?['invalid']:r.kind==='cards'?[r.candidates[0].id]:r.candidates?.[0]);
  await runner.api.playCard('you',card.id);assert.equal(fingerprint(runner.api.state()),before);
});
test('Levincia can be used by each side once per turn and recovers only Basic Lightning',async()=>{
  const {runner,game,p}=setup(),card=take(game,'Levincia');runner.api.placeStadium('you',card.id);
  for(const side of ['you','codex']){runner.api.state().turn=side;const owner=runner.api.state().players[side];owner.discard.push(energy(side+'1'),energy(side+'2'),energy(side+'w','Water'));runner.api.setChoices(runner.random,r=>r.candidates.slice(0,2).map(c=>c.id));
    assert.equal(await runner.api.useStadium(side),true);assert.ok(owner.hand.some(c=>c.id===side+'1'));assert.ok(owner.discard.some(c=>c.id===side+'w'));assert.equal(await runner.api.useStadium(side),false);
  }
});
test('Levincia rejects canceled and stale recovery choices',async()=>{
  for(const stale of [false,true]){const {runner,game,p}=setup(),card=take(game,'Levincia');runner.api.placeStadium('you',card.id);p.discard.push(energy('recover'));const before=fingerprint(game);
    runner.api.setChoices(runner.random,r=>{const c=r.candidates.find(c=>c.id==='recover');if(stale){p.hand.push(p.discard.splice(p.discard.indexOf(c),1)[0]);return [c.id]}return ['invalid']});
    assert.equal(await runner.api.useStadium('you'),false);assert.equal(fingerprint(runner.api.state()),before);
  }
});
test('Bravery Charm adds fifty HP only while attached to a Basic Pokémon',async()=>{
  const {runner,game,p}=setup(),card=take(game,'Bravery Charm'),target=p.active,base=runner.api.effectiveHp(target);
  runner.api.setChoices(runner.random,r=>target);await runner.api.playCard('you',card.id);assert.ok(target.tools.includes(card));assert.equal(runner.api.effectiveHp(target),base+50);target.meta.stage='Stage1';assert.equal(runner.api.effectiveHp(target),base);
});
test('Exp. Share transfers one Basic Energy to its Benched holder',async()=>{
  const {runner,game,p}=setup(),holder=board(game,'Dratini'),tool=take(game,'Exp. Share');p.hand=p.hand.filter(c=>c!==tool);holder.tools.push(tool);p.active.energy=[energy('basic'),{id:'special',name:'Double Dragon Energy',meta:{category:'Energy'}}];
  runner.api.setChoices(runner.random,r=>r.kind==='confirm'?true:[r.candidates[0].id]);await runner.api.expShare('you',p.active);assert.equal(holder.energy.length,1);assert.equal(holder.energy[0].id,'basic');assert.equal(p.active.energy.length,1);
});
for(const [name,ability] of [["Iono's Bellibolt ex",'Electric Streamer'],["Iono's Kilowattrel",'Flashing Draw'],['Dragonair','Evolutionary Guidance'],['Mega Dragonite ex','Sky Transport']]) {
  test(ability+' resolves and enforces timing/usage through the shared transaction',async()=>{
    const {runner,game,p}=setup(),source=board(game,name),target=p.active;source.energy=[energy('attached')];const handEnergy=energy('from-hand');p.hand.push(handEnergy);
    runner.api.setChoices(runner.random,r=>r.kind==='cards'?[r.candidates[0].id]:r.candidates?.[0]||r.defaultValue);
    const beforeHand=p.hand.length,beforeDeck=p.deck.length;assert.equal(await runner.api.useAbility('you',source.id,ability),true);
    if(ability==='Electric Streamer')assert.ok([p.active,...p.bench].some(c=>c.energy.some(e=>e.id===handEnergy.id)||c.energy.length>0));
    if(ability==='Flashing Draw'){assert.equal(p.hand.length,Math.max(beforeHand,Math.min(6,beforeHand+beforeDeck)));assert.equal(source.energy.length,0)}
    if(ability==='Evolutionary Guidance'){assert.equal(p.hand.length,beforeHand+1);assert.equal(p.deck.length,beforeDeck-1)}
    if(ability==='Sky Transport')assert.notEqual(p.active,target);
    if(ability!=='Electric Streamer')assert.equal(await runner.api.useAbility('you',source.id,ability),false);
    game.turn='codex';assert.equal(await runner.api.useAbility('you',source.id,ability),false);
  });
  test(ability+' rolls back after a failed resolver',async()=>{
    const {runner,game,p}=setup(),source=board(game,name);source.energy=[energy('attached')];p.hand.push(energy('hand'));const before=fingerprint(game),restore=runner.api.failNextAbilityAfterResolve();
    await runner.api.useAbility('you',source.id,ability);restore();assert.equal(fingerprint(runner.api.state()),before);
  });
}
test('Jet Cruise removes Retreat Cost only for its owner while Dragonite is in play',()=>{
  const {runner,game,p}=setup();const original=runner.api.retreatCost(p.active);assert.ok(original>0);const dragonite=board(game,'Dragonite','you','149');assert.equal(runner.api.retreatCost(p.active),0);assert.ok(runner.api.retreatCost(game.players.codex.active)>0);p.bench=p.bench.filter(c=>c!==dragonite);assert.equal(runner.api.retreatCost(p.active),original);
});
test('Dragonite ex Tera prevents Bench attack damage, but not Active damage or altered prints',async()=>{
  const {runner,game,p}=setup(),target=board(game,'Dragonite ex');await runner.api.damagePokemon('codex','you',target,'bench',100);assert.equal(target.damage,0);target.cardNumber='999';await runner.api.damagePokemon('codex','you',target,'bench',100);assert.equal(target.damage,100);target.cardNumber='159';await runner.api.damagePokemon('codex','you',target,'active',50);assert.equal(target.damage,150);
});

for(const [set,num,types,damage] of [['ASC','69',['Lightning','Lightning'],30],['ASC','72',['Lightning','Lightning','Lightning'],70],['OBF','159',['Water'],70]]) test(set+' '+num+' verified damage-only attack resolves through the engine',async()=>{
  const {runner,game}=setup();const side=set==='ASC'?'you':'codex';game.turn=side;
  const attacker=runner.api.prepareAttack(side,set,num,types),op=game.players[side==='you'?'codex':'you'];op.active.meta.hp=9999;const before=op.active.damage;
  assert.equal(await runner.api.attack(side,0),true);assert.ok(op.active.damage-before>=damage);
  const wrong=structuredClone(fixture);wrong.cards.find(c=>c.setCode===set&&c.cardNumber===num).cardNumber='999';
  // Explicit-empty metadata is retained as independent evidence; legacy blank text must require the verified print.
  const record=wrong.cards.find(c=>c.setCode===set&&c.cardNumber==='999');delete record.meta.attackMetadataStatus;record.meta.attacks[0].effectTextStatus='missing';
  assert.notEqual(createEngineRunner(wrong).api.inspectFixture(wrong).find(c=>c.setCode===set&&c.cardNumber==='999').resolution,'automated');
});
test('Ryuno Glide requires exactly two actual attached cards, deals 330, and discards them atomically',async()=>{
  for(const valid of [false,true]){const {runner,game}=setup('codex'),p=game.players.codex,attacker=runner.api.prepareAttack('codex','ASC','152',['Water','Lightning','Lightning']);game.players.you.active.meta.hp=9999;
    const before=fingerprint(game),ids=valid?attacker.energy.slice(0,2).map(c=>c.id):['invalid','invalid'];const result=await runner.api.attack('codex',0,ids);
    if(!valid){assert.equal(result,false);assert.equal(fingerprint(runner.api.state()),before)}else{assert.equal(result,true);assert.equal(attacker.energy.length,1);assert.ok(ids.every(id=>p.discard.some(c=>c.id===id)));assert.equal(game.players.you.active.damage,330)}
  }
});
test('Mise en Place attaches up to two Basic Water Energy to one Basic target and shuffles',async()=>{
  const {runner,game}=setup('codex'),p=game.players.codex,attacker=runner.api.prepareAttack('codex','SVI','62',['Water']);const target=board(game,'Dratini','codex');p.deck.push(energy('water1','Water'),energy('water2','Water'),energy('lightning'));
  runner.api.setChoices(runner.random,r=>r.kind==='cards'?['water1','water2']:r.kind==='pokemon-target'?target:r.defaultValue);
  assert.equal(await runner.api.attack('codex',0),true);assert.ok(['water1','water2'].every(id=>target.energy.some(c=>c.id===id)));assert.ok(p.deck.some(c=>c.id==='lightning'));assert.equal(attacker.energy.length,1);
});
test('Curl Up returns the attacker, Energy and Tool to hand and requests promotion',async()=>{
  const {runner,game}=setup('codex'),p=game.players.codex,attacker=runner.api.prepareAttack('codex','SVI','62',['Water']);const tool=take(game,'Exp. Share','codex');p.hand=p.hand.filter(c=>c!==tool);attacker.tools.push(tool);game.players.you.active.meta.hp=9999;const attached=attacker.energy[0];if(!p.bench.length)board(game,'Dratini','codex');
  assert.equal(await runner.api.attack('codex',1),true);assert.ok(p.hand.includes(attacker));assert.ok(p.hand.includes(attached));assert.ok(p.hand.includes(tool));assert.equal(attacker.energy.length,0);assert.ok(p.active&&p.active!==attacker);assert.equal(game.turn,'you');
});
test('Tatsugiri search cancellation and attack failure roll back zones and turn',async()=>{
  for(const failure of ['choice','transaction']){const {runner,game}=setup('codex');runner.api.prepareAttack('codex','SVI','62',['Water']);game.players.codex.deck.push(energy('water','Water'));const before=fingerprint(game);
    if(failure==='choice')runner.api.setChoices(runner.random,r=>['invalid']);else runner.api.failNextAttackEffectAfterResolve();
    assert.equal(await runner.api.attack('codex',0),false);assert.equal(fingerprint(runner.api.state()),before);
  }
});

test('all forty fixture prints are implemented; alternate designs retain individual verified identities',()=>{
  const audit=createEngineRunner(fixture).api.inspectFixture(fixture);assert.equal(audit.length,40);assert.ok(audit.every(c=>c.resolution==='automated'));
  assert.deepEqual(audit.filter(c=>c.name==='Iono').map(c=>c.handler.trainer),['bottom_hand_draw_prizes','bottom_hand_draw_prizes']);
  for(const original of fixture.cards.filter(c=>c.meta.category==='Trainer')) for(const field of ['language','text','number']) {
    const changed=structuredClone(fixture),card=changed.cards.find(c=>c.name===original.name&&c.setCode===original.setCode&&c.cardNumber===original.cardNumber);
    if(field==='language')card.language='ja';else if(field==='text')card.meta.effect+=' Draw another card.';else card.cardNumber='999';
    assert.notEqual(createEngineRunner(changed).api.inspectFixture(changed).find(c=>c.name===card.name&&c.setCode===card.setCode&&c.cardNumber===card.cardNumber).resolution,'automated');
  }
});
test('symbol notation and spelled-out Energy names match the same complete verified effect',()=>{
  const changed=structuredClone(fixture);for(const c of changed.cards){c.meta.effect=c.meta.effect.replaceAll('{L}','Lightning');for(const a of c.meta.abilities)a.effect=a.effect.replaceAll('{L}','Lightning');for(const a of c.meta.attacks)a.effect=a.effect.replaceAll('{W}','Water');}
  assert.ok(createEngineRunner(changed).api.inspectFixture(changed).every(c=>c.resolution==='automated'));
});
test('known legacy wordings match by exact identity without modifying saved text; unrelated edits stay unchanged',()=>{
  const {runner}=setup();
  const candy=structuredClone(fixture.cards.find(c=>c.name==='Rare Candy'));
  const legacy="Choose 1 of your Basic Pokémon in play. If you have a Stage 2 card in your hand that evolves from that Pokémon, put that card onto the Basic Pokémon to evolve it, skipping the Stage 1. You can't use this card during your first turn or on a Basic Pokémon that was put into play this turn.";
  candy.meta.effect=legacy;assert.equal(runner.api.repairMetadata(candy),false);assert.equal(candy.meta.effect,legacy);assert.equal(runner.api.itemStatus(candy).resolution,'automated');
  for(const change of [c=>{c.cardNumber='999'},c=>{c.language='ja'},c=>{c.meta.effect+=' Draw a card.'}]){const c=structuredClone(candy);c.meta.effect=legacy;change(c);const before=JSON.stringify(c);assert.equal(runner.api.repairMetadata(c),false);assert.equal(JSON.stringify(c),before)}
  const dragonite=structuredClone(fixture.cards.find(c=>c.name==='Dragonite ex'));dragonite.meta.rules=[];assert.equal(runner.api.repairMetadata(dragonite),true);assert.equal(dragonite.meta.rules.length,1);
});

for(const [name,ability] of [["Iono's Bellibolt ex",'Electric Streamer'],["Iono's Kilowattrel",'Flashing Draw'],['Dragonair','Evolutionary Guidance'],['Mega Dragonite ex','Sky Transport']]) test(ability+' is used through the AI action pipeline',async()=>{
  const {runner,game,p}=setup('codex'),source=board(game,name,'codex');p.deck.push(...p.hand.splice(0));source.energy=[energy('attached')];
  if(ability==='Electric Streamer')p.hand.push(energy('hand'));if(ability==='Sky Transport')p.active.damage=Math.floor(p.active.meta.hp*.6);
  runner.api.setLocalAi(true);const oldLog=new Set(game.log);await runner.api.aiStep();const added=runner.api.state().log.filter(e=>!oldLog.has(e)).map(e=>e.message);
  assert.ok(added.some(message=>message.includes(ability)),added.join('\n'));
});
test('Electric Generator AI selects eligible Energy and Benched Lightning targets',async()=>{
  const {runner,game,p}=setup('codex'),card=take(game,'Electric Generator','codex'),target=board(game,"Iono's Tadbulb",'codex');p.deck.push(...p.hand.filter(c=>c!==card));p.hand=[card];p.deck.push(energy('top1'),energy('top2'));
  runner.api.setLocalAi(true);await runner.api.aiStep();assert.ok(p.discard.includes(card));assert.ok(target.energy.length>0);
});
test('Bravery Charm can be attached to an Evolution Pokémon without granting its Basic-only bonus',async()=>{
  const {runner,game,p}=setup(),card=take(game,'Bravery Charm'),target=board(game,'Dragonair'),before=runner.api.effectiveHp(target);
  runner.api.setChoices(runner.random,r=>r.kind==='pokemon-target'?target.id:[target.id]);await runner.api.playCard('you',card.id);assert.ok(target.tools.includes(card));assert.equal(runner.api.effectiveHp(target),before);
});
test('Tool choice revalidation aborts when a target leaves play',async()=>{
  const {runner,game,p}=setup(),card=take(game,'Bravery Charm'),target=board(game,'Dragonair'),before=fingerprint(game);
  runner.api.setChoices(runner.random,r=>{p.deck.push(p.bench.splice(p.bench.indexOf(target),1)[0]);return r.kind==='pokemon-target'?target.id:[target.id]});await runner.api.playCard('you',card.id);assert.equal(fingerprint(runner.api.state()),before);
});
for(const name of ['Electric Generator','Levincia']) test(name+' real modal cancellation follows deck reveal and public-choice rules',async()=>{
  const {runner,game,p}=setup(),card=take(game,name);if(name==='Levincia'){runner.api.placeStadium('you',card.id);p.discard.push(energy('discard'))}else{board(game,"Iono's Tadbulb");p.deck.push(energy('top'))}
  const before=fingerprint(game);runner.api.setChoices(runner.random,undefined);const resolving=name==='Levincia'?runner.api.useStadium('you'):runner.api.playCard('you',card.id);assert.equal(runner.api.pendingChoices(),true);runner.api.cancelActiveCardChoice();if(name==='Electric Generator'){assert.equal(runner.api.pendingChoices(),true);runner.api.confirmRawChoice([]);await resolving;assert.ok(runner.api.state().players.you.discard.some(c=>c.id===card.id));}else{await resolving;assert.equal(fingerprint(runner.api.state()),before);}
});

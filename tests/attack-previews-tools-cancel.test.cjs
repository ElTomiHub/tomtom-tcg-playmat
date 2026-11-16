const assert=require('node:assert/strict'),{test}=require('node:test');
const {createEngineRunner,loadFixture,attackOptionEvent}=require('./integration-harness.cjs');
const base=loadFixture(),fire=require('./fixtures/fire-deck-cards.fixture.json').cards,metal=require('./fixtures/metal-and-japanese-cards.fixture.json').cards,dark=require('./fixtures/darkness-deck-cards.fixture.json').cards;
const fixture={...base,cards:[...base.cards,...fire,...metal,...dark,...require('./fixtures/additional-library-cards.fixture.json').cards,...require('./fixtures/ethan-psychic-deck-cards.fixture.json').cards]},copy=v=>JSON.parse(JSON.stringify(v));
function card(name,id=name){const source=fixture.cards.find(c=>c.name===name);assert.ok(source,'fixture contains '+name);return {...copy(source),id,energy:[],tools:[],evolutionStack:[],conditions:[],damage:0,enteredTurn:0,evolvedTurn:-1};}
function energy(id,type='Fire'){return {id,name:type+' Energy',meta:{category:'Energy',energyType:type}};}
function setup(name='Skeledirge ex'){const r=createEngineRunner(fixture,43);r.api.setup(fixture,r.random,q=>q.kind==='cards'?q.candidates.slice(0,q.maxCount||1).map(c=>c.id):r.choose(q),()=>true);r.api.setLocalAi(false);const g=r.api.state(),p=g.players.you;g.turn='you';g.turnNumber=5;g.firstPlayer='codex';g.pendingPromotion=null;p.turnsTaken=2;p.supporterPlayedThisTurn=false;const c=card(name);p.active=c;p.bench=[];const target=card('Skeledirge ex','target');target.meta.weaknesses=[];target.meta.resistances=[];g.players.codex.active=target;g.players.codex.bench=[];return {r,g,p,c,target};}
function state(r){return JSON.stringify({game:r.api.state(),backup:r.api.backup().data,visuals:r.api.visualTransitions()});}
test('previews never mutate the match, saved checkpoint, statistics, RNG or choices',()=>{const {r,c}=setup("Iono's Wattrel");c.energy=[energy('a','Lightning')];r.api.saveMatch();const before=state(r),saved=r.context.localStorage.getItem('codexPokemonPlaymat.unfinishedMatch.v1');r.api.setChoices(()=>{throw Error('Preview consumed randomness');},()=>{throw Error('Preview opened a choice');});for(let i=0;i<20;i++)assert.equal(r.api.preview('you',0).outcomes.length,2);assert.equal(state(r),before);assert.equal(r.context.localStorage.getItem('codexPokemonPlaymat.unfinishedMatch.v1'),saved);assert.equal(r.api.pendingChoices(),false);});
for(const heads of [false,true])test('coin '+(heads?'heads':'tails')+' preview agrees with the committed attack',async()=>{const {r,c,target}=setup("Iono's Wattrel");c.energy=[energy('a','Lightning')];r.api.setChoices(r.random,r.choose,()=>heads);const outcome=r.api.preview('you',0).outcomes.find(o=>o.heads===Number(heads));assert.equal(await r.api.attack('you',0),true);assert.equal(target.damage,outcome.damage);});
test('previews show missing Energy and first-turn restrictions without hiding the estimate',()=>{const {r,g,p,c}=setup();let preview=r.api.preview('you',0);assert.match(preview.reason,/Energy/);assert.equal(preview.outcomes[0].damage,160);c.energy=[energy('a'),energy('b')];g.firstPlayer='you';p.turnsTaken=0;assert.match(r.api.preview('you',0).reason,/first turn/);});
test('unsupported exact attacks show no guessed outcomes',()=>{const {r,c}=setup();c.meta.attacks[0].effect+=' Draw 100 cards.';const preview=r.api.preview('you',0);assert.equal(preview.supported,false);assert.equal(preview.outcomes,undefined);});
test('hover and focus preview different moves without attacking, and clicking uses that exact move',async()=>{
 const {r,p,c,target}=setup('Volcanion');p.hand=[];c.energy=[energy('a'),energy('b'),energy('c'),energy('d')];
 r.api.inspectPokemon('you',c.id);
 const preview=r.document.getElementById('attackPreview'), before=state(r);
 await attackOptionEvent(r,0,'pointerover');
 assert.match(preview.innerHTML,/Dual Turbo · Preview/);
 assert.match(preview.innerHTML,/attach a Basic/);
 await attackOptionEvent(r,1,'focusin');
 assert.match(preview.innerHTML,/Heavy Impact · Preview/);
 assert.equal(state(r),before);
 await r.document.getElementById('attackOptions').dispatchEvent({type:'pointerleave'});
 assert.equal(preview.hidden,true);
 await attackOptionEvent(r,1);
 assert.equal(target.damage,120);
});
test('attacks that discard attached Energy open the card picker and proceed after the choice',async()=>{
 const {r,g,p,c,target}=setup("Ethan's Cyndaquil");p.hand=[];c.energy=[energy('fire'),energy('water','Water')];
 r.api.setChoices(r.random,null);
 r.api.inspectPokemon('you',c.id);
 const before=state(r);
 const cancelled=attackOptionEvent(r,0);
 assert.equal(r.api.pendingChoices(),true);
 assert.match(r.document.getElementById('cardChoiceTitle').textContent,/Ember.*Energy to discard/);
 assert.equal(target.damage,0);
 await attackOptionEvent(r,0);
 r.api.cancelActiveCardChoice();
 await cancelled;
 assert.equal(state(r),before);
 const attack=attackOptionEvent(r,0);
 r.api.confirmRawChoice(['water']);
 await attack;
 assert.equal(target.damage,30);
 assert.deepEqual(c.energy.map(card=>card.id),['fire']);
 assert.ok(p.discard.some(card=>card.id==='water'));
 assert.equal(g.turn,'codex');
});
test('an Energy choice cannot commit an attack whose printed text changed',async()=>{
 const {r,p,c,target}=setup("Ethan's Cyndaquil");p.hand=[];c.energy=[energy('fire')];
 r.api.setChoices(r.random,null);
 r.api.inspectPokemon('you',c.id);
 const attack=attackOptionEvent(r,0);
 c.meta.attacks[0].effect+=' Altered text.';
 const before=state(r);
 r.api.confirmRawChoice(['fire']);
 await attack;
 assert.equal(target.damage,0);
 assert.equal(state(r),before);
});
test('attacking warns about legal remaining plays and Keep playing preserves the turn', async () => {
 const {r,p,c,target}=setup('Volcanion');
 c.energy=[energy('a'),energy('b'),energy('c'),energy('d')];
 p.energyAttachedThisTurn=false;
 p.hand=[energy('unused'),card('Judge')];
 r.api.inspectPokemon('you',c.id);
 const before=state(r);
 r.api.setChoices(r.random, request => {
   assert.equal(request.kind,'confirm');
   assert.match(request.title,/Attack and end your turn/);
   assert.match(request.message,/Attach Fire Energy/);
   assert.match(request.message,/Play Judge/);
   assert.doesNotMatch(request.message,/Attack with/);
   return false;
 });
 await attackOptionEvent(r,1);
 assert.equal(state(r),before);
 r.api.setChoices(r.random, () => true);
 await attackOptionEvent(r,1);
 assert.equal(target.damage,120);
});
test('Archaludon PFL 75 deals 120 and blocks Basic attack damage during the next opposing turn', async () => {
 const {r,g,p,target}=setup('Volcanion');
 const archaludon = {...target, id:'coated',name:'Archaludon',setCode:'PFL',cardNumber:'75',language:'en',
   meta:{category:'Pokemon',language:'en',source:'TCGdex',stage:'Stage1',evolveFrom:'Duraludon',hp:180,types:['Metal'],retreat:2,
     abilities:[],rules:[],attacks:[{name:'Coated Attack',cost:['Metal','Metal','Metal'],damage:120,
       effect:"During your opponent's next turn, prevent all damage done to this Pokémon by attacks from Basic Pokémon.",effectTextStatus:'present'}]},
   energy:[energy('m1','Metal'),energy('m2','Metal'),energy('m3','Metal')]};
 p.active=archaludon;
 assert.equal(r.api.inspectFixture({cards:[archaludon]})[0].implementationStatus,'implemented');
 assert.equal(await r.api.attack('you',0),true);
 assert.equal(target.damage,120);
 assert.equal(g.turn,'codex');
 const basic=card('Volcanion','basic-attacker');
 basic.energy=[energy('f1'),energy('f2'),energy('f3'),energy('f4')];
 g.players.codex.active=basic;
 assert.equal(r.api.preview('codex',1).outcomes[0].damage,0);
 await r.api.damagePokemon('codex','you',archaludon,'active',30);
 assert.equal(archaludon.damage,0);
 g.players.codex.active=target;
 await r.api.damagePokemon('codex','you',archaludon,'active',30);
 assert.equal(archaludon.damage,30);
 g.turnNumber+=2;
 g.players.codex.active=basic;
 await r.api.damagePokemon('codex','you',archaludon,'active',30);
 assert.equal(archaludon.damage,60);
});
test('damage preview applies Weakness then Resistance then reductions and reports the expected remaining HP',async()=>{const {r,g,c,target}=setup('Volcanion');c.energy=[energy('a'),energy('b'),energy('c'),energy('d')];target.meta.weaknesses=[{type:'Fire',value:'×2'}];target.meta.resistances=[{type:'Fire',value:'-30'}];target.damage=20;g.damageReductions=[{side:'codex',type:'metal',amount:30,expiresTurn:5}];const preview=r.api.preview('you',1).outcomes[0];assert.equal(preview.raw,120);assert.equal(preview.damage,180);assert.equal(preview.remaining,130);assert.equal(await r.api.attack('you',1),true);assert.equal(target.damage,200);});
test('Growl is read without being consumed by the preview',async()=>{const {r,g,c,target}=setup('Volcanion');c.energy=[energy('a'),energy('b'),energy('c'),energy('d')];g.growlReduction={expiresTurn:5,attackerPokemonId:c.id,defendingPokemonId:target.id,amount:10};const before=copy(g.growlReduction);assert.equal(r.api.preview('you',1).outcomes[0].damage,110);assert.deepEqual(copy(g.growlReduction),before);assert.equal(await r.api.attack('you',1),true);assert.equal(target.damage,110);assert.equal(r.api.state().growlReduction,null);});
test('Rigid Band is attachable to Basic Pokémon but reduces damage only on Stage 1',async()=>{for(const [stage,reduction]of [['Basic',0],['Stage 1',30],['Stage 2',0]]){const {r,c,target}=setup('Volcanion');c.energy=[energy('a'),energy('b'),energy('c'),energy('d')];target.meta.stage=stage;const tool=card('Rigid Band','band');target.tools=[tool];assert.equal(r.api.preview('you',1).outcomes[0].damage,120-reduction);assert.equal(await r.api.attack('you',1),true);assert.equal(target.damage,120-reduction);}});
test('No Weakness and ignore-defender-effects are reflected in previews',()=>{const {r,g,c,target}=setup();c.energy=[energy('a'),energy('b')];target.meta.weaknesses=[{type:'Metal',value:'×2'}];target.noWeaknessUntilTurn=5;g.damageReductions=[{side:'codex',type:'metal',amount:30,expiresTurn:5}];assert.equal(r.api.preview('you',0).outcomes[0].damage,160);delete target.noWeaknessUntilTurn;assert.equal(r.api.preview('you',0).outcomes[0].damage,320);});
test('self-damage, retaliation and attacker Knockout risk appear before attacking',()=>{const {r,c,target}=setup('Heat Rotom');c.damage=50;c.energy=[energy('a'),energy('b')];const enemy=card('Mega Scrafty ex','target');r.api.state().players.codex.active=enemy;const preview=r.api.preview('you',0).outcomes[0];assert.equal(preview.selfDamage,40);assert.equal(preview.retaliation,50);assert.equal(preview.attackerRemaining,0);assert.equal(preview.attackerKnockout,true);assert.equal(c.damage,50);assert.equal(enemy.damage,0);});
test('coin-dependent Energy discards are described without guessing the result',()=>{const {r,c}=setup('Heatmor');c.energy=[energy('a'),energy('b'),energy('c')];const preview=r.api.preview('you',1);assert.equal(preview.supported,true);assert.equal(preview.outcomes.length,1);assert.match(preview.effectText,/Flip 3 coins/);assert.equal(preview.outcomes[0].damage,130);});
test('HP strip displays Total, Damage, Remaining in order without a counter count',()=>{const {r,c}=setup('Fuecoco');c.damage=20;const html=r.api.markup(c);assert.match(html,/Total HP 80, Damage 20, Remaining HP 60/);assert.match(html,/<small>Total<\/small><b>80/);assert.match(html,/<small>Damage<\/small><b>20/);assert.match(html,/<small>Left<\/small><b>60/);assert.doesNotMatch(html,/damage · .*counter|card-tool-line/);});
test('Tool tabs are separate selectable siblings behind the Pokémon, without nested buttons',()=>{const {r,c}=setup('Fuecoco');c.tools=[card('Rigid Band','band')];const html=r.api.markup(c);assert.match(html,/pokemon-card-stack tool-peek-right/);assert.match(html,/data-attached-tool="band"/);assert.match(html,/data-tool-host="Fuecoco"/);assert.equal((html.match(/<button/g)||[]).length,2);assert.ok(html.indexOf('attached-tool-tab')<html.indexOf('class="slot-card'));assert.ok(html.includes('</button><button class="slot-card'));assert.match(r.api.markup(c,'codex'),/tool-peek-left/);});
test('four attached Tools remain individually accessible',()=>{const {r,c}=setup('Revavroom ex');c.tools=Array.from({length:4},(_,i)=>card('Rigid Band','tool'+i));const html=r.api.markup(c);for(let i=0;i<4;i++)assert.match(html,new RegExp('data-attached-tool="tool'+i+'"'));assert.equal((html.match(/data-attached-tool=/g)||[]).length,4);});
test('the Pokémon Inspector links attached Tools and the Tool Inspector shows its artwork and effect',()=>{const {r,c}=setup('Fuecoco'),tool=card('Rigid Band','band');c.tools=[tool];r.api.inspectPokemon('you',c.id);assert.match(r.document.getElementById('cardInspector').innerHTML,/inspector-tool-button/);assert.equal(r.api.inspectTool('you',c.id,tool.id),true);const html=r.document.getElementById('cardInspector').innerHTML;assert.match(html,/Rigid Band/);assert.match(html,/inspector-art/);assert.match(html,/inspector-rules/);assert.match(html,/Stage 1 Pokémon this card is attached to takes 30 less damage/);assert.equal(r.document.getElementById('attackPanel').hidden,true);assert.equal(r.document.getElementById('cardActionMenu').hidden,true);});
test('face-down setup Pokémon expose neither attached Tool identities nor artwork',()=>{const {r,g,c}=setup('Fuecoco');g.phase='setup';c.tools=[card('Rigid Band','secret-band')];const html=r.api.markup(c,'codex');assert.match(html,/Face.down/);assert.doesNotMatch(html,/Rigid Band|secret-band|data-attached-tool|MEW/);g.players.codex.active=c;assert.equal(r.api.inspectTool('codex',c.id,'secret-band'),false);});
test('Tool selection cannot consume an outstanding Pokémon target choice',async()=>{const {r,p,c}=setup('Fuecoco');c.tools=[card('Rigid Band','band')];r.api.setChoices(r.random,null);const choice=r.api.rawBoardChoice('you',[c]);assert.equal(r.api.inspectTool('you',c.id,'band'),false);r.api.cancelActiveBoardChoice();assert.equal(await choice,null);});
test('Cancel in an actual Supporter target prompt restores the card and Supporter allowance',async()=>{const {r,g,p}=setup('Fuecoco'),boss=card("Boss's Orders",'boss');p.hand.push(boss);g.players.codex.bench=[card('Magmar','bench')];r.api.setChoices(r.random,null);const before=JSON.stringify(g.players),play=r.api.playCard('you',boss.id);assert.equal(r.api.pendingChoices(),true);r.api.cancelActiveBoardChoice();await play;assert.equal(JSON.stringify(r.api.state().players),before);assert.equal(r.api.state().players.you.supporterPlayedThisTurn,false);assert.ok(r.api.state().players.you.hand.some(c=>c.id==='boss'));});
test('Cancel in an actual optional discard selection aborts the Item instead of committing an empty selection',async()=>{const {r,p}=setup('Fuecoco'),rod=card('Super Rod','rod');p.hand.push(rod);p.discard=[energy('discarded')];r.api.setChoices(r.random,null);const before=JSON.stringify(r.api.state().players),play=r.api.playCard('you',rod.id);assert.equal(r.api.pendingChoices(),true);assert.equal(r.document.getElementById('cardChoiceCancelBtn').disabled,false);r.api.cancelActiveCardChoice();await play;assert.equal(JSON.stringify(r.api.state().players),before);});
test('after a deck reveal, Cancel and Undo cannot reverse the search; explicit no selection still finishes the Item',async()=>{const {r,p}=setup('Fuecoco'),gear=card('Pokégear 3.0','gear'),supporter=card("Professor's Research",'supporter');p.hand.push(gear);p.deck.push(supporter);r.api.captureUndo();r.api.setChoices(r.random,null);const play=r.api.playCard('you',gear.id);assert.equal(r.api.pendingChoices(),true);assert.equal(r.document.getElementById('cardChoiceCancelBtn').disabled,true);assert.equal(r.document.getElementById('cardChoiceCloseBtn').disabled,true);assert.match(r.document.getElementById('cardChoiceDescription').textContent,/deck has been revealed/);assert.equal(r.document.getElementById('undoBtn').disabled,true);r.api.cancelActiveCardChoice();assert.equal(r.api.pendingChoices(),true);r.api.confirmRawChoice([]);await play;assert.ok(r.api.state().players.you.discard.some(c=>c.id==='gear'));assert.ok(r.api.state().players.you.deck.some(c=>c.id==='supporter'));});
test('a target choice after a deck reveal cannot cancel the already revealed effect',async()=>{const {r,p,c}=setup('Fuecoco');r.api.setChoices(r.random,null);const selection=r.api.rawChoice('you',[p.deck[0]],0,1);r.api.confirmRawChoice([]);await selection;const target=r.api.rawBoardChoice('you',[c]);assert.equal(r.document.getElementById('cancelBoardTargetBtn').disabled,true);r.api.cancelActiveBoardChoice();assert.equal(r.api.pendingChoices(),true);r.api.resetInformationReveal();r.api.cancelActiveBoardChoice();assert.equal(await target,null);});
test('a cancelled Retreat prompt returns normally without spending Energy or the Retreat allowance',async()=>{const {r,p,c}=setup('Fuecoco');c.energy=[energy('a'),energy('b')];p.bench=[card('Magmar','bench')];r.api.setChoices(r.random,null);const before=JSON.stringify(r.api.state().players),pending=r.api.retreatPrompt('you');assert.equal(r.api.pendingChoices(),true);r.api.cancelActiveBoardChoice();await pending;assert.equal(JSON.stringify(r.api.state().players),before);assert.equal(r.api.state().players.you.retreatedThisTurn,false);});
test('Rigid Band can actually attach to a Basic Pokémon while its reduction remains inactive',async()=>{const {r,p,c}=setup('Fuecoco'),tool=card('Rigid Band','band');p.hand.push(tool);await r.api.playCard('you',tool.id);assert.ok(r.api.state().players.you.active.tools.some(c=>c.id==='band'));assert.ok(!r.api.state().players.you.hand.some(c=>c.id==='band'));});
test('a Supporter cancelled before any deck reveal can be played successfully afterward',async()=>{const {r,g,p}=setup('Fuecoco'),boss=card("Boss's Orders",'boss');p.hand.push(boss);g.players.codex.bench=[card('Magmar','bench')];r.api.setChoices(r.random,null);const first=r.api.playCard('you',boss.id);r.api.cancelActiveBoardChoice();await first;r.api.setChoices(r.random,r.choose);await r.api.playCard('you',boss.id);assert.equal(r.api.state().players.you.supporterPlayedThisTurn,true);assert.ok(r.api.state().players.you.discard.some(c=>c.id==='boss'));assert.equal(r.api.state().players.codex.active.id,'bench');});
test('a top-deck search with no eligible card still invalidates Undo once it reports its result',async()=>{const {r,p}=setup('Fuecoco'),gear=card('Pokégear 3.0','gear');p.hand.push(gear);p.deck=[energy('only-energy')];r.api.captureUndo();await r.api.playCard('you',gear.id);assert.equal(r.document.getElementById('undoBtn').disabled,true);assert.ok(r.api.state().players.you.discard.some(c=>c.id==='gear'));});
test('attack preview includes healing before calculating retaliation Knockout risk',async()=>{const {r,c}=setup('Virizion'),defender=card('Mega Scrafty ex','defender');c.energy=[energy('g','Grass'),energy('x','Colorless')];c.damage=90;r.api.state().players.codex.active=defender;const outcome=r.api.preview('you',0).outcomes[0];assert.equal(outcome.retaliation,50);assert.equal(outcome.attackerRemaining,Number(c.meta.hp)-110);assert.equal(outcome.attackerKnockout,false);assert.equal(await r.api.attack('you',0),true);assert.equal(c.damage,110);});

test('clicking a Pokémon opens its floating actions and clicking again keeps it inspected', async () => {
 const {r,g,c}=setup("Iono's Bellibolt ex");
 r.context.window.innerHeight=800;
 const anchor=r.document.createElement('button');
 anchor.dataset={card:c.id,zone:'active',side:'you'};
 anchor.getBoundingClientRect=()=>({left:750,right:860,top:320,bottom:470,width:110,height:150});
 r.document.querySelectorAll=selector=>selector==='[data-board-side="you"] [data-card]' ? [anchor] : [];
 const center=r.document.getElementById('battleCenter');
 const menu=r.document.getElementById('cardActionMenu');
 menu.getBoundingClientRect=()=>({width:290,height:180});
 const click=()=>center.dispatchEvent({type:'click',detail:1,target:{closest:selector=>selector==='[data-card]' ? anchor : null}});

 await click();
 assert.equal(menu.hidden,false);
 assert.equal(anchor.getAttribute('aria-expanded'),'true');
 assert.equal(menu.style.getPropertyValue('--card-menu-left'),'870px');
 assert.equal(r.document.getElementById('attackPanel').hidden,false);
 assert.equal(r.document.getElementById('useAbilityBtn').hidden,false);
 await click();
 assert.equal(menu.hidden,true);
 assert.equal(anchor.getAttribute('aria-expanded'),'false');
 assert.match(r.document.getElementById('cardInspector').innerHTML,/Bellibolt/);

 await click();
 g.turnNumber++;
 r.api.render();
 assert.equal(menu.hidden,true);
});

test('clicking an Item in hand inspects it without opening a play menu', async () => {
 const {r,p}=setup();
 const item=card('Great Ball','item-to-inspect');
 p.hand.push(item);
 const hand=r.document.getElementById('handCards');
 await hand.dispatchEvent({type:'click',detail:1,target:{closest:()=>({dataset:{handCard:item.id}})}});
 assert.equal(r.document.getElementById('cardActionMenu').hidden,true);
 assert.match(r.document.getElementById('cardInspector').innerHTML,/Great Ball/);
 assert.ok(p.hand.includes(item));
});

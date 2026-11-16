const assert = require('node:assert/strict');
const {test} = require('node:test');
const {createEngineRunner,loadFixture} = require('./integration-harness.cjs');
const cards=require('./fixtures/darkness-deck-cards.fixture.json').cards;
const tick=()=>new Promise(resolve=>setImmediate(resolve));

function ready() {
  const fixture=loadFixture(),r=createEngineRunner(fixture,32);r.api.setup(fixture,r.random,r.choose,()=>true);r.api.setLocalAi(false);
  const make=(name,id=name)=>({...structuredClone(cards.find(card=>card.name===name)),id,energy:[],tools:[],evolutionStack:[],conditions:[],damage:0,enteredTurn:0,evolvedTurn:-1});
  const g=r.api.state(),p=g.players.you,trainer=make("Janine's Secret Art");
  g.turn='you';g.turnNumber=3;g.firstPlayer='codex';p.turnsTaken=1;p.supporterPlayedThisTurn=false;
  p.active=make('Seviper','active');p.bench=[make('Scraggy','bench')];p.hand=[trainer];p.discard=[];
  p.deck=['one','two'].map(id=>({id,name:'Darkness Energy',meta:{category:'Energy',energyType:'Darkness'}}));
  r.api.clearVisuals();r.api.setChoices(r.random,null);
  r.context.window.confirm=()=>{throw Error('A card effect opened a browser confirmation.');};
  return {r,g,p,trainer,el:id=>r.document.getElementById(id)};
}
const state=r=>JSON.stringify({players:r.api.state().players,history:r.api.state().matchHistory,stats:r.api.backup().data.deckStats});

test('Janine uses the docked board panel and can finish with one target before its normal deck selection',async()=>{
  const {r,p,trainer,el}=ready(),playing=r.api.playCard('you',trainer.id);await tick();
  assert.equal(el('boardTargetPrompt').hidden,false);assert.equal(el('finishBoardTargetBtn').hidden,false);
  assert.match(el('boardTargetPromptText').textContent,/Janine.*0 \/ 2/);
  r.api.selectBoardCard('you','active',p.active.id);await tick();assert.match(el('boardTargetPromptText').textContent,/1 \/ 2/);
  await el('finishBoardTargetBtn').click();await tick();assert.equal(el('boardTargetPrompt').hidden,true);assert.equal(el('finishBoardTargetBtn').hidden,true);
  assert.match(el('cardChoiceTitle').textContent,/Basic Darkness Energy/);assert.equal(el('cardChoiceCancelBtn').disabled,true);
  r.api.confirmRawChoice(['one']);await playing;
  assert.equal(p.active.energy[0].id,'one');assert.equal(p.bench[0].energy.length,0);assert.ok(p.active.conditions.some(c=>c.type==='poisoned'));assert.equal(p.supporterPlayedThisTurn,true);
});

for(const pickedFirst of [false,true])test('Cancel '+(pickedFirst?'after one target':'before choosing targets')+' restores Janine and the Supporter allowance',async()=>{
  const {r,p,trainer,el}=ready(),before=state(r),playing=r.api.playCard('you',trainer.id);await tick();
  if(pickedFirst){r.api.selectBoardCard('you','bench',p.bench[0].id);await tick();}
  await el('cancelBoardTargetBtn').click();await playing;assert.equal(state(r),before);assert.equal(r.api.state().players.you.supporterPlayedThisTurn,false);assert.equal(r.api.pendingChoices(),false);
});

test('explicitly finishing with no targets resolves the optional effect, without opening a browser popup',async()=>{
  const {r,p,trainer,el}=ready(),playing=r.api.playCard('you',trainer.id);await tick();
  await el('finishBoardTargetBtn').click();await playing;
  assert.ok(p.discard.includes(trainer));assert.equal(p.supporterPlayedThisTurn,true);assert.equal(p.active.energy.length,0);assert.equal(p.bench[0].energy.length,0);assert.equal(r.api.pendingChoices(),false);
});

test('selecting both targets proceeds directly to the existing Energy selectors and never offers the same Pokémon twice',async()=>{
  const {r,p,trainer,el}=ready(),playing=r.api.playCard('you',trainer.id);await tick();
  r.api.selectBoardCard('you','active',p.active.id);await tick();r.api.selectBoardCard('you','active',p.active.id);assert.match(el('boardTargetPromptText').textContent,/1 \/ 2/);
  r.api.selectBoardCard('you','bench',p.bench[0].id);await tick();r.api.confirmRawChoice(['one']);await tick();r.api.confirmRawChoice(['two']);await playing;
  assert.equal(p.active.energy.length,1);assert.equal(p.bench[0].energy.length,1);assert.equal(p.deck.length,0);
});

test('Finish selection stays hidden and cannot skip an ordinary mandatory board choice',async()=>{
  const {r,p,el}=ready(),choosing=r.api.rawBoardChoice('you',[p.active]);await tick();assert.equal(el('finishBoardTargetBtn').hidden,true);
  await el('finishBoardTargetBtn').click();assert.equal(r.api.pendingChoices(),true);r.api.selectBoardCard('you','active',p.active.id);assert.equal(await choosing,p.active);
});

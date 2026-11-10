const assert=require('node:assert/strict');
const {test}=require('node:test');
const vm=require('node:vm');
const {createEngineRunner,loadFixture}=require('./integration-harness.cjs');

function ready(){
  const f=loadFixture(),r=createEngineRunner(f,61);r.api.setup(f,r.random,r.choose,()=>true);r.api.setLocalAi(false);
  return {r,f,el:id=>r.document.getElementById(id)};
}
async function select(el,side,id){el(side+'RegisteredDeck').value=id;await el(side+'RegisteredDeck').dispatchEvent({type:'change'});}

test('ready deck names omit Playable and opening setup does not change saved records',async()=>{
  const {r,el}=ready(),before=JSON.stringify(r.api.backup().data.deckStats);
  await el('startGameBtn').click();
  assert.doesNotMatch(el('youRegisteredDeck').innerHTML,/ · playable/i);
  assert.equal(el('deckSelectionWarning').hidden,true);
  assert.equal(JSON.stringify(r.api.backup().data.deckStats),before);
  assert.match(el('youDeckSummary').innerHTML,/Pokémon/);
});

test('setup shows selected-deck player totals and the selected seated rivalry',async()=>{
  const {r,f,el}=ready();await el('startGameBtn').click();
  await select(el,'you',f.decks.human.id);await select(el,'codex',f.decks.ai.id);
  r.context.testIds={you:f.decks.human.id,codex:f.decks.ai.id};
  vm.runInContext(`deckStats[testIds.you]={plays:12,completed:10,wins:7,losses:3,draws:0,bySide:{you:{plays:8,completed:7,wins:5,losses:2,draws:0}},matchups:{[testIds.codex]:{completed:4,wins:3,losses:1,draws:0,bySide:{you:{completed:3,wins:2,losses:1,draws:0}}}}};renderSetupDeckRecords();`,r.context);
  assert.match(el('youDeckSummary').innerHTML,/>8<\/strong><span>Starts/);
  assert.match(el('youDeckSummary').innerHTML,/12 starts · 10 games · 7 wins · 3 losses/);
  assert.match(el('setupMatchupStats').innerHTML,/Toma wins<\/span><strong>2/);
  assert.match(el('setupMatchupStats').innerHTML,/Yami wins<\/span><strong>1/);
  assert.match(el('setupMatchupStats').innerHTML,/3 completed matches/);
  assert.match(el('setupMatchupStats').innerHTML,/All player seats · 4 games/);
});

test('coin clicks flip and reflip without starting the match; deck changes invalidate approval',async()=>{
  const {r,f,el}=ready();await el('startGameBtn').click();
  await select(el,'you',f.decks.human.id);await select(el,'codex',f.decks.ai.id);
  const before=JSON.stringify(r.api.backup().data.deckStats);
  await el('coinDisc').click();assert.match(el('coinHeadline').textContent,/Toma plays first/);assert.equal(el('startBtn').textContent,'Play match');
  await el('coinDisc').click();assert.equal(JSON.stringify(r.api.backup().data.deckStats),before);
  await select(el,'you',f.decks.ai.id);assert.equal(el('coinHeadline').textContent,'Click the coin to flip');assert.equal(el('rerollCoinBtn').disabled,true);
  await el('coinDisc').click();await el('startBtn').click();assert.equal(r.api.state().phase,'setup');assert.equal(r.api.state().deckIds.you,f.decks.ai.id);
});

test('missing data and unimplemented effects remain visible and cannot bypass deck verification',async()=>{
  const {r,f,el}=ready();await el('startGameBtn').click();
  r.context.targetId=f.decks.human.id;
  vm.runInContext(`registeredCards.find(c=>c.name==='Iono').meta.effect='Unsupported text';populateDeckSelectors();`,r.context);
  assert.match(el('youRegisteredDeck').innerHTML,/Manual effects/);
  vm.runInContext(`registeredCards.forEach(c=>c.meta=null);populateDeckSelectors();showValidation('you');showValidation('codex');`,r.context);
  assert.match(el('youRegisteredDeck').innerHTML,/Card data needed/);assert.equal(el('coinDisc').disabled,true);assert.equal(el('startBtn').disabled,true);assert.equal(el('deckSelectionWarning').hidden,false);
});

test('Random changes only Yami’s deck, updates records, resets the coin and excludes missing-data decks',async()=>{
  const {r,f,el}=ready();await el('startGameBtn').click();
  await select(el,'you',f.decks.human.id);await select(el,'codex',f.decks.human.id);
  r.context.missingDeck={id:'missing-data',name:'Incomplete deck',decklist:'60 Unknown Card TST 1'};
  vm.runInContext('registeredDecks.push(missingDeck);populateDeckSelectors();',r.context);
  await el('coinDisc').click();assert.equal(el('startBtn').textContent,'Play match');
  const before=JSON.stringify(r.api.backup().data.deckStats);
  await el('randomYamiDeckBtn').click();
  assert.equal(el('youRegisteredDeck').value,f.decks.human.id);assert.equal(el('codexRegisteredDeck').value,f.decks.ai.id);
  assert.match(el('codexDeckSummary').innerHTML,new RegExp(f.decks.ai.name));
  assert.equal(el('coinHeadline').textContent,'Click the coin to flip');assert.equal(el('rerollCoinBtn').disabled,true);
  assert.equal(JSON.stringify(r.api.backup().data.deckStats),before);
  await el('randomYamiDeckBtn').click();assert.equal(el('codexRegisteredDeck').value,f.decks.human.id);
});

test('Random is unavailable when fewer than two decks have loaded card data',async()=>{
  const {r,f,el}=ready();r.context.onlyDeckId=f.decks.human.id;
  vm.runInContext('registeredDecks=registeredDecks.filter(deck=>deck.id===onlyDeckId);',r.context);
  await el('startGameBtn').click();assert.equal(el('randomYamiDeckBtn').disabled,true);
});

test('new campaigns reserve a playable Master rival for the final round',()=>{
  const {r}=ready();
  const plan=vm.runInContext(`newCampaign('toma', [
    {id:'toma',category:'Toma'},{id:'friend-a',category:'A'},
    {id:'friend-r',category:'R'},{id:'boss',category:'Master'}])`,r.context);
  assert.equal(plan.rounds[4].deckId,'boss');
  assert.notEqual(plan.rounds[0].deckId,'boss');
  assert.equal(vm.runInContext("newCampaign('toma',[{id:'toma',category:'Master'},{id:'friend',category:'A'}])",r.context),null);
});

test('deck tags appear in setup and filter the deck manager together with search',async()=>{
  const {r,f,el}=ready();
  r.context.taggedDeckId=f.decks.ai.id;
  vm.runInContext("registeredDecks.find(deck=>deck.id===taggedDeckId).category='Master'",r.context);
  await el('menuManageDecks').click();
  el('deckLibraryCategory').value='Master';
  await el('deckLibraryCategory').dispatchEvent({type:'change'});
  assert.match(el('deckLibraryGrid').innerHTML,/\[M\]/);
  assert.equal((el('deckLibraryGrid').innerHTML.match(/data-play-deck=/g)||[]).length,1);
  el('deckLibrarySearch').value='nothing matches';
  await el('deckLibrarySearch').dispatchEvent({type:'input'});
  assert.match(el('deckLibraryGrid').innerHTML,/No decks match/);
  await el('startGameBtn').click();
  assert.match(el('codexRegisteredDeck').innerHTML,/\[M\]/);
});

test('campaign shows why starting is blocked and lets an unfinished run reach the new deck picker', async()=>{
  const {r,f,el}=ready();
  await el('menuCampaign').click();
  assert.equal(el('campaignActionBtn').disabled,true);
  assert.match(el('campaignActionStatus').textContent,/tagged Master/);
  r.context.campaignFixtureIds={you:f.decks.human.id,codex:f.decks.ai.id};
  vm.runInContext(`registeredDecks.find(deck=>deck.id===campaignFixtureIds.codex).category='Master';
    saveCampaign(newCampaign(campaignFixtureIds.you,playableCampaignDecks()));`,r.context);
  await el('menuCampaign').click();
  assert.equal(el('campaignNewRunBtn').hidden,false);
  await el('campaignNewRunBtn').click();
  assert.equal(el('campaignDeckChoice').hidden,false);
  assert.match(el('campaignActionBtn').textContent,/Replace run/);
  await el('campaignActionBtn').click();
  assert.match(el('campaignActionStatus').textContent,/unfinished match/);
});

test('campaign locks the deck, advances after losses, and awards the winning deck a badge',async()=>{
  const {r,f,el}=ready();
  vm.runInContext(`registeredDecks.find(deck=>deck.id===${JSON.stringify(f.decks.ai.id)}).category='Master'`,r.context);
  r.api.finishMatch(null,'Close initial fixture match');
  await el('menuCampaign').click();
  el('campaignDeckSelect').value=f.decks.human.id;
  const winners=['you','codex','you',null,'you'];
  const levels=['casual','competitor','competitor','competitor','master'];
  for (let round=0;round<levels.length;round++) {
    await el('campaignActionBtn').click();
    assert.equal(el('setupHeading').textContent,`Campaign · Match ${round+1} of 5`);
    assert.equal(el('setupModal').classList.contains('campaign-coin-setup'),true);
    assert.equal(el('youRegisteredDeck').disabled,true);
    assert.equal(el('randomYamiDeckBtn').disabled,true);
    await el('coinDisc').click();
    await el('startBtn').click();
    const game=r.api.state();
    assert.equal(game.deckIds.you,f.decks.human.id);
    assert.equal(game.deckIds.codex,f.decks.ai.id);
    assert.equal(game.yamiDifficulty,levels[round]);
    assert.equal(game.campaign.round,round);
    r.api.finishMatch(winners[round],'Campaign test result');
    const progress=vm.runInContext('JSON.stringify(loadCampaign().results)',r.context);
    assert.equal(JSON.parse(progress).length,round+1);
    if (round<levels.length-1) await el('matchCampaignBtn').click();
  }
  assert.match(el('campaignHeading').textContent,/Campaign victory/);
  assert.match(el('campaignDeckPreview').innerHTML,/3\/5/);
  await el('closeCampaignBtn').click();
  await el('menuManageDecks').click();
  assert.match(el('deckLibraryGrid').innerHTML,/Campaign Champion/);
  await el('startGameBtn').click();
  assert.equal(el('setupModal').classList.contains('campaign-coin-setup'),false);
  assert.equal(el('youRegisteredDeck').disabled,false);
});

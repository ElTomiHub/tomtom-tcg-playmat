const assert=require('node:assert/strict');
const {test}=require('node:test');
const vm=require('node:vm');
const {createEngineRunner,loadFixture,controlPlaymatTimers}=require('./integration-harness.cjs');

function ready(){
  const f=loadFixture(),r=createEngineRunner(f,61);r.api.setup(f,r.random,r.choose,()=>true);r.api.setLocalAi(false);
  return {r,f,el:id=>r.document.getElementById(id)};
}
async function select(el,side,id){el(side+'RegisteredDeck').value=id;await el(side+'RegisteredDeck').dispatchEvent({type:'change'});}

for(const heads of [true,false])test('opening coin automatically starts '+(heads?'Toma':'Yami')+' as the actual first player',async()=>{
  const {r,f,el}=ready();await el('startGameBtn').click();
  await select(el,'you',f.decks.human.id);await select(el,'codex',f.decks.ai.id);
  r.api.setChoices(r.random,r.choose,()=>heads);
  await el('coinDisc').click();
  assert.equal(r.api.state().phase,'setup');
  assert.equal(r.api.state().firstPlayer,heads?'you':'codex');
});

for(const first of ['you','codex'])test('manual start chooses '+first+' without flipping a coin',async()=>{
  const {r,f,el}=ready();await el('startGameBtn').click();
  await select(el,'you',f.decks.human.id);await select(el,'codex',f.decks.ai.id);
  let flips=0;r.api.setChoices(r.random,r.choose,()=>{flips++;return true;});
  assert.equal(el('startBtn').disabled,false);assert.equal(el('yamiStartsBtn').disabled,false);
  await el(first==='you'?'startBtn':'yamiStartsBtn').click();
  assert.equal(flips,0);assert.equal(r.api.state().phase,'setup');assert.equal(r.api.state().firstPlayer,first);
  assert.equal(r.api.state().openingCoin.method,'chosen');assert.equal(r.api.state().openingCoin.face,null);
});

test('opening flip reveals its result after the animation and keeps both manual starts disabled until then',async()=>{
  const {r,el}=ready();let finish;
  r.context.crypto=require('node:crypto').webcrypto;
  el('coinDisc').animate=()=>({finished:new Promise(resolve=>{finish=resolve;}),cancel(){}});
  const before=r.api.state();
  vm.runInContext('engineTestHooks=null;playmatEffectsEnabled=true;flipCoin({startOnResult:true});',r.context);
  assert.equal(el('coinHeadline').textContent,'Flipping the coin…');
  assert.equal(r.api.state(),before);assert.equal(el('startBtn').disabled,true);assert.equal(el('yamiStartsBtn').disabled,true);
  finish();await new Promise(resolve=>setImmediate(resolve));
  assert.match(el('startBtn').textContent,/^(I start first|Yami starts first)$/);
  assert.notEqual(r.api.state(),before);assert.equal(r.api.state().phase,'setup');
});

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
  assert.match(el('youDeckSummary').innerHTML,/71% wins/);
  assert.equal(el('matchupRecordsHeading').textContent,'You lead 2–1');
  assert.match(el('youDeckSummary').innerHTML,/>8<\/strong><span>Starts/);
  assert.match(el('youDeckSummary').innerHTML,/12 starts · 10 games · 7 wins · 3 losses/);
  assert.match(el('setupMatchupStats').innerHTML,/Toma wins<\/span><strong>2/);
  assert.match(el('setupMatchupStats').innerHTML,/Yami wins<\/span><strong>1/);
  assert.match(el('setupMatchupStats').innerHTML,/3 completed matches/);
  assert.match(el('setupMatchupStats').innerHTML,/All player seats · 4 games/);
});

test('changing decks before starting clears any old coin decision',async()=>{
  const {r,f,el}=ready();await el('startGameBtn').click();
  await select(el,'you',f.decks.human.id);await select(el,'codex',f.decks.ai.id);
  const before=JSON.stringify(r.api.backup().data.deckStats);
  vm.runInContext('flipCoin()',r.context);
  await select(el,'you',f.decks.ai.id);
  assert.equal(el('coinHeadline').textContent,'Flip to start');
  assert.equal(el('yamiStartsBtn').disabled,false);
  assert.equal(JSON.stringify(r.api.backup().data.deckStats),before);
  await el('coinDisc').click();assert.equal(r.api.state().phase,'setup');assert.equal(r.api.state().deckIds.you,f.decks.ai.id);
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
  vm.runInContext('flipCoin()',r.context);
  const before=JSON.stringify(r.api.backup().data.deckStats);
  await el('randomYamiDeckBtn').click();
  assert.equal(el('youRegisteredDeck').value,f.decks.human.id);assert.equal(el('codexRegisteredDeck').value,f.decks.ai.id);
  assert.match(el('codexDeckSummary').innerHTML,new RegExp(f.decks.ai.name));
  assert.equal(el('coinHeadline').textContent,'Flip to start');assert.equal(el('yamiStartsBtn').disabled,false);
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
  assert.ok(plan.rounds.slice(0,4).every(round=>round.deckId.startsWith('friend-')));
  const pools=vm.runInContext(`['regional','masters'].map(path=>newCampaign('toma',[
    {id:'toma',category:'Toma'},{id:'regional',category:'R'},{id:'boss',category:'Master'},{id:'other',category:''}],path))`,r.context);
  assert.ok(pools[0].rounds.every(round=>round.deckId==='regional'));
  assert.ok(pools[1].rounds.every(round=>round.deckId==='boss'));
  assert.equal(vm.runInContext("newCampaign('toma',[{id:'toma',category:'Master'},{id:'friend',category:'A'}])",r.context),null);
});

test('deck tags appear in setup and filter the deck manager together with search',async()=>{
  const {r,f,el}=ready();
  r.context.taggedDeckId=f.decks.ai.id;
  vm.runInContext("registeredDecks.find(deck=>deck.id===taggedDeckId).category='Master'",r.context);
  await el('menuManageDecks').click();
  const filter = el('deckLibraryCategory'), master = {dataset:{filterTag:'Master'},setAttribute(){}};
  await filter.dispatchEvent({type:'click',currentTarget:filter,target:{closest:()=>master}});
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
  assert.match(el('campaignActionStatus').textContent,/playable opponent/);
  r.context.campaignFixtureIds={you:f.decks.human.id,codex:f.decks.ai.id};
  vm.runInContext(`registeredDecks.find(deck=>deck.id===campaignFixtureIds.codex).category='Master';
    saveCampaign(newCampaign(campaignFixtureIds.you,playableCampaignDecks(),'masters'));`,r.context);
  await el('menuCampaign').click();
  assert.equal(el('campaignNewRunBtn').hidden,false);
  await el('campaignNewRunBtn').click();
  assert.equal(el('campaignDeckChoice').hidden,false);
  assert.match(el('campaignCoinLabel').textContent,/Replace run/);
  await el('campaignActionBtn').click();
  assert.match(el('campaignActionStatus').textContent,/unfinished match/);
});

test('campaign locks the deck, advances after losses, and awards the winning deck a badge',async()=>{
  const {r,f,el}=ready();
  vm.runInContext(`registeredDecks.find(deck=>deck.id===${JSON.stringify(f.decks.ai.id)}).category='Master'`,r.context);
  r.api.finishMatch(null,'Close initial fixture match');
  await el('menuCampaign').click();
  vm.runInContext("selectedCampaignPath='masters';openCampaign()",r.context);
  el('campaignDeckSelect').value=f.decks.human.id;
  const finishEffects = controlPlaymatTimers(r);
  const winners=['you','codex','you',null,'you'];
  const levels=['casual','competitor','competitor','competitor','master'];
  for (let round=0;round<levels.length;round++) {
    await el('campaignActionBtn').click();
    assert.equal(el('setupModal').classList.contains('hidden'),true);
    assert.match(el('campaignCoinLabel').textContent,/Start round/);
    const result=el('campaignActionStatus').textContent;
    assert.match(result,/plays first/);
    vm.runInContext('openCampaign()',r.context);
    assert.equal(el('campaignActionStatus').textContent,result);
    await el('campaignActionBtn').click();
    const game=r.api.state();
    assert.equal(game.deckIds.you,f.decks.human.id);
    assert.equal(game.deckIds.codex,f.decks.ai.id);
    assert.equal(game.yamiDifficulty,levels[round]);
    assert.equal(game.campaign.round,round);
    assert.equal(game.firstPlayer,result.startsWith('Heads')?'you':'codex');
    r.api.finishMatch(winners[round],'Campaign test result');
    const progress=vm.runInContext('JSON.stringify(loadCampaign().results)',r.context);
    assert.equal(JSON.parse(progress).length,round+1);
    if (round === levels.length - 1) assert.doesNotMatch(el('campaignHeading').textContent,/Campaign victory/);
    assert.equal(el('matchSummaryCard').hidden,true);
    assert.equal(el('matchCampaignBtn').hidden,true);
    finishEffects();
    assert.equal(el('campaignModal').classList.contains('hidden'),true);
    assert.equal(el('matchSummaryCard').hidden,false);
    assert.equal(el('matchCampaignBtn').hidden,false);
    await el('matchCampaignBtn').click();
    assert.equal(el('campaignModal').classList.contains('hidden'),false);
    assert.doesNotMatch(el('campaignProgress').innerHTML,/Unavailable deck/);
    assert.ok(el('campaignProgress').innerHTML.includes(f.decks.ai.name));
  }
  assert.match(el('campaignHeading').textContent,/Campaign victory/);
  assert.match(el('campaignProgress').innerHTML,/data-tier="bronze"[\s\S]*3\/5 wins/);
  assert.match(el('campaignProgress').innerHTML,/campaign-trophy[^>]*>[\s\S]*Gauntlet Veteran/);
  assert.match(el('campaignDeckPreview').innerHTML,/3\/5/);
  await el('closeCampaignBtn').click();
  await el('menuManageDecks').click();
  assert.match(el('deckLibraryGrid').innerHTML,/Campaign Champion/);
  assert.match(vm.runInContext('campaignChampionBadge(4)',r.context),/data-tier="silver"[\s\S]*4\/5 wins/);
  assert.match(vm.runInContext('campaignChampionBadge(5)',r.context),/data-tier="gold"[\s\S]*5\/5 wins/);
  const best = vm.runInContext('statsForDeck('+JSON.stringify(f.decks.human.id)+').campaign.bestWins=5;campaignDeckBadge('+JSON.stringify(f.decks.human.id)+')',r.context);
  assert.match(best,/data-tier="gold"/);
  await el('startGameBtn').click();
  assert.equal(el('setupModal').classList.contains('campaign-coin-setup'),false);
  assert.equal(el('youRegisteredDeck').disabled,false);
});

test('Statistics, Campaign and both matchup selectors follow the visible Deck Manager order',async()=>{
  const {r,el}=ready();
  vm.runInContext(`
    const testDeckOrder = [
      ['zulu','Zulu','Toma'], ['alpha','Alpha','Toma'],
      ['boss','Boss','Master'], ['untagged','Untagged','']
    ];
    registeredDecks = testDeckOrder.map(([id,name,category]) => ({...registeredDecks[0],id,name,category}));
    localStorage.setItem(DECK_ORDER_KEY,JSON.stringify(['boss','alpha','untagged','zulu']));
  `,r.context);
  const expected=['alpha','zulu','boss','untagged'];
  await el('menuManageDecks').click();
  assert.deepEqual(Array.from(el('deckLibraryGrid').innerHTML.matchAll(/data-deck-details="([^"]+)"/g),m=>m[1]),expected);

  await el('menuStatistics').click();
  const optionIds=id=>Array.from(el(id).innerHTML.matchAll(/<option value="([^"]+)"/g),m=>m[1]);
  assert.deepEqual(optionIds('statisticsDeck'),expected);
  await el('menuCampaign').click();
  assert.deepEqual(optionIds('campaignDeckSelect'),expected);
  const rowNames=sort=>Array.from(vm.runInContext('matchupStatisticsMarkup("alpha",'+JSON.stringify({sort})+')',r.context)
    .matchAll(/<th scope="row">.*?<span>([^<]+)<\/span><\/div><\/th>/g),m=>m[1]);
  assert.deepEqual(rowNames(''),['[T] Alpha','[T] Zulu','[M] Boss','Untagged']);
  assert.deepEqual(rowNames('name'),['[T] Alpha','[M] Boss','Untagged','[T] Zulu']);

  await el('startGameBtn').click();
  assert.deepEqual(optionIds('youRegisteredDeck'),expected);
  assert.deepEqual(optionIds('codexRegisteredDeck'),expected);
});

test('Revenge preselects the finished matchup and requires a fresh coin flip',async()=>{
  const {r,f,el}=ready();
  const finished=r.api.state();
  r.api.finishMatch('codex','Test result');
  r.api.clearVisuals();
  r.api.render();
  assert.equal(el('revengeMatchBtn').hidden,false);
  await el('startGameBtn').click();
  await select(el,'you',f.decks.ai.id);
  vm.runInContext('flipCoin()',r.context);
  await el('revengeMatchBtn').click();
  assert.equal(el('setupModal').classList.contains('hidden'),false);
  assert.equal(el('youRegisteredDeck').value,finished.deckIds.you);
  assert.equal(el('codexRegisteredDeck').value,finished.deckIds.codex);
  assert.equal(el('coinHeadline').textContent,'Flip to start');
  assert.equal(r.api.state(),finished);
  await el('coinDisc').click();
  assert.equal(r.api.state().phase,'setup');
  assert.equal(r.api.state().deckIds.you,finished.deckIds.you);
  assert.equal(r.api.state().deckIds.codex,finished.deckIds.codex);
});

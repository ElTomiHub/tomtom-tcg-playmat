const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadFixture, createEngineRunner } = require('./integration-harness.cjs');
function ready(dragon=false) {
  const fixture=loadFixture();if(dragon)fixture.decks.human={...fixture.decks.ai,id:'history-dragon'};else fixture.decks.ai={...fixture.decks.human,id:'history-opponent'};
  const r=createEngineRunner(fixture,951);r.api.setup(fixture,r.random,r.choose,()=>true);r.api.setLocalAi(false);const g=r.api.state();g.phase='play';g.turn='you';g.players.you.turnsTaken=1;
  return {r,fixture,g,p:g.players.you};
}
function take(p,predicate){for(const zone of [p.hand,p.deck,p.discard,p.prizes]){const i=zone.findIndex(predicate);if(i>=0)return zone.splice(i,1)[0]}return null}
const historyFor=(r,id)=>r.api.backup().data.deckStats[id].history||[];
test('the replay is captured automatically and archived only when requested after the match', async () => {
  const {r,g}=ready(), saved=new Map();
  r.context.recordingTransaction=async (_mode,work)=>{
    const requests=[];
    work({get(id){const request={result:saved.get(id)};requests.push(request);return request;},
      put(recordings,id){saved.set(id,recordings);}});
    requests.forEach(request=>request.onsuccess());
  };
  const button=r.document.getElementById('saveMatchRecordingBtn');
  assert.equal(button.hidden,true);
  g.yamiDifficulty = 'master';
  g.yamiStyle = 'control';
  assert.ok(!g.log.some(entry => /Yami (played Control|strategy:)/.test(entry.message)));
  r.api.finishMatch('you','Recording test');
  assert.equal(saved.size,0);
  assert.equal(button.hidden,false);
  await button.click();
  const [record]=saved.get(g.deckIds.you);
  assert.equal(record.yamiDifficulty,'master');
  assert.equal(record.yamiStyle,'control');
  assert.equal(r.api.matchSummary().yamiDifficulty,'master');
  assert.match(g.log[1].message,/Yami played Control on Master/);
  assert.equal(record.steps[0].phase,'setup');
  assert.equal(record.steps.at(-1).phase,'finished');
  assert.equal(button.textContent,'Recording saved');
});
test('opening Pokémon are counted once, including the automatically placed opponent Active',()=>{
  const {r,g}=ready();for(const side of ['you','codex']){const p=g.players[side];assert.equal(g.matchHistory.players[side].pokemonPlayed,[p.active,...p.bench].filter(Boolean).length);assert.equal(g.matchHistory.players[side].energyAttached,0)}assert.equal(r.api.matchSummary(),null);
});
test('Forfeit records one loss, clears the checkpoint and reveals Yami’s hand for inspection', async () => {
  const {r,g} = ready();
  const row = r.document.getElementById('codexRow');
  const opponentCard = g.players.codex.hand[0];
  assert.ok(opponentCard);
  assert.doesNotMatch(row.innerHTML, /data-revealed-hand-card/);
  assert.equal(r.api.saveMatch(), true);
  await r.document.getElementById('forfeitMatchBtn').click();
  await r.document.getElementById('forfeitMatchBtn').click();
  assert.equal(g.winner, 'codex');
  assert.equal(r.api.backup().data.deckStats[g.deckIds.you].losses, 1);
  assert.equal(r.api.backup().data.deckStats[g.deckIds.codex].wins, 1);
  assert.equal(r.context.localStorage.getItem('codexPokemonPlaymat.unfinishedMatch.v1'), null);
  assert.ok(row.innerHTML.includes('data-revealed-hand-card="' + r.context.escapeHtml(opponentCard.id) + '"'));
  await row.dispatchEvent({type:'click',target:{closest: selector => selector === '[data-revealed-hand-card]'
    ? {dataset:{revealedHandCard:opponentCard.id}} : null}});
  assert.equal(r.context.findSelected(), opponentCard);
  assert.equal(r.document.getElementById('undoBtn').disabled, true);
});
test('Cancel ends the match without changing results, matchups or archived history', async () => {
  const {r,g} = ready();
  const before = JSON.stringify(r.api.backup().data.deckStats);
  r.api.setChoices(r.random, () => false);
  await r.document.getElementById('cancelMatchBtn').click();
  assert.equal(g.phase, 'play');
  r.api.checkpointLock(true);
  r.api.setChoices(r.random, () => true);
  await r.document.getElementById('cancelMatchBtn').click();
  assert.equal(g.phase, 'play');
  r.api.checkpointLock(false);
  assert.equal(r.api.saveMatch(), true);
  await r.document.getElementById('cancelMatchBtn').click();
  assert.equal(g.phase, 'finished');
  assert.equal(r.api.matchSummary().cancelled, true);
  assert.equal(JSON.stringify(r.api.backup().data.deckStats), before);
  assert.equal(r.context.localStorage.getItem('codexPokemonPlaymat.unfinishedMatch.v1'), null);
});
test('manual Energy attachments count physical cards and reject repeated attachments without increasing history',()=>{
  const {r,p,g}=ready(),energy=take(p,c=>c.name==='Lightning Energy');p.hand.push(energy);r.api.attachFor('you',energy.id,p.active.id);assert.equal(g.matchHistory.players.you.energyAttached,1);assert.equal(g.matchHistory.players.you.energy[0].name,'Lightning Energy');
  const next=take(p,c=>c.name==='Lightning Energy');p.hand.push(next);r.api.attachFor('you',next.id,p.active.id);assert.equal(g.matchHistory.players.you.energyAttached,1);assert.ok(p.hand.includes(next));
});
test('evolution records the Pokémon card and evolution separately without recounting carried Energy',async()=>{
  const {r,p,g}=ready(true),target=r.api.prepareAttack('you','OBF','157',['Water']),evo=take(p,c=>c.name==='Dragonair');assert.ok(evo);p.hand.push(evo);const before={...g.matchHistory.players.you};
  await r.api.humanAction({type:'evolve',cardId:evo.id,targetId:target.id});assert.equal(p.active.name,'Dragonair');assert.equal(g.matchHistory.players.you.pokemonPlayed,before.pokemonPlayed+1);assert.equal(g.matchHistory.players.you.evolutions,1);assert.equal(g.matchHistory.players.you.energyAttached,before.energyAttached);
});
test('evolution animates only the incoming card and keeps the old stage, Energy and Tool in place', async () => {
  const {r,p} = ready(true);
  const target = r.api.prepareAttack('you','OBF','157',['Water']);
  const evolution = take(p, c => c.name === 'Dragonair');
  const tool = take(p, c => c.meta?.trainerType?.toLowerCase().includes('tool'));
  assert.ok(evolution && tool);
  target.tools.push(tool);
  p.hand.push(evolution);
  r.api.clearVisuals();
  await r.api.evolveFor('you', evolution.id, target.id);
  assert.equal(p.active, evolution);
  const visual = r.api.visualState();
  const movements = [visual.active, ...visual.queued].filter(effect => effect?.kind.endsWith('-move'));
  assert.deepEqual(Array.from(movements, effect => effect.cardId), [evolution.id]);
  assert.equal(evolution.tools[0], tool);
  assert.equal(evolution.energy[0], target.energy[0]);
  assert.equal(evolution.evolutionStack.at(-1).id, target.id);
});
test('final-Prize Energy Hurricane saves the final attack, Knockout turn and all post-damage Energy attachments',async()=>{
  const {r,g,p}=ready(true);r.api.prepareAttack('you','SIT','131',['Water','Lightning','Lightning','Lightning']);const target=r.api.prepareAttack('codex','ASC','152',[]);g.turn='you';target.meta.hp=1;target.meta.weaknesses=[];target.meta.resistances=[];p.prizes=p.prizes.slice(0,1);
  const turn=g.turnNumber,attached=g.matchHistory.players.you.energyAttached;r.api.setChoices(r.random,q=>q.kind==='cards'?q.candidates.slice(0,3):q.kind==='pokemon-target'?p.active:q.candidates?.[0]);
  assert.equal(await r.api.attack('you',1),true);assert.equal(g.phase,'finished');const summary=r.api.matchSummary();assert.equal(summary.players.you.attacks,1);assert.equal(summary.players.you.energyAttached,attached+3);assert.equal(summary.knockouts[0].name,'Mega Dragonite ex');assert.equal(summary.knockouts[0].turn,turn);assert.equal(summary.players.codex.knockedOut,1);
  const saved=historyFor(r,g.deckIds.you)[0];assert.equal(saved.players.you.energyAttached,summary.players.you.energyAttached);assert.equal(saved.players.you.attacks,1);assert.ok(saved.timeline.some(e=>/wins/.test(e.message)));
});
test('a failed attack after a provisional win rolls back counters, Knockouts and both decks’ saved histories',async()=>{
  const {r,g,p}=ready();r.api.prepareAttack('you','ASC','71',['Lightning']);const target=r.api.prepareAttack('codex','ASC','279',[]);g.turn='you';target.meta.hp=1;p.prizes=p.prizes.slice(0,1);const before=JSON.stringify(g.matchHistory),restore=r.api.failNextAttackEffectAfterResolve();r.api.setChoices(r.random,r.choose,()=>true);
  try {assert.equal(await r.api.attack('you',0),false)}finally{restore()}
  const state=r.api.state();assert.equal(state.phase,'play');assert.equal(JSON.stringify(state.matchHistory),before);assert.equal(historyFor(r,g.deckIds.you).length,0);assert.equal(historyFor(r,g.deckIds.codex).length,0);assert.equal(r.document.getElementById('matchSummaryCard').hidden,true);assert.equal(Object.values(r.api.backup().data.deckStats).some(stats=>Object.keys(stats.matchups || {}).length),false);
});
test('a finished match is saved once per deck, with the correct win/loss perspective',()=>{
  const {r,g}=ready();r.api.finishMatch('you','All Prize cards taken');r.api.finishMatch('you','Again');const human=historyFor(r,g.deckIds.you),opponent=historyFor(r,g.deckIds.codex);assert.equal(human.length,1);assert.equal(opponent.length,1);assert.equal(human[0].perspective,'you');assert.equal(opponent[0].perspective,'codex');assert.equal(human[0].winner,'you');assert.equal(r.api.backup().data.deckStats[g.deckIds.you].completed,1);assert.equal(r.document.getElementById('matchSummaryCard').hidden,false);
});
test('current summary and deck history are reviewable through their controls',async()=>{
  const {r,g}=ready();r.api.finishMatch(null,'Simultaneous final Knockouts');await r.document.getElementById('viewMatchSummaryBtn').click();assert.match(r.document.getElementById('matchHistoryContent').innerHTML,/Draw/);assert.match(r.document.getElementById('matchHistoryContent').innerHTML,/Knockout timeline/);assert.equal(r.document.getElementById('matchHistoryModal').classList.contains('hidden'),false);
  await r.document.getElementById('closeMatchHistoryBtn').click();await r.document.getElementById('deckLibraryGrid').dispatchEvent({type:'click',target:{closest:s=>s==='[data-deck-history]'?{dataset:{deckHistory:g.deckIds.you}}:null}});assert.match(r.document.getElementById('matchHistoryHeading').textContent,/Match history/);assert.match(r.document.getElementById('matchHistoryContent').innerHTML,/Latest 1 saved/);
});
test('completed history survives a backup and restore with its Pokémon, Energy and timeline intact',()=>{
  const {r,g}=ready();r.api.finishMatch('you','No Pokémon left');const backup=r.api.backup(),second=createEngineRunner(loadFixture(),1);second.api.restoreBackup(backup);assert.equal(JSON.stringify(historyFor(second,g.deckIds.you)),JSON.stringify(historyFor(r,g.deckIds.you)));
});
test('malformed match history in a backup is rejected before any saved data is touched',()=>{
  const {r,g}=ready();r.api.finishMatch('you','No Pokémon left');const before=JSON.stringify(r.api.backup().data),backup=r.api.backup();backup.data.deckStats[g.deckIds.you].history[0].players.you.energyAttached='many';assert.throws(()=>r.api.restoreBackup(backup),/match history is invalid/);assert.equal(JSON.stringify(r.api.backup().data),before);
});
test('history is bounded to the latest twenty matches and earlier summaries remain snapshots',()=>{
  const {r,fixture,g}=ready();r.api.finishMatch('you','First');const first=JSON.stringify(historyFor(r,g.deckIds.you)[0]);r.api.state().matchHistory.players.you.attacks=999;assert.equal(JSON.stringify(historyFor(r,g.deckIds.you)[0]),first);
  for(let i=0;i<21;i++){r.api.setup(fixture,r.random,r.choose,()=>true);r.api.setLocalAi(false);r.api.finishMatch(i%2?'you':'codex','Match '+i)}const history=historyFor(r,g.deckIds.you);assert.equal(history.length,20);assert.equal(history[0].reason,'Match 20');assert.equal(new Set(history.map(h=>h.id)).size,20);const stats=r.api.backup().data.deckStats[g.deckIds.you];assert.equal(stats.matchups[g.deckIds.codex].completed,22);
});
test('storage failure leaves the completed match summary visible with an honest save message',()=>{
  const {r}=ready();r.context.localStorage.setItem=()=>{throw new Error('Quota')};r.api.finishMatch('you','No Pokémon left');assert.equal(r.api.state().phase,'finished');assert.ok(r.api.matchSummary());assert.match(r.document.getElementById('matchSummarySaved').textContent,/could not be saved/);
});
test('Double Dragon Energy is counted as one physical attachment rather than two Energy units',()=>{
  const {r,g,p}=ready(true);const target=r.api.prepareAttack('you','OBF','157',[]),energy=take(p,c=>c.name==='Double Dragon Energy');p.energyAttachedThisTurn=false;p.hand.push(energy);r.api.attachFor('you',energy.id,target.id);assert.equal(g.matchHistory.players.you.energyAttached,1);assert.equal(g.matchHistory.players.you.energy[0].count,1);
});
test('a between-turns Knockout is recorded against the turn that just ended',async()=>{
  const {r,g,p}=ready();g.turnNumber=5;p.active.meta.hp=1;p.active.damage=0;p.active.conditions=[{type:'poisoned'}];p.bench=[];await r.api.endTurnFor('you');const summary=r.api.matchSummary();assert.ok(summary);assert.equal(summary.turns,5);assert.equal(summary.knockouts[0].turn,5);assert.match(summary.knockouts[0].detail,/between turns/);
});
test('using the same deck on both sides saves one detailed match for that deck',()=>{
  const {r,g}=ready();g.deckIds.codex=g.deckIds.you;r.api.finishMatch('you','Test');assert.equal(historyFor(r,g.deckIds.you).length,1);assert.equal(historyFor(r,g.deckIds.you)[0].perspective,'you');
});
test('deck records split wins, defeats and attack Knock Outs by player and survive backup', async () => {
  const {r,g,p,fixture} = ready();
  r.api.prepareAttack('you','ASC','71',['Lightning']);
  const target = r.api.prepareAttack('codex','ASC','279',[]);
  target.meta.hp = 1;
  g.turn = 'you';
  p.prizes = p.prizes.slice(0,1);
  assert.equal(await r.api.attack('you',0), true);
  const backup = r.api.backup(), player = backup.data.deckStats[g.deckIds.you], opponent = backup.data.deckStats[g.deckIds.codex];
  assert.equal(player.bySide.you.plays,1);
  assert.equal(player.bySide.you.wins,1);
  assert.equal(opponent.bySide.codex.losses,1);
  assert.equal(player.bySide.codex,undefined);
  const total = Object.values(player.cards).find(card=>card.knockouts);
  assert.equal(total.name,"Iono's Wattrel");
  assert.equal(total.knockouts,1);
  assert.equal(Object.values(player.bySide.you.cards).find(card=>card.knockouts).knockouts,1);
  assert.equal(Object.values(opponent.bySide.codex.cards).find(card=>card.defeated).name,"Iono's Bellibolt ex");
  const second = createEngineRunner(fixture);
  second.api.restoreBackup(backup);
  assert.deepEqual(JSON.stringify(second.api.backup().data.deckStats),JSON.stringify(backup.data.deckStats));
  await second.document.getElementById('menuManageDecks').click();
  const html = second.document.getElementById('deckLibraryGrid').innerHTML;
  assert.match(html,/Deck rankings by win rate/);
  assert.match(html,/<th scope="row">Toma<\/th>/);
  assert.match(html,/<th scope="row">Yami<\/th>/);
  assert.match(html,/<th scope="row">Total<\/th>/);
  assert.match(html,/Most times Knocked Out/);
  assert.doesNotMatch(html,/Most drawn/);
});

test('deck records separate opponents and players and appear in the full summary', async () => {
  const {r,fixture,g}=ready(), deckId=g.deckIds.you, opponentId=g.deckIds.codex;
  r.api.finishMatch('you','First win');
  r.api.finishMatch('you','Repeated finish');
  r.api.setup(fixture,r.random,r.choose,()=>true);
  r.api.setLocalAi(false);
  r.api.finishMatch('codex','Second game');
  await r.document.getElementById('viewMatchSummaryBtn').click();
  const html=r.document.getElementById('matchHistoryContent').innerHTML;
  assert.match(html,/Current deck record/);
  assert.match(html,/<caption>All opponents<\/caption>/);
  assert.match(html,/<caption>Against Iono Fan<\/caption>/);
  assert.match(html,/<th scope="row">Toma<\/th><td>2<\/td><td>1<\/td><td>1<\/td><td>0<\/td>/);
  assert.match(r.document.getElementById('matchSummaryDeckRecord').textContent,/2 games · 1 win · 1 loss · 0 draws/);

  const swapped=structuredClone(fixture);
  swapped.decks.human={...fixture.decks.human,id:'third-deck',name:'Third deck'};
  swapped.decks.ai={...fixture.decks.human};
  r.api.setup(swapped,r.random,r.choose,()=>true);
  r.api.setLocalAi(false);
  r.api.finishMatch('you','Yami used the original deck');
  const stats=r.api.backup().data.deckStats[deckId];
  assert.equal(stats.completed,3);
  assert.equal(stats.wins,1);
  assert.equal(stats.losses,2);
  assert.equal(stats.matchups[opponentId].completed,2);
  assert.equal(stats.matchups[opponentId].bySide.you.wins,1);
  assert.equal(stats.matchups[opponentId].bySide.you.losses,1);
  assert.equal(stats.matchups['third-deck'].completed,1);
  assert.equal(stats.matchups['third-deck'].bySide.codex.losses,1);
  const archived=r.context.matchSummaryMarkup(historyFor(r,deckId)[0]);
  assert.match(archived,/<caption>Against Third deck<\/caption>/);
  assert.match(archived,/<th scope="row">Yami<\/th><td>1<\/td><td>0<\/td><td>1<\/td><td>0<\/td>/);
});

test('older backups recover known opponents and keep counting beyond the retained history', () => {
  const {r,g,fixture}=ready(), deckId=g.deckIds.you, opponentId=g.deckIds.codex;
  r.api.finishMatch('you','Known win');
  r.api.setup(fixture,r.random,r.choose,()=>true);
  r.api.setLocalAi(false);
  r.api.finishMatch('codex','Known loss');
  const legacy=r.api.backup();
  for (const stats of Object.values(legacy.data.deckStats)) delete stats.matchups;
  Object.assign(legacy.data.deckStats[deckId],{completed:7,wins:5,losses:1,draws:1});
  r.api.restoreBackup(legacy);
  const before=JSON.stringify(r.api.backup().data);
  r.context.openDeckMatchHistory(deckId);
  assert.match(r.document.getElementById('matchHistoryContent').innerHTML,/Opponent records cover 2 of 7 completed deck games/);
  assert.equal(JSON.stringify(r.api.backup().data),before);
  r.api.setup(fixture,r.random,r.choose,()=>true);
  r.api.setLocalAi(false);
  r.api.finishMatch(null,'New draw');
  const backup=r.api.backup(), stats=backup.data.deckStats[deckId], matchup=stats.matchups[opponentId];
  assert.equal(stats.completed,8);
  assert.equal(matchup.completed,3);
  assert.equal(matchup.wins,1);
  assert.equal(matchup.losses,1);
  assert.equal(matchup.draws,1);
  const fresh=createEngineRunner(fixture,1);
  fresh.api.restoreBackup(backup);
  assert.deepEqual(fresh.api.backup().data.deckStats[deckId].matchups,stats.matchups);
  fresh.api.setup(fixture,fresh.random,fresh.choose,()=>true);
  fresh.api.setLocalAi(false);
  assert.equal(fresh.api.saveMatch(),true);
  assert.equal(fresh.api.resumeMatch(),true);
  fresh.api.finishMatch('you','Resumed game');
  const resumed=fresh.api.backup().data.deckStats[deckId].matchups[opponentId];
  assert.equal(resumed.completed,4);
  assert.equal(resumed.wins,2);
  assert.equal(resumed.losses,1);
  assert.equal(resumed.draws,1);
});

test('mirror matches count each player correctly in the shared deck record', () => {
  const {r,g}=ready(), id=g.deckIds.you;
  g.deckIds.codex=id;
  r.api.finishMatch('you','Mirror match');
  const matchup=r.api.backup().data.deckStats[id].matchups[id];
  assert.equal(matchup.completed,2);
  assert.equal(matchup.wins,1);
  assert.equal(matchup.losses,1);
  assert.equal(matchup.bySide.you.wins,1);
  assert.equal(matchup.bySide.codex.losses,1);
});

test('invalid opponent statistics are rejected before a backup changes saved results', () => {
  const {r,g}=ready(), id=g.deckIds.you, opponentId=g.deckIds.codex;
  r.api.finishMatch('you','Test');
  const before=JSON.stringify(r.api.backup().data);
  for (const corrupt of [
    matchup=>{matchup.wins=-1;},
    matchup=>{matchup.completed=99;},
    matchup=>{matchup.bySide.you.wins=0;matchup.bySide.you.losses=1;},
    matchup=>{matchup.bySide.stranger=matchup.bySide.you;}
  ]) {
    const backup=r.api.backup();
    corrupt(backup.data.deckStats[id].matchups[opponentId]);
    assert.throws(()=>r.api.restoreBackup(backup),/Saved card results or player splits are invalid/);
    assert.equal(JSON.stringify(r.api.backup().data),before);
  }
});

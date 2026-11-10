const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadFixture, createEngineRunner, attackOptionEvent } = require('./integration-harness.cjs');
const fixture = loadFixture();
const storageKeys = ['decks','cards','deletedDecks','deletedCards','deckStats','fontSizes'].map(key=>'codexPokemonPlaymat.'+key+'.v1');
const recoveryKey = 'codexPokemonPlaymat.recoveryBackup.v1';
function runner(match=false) {
  const r=createEngineRunner(fixture,93);
  if(match){r.api.setup(fixture,r.random,r.choose);r.api.setLocalAi(false);const g=r.api.state();g.phase='play';g.turn='you';g.pendingPromotion=null;g.players.you.turnsTaken=1;}
  return r;
}
const rawStorage = r => JSON.stringify(storageKeys.map(key=>[key,r.context.localStorage.getItem(key)]));
const gameState = r => JSON.stringify(r.api.state());
function sampleBackup(r) {
  const b=r.api.backup();
  b.data.decks.push({id:'test-deck',name:'Saved test deck',decklist:fixture.decks.human.decklist,coverImage:'data:image/png;base64,c2FtcGxl',coverCardId:'saved-card'});
  const c=structuredClone(fixture.cards.find(c=>c.name==='Nemona'));c.id='saved-card';b.data.cards=[c];
  b.data.deckStats={'test-deck':{plays:3,wins:2,losses:1,draws:0,cards:{'saved-card':{name:'Nemona',drawn:4,used:2}}}};
  b.data.fontSizes={playmat:1.2,card:1.3,log:1.1};b.data.deletedCardIds=['deleted-card'];b.data.deletedDeckIds=['deleted-deck'];
  return b;
}

test('full backup round trip preserves decks, metadata, cover images, results, text sizes and deletion records',()=>{
  const r=runner(),backup=sampleBackup(r);r.context.localStorage.setItem('unrelated.setting','untouched');const before=JSON.stringify(backup);
  const result=r.api.restoreBackup(backup);assert.equal(result.decks,backup.data.decks.length);assert.equal(JSON.stringify(backup),before);
  const roundTrip=r.api.backup(),deck=roundTrip.data.decks.find(d=>d.id==='test-deck'),card=roundTrip.data.cards.find(c=>c.id==='saved-card');
  assert.equal(deck.coverImage,backup.data.decks.at(-1).coverImage);assert.equal(deck.decklist,fixture.decks.human.decklist);assert.equal(JSON.stringify(card.meta),JSON.stringify(backup.data.cards[0].meta));
  assert.equal(JSON.stringify(roundTrip.data.deckStats),JSON.stringify(backup.data.deckStats));assert.equal(JSON.stringify(roundTrip.data.fontSizes),JSON.stringify(backup.data.fontSizes));
  assert.equal(JSON.stringify(roundTrip.data.deletedCardIds),JSON.stringify(['deleted-card']));assert.equal(JSON.stringify(roundTrip.data.deletedDeckIds),JSON.stringify(['deleted-deck']));assert.equal(r.context.localStorage.getItem('unrelated.setting'),'untouched');
});
test('the recovery copy preserves the old library and can itself be restored',()=>{
  const r=runner(),first=sampleBackup(r);r.api.restoreBackup(first);const previous=r.api.backup();const second=structuredClone(first);second.data.decks.find(d=>d.id==='test-deck').name='Changed name';
  r.api.restoreBackup(second);const recovery=JSON.parse(r.context.localStorage.getItem(recoveryKey));assert.equal(recovery.data.decks.find(d=>d.id==='test-deck').name,'Saved test deck');assert.equal(JSON.stringify(recovery.data.deckStats),JSON.stringify(previous.data.deckStats));
  r.api.restoreBackup(recovery);assert.equal(r.api.backup().data.decks.find(d=>d.id==='test-deck').name,'Saved test deck');
});
test('a failed write restores every previous storage key and keeps the live match and library unchanged',()=>{
  const r=runner(true);r.api.restoreBackup(sampleBackup(r));r.api.setup(fixture,r.random,r.choose);r.api.setLocalAi(false);
  const before=rawStorage(r),match=gameState(r),library=JSON.stringify(r.api.backup().data),backup=sampleBackup(r);backup.data.cards=[];
  const storage=r.context.localStorage,original=storage.setItem;let fail=true;
  storage.setItem=(key,value)=>{if(fail&&key==='codexPokemonPlaymat.cards.v1'){fail=false;throw new Error('Quota exceeded')}return original(key,value)};
  assert.throws(()=>r.api.restoreBackup(backup),/previous saved data was restored/);assert.equal(rawStorage(r),before);assert.equal(gameState(r),match);assert.equal(JSON.stringify(r.api.backup().data),library);assert.ok(storage.getItem(recoveryKey));
});
test('failure to reserve the recovery copy aborts before modifying any saved key',()=>{
  const r=runner(),before=rawStorage(r),storage=r.context.localStorage,original=storage.setItem;
  storage.setItem=(key,value)=>{if(key===recoveryKey)throw new Error('Quota exceeded');return original(key,value)};
  assert.throws(()=>r.api.restoreBackup(sampleBackup(r)),/recovery copy/);assert.equal(rawStorage(r),before);
});
for(const [label,mutate] of [
  ['future version',b=>{b.schemaVersion=99}],['problem report',b=>{b.kind='pokemon-tcg-playmat-problem-report'}],['missing cards',b=>{delete b.data.cards}],['duplicate IDs',b=>{b.data.cards.push(structuredClone(b.data.cards[0]))}],['invalid attack data',b=>{b.data.cards[0].meta.attacks='not an array'}],['invalid text size',b=>{b.data.fontSizes.card=100}],['oversized deck quantity',b=>{b.data.decks[0].decklist='999999999 Dratini OBF 157'}],['unsafe object field',b=>{b.data.deckStats=JSON.parse('{"__proto__":{"polluted":true}}')}],['invalid name',b=>{b.data.cards[0].name={html:'bad'}}],['deleted saved record',b=>{b.data.deletedCardIds.push(b.data.cards[0].id)}],['invalid results',b=>{b.data.deckStats['test-deck'].cards='broken'}],['invalid result count',b=>{b.data.deckStats['test-deck'].wins=-1}]
]) test('restore rejects '+label+' without touching saved data',()=>{
  const r=runner(),backup=sampleBackup(r),before=rawStorage(r);mutate(backup);assert.throws(()=>r.api.restoreBackup(backup));assert.equal(rawStorage(r),before);assert.equal(r.context.localStorage.getItem(recoveryKey),null);
});
test('invalid JSON and oversized backup files have clear errors',()=>{
  const r=runner();assert.throws(()=>r.api.parseBackup('{not json'),/not valid JSON/);assert.throws(()=>r.api.parseBackup(' '.repeat(20*1024*1024+1)),/smaller than 20 MB/);
});
test('download full backup button produces a valid local JSON backup',async()=>{
  const r=runner();await r.document.getElementById('downloadBackupBtn').click();const blob=r.context.window.__downloadBlob;assert.ok(blob);assert.match(r.context.window.__downloadFilename,/^playmat-backup-.*\.json$/);assert.equal(r.api.parseBackup(await blob.text()).kind,'pokemon-tcg-playmat-backup');
});
test('restore preview and confirmation are required; successful restore resets the match and shows recovery controls',async()=>{
  const r=runner(true),backup=sampleBackup(r),file={name:'my-backup.json',size:1000,text:async()=>JSON.stringify(backup)};
  assert.equal(r.api.applyRestore(),false);assert.equal(await r.api.previewBackupFile(file),true);assert.match(r.document.getElementById('restoreBackupPreview').textContent,/decks, .* cards/);
  assert.equal(r.api.applyRestore(),false);assert.ok(r.api.state());r.document.getElementById('confirmBackupRestore').checked=true;
  assert.equal(r.api.applyRestore(),true);assert.equal(r.api.state(),null);assert.equal(r.document.getElementById('downloadRecoveryBackupBtn').hidden,false);assert.match(r.document.getElementById('backupToolsStatus').textContent,/Restored/);
});
test('an invalid file clears a previously valid restore candidate and cannot restore stale data',async()=>{
  const r=runner(),backup=sampleBackup(r);assert.equal(await r.api.previewBackupFile({name:'good.json',size:100,text:async()=>JSON.stringify(backup)}),true);
  r.document.getElementById('confirmBackupRestore').checked=true;const before=rawStorage(r);
  assert.equal(await r.api.previewBackupFile({name:'bad.json',size:10,text:async()=>'{broken'}),false);assert.equal(r.document.getElementById('confirmBackupRestore').checked,false);assert.equal(r.api.applyRestore(),false);assert.equal(rawStorage(r),before);
});
test('late file reads cannot replace a newer selected backup',async()=>{
  const r=runner(),backup=sampleBackup(r);let finish;const old=r.api.previewBackupFile({name:'old.json',size:100,text:()=>new Promise(resolve=>{finish=resolve})});
  await r.api.previewBackupFile({name:'new.json',size:10,text:async()=>'{invalid'});finish(JSON.stringify(backup));assert.equal(await old,false);assert.equal(r.document.getElementById('confirmBackupRestore').disabled,true);assert.equal(r.api.applyRestore(),false);
});
test('file picker, confirmation, restore and recovery download work through their registered controls',async()=>{
  const r=runner(true),backup=sampleBackup(r),oldData=JSON.stringify(r.api.backup().data);
  await r.document.getElementById('backupToolsBtn').click();
  const input=r.document.getElementById('restoreBackupFile');input.files=[{name:'saved.json',size:100,text:async()=>JSON.stringify(backup)}];
  await input.dispatchEvent({type:'change'});
  await new Promise(resolve=>setImmediate(resolve));
  const checkbox=r.document.getElementById('confirmBackupRestore'),button=r.document.getElementById('restoreBackupBtn');
  assert.equal(checkbox.disabled,false);assert.equal(button.disabled,true);checkbox.checked=true;await checkbox.dispatchEvent({type:'change'});assert.equal(button.disabled,false);
  await button.click();assert.equal(r.api.state(),null);assert.ok(r.api.backup().data.decks.some(d=>d.id==='test-deck'));
  await r.document.getElementById('downloadRecoveryBackupBtn').click();
  const recovery=r.api.parseBackup(await r.context.window.__downloadBlob.text());assert.equal(JSON.stringify(recovery.data),oldData);assert.match(r.context.window.__downloadFilename,/^playmat-before-restore-/);
});
test('closing backup tools invalidates an unfinished file read',async()=>{
  const r=runner();let finish;await r.document.getElementById('backupToolsBtn').click();
  const pending=r.api.previewBackupFile({name:'slow.json',size:100,text:()=>new Promise(resolve=>{finish=resolve})});
  await r.document.getElementById('closeBackupToolsBtn').click();finish(JSON.stringify(sampleBackup(r)));assert.equal(await pending,false);
  assert.equal(r.document.getElementById('backupToolsModal').classList.contains('hidden'),true);assert.equal(r.api.applyRestore(),false);
});
test('blocked browser storage leaves the live library unchanged and produces a useful restore error',()=>{
  const r=runner(true),backup=sampleBackup(r),before=gameState(r),data=JSON.stringify(r.api.backup().data);
  r.context.localStorage.getItem=()=>{throw new Error('Storage blocked')};
  assert.throws(()=>r.api.restoreBackup(backup),/blocked access.*No data was changed/);assert.equal(gameState(r),before);assert.equal(JSON.stringify(r.api.backup().data),data);
});
test('a rollback storage failure still leaves a downloadable recovery backup',async()=>{
  const r=runner(),backup=sampleBackup(r);r.api.restoreBackup(backup);const oldData=JSON.stringify(r.api.backup().data),storage=r.context.localStorage,original=storage.setItem;
  storage.setItem=(key,value)=>{if(key!==recoveryKey)throw new Error('Storage unavailable');return original(key,value)};
  await r.api.previewBackupFile({name:'next.json',size:100,text:async()=>JSON.stringify(backup)});r.document.getElementById('confirmBackupRestore').checked=true;
  assert.equal(r.api.applyRestore(),false);assert.match(r.document.getElementById('backupToolsStatus').textContent,/could not be fully recovered/);assert.equal(r.document.getElementById('downloadRecoveryBackupBtn').hidden,false);
  await r.document.getElementById('downloadRecoveryBackupBtn').click();assert.equal(JSON.stringify(JSON.parse(await r.context.window.__downloadBlob.text()).data),oldData);
});
test('restored card status labels cannot bypass exact-print and complete-text checks',()=>{
  const r=runner(),backup=sampleBackup(r);backup.data.cards[0].implementationStatus='implemented';backup.data.cards[0].meta.effect='Draw 99 cards.';
  r.api.restoreBackup(backup);assert.equal(r.api.libraryAudit().find(c=>c.id==='saved-card').status,'registered');
});
test('restore is blocked while a real card choice is open',async()=>{
  const r=runner(true),g=r.api.state(),p=g.players.you;
  let card;for(const zone of [p.hand,p.deck,p.discard,p.prizes]){const i=zone.findIndex(c=>c.name==='Great Ball');if(i>=0){card=zone.splice(i,1)[0];break}}
  assert.ok(card);p.hand.push(card);const pokemon=p.deck.find(c=>c.meta.category==='Pokemon');p.deck=p.deck.filter(c=>c!==pokemon);p.deck.push(pokemon);
  r.api.setChoices(r.random,undefined);const playing=r.api.playCard('you',card.id);assert.equal(r.api.pendingChoices(),true);
  const report=r.api.report('Choice is open.');assert.equal(report.context.pendingCardChoice.side,'you');assert.ok(report.context.pendingCardChoice.cards.length);assert.equal(report.context.effectInProgress,true);
  const before=rawStorage(r);assert.throws(()=>r.api.restoreBackup(r.api.backup()),/Finish the current choice/);assert.equal(rawStorage(r),before);r.api.cancelActiveCardChoice();assert.equal(r.api.pendingChoices(),true);r.api.confirmRawChoice([]);await playing;
});
test('problem reports include hidden state, pending choices, recent messages and version without modifying the match',async()=>{
  const r=runner(true),g=r.api.state();r.api.notify('A useful action explanation');const before=gameState(r),storage=rawStorage(r),report=r.api.report('Expected a card draw.');
  assert.equal(report.kind,'pokemon-tcg-playmat-problem-report');assert.equal(report.engineVersion,'2026-11-03-resume-effects-ai');assert.equal(report.description,'Expected a card draw.');assert.equal(report.match.players.you.hand.length,g.players.you.hand.length);assert.equal(report.match.players.codex.deck.length,g.players.codex.deck.length);assert.ok(report.recentDiagnostics.some(d=>d.message==='A useful action explanation'));
  report.match.players.you.hand.length=0;assert.equal(gameState(r),before);assert.equal(rawStorage(r),storage);
});
test('Report a problem captures the opening state and downloads a separate report format',async()=>{
  const r=runner(true),capturedTurn=r.api.state().turnNumber;await r.document.getElementById('reportProblemBtn').click();r.api.state().turnNumber+=2;r.document.getElementById('problemDescription').value='The choice was stuck.';
  await r.document.getElementById('downloadProblemReportBtn').click();const report=JSON.parse(await r.context.window.__downloadBlob.text());assert.equal(report.match.turnNumber,capturedTurn);assert.equal(report.description,'The choice was stuck.');assert.match(r.context.window.__downloadFilename,/^playmat-problem-/);assert.throws(()=>r.api.validateBackup(report),/Problem reports/);
});
test('reports work without a match and bound the diagnostic history',async()=>{
  const r=runner();assert.equal(r.api.report().match,null);assert.equal(JSON.stringify(r.api.report().library),JSON.stringify(r.api.backup().data));for(let i=0;i<120;i++)r.api.notify('message '+i);const report=r.api.report();assert.equal(report.recentDiagnostics.length,100);assert.equal(report.recentDiagnostics.at(-1).message,'message 119');assert.equal(report.description,'');
});
test('a failed card resolver is rolled back and its error and previous action remain in the report',async()=>{
  const r=runner(true),p=r.api.state().players.you;let card;
  for(const zone of [p.hand,p.deck,p.discard,p.prizes]){const i=zone.findIndex(c=>c.name==='Judge');if(i>=0){card=zone.splice(i,1)[0];break}}
  assert.ok(card);p.hand.push(card);r.api.selectHandCard('you',card.id);const before=JSON.parse(gameState(r)),restoreResolver=r.api.throwNextSupporterAfterResolve('Simulated draw failure');
  try {await r.document.getElementById('playTrainerBtn').click();await new Promise(resolve=>setImmediate(resolve))} finally {restoreResolver()}
  const after=JSON.parse(gameState(r));assert.deepEqual(after.players,before.players);assert.equal(after.log[0].message,'Judge resolution failed; no changes were kept.');
  const report=r.api.report('Draw did not finish.');assert.ok(report.previousAction);assert.equal(JSON.stringify(report.previousAction.game),JSON.stringify(before));
  const error=report.recentDiagnostics.find(d=>d.kind==='error');assert.equal(error.message,'Simulated draw failure');assert.match(error.details.stack,/Simulated draw failure/);assert.match(report.context.lastMessage,/no changes were kept/);
});
test('action messages explain missing Energy, sleep, attack locks, wrong turn and automatic Abilities',()=>{
  const r=runner(true),g=r.api.state(),p=g.players.you,c=p.active,a=c.meta.attacks[0];r.api.selectBoardCard('you','active',c.id);c.energy=[];
  assert.match(r.api.unavailable('attack',{pokemon:c,attack:a}),/Energy/);c.conditions=[{type:'asleep'}];assert.match(r.api.unavailable('attack',{pokemon:c,attack:a}),/Asleep/);c.conditions=[];c.cannotAttackUntilTurn=g.turnNumber;assert.match(r.api.unavailable('attack',{pokemon:c,attack:a}),/earlier attack/);delete c.cannotAttackUntilTurn;g.turn='codex';assert.match(r.api.unavailable('attack',{pokemon:c,attack:a,side:'you'}),/Wait for your turn/);
  g.turn='you';const source=structuredClone(fixture.cards.find(c=>c.name==='Dragonite'&&c.cardNumber==='149'));assert.match(r.api.unavailable('ability',{pokemon:source,attack:source.meta.abilities[0]}),/automatically/);
});
test('action messages explain Supporter limits, insufficient Ultra Ball cost and unavailable Switch targets',()=>{
  const r=runner(true),g=r.api.state(),p=g.players.you,judge=structuredClone(fixture.cards.find(c=>c.name==='Judge'));r.api.selectBoardCard('you','active',p.active.id);
  g.firstPlayer='you';p.turnsTaken=0;assert.match(r.api.unavailable('trainer',{card:judge}),/going first/);p.turnsTaken=1;p.supporterPlayedThisTurn=true;assert.match(r.api.unavailable('trainer',{card:judge}),/already played a Supporter/);p.supporterPlayedThisTurn=false;
  const ultra={...structuredClone(fixture.cards.find(c=>c.name==='Ultra Ball')),id:'ultra'};p.hand=[ultra];assert.match(r.api.unavailable('trainer',{card:ultra}),/two other cards/);p.bench=[];const sw=fixture.cards.find(c=>c.name==='Switch');assert.match(r.api.unavailable('trainer',{card:sw}),/Bench/);
});
test('unavailable attacks remain visible and preview their reason without attacking',async()=>{
  const r=runner(true),p=r.api.state().players.you;p.active.energy=[];r.api.selectBoardCard('you','active',p.active.id);
  const before=gameState(r),preview=r.document.getElementById('attackPreview');
  assert.equal(r.document.getElementById('attackPanel').hidden,false);
  assert.match(r.document.getElementById('attackOptions').innerHTML,/data-attack-index="0" aria-disabled="true"/);
  await attackOptionEvent(r,0,'pointerover');
  assert.match(preview.innerHTML,/Energy/);
  await attackOptionEvent(r,0);
  assert.equal(gameState(r),before);
});
test('attack controls recover when requirements are met and retain first-turn and exact-print guards',async()=>{
  const r=runner(true),g=r.api.state(),p=g.players.you,c=p.active;
  const options=r.document.getElementById('attackOptions'),preview=r.document.getElementById('attackPreview');
  c.energy=[];r.api.selectBoardCard('you','active',c.id);assert.match(options.innerHTML,/data-attack-index="0" aria-disabled="true"/);
  for(let i=0;i<4;i++)c.energy.push({id:'energy-'+i,name:'Lightning Energy',meta:{category:'Energy',energyType:'Normal'}});
  r.api.selectBoardCard('you','active',c.id);assert.match(options.innerHTML,/data-attack-index="0" aria-disabled="false"/);
  g.firstPlayer='you';p.turnsTaken=0;r.api.selectBoardCard('you','active',c.id);
  await attackOptionEvent(r,0,'focusin');
  assert.match(options.innerHTML,/data-attack-index="0" aria-disabled="true"/);
  assert.match(preview.innerHTML,/going first/);
  p.turnsTaken=1;c.meta.attacks[0].effect+=' Altered text.';const before=gameState(r);r.api.selectBoardCard('you','active',c.id);
  await attackOptionEvent(r,0);
  assert.match(options.innerHTML,/data-attack-index="0" aria-disabled="true"/);
  assert.match(preview.innerHTML,/exact details/);
  assert.equal(gameState(r),before);
});

const assert = require('node:assert/strict');
const {test} = require('node:test');
const {createEngineRunner,loadFixture} = require('./integration-harness.cjs');
const fixture=loadFixture(),key='codexPokemonPlaymat.playmats.v1',matchKey='codexPokemonPlaymat.unfinishedMatch.v1';
const photo={id:'playmat-test',name:'Test arena',width:1,height:1,image:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3ZkAAAAASUVORK5CYII='};
function runner(){const r=createEngineRunner(fixture,51);r.api.setup(fixture,r.random,r.choose,()=>true);r.api.setLocalAi(false);return r;}
function add(r){r.context.persistPlaymatLibrary([structuredClone(photo)]);}
function choose(r,id){r.document.getElementById('setupPlaymatSelect').value=id;}
const visual=r=>r.document.getElementById('matchField').dataset.customPlaymat;

test('default setup retains the original mat, and selecting a custom mat is cosmetic until the next match',()=>{
  const r=runner();assert.equal(r.api.state().playmat,null);assert.equal(visual(r),'false');add(r);
  const before=JSON.stringify(r.api.state()),stats=JSON.stringify(r.api.backup().data.deckStats);
  choose(r,photo.id);r.context.renderSetupPlaymatPreview();
  assert.match(r.document.getElementById('setupPlaymatPreview').innerHTML,/data:image\/png/);
  assert.equal(JSON.stringify(r.api.state()),before);assert.equal(JSON.stringify(r.api.backup().data.deckStats),stats);
  r.api.setup(fixture,r.random,r.choose,()=>true);r.api.setLocalAi(false);
  assert.equal(r.api.state().playmat.id,photo.id);assert.equal(visual(r),'true');
  choose(r,'');r.api.render();assert.equal(visual(r),'true','A setup choice does not change the current match');
  r.api.setup(fixture,r.random,r.choose,()=>true);assert.equal(r.api.state().playmat,null);assert.equal(visual(r),'false');
});

test('saved images survive backup/restore and old backups without images still restore',()=>{
  const r=runner();add(r);const backup=r.api.backup(),fresh=runner();fresh.api.restoreBackup(backup);
  assert.deepEqual(JSON.parse(JSON.stringify(fresh.api.backup().data.playmats)),[photo]);
  const legacy=structuredClone(backup);delete legacy.data.playmats;fresh.api.restoreBackup(legacy);
  assert.equal(JSON.stringify(fresh.api.backup().data.playmats),'[]');
});

test('removing a selected mat resets the picker but a current or resumed match keeps its snapshot',()=>{
  const r=runner();add(r);choose(r,photo.id);r.api.setup(fixture,r.random,r.choose,()=>true);r.api.setLocalAi(false);
  const stats=JSON.stringify(r.api.backup().data.deckStats);r.context.removeSavedPlaymat(photo.id);r.api.render();
  assert.equal(r.document.getElementById('setupPlaymatSelect').value,'');assert.equal(visual(r),'true');
  assert.equal(JSON.stringify(r.api.backup().data.deckStats),stats);assert.equal(r.api.saveMatch(),true);
  const fresh=runner();fresh.api.restoreBackup(r.api.backup());fresh.context.localStorage.setItem(matchKey,r.context.localStorage.getItem(matchKey));
  assert.equal(fresh.api.resumeMatch(),true);assert.equal(visual(fresh),'true');assert.equal(fresh.api.state().playmat.image,photo.image);
});

test('older unfinished matches with no playmat field retain the default after resume',()=>{
  const r=runner();r.api.saveMatch();const checkpoint=JSON.parse(r.context.localStorage.getItem(matchKey));delete checkpoint.game.playmat;
  r.context.localStorage.setItem(matchKey,JSON.stringify(checkpoint));assert.equal(r.api.resumeMatch(),true);assert.equal(visual(r),'false');
});

for(const [label,change] of [
  ['remote URL',p=>p.image='https://example.com/image.jpg'],
  ['SVG',p=>p.image='data:image/svg+xml;base64,PHN2Zy8+'],
  ['invalid image header',p=>p.image='data:image/png;base64,YQ=='],
  ['unsafe ID',p=>p.id='bad" onclick="alert(1)'],
  ['invalid size',p=>p.width=90000],
  ['missing name',p=>p.name=''],
  ['oversized image',p=>p.image='data:image/jpeg;base64,/9j/'+ 'A'.repeat(512*1024)]
])test('invalid '+label+' is rejected before library writes or a checkpoint can be applied',()=>{
  const r=runner();add(r);const bad=structuredClone(photo);change(bad);const before=JSON.stringify(r.api.backup().data);
  assert.throws(()=>r.context.persistPlaymatLibrary([bad]),/Playmat images/);assert.equal(JSON.stringify(r.api.backup().data),before);
  const backup=r.api.backup();backup.data.playmats=[bad];assert.throws(()=>r.api.restoreBackup(backup),/Playmat images/);assert.equal(JSON.stringify(r.api.backup().data),before);
  r.api.saveMatch();const checkpoint=JSON.parse(r.context.localStorage.getItem(matchKey));checkpoint.game.playmat=bad;assert.throws(()=>r.api.validateMatch(checkpoint),/saved game/);
});

test('duplicate image IDs and the library budget are validated without changing saved playmats',()=>{
  const r=runner();add(r);const before=r.context.localStorage.getItem(key);
  assert.throws(()=>r.context.persistPlaymatLibrary([photo,photo]),/Playmat images/);
  const large={...photo,image:'data:image/jpeg;base64,/9j/'+'A'.repeat(440000)};
  assert.throws(()=>r.context.persistPlaymatLibrary(Array.from({length:5},(_,i)=>({...large,id:'playmat-'+i}))),/saved image limit/);
  assert.equal(r.context.localStorage.getItem(key),before);
});

test('a failed storage write preserves the library, and restore rollback includes the playmat key',()=>{
  const r=runner();add(r);const before=JSON.stringify(r.api.backup().data),oldRaw=r.context.localStorage.getItem(key),set=r.context.localStorage.setItem;
  r.context.localStorage.setItem=(k,v)=>{if(k===key)throw Error('Full');return set(k,v);};
  assert.throws(()=>r.context.persistPlaymatLibrary([]),/Full/);assert.equal(JSON.stringify(r.api.backup().data),before);
  const incoming=r.api.backup();incoming.data.playmats=[];
  let failed=false;
  r.context.localStorage.setItem=(k,v)=>{if(k===key && v==='[]' && !failed){failed=true;throw Error('Full');}return set(k,v);};
  assert.throws(()=>r.api.restoreBackup(incoming),/Restore could not/);assert.equal(JSON.stringify(r.api.backup().data),before);assert.equal(r.context.localStorage.getItem(key),oldRaw);
  assert.equal(r.context.localStorage.getItem('codexPokemonPlaymat.recoveryBackup.v1').includes(photo.id),true);
  r.context.localStorage.setItem=set;r.context.localStorage.setItem(key,oldRaw);
});

test('an unfinished image upload blocks restore, saves only once, and does not alter the running match',async()=>{
  const r=runner(),before=JSON.stringify(r.api.state());let release;
  r.context.optimizePlaymatImage=()=>new Promise(resolve=>{release=resolve;});
  r.document.getElementById('playmatUploadName').value='Uploaded arena';
  const upload=r.context.uploadPlaymat({name:'arena.png'});
  assert.equal(r.document.getElementById('uploadPlaymatBtn').disabled,true);
  assert.throws(()=>r.api.restoreBackup(r.api.backup()),/Finish the current choice/);
  release({image:photo.image,width:1,height:1});await upload;
  assert.equal(r.api.backup().data.playmats.length,1);assert.equal(r.api.backup().data.playmats[0].name,'Uploaded arena');
  assert.equal(JSON.stringify(r.api.state()),before);assert.equal(r.document.getElementById('uploadPlaymatBtn').disabled,false);
});

test('unsupported uploads and storage failures leave images and the match intact',async()=>{
  const r=runner();add(r);const before=JSON.stringify(r.api.state());
  await r.context.uploadPlaymat({name:'bad.svg',type:'image/svg+xml',size:100});
  assert.equal(r.api.backup().data.playmats.length,1);assert.match(r.document.getElementById('playmatLibraryStatus').textContent,/JPG, PNG or WebP/);
  r.context.optimizePlaymatImage=async()=>({image:photo.image,width:1,height:1});
  r.context.localStorage.setItem=()=>{const error=Error('Full');error.name='QuotaExceededError';throw error;};
  await r.context.uploadPlaymat({name:'another.png'});
  assert.match(r.document.getElementById('playmatLibraryStatus').textContent,/storage is full/);assert.equal(r.api.backup().data.playmats.length,1);assert.equal(JSON.stringify(r.api.state()),before);
});

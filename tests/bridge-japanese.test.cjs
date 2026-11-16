const {test}=require('node:test');
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const path=require('node:path');
test('Limitless bridge parses translated Japanese prints and preserves lookup failure guards offline',()=>{
 const output=execFileSync('powershell.exe',['-NoProfile','-File',path.join(__dirname,'bridge-japanese.offline.ps1')],{encoding:'utf8',windowsHide:true,timeout:15000});
 const results=JSON.parse(output);assert.equal(results.length,13);assert.ok(results.every(r=>r.passed));
});

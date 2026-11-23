const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const {createEngineRunner,loadFixture}=require('./integration-harness.cjs');
function setup() {
  const fixture=loadFixture(),r=createEngineRunner(fixture,117);r.api.setup(fixture,r.random,r.choose);r.api.setLocalAi(false);
  const p=r.api.state().players.you;
  const make=(name,setCode,cardNumber)=>{
    const card={id:setCode+'-'+cardNumber,name,setCode,cardNumber,energy:[],tools:[]};r.api.repairMetadata(card);return card;
  };
  const render=card=>{r.context.energyDisplayPokemon=card;return vm.runInContext('attachedEnergyMarkup(energyDisplayPokemon)',r.context);};
  return {r,p,fixture,make,render};
}
const energy=(id,type)=>({id,name:type+' Energy',meta:{category:'Energy',energyType:type}});
test('display groups Energy types without reordering or changing the attached physical cards',()=>{
  const {p,render}=setup(),a=energy('p1','Psychic'),b=energy('f','Fighting'),c=energy('p2','Psychic');
  p.active.energy=[a,b,c];const before=JSON.stringify(p.active.energy),markup=render(p.active);
  assert.deepEqual([...markup.matchAll(/data-energy-card="([^"]+)"/g)].map(match=>match[1]),['p1','p2','f']);
  assert.equal(JSON.stringify(p.active.energy),before);assert.equal(p.active.energy[1],b);
  assert.match(markup,/3 card\(s\), 3 Energy unit\(s\)/);
  assert.doesNotMatch(markup,/energy-unit-count/);
});
test('Rocket Energy displays an R and ×2 on a Rocket Pokémon; an invalid holder does not falsely show available units',()=>{
  const {make,render}=setup(),rocket=make("Team Rocket's Energy",'MC','742');
  const host=make("Team Rocket's Porygon",'SV10','81');host.energy=[rocket];
  const markup=render(host);
  assert.match(markup,/data-energy-type="rocket"/);assert.match(markup,/>R<\/span>/);
  assert.match(markup,/data-energy-units="2"/);assert.match(markup,/energy-unit-count">×2/);
  assert.match(markup,/1 card\(s\), 2 Energy unit\(s\)/);
  const other={...host,name:'Porygon'};
  assert.match(render(other),/energy-unit-count">×0/);
});
test('Ignition and Double Dragon indicators follow their current engine-provided Energy units',()=>{
  const {make,fixture,render}=setup(),ignition=make('Ignition Energy','M2','109');
  const basic=make("Team Rocket's Porygon",'SV10','81'),evolved=make("Team Rocket's Porygon2",'SV10','82');
  basic.energy=[ignition];evolved.energy=[ignition];
  assert.match(render(basic),/data-energy-units="1"/);assert.doesNotMatch(render(basic),/energy-unit-count/);
  assert.match(render(evolved),/energy-unit-count">×3/);
  const double=structuredClone(fixture.cards.find(card=>card.name==='Double Dragon Energy'));assert.ok(double);
  const dragon={...basic,name:'Dragon',meta:{...basic.meta,types:['Dragon']},energy:[double]};
  assert.match(render(dragon),/data-energy-type="double-dragon"/);assert.match(render(dragon),/energy-unit-count">×2/);
});
test('live Energy multiplication is reflected on each card and overflow retains total cards and units',()=>{
  const {r,p,render}=setup();p.active.energy=[energy('grass','Grass')];
  vm.runInContext('hasWildGrowthFor=()=>true',r.context);
  assert.match(render(p.active),/energy-unit-count">×2/);
  p.active.energy=Array.from({length:7},(_,i)=>energy('grass'+i,'Grass'));
  const markup=render(p.active);assert.equal((markup.match(/data-energy-card=/g)||[]).length,5);
  assert.match(markup,/energy-overflow[^>]*>\+2/);assert.match(markup,/7 card\(s\), 14 Energy unit\(s\)/);
  vm.runInContext('hasWildGrowthFor=()=>false',r.context);assert.doesNotMatch(render(p.active),/energy-unit-count/);
});
test('browser titles and installed app name use Tomtom TCG Hub while keeping the installation identity',()=>{
  const root=path.join(__dirname,'..'),manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.webmanifest'),'utf8'));
  assert.equal(manifest.name,'Tomtom TCG Hub');assert.equal(manifest.short_name,'Tomtom TCG Hub');
  assert.equal(manifest.id,'./');assert.equal(manifest.start_url,'./');
  assert.match(fs.readFileSync(path.join(root,'index.html'),'utf8'),/<title>Tomtom TCG Hub<\/title>/);
  assert.match(fs.readFileSync(path.join(root,'pokedex.html'),'utf8'),/<title>Pokédex · Tomtom TCG Hub<\/title>/);
});

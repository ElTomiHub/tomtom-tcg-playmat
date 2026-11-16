const assert = require('node:assert/strict');
const {test} = require('node:test');
const {loadFixture,createEngineRunner} = require('./integration-harness.cjs');

function ready() {
  const fixture=loadFixture(),r=createEngineRunner(fixture,31);
  r.api.setup(fixture,r.random,r.choose,()=>true);r.api.setLocalAi(false);
  return {r,fixture,find:name=>fixture.cards.find(card=>card.name===name)};
}

test('Most used excludes Basic and Special Energy but retains Energy Search, for each player and Total',()=>{
  const {r,find}=ready(),game=r.api.state();game.deckIds.codex=game.deckIds.you;
  const used=(side,name,count)=>r.context.recordDeckCardStat(side,find(name),'used',count);
  used('you','Lightning Energy',330);used('you','Double Dragon Energy',100);
  used('you','Energy Search',8);used('you',"Iono's Voltorb",6);
  used('codex','Water Energy',500);used('codex',"Iono's Voltorb",40);
  r.context.recordDeckCardStat('you',find("Iono's Voltorb"),'knockouts',3);
  r.context.recordDeckCardStat('you',find("Iono's Wattrel"),'defeated',2);
  const before=JSON.stringify(r.api.backup().data),stats=r.api.backup().data.deckStats[game.deckIds.you];
  const html=r.context.deckResultsMarkup(stats);
  const row=name=>html.match(new RegExp('<th scope="row">'+name+'</th>([\\s\\S]*?)</tr>'))[1];
  assert.match(row('Toma'),/Energy Search/);assert.match(row('Yami'),/Iono&#39;s Voltorb/);assert.match(row('Total'),/×46/);
  assert.match(row('Toma'),/×3/);assert.match(row('Toma'),/Iono&#39;s Wattrel/);
  assert.doesNotMatch(html,/Lightning Energy|Double Dragon Energy|Water Energy/);
  assert.equal(JSON.stringify(r.api.backup().data),before,'Viewing the comparison preserves complete stored card counts');
});

test('historical Energy with no card-library record is excluded without dropping ordinary Trainer names',()=>{
  const {r}=ready();
  const stats={cards:{special:{name:'Legacy Special Energy',setCode:'OLD',cardNumber:'1',used:900},trainer:{name:'Energy Retrieval',setCode:'OLD',cardNumber:'2',used:3}}};
  const html=r.context.deckResultsMarkup(stats);
  assert.doesNotMatch(html,/Legacy Special Energy/);assert.match(html,/Energy Retrieval/);assert.match(html,/×3/);
});

test('Energy-only or empty records show no invented Most used leader',()=>{
  const {r,find}=ready();r.context.recordDeckCardStat('you',find('Lightning Energy'),'used',100);
  const stats=r.api.backup().data.deckStats[r.api.state().deckIds.you],html=r.context.deckResultsMarkup(stats);
  assert.doesNotMatch(html,/Lightning Energy|×100/);assert.equal((html.match(/scope="row"/g)||[]).length,3);
});

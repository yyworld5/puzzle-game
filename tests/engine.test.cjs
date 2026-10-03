const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../game.js'), 'utf8') + '\nglobalThis.Engine = JellyEngine;', sandbox);
const Engine = sandbox.Engine;
let passed = 0;
function test(name, fn) { fn(); passed++; console.log('PASS ' + name); }
function fresh(notify) { const game = new Engine(() => .1, notify); game.start(); return game; }

test('four connected pieces clear, diagonal neighbors do not', () => {
  const game = fresh();
  for (let i=0;i<4;i++) game.board[10+i][i] = 1;
  assert.equal(game.groups().length, 0);
  game.board = Array.from({length:14}, () => Array(6).fill(0));
  game.board[13] = [1,1,1,1,0,0];
  assert.equal(game.groups()[0].length, 4);
});
test('gravity preserves vertical order and splits unsupported pairs', () => {
  const game = fresh(); game.board[3][0]=1; game.board[7][0]=2; game.board[2][1]=3;
  game.gravity(); assert.equal(game.board[12][0],1); assert.equal(game.board[13][0],2); assert.equal(game.board[13][1],3); assert.equal(game.board[3][0],0);
});
test('wall kicks keep rotation inside the board', () => {
  const game=fresh(); game.active.x=0; assert.equal(game.rotate(-1),true);
  assert.equal(game.active.x,1); assert.equal(game.fits(game.active),true);
  game.active.x=5; game.active.rotation=0; assert.equal(game.rotate(1),true); assert.equal(game.active.x,4);
});
test('occupied cells prevent movement and invalid rotation', () => {
  const game=fresh(); game.board[2][1]=2; assert.equal(game.move(-1),false);
  game.board=Array.from({length:14},()=>Array(6).fill(2));
  for(const {x,y} of game.cells())game.board[y][x]=0;
  assert.equal(game.rotate(1),false);
});
test('hard drop locks exactly at the ghost landing position', () => {
  const game=fresh(); const ghost=game.ghost(); assert.equal(ghost.y,13); game.drop();
  assert.equal(game.active,null); assert.equal(game.board[13][2],1); assert.equal(game.board[12][2],1); assert.equal(game.score,22);
});
test('two-stage chain resolves and awards an all-clear bonus', () => {
  const events=[];const game=fresh((type,data)=>events.push({type,data}));
  game.active=null; game.board[13]=[1,1,1,1,2,0]; game.board[12]=[0,2,2,2,0,0];
  game.phase='settling';game.phaseTime=0;game.update(1);
  assert.equal(game.chain,1); assert.equal(game.score,40);
  game.update(420);game.update(230); assert.equal(game.chain,2); assert.equal(game.score,200);
  game.update(420);assert.equal(game.score,1200);game.update(230);
  assert.equal(game.maxChain,2);assert.equal(game.cleared,8);assert.equal(game.phase,'falling');
  assert.equal(events.filter(e=>e.type==='clear').length,2);assert.ok(events.some(e=>e.type==='allclear'));
});
test('spawn obstruction ends the game', () => {
  const game=fresh();game.board[2][2]=3;game.spawn();assert.equal(game.status,'over');assert.equal(game.active,null);
});
test('paused game does not advance', () => {
  const game=fresh();game.status='paused';const y=game.active.y;game.update(5000);assert.equal(game.active.y,y);assert.equal(game.elapsed,0);assert.equal(game.move(1),false);
});
test('grounded piece has a 500ms lock delay', () => {
  const game=fresh();game.active=game.ghost();game.update(499);assert.ok(game.active);game.update(1);assert.equal(game.active,null);
});
test('speed increases with playing time', () => {
  const game=fresh();game.elapsed=44999;game.update(1);assert.equal(game.level,2);
});
test('restart resets all previous game progress', () => {
  const game=fresh();game.score=999;game.maxChain=5;game.status='over';game.start('hard');
  assert.equal(game.score,0);assert.equal(game.maxChain,0);assert.equal(game.baseSpeed,420);assert.equal(game.status,'playing');assert.equal(game.queue.length,2);
});
test('random play maintains board and active-piece invariants', () => {
  let seed=4711;const random=()=>((seed=(seed*1664525+1013904223)>>>0)/2**32);
  const game=new Engine(random);game.start();
  for(let i=0;i<12000;i++){
    if(game.status==='over')game.start();
    const move=Math.floor(random()*6);if(move===0)game.move(-1);if(move===1)game.move(1);if(move===2)game.rotate(1);if(move===3)game.rotate(-1);if(move===4)game.drop();
    game.update(50,move===5);
    assert.equal(game.board.length,14);assert.ok(game.board.every(row=>row.length===6&&row.every(color=>color>=0&&color<=4)));
    if(game.active)assert.ok(game.fits(game.active));assert.ok(Number.isFinite(game.score));
  }
});
console.log(`${passed} tests passed.`);

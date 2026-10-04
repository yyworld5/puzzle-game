const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../game.js'), 'utf8');
const renderSource = source.slice(source.indexOf('  function settledStyles('), source.indexOf('  function draw('));
const palette = JSON.parse(source.match(/const palette=(\[.*\]);/)[1]);
const scope = {palette, reducedMotion: false};
vm.createContext(scope);
vm.runInContext(renderSource, scope);
let passed = 0;
function test(name, fn) { fn(); passed++; console.log('PASS ' + name); }
function board() { return Array.from({length: 14}, () => Array(6).fill(0)); }
function context() {
  const calls = [], ctx = {calls};
  for (const method of ['save', 'restore', 'translate', 'scale', 'beginPath', 'moveTo', 'lineTo',
    'bezierCurveTo', 'quadraticCurveTo', 'closePath', 'fill', 'stroke', 'ellipse', 'arc']) {
    ctx[method] = (...args) => calls.push({method, args, fill: ctx.fillStyle});
  }
  for (const method of ['createLinearGradient', 'createRadialGradient']) {
    ctx[method] = (...args) => ({args, addColorStop() {}});
  }
  return ctx;
}
const links = style => Array.from(style.connected);

test('only cardinal neighbors of the same color connect', () => {
  const cells = board(); cells[8][2] = cells[8][3] = cells[9][2] = cells[7][1] = 1; cells[7][2] = 2;
  const styles = scope.settledStyles(cells);
  assert.deepEqual(links(styles.get(50)), [false, true, true, false]);
  assert.deepEqual(links(styles.get(43)), [false, false, false, false]);
});
test('horizontal and vertical joins remain reciprocal', () => {
  const cells = board(); cells[10][2] = cells[10][3] = cells[11][2] = 1;
  const styles = scope.settledStyles(cells);
  assert.equal(styles.get(63).connected[3], true);
  assert.equal(styles.get(68).connected[0], true);
  assert.equal(styles.get(62).connected[1], true);
  assert.equal(styles.get(62).connected[2], true);
});
test('board edges do not wrap and hidden rows do not create visible joins', () => {
  const cells = board(); cells[1][0] = cells[2][0] = cells[2][5] = cells[13][0] = 1;
  const styles = scope.settledStyles(cells);
  assert.deepEqual(links(styles.get(12)), [false, false, false, false]);
  assert.deepEqual(links(styles.get(78)), [false, false, false, false]);
  assert.equal(styles.has(6), false);
});
test('connection fills reach the shared edge but outlines skip its interior', () => {
  const ctx = context(); scope.jellyContour(ctx, 60, [true, true, true, true]);
  const edges = ctx.calls.filter(c => c.method === 'lineTo');
  assert.deepEqual(edges.map(c => c.args), [[14.7, -30], [30, 14.7], [-14.7, 30], [-30, -14.7]]);
  ctx.calls.length = 0; scope.jellyContour(ctx, 60, [true, true, true, true], true);
  assert.equal(ctx.calls.some(c => c.method === 'lineTo' || c.method === 'closePath'), false);
  assert.equal(ctx.calls.filter(c => c.method === 'moveTo').length, 5);
});
test('joined bodies stay aligned during wobble and popping while faces can move', () => {
  const ctx = context();
  scope.jelly(ctx, 60, 120, 60, 1, .8, .5, .17, [true, false, false, false]);
  assert.deepEqual(ctx.calls.find(c => c.method === 'translate').args, [90, 150]);
  assert.equal(ctx.calls.find(c => c.method === 'fill').fill, palette[1][1]);
  assert.ok(ctx.calls.findIndex(c => c.method === 'scale') > ctx.calls.findIndex(c => c.method === 'stroke'));
});
test('falling and preview pieces remain separate round bodies', () => {
  const ctx = context(); scope.jelly(ctx, 0, 0, 60, 1);
  const body = ctx.calls.slice(0, ctx.calls.findIndex(c => c.method === 'fill'));
  assert.equal(body.some(c => c.method === 'lineTo'), false);
  assert.equal(body.filter(c => c.method === 'bezierCurveTo').length, 4);
});
test('removing a neighbor splits the connection on the next frame', () => {
  const cells = board(); cells[12][0] = cells[12][1] = cells[12][2] = 1;
  assert.equal(scope.settledStyles(cells).get(72).connected[1], true);
  cells[12][1] = 0;
  const styles = scope.settledStyles(cells);
  assert.equal(styles.get(72).connected[1], false);
  assert.equal(styles.get(74).connected[3], false);
});
test('a solid two-by-two group fills its center without joining a missing diagonal', () => {
  const cells = board(); cells[10][2] = cells[10][3] = cells[11][2] = cells[11][3] = 1;
  const styles = scope.settledStyles(cells), style = styles.get(62), ctx = context();
  assert.deepEqual(Array.from(style.corners), [false, false, true, false]);
  scope.jellyContour(ctx, 60, style.connected, false, style.corners);
  assert.ok(ctx.calls.some(c => c.method === 'lineTo' && c.args[0] === 30 && c.args[1] === 30));
  cells[11][3] = 2;
  assert.equal(scope.settledStyles(cells).get(62).corners[2], false);
});
test('all four body colors stay identical before and after connecting at any board height', () => {
  for(let color=1;color<=4;color++){
    for(const [x,y,size,connected] of [
      [25,6,50,[]], [120,0,60,[]], [120,600,60,[true,false,false,false]],
      [60,300,60,[false,true,true,false]], [120,660,60,[true,true,false,true]],
    ]){
      const ctx=context();scope.jelly(ctx,x,y,size,color,1,0,.1,connected);
      assert.equal(ctx.calls.find(c=>c.method==='fill').fill,palette[color][1]);
    }
  }
});
console.log(`\n${passed} rendering tests passed.`);

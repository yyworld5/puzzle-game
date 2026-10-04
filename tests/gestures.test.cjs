const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../game.js'), 'utf8')
  .replace('const engine = new JellyEngine', 'const engine = globalThis.testEngine = new JellyEngine');
let passed = 0;
function test(name, fn) { fn(); passed++; console.log('PASS ' + name); }

function setup({start = true, width = 300} = {}) {
  const elements = new Map(), windowEvents = {}, documentEvents = {}, softFrames = [];
  let clock = 0, pendingFrame;
  const context = {};
  for (const method of ['save', 'restore', 'translate', 'scale', 'clearRect', 'fillRect', 'beginPath',
    'moveTo', 'lineTo', 'bezierCurveTo', 'quadraticCurveTo', 'closePath', 'fill', 'stroke', 'ellipse', 'arc', 'setLineDash']) context[method] = () => {};
  for (const method of ['createLinearGradient', 'createRadialGradient']) context[method] = () => ({addColorStop() {}});
  function element(id) {
    if (!elements.has(id)) {
      const classes = new Set(), captures = new Set();
      elements.set(id, {
        events: {}, classes, hidden: false, value: '',
        classList: {add: name => classes.add(name), remove: name => classes.delete(name)},
        addEventListener(type, callback) { this.events[type] = callback; },
        setAttribute() {}, blur() {}, getContext: () => context,
        getBoundingClientRect: () => ({left: 20, width}),
        closest: () => ['primary', 'restart', 'overlay', 'music-volume'].includes(id) ? {id} : null,
        setPointerCapture: pointerId => captures.add(pointerId),
        hasPointerCapture: pointerId => captures.has(pointerId),
        releasePointerCapture(pointerId) {
          captures.delete(pointerId);
          this.events.lostpointercapture?.({pointerId});
        },
      });
    }
    return elements.get(id);
  }
  const browser = {
    Math, document: {hidden: false, getElementById: element, querySelectorAll: () => [],
      addEventListener: (type, callback) => { documentEvents[type] = callback; }},
    window: {addEventListener: (type, callback) => { windowEvents[type] = callback; }},
    localStorage: {getItem: () => 'off', setItem() {}},
    requestAnimationFrame: callback => { pendingFrame = callback; },
    JellyMusic: class { state = 'idle'; setVolume() {} setActive() {} next() {} },
    JellyRanking: class { begin() { return true; } show() {} finish() {} },
  };
  vm.createContext(browser); vm.runInContext(source, browser);
  const engine = browser.testEngine, update = engine.update.bind(engine);
  engine.update = (dt, soft) => { softFrames.push(soft); update(dt, soft); };
  const surface = element('play-surface');
  function emit(type, x = 150, y = 200, extra = {}) {
    const event = {pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y,
      timeStamp: clock += 16, target: element('board'), prevented: false,
      preventDefault() { this.prevented = true; }, ...extra};
    surface.events[type](event); return event;
  }
  const click = id => element(id).events.click();
  const frame = (dt = 50) => { clock += dt; pendingFrame(clock); };
  const key = (type, code) => windowEvents[type]({code, repeat: false, target: element('board'), preventDefault() {}});
  if (start) click('primary');
  return {engine, emit, click, frame, key, softFrames, surface, element, browser, windowEvents, documentEvents};
}

test('tapping the left and right halves rotates in opposite directions', () => {
  const game = setup();
  game.emit('pointerdown', 90); game.emit('pointerup', 90);
  assert.equal(game.engine.active.rotation, 3);
  game.emit('pointerdown', 250); game.emit('pointerup', 250);
  assert.equal(game.engine.active.rotation, 0);
});
test('small finger jitter still registers as one tap', () => {
  const game = setup();
  game.emit('pointerdown', 250, 200); game.emit('pointermove', 255, 204); game.emit('pointerup', 255, 204);
  assert.equal(game.engine.active.rotation, 1);
});
test('left and right flicks move without rotating', () => {
  const game = setup();
  game.emit('pointerdown'); game.emit('pointermove', 190); game.emit('pointerup', 190);
  assert.equal(game.engine.active.x, 3); assert.equal(game.engine.active.rotation, 0);
  game.emit('pointerdown', 190); game.emit('pointermove', 150); game.emit('pointerup', 150);
  assert.equal(game.engine.active.x, 2); assert.equal(game.engine.active.rotation, 0);
});
test('a quick flick delivered only on pointerup still moves', () => {
  const game = setup();
  game.emit('pointerdown'); game.emit('pointerup', 190);
  assert.equal(game.engine.active.x, 3); assert.equal(game.engine.active.rotation, 0);
});
test('long drags can cross several columns and reverse direction', () => {
  const game = setup();
  game.emit('pointerdown'); game.emit('pointermove', 240);
  assert.equal(game.engine.active.x, 5);
  game.emit('pointermove', 150); game.emit('pointerup', 150);
  assert.equal(game.engine.active.x, 2); assert.equal(game.engine.active.rotation, 0);
});
test('movement stays inside the board at either wall', () => {
  const game = setup();
  game.emit('pointerdown'); game.emit('pointermove', -200); game.emit('pointerup', -200);
  assert.equal(game.engine.active.x, 0); assert(game.engine.fits(game.engine.active));
  game.emit('pointerdown'); game.emit('pointerup', 1000);
  assert.equal(game.engine.active.x, 5); assert(game.engine.fits(game.engine.active));
});
test('flick sensitivity scales down with a narrow phone board', () => {
  const game = setup({width: 210});
  game.emit('pointerdown', 100); game.emit('pointerup', 126);
  assert.equal(game.engine.active.x, 3); assert.equal(game.engine.active.rotation, 0);
});
test('down flick continues soft falling after release and stops at the next piece', () => {
  const game = setup(), initialY = game.engine.active.y;
  game.emit('pointerdown'); game.emit('pointerup', 150, 270);
  assert.equal(game.engine.active.y, initialY + 1); assert.equal(game.engine.active.rotation, 0);
  game.frame(); game.frame();
  assert.equal(game.softFrames.at(-1), true);
  assert(game.engine.active.y > initialY + 1);
  for (let i = 0; i < 30; i++) game.frame();
  assert.equal(game.engine.phase, 'falling'); assert.equal(game.softFrames.at(-1), false);
  assert(game.engine.board.some(row => row.some(Boolean)));
});
test('horizontal gestures can still move and rotate a fast falling piece', () => {
  const game = setup();
  game.emit('pointerdown'); game.emit('pointerup', 150, 270);
  game.emit('pointerdown'); game.emit('pointerup', 190);
  game.emit('pointerdown', 250); game.emit('pointerup', 250);
  assert.equal(game.engine.active.x, 3); assert.equal(game.engine.active.rotation, 1);
  game.frame(); assert.equal(game.softFrames.at(-1), true);
});
test('diagonal flick chooses one direction rather than moving and falling together', () => {
  const game = setup(), initialY = game.engine.active.y;
  game.emit('pointerdown'); game.emit('pointerup', 220, 240);
  assert(game.engine.active.x > 2); assert.equal(game.engine.active.y, initialY);
  game.frame(); assert.equal(game.softFrames.at(-1), false);
});
test('upward swipes, short drags and long presses do not accidentally rotate', () => {
  const game = setup();
  game.emit('pointerdown'); game.emit('pointerup', 150, 130);
  game.emit('pointerdown'); game.emit('pointerup', 168, 200);
  game.emit('pointerdown', 250, 200, {timeStamp: 1000});
  game.emit('pointerup', 250, 200, {timeStamp: 1600});
  assert.equal(game.engine.active.x, 2); assert.equal(game.engine.active.rotation, 0);
});
test('secondary touches and mouse clicks cannot interfere with the current touch', () => {
  const game = setup();
  game.emit('pointerdown', 90);
  game.emit('pointerdown', 250, 200, {pointerId: 2, isPrimary: false});
  game.emit('pointerup', 250, 200, {pointerId: 2, isPrimary: false});
  game.emit('pointerup', 90);
  assert.equal(game.engine.active.rotation, 3);
  game.emit('pointerdown', 250, 200, {pointerType: 'mouse'});
  game.emit('pointerup', 250, 200, {pointerType: 'mouse'});
  assert.equal(game.engine.active.rotation, 3);
});
test('pointer cancellation and lost capture stop soft fall without rotating', () => {
  for (const event of ['pointercancel', 'lostpointercapture']) {
    const game = setup();
    game.emit('pointerdown'); game.emit('pointermove', 150, 270);
    game.emit(event); game.emit('pointerup', 150, 270); game.frame();
    assert.equal(game.softFrames.at(-1), false); assert.equal(game.engine.active.rotation, 0);
  }
});
test('pausing clears an unfinished gesture and fast fall before resume', () => {
  const game = setup();
  game.emit('pointerdown'); game.emit('pointermove', 150, 270);
  game.click('pause'); assert.equal(game.surface.classes.has('gestures-active'), false);
  game.click('primary'); game.emit('pointerup', 250); game.frame();
  assert.equal(game.softFrames.at(-1), false); assert.equal(game.engine.active.rotation, 0);
  assert.equal(game.surface.classes.has('gestures-active'), true);
});
test('landing cancels a held finger so its release does not rotate the next piece', () => {
  const game = setup();
  game.emit('pointerdown', 250); game.engine.drop();
  for (let i = 0; i < 8; i++) game.frame();
  assert.equal(game.engine.phase, 'falling');
  game.emit('pointerup', 250); assert.equal(game.engine.active.rotation, 0);
});
test('ready, paused, settling and game over states ignore gestures', () => {
  const game = setup({start: false});
  assert.equal(game.emit('pointerdown').prevented, false);
  game.click('primary'); game.click('pause');
  assert.equal(game.emit('pointerdown').prevented, false);
  game.click('primary'); game.engine.drop();
  assert.equal(game.emit('pointerdown').prevented, false);
  game.engine.finish(); assert.equal(game.emit('pointerdown').prevented, false);
  assert.equal(game.surface.classes.has('gestures-active'), false);
});
test('overlay controls are excluded from the gesture surface', () => {
  const game = setup();
  for (const id of ['primary', 'overlay', 'music-volume']) {
    assert.equal(game.emit('pointerdown', 250, 200, {target: game.element(id)}).prevented, false);
    game.emit('pointerup', 250);
  }
  assert.equal(game.engine.active.rotation, 0);
});
test('PC arrow keys, rotation and hard drop remain available', () => {
  const game = setup();
  game.key('keydown', 'ArrowRight'); game.key('keyup', 'ArrowRight');
  assert.equal(game.engine.active.x, 3);
  game.key('keydown', 'KeyZ'); game.key('keyup', 'KeyZ');
  assert.equal(game.engine.active.rotation, 3);
  game.key('keydown', 'ArrowDown'); game.frame(); assert.equal(game.softFrames.at(-1), true);
  game.key('keyup', 'ArrowDown'); game.frame(); assert.equal(game.softFrames.at(-1), false);
  game.key('keydown', 'Space'); game.key('keyup', 'Space');
  assert.equal(game.engine.phase, 'settling');
});
console.log(`${passed} gesture tests passed.`);

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
        listenerOptions: {},
        addEventListener(type, callback, options) { this.events[type] = callback; this.listenerOptions[type] = options; },
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
    Math, document: {hidden: false, body: element('document-body'), getElementById: element, querySelectorAll: () => [],
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
  game.emit('pointerdown'); game.emit('pointermove', 240); game.emit('pointerup', 240);
  assert.equal(game.engine.active.x, 3); assert.equal(game.engine.active.rotation, 0);
  game.emit('pointerdown', 240); game.emit('pointermove', 150); game.emit('pointerup', 150);
  assert.equal(game.engine.active.x, 2); assert.equal(game.engine.active.rotation, 0);
});
test('a quick flick delivered only on pointerup still moves', () => {
  const game = setup();
  game.emit('pointerdown'); game.emit('pointerup', 240);
  assert.equal(game.engine.active.x, 3); assert.equal(game.engine.active.rotation, 0);
});
test('long drags still move multiple columns and can reverse without lifting', () => {
  const game = setup();
  game.emit('pointerdown'); game.emit('pointermove', 390);
  assert.equal(game.engine.active.x, 5);
  game.emit('pointermove', 150); game.emit('pointerup', 150);
  assert.equal(game.engine.active.x, 2); assert.equal(game.engine.active.rotation, 0);
});
test('movement stays inside the board at either wall', () => {
  const game = setup();
  for(let i=0;i<6;i++){game.emit('pointerdown');game.emit('pointerup',-200);}
  assert.equal(game.engine.active.x, 0); assert(game.engine.fits(game.engine.active));
  for(let i=0;i<6;i++){game.emit('pointerdown');game.emit('pointerup',1000);}
  assert.equal(game.engine.active.x, 5); assert(game.engine.fits(game.engine.active));
});
test('flick sensitivity scales down with a narrow phone board', () => {
  const game = setup({width: 210});
  game.emit('pointerdown', 100); game.emit('pointerup', 160);
  assert.equal(game.engine.active.x, 3); assert.equal(game.engine.active.rotation, 0);
});
test('ordinary swipes move fewer columns while longer swipes still work without double counting release', () => {
  const game = setup();
  game.emit('pointerdown'); game.emit('pointermove', 181);
  assert.equal(game.engine.active.x, 2);
  game.emit('pointermove', 240); assert.equal(game.engine.active.x, 3);
  game.emit('pointermove', 390); assert.equal(game.engine.active.x, 5);
  game.emit('pointerup', 390); assert.equal(game.engine.active.x, 5);
  game.emit('pointerdown', 390); game.emit('pointerup', 150); assert.equal(game.engine.active.x, 2);
  assert.equal(game.engine.active.rotation, 0);
});
test('down swipe moves by distance, then returns to ordinary gravity after release', () => {
  const game = setup(), initialY = game.engine.active.y;
  game.emit('pointerdown'); game.emit('pointerup', 150, 270);
  assert.equal(game.engine.active.y, initialY + 1); assert.equal(game.engine.active.rotation, 0);
  for(let i=0;i<10;i++) game.frame();
  assert.equal(game.softFrames.at(-1), false); assert.equal(game.engine.active.y, initialY + 1);
  for(let i=0;i<9;i++) game.frame();
  assert.equal(game.engine.active.y, initialY + 2);
});
test('a long down swipe follows the finger without dropping again on release or while held still', () => {
  const game=setup(), initialY=game.engine.active.y;
  game.emit('pointerdown'); game.emit('pointermove',150,310);
  assert.equal(game.engine.active.y,initialY+2);
  for(let i=0;i<5;i++) game.frame();
  assert.equal(game.engine.active.y,initialY+2); assert.equal(game.softFrames.at(-1),false);
  game.emit('pointermove',150,360); assert.equal(game.engine.active.y,initialY+3);
  game.emit('pointerup',150,360); assert.equal(game.engine.active.y,initialY+3);
  assert.equal(game.engine.score,3);
});
test('vertical swipe steps scale with the rendered board and stop at occupied cells', () => {
  const game=setup({width:210}), initialY=game.engine.active.y;
  game.emit('pointerdown'); game.emit('pointerup',150,270);
  assert.equal(game.engine.active.y,initialY+2);
  game.engine.board[initialY+4][2]=2;
  game.emit('pointerdown'); game.emit('pointerup',150,1000);
  assert.equal(game.engine.active.y,initialY+3); assert(game.engine.fits(game.engine.active));
});
test('horizontal movement and rotation remain available after a down swipe', () => {
  const game = setup();
  game.emit('pointerdown'); game.emit('pointerup', 150, 270);
  game.emit('pointerdown'); game.emit('pointerup', 240);
  game.emit('pointerdown', 250); game.emit('pointerup', 250);
  assert.equal(game.engine.active.x, 3); assert.equal(game.engine.active.rotation, 1);
  game.frame(); assert.equal(game.softFrames.at(-1), false);
});
test('rapid double taps rotate twice and suppress Safari native touch zoom', () => {
  const game=setup();
  assert.equal(game.surface.listenerOptions.touchend.passive,false);
  for(let i=0;i<2;i++) {
    game.emit('pointerdown',250); game.emit('pointerup',250);
    const touch={changedTouches:[{}],touches:[],target:game.element('board'),prevented:false,preventDefault(){this.prevented=true;}};
    game.surface.events.touchend(touch); assert.equal(touch.prevented,true);
  }
  assert.equal(game.engine.active.rotation,2);
  for(const target of ['primary','overlay','music-volume']) {
    const touch={changedTouches:[{}],touches:[],target:game.element(target),prevented:false,preventDefault(){this.prevented=true;}};
    game.surface.events.touchend(touch); assert.equal(touch.prevented,false);
  }
  game.click('pause');
  const touch={changedTouches:[{}],touches:[],target:game.element('board'),prevented:false,preventDefault(){this.prevented=true;}};
  game.surface.events.touchend(touch); assert.equal(touch.prevented,false);
});
test('diagonal flick chooses one direction rather than moving and falling together', () => {
  const game = setup(), initialY = game.engine.active.y;
  game.emit('pointerdown'); game.emit('pointerup', 250, 240);
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
test('page stays fixed through play, pause and resume, then unlocks when the game ends', () => {
  const game = setup({start: false}), body = game.element('document-body');
  assert.equal(body.classes.has('game-active'), false);
  game.click('primary'); assert.equal(body.classes.has('game-active'), true);
  game.click('pause'); assert.equal(body.classes.has('game-active'), true);
  game.click('primary'); assert.equal(body.classes.has('game-active'), true);
  game.browser.document.hidden = true; game.documentEvents.visibilitychange();
  assert.equal(game.engine.status, 'paused'); assert.equal(body.classes.has('game-active'), true);
  game.browser.document.hidden = false; game.click('primary');
  game.engine.finish(); assert.equal(body.classes.has('game-active'), false);
  game.click('primary'); game.click('pause'); game.click('finish-run');
  assert.equal(body.classes.has('game-active'), false);
});
console.log(`${passed} gesture tests passed.`);

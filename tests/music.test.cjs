const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'music.js'), 'utf8');
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(source + '\nglobalThis.Music = JellyMusic;', sandbox);
const Music = sandbox.Music;

class Media {
  constructor() { this.paused = true; this.ended = false; this.currentTime = 0; this.events = {}; this.plays = 0; }
  addEventListener(type, callback) { this.events[type] = callback; }
  pause() { this.paused = true; }
  play() { this.plays++; if (this.rejection) return Promise.reject(this.rejection); this.paused = false; return Promise.resolve(); }
  emit(type) { if (type === 'ended') { this.paused = true; this.ended = true; } this.events[type]?.(); }
  set src(value) { this.url = value; this.currentTime = 0; this.ended = false; }
  get src() { return this.url; }
}
const flush = () => new Promise(resolve => require('node:timers').setImmediate(resolve));
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('PASS ' + name); }

globalThis.musicTestsDone = (async () => {
  await test('all playlist files contain MP3 or Ogg audio', () => {
    assert.ok(Music.tracks.length > 0);
    assert.ok(Music.tracks.some(track => track.src === 'assets/bgm/jinchoge.mp3'));
    assert.ok(Music.tracks.some(track => track.src === 'assets/bgm/jinchoge_melody.mp3'));
    assert.ok(Music.tracks.some(track => track.src === 'assets/bgm/shikikokuka.mp3'));
    for (const track of Music.tracks) {
      const bytes = fs.readFileSync(path.join(root, track.src));
      assert.ok(bytes.length > 100000);
      assert.ok(bytes.subarray(0, 3).toString() === 'ID3' || bytes.subarray(0, 4).toString() === 'OggS');
    }
  });
  await test('no playback before activation; random selection does not repeat immediately', async () => {
    const media = new Media(), music = new Music(media, () => 0);
    assert.equal(media.plays, 0);
    music.next(); assert.equal(media.plays, 0);
    const first = music.track;
    music.setActive(true); await flush(); assert.equal(music.state, 'playing');
    music.next(); await flush(); assert.notEqual(music.track, first); assert.equal(media.plays, 2);
    const high = new Music(new Media(), () => .999);
    high.next(); assert.equal(high.index, Music.tracks.length - 1);
  });
  await test('ended tracks advance only during active play', async () => {
    const media = new Media(), music = new Music(media, () => 0);
    music.setActive(true); await flush(); const first = music.index;
    media.emit('ended'); await flush(); assert.notEqual(music.index, first);
    music.setActive(false); const stopped = music.index;
    media.emit('ended'); assert.equal(music.index, stopped); assert.equal(media.paused, true);
  });
  await test('pause and mute retain playback position and resume the same track', async () => {
    const media = new Media(), music = new Music(media);
    music.setActive(true); await flush(); const selected = music.index;
    media.currentTime = 12;
    music.setActive(false); assert.equal(media.paused, true); assert.equal(media.currentTime, 12);
    music.setActive(true); await flush(); assert.equal(music.index, selected); assert.equal(media.currentTime, 12);
  });
  await test('blocked autoplay can retry on a subsequent user interaction', async () => {
    const media = new Media(), music = new Music(media);
    media.rejection = {name:'NotAllowedError'};
    music.setActive(true); await flush(); assert.equal(music.state, 'blocked');
    media.rejection = null;
    music.setActive(true); await flush(); assert.equal(music.state, 'playing');
  });
  await test('failed tracks are skipped; all failures stop without infinite retries', async () => {
    const media = new Media(), music = new Music(media, () => 0);
    music.setActive(true); await flush(); const first = music.index;
    media.emit('error'); await flush(); assert.notEqual(music.index, first);
    media.rejection = {name:'NotSupportedError'};
    music.next(); await flush();
    assert.equal(music.failed.size, Music.tracks.length); assert.equal(music.state, 'unavailable');
    const attempts = media.plays;
    music.setActive(true); await flush(); assert.equal(media.plays, attempts);
  });
  await test('muting while play is pending ignores stale completion', async () => {
    const media = new Media(); let resolve;
    media.play = () => { media.paused = false; return new Promise(done => { resolve = done; }); };
    const music = new Music(media);
    music.setActive(true); music.setActive(false); resolve(); await flush();
    assert.equal(media.paused, true); assert.equal(music.active, false); assert.notEqual(music.state, 'playing');
  });
  await test('volume is clamped to the supported range', () => {
    const media = new Media(), music = new Music(media);
    music.setVolume(2); assert.equal(media.volume, 1);
    music.setVolume(-1); assert.equal(media.volume, 0);
    music.setVolume(.4); assert.equal(media.volume, .4);
  });
  await test('game controls start, pause, resume, mute, switch tracks, save volume and stop at game over', async () => {
    const elements = new Map(), saved = new Map(), documentEvents = {}, windowEvents = {};
    function element(id) {
      if (!elements.has(id)) elements.set(id, {events:{}, textContent:'', value:'', hidden:false, classList:{add(){},remove(){}}, setAttribute(){}, blur(){}, addEventListener(type, callback){this.events[type]=callback;}, getContext(){return {};}});
      return elements.get(id);
    }
    const browser = {Audio:Media, Math, Promise, document:{hidden:false, body:element('document-body'), getElementById:element, querySelectorAll:()=>[], addEventListener:(type, callback)=>{documentEvents[type]=callback;}}, window:{addEventListener:(type, callback)=>{windowEvents[type]=callback;}}, localStorage:{getItem:key=>saved.get(key)??null, setItem:(key,value)=>saved.set(key,value)}, requestAnimationFrame(){}};
    vm.createContext(browser);
    browser.JellyRanking = class { begin() { return true; } show() {} finish() {} };
    const gameSource = fs.readFileSync(path.join(root, 'game.js'), 'utf8').replace('const music = new JellyMusic', 'const music = globalThis.testMusic = new JellyMusic').replace('const engine = new JellyEngine', 'const engine = globalThis.testEngine = new JellyEngine');
    vm.runInContext(source + '\n' + gameSource, browser);
    const click = id => element(id).events.click();
    const music = browser.testMusic;
    assert.equal(music.media.plays, 0); assert.equal(element('sound').textContent, '音 ON');
    click('primary'); await flush(); assert.equal(music.state, 'playing'); assert.equal(music.active, true);
    click('pause'); assert.equal(music.media.paused, true);
    click('primary'); await flush(); assert.equal(music.media.paused, false);
    click('sound'); assert.equal(music.media.paused, true); assert.equal(saved.get('jelly-sound'), 'off');
    click('sound'); await flush(); assert.equal(music.media.paused, false);
    const selected = music.index; click('music-next'); await flush(); assert.notEqual(music.index, selected);
    element('music-volume').value = '40'; element('music-volume').events.input();
    assert.equal(music.media.volume, .4); assert.equal(saved.get('jelly-music-volume'), '40');
    browser.document.hidden = true; documentEvents.visibilitychange(); assert.equal(music.media.paused, true);
    browser.document.hidden = false; click('primary'); await flush();
    browser.testEngine.finish(); assert.equal(music.media.paused, true); assert.equal(music.active, false);
    click('primary'); await flush(); assert.equal(music.media.paused, false);
    windowEvents.pagehide(); assert.equal(music.media.paused, true);
    saved.set('jelly-sound', 'off');
    const reloaded = {...browser};
    vm.createContext(reloaded); vm.runInContext(source + '\n' + gameSource, reloaded);
    assert.equal(element('sound').textContent, '音 OFF'); assert.equal(reloaded.testMusic.media.volume, .4);
    click('primary'); await flush(); assert.equal(reloaded.testMusic.media.plays, 0);
  });
  console.log(`${passed} music tests passed.`);
})();

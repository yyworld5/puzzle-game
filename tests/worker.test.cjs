const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {DatabaseSync} = require('node:sqlite');
const root = path.join(__dirname, '..');
const scope = {URL, Response, TextDecoder: class extends TextDecoder {
  constructor(...args) { assert.equal(args.length, 0); super(); }
}, Uint8Array};
vm.createContext(scope);
vm.runInContext(fs.readFileSync(path.join(root, 'cloudflare/worker.js'), 'utf8')
  .replace('export default', 'globalThis.worker ='), scope);
const database = new DatabaseSync(':memory:');
database.exec(fs.readFileSync(path.join(root, 'cloudflare/schema.sql'), 'utf8'));
const env = {DB: {prepare(sql) {
  const stmt = database.prepare(sql); let values = [];
  return {
    bind(...args) { values = args; return this; },
    async all() { return {results: stmt.all(...values)}; },
    async run() { const result = stmt.run(...values); return {meta: {last_row_id: Number(result.lastInsertRowid)}}; },
  };
}}};
const get = (path = '/api/ranking', options = {}, config = env) => scope.worker.fetch(new Request('https://ranking.example' + path, options), config);
const post = data => get('/api/scores', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data)});
const count = () => database.prepare('SELECT COUNT(*) AS count FROM scores').get().count;
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('PASS ' + name); }

globalThis.workerTestsDone = (async () => {
  try {
    await test('an empty ranking returns an empty list with browser access headers', async () => {
      const response = await get(); assert.equal(response.status, 200);
      assert.equal(JSON.stringify(await response.json()), '{"ranking":[]}');
      assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
      assert.equal(response.headers.get('Cache-Control'), 'no-store');
    });
    await test('Japanese names are trimmed and scores are stored in the actual schema', async () => {
      const response = await post({username: ' わいわい ', score: 1234});
      assert.equal(response.status, 201); assert.equal((await response.json()).saved, true);
      const saved = database.prepare('SELECT username,score,created_at FROM scores').get();
      assert.equal(saved.username, 'わいわい'); assert.equal(saved.score, 1234); assert.ok(saved.created_at);
    });
    await test('invalid names, scores and malformed requests cannot add records', async () => {
      const before = count();
      for(const data of [null, {}, {username:'',score:10}, {username:'a'.repeat(13),score:10},
        {username:'a\nb',score:10}, {username:'名前',score:-1}, {username:'名前',score:1.5},
        {username:'名前',score:'100'}, {username:'名前',score:2147483648}]) {
        assert.equal((await post(data)).status, 400);
      }
      assert.equal((await get('/api/scores',{method:'POST',body:'not json'})).status,415);
      assert.equal((await get('/api/scores',{method:'POST',headers:{'Content-Type':'application/json'},body:'{'})).status,400);
      assert.equal((await post({username:'名前',score:1,padding:'x'.repeat(1500)})).status,413);
      assert.equal(count(),before);
    });
    await test('names containing SQL punctuation are stored without executing it', async () => {
      assert.equal((await post({username:"a');--",score:1})).status,201);
      assert.equal(database.prepare('SELECT username FROM scores WHERE score=1').get().username,"a');--");
    });
    await test('the ranking returns only ten scores and orders ties by submission', async () => {
      database.exec('DELETE FROM scores');
      for(let i=0;i<12;i++) await post({username:`player${i}`,score:i<2?5000:i});
      const {ranking}=await (await get()).json();
      assert.equal(ranking.length,10); assert.equal(ranking[0].username,'player0');
      assert.equal(ranking[1].username,'player1'); assert.equal(ranking[2].score,11);
      assert.equal(ranking.map(row=>row.rank).join(','),'1,2,3,4,5,6,7,8,9,10');
    });
    await test('old and new repeat plays show only each name highest score before applying the top ten limit', async () => {
      database.exec('DELETE FROM scores');
      for(const score of [100,5000,200,5000]) await post({username:'パパ',score});
      const firstBest=database.prepare('SELECT id FROM scores WHERE username=? AND score=5000 ORDER BY id LIMIT 1').get('パパ');
      for(let i=0;i<12;i++) await post({username:`player${i}`,score:1000-i});
      const {ranking}=await (await get()).json();
      assert.equal(count(),16); assert.equal(ranking.length,10);
      assert.equal(ranking[0].username,'パパ'); assert.equal(ranking[0].score,5000);
      assert.equal(ranking[0].id,firstBest.id);
      assert.equal(new Set(ranking.map(row=>row.username)).size,10);
      assert.equal(ranking[9].username,'player8');
      await post({username:' パパ ',score:6000});
      const updated=await (await get()).json();
      assert.equal(updated.ranking[0].score,6000);
      assert.equal(updated.ranking.filter(row=>row.username==='パパ').length,1);
    });
    await test('preflight, unknown paths, methods and configured origins are handled', async () => {
      assert.equal((await get('/api/scores',{method:'OPTIONS'})).status,204);
      assert.equal((await get('/unknown')).status,404);
      assert.equal((await get('/api/ranking',{method:'DELETE'})).status,405);
      const restricted={...env,ALLOWED_ORIGIN:'https://example.github.io'};
      assert.equal((await get('/api/ranking',{headers:{Origin:'https://other.example'}},restricted)).status,403);
      const valid=await get('/api/ranking',{headers:{Origin:'https://example.github.io'}},restricted);
      assert.equal(valid.status,200); assert.equal(valid.headers.get('Access-Control-Allow-Origin'),restricted.ALLOWED_ORIGIN);
    });
    await test('an unbound or unavailable database returns a clear failure', async () => {
      assert.equal((await get('/api/ranking',{},{})).status,503);
      assert.equal((await get('/api/ranking',{},{DB:{prepare(){throw new Error('private database details');}}})).status,503);
    });
    console.log(`${passed} Worker tests passed.`);
  } finally { database.close(); }
})();

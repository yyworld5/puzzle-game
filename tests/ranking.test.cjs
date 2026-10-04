const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const rankingSource = fs.readFileSync(path.join(root, 'ranking.js'), 'utf8');
const gameSource = fs.readFileSync(path.join(root, 'game.js'), 'utf8')
  .replace('const engine = new JellyEngine', 'const engine = globalThis.testEngine = new JellyEngine')
  .replace('const ranking = new JellyRanking', 'const ranking = globalThis.testRanking = new JellyRanking');
const flush = async () => { for(let i=0;i<35;i++)await Promise.resolve(); };

function setup({name = 'わいわい', rows = [], handler, game = false} = {}) {
  const elements = new Map(), saved = new Map([['jelly-name',name],['jelly-sound','off']]);
  const calls = [], windowEvents = {}, documentEvents = {}; let nextId = 1;
  const doc = {createElement: tag => element(null,tag), getElementById: id => element(id),
    querySelectorAll:()=>[], addEventListener:(type,fn)=>{documentEvents[type]=fn;}, hidden:false};
  function element(id, tag = 'div') {
    if(id && elements.has(id))return elements.get(id);
    const attributes = new Map(), classes = new Set();
    const node = {id, tag, ownerDocument:doc, children:[], events:{}, value:'', textContent:'', hidden:false,
      disabled:false, attributes, classList:{add:name=>classes.add(name),remove:name=>classes.delete(name)},
      setAttribute:(key,value)=>attributes.set(key,value), focus(){this.focused=true;}, blur(){this.focused=false;},
      addEventListener(type,fn){this.events[type]=fn;}, appendChild(child){this.children.push(child);},
      replaceChildren(...children){this.children=children;}, getContext:()=>({}),
      closest:()=>tag==='input'?{}:null};
    if(id)elements.set(id,node);return node;
  }
  const storage = {get:(key,fallback)=>saved.get(key)??fallback,set:(key,value)=>saved.set(key,value)};
  const fetcher = async (url,options={}) => {
    calls.push({url,options});
    if(handler)return handler(url,options);
    if(options.method==='POST'){
      const record=JSON.parse(options.body);rows.push({id:nextId++,rank:rows.length+1,...record});
      return new Response(JSON.stringify({saved:true}),{status:201});
    }
    return new Response(JSON.stringify({ranking:rows}));
  };
  const scope={document:doc,fetch:fetcher,AbortController,setTimeout,clearTimeout,
    window:{addEventListener:(type,fn)=>{windowEvents[type]=fn;}},
    localStorage:{getItem:key=>saved.get(key)??null,setItem:(key,value)=>saved.set(key,value)},
    requestAnimationFrame(){},JellyMusic:class{state='idle';setVolume(){}setActive(){}next(){}}};
  vm.createContext(scope);
  vm.runInContext(rankingSource+'\nglobalThis.Ranking=JellyRanking;'+(game?'\n'+gameSource:''),scope);
  const ranking=game?scope.testRanking:new scope.Ranking(id=>element(id),storage,fetcher);
  return {ranking,element,saved,calls,scope,windowEvents,documentEvents,posts:()=>calls.filter(c=>c.options.method==='POST')};
}
let passed=0;
async function test(name,fn){await fn();passed++;console.log('PASS '+name);}

globalThis.rankingTestsDone=(async()=>{
  await test('ranking names are rendered as text and only the top ten are shown',async()=>{
    const rows=Array.from({length:12},(_,i)=>({username:i?'player'+i:'<img onerror=alert(1)>',score:1200-i}));
    const ui=setup({rows});await flush();const list=ui.element('ranking-list');
    assert.equal(list.children.length,10);
    assert.equal(list.children[0].children[1].textContent,rows[0].username);
    assert.equal(list.children[0].children[1].children.length,0);
    assert.equal(ui.element('ranking-refresh').disabled,false);
  });
  await test('a name is required and validation counts Unicode characters',async()=>{
    const ui=setup({name:''});await flush();assert.equal(ui.ranking.begin(),false);
    assert.equal(ui.element('username-error').hidden,false);assert.equal(ui.element('username').focused,true);
    ui.element('username').value='あ'.repeat(13);assert.equal(ui.ranking.begin(),false);
    ui.element('username').value='名前\nabc';assert.equal(ui.ranking.begin(),false);
    ui.element('username').value='😀'.repeat(12);assert.equal(ui.ranking.begin(),true);
  });
  await test('the chosen name is trimmed, remembered and captured for the current play',async()=>{
    const ui=setup({name:'  わいわい  '});await flush();assert.equal(ui.ranking.begin(),true);
    assert.equal(ui.saved.get('jelly-name'),'わいわい');ui.element('username').value='別の名前';
    await ui.ranking.finish(1234);await ui.ranking.finish(1234);
    assert.equal(ui.posts().length,1);
    assert.equal(JSON.parse(ui.posts()[0].options.body).username,'わいわい');
    assert.equal(ui.element('score-submission').textContent,'ランキングに保存したよ！');
    assert.equal(ui.element('ranking-list').children[0].children[2].textContent,(1234).toLocaleString());
  });
  await test('loading and saving failures are shown without blocking the next game',async()=>{
    const ui=setup({handler:async()=>{throw new Error('offline');}});await flush();
    assert.equal(ui.element('ranking-refresh').disabled,false);
    assert.ok(ui.element('ranking-status').textContent.includes('読み込めません'));
    assert.equal(ui.ranking.begin(),true);await ui.ranking.finish(100);
    assert.ok(ui.element('score-submission').textContent.includes('保存できません'));
    assert.equal(ui.ranking.begin(),true);assert.equal(ui.element('score-submission').hidden,true);
  });
  await test('an older ranking response cannot overwrite a newer refresh',async()=>{
    const pending=[];const ui=setup({handler:()=>new Promise(resolve=>pending.push(resolve))});
    const second=ui.ranking.load();
    pending[1](new Response(JSON.stringify({ranking:[{username:'新しい記録',score:200}]})));await second;
    pending[0](new Response(JSON.stringify({ranking:[{username:'古い記録',score:100}]})));await flush();
    assert.equal(ui.element('ranking-list').children[0].children[1].textContent,'新しい記録');
  });
  await test('a previous score response cannot replace the next game status',async()=>{
    let resolvePost;
    const ui=setup({handler:(url,options)=>options.method==='POST'?new Promise(resolve=>{resolvePost=resolve;}):new Response('{"ranking":[]}')});
    await flush();ui.ranking.begin();const save=ui.ranking.finish(100);ui.ranking.begin();
    resolvePost(new Response('{"saved":true}'));await save;
    assert.equal(ui.element('score-submission').textContent,'');assert.equal(ui.element('score-submission').hidden,true);
  });
  await test('game start requires a name and only game over submits the final score',async()=>{
    const ui=setup({name:'',game:true});await flush();const click=id=>ui.element(id).events.click();
    click('primary');assert.equal(ui.scope.testEngine.status,'ready');
    ui.element('username').value='プレイヤー';click('primary');assert.equal(ui.scope.testEngine.status,'playing');
    click('pause');assert.equal(ui.scope.testEngine.status,'paused');assert.equal(ui.posts().length,0);
    assert.equal(ui.element('username-section').hidden,true);
    click('primary');assert.equal(ui.scope.testEngine.status,'playing');
    ui.scope.testEngine.score=350;ui.scope.testEngine.finish();await flush();
    assert.equal(ui.posts().length,1);assert.equal(JSON.parse(ui.posts()[0].options.body).score,350);
    assert.equal(ui.element('username-section').hidden,false);
  });
  await test('IME Enter and keyboard shortcuts do not interrupt name entry',async()=>{
    const ui=setup({name:'',game:true});await flush();ui.element('username').value='名前';
    ui.element('username').events.keydown({key:'Enter',isComposing:true,preventDefault(){}});
    assert.equal(ui.scope.testEngine.status,'ready');
    ui.windowEvents.keydown({code:'Escape',target:{closest:()=>({})},preventDefault(){}});
    assert.equal(ui.scope.testEngine.status,'ready');
    ui.element('username').events.keydown({key:'Enter',isComposing:false,preventDefault(){}});
    assert.equal(ui.scope.testEngine.status,'playing');
  });
  await test('pausing allows a player to submit the current score and end the run early',async()=>{
    const ui=setup({game:true});await flush();const click=id=>ui.element(id).events.click();
    click('primary');ui.scope.testEngine.score=420;click('pause');
    assert.equal(ui.element('finish-run').hidden,false);assert.equal(ui.posts().length,0);
    click('finish-run');await flush();
    assert.equal(ui.scope.testEngine.status,'over');assert.equal(ui.posts().length,1);
    assert.equal(JSON.parse(ui.posts()[0].options.body).score,420);
    assert.equal(ui.element('score-submission').textContent,'ランキングに保存したよ！');
    assert.equal(ui.element('finish-run').hidden,true);
    click('primary');assert.equal(ui.scope.testEngine.status,'playing');assert.equal(ui.posts().length,1);
  });
  await test('leaving the game tab pauses play while closing it does not submit a score',async()=>{
    const ui=setup({game:true});await flush();ui.element('primary').events.click();
    ui.scope.testEngine.score=240;ui.scope.document.hidden=true;ui.documentEvents.visibilitychange();
    assert.equal(ui.scope.testEngine.status,'paused');assert.equal(ui.posts().length,0);
    ui.windowEvents.pagehide();await flush();assert.equal(ui.posts().length,0);
  });
  await test('the real client and Worker save a score in SQLite and display it in the ranking',async()=>{
    const {DatabaseSync}=require('node:sqlite'), database=new DatabaseSync(':memory:');
    database.exec(fs.readFileSync(path.join(root,'cloudflare/schema.sql'),'utf8'));
    const workerScope={URL,Response,TextDecoder,Uint8Array};vm.createContext(workerScope);
    vm.runInContext(fs.readFileSync(path.join(root,'cloudflare/worker.js'),'utf8').replace('export default','globalThis.worker ='),workerScope);
    const env={DB:{prepare(sql){
      const statement=database.prepare(sql);let values=[];
      return {bind(...args){values=args;return this;},async all(){return {results:statement.all(...values)};},
        async run(){const result=statement.run(...values);return {meta:{last_row_id:Number(result.lastInsertRowid)}};}};
    }}};
    try{
      const ui=setup({name:'わいわい',handler:(url,options)=>workerScope.worker.fetch(new Request(url,options),env)});
      await flush();assert.equal(ui.ranking.begin(),true);await ui.ranking.finish(5678);
      assert.equal(database.prepare('SELECT score FROM scores').get().score,5678);
      assert.equal(ui.element('ranking-list').children[0].children[1].textContent,'わいわい');
      assert.equal(ui.element('ranking-list').children[0].children[2].textContent,(5678).toLocaleString());
      assert.equal(ui.element('score-submission').textContent,'ランキングに保存したよ！');
    }finally{database.close();}
  });
  console.log(`${passed} ranking tests passed.`);
})();

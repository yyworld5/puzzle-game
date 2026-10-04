"use strict";

// Pure game rules are kept separate from input and canvas drawing.
class JellyEngine {
  static COLS = 6;
  static ROWS = 14;
  constructor(random = Math.random, notify = () => {}) {
    this.random = random; this.notify = notify; this.status = "ready";
    this.board = Array.from({length:14}, () => Array(6).fill(0));
    this.queue = [this.pair(), this.pair()]; this.score = 0; this.maxChain = 0;
    this.level = 1; this.cleared = 0; this.active = null;
  }
  pair() { return [1 + Math.floor(this.random() * 4), 1 + Math.floor(this.random() * 4)]; }
  start(difficulty = "easy") {
    this.board = Array.from({length:14}, () => Array(6).fill(0));
    this.queue = [this.pair(), this.pair()]; this.score = 0; this.maxChain = 0;
    this.cleared = 0; this.elapsed = 0; this.level = 1; this.chain = 0;
    this.baseSpeed = {easy:950,normal:680,hard:420}[difficulty] || 950;
    this.status = "playing"; this.spawn(); this.notify("start");
  }
  cells(piece = this.active) {
    if (!piece) return [];
    const offsets = [[0,-1],[1,0],[0,1],[-1,0]];
    const [dx,dy] = offsets[piece.rotation];
    return [{x:piece.x,y:piece.y,color:piece.colors[0]}, {x:piece.x+dx,y:piece.y+dy,color:piece.colors[1]}];
  }
  fits(piece) { return this.cells(piece).every(({x,y}) => x>=0 && x<6 && y>=0 && y<14 && !this.board[y][x]); }
  spawn() {
    this.active = {x:2,y:2,rotation:0,colors:this.queue.shift()}; this.queue.push(this.pair());
    this.phase = "falling"; this.fallTime = 0; this.lockTime = 0; this.lockResets = 0; this.chain = 0;
    if (!this.fits(this.active)) this.finish();
  }
  finish() { this.status = "over"; this.active = null; this.notify("over"); }
  canControl() { return this.status === "playing" && this.phase === "falling" && this.active; }
  grounded() { return this.active && !this.fits({...this.active,y:this.active.y+1}); }
  adjustLock(wasGrounded) { if (wasGrounded && this.lockResets < 8) { this.lockTime = 0; this.lockResets++; } }
  move(dx) {
    if (!this.canControl()) return false;
    const wasGrounded = this.grounded(), candidate = {...this.active,x:this.active.x+dx};
    if (!this.fits(candidate)) return false;
    this.active = candidate; this.adjustLock(wasGrounded); return true;
  }
  rotate(direction) {
    if (!this.canControl()) return false;
    const wasGrounded = this.grounded();
    const rotated = {...this.active,rotation:(this.active.rotation+direction+4)%4};
    for (const [dx,dy] of [[0,0],[-1,0],[1,0],[0,-1]]) {
      const candidate = {...rotated,x:rotated.x+dx,y:rotated.y+dy};
      if (this.fits(candidate)) { this.active = candidate; this.adjustLock(wasGrounded); this.notify("rotate"); return true; }
    }
    return false;
  }
  down(soft = false) {
    if (!this.canControl()) return false;
    const candidate = {...this.active,y:this.active.y+1};
    if (!this.fits(candidate)) return false;
    this.active = candidate; this.lockTime = 0; if (soft) this.score++; return true;
  }
  ghost() {
    if (!this.active) return null;
    const ghost = {...this.active};
    while (this.fits({...ghost,y:ghost.y+1})) ghost.y++;
    return ghost;
  }
  drop() {
    if (!this.canControl()) return;
    const landing = this.ghost(); this.score += (landing.y-this.active.y)*2; this.active = landing; this.lock();
  }
  lock() {
    for (const {x,y,color} of this.cells()) this.board[y][x] = color;
    this.active = null; this.phase = "settling"; this.phaseTime = 160; this.notify("land");
  }
  gravity() {
    for (let x=0;x<6;x++) {
      const occupied = this.board.map(row=>row[x]).filter(Boolean);
      for (let y=13;y>=0;y--) this.board[y][x] = occupied.pop() || 0;
    }
  }
  groups() {
    const visited = new Set(), groups = [];
    for (let y=0;y<14;y++) for (let x=0;x<6;x++) {
      const color = this.board[y][x], key = y*6+x;
      if (!color || visited.has(key)) continue;
      const group = [{x,y,color}]; visited.add(key);
      for (let i=0;i<group.length;i++) {
        const cell = group[i];
        for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          const nx=cell.x+dx, ny=cell.y+dy, nk=ny*6+nx;
          if (nx>=0 && nx<6 && ny>=0 && ny<14 && this.board[ny][nx]===color && !visited.has(nk)) {
            visited.add(nk); group.push({x:nx,y:ny,color});
          }
        }
      }
      if (group.length>=4) groups.push(group);
    }
    return groups;
  }
  resolve() {
    this.gravity(); const groups = this.groups();
    if (!groups.length) { this.spawn(); return; }
    this.chain++; this.maxChain = Math.max(this.maxChain,this.chain);
    this.popping = groups.flat(); this.cleared += this.popping.length;
    const multiplier = this.chain === 1 ? 1 : Math.min(64,2**this.chain);
    const bonus = groups.reduce((sum,group)=>sum+Math.max(0,group.length-4),0);
    const points = this.popping.length*10*(multiplier+bonus+groups.length-1);
    this.score += points; this.phase = "popping"; this.phaseTime = 420;
    this.notify("clear",{cells:this.popping,chain:this.chain,points});
  }
  update(dt,soft = false) {
    if (this.status !== "playing") return;
    this.elapsed += dt; this.level = 1+Math.floor(this.elapsed/45000);
    if (this.phase !== "falling") {
      this.phaseTime -= dt;
      if (this.phaseTime>0) return;
      if (this.phase === "popping") {
        for (const {x,y} of this.popping) this.board[y][x] = 0;
        this.popping = []; this.phase = "settling"; this.phaseTime = 230;
        if (this.board.every(row=>row.every(value=>!value))) { this.score += 1000; this.notify("allclear"); }
      } else this.resolve();
      return;
    }
    const interval = soft ? 40 : Math.max(120,this.baseSpeed*(.88**(this.level-1)));
    this.fallTime += dt;
    if (this.fallTime >= interval) { this.fallTime %= interval; this.down(soft); }
    if (this.grounded()) { this.lockTime += dt; if (this.lockTime>=500) this.lock(); }
    else this.lockTime = 0;
  }
}

if (typeof document !== "undefined") {
  const $ = id => document.getElementById(id);
  const boardCanvas=$("board"), ctx=boardCanvas.getContext("2d"), nextContexts=[$("next").getContext("2d"),$("next-later").getContext("2d")];
  // Highlight, body and rim: saturated candy colors stay distinct on the dark board.
  const palette=[null,["#d9ff9b","#55d51c","#208513"],["#ffbaa3","#f33e39","#a81838"],["#fffbb4","#ffd82d","#d68a0c"],["#b0f0ff","#329dff","#2451b8"]];
  const reducedMotion=window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches??false;
  let motionTime=0, previousCells=new Map();
  const squishes=new Map();
  const storage = {get(key,fallback){try{return localStorage.getItem(key)??fallback;}catch{return fallback;}},set(key,value){try{localStorage.setItem(key,String(value));}catch{}}};
  const ranking = new JellyRanking($,storage);
  let best=Number(storage.get("jelly-best",0))||0, difficulty=storage.get("jelly-difficulty","easy");
  if (!["easy","normal","hard"].includes(difficulty)) difficulty="easy";
  let sound=storage.get("jelly-sound","on")==="on", audio, particles=[], calloutTime=0;
  const held = new Map();
  const gestureSurface=$("play-surface");
  let gesture=null;
  const engine = new JellyEngine(Math.random,onEvent);
  const music = new JellyMusic(undefined,Math.random,musicLabel);
  const savedVolume = Number(storage.get("jelly-music-volume",25));
  const musicVolume = Number.isFinite(savedVolume) ? Math.max(0,Math.min(100,savedVolume)) : 25;
  $("music-volume").value=musicVolume;$("music-volume-value").textContent=`${musicVolume}%`;music.setVolume(musicVolume/100);
  function musicLabel(){
    const track=music.track;
    let text="あそぶとランダム再生";
    if(!sound)text="音 OFF";
    else if(music.state==="unavailable")text="BGMを読み込めませんでした";
    else if(engine.status==="paused")text=track?`一時停止 · ${track.title}`:"一時停止";
    else if(engine.status==="playing"){
      if(music.state==="blocked")text="ゲーム操作でBGMを再開";
      else if(music.state==="loading")text=`読み込み中 · ${track?.title||""}`;
      else text=track?`${track.title} / ${track.artist}`:text;
    }
    $("music-status").textContent=`BGM · ${text}`;
    $("music-next").disabled=!sound||engine.status!=="playing"||music.state==="unavailable";
  }
  function syncMusic(){music.setActive(sound&&engine.status==="playing"&&!document.hidden);musicLabel();}
  $("music-volume").addEventListener("input",()=>{const value=Number($("music-volume").value);music.setVolume(value/100);storage.set("jelly-music-volume",value);$("music-volume-value").textContent=`${value}%`;});
  $("music-next").addEventListener("click",()=>{music.next();$("music-next").blur();});
  function unlockAudio(){if(!sound)return;try{audio ||= new (window.AudioContext||window.webkitAudioContext)();audio.resume().catch(()=>{});}catch{}}
  function tone(frequency,duration=.09,type="sine",delay=0){
    if(!sound||!audio)return;
    const osc=audio.createOscillator(), gain=audio.createGain(), time=audio.currentTime+delay;
    osc.type=type;osc.frequency.setValueAtTime(frequency,time);gain.gain.setValueAtTime(.045,time);gain.gain.exponentialRampToValueAtTime(.001,time+duration);
    osc.connect(gain);gain.connect(audio.destination);osc.start(time);osc.stop(time+duration);
  }
  function onEvent(type,data){
    if(type==="rotate")tone(340,.04);
    if(type==="land")tone(125,.08,"triangle");
    if(type==="land")cancelGesture();
    if(type==="clear"){
      showCallout(data.chain>1?`${data.chain} CHAIN!\n+${data.points}`:`+${data.points}`);
      [0,4,7].forEach((note,i)=>tone(300*2**((note+data.chain*2)/12),.16,"sine",i*.055));
      for(const cell of data.cells)for(let i=0;i<7;i++)particles.push({x:cell.x*60+30,y:(cell.y-2)*60+30,vx:(Math.random()-.5)*170,vy:-Math.random()*160-25,life:650,max:650,color:palette[cell.color][1]});
    }
    if(type==="allclear"){showCallout("ALL CLEAR!\n+1,000");tone(880,.3);}
    if(type==="over"){
      syncMusic();clearInput();syncGestureSurface();saveBest();tone(150,.4,"triangle");showOverlay("over");
      ranking.finish(engine.score);
    }
  }
  function saveBest(){if(engine.score>best){best=engine.score;storage.set("jelly-best",best);}}
  function showCallout(text){$("chain").textContent=text;$("chain").classList.add("show");calloutTime=1100;}
  function showOverlay(mode){
    ranking.show(mode);
    $("overlay").hidden=false;$("difficulty-section").hidden=mode==="paused";$("restart").hidden=mode!=="paused";
    $("finish-run").hidden=mode!=="paused";
    $("pause").disabled=mode!=="paused";
    if(mode==="paused"){
      $("overlay-kicker").textContent="TAKE A LITTLE BREAK";$("overlay-title").textContent="ひとやすみ。";
      $("overlay-description").textContent="準備ができたら、つづきから。";$("primary").textContent="つづける →";$("overlay-hint").textContent="「つづける」で再開できます";
    }else if(mode==="over"){
      $("overlay-kicker").textContent="NICE DROPS!";$("overlay-title").textContent="また、ひと連鎖。";
      $("overlay-description").textContent=`SCORE  ${engine.score.toLocaleString()}\n最大 ${engine.maxChain} 連鎖 ・ ${engine.cleared} 個消去`;
      $("primary").textContent="もう一度あそぶ →";$("overlay-hint").textContent=`BEST  ${best.toLocaleString()}`;
    }
  }
  function start(){if(!ranking.begin())return;unlockAudio();music.setActive(false);music.next();clearInput();particles=[];calloutTime=0;squishes.clear();previousCells.clear();motionTime=0;$("chain").classList.remove("show");engine.start(difficulty);syncMusic();syncGestureSurface();$("overlay").hidden=true;$("pause").disabled=false;$("primary").blur();$("username").blur();}
  function pause(){
    if(engine.status==="playing"){engine.status="paused";clearInput();saveBest();showOverlay("paused");}
    else if(engine.status==="paused"){engine.status="playing";$("overlay").hidden=true;$("pause").disabled=false;unlockAudio();}
    syncMusic();
    syncGestureSurface();
  }
  $("primary").addEventListener("click",()=>engine.status==="paused"?pause():start());
  $("restart").addEventListener("click",start);$("pause").addEventListener("click",pause);
  $("finish-run").addEventListener("click",()=>{if(engine.status==="paused")engine.finish();});
  $("username").addEventListener("keydown",event=>{if(event.key==="Enter"&&!event.isComposing&&engine.status!=="playing"&&engine.status!=="paused"){event.preventDefault();start();}});
  function soundLabel(){$("sound").textContent=`音 ${sound?"ON":"OFF"}`;$("sound").setAttribute("aria-pressed",String(sound));$("sound").setAttribute("aria-label",sound?"音をオフにする":"音をオンにする");}
  $("sound").addEventListener("click",()=>{sound=!sound;storage.set("jelly-sound",sound?"on":"off");unlockAudio();syncMusic();soundLabel();tone(550);$("sound").blur();});soundLabel();musicLabel();
  const difficultyButtons=[...document.querySelectorAll("[data-difficulty]")];
  function selectDifficulty(){difficultyButtons.forEach(button=>button.setAttribute("aria-pressed",String(button.dataset.difficulty===difficulty)));}
  difficultyButtons.forEach(button=>button.addEventListener("click",()=>{difficulty=button.dataset.difficulty;storage.set("jelly-difficulty",difficulty);selectDifficulty();}));selectDifficulty();
  function action(name){
    if(name==="left")engine.move(-1);if(name==="right")engine.move(1);
    if(name==="cw")engine.rotate(1);if(name==="ccw")engine.rotate(-1);if(name==="drop")engine.drop();if(name==="down")engine.down(true);
  }
  function beginInput(token,name){
    if(held.has(token)||!engine.canControl())return;
    unlockAudio();if(music.state==="blocked")syncMusic();held.set(token,{name,time:0,next:170});action(name);
  }
  function endInput(token){held.delete(token);}
  function clearInput(){for(const token of [...held.keys()])endInput(token);cancelGesture();}
  function syncGestureSurface(){
    gestureSurface.classList[engine.status==="playing"?"add":"remove"]("gestures-active");
    document.body.classList[["playing","paused"].includes(engine.status)?"add":"remove"]("game-active");
  }
  function cancelGesture(){
    const pointerId=gesture?.pointerId;gesture=null;
    if(pointerId!==undefined&&gestureSurface.hasPointerCapture?.(pointerId))gestureSurface.releasePointerCapture(pointerId);
  }
  const keyMap={ArrowLeft:"left",ArrowRight:"right",ArrowDown:"down",ArrowUp:"cw",KeyX:"cw",KeyZ:"ccw",Space:"drop"};
  window.addEventListener("keydown",event=>{
    if(event.target.closest?.("input,textarea"))return;
    if(event.code==="Escape"||event.code==="KeyP"){if(!event.repeat)pause();event.preventDefault();return;}
    if(event.target.closest?.("button,input,summary,a"))return;
    const name=keyMap[event.code];if(!name||engine.status!=="playing")return;
    event.preventDefault();if(!event.repeat)beginInput(event.code,name);
  });
  window.addEventListener("keyup",event=>endInput(event.code));
  gestureSurface.addEventListener("pointerdown",event=>{
    if(event.pointerType==="mouse"||event.isPrimary===false||gesture||!engine.canControl())return;
    if(event.target.closest?.("button,input,summary,a,#overlay"))return;
    event.preventDefault();unlockAudio();if(music.state==="blocked")syncMusic();
    const bounds=boardCanvas.getBoundingClientRect();
    gesture={pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,anchorX:event.clientX,anchorY:event.clientY,
      started:event.timeStamp,midpoint:bounds.left+bounds.width/2,threshold:Math.max(18,Math.min(36,bounds.width/10)),
      step:Math.max(31,Math.min(67.5,bounds.width*3/16)),downStep:Math.max(14,bounds.width/6),axis:null,dragged:false};
    gestureSurface.setPointerCapture(event.pointerId);
  });
  function moveGesture(event){
    if(!gesture||gesture.pointerId!==event.pointerId||!engine.canControl())return;
    event.preventDefault();
    const dx=event.clientX-gesture.startX,dy=event.clientY-gesture.startY;
    if(Math.hypot(dx,dy)>10)gesture.dragged=true;
    if(!gesture.axis&&Math.max(Math.abs(dx),Math.abs(dy))>=gesture.threshold){
      gesture.axis=Math.abs(dx)>Math.abs(dy)?"x":dy>0?"down":"ignored";
    }
    if(gesture.axis==="x"){
      const distance=event.clientX-gesture.anchorX,steps=Math.trunc(distance/gesture.step);
      for(let i=0;i<Math.min(6,Math.abs(steps));i++)action(steps>0?"right":"left");
      gesture.anchorX+=steps*gesture.step;
    }
    if(gesture.axis==="down"){
      const steps=Math.max(0,Math.floor((event.clientY-gesture.anchorY)/gesture.downStep));
      for(let i=0;i<Math.min(14,steps);i++)action("down");
      gesture.anchorY+=steps*gesture.downStep;
    }
  }
  gestureSurface.addEventListener("pointermove",moveGesture);
  gestureSurface.addEventListener("pointerup",event=>{
    if(!gesture||gesture.pointerId!==event.pointerId)return;
    moveGesture(event);
    if(engine.canControl()&&!gesture.dragged&&event.timeStamp-gesture.started<=450)action(gesture.startX<gesture.midpoint?"ccw":"cw");
    cancelGesture();
  });
  // Safari must not treat a quick pair of game taps as its native zoom gesture.
  gestureSurface.addEventListener("touchend",event=>{
    if(engine.status==="playing"&&event.changedTouches.length===1&&event.touches.length===0&&
       !event.target.closest?.("button,input,summary,a,#overlay"))event.preventDefault();
  },{passive:false});
  for(const type of ["pointercancel","lostpointercapture"])gestureSurface.addEventListener(type,event=>{
    if(gesture?.pointerId===event.pointerId)cancelGesture();
  });
  gestureSurface.addEventListener("contextmenu",event=>{if(engine.status==="playing")event.preventDefault();});
  function autoPause(){clearInput();if(engine.status==="playing")pause();}
  document.addEventListener("visibilitychange",()=>{if(document.hidden)autoPause();});window.addEventListener("blur",autoPause);window.addEventListener("pagehide",()=>{music.setActive(false);saveBest();});
  function settledStyles(board){
    const styles=new Map();
    for(let y=2;y<14;y++)for(let x=0;x<6;x++){
      const color=board[y][x];if(!color)continue;
      const connected=[[0,-1],[1,0],[0,1],[-1,0]].map(([dx,dy])=>{
        const nx=x+dx,ny=y+dy;
        return nx>=0&&nx<6&&ny>=2&&ny<14&&board[ny][nx]===color;
      });
      const corners=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([dx,dy],corner)=>
        connected[(corner+3)%4]&&connected[corner]&&board[y+dy]?.[x+dx]===color);
      styles.set(y*6+x,{connected,corners});
    }
    return styles;
  }
  function jellyContour(context,size,connected,outline=false,corners=[]){
    const radius=size*.4165,diagonal=radius/Math.SQRT2,neck=size*.245,edge=size/2;
    context.beginPath();context.moveTo(corners[0]?-edge:-diagonal,corners[0]?-edge:-diagonal);
    for(let side=0;side<4;side++){
      const point=(x,y)=>side===0?[x,y]:side===1?[-y,x]:side===2?[-x,-y]:[y,-x];
      const curve=(x1,y1,x2,y2,x,y)=>context.bezierCurveTo(...point(x1,y1),...point(x2,y2),...point(x,y));
      if(connected[side]){
        if(corners[side])context[outline?"moveTo":"lineTo"](...point(-neck,-edge));
        else curve(-neck,-diagonal-size*.05,-neck,-edge+size*.1,-neck,-edge);
        context[outline?"moveTo":"lineTo"](...point(neck,-edge));
        if(corners[(side+1)%4])context[outline?"moveTo":"lineTo"](...point(edge,-edge));
        else curve(neck,-edge+size*.1,neck,-diagonal-size*.05,diagonal,-diagonal);
      }else{
        const handle=diagonal*.55228475;
        curve(-diagonal+handle,-diagonal-handle,diagonal-handle,-diagonal-handle,diagonal,-diagonal);
      }
    }
    if(!outline)context.closePath();
  }
  function jelly(context,x,y,size,color,alpha=1,pop=0,wobble=0,connected=[],corners=[]){
    const [light,body,dark]=palette[color];context.save();context.globalAlpha=alpha;
    const joined=connected.some(Boolean);
    // Joined bodies stay on the cell edges while their faces gently wobble.
    context.translate(x+size/2,y+size/2+(joined?0:size*wobble*.32));
    const scale=1+(reducedMotion?0:pop*.1);
    if(!joined)context.scale(scale*(1+wobble),scale*(1-wobble*.8));const w=size*.85,h=size*.85;
    // Keep the same saturated base in every state; reflections are local overlays.
    context.fillStyle=body;context.shadowColor=dark+"88";context.shadowBlur=joined?0:size*.065;context.shadowOffsetY=joined?0:size*.035;
    jellyContour(context,size,connected,false,corners);context.fill();
    context.shadowBlur=0;context.shadowOffsetY=0;context.strokeStyle=dark;context.lineWidth=size*.022;
    jellyContour(context,size,connected,true,corners);context.stroke();
    if(joined)context.scale(1+wobble*.3,1-wobble*.25);
    // A broad soft reflection plus a sharp glint gives the rounded body a wet shine.
    const shine=context.createRadialGradient(-w*.2,-h*.23,0,-w*.2,-h*.23,w*.37);
    shine.addColorStop(0,"#ffffffdd");shine.addColorStop(.5,"#ffffff55");shine.addColorStop(1,"#ffffff00");
    context.fillStyle=shine;context.beginPath();context.ellipse(-w*.17,-h*.23,w*.29,h*.14,-.4,0,Math.PI*2);context.fill();
    context.fillStyle="#fff";context.beginPath();context.ellipse(-w*.23,-h*.29,w*.095,h*.046,-.5,0,Math.PI*2);context.fill();
    context.fillStyle="#ffffffaa";context.beginPath();context.arc(w*.24,-h*.2,size*.028,0,Math.PI*2);context.fill();
    context.strokeStyle=light+"88";context.lineWidth=size*.027;context.beginPath();context.moveTo(-w*.28,h*.34);context.quadraticCurveTo(0,h*.44,w*.27,h*.34);context.stroke();
    for(const dx of [-.14,.14]){
      const ey=size*(color===3?.075:.055), eyeHeight=size*(color===3?.088:.12);
      context.fillStyle="#fffff5";context.beginPath();context.ellipse(size*dx,ey,size*.089,eyeHeight,dx*.4,0,Math.PI*2);context.fill();
      context.fillStyle="#182243";context.beginPath();context.ellipse(size*(dx+.012),ey+size*.014,size*.032,eyeHeight*.62,0,0,Math.PI*2);context.fill();
      context.fillStyle="#fff";context.beginPath();context.arc(size*(dx+.002),ey-size*.01,size*.013,0,Math.PI*2);context.fill();
    }
    context.strokeStyle=dark;context.lineWidth=size*.022;context.lineCap="round";context.beginPath();context.arc(0,size*.19,size*.047,0,Math.PI);context.stroke();
    context.restore();
  }
  function draw(dt){
    if(engine.status==="playing"&&!reducedMotion)motionTime+=dt;
    ctx.clearRect(0,0,360,720);ctx.fillStyle="#091c39";ctx.fillRect(0,0,360,720);
    for(let y=0;y<12;y++)for(let x=0;x<6;x++){
      ctx.fillStyle="#284977";ctx.fillRect(x*60,y*60,60,60);
      ctx.fillStyle=(x+y)%2===0?"#0c2345":"#0a203e";ctx.fillRect(x*60+1,y*60+1,58,58);
    }
    ctx.strokeStyle="#ff414a";ctx.lineWidth=7;ctx.lineCap="round";ctx.beginPath();ctx.moveTo(138,13);ctx.lineTo(162,37);ctx.moveTo(162,13);ctx.lineTo(138,37);ctx.stroke();
    const popping=engine.phase==="popping"?new Set(engine.popping.map(c=>c.y*6+c.x)):new Set();
    const styles=settledStyles(engine.board);
    const currentCells=new Map();
    for(let y=2;y<14;y++)for(let x=0;x<6;x++){const color=engine.board[y][x],key=y*6+x;if(color){
      currentCells.set(key,color);
      if(!reducedMotion&&previousCells.get(key)!==color)squishes.set(key,0);
      const age=squishes.get(key);let wobble=reducedMotion?0:Math.sin(motionTime/360+x*.7+y*.45)*.012;
      if(age!==undefined){wobble+=Math.sin(age/430*Math.PI*3)*.17*Math.exp(-age/145);if(engine.status==="playing")squishes.set(key,age+dt);if(age>430)squishes.delete(key);}
      const pop=popping.has(key)?Math.sin(engine.phaseTime/45):0;
      const style=styles.get(key);jelly(ctx,x*60,(y-2)*60,60,color,pop?(.65+.35*Math.abs(pop)):1,pop,wobble,style.connected,style.corners);
    }}
    previousCells=currentCells;for(const key of squishes.keys())if(!currentCells.has(key))squishes.delete(key);
    if(engine.active){
      const ghost=engine.ghost();ctx.save();ctx.strokeStyle="#d6e7fb88";ctx.lineWidth=2.5;ctx.setLineDash([6,5]);
      for(const cell of engine.cells(ghost)){ctx.beginPath();ctx.ellipse(cell.x*60+30,(cell.y-2)*60+30,24,25,0,0,Math.PI*2);ctx.stroke();}
      ctx.restore();
      for(const cell of engine.cells())jelly(ctx,cell.x*60,(cell.y-2)*60,60,cell.color,1,0,reducedMotion?0:Math.sin(motionTime/220)*.025);
    }
    if(engine.status==="playing")for(const p of particles){p.life-=dt;p.x+=p.vx*dt/1000;p.y+=p.vy*dt/1000;p.vy+=350*dt/1000;}
    particles=particles.filter(p=>p.life>0);for(const p of particles){ctx.globalAlpha=p.life/p.max;ctx.fillStyle=p.color;ctx.beginPath();ctx.arc(p.x,p.y,3.5*p.life/p.max,0,Math.PI*2);ctx.fill();}ctx.globalAlpha=1;
    engine.queue.forEach((pair,i)=>{const nextCtx=nextContexts[i];nextCtx.clearRect(0,0,100,110);jelly(nextCtx,25,6,50,pair[1]);jelly(nextCtx,25,54,50,pair[0]);});
    $("score").textContent=String(engine.score).padStart(6,"0");$("best").textContent=String(Math.max(best,engine.score)).padStart(6,"0");$("level").textContent=String(engine.level).padStart(2,"0");$("max-chain").textContent=engine.maxChain;
    if(calloutTime>0&&engine.status==="playing"){calloutTime-=dt;if(calloutTime<=0)$("chain").classList.remove("show");}
  }
  let last=0;
  function frame(now){const dt=Math.min(50,now-last||16);last=now;
    if(engine.status==="playing")for(const input of held.values()){input.time+=dt;if((input.name==="left"||input.name==="right")&&input.time>=input.next){action(input.name);input.next=input.time+65;}}
    engine.update(dt,[...held.values()].some(input=>input.name==="down"));draw(dt);requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

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
  const boardCanvas=$("board"), ctx=boardCanvas.getContext("2d"), nextCtx=$("next").getContext("2d");
  const palette=[null,["#9bf5d2","#55c8a5"],["#ffa6bb","#eb6b90"],["#ffe994","#e8bc4d"],["#d1baff","#9b80e6"]];
  const storage = {get(key,fallback){try{return localStorage.getItem(key)??fallback;}catch{return fallback;}},set(key,value){try{localStorage.setItem(key,String(value));}catch{}}};
  let best=Number(storage.get("jelly-best",0))||0, difficulty=storage.get("jelly-difficulty","easy");
  if (!["easy","normal","hard"].includes(difficulty)) difficulty="easy";
  let sound=storage.get("jelly-sound","off")==="on", audio, particles=[], calloutTime=0;
  const held = new Map();
  const engine = new JellyEngine(Math.random,onEvent);
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
    if(type==="clear"){
      showCallout(data.chain>1?`${data.chain} CHAIN!\n+${data.points}`:`+${data.points}`);
      [0,4,7].forEach((note,i)=>tone(300*2**((note+data.chain*2)/12),.16,"sine",i*.055));
      for(const cell of data.cells)for(let i=0;i<7;i++)particles.push({x:cell.x*60+30,y:(cell.y-2)*60+30,vx:(Math.random()-.5)*170,vy:-Math.random()*160-25,life:650,max:650,color:palette[cell.color][0]});
    }
    if(type==="allclear"){showCallout("ALL CLEAR!\n+1,000");tone(880,.3);}
    if(type==="over"){
      clearInput();saveBest();tone(150,.4,"triangle");showOverlay("over");
    }
  }
  function saveBest(){if(engine.score>best){best=engine.score;storage.set("jelly-best",best);}}
  function showCallout(text){$("chain").textContent=text;$("chain").classList.add("show");calloutTime=1100;}
  function showOverlay(mode){
    $("overlay").hidden=false;$("difficulty-section").hidden=mode==="paused";$("restart").hidden=mode!=="paused";
    $("pause").disabled=mode!=="paused";
    if(mode==="paused"){
      $("overlay-kicker").textContent="TAKE A LITTLE BREAK";$("overlay-title").textContent="ひとやすみ。";
      $("overlay-description").textContent="準備ができたら、つづきから。";$("primary").textContent="つづける →";$("overlay-hint").textContent="Esc / P キーでも再開できます";
    }else if(mode==="over"){
      $("overlay-kicker").textContent="NICE DROPS!";$("overlay-title").textContent="また、ひと連鎖。";
      $("overlay-description").textContent=`SCORE  ${engine.score.toLocaleString()}\n最大 ${engine.maxChain} 連鎖 ・ ${engine.cleared} 個消去`;
      $("primary").textContent="もう一度あそぶ →";$("overlay-hint").textContent=`BEST  ${best.toLocaleString()}`;
    }
  }
  function start(){unlockAudio();clearInput();particles=[];calloutTime=0;$("chain").classList.remove("show");engine.start(difficulty);$("overlay").hidden=true;$("pause").disabled=false;$("primary").blur();}
  function pause(){
    if(engine.status==="playing"){engine.status="paused";clearInput();saveBest();showOverlay("paused");}
    else if(engine.status==="paused"){engine.status="playing";$("overlay").hidden=true;$("pause").disabled=false;unlockAudio();}
  }
  $("primary").addEventListener("click",()=>engine.status==="paused"?pause():start());
  $("restart").addEventListener("click",start);$("pause").addEventListener("click",pause);
  function soundLabel(){$("sound").textContent=`音 ${sound?"ON":"OFF"}`;$("sound").setAttribute("aria-pressed",String(sound));$("sound").setAttribute("aria-label",sound?"音をオフにする":"音をオンにする");}
  $("sound").addEventListener("click",()=>{sound=!sound;storage.set("jelly-sound",sound?"on":"off");unlockAudio();soundLabel();tone(550);});soundLabel();
  const difficultyButtons=[...document.querySelectorAll("[data-difficulty]")];
  function selectDifficulty(){difficultyButtons.forEach(button=>button.setAttribute("aria-pressed",String(button.dataset.difficulty===difficulty)));}
  difficultyButtons.forEach(button=>button.addEventListener("click",()=>{difficulty=button.dataset.difficulty;storage.set("jelly-difficulty",difficulty);selectDifficulty();}));selectDifficulty();
  function action(name){
    if(name==="left")engine.move(-1);if(name==="right")engine.move(1);
    if(name==="cw")engine.rotate(1);if(name==="ccw")engine.rotate(-1);if(name==="drop")engine.drop();if(name==="down")engine.down(true);
  }
  function beginInput(token,name,button){
    if(held.has(token)||!engine.canControl())return;
    unlockAudio();held.set(token,{name,time:0,next:170,button});button?.classList.add("pressed");action(name);
  }
  function endInput(token){const input=held.get(token);held.delete(token);if(input?.button&&![...held.values()].some(other=>other.button===input.button))input.button.classList.remove("pressed");}
  function clearInput(){for(const token of [...held.keys()])endInput(token);}
  const keyMap={ArrowLeft:"left",ArrowRight:"right",ArrowDown:"down",ArrowUp:"cw",KeyX:"cw",KeyZ:"ccw",Space:"drop"};
  window.addEventListener("keydown",event=>{
    if(event.code==="Escape"||event.code==="KeyP"){if(!event.repeat)pause();event.preventDefault();return;}
    const name=keyMap[event.code];if(!name||engine.status!=="playing")return;
    event.preventDefault();if(!event.repeat)beginInput(event.code,name);
  });
  window.addEventListener("keyup",event=>endInput(event.code));
  document.querySelectorAll("[data-action]").forEach(button=>{
    button.addEventListener("pointerdown",event=>{event.preventDefault();button.setPointerCapture(event.pointerId);beginInput(`pointer${event.pointerId}`,button.dataset.action,button);});
    for(const type of ["pointerup","pointercancel","lostpointercapture"])button.addEventListener(type,event=>endInput(`pointer${event.pointerId}`));
    button.addEventListener("contextmenu",event=>event.preventDefault());
    button.addEventListener("click",event=>{if(event.detail===0)action(button.dataset.action);});
  });
  function autoPause(){clearInput();if(engine.status==="playing")pause();}
  document.addEventListener("visibilitychange",()=>{if(document.hidden)autoPause();});window.addEventListener("blur",autoPause);window.addEventListener("pagehide",saveBest);
  function jelly(context,x,y,size,color,alpha=1,pop=0){
    const [light,dark]=palette[color];context.save();context.globalAlpha=alpha;context.translate(x+size/2,y+size/2);
    const scale=1+pop*.13;context.scale(scale,scale);const w=size*.87,h=size*.83;
    const gradient=context.createLinearGradient(-w/2,-h/2,w/2,h/2);gradient.addColorStop(0,light);gradient.addColorStop(1,dark);
    context.fillStyle=gradient;context.beginPath();context.moveTo(-w*.48,h*.15);context.bezierCurveTo(-w*.6,-h*.6,w*.6,-h*.6,w*.48,h*.15);context.quadraticCurveTo(w*.52,h*.49,w*.25,h*.46);context.quadraticCurveTo(0,h*.53,-w*.27,h*.46);context.quadraticCurveTo(-w*.55,h*.46,-w*.48,h*.15);context.fill();
    context.fillStyle="#ffffff55";context.beginPath();context.ellipse(-w*.2,-h*.22,w*.13,h*.065,-.55,0,Math.PI*2);context.fill();
    context.fillStyle="#23344c";const ey=size*.06;
    for(const dx of [-.14,.14]){context.beginPath();if(color===2){context.arc(size*dx,ey,size*.052,Math.PI,0);context.lineWidth=size*.036;context.strokeStyle="#493749";context.stroke();}else{context.ellipse(size*dx,ey,size*.035,size*(color===3?.037:.062),0,0,Math.PI*2);context.fill();}}
    if(color===4){context.strokeStyle="#50426a";context.lineWidth=size*.024;context.beginPath();context.arc(0,size*.12,size*.05,0,Math.PI);context.stroke();}
    if(color===1){context.fillStyle="#d6fff488";context.beginPath();context.arc(0,-size*.25,size*.045,0,Math.PI*2);context.fill();}
    context.restore();
  }
  function draw(dt){
    ctx.clearRect(0,0,360,720);ctx.fillStyle="#0c1726";ctx.fillRect(0,0,360,720);
    for(let y=0;y<12;y++)for(let x=0;x<6;x++){if((x+y)%2===0){ctx.fillStyle="#ffffff02";ctx.fillRect(x*60,y*60,60,60);}ctx.fillStyle="#65829830";ctx.beginPath();ctx.arc(x*60+30,y*60+30,1.2,0,Math.PI*2);ctx.fill();}
    ctx.strokeStyle="#ed9a9a55";ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(144,16);ctx.lineTo(156,28);ctx.moveTo(156,16);ctx.lineTo(144,28);ctx.stroke();
    const popping=engine.phase==="popping"?new Set(engine.popping.map(c=>c.y*6+c.x)):new Set();
    for(let y=2;y<14;y++)for(let x=0;x<6;x++){const color=engine.board[y][x];if(color){const pop=popping.has(y*6+x)?Math.sin(engine.phaseTime/45):0;jelly(ctx,x*60,(y-2)*60,60,color,pop?(.65+.35*Math.abs(pop)):1,pop);}}
    if(engine.active){const ghost=engine.ghost();for(const cell of engine.cells(ghost))jelly(ctx,cell.x*60,(cell.y-2)*60,60,cell.color,.2);for(const cell of engine.cells())jelly(ctx,cell.x*60,(cell.y-2)*60,60,cell.color);}
    if(engine.status==="playing")for(const p of particles){p.life-=dt;p.x+=p.vx*dt/1000;p.y+=p.vy*dt/1000;p.vy+=350*dt/1000;}
    particles=particles.filter(p=>p.life>0);for(const p of particles){ctx.globalAlpha=p.life/p.max;ctx.fillStyle=p.color;ctx.beginPath();ctx.arc(p.x,p.y,3.5*p.life/p.max,0,Math.PI*2);ctx.fill();}ctx.globalAlpha=1;
    nextCtx.clearRect(0,0,100,220);engine.queue.forEach((pair,i)=>{jelly(nextCtx,25,10+i*110,50,pair[1],i?.6:1);jelly(nextCtx,25,53+i*110,50,pair[0],i?.6:1);});
    $("score").textContent=engine.score.toLocaleString();$("best").textContent=Math.max(best,engine.score).toLocaleString();$("level").textContent=String(engine.level).padStart(2,"0");$("max-chain").textContent=engine.maxChain;
    if(calloutTime>0&&engine.status==="playing"){calloutTime-=dt;if(calloutTime<=0)$("chain").classList.remove("show");}
  }
  let last=0;
  function frame(now){const dt=Math.min(50,now-last||16);last=now;
    if(engine.status==="playing")for(const input of held.values()){input.time+=dt;if((input.name==="left"||input.name==="right")&&input.time>=input.next){action(input.name);input.next=input.time+65;}}
    engine.update(dt,[...held.values()].some(input=>input.name==="down"));draw(dt);requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

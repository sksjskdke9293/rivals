import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const TAU = Math.PI * 2;

const MAX_HP = 150;

const WEAPONS = {
  sniper: {
    id: 'sniper', name: 'SNIPER VX', type: 'SNIPER', price: 0, mag: 5,
    damage: 50, headDamage: 150, fireDelay: 1.10, reload: 2.15, recoil: .030, zoom: 17,
    stats: { POWER: 88, RATE: 28, RANGE: 100, CONTROL: 56 },
    desc: '몸통 50 / 헤드 150 데미지. 쏘면 줌이 풀리고 2초 동안 볼트 액션 흔들림이 들어갑니다.'
  },
  m4: {
    id: 'm4', name: 'M4 CARBINE', type: 'ASSAULT', price: 450, mag: 30,
    damage: 18, headDamage: 38, fireDelay: .095, reload: 1.55, recoil: .008, zoom: 50, auto: true,
    stats: { POWER: 55, RATE: 95, RANGE: 74, CONTROL: 70 },
    desc: '업로드한 돌격소총 FBX 모델 적용. 우클릭은 스코프 대신 레이저 도트 줌.'
  },
  phantom: {
    id: 'phantom', name: 'PHANTOM AWP', type: 'SNIPER', price: 900, mag: 4,
    damage: 50, headDamage: 150, fireDelay: 1.35, reload: 2.45, recoil: .038, zoom: 14,
    stats: { POWER: 94, RATE: 18, RANGE: 100, CONTROL: 44 },
    desc: '강화 스나이퍼 스킨. 데미지는 라이벌 룰에 맞춰 몸통 50 / 헤드 150.'
  }
};

const SKIN_COLOR = { cyan: 0x45dfff, pink: 0xff46cf, gold: 0xffdf5a, violet: 0x8d6cff };
const MAPS = {
  neon: {
    id: 'neon', name: '네온 아레나', size: 62,
    spawns: [
      { x: 0, y: 0, z: 21, yaw: Math.PI },
      { x: 0, y: 0, z: -21, yaw: 0 }
    ],
    blocks: [
      [-14, -8, 4, 4, 3.5], [14, 8, 4, 4, 3.5], [-14, 8, 4, 4, 3.5], [14, -8, 4, 4, 3.5],
      [0, 0, 3, 10, 4.4], [-8, 0, 2.8, 4, 3.8], [8, 0, 2.8, 4, 3.8],
      [0, 12, 13, 1.6, 3.3], [0, -12, 13, 1.6, 3.3], [-21, 0, 1.6, 16, 3.3], [21, 0, 1.6, 16, 3.3],
      [-5, 17, 4, 3, 3], [5, -17, 4, 3, 3]
    ]
  },
  crossroad: {
    id: 'crossroad', name: '교차로', size: 70,
    spawns: [
      { x: 0, y: 0, z: 26, yaw: Math.PI },
      { x: 0, y: 0, z: -26, yaw: 0 }
    ],
    blocks: [
      [-21, -21, 12, 12, 5.2], [21, -21, 12, 12, 5.2], [-21, 21, 12, 12, 5.2], [21, 21, 12, 12, 5.2],
      [-11, -11, 5.5, 5.5, 4.4], [11, -11, 5.5, 5.5, 4.4], [-11, 11, 5.5, 5.5, 4.4], [11, 11, 5.5, 5.5, 4.4],
      [0, -14, 3.6, 2.2, 2.4], [0, 14, 3.6, 2.2, 2.4], [-14, 0, 2.2, 3.6, 2.4], [14, 0, 2.2, 3.6, 2.4],
      [-5.2, 5.2, 1.8, 1.8, 4.2], [5.2, 5.2, 1.8, 1.8, 4.2], [-5.2, -5.2, 1.8, 1.8, 4.2], [5.2, -5.2, 1.8, 1.8, 4.2],
      [0, 0, 2.2, 2.2, 1.15]
    ]
  }
};

class Store {
  constructor() {
    this.data = JSON.parse(localStorage.getItem('rivals2p_data') || '{}');
    this.data.coins ??= 800;
    this.data.owned ??= ['sniper'];
    this.data.equipped ??= 'sniper';
    this.data.wins ??= 0;
    this.data.kills ??= 0;
    this.save();
  }
  save(){ localStorage.setItem('rivals2p_data', JSON.stringify(this.data)); }
  owned(id){ return this.data.owned.includes(id); }
  buy(id){ const w = WEAPONS[id]; if (!w || this.owned(id) || this.data.coins < w.price) return false; this.data.coins -= w.price; this.data.owned.push(id); this.data.equipped = id; this.save(); return true; }
  equip(id){ if(this.owned(id)){ this.data.equipped = id; this.save(); return true; } return false; }
}

class Net {
  constructor(game){ this.game = game; this.ws = null; this.id = null; this.connected = false; this.connect(); }
  connect(){
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.ws = new WebSocket(`${protocol}//${location.host}`);
    this.ws.onopen = () => { this.connected = true; this.game.feed('서버 연결됨'); };
    this.ws.onclose = () => { this.connected = false; this.game.feed('서버 연결 끊김'); setTimeout(() => this.connect(), 1600); };
    this.ws.onerror = () => this.game.feed('서버 연결 오류');
    this.ws.onmessage = e => { try { this.game.onNet(JSON.parse(e.data)); } catch {} };
  }
  send(type, data = {}) { if(this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ type, ...data })); }
}

class Game {
  constructor(){
    this.store = new Store();
    this.net = new Net(this);
    this.mode = 'menu';
    this.online = false;
    this.roomId = null; this.myId = null; this.enemyId = null;
    this.keys = new Set(); this.mouse = { left:false, right:false };
    this.yaw = 0; this.pitch = 0; this.clock = new THREE.Clock(); this.lastSend = 0; this.lastShot = 0;
    this.player = { pos: new THREE.Vector3(0,0,21), hp:MAX_HP, ammo:5, score:0, eye:1.48 };
    this.enemy = { pos: new THREE.Vector3(0,0,-21), target: new THREE.Vector3(0,0,-21), hp:MAX_HP, score:0, name:'ENEMY', weapon:'sniper', alive:true };
    this.trails = []; this.parts = []; this.blockers = []; this.reloading = false; this.roundOver = false;
    this.currentMap = 'neon'; this.sniperZoomBlockedUntil = 0; this.sniperShakeUntil = 0; this.lastAimMode = 'none';
    this.dom = this.collectDom();
    this.initScene(); this.initUI(); this.buildShop(); this.updateProfile(); this.animate();
  }
  collectDom(){
    return {
      menu:$('menu'), shop:$('shop'), queue:$('queue'), hud:$('hud'), blocker:$('blocker'),
      nick:$('nick'), skin:$('skin'), map:$('mapSelect'), matchBtn:$('matchBtn'), shopBtn:$('shopBtn'), practiceBtn:$('practiceBtn'),
      cancelQueue:$('cancelQueue'), closeShop:$('closeShop'), weaponGrid:$('weaponGrid'),
      online:$('onlineCount'), queueCount:$('queueCount'), roomCount:$('roomCount'), coins:$('myCoins'),
      selectedWeaponBadge:$('selectedWeaponBadge'), selectedWeaponInfo:$('selectedWeaponInfo'),
      myName:$('myName'), enemyName:$('enemyName'), myHp:$('myHp'), enemyHp:$('enemyHp'), myHpText:$('myHpText'), enemyHpText:$('enemyHpText'),
      score:$('scoreText'), round:$('roundText'), scope:$('scope'), hit:$('hitMark'), damage:$('damageVignette'), feed:$('feed'), msg:$('centerMsg'),
      hudWeapon:$('hudWeapon'), ammo:$('ammoText'), laser:$('laserDot'), queueTitle:$('queueTitle'), queueText:$('queueText'), queueMe:$('queueMe'), queueEnemy:$('queueEnemy')
    };
  }
  initScene(){
    this.renderer = new THREE.WebGLRenderer({ canvas:$('game'), antialias:true, powerPreference:'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.8)); this.renderer.setSize(innerWidth, innerHeight); this.renderer.shadowMap.enabled = true;
    this.scene = new THREE.Scene(); this.scene.background = new THREE.Color(0x050816); this.scene.fog = new THREE.FogExp2(0x06101d, .023);
    this.camera = new THREE.PerspectiveCamera(68, innerWidth / innerHeight, .05, 220); this.camera.position.set(0, 1.48, 21);
    this.listener = new THREE.AudioListener(); this.camera.add(this.listener);
    const hemi = new THREE.HemisphereLight(0xd7f8ff, 0x091020, 1.05); this.scene.add(hemi);
    const key = new THREE.DirectionalLight(0xdff9ff, 2.2); key.position.set(8,20,12); key.castShadow = true; key.shadow.mapSize.set(2048,2048); this.scene.add(key);
    const rim = new THREE.PointLight(0xff46cf, 8, 60); rim.position.set(-16,6,-16); this.scene.add(rim);
    const rim2 = new THREE.PointLight(0x45dfff, 8, 60); rim2.position.set(16,6,16); this.scene.add(rim2);
    this.buildArena(this.currentMap); this.createEnemyMesh(); this.setWeapon(this.store.data.equipped);
    addEventListener('resize', () => this.resize());
  }
  buildArena(mapId = 'neon'){
    this.currentMap = MAPS[mapId] ? mapId : 'neon';
    const map = MAPS[this.currentMap];
    if(this.arenaGroup){
      this.scene.remove(this.arenaGroup);
      this.arenaGroup.traverse(o => { if(o.geometry) o.geometry.dispose?.(); if(o.material){ if(Array.isArray(o.material)) o.material.forEach(m=>m.dispose?.()); else o.material.dispose?.(); } });
    }
    this.blockers = [];
    this.arenaGroup = new THREE.Group();
    this.arenaGroup.name = `MAP_${map.name}`;
    this.scene.add(this.arenaGroup);

    const floorMat = new THREE.MeshStandardMaterial({ color:this.currentMap==='crossroad'?0x111827:0x10192a, roughness:.62, metalness:.08 });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(map.size,map.size,1,1), floorMat); floor.rotation.x = -Math.PI/2; floor.receiveShadow = true; this.arenaGroup.add(floor);
    const grid = new THREE.GridHelper(map.size, map.size, 0x2bdcff, 0x152a44); grid.material.transparent = true; grid.material.opacity = this.currentMap==='crossroad' ? .27 : .20; this.arenaGroup.add(grid);
    const wallMat = new THREE.MeshStandardMaterial({ color:0x17253a, roughness:.52, metalness:.12 });
    const roadMat = new THREE.MeshStandardMaterial({ color:0x0d1422, roughness:.7, metalness:.05 });
    const neonMat = new THREE.MeshStandardMaterial({ color:0x203047, emissive:0x123cff, emissiveIntensity:.55 });
    const makeBox = (x,z,w,d,h,mat=wallMat) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), mat); mesh.position.set(x,h/2,z); mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.userData.box = new THREE.Box3().setFromObject(mesh); this.arenaGroup.add(mesh); this.blockers.push(mesh); return mesh;
    };
    map.blocks.forEach((b,i)=>makeBox(...b, i%4===0?neonMat:wallMat));
    const half = map.size/2;
    makeBox(0, half, map.size, 1.4, 5); makeBox(0, -half, map.size, 1.4, 5); makeBox(half, 0, 1.4, map.size, 5); makeBox(-half, 0, 1.4, map.size, 5);

    if(this.currentMap === 'crossroad'){
      const lane1 = new THREE.Mesh(new THREE.PlaneGeometry(12, map.size-4), roadMat); lane1.rotation.x = -Math.PI/2; lane1.position.y=.012; this.arenaGroup.add(lane1);
      const lane2 = new THREE.Mesh(new THREE.PlaneGeometry(map.size-4, 12), roadMat); lane2.rotation.x = -Math.PI/2; lane2.position.y=.018; this.arenaGroup.add(lane2);
      for(let i=-2;i<=2;i++){
        if(i===0) continue;
        const mark = new THREE.Mesh(new THREE.BoxGeometry(.18,.035,5.2), new THREE.MeshBasicMaterial({color:0xffdf5a, transparent:true, opacity:.78}));
        mark.position.set(i*1.4,.045,0); this.arenaGroup.add(mark);
        const mark2 = new THREE.Mesh(new THREE.BoxGeometry(5.2,.035,.18), new THREE.MeshBasicMaterial({color:0xffdf5a, transparent:true, opacity:.78}));
        mark2.position.set(0,.05,i*1.4); this.arenaGroup.add(mark2);
      }
    }

    for(let i=0;i<90;i++){
      const p = new THREE.Mesh(new THREE.BoxGeometry(rand(.08,.25), rand(.08,.25), rand(.08,.25)), new THREE.MeshBasicMaterial({color: Math.random()>.5?0x45dfff:0xff46cf, transparent:true, opacity:.38}));
      p.position.set(rand(-half+2,half-2), rand(3,13), rand(-half+2,half-2)); this.arenaGroup.add(p);
    }
    for(let i=0;i<18;i++){
      const line = new THREE.Mesh(new THREE.BoxGeometry(rand(2,8), .03, .03), new THREE.MeshBasicMaterial({color: i%2?0x45dfff:0xff46cf}));
      line.position.set(rand(-half+6,half-6), .035, rand(-half+6,half-6)); line.rotation.y = rand(0,TAU); this.arenaGroup.add(line);
    }
  }
  createEnemyMesh(){
    this.enemyGroup = new THREE.Group();
    const skin = new THREE.MeshStandardMaterial({ color:0xff46cf, roughness:.45, metalness:.2, emissive:0x2a0018, emissiveIntensity:.25 });
    const dark = new THREE.MeshStandardMaterial({ color:0x101827, roughness:.55, metalness:.28 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(.42,.88,8,16), skin); body.position.y=1.0; body.castShadow=true; this.enemyGroup.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(.27,24,16), new THREE.MeshStandardMaterial({color:0xf0d3c2,roughness:.58})); head.position.y=1.72; head.castShadow=true; this.enemyGroup.add(head);
    const gun = new THREE.Mesh(new THREE.BoxGeometry(1.0,.08,.12), dark); gun.position.set(.35,1.18,-.42); this.enemyGroup.add(gun);
    const glow = new THREE.PointLight(0xff46cf, 1.2, 4); glow.position.y=1.4; this.enemyGroup.add(glow);
    this.scene.add(this.enemyGroup);
  }
  initUI(){
    this.dom.matchBtn.onclick = () => this.joinQueue(); this.dom.cancelQueue.onclick = () => this.cancelQueue();
    this.dom.shopBtn.onclick = () => this.showShop(true); this.dom.closeShop.onclick = () => this.showShop(false);
    this.dom.practiceBtn.onclick = () => this.startPractice();
    document.addEventListener('keydown', e => { this.keys.add(e.code); if(e.code==='KeyR') this.reload(); if(e.code==='Escape' && this.mode === 'match') this.leaveToMenu(); });
    document.addEventListener('keyup', e => this.keys.delete(e.code));
    document.addEventListener('mousemove', e => {
      if(document.pointerLockElement !== this.renderer.domElement || this.mode === 'menu') return;
      this.yaw -= e.movementX * .0022; this.pitch -= e.movementY * .0022; this.pitch = clamp(this.pitch, -1.35, 1.35);
    });
    document.addEventListener('mousedown', e => {
      if(this.mode !== 'match') return; this.renderer.domElement.requestPointerLock();
      if(e.button === 0) { this.mouse.left = true; this.shoot(); }
      if(e.button === 2) { this.mouse.right = true; if(this.weapon?.type==='SNIPER' && performance.now()<this.sniperZoomBlockedUntil) this.center('볼트 액션 대기'); }
    });
    document.addEventListener('mouseup', e => { if(e.button===0)this.mouse.left=false; if(e.button===2)this.mouse.right=false; });
    document.addEventListener('contextmenu', e => e.preventDefault());
    document.addEventListener('pointerlockchange', () => { this.dom.blocker.classList.toggle('hidden', !(this.mode==='match' && document.pointerLockElement !== this.renderer.domElement)); });
    this.dom.blocker.onclick = () => this.renderer.domElement.requestPointerLock();
  }
  buildShop(){
    this.dom.weaponGrid.innerHTML = '';
    Object.values(WEAPONS).forEach(w => {
      const owned = this.store.owned(w.id), eq = this.store.data.equipped === w.id;
      const card = document.createElement('div'); card.className = `weaponCard ${eq?'equipped':''}`;
      card.innerHTML = `
        <div class="weaponArt ${w.id==='m4'?'m4':''}"><i class="stock"></i><i class="barrel"></i><i class="mag"></i><i class="scope"></i></div>
        <h3>${w.name}</h3><p>${w.desc}</p>
        <div class="stats">${Object.entries(w.stats).map(([k,v])=>`<div class="stat"><span>${k}</span><div class="bar"><i style="width:${v}%"></i></div><b>${v}</b></div>`).join('')}</div>
        <div class="price"><strong>${owned?'OWNED':w.price+' C'}</strong><span class="tag">${eq?'EQUIPPED':w.type}</span></div>
        <button>${owned ? (eq?'장착중':'장착') : '구매'}</button>`;
      card.querySelector('button').onclick = () => { owned ? this.store.equip(w.id) : this.store.buy(w.id); this.setWeapon(this.store.data.equipped); this.buildShop(); this.updateProfile(); };
      this.dom.weaponGrid.appendChild(card);
    });
  }
  updateProfile(){
    const w = WEAPONS[this.store.data.equipped]; this.dom.coins.textContent = this.store.data.coins;
    this.dom.selectedWeaponBadge.textContent = w.name; this.dom.selectedWeaponInfo.textContent = w.desc;
  }
  showShop(on){ this.dom.shop.classList.toggle('on', on); }
  showMenu(){ this.mode='menu'; this.online=false; this.dom.menu.classList.add('on'); this.dom.hud.classList.remove('on'); this.dom.queue.classList.remove('on'); this.dom.blocker.classList.add('hidden'); this.dom.scope?.classList.remove('on'); this.dom.laser?.classList.remove('on'); document.exitPointerLock?.(); }
  joinQueue(){
    this.online = true; this.mode = 'queue'; this.dom.menu.classList.remove('on'); this.dom.queue.classList.add('on');
    this.currentMap = this.dom.map?.value || 'neon';
    this.dom.queueMe.textContent = this.dom.nick.value || 'YOU'; this.dom.queueEnemy.textContent='WAITING'; this.dom.queueText.textContent=`${MAPS[this.currentMap]?.name || '네온 아레나'} 대기열 진입 중`; 
    this.net.send('joinQueue', { name:this.dom.nick.value || 'Player', weapon:this.store.data.equipped, skin:this.dom.skin.value, map:this.currentMap });
  }
  cancelQueue(){ this.net.send('cancelQueue'); this.mode='menu'; this.dom.queue.classList.remove('on'); this.dom.menu.classList.add('on'); }
  startPractice(){
    this.online = false; this.mode = 'match'; this.roomId = 'practice'; this.myId = 'practice_me'; this.enemyId='practice_bot';
    this.player.score=0; this.enemy.score=0; this.enemy.name='BOT RIVAL'; this.dom.enemyName.textContent='BOT RIVAL'; this.dom.myName.textContent=this.dom.nick.value||'YOU';
    this.currentMap = this.dom.map?.value || 'neon';
    const sp = MAPS[this.currentMap].spawns;
    this.startRound(sp[0], sp[1], 1, this.currentMap); this.feed(`${MAPS[this.currentMap].name} 혼자 조작 테스트 시작`);
  }
  onNet(msg){
    if(msg.type === 'hello'){ this.myId = msg.id; this.dom.online.textContent=msg.online; this.dom.queueCount.textContent=msg.queue; }
    if(msg.type === 'serverStats'){ this.dom.online.textContent=msg.online; this.dom.queueCount.textContent=msg.queue; this.dom.roomCount.textContent=msg.rooms; }
    if(msg.type === 'queued'){ this.dom.queueTitle.textContent='매칭 대기중'; this.dom.queueText.textContent=`현재 대기열 ${msg.position}번 · 다른 플레이어가 들어오면 바로 시작`; }
    if(msg.type === 'matched'){
      this.online = true; this.roomId = msg.roomId; this.myId = msg.you.id; this.enemyId = msg.enemy.id; this.enemy.name = msg.enemy.name; this.enemy.weapon = msg.enemy.weapon;
      this.player.score = msg.you.score; this.enemy.score = msg.enemy.score; this.dom.myName.textContent = msg.you.name; this.dom.enemyName.textContent = msg.enemy.name;
      this.dom.queueEnemy.textContent = msg.enemy.name; this.dom.queueTitle.textContent='MATCH FOUND'; this.dom.queueText.textContent='방 생성 완료. 전투 시작.';
      setTimeout(()=>this.startRound(msg.spawn, msg.enemySpawn, msg.round, msg.map || this.currentMap), 600);
    }
    if(msg.type === 'roundStart'){ this.player.score=msg.you.score; this.enemy.score=msg.enemy.score; this.startRound(msg.spawn, msg.enemySpawn, msg.round, msg.map || this.currentMap); }
    if(msg.type === 'enemyState'){
      this.enemy.target.set(msg.state.x, msg.state.y, msg.state.z); this.enemy.yaw = msg.state.yaw; this.enemy.pitch = msg.state.pitch; this.enemy.hp = msg.hp; this.enemy.score = msg.score;
    }
    if(msg.type === 'enemyShot'){
      const a = new THREE.Vector3(msg.origin?.x||0,msg.origin?.y||1.4,msg.origin?.z||0), d = new THREE.Vector3(msg.dir?.x||0,msg.dir?.y||0,msg.dir?.z||-1).normalize();
      this.trail(a, a.clone().addScaledVector(d, 70), msg.weapon==='m4'?0xfff06a:0xff46cf, msg.weapon==='m4' ? 0.06 : 0.16);
      this.sound(msg.weapon==='m4'?'m4':'enemy');
    }
    if(msg.type === 'hit'){
      if(msg.shooterId === this.myId){ this.enemy.hp = msg.targetHp; this.showHit(msg.part); this.feed(`${msg.part==='head'?'HEADSHOT':'HIT'} -${msg.damage}`); }
      if(msg.targetId === this.myId){ this.player.hp = msg.targetHp; this.damageFlash(); this.feed(`피격 -${msg.damage}`); }
    }
    if(msg.type === 'roundEnd'){
      this.roundOver = true;
      const win = msg.winnerId === this.myId;
      const me = msg.scores.find(p=>p.id===this.myId), en = msg.scores.find(p=>p.id===this.enemyId);
      if(me) this.player.score = me.score; if(en) this.enemy.score = en.score;
      if(win){ this.store.data.coins += 70; this.store.data.kills += 1; } else this.store.data.coins += 20;
      this.store.save(); this.updateProfile(); this.center(win?'ROUND WIN':'ROUND LOST'); this.updateHud();
    }
    if(msg.type === 'matchEnd'){
      const win = msg.winnerId === this.myId;
      if(win){ this.store.data.coins += 220; this.store.data.wins += 1; } else this.store.data.coins += 60;
      this.store.save(); this.updateProfile(); this.center(win?'VICTORY':'DEFEAT'); setTimeout(()=>this.showMenu(), 2200);
    }
    if(msg.type === 'opponentLeft'){ this.center('상대 이탈 / 승리'); this.store.data.coins += 180; this.store.save(); setTimeout(()=>this.showMenu(), 1600); }
  }
  startRound(spawn, enemySpawn, round, mapId = this.currentMap){
    this.currentMap = MAPS[mapId] ? mapId : 'neon';
    this.buildArena(this.currentMap);
    this.trails.forEach(t=>{ this.scene.remove(t); t.geometry?.dispose?.(); t.material?.dispose?.(); }); this.trails=[];
    this.mode='match'; this.roundOver=false; this.reloading=false; this.mouse.left=false; this.mouse.right=false; this.sniperZoomBlockedUntil=0; this.sniperShakeUntil=0; this.lastAimMode='none';
    this.dom.queue.classList.remove('on'); this.dom.menu.classList.remove('on'); this.dom.shop.classList.remove('on'); this.dom.hud.classList.add('on');
    this.player.pos.set(spawn.x,spawn.y,spawn.z); this.yaw=spawn.yaw||0; this.pitch=0; this.player.hp=MAX_HP; this.player.ammo=WEAPONS[this.store.data.equipped].mag;
    this.enemy.pos.set(enemySpawn.x,enemySpawn.y,enemySpawn.z); this.enemy.target.copy(this.enemy.pos); this.enemy.hp=MAX_HP; this.enemy.alive=true; this.enemyGroup.position.copy(this.enemy.pos);
    this.dom.round.textContent = `ROUND ${round} · ${MAPS[this.currentMap].name}`; this.setWeapon(this.store.data.equipped); this.updateHud(); this.center(`${MAPS[this.currentMap].name} / ROUND ${round}`); this.dom.blocker.classList.remove('hidden');
  }
  setWeapon(id){
    this.weapon = WEAPONS[id] || WEAPONS.sniper;
    this.player.ammo = this.weapon.mag; this.dom.scope?.classList.remove('on'); this.dom.laser?.classList.remove('on');
    if(this.weaponGroup){ this.camera.remove(this.weaponGroup); }
    this.weaponGroup = new THREE.Group(); this.camera.add(this.weaponGroup); this.scene.add(this.camera);
    if(this.weapon.id === 'm4') this.loadM4(); else this.buildSniper();
    this.updateHud();
  }
  mat(color, metal=.35, rough=.38){ return new THREE.MeshStandardMaterial({color, metalness:metal, roughness:rough, envMapIntensity:.8}); }
  cyl(r1,r2,h,color){ const m=new THREE.Mesh(new THREE.CylinderGeometry(r1,r2,h,24),this.mat(color)); m.rotation.x=Math.PI/2; m.castShadow=true; return m; }
  buildSniper(){
    const g = this.weaponGroup; g.position.set(.34,-.32,-.72); g.rotation.set(-.03,.10,-.01);
    const body = new THREE.Mesh(new THREE.BoxGeometry(.82,.16,.18), this.mat(0x141c2c,.48,.32)); body.position.set(.08,0,0); g.add(body);
    const barrel = this.cyl(.035,.035,1.15,0x0f1522); barrel.position.set(.22,.02,-.62); g.add(barrel);
    const muzzle = this.cyl(.058,.045,.16,0x0a0f18); muzzle.position.set(.22,.02,-1.24); g.add(muzzle);
    const scope = this.cyl(.075,.075,.56,0x1f2a40); scope.position.set(.06,.16,-.10); g.add(scope);
    const lens = new THREE.Mesh(new THREE.CircleGeometry(.07,24), new THREE.MeshBasicMaterial({color:0x55e6ff,transparent:true,opacity:.7})); lens.position.set(.06,.16,-.39); g.add(lens);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(.33,.18,.24),this.mat(0x243049,.25,.4)); stock.position.set(-.46,-.02,.30); g.add(stock);
    const mag = new THREE.Mesh(new THREE.BoxGeometry(.14,.28,.18),this.mat(0x0d1320,.42,.35)); mag.position.set(.05,-.22,.10); mag.rotation.x=.18; g.add(mag);
    const glow = new THREE.PointLight(0x45dfff,1.2,3); glow.position.set(.25,.05,-.85); g.add(glow);
  }
  loadM4(){
    const texLoader = new THREE.TextureLoader();
    const base = texLoader.load('./assets/m4/basecolor.png'); base.colorSpace = THREE.SRGBColorSpace; base.flipY = false;
    const normal = texLoader.load('./assets/m4/normal.png'); normal.flipY = false;
    const roughness = texLoader.load('./assets/m4/roughness.png'); roughness.flipY = false;
    const metallic = texLoader.load('./assets/m4/metallic.png'); metallic.flipY = false;
    const material = new THREE.MeshStandardMaterial({ map:base, normalMap:normal, roughnessMap:roughness, metalnessMap:metallic, metalness:.7, roughness:.46 });
    new FBXLoader().load('./assets/m4/m4_carbine_umang_rank.fbx', obj => {
      obj.traverse(c => { if(c.isMesh){ c.material = material; c.castShadow=true; c.receiveShadow=true; } });
      const box = new THREE.Box3().setFromObject(obj), size = new THREE.Vector3(); box.getSize(size);
      const scale = .72 / Math.max(size.x,size.y,size.z); obj.scale.setScalar(scale);
      const box2 = new THREE.Box3().setFromObject(obj), center = new THREE.Vector3(); box2.getCenter(center); obj.position.sub(center);
      obj.rotation.set(0, Math.PI, 0); obj.position.set(.52,-.54,-1.16); obj.rotation.z = -.035;
      this.weaponGroup.add(obj);
    }, undefined, () => { this.buildM4Fallback(); });
  }
  buildM4Fallback(){
    const g=this.weaponGroup; g.position.set(.48,-.52,-1.04); g.scale.setScalar(.86); const body=new THREE.Mesh(new THREE.BoxGeometry(.86,.14,.18),this.mat(0x222b33,.55,.38)); body.position.z=0; g.add(body);
    const barrel=this.cyl(.028,.028,.86,0x070b10); barrel.position.set(.18,.02,-.62); g.add(barrel);
    const stock=new THREE.Mesh(new THREE.BoxGeometry(.32,.16,.22),this.mat(0x111820,.4,.45)); stock.position.set(-.48,-.02,.26); g.add(stock);
    const grip=new THREE.Mesh(new THREE.BoxGeometry(.12,.30,.13),this.mat(0x0b111a,.4,.45)); grip.position.set(-.05,-.23,.15); grip.rotation.x=-.25; g.add(grip);
    const mag=new THREE.Mesh(new THREE.BoxGeometry(.15,.34,.16),this.mat(0x0b111a,.4,.45)); mag.position.set(.12,-.26,-.03); mag.rotation.x=.12; g.add(mag);
    const rail=new THREE.Mesh(new THREE.BoxGeometry(.7,.04,.09),this.mat(0x3d4b56,.6,.34)); rail.position.set(.05,.11,-.1); g.add(rail);
  }
  update(dt){
    if(this.mode !== 'match') return;
    if(this.weapon.auto && this.mouse.left) this.shoot();
    this.updateCamera(dt); this.move(dt); this.updateEnemy(dt); this.updateEffects(dt); this.updateHud();
    if(this.online && performance.now() - this.lastSend > 50){ this.lastSend = performance.now(); this.net.send('state', { state:{x:this.player.pos.x,y:0,z:this.player.pos.z,yaw:this.yaw,pitch:this.pitch} }); }
  }
  updateCamera(dt){
    this.camera.position.set(this.player.pos.x,this.player.eye,this.player.pos.z); this.camera.rotation.set(this.pitch,this.yaw,0,'YXZ');
    const nowMs = performance.now();
    const sniperScope = this.mouse.right && this.weapon.type === 'SNIPER' && nowMs >= this.sniperZoomBlockedUntil;
    const laserAim = this.mouse.right && this.weapon.type === 'ASSAULT';
    this.dom.scope.classList.toggle('on', sniperScope);
    this.dom.laser?.classList.toggle('on', laserAim);
    const aimMode = sniperScope ? 'scope' : laserAim ? 'laser' : 'none';
    if(aimMode !== this.lastAimMode){ if(aimMode !== 'none') this.sound('aim'); this.lastAimMode = aimMode; }
    this.camera.fov = lerp(this.camera.fov, sniperScope?this.weapon.zoom:(laserAim?this.weapon.zoom:68), 1-Math.pow(.001,dt)); this.camera.updateProjectionMatrix();
    if(this.weaponGroup){
      this.weaponGroup.position.z = lerp(this.weaponGroup.position.z,0,10*dt);
      const shaking = this.weapon.type === 'SNIPER' && nowMs < this.sniperShakeUntil;
      const shake = shaking ? Math.sin(nowMs*.045) * THREE.MathUtils.degToRad(10) : 0;
      this.weaponGroup.rotation.x = lerp(this.weaponGroup.rotation.x, shaking ? shake*.22 : 0, 10*dt);
      this.weaponGroup.rotation.z = lerp(this.weaponGroup.rotation.z, shaking ? shake : 0, 10*dt);
      this.weaponGroup.rotation.y = lerp(this.weaponGroup.rotation.y, shaking ? -shake*.35 : 0, 10*dt);
    }
  }
  move(dt){
    if(this.roundOver) return; const old=this.player.pos.clone(); const f=new THREE.Vector3(Math.sin(this.yaw),0,Math.cos(this.yaw)); const r=new THREE.Vector3(Math.cos(this.yaw),0,-Math.sin(this.yaw)); const wish=new THREE.Vector3();
    if(this.keys.has('KeyW')) wish.add(f.clone().multiplyScalar(-1)); if(this.keys.has('KeyS')) wish.add(f); if(this.keys.has('KeyA')) wish.add(r.clone().multiplyScalar(-1)); if(this.keys.has('KeyD')) wish.add(r);
    if(wish.lengthSq()) wish.normalize(); const speed=this.keys.has('ShiftLeft') && !this.mouse.right ? 7.2 : this.mouse.right?3.1:5.4; this.player.pos.addScaledVector(wish,speed*dt);
    const lim=(MAPS[this.currentMap]?.size || 62)/2 - 2; this.player.pos.x=clamp(this.player.pos.x,-lim,lim); this.player.pos.z=clamp(this.player.pos.z,-lim,lim); if(this.collides(this.player.pos,.45)) this.player.pos.copy(old);
  }
  collides(pos,rad){ return this.blockers.some(m=>{ const b=m.userData.box; return pos.x>b.min.x-rad&&pos.x<b.max.x+rad&&pos.z>b.min.z-rad&&pos.z<b.max.z+rad; }); }
  updateEnemy(dt){
    if(this.online){ this.enemy.pos.lerp(this.enemy.target, 1-Math.pow(.001,dt)); }
    else if(!this.roundOver){
      if(!this.enemy.botTarget || this.enemy.pos.distanceTo(this.enemy.botTarget)<1.2) { const lim=(MAPS[this.currentMap]?.size || 62)/2 - 10; this.enemy.botTarget = new THREE.Vector3(rand(-lim,lim),0,rand(-lim,lim)); }
      const old=this.enemy.pos.clone(), to=this.enemy.botTarget.clone().sub(this.enemy.pos); to.y=0; if(to.lengthSq()) this.enemy.pos.addScaledVector(to.normalize(),3.8*dt); if(this.collides(this.enemy.pos,.45)) this.enemy.pos.copy(old);
    }
    this.enemyGroup.position.copy(this.enemy.pos); this.enemyGroup.rotation.y = this.enemy.yaw ?? Math.atan2(this.player.pos.x-this.enemy.pos.x,this.player.pos.z-this.enemy.pos.z)+Math.PI;
  }
  shoot(){
    if(this.roundOver || this.reloading || this.mode!=='match') return; const now=this.clock.elapsedTime; if(now-this.lastShot < this.weapon.fireDelay) return; if(this.player.ammo<=0){ this.reload(); return; }
    const scopedBeforeShot = this.mouse.right && this.weapon.type==='SNIPER' && performance.now() >= this.sniperZoomBlockedUntil;
    const laserBeforeShot = this.mouse.right && this.weapon.type==='ASSAULT';
    this.lastShot=now; this.player.ammo--; this.sound(this.weapon.type==='SNIPER'?'sniper':'m4');
    if(this.weapon.type==='SNIPER'){ this.mouse.right=false; this.sniperZoomBlockedUntil=performance.now()+2000; this.sniperShakeUntil=performance.now()+2000; this.dom.scope.classList.remove('on'); this.feed('볼트 액션 · 줌 2초 대기'); }
    if(this.weaponGroup){ this.weaponGroup.position.z += this.weapon.auto ? 0.03 : 0.08; this.weaponGroup.rotation.x -= this.weapon.auto ? 0.018 : 0.055; }
    const origin=this.camera.position.clone(); const dir=new THREE.Vector3(); this.camera.getWorldDirection(dir); const spread = (scopedBeforeShot || laserBeforeShot) ? 0.002 : (this.weapon.auto ? 0.017 : 0.012); dir.x+=rand(-spread,spread); dir.y+=rand(-spread,spread); dir.z+=rand(-spread,spread); dir.normalize();
    const end=origin.clone().addScaledVector(dir, this.weapon.type==='SNIPER'?110:75); this.trail(origin.clone().addScaledVector(dir,.6),end,this.weapon.id==='m4'?0xffe36d:0x45dfff,this.weapon.auto ? 0.055 : 0.16);
    if(this.online){ this.net.send('shoot',{weapon:this.weapon.id,origin:{x:origin.x,y:origin.y,z:origin.z},dir:{x:dir.x,y:dir.y,z:dir.z}}); }
    else { this.practiceHit(origin,dir); }
    if(this.player.ammo<=0) setTimeout(()=>this.reload(),130);
  }
  practiceHit(origin,dir){
    const ray = new THREE.Ray(origin,dir); const head=this.enemy.pos.clone().add(new THREE.Vector3(0,1.68,0)); const body=this.enemy.pos.clone().add(new THREE.Vector3(0,1.0,0));
    let part=null; if(ray.distanceSqToPoint(head)<.3*.3) part='head'; else if(ray.distanceSqToPoint(body)<.62*.62) part='body';
    if(part){ const dmg=part==='head'?(this.weapon.headDamage || this.weapon.damage):this.weapon.damage; this.enemy.hp=clamp(this.enemy.hp-dmg,0,MAX_HP); this.showHit(part); this.feed(`${part==='head'?'HEADSHOT':'HIT'} -${dmg}`); if(this.enemy.hp<=0){ this.player.score++; this.store.data.coins+=50; this.store.save(); this.center('BOT DOWN'); setTimeout(()=>{ const sp=MAPS[this.currentMap].spawns; this.startRound(sp[0],sp[1],this.player.score+this.enemy.score+1,this.currentMap); },1000); } }
  }
  reload(){ if(this.reloading || this.player.ammo>=this.weapon.mag || this.roundOver || this.mode!=='match') return; this.reloading=true; this.feed('RELOADING'); this.sound('reload'); setTimeout(()=>{ this.player.ammo=this.weapon.mag; this.reloading=false; }, this.weapon.reload*1000); }
  trail(a,b,color,life){ const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints([a,b]),new THREE.LineBasicMaterial({color,transparent:true,opacity:.9})); line.userData.life=life; line.userData.max=life; this.scene.add(line); this.trails.push(line); }
  updateEffects(dt){ for(let i=this.trails.length-1;i>=0;i--){const t=this.trails[i]; t.userData.life-=dt; t.material.opacity=Math.max(0,t.userData.life/t.userData.max); if(t.userData.life<=0){this.scene.remove(t); t.geometry.dispose(); t.material.dispose(); this.trails.splice(i,1);}} }
  showHit(part){ this.dom.hit.textContent = part==='head'?'✸':'✕'; this.dom.hit.classList.add('on'); this.sound(part==='head'?'head':'hit'); setTimeout(()=>this.dom.hit.classList.remove('on'),110); }
  damageFlash(){ this.dom.damage.style.opacity=.95; this.sound('hurt'); setTimeout(()=>this.dom.damage.style.opacity=0,120); }
  updateHud(){
    this.dom.myHp.style.width = clamp(this.player.hp/MAX_HP*100,0,100)+'%'; this.dom.enemyHp.style.width = clamp(this.enemy.hp/MAX_HP*100,0,100)+'%'; this.dom.myHpText.textContent=Math.ceil(this.player.hp); this.dom.enemyHpText.textContent=Math.ceil(this.enemy.hp);
    this.dom.score.textContent = `${this.player.score} : ${this.enemy.score}`; this.dom.hudWeapon.textContent = this.weapon.name + (this.reloading?' / RELOAD':''); this.dom.ammo.textContent = `${this.player.ammo} / ${this.weapon.mag}`;
  }
  leaveToMenu(){ if(this.online) this.net.send('leaveRoom'); this.showMenu(); }
  center(t){ this.dom.msg.textContent=t; this.dom.msg.classList.add('on'); setTimeout(()=>this.dom.msg.classList.remove('on'),900); }
  feed(t){ const d=document.createElement('div'); d.textContent=t; this.dom.feed.prepend(d); while(this.dom.feed.children.length>5)this.dom.feed.lastChild.remove(); }
  sound(kind){
    const ctx = Game.ctx || (Game.ctx = new (window.AudioContext || window.webkitAudioContext)()); if(ctx.state==='suspended') ctx.resume();
    const t = ctx.currentTime;
    const master = ctx.createGain(); master.connect(ctx.destination);
    master.gain.setValueAtTime(0.001, t);

    const noise = (dur=.08, gain=.06, filter=900) => {
      const buffer = ctx.createBuffer(1, Math.max(1, ctx.sampleRate*dur), ctx.sampleRate);
      const data = buffer.getChannelData(0); for(let i=0;i<data.length;i++) data[i]=Math.random()*2-1;
      const src = ctx.createBufferSource(); src.buffer = buffer;
      const bp = ctx.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=filter; bp.Q.value=.8;
      const g = ctx.createGain(); g.gain.setValueAtTime(gain,t); g.gain.exponentialRampToValueAtTime(.0001,t+dur);
      src.connect(bp); bp.connect(g); g.connect(master); src.start(t); src.stop(t+dur);
    };
    const tone = (freq=220, dur=.08, gain=.04, type='square', when=0) => {
      const osc=ctx.createOscillator(), g=ctx.createGain(); osc.type=type; osc.frequency.setValueAtTime(freq,t+when);
      g.gain.setValueAtTime(gain,t+when); g.gain.exponentialRampToValueAtTime(.0001,t+when+dur);
      osc.connect(g); g.connect(master); osc.start(t+when); osc.stop(t+when+dur);
    };

    if(kind==='sniper'){ master.gain.setValueAtTime(.9,t); noise(.16,.12,420); tone(72,.13,.08,'sawtooth'); tone(140,.05,.045,'square',.035); }
    else if(kind==='m4'){ master.gain.setValueAtTime(.55,t); noise(.06,.065,850); tone(105,.045,.035,'square'); }
    else if(kind==='enemy'){ master.gain.setValueAtTime(.35,t); noise(.07,.045,700); tone(160,.045,.028,'square'); }
    else if(kind==='reload'){ master.gain.setValueAtTime(.45,t); tone(260,.06,.035,'triangle'); tone(170,.07,.035,'triangle',.09); noise(.12,.025,1600); }
    else if(kind==='aim'){ master.gain.setValueAtTime(.28,t); tone(520,.035,.025,'sine'); tone(760,.04,.018,'sine',.035); }
    else if(kind==='hit'){ master.gain.setValueAtTime(.55,t); tone(760,.05,.045,'square'); }
    else if(kind==='head'){ master.gain.setValueAtTime(.65,t); tone(1120,.07,.05,'triangle'); tone(720,.05,.035,'square',.04); }
    else if(kind==='hurt'){ master.gain.setValueAtTime(.6,t); noise(.13,.08,180); tone(64,.13,.05,'sawtooth'); }
    else { master.gain.setValueAtTime(.35,t); tone(240,.08,.035,'square'); }
    master.gain.exponentialRampToValueAtTime(.0001,t+.22);
    setTimeout(()=>master.disconnect(),260);
  }
  resize(){ this.camera.aspect=innerWidth/innerHeight; this.camera.updateProjectionMatrix(); this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.8)); this.renderer.setSize(innerWidth,innerHeight); }
  animate(){ requestAnimationFrame(()=>this.animate()); const dt=Math.min(.045,this.clock.getDelta()); this.update(dt); this.renderer.render(this.scene,this.camera); }
}

new Game();

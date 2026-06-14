import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import crypto from 'crypto';

const PORT = process.env.PORT || 3000;
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static('public'));

const clients = new Map();
const rooms = new Map();
let queue = [];

const MAX_HP = 150;

const WEAPONS = {
  sniper: { damage: 50, headDamage: 150, fireDelay: 1100, range: 120, bodyRadius: 0.62, headRadius: 0.30 },
  phantom: { damage: 50, headDamage: 150, fireDelay: 1350, range: 125, bodyRadius: 0.62, headRadius: 0.30 },
  m4: { damage: 18, headDamage: 38, fireDelay: 95, range: 90, bodyRadius: 0.62, headRadius: 0.30 }
};

const MAPS = {
  neon: {
    name: '네온 아레나',
    spawns: [
      { x: 0, y: 0, z: 21, yaw: Math.PI },
      { x: 0, y: 0, z: -21, yaw: 0 }
    ]
  },
  crossroad: {
    name: '교차로',
    spawns: [
      { x: 0, y: 0, z: 26, yaw: Math.PI },
      { x: 0, y: 0, z: -26, yaw: 0 }
    ]
  }
};

const SPAWNS = MAPS.neon.spawns;

function id(prefix = '') {
  return prefix + crypto.randomBytes(7).toString('hex');
}

function send(ws, type, data = {}) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type, ...data }));
}

function broadcastRoom(room, type, data = {}) {
  room.players.forEach(pid => {
    const client = clients.get(pid);
    if (client) send(client.ws, type, data);
  });
}

function opponentOf(room, pid) {
  const oid = room.players.find(x => x !== pid);
  return clients.get(oid);
}

function cleanQueue() {
  queue = queue.filter(pid => clients.has(pid) && !clients.get(pid).roomId);
}

function startRoom(a, b) {
  const rid = id('room_');
  a.roomId = rid;
  b.roomId = rid;
  a.slot = 0;
  b.slot = 1;
  a.hp = MAX_HP; b.hp = MAX_HP;
  a.score = 0; b.score = 0;
  a.lastShotAt = 0; b.lastShotAt = 0;
  const mapId = MAPS[a.map] ? a.map : (MAPS[b.map] ? b.map : 'neon');
  const spawns = MAPS[mapId].spawns;
  a.state = { ...spawns[0], pitch: 0, weapon: a.weapon };
  b.state = { ...spawns[1], pitch: 0, weapon: b.weapon };

  const room = { id: rid, players: [a.id, b.id], round: 1, status: 'playing', map: mapId, createdAt: Date.now() };
  rooms.set(rid, room);

  const payloadA = {
    roomId: rid,
    you: publicClient(a),
    enemy: publicClient(b),
    spawn: spawns[0],
    enemySpawn: spawns[1],
    round: room.round,
    map: room.map
  };
  const payloadB = {
    roomId: rid,
    you: publicClient(b),
    enemy: publicClient(a),
    spawn: spawns[1],
    enemySpawn: spawns[0],
    round: room.round,
    map: room.map
  };
  send(a.ws, 'matched', payloadA);
  send(b.ws, 'matched', payloadB);
}

function publicClient(c) {
  return { id: c.id, name: c.name, weapon: c.weapon, skin: c.skin, hp: c.hp ?? MAX_HP, score: c.score ?? 0, slot: c.slot ?? 0 };
}

function resetRound(room) {
  room.round += 1;
  const spawns = MAPS[room.map || 'neon'].spawns;
  room.players.forEach((pid, i) => {
    const c = clients.get(pid);
    if (!c) return;
    c.hp = MAX_HP;
    c.lastShotAt = 0;
    c.state = { ...spawns[i], pitch: 0, weapon: c.weapon };
  });
  const [a, b] = room.players.map(pid => clients.get(pid));
  if (a && b) {
    send(a.ws, 'roundStart', { round: room.round, spawn: spawns[0], enemySpawn: spawns[1], you: publicClient(a), enemy: publicClient(b), map: room.map });
    send(b.ws, 'roundStart', { round: room.round, spawn: spawns[1], enemySpawn: spawns[0], you: publicClient(b), enemy: publicClient(a), map: room.map });
  }
}

function endRound(room, winner, loser, reason) {
  if (room.status !== 'playing') return;
  room.status = 'round_end';
  winner.score = (winner.score || 0) + 1;
  broadcastRoom(room, 'roundEnd', {
    winnerId: winner.id,
    loserId: loser.id,
    reason,
    scores: room.players.map(pid => publicClient(clients.get(pid)))
  });
  if (winner.score >= 5) {
    room.status = 'match_end';
    broadcastRoom(room, 'matchEnd', { winnerId: winner.id, scores: room.players.map(pid => publicClient(clients.get(pid))) });
    setTimeout(() => {
      room.players.forEach(pid => { const c = clients.get(pid); if (c) { c.roomId = null; c.slot = null; } });
      rooms.delete(room.id);
    }, 1500);
  } else {
    setTimeout(() => {
      if (rooms.has(room.id)) {
        room.status = 'playing';
        resetRound(room);
      }
    }, 1800);
  }
}

function rayHit(origin, dir, targetState, weapon) {
  const ox = Number(origin.x), oy = Number(origin.y), oz = Number(origin.z);
  const dx = Number(dir.x), dy = Number(dir.y), dz = Number(dir.z);
  const tx = Number(targetState.x), ty = Number(targetState.y), tz = Number(targetState.z);
  if (![ox, oy, oz, dx, dy, dz, tx, ty, tz].every(Number.isFinite)) return null;
  const len = Math.hypot(dx, dy, dz) || 1;
  const nx = dx / len, ny = dy / len, nz = dz / len;

  const head = { x: tx, y: ty + 1.68, z: tz };
  const body = { x: tx, y: ty + 0.96, z: tz };
  const checkSphere = (p, radius) => {
    const vx = p.x - ox, vy = p.y - oy, vz = p.z - oz;
    const t = vx * nx + vy * ny + vz * nz;
    if (t < 0 || t > weapon.range) return null;
    const px = ox + nx * t, py = oy + ny * t, pz = oz + nz * t;
    const d2 = (p.x - px) ** 2 + (p.y - py) ** 2 + (p.z - pz) ** 2;
    return d2 <= radius * radius ? t : null;
  };
  const h = checkSphere(head, weapon.headRadius);
  if (h !== null) return { part: 'head', distance: h };
  const b = checkSphere(body, weapon.bodyRadius);
  if (b !== null) return { part: 'body', distance: b };
  return null;
}

wss.on('connection', ws => {
  const cid = id('p_');
  const client = {
    id: cid,
    ws,
    name: 'Player',
    weapon: 'sniper',
    skin: 'cyan',
    roomId: null,
    hp: MAX_HP,
    score: 0,
    state: { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, weapon: 'sniper' },
    lastShotAt: 0
  };
  clients.set(cid, client);
  send(ws, 'hello', { id: cid, online: clients.size, queue: queue.length });

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg.type !== 'string') return;

    if (msg.type === 'joinQueue') {
      cleanQueue();
      client.name = String(msg.name || 'Player').slice(0, 18);
      client.weapon = WEAPONS[msg.weapon] ? msg.weapon : 'sniper';
      client.skin = String(msg.skin || 'cyan').slice(0, 18);
      client.hp = MAX_HP;
      client.score = 0;
      client.map = MAPS[msg.map] ? msg.map : 'neon';
      client.state.weapon = client.weapon;
      if (client.roomId) return;
      const otherId = queue.find(pid => pid !== client.id && clients.has(pid) && !clients.get(pid).roomId);
      if (otherId) {
        queue = queue.filter(pid => pid !== otherId && pid !== client.id);
        startRoom(clients.get(otherId), client);
      } else {
        if (!queue.includes(client.id)) queue.push(client.id);
        send(ws, 'queued', { position: queue.indexOf(client.id) + 1, queue: queue.length, online: clients.size });
      }
    }

    if (msg.type === 'cancelQueue') {
      queue = queue.filter(pid => pid !== client.id);
      send(ws, 'queueCancelled');
    }

    if (msg.type === 'state') {
      if (!client.roomId) return;
      const room = rooms.get(client.roomId);
      if (!room || room.status !== 'playing') return;
      const s = msg.state || {};
      const lim = (client.roomId && rooms.get(client.roomId)?.map === 'crossroad') ? 32 : 29;
      const x = Math.max(-lim, Math.min(lim, Number(s.x)));
      const y = Math.max(-1, Math.min(3, Number(s.y)));
      const z = Math.max(-lim, Math.min(lim, Number(s.z)));
      const yaw = Number(s.yaw), pitch = Number(s.pitch);
      if (![x, y, z, yaw, pitch].every(Number.isFinite)) return;
      client.state = { x, y, z, yaw, pitch, weapon: client.weapon, hp: client.hp };
      const opp = opponentOf(room, client.id);
      if (opp) send(opp.ws, 'enemyState', { id: client.id, state: client.state, hp: client.hp, score: client.score });
    }

    if (msg.type === 'shoot') {
      if (!client.roomId) return;
      const room = rooms.get(client.roomId);
      if (!room || room.status !== 'playing') return;
      const weapon = WEAPONS[client.weapon] || WEAPONS.sniper;
      const now = Date.now();
      if (now - client.lastShotAt < weapon.fireDelay * 0.72) return;
      client.lastShotAt = now;

      const opp = opponentOf(room, client.id);
      if (!opp) return;
      send(opp.ws, 'enemyShot', { id: client.id, weapon: client.weapon, origin: msg.origin, dir: msg.dir });
      send(client.ws, 'shotAck', { id: client.id, weapon: client.weapon });
      const hit = rayHit(msg.origin || {}, msg.dir || {}, opp.state || {}, weapon);
      if (hit) {
        const dmg = hit.part === 'head' ? weapon.headDamage : weapon.damage;
        opp.hp = Math.max(0, opp.hp - dmg);
        broadcastRoom(room, 'hit', { shooterId: client.id, targetId: opp.id, part: hit.part, damage: dmg, targetHp: opp.hp });
        if (opp.hp <= 0) endRound(room, client, opp, hit.part === 'head' ? 'headshot' : 'elimination');
      }
    }

    if (msg.type === 'leaveRoom') {
      if (!client.roomId) return;
      const room = rooms.get(client.roomId);
      if (!room) return;
      const opp = opponentOf(room, client.id);
      if (opp) {
        opp.score = 5;
        send(opp.ws, 'matchEnd', { winnerId: opp.id, forfeit: true, scores: [publicClient(opp), publicClient(client)] });
        opp.roomId = null;
      }
      rooms.delete(room.id);
      client.roomId = null;
      send(client.ws, 'leftRoom');
    }
  });

  ws.on('close', () => {
    queue = queue.filter(pid => pid !== cid);
    const roomId = client.roomId;
    clients.delete(cid);
    if (roomId && rooms.has(roomId)) {
      const room = rooms.get(roomId);
      const oppId = room.players.find(pid => pid !== cid);
      const opp = clients.get(oppId);
      if (opp) {
        send(opp.ws, 'opponentLeft', { message: '상대가 나갔습니다. 승리 처리됩니다.' });
        opp.roomId = null;
        opp.score = 0;
      }
      rooms.delete(roomId);
    }
  });
});

setInterval(() => {
  cleanQueue();
  const payload = JSON.stringify({ type: 'serverStats', online: clients.size, queue: queue.length, rooms: rooms.size });
  wss.clients.forEach(ws => { if (ws.readyState === ws.OPEN) ws.send(payload); });
}, 2500);

server.listen(PORT, () => console.log(`RIVALS 2P server running: http://localhost:${PORT}`));

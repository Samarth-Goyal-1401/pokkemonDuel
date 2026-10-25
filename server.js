'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
const { WebSocketServer } = require('ws');
const E = require('./lib/engine'); const { FIGS, LIST } = require('./lib/figures'); const { PLATES } = require('./lib/plates');
const DB = require('./lib/db');
const B = require('./lib/board'); const { botDeck, randomDeck, botAct } = require('./lib/bot');

const PORT = process.env.PORT || 3000; 
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const PUB = path.join(__dirname, 'public');

const figPayload = JSON.stringify({
  figures: LIST.map(f => ({ id: f.id, name: f.name, rarity: f.rarity, mp: f.mp, cost: f.cost, types: f.types, ability: f.ability, abilityName: f.abilityName, picture: f.picture, active: Object.keys(f.flags).concat([...new Set(f.rules.map(r => r.k))]), segs: f.segs.map(s => ({ n: s.name, c: s.color, s: s.size, d: s.dmg, t: s.notes, ok: s.simulated })), z: f.zsegs.map(s => ({ n: s.name, c: s.color, s: s.size, d: s.dmg, t: s.notes, ok: s.simulated })) })),
  plates: PLATES, board: { points: B.POINTS, xy: B.XY, adj: B.ADJ, entry: B.ENTRY, goals: B.GOALS },
});


function handleApi(req, res, url) {
  const out = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(o)); };
  const tok = (req.headers.authorization || '').replace(/^Bearer /, ''); let body = '';
  req.on('data', d => { body += d; if (body.length > 500000) req.destroy(); });
  req.on('end', () => {
    let m = {}; try { m = body ? JSON.parse(body) : {}; } catch (e) { return out(400, { error: 'bad json' }); }
    try {
      if (url === '/api/register') { const r = DB.register(m.name, m.pass); return out(r.error ? 400 : 200, r); }
      if (url === '/api/login') { const r = DB.login(m.name, m.pass); return out(r.error ? 401 : 200, r); }
      if (url === '/api/leaderboard') return out(200, DB.leaderboard());
      const u = DB.who(tok); if (!u) return out(401, { error: 'not signed in' });
      if (url === '/api/pvp') return out(200, DB.pvpInfo(u));
      if (url === '/api/save' && req.method === 'GET') return out(200, { name: u, save: DB.getSave(u) });
      if (url === '/api/save' && req.method === 'PUT') return out(DB.putSave(u, m.save) ? 200 : 400, { ok: true });
      if (url === '/api/claim') return out(200, { result: DB.takeResult(u) });
      out(404, { error: 'unknown' });
    } catch (e) { console.error(e); out(500, { error: 'server error' }); }
  });
}

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/api/data') { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' }); return res.end(figPayload); }
  if (url.startsWith('/api/') && url !== '/api/data') return handleApi(req, res, url);
  let p = path.normalize(path.join(PUB, url === '/' ? 'index.html' : url));
  if (!p.startsWith(PUB)) { res.writeHead(403); return res.end(); }
  fs.readFile(p, (e, buf) => { if (e) { res.writeHead(404); return res.end('Not found'); } res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(buf); });
});

const wss = new WebSocketServer({ server });
const rooms = new Map();
const rid = () => { let c; do { c = Math.random().toString(36).slice(2, 6).toUpperCase(); } while (rooms.has(c)); return c; };
const send = (ws, o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };

function pushState(room) {
  if (!room.game) return;
  room.seats.forEach((s, i) => { if (s && s.ws) send(s.ws, { t: 'state', v: E.view(room.game, i), battle: room.game.lastBattleFresh ? room.game.lastBattle : null }); });
  room.game.lastBattleFresh = false;
}
function startGame(room) {
  const decks = room.seats.map(s => s.deck); const names = room.seats.map(s => s.name);
  room.game = E.newGame(decks, names, undefined, { bots: room.seats.map(s => s.bot), randomStart: true }); room.lastTick = Date.now();
  room.seats.forEach((s, i) => send(s.ws, { t: 'start', seat: i }));
  pushState(room); botMaybe(room);
}
function doAct(room, seat, act) {
  const g = room.game; if (!g || g.over) return;
  const before = g.lastBattle;
  const r = E.apply(g, seat, act);
  if (r.error) return r;
  if (r.battle) g.lastBattleFresh = true;
  pushState(room); botMaybe(room);
  if (g.over) { room.over = true; if (room.owned && !room.pvpDone && room.seats[0] && room.seats[1] && room.seats[0].user && room.seats[1].user && g.winner != null) { room.pvpDone = true; try { DB.addPvp(room.seats[g.winner].user, true); DB.addPvp(room.seats[1 - g.winner].user, false); } catch (e) { } }
    if (room.campUser && !room.campDone) { room.campDone = true; const hs = room.seats.findIndex(s => !s.bot); try { DB.setResult(room.campUser, { win: g.winner === hs, stage: room.campStage, fee: room.campFee }); } catch (e) { } } }
  return r;
}
function botMaybe(room) {
  const g = room.game; if (!g || g.over) return;
  const s = room.seats[g.cur]; if (!s || !s.bot) return;
  setTimeout(() => {
    if (g.over || room.game !== g || g.cur !== room.seats.indexOf(s)) return;
    const a = botAct(g, g.cur, Math.random, s.skill); if (!a) return;
    const r = doAct(room, g.cur, a); if (r && r.error) { /* fall back to first legal move */ const L = E.legal(g); const uid = Object.keys(L.moves)[0]; if (uid) doAct(room, g.cur, { t: 'move', uid: +uid, to: L.moves[uid][0] }); }
  }, 900);
}
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    const g = room.game; if (!g || g.over) { if (g && g.over && !room.cleanAt) room.cleanAt = now + 3600e3; continue; }
    const dt = now - (room.lastTick || now); room.lastTick = now;
    const ci = g.phase === 'choose' ? g.pending.task.seat : g.cur; const p = g.players[ci]; if (p.clock != null) p.clock -= dt;
    if (p.clock != null && p.clock <= 0) { p.clock = 0; E.timeout(g, ci); pushState(room); }
    else if ((now / 1000 | 0) % 5 === 0) pushState(room);
  }
  for (const [c, room] of rooms) if (room.cleanAt && now > room.cleanAt) rooms.delete(c);
}, 1000);

// Collection PvP: a deck may only use Pokémon and plates the signed-in account actually owns.
function checkOwned(authTok, deck) {
  const user = DB.who(authTok); if (!user) return { error: 'Collection PvP needs you to be signed in (open the Campaign tab and sign in).' };
  const sv = DB.getSave(user); if (!sv || !sv.owned) return { error: 'No campaign collection found for this account yet.' };
  const need = {}; for (const id of (deck && deck.figs) || []) need[id] = (need[id] || 0) + 1;
  for (const id in need) if ((+sv.owned[id] || 0) < need[id]) return { error: 'You do not own enough copies of ' + ((FIGS[id] && FIGS[id].name) || ('#' + id)) + '.' };
  const seen = new Set(); for (const k of (deck && deck.plates) || []) { if (!sv.plates || !sv.plates[k] || seen.has(k)) return { error: 'You do not own the plate ' + ((PLATES[k] && PLATES[k].name) || k) + '.' }; seen.add(k); }
  return { user };
}
wss.on('connection', ws => {
  ws.ctx = {};
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    const c = ws.ctx;
    const mkSeat = (name, deck, bot, skill) => ({ ws: bot ? null : ws, name: String(name || 'Trainer').slice(0, 24), deck, bot: !!bot, skill: skill == null ? 0.4 : skill, token: Math.random().toString(36).slice(2) });
    if (m.t === 'create' || m.t === 'bot') {
      const err = E.validateDeck(m.deck); if (err) return send(ws, { t: 'err', msg: err });
      let own = null; if (m.owned && m.t === 'create') { own = checkOwned(m.auth, m.deck); if (own.error) return send(ws, { t: 'err', msg: own.error }); }
      const code = rid(); const room = { code, seats: [mkSeat(own ? own.user : m.name, m.deck), null], game: null }; if (own) { room.owned = true; room.seats[0].user = own.user; }
      rooms.set(code, room); c.room = room; c.seat = 0;
      send(ws, { t: 'room', code, seat: 0, token: room.seats[0].token, bot: m.t === 'bot' });
      if (m.t === 'bot') { const cu = DB.who(m.auth); room.campUser = cu && m.boss ? cu : null; room.campDone = false; room.campStage = String((m.boss && m.boss.stage) || ''); room.campFee = Math.max(0, Math.min(5000, +(m.boss && m.boss.fee) || 0)); if (room.campUser) { try { DB.setResult(room.campUser, { win: false, stage: room.campStage, fee: room.campFee, pending: true }); } catch (e) { } } const bs = m.boss && m.boss.deck && !E.validateDeck(m.boss.deck) ? m.boss : null; room.boss = bs ? { deck: bs.deck, skill: Math.max(0, Math.min(1, +bs.skill || 0)), name: String(bs.name || 'Boss') } : null; room.seats[1] = room.boss ? mkSeat(room.boss.name, room.boss.deck, true, room.boss.skill) : mkSeat('Rival Bot', randomDeck(Math.random), true); if (Math.random() < 0.5) { room.seats.reverse(); room.seats.forEach((s, i) => { if (!s.bot) { c.seat = i; send(ws, { t: 'room', code, seat: i, token: s.token, bot: true }); } }); } startGame(room); }
      else send(ws, { t: 'waiting', code });
    } else if (m.t === 'join') {
      const room = rooms.get(String(m.code || '').toUpperCase()); if (!room) return send(ws, { t: 'err', msg: 'Room not found.' });
      if (room.seats[1]) return send(ws, { t: 'err', msg: 'Room is full.' });
      const err = E.validateDeck(m.deck); if (err) return send(ws, { t: 'err', msg: err });
      if (!!room.owned !== !!m.owned) return send(ws, { t: 'err', msg: room.owned ? 'That is a Collection PvP room – join it from the Campaign → PvP tab.' : 'That is a normal room – join it from the team builder.' });
      let own = null; if (room.owned) { own = checkOwned(m.auth, m.deck); if (own.error) return send(ws, { t: 'err', msg: own.error }); if (room.seats[0].user === own.user) return send(ws, { t: 'err', msg: 'You cannot play against yourself.' }); }
      room.seats[1] = mkSeat(own ? own.user : m.name, m.deck); if (own) room.seats[1].user = own.user; c.room = room; c.seat = 1;
      send(ws, { t: 'room', code: room.code, seat: 1, token: room.seats[1].token }); startGame(room);
    } else if (m.t === 'rejoin') {
      const room = rooms.get(String(m.code || '').toUpperCase()); if (!room) return send(ws, { t: 'err', msg: 'Room expired.', fatal: true });
      const i = room.seats.findIndex(s => s && s.token === m.token); if (i < 0) return send(ws, { t: 'err', msg: 'Bad token.', fatal: true });
      room.seats[i].ws = ws; c.room = room; c.seat = i; send(ws, { t: 'room', code: room.code, seat: i, token: m.token });
      if (room.game) { send(ws, { t: 'start', seat: i }); pushState(room); } else send(ws, { t: 'waiting', code: room.code });
    } else if (m.t === 'act') {
      const room = c.room; if (!room || !room.game) return;
      const r = doAct(room, c.seat, m.a); if (r && r.error) send(ws, { t: 'err', msg: r.error });
    } else if (m.t === 'rematch') {
      const room = c.room; if (!room || !room.seats[0] || !room.seats[1]) return; const s = room.seats[c.seat];
      let deck = m.random && !room.owned ? randomDeck(Math.random) : (m.deck && !E.validateDeck(m.deck) && (!room.owned || !checkOwned(m.auth, m.deck).error) ? m.deck : s.deck); s.nextDeck = deck;
      const humans = room.seats.filter(x => !x.bot);
      if (humans.length === 1) { room.seats.forEach(x => { if (x.bot) x.nextDeck = room.boss ? room.boss.deck : randomDeck(Math.random); }); }
      s.wantRematch = true;
      if (room.seats.every(x => x.bot || x.wantRematch)) {
        room.seats.forEach(x => { if (x.nextDeck) x.deck = x.nextDeck; x.nextDeck = null; x.wantRematch = false; }); room.over = false; room.pvpDone = false; room.cleanAt = 0; room.paused = false; if (room.campUser) { room.campDone = false; try { DB.setResult(room.campUser, { win: false, stage: room.campStage, fee: room.campFee, pending: true }); } catch (e) { } } startGame(room);
      } else room.seats.forEach(x => x.ws && x !== s && send(x.ws, { t: 'chat', from: 'System', text: s.name + ' wants a rematch' + (m.random ? ' with random teams' : '') + '. Press Rematch to accept.' }));
    } else if (m.t === 'vis') {
      const room = c.room; if (room) room.paused = !!m.hidden; // bot rooms: pause clock while the tab is hidden
    } else if (m.t === 'chat') {
      const room = c.room; if (!room) return; const txt = String(m.text || '').slice(0, 200); if (!txt) return;
      room.seats.forEach(s => s && s.ws && send(s.ws, { t: 'chat', from: room.seats[c.seat].name, text: txt }));
    }
  });
  ws.on('close', () => {
    const { room, seat } = ws.ctx; if (!room) return;
    const s = room.seats[seat]; if (s && s.ws === ws) s.ws = null;
    const o = room.seats[1 - seat]; if (o && o.ws) send(o.ws, { t: 'chat', from: 'System', text: (s ? s.name : 'Opponent') + ' disconnected (they can rejoin; their clock keeps running).' });
    if (room.game && room.game.cur === seat && !room.game.over && !room.seats[seat].bot) { /* clock keeps ticking in interval */ }
  });
});
// Clock: disconnected players still burn time
server.listen(PORT, () => console.log('Pokémon Duel server on http://localhost:' + PORT));

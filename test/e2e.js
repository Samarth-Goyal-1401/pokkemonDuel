'use strict';
// Spawns the server, plays human-vs-bot through real WebSockets, checks state messages.
const { spawn } = require('child_process'); const WebSocket = require('ws');
const srv = spawn('node', ['server.js'], { env: { ...process.env, PORT: 3111 }, cwd: __dirname + '/..' });
setTimeout(() => {
  const ws = new WebSocket('ws://localhost:3111'); let seat = 0, v = null, moves = 0, done = false;
  const { botDeck } = require('../lib/bot');
  ws.on('open', () => ws.send(JSON.stringify({ t: 'bot', name: 'Tester', deck: botDeck(Math.random) })));
  ws.on('message', raw => {
    const m = JSON.parse(raw);
    if (m.t === 'room') seat = m.seat; if (m.t === 'err') console.log('ERR', m.msg);
    if (m.t === 'state') {
      v = m.v;
      if (v.over) { if (!done) { done = true; console.log('OVER', v.reason, 'moves', moves); ws.close(); srv.kill(); process.exit(0); } return; }
      if (v.legal && v.legal.choose) return ws.send(JSON.stringify({ t: 'act', a: { t: 'choose', to: v.legal.choose.options[0] } }));
      if (v.cur === seat && v.legal) {
        if (v.phase === 'battleChoice') return ws.send(JSON.stringify({ t: 'act', a: { t: 'battle', target: v.legal.battle[0] } }));
        const uids = Object.keys(v.legal.moves); if (!uids.length) return;
        const u = uids[(Math.random() * uids.length) | 0]; const to = v.legal.moves[u][(Math.random() * v.legal.moves[u].length) | 0]; moves++;
        ws.send(JSON.stringify({ t: 'act', a: { t: 'move', uid: +u, to } }));
      }
    }
  });
}, 800);
setTimeout(() => { console.log('TIMEOUT'); srv.kill(); process.exit(1); }, 120000);

'use strict';
// SQLite persistence (node:sqlite, built into Node 22). File: data/duel.sqlite (override with DUEL_DB).
const path = require('path'), crypto = require('crypto'), fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const file = process.env.DUEL_DB || path.join(__dirname, '..', 'data', 'duel.sqlite');
fs.mkdirSync(path.dirname(file), { recursive: true });
const db = new DatabaseSync(file);
db.exec(`CREATE TABLE IF NOT EXISTS users(name TEXT PRIMARY KEY COLLATE NOCASE, salt TEXT, hash TEXT, save TEXT, updated INTEGER, created INTEGER, tower INTEGER DEFAULT 0, wins INTEGER DEFAULT 0, result TEXT);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, name TEXT, created INTEGER);`);
try { db.exec('ALTER TABLE users ADD COLUMN pvp_w INTEGER DEFAULT 0'); } catch (e) { }
try { db.exec('ALTER TABLE users ADD COLUMN pvp_l INTEGER DEFAULT 0'); } catch (e) { }
const hash = (pw, salt) => crypto.scryptSync(pw, salt, 32).toString('hex');
const clean = n => String(n || '').trim().slice(0, 20);
function register(name, pw) {
  name = clean(name); pw = String(pw || '');
  if (!/^[A-Za-z0-9_ .-]{3,20}$/.test(name)) return { error: 'Name must be 3-20 letters/numbers.' };
  if (pw.length < 4 || pw.length > 64) return { error: 'Passcode must be 4-64 characters.' };
  if (db.prepare('SELECT 1 FROM users WHERE name=?').get(name)) return { error: 'That name is taken.' };
  const salt = crypto.randomBytes(12).toString('hex');
  db.prepare('INSERT INTO users(name,salt,hash,created,updated) VALUES(?,?,?,?,?)').run(name, salt, hash(pw, salt), Date.now(), Date.now());
  return session(name);
}
function login(name, pw) {
  const u = db.prepare('SELECT * FROM users WHERE name=?').get(clean(name));
  if (!u || !crypto.timingSafeEqual(Buffer.from(hash(String(pw || ''), u.salt)), Buffer.from(u.hash))) return { error: 'Wrong name or passcode.' };
  return session(u.name);
}
function session(name) { const token = crypto.randomBytes(24).toString('hex'); db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(token, name, Date.now()); return { token, name }; }
const who = token => { const r = token && db.prepare('SELECT name FROM sessions WHERE token=?').get(String(token)); return r ? r.name : null; };
const getSave = name => { const r = db.prepare('SELECT save FROM users WHERE name=?').get(name); try { return r && r.save ? JSON.parse(r.save) : null; } catch (e) { return null; } };
function putSave(name, s) {
  const j = JSON.stringify(s); if (j.length > 400000) return false;
  db.prepare('UPDATE users SET save=?, updated=?, tower=?, wins=? WHERE name=?').run(j, Date.now(), +(s.tower && s.tower.best) || 0, +s.wins || 0, name); return true;
}
const setResult = (name, r) => db.prepare('UPDATE users SET result=? WHERE name=?').run(JSON.stringify(r), name);
function takeResult(name) { const r = db.prepare('SELECT result FROM users WHERE name=?').get(name); if (!r || !r.result) return null; db.prepare('UPDATE users SET result=NULL WHERE name=?').run(name); try { return JSON.parse(r.result); } catch (e) { return null; } }
const leaderboard = () => db.prepare('SELECT name,tower,wins FROM users WHERE tower>0 OR wins>0 ORDER BY tower DESC, wins DESC LIMIT 20').all();
const addPvp = (name, win) => db.prepare(win ? 'UPDATE users SET pvp_w=COALESCE(pvp_w,0)+1 WHERE name=?' : 'UPDATE users SET pvp_l=COALESCE(pvp_l,0)+1 WHERE name=?').run(name);
const pvpInfo = name => ({ me: db.prepare('SELECT pvp_w w, pvp_l l FROM users WHERE name=?').get(name) || { w: 0, l: 0 }, top: db.prepare('SELECT name, pvp_w w, pvp_l l FROM users WHERE pvp_w>0 ORDER BY pvp_w DESC, pvp_l ASC LIMIT 10').all() });
module.exports = { addPvp, pvpInfo, register, login, who, getSave, putSave, setResult, takeResult, leaderboard };

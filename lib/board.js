'use strict';
// Real Pokémon Duel board, transcribed from the official board image.
// 26 route points + 2 goals. Coordinates are in the source image's pixel space (used for rendering and straight-line tests).
// Double-ringed corners = entry points (2 per player). Double-ringed middle points of the top/bottom rows = goals.
const XY = {
  // top row (seat 1's side)
  T0: { x: 67, y: 232 }, T1: { x: 148, y: 232 }, T2: { x: 217, y: 232 }, G1: { x: 297, y: 232 }, T3: { x: 379, y: 232 }, T4: { x: 447, y: 232 }, T5: { x: 527, y: 232 },
  // bottom row (seat 0's side)
  B0: { x: 67, y: 608 }, B1: { x: 148, y: 608 }, B2: { x: 217, y: 608 }, G0: { x: 297, y: 608 }, B3: { x: 379, y: 608 }, B4: { x: 447, y: 608 }, B5: { x: 527, y: 608 },
  // outer side columns
  L1: { x: 67, y: 332 }, L2: { x: 67, y: 420 }, L3: { x: 67, y: 508 },
  R1: { x: 527, y: 332 }, R2: { x: 527, y: 420 }, R3: { x: 527, y: 508 },
  // inner ring
  I00: { x: 183, y: 326 }, I01: { x: 297, y: 326 }, I02: { x: 410, y: 326 },
  I10: { x: 183, y: 428 }, I12: { x: 410, y: 422 },
  I20: { x: 183, y: 514 }, I21: { x: 297, y: 514 }, I22: { x: 410, y: 514 },
};
const EDGES = [
  ['T0', 'T1'], ['T1', 'T2'], ['T2', 'G1'], ['G1', 'T3'], ['T3', 'T4'], ['T4', 'T5'],
  ['B0', 'B1'], ['B1', 'B2'], ['B2', 'G0'], ['G0', 'B3'], ['B3', 'B4'], ['B4', 'B5'],
  ['T0', 'L1'], ['L1', 'L2'], ['L2', 'L3'], ['L3', 'B0'],
  ['T5', 'R1'], ['R1', 'R2'], ['R2', 'R3'], ['R3', 'B5'],
  ['I00', 'I01'], ['I01', 'I02'], ['I00', 'I10'], ['I10', 'I20'], ['I02', 'I12'], ['I12', 'I22'], ['I20', 'I21'], ['I21', 'I22'],
  ['T0', 'I00'], ['T5', 'I02'], ['B0', 'I20'], ['B5', 'I22'],   // corner diagonals
  ['T2', 'I01'], ['B3', 'I21'],                                 // the two off-centre diagonals
];
const POINTS = Object.keys(XY).filter(k => !k.startsWith('G'));
const ADJ = {}; Object.keys(XY).forEach(p => (ADJ[p] = []));
for (const [a, b] of EDGES) { ADJ[a].push(b); ADJ[b].push(a); }
const GOALS = { 0: 'G1', 1: 'G0' };          // GOALS[seat] = the goal that seat must capture
const ENTRY = { 0: ['B0', 'B5'], 1: ['T0', 'T5'] };
const GOAL_APPROACH = { G1: ['T2', 'T3'], G0: ['B2', 'B3'] };

function bfs(from, blocked) {
  const d = { [from]: 0 }; const q = [from];
  while (q.length) { const c = q.shift(); for (const n of ADJ[c]) if (!(n in d) && !(blocked && blocked(n))) { d[n] = d[c] + 1; q.push(n); } }
  return d;
}
// the point that continues the straight line a -> b (null if the line ends)
function beyond(a, b) {
  const A = XY[a], Bp = XY[b]; const vx = Bp.x - A.x, vy = Bp.y - A.y; const vl = Math.hypot(vx, vy); let best = null, bc = 0.9;
  for (const n of ADJ[b]) { if (n === a || n.startsWith('G')) continue; const wx = XY[n].x - Bp.x, wy = XY[n].y - Bp.y; const c = (vx * wx + vy * wy) / (vl * Math.hypot(wx, wy)); if (c > bc) { bc = c; best = n; } }
  return best;
}
module.exports = { POINTS, XY, ADJ, ENTRY, GOALS, GOAL_APPROACH, EDGES, bfs, beyond };

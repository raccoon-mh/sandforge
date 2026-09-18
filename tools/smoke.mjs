// Behavioural smoke test. Run with:  node tools/smoke.mjs
// Prints ASCII snapshots so a physics regression is visible, not just asserted.
const root = new URL('../src/engine/', import.meta.url).href
const { Sim } = await import(root + 'sim.ts')
const { ID_TO_NUM, DEFS } = await import(root + 'materials.ts')
const M = id => ID_TO_NUM.get(id)
const size = { w: 40, h: 24, l: 2 }
const glyph = { NONE: ' ', SAND: '.', WATR: '~', WALL: '#', FIRE: '*', STEM: '"', ICE: 'i', OBSD: 'O', LAVA: 'L', SMKE: 'o', WOOD: 'W', ASH: 'a', SLTW: 's', SALT: 'S' }
function show(sim, z = 0) {
  const g = sim.grid
  for (let y = 0; y < g.h; y++) {
    let r = ''
    for (let x = 0; x < g.w; x++) { const d = DEFS[g.type[g.idx(x, y, z)]]; r += glyph[d.id] ?? d.id[0].toLowerCase() }
    console.log('|' + r + '|')
  }
}
function box(sim, z) {
  const g = sim.grid
  for (let x = 0; x < g.w; x++) g.set(g.idx(x, g.h - 1, z), M('WALL'), x, g.h - 1, z)
  for (let y = 0; y < g.h; y++) { g.set(g.idx(0, y, z), M('WALL'), 0, y, z); g.set(g.idx(g.w - 1, y, z), M('WALL'), g.w - 1, y, z) }
}

console.log('=== 1. 모래는 쌓이고 물은 퍼진다 ===')
let sim = new Sim(size); box(sim, 0)
sim.paint(10, 2, 0, M('SAND'), 3); sim.paint(28, 2, 0, M('WATR'), 3)
for (let i = 0; i < 120; i++) sim.step()
show(sim)

console.log('\n=== 2. 용암 + 물 -> 흑요석 + 수증기 ===')
sim = new Sim(size); box(sim, 0)
for (let x = 5; x < 20; x++) for (let y = 18; y < 22; y++) sim.grid.set(sim.grid.idx(x, y, 0), M('LAVA'), x, y, 0)
for (let i = 0; i < 40; i++) { sim.paint(12, 3, 0, M('WATR'), 2); sim.step() }
show(sim)
const counts = {}
for (let i = 0; i < sim.grid.cells; i++) { const id = DEFS[sim.grid.type[i]].id; counts[id] = (counts[id] ?? 0) + 1 }
console.log(Object.entries(counts).filter(([k]) => k !== 'NONE').map(([k, v]) => `${k}:${v}`).join(' '))

console.log('\n=== 3. 나무에 불 -> 재 ===')
sim = new Sim(size); box(sim, 0)
for (let x = 4; x < 36; x++) for (let y = 16; y < 22; y++) sim.grid.set(sim.grid.idx(x, y, 0), M('WOOD'), x, y, 0)
sim.paint(20, 15, 0, M('FIRE'), 2)
for (let i = 0; i < 400; i++) sim.step()
show(sim)
let wood = 0, ash = 0, maxT = 0
for (let i = 0; i < sim.grid.cells; i++) { const t = sim.grid.type[i]; if (t === M('WOOD')) wood++; if (t === M('ASH')) ash++; if (sim.grid.temp[i] > maxT) maxT = sim.grid.temp[i] }
console.log(`남은 나무 ${wood}, 재 ${ash}, 최고온도 ${maxT.toFixed(0)}K`)

console.log('\n=== 4. 전기: 전지 -> 도선 -> 램프 ===')
sim = new Sim({ w: 24, h: 8, l: 1 })
const g = sim.grid
g.set(g.idx(2, 4, 0), M('BATT'), 2, 4, 0)
for (let x = 3; x < 18; x++) g.set(g.idx(x, 4, 0), M('WIRE'), x, 4, 0)
g.set(g.idx(18, 4, 0), M('LAMP'), 18, 4, 0)
for (let i = 0; i < 30; i++) sim.step()
let lampLit = g.chg[g.idx(18, 4, 0)] > 0, sparks = sim.stats().sparks
console.log(`18칸 떨어진 램프 점등: ${lampLit}, 살아있는 스파크 ${sparks}, 도선 온도 ${g.temp[g.idx(10,4,0)].toFixed(1)}K`)

console.log('\n=== 5. 다이오드: P->N 통과, N->P 차단 ===')
for (const [a, b, label] of [['PSCN', 'NSCN', '정방향'], ['NSCN', 'PSCN', '역방향']]) {
  const s2 = new Sim({ w: 20, h: 6, l: 1 }); const q = s2.grid
  q.set(q.idx(1, 3, 0), M('BATT'), 1, 3, 0)
  for (let x = 2; x < 8; x++) q.set(q.idx(x, 3, 0), M('WIRE'), x, 3, 0)
  q.set(q.idx(8, 3, 0), M(a), 8, 3, 0)
  q.set(q.idx(9, 3, 0), M(b), 9, 3, 0)
  for (let x = 10; x < 17; x++) q.set(q.idx(x, 3, 0), M('WIRE'), x, 3, 0)
  q.set(q.idx(17, 3, 0), M('LAMP'), 17, 3, 0)
  let lit = false
  for (let i = 0; i < 60; i++) { s2.step(); if (q.chg[q.idx(17, 3, 0)] > 0) lit = true }
  console.log(`  ${label} (${a}->${b}): 램프 ${lit ? '켜짐' : '꺼짐'}`)
}

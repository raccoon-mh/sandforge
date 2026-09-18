// Headless benchmark. Run with:  node tools/bench.mjs
// The engine touches no browser API, so it runs unmodified under Node.
const root = new URL('../src/engine/', import.meta.url).href
const { Sim } = await import(root + 'sim.ts')
const { PRESETS } = await import(root + 'grid.ts')
const { ID_TO_NUM } = await import(root + 'materials.ts')
const M = id => ID_TO_NUM.get(id)

function run(label, preset, build, ticks = 240) {
  const sim = new Sim(preset)
  build(sim, preset)
  sim.step()
  const t0 = performance.now()
  for (let i = 0; i < ticks; i++) sim.step()
  const ms = (performance.now() - t0) / ticks
  const s = sim.stats()
  console.log(`${label.padEnd(26)} ${ms.toFixed(2).padStart(6)} ms/tick   filled=${String(s.filled).padStart(7)}  active=${s.activeChunks}/${s.chunkCount}`)
  return ms
}

const med = PRESETS.medium
console.log(`grid ${med.w}x${med.h}x${med.l} = ${(med.w*med.h*med.l/1e6).toFixed(2)}M cells, ${PRESETS.large.w}x${PRESETS.large.h}x${PRESETS.large.l} large\n`)

run('빈 격자', med, () => {})

run('모래 산더미(정착 후)', med, (sim, p) => {
  for (let y = p.h - 60; y < p.h; y++) for (let x = 0; x < p.w; x++)
    sim.grid.set(sim.grid.idx(x, y, 0), M('SAND'), x, y, 0)
  for (let i = 0; i < 400; i++) sim.step()
})

run('물 30만칸 출렁', med, (sim, p) => {
  for (let y = p.h - 100; y < p.h; y++) for (let x = 0; x < p.w; x++)
    sim.grid.set(sim.grid.idx(x, y, 0), M('WATR'), x, y, 0)
})

run('전 층 물+모래 (최악)', med, (sim, p) => {
  for (let z = 0; z < p.l; z++)
    for (let y = p.h - 90; y < p.h; y++) for (let x = 0; x < p.w; x++)
      sim.grid.set(sim.grid.idx(x, y, z), (x + y) % 3 ? M('WATR') : M('SAND'), x, y, z)
})

run('불난 숲 (반응+열)', med, (sim, p) => {
  for (let y = p.h - 120; y < p.h; y++) for (let x = 0; x < p.w; x++)
    if ((x * 7 + y * 3) % 5 < 3) sim.grid.set(sim.grid.idx(x, y, 0), M('WOOD'), x, y, 0)
  sim.paint(p.w >> 1, p.h - 10, 0, M('FIRE'), 12)
})

run('큰 격자 물바다', PRESETS.large, (sim, p) => {
  for (let y = p.h - 150; y < p.h; y++) for (let x = 0; x < p.w; x++)
    sim.grid.set(sim.grid.idx(x, y, 0), M('WATR'), x, y, 0)
})

console.log('\n--- 절대 정착하지 않는 지속 부하 (진짜 최악) ---')
function sustained(label, preset, seedFn, ticks = 240) {
  const sim = new Sim(preset)
  const t0 = performance.now()
  for (let i = 0; i < ticks; i++) { seedFn(sim, preset, i); sim.step() }
  const ms = (performance.now() - t0) / ticks
  const s = sim.stats()
  console.log(`${label.padEnd(26)} ${ms.toFixed(2).padStart(6)} ms/tick   filled=${String(s.filled).padStart(7)}  active=${s.activeChunks}/${s.chunkCount}`)
}

sustained('폭포 8개 층 동시', med, (sim, p) => {
  for (let z = 0; z < p.l; z++)
    for (let k = 0; k < 6; k++) sim.paint(((k + 1) * p.w / 7) | 0, 2, z, M('WATR'), 4)
})

sustained('용암+물 전 층 (반응+열)', med, (sim, p, i) => {
  for (let z = 0; z < p.l; z++) {
    sim.paint((p.w * 0.3) | 0, 2, z, M('LAVA'), 4)
    sim.paint((p.w * 0.7) | 0, 2, z, M('WATR'), 4)
  }
  if (i % 40 === 0) sim.paint(p.w >> 1, p.h - 30, 0, M('GUNP'), 8)
})

sustained('큰 격자 폭포 8층', PRESETS.large, (sim, p) => {
  for (let z = 0; z < p.l; z++)
    for (let k = 0; k < 6; k++) sim.paint(((k + 1) * p.w / 7) | 0, 2, z, M('SAND'), 4)
})

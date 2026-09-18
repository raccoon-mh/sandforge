// Runs every example scene headlessly and reports what actually happened.
// A scene that produces no change is a broken scene, not a quiet one.
const root = new URL('../src/', import.meta.url).href
const { Sim } = await import(root + 'engine/sim.ts')
const { PRESETS } = await import(root + 'engine/grid.ts')
const { DEFS } = await import(root + 'engine/materials.ts')
const { SCENES, buildScene } = await import(root + 'share/scenes.ts')

const census = sim => {
  const c = new Map()
  for (let i = 0; i < sim.grid.cells; i++) {
    const t = sim.grid.type[i]
    if (t !== 0) c.set(t, (c.get(t) ?? 0) + 1)
  }
  return c
}

let failures = 0
for (const scene of SCENES) {
  const sim = new Sim(PRESETS.medium)
  buildScene(sim, scene.id)
  const before = census(sim)
  const placed = [...before.values()].reduce((a, b) => a + b, 0)
  const snapshot = Uint16Array.from(sim.grid.type)

  let peakT = 0, peakP = 0, peakSparks = 0, sparkTicks = 0
  const t0 = performance.now()
  for (let i = 0; i < 600; i++) {
    sim.step()
    const st = sim.stats()
    if (st.sparks > 0) { sparkTicks++; if (st.sparks > peakSparks) peakSparks = st.sparks }
    if ((i & 31) === 0) {
      for (let k = 0; k < sim.grid.cells; k += 7) if (sim.grid.temp[k] > peakT) peakT = sim.grid.temp[k]
      for (let k = 0; k < sim.pf.p.length; k++) { const v = Math.abs(sim.pf.p[k]); if (v > peakP) peakP = v }
    }
  }
  const ms = (performance.now() - t0) / 600
  const after = census(sim)

  const appeared = [...after].filter(([t]) => !before.has(t)).sort((a, b) => b[1] - a[1])
  const gone = [...before].filter(([t]) => !after.has(t))
  const changed = [...after].filter(([t, n]) => before.has(t) && Math.abs(n - before.get(t)) > before.get(t) * 0.2)

  // Counting cells whose contents differ catches movement too — a pile of iron
  // filings dragged to a magnet changes no census total at all.
  let disturbed = 0
  for (let i = 0; i < snapshot.length; i++) if (snapshot[i] !== sim.grid.type[i]) disturbed++

  const active = changed.length + appeared.length + gone.length
  const ok = placed > 200 && (active > 0 || sparkTicks > 20 || peakP > 1 || disturbed > placed * 0.01)
  if (!ok) failures++

  console.log(`${ok ? 'OK  ' : 'FAIL'} ${scene.name}`)
  console.log(`      배치 ${placed.toLocaleString()}칸 · ${ms.toFixed(2)}ms/틱 · 최고 ${peakT.toFixed(0)}K · 최대압력 ${peakP.toFixed(1)}` +
    (sparkTicks ? ` · 통전 ${sparkTicks}/600틱 (최대 ${peakSparks})` : '') +
    ` · 변동 ${disturbed.toLocaleString()}칸`)
  if (appeared.length) console.log(`      새로 생김: ${appeared.slice(0, 7).map(([t, n]) => `${DEFS[t].name} ${n}`).join(', ')}`)
  if (gone.length) console.log(`      전부 사라짐: ${gone.map(([t]) => DEFS[t].name).join(', ')}`)
}
console.log(`\n${SCENES.length}개 중 ${SCENES.length - failures}개 정상`)

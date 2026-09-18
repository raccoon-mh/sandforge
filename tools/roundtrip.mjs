// Save/load round-trip. A save that does not come back identical is worse than
// no save at all, so this asserts cell-for-cell equality on a busy grid.
const root = new URL('../src/engine/', import.meta.url).href
const { Sim } = await import(root + 'sim.ts')
const { PRESETS } = await import(root + 'grid.ts')
const { ID_TO_NUM } = await import(root + 'materials.ts')
const { encode, decode } = await import(new URL('../src/share/save.ts', import.meta.url).href)

const size = PRESETS.small
const a = new Sim(size)
const pick = ['SAND', 'WATR', 'LAVA', 'IRON', 'WIRE', 'WOOD', 'OIL', 'WALL', 'URAN', 'GLAS']
  .map(id => ID_TO_NUM.get(id))
for (let k = 0; k < 220; k++) {
  a.paint((Math.random() * size.w) | 0, (Math.random() * size.h) | 0,
          (Math.random() * size.l) | 0, pick[(Math.random() * pick.length) | 0], 3 + ((Math.random() * 6) | 0))
}
for (let i = 0; i < 90; i++) a.step()

const buf = encode(a.grid)
const b = new Sim(size)
decode(buf).apply(b.grid)

let typeDiff = 0, tempDiff = 0, worstT = 0
for (let i = 0; i < a.grid.cells; i++) {
  if (a.grid.type[i] !== b.grid.type[i]) typeDiff++
  const d = Math.abs(a.grid.temp[i] - b.grid.temp[i])
  if (d > 0.5) { tempDiff++; if (d > worstT) worstT = d }
}
const kinds = new Set([...a.grid.type].filter(t => t !== 0)).size
console.log(`격자 ${size.w}x${size.h}x${size.l} = ${a.grid.cells.toLocaleString()}칸, 채워진 칸 ${a.grid.filled.toLocaleString()}, 물질 ${kinds}종`)
console.log(`저장 크기 ${(buf.byteLength / 1024).toFixed(1)}KB (칸당 ${(buf.byteLength / a.grid.cells).toFixed(3)} 바이트)`)
console.log(`물질 불일치 ${typeDiff}칸, 온도 불일치(>0.5K) ${tempDiff}칸 (최대 ${worstT.toFixed(2)}K)`)
console.log(`채워진 칸 수: 원본 ${a.grid.filled} / 복원 ${b.grid.filled}`)

// A restored grid must keep simulating, not sit frozen.
const before = b.grid.filled
for (let i = 0; i < 60; i++) b.step()
console.log(`복원 후 60틱 더 돌림 - 활성 청크 ${b.stats().activeChunks}, 채워진 칸 ${before} -> ${b.grid.filled}`)
console.log(typeDiff === 0 && tempDiff === 0 ? '\n결과: 왕복 일치 OK' : '\n결과: 불일치 FAIL')

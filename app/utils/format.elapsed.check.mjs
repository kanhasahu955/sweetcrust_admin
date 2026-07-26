/** ponytail: assert elapsedCompact day folding — run: node admin/app/utils/format.elapsed.check.mjs */
import assert from "node:assert/strict"

function elapsedCompact(mins) {
  const mTotal = Math.max(0, Math.floor(mins))
  if (mTotal < 1) return "<1m"
  if (mTotal < 60) return `${mTotal}m`
  const days = Math.floor(mTotal / (60 * 24))
  const rem = mTotal % (60 * 24)
  const h = Math.floor(rem / 60)
  const m = rem % 60
  if (days >= 1) {
    const parts = [`${days}d`]
    if (h) parts.push(`${h}h`)
    if (m) parts.push(`${m}m`)
    return parts.join(" ")
  }
  return m ? `${h}h ${m}m` : `${h}h`
}

assert.equal(elapsedCompact(0), "<1m")
assert.equal(elapsedCompact(45), "45m")
assert.equal(elapsedCompact(60), "1h")
assert.equal(elapsedCompact(3 * 60 + 12), "3h 12m")
assert.equal(elapsedCompact(24 * 60), "1d")
assert.equal(elapsedCompact(25 * 60), "1d 1h")
assert.equal(elapsedCompact(48 * 60 + 49), "2d 49m")
assert.equal(elapsedCompact(109 * 60 + 33), "4d 13h 33m")
console.log("elapsedCompact ok")

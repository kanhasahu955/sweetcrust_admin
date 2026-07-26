
import assert from "node:assert/strict"
import dayjs from "dayjs"

function parseApiDate(raw) {
  if (raw == null || raw === "") return null
  const s = String(raw).trim()
  const hasTz = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(s)
  const normalized = hasTz ? s : /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(s) ? s.replace(" ", "T") + "Z" : s
  const d = dayjs(normalized)
  return d.isValid() ? d : null
}

const now = dayjs("2026-07-26T04:16:00+05:30")
assert.equal(Math.max(0, now.diff(parseApiDate("2026-07-25T22:46:00"), "minute")), 0)
assert.equal(Math.max(0, now.diff(parseApiDate("2026-07-25T22:46:00Z"), "minute")), 0)
assert.ok(Math.max(0, now.diff(dayjs("2026-07-25T22:46:00"), "minute")) >= 300)
console.log("parseApiDate check ok")


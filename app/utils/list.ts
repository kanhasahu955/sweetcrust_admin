/** Immediate list UI updates after create/update/delete (no waiting on a refetch). */

export function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

export function upsertListRow(
  rows: { value: Record<string, unknown>[] },
  item: unknown,
  idKey = "id",
) {
  const row = asRecord(item)
  if (!row || row[idKey] == null) return false
  const id = Number(row[idKey])
  const i = rows.value.findIndex((r) => Number(r[idKey]) === id)
  if (i >= 0) {
    const next = rows.value.slice()
    next[i] = { ...next[i], ...row }
    rows.value = next
  } else {
    rows.value = [...rows.value, row]
  }
  return true
}

export function patchListRow(
  rows: { value: Record<string, unknown>[] },
  id: number,
  patch: Record<string, unknown>,
  idKey = "id",
) {
  const i = rows.value.findIndex((r) => Number(r[idKey]) === id)
  if (i < 0) return false
  const next = rows.value.slice()
  next[i] = { ...next[i], ...patch }
  rows.value = next
  return true
}

export function removeListRow(
  rows: { value: Record<string, unknown>[] },
  id: number,
  idKey = "id",
) {
  const next = rows.value.filter((r) => Number(r[idKey]) !== id)
  if (next.length === rows.value.length) return false
  rows.value = next
  return true
}

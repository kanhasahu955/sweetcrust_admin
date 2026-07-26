import dayjs, { type Dayjs } from "dayjs"

export function money(n?: number | null) {
  if (n == null || Number.isNaN(n)) return "—"
  return `₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`
}

/**
 * API datetimes are UTC. Python `.isoformat()` often omits `Z`, so browsers
 * misread them as local (IST → ~5h skew). Naive ISO → treat as UTC.
 */
export function parseApiDate(raw?: string | Date | Dayjs | null): Dayjs | null {
  if (raw == null || raw === "") return null
  if (dayjs.isDayjs(raw)) return raw.isValid() ? raw : null
  if (raw instanceof Date) {
    const d = dayjs(raw)
    return d.isValid() ? d : null
  }
  const s = String(raw).trim()
  if (!s) return null
  const hasTz = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(s)
  const normalized =
    hasTz ? s
    : /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(s) ? `${s.replace(" ", "T")}Z`
    : s
  const d = dayjs(normalized)
  return d.isValid() ? d : null
}

/** Clock / datetime always in 12-hour AM/PM. */
export function formatTime12(raw?: string | Date | Dayjs | null) {
  if (raw == null || raw === "") return "—"
  const s = String(raw).trim()
  // Bare "HH:mm" / "HH:mm:ss" (shop hours)
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(s)) {
    const d = dayjs(`2000-01-01T${s.length === 5 ? `${s}:00` : s}`)
    return d.isValid() ? d.format("h:mm A") : s
  }
  const d = parseApiDate(s)
  return d ? d.format("h:mm A") : s
}

export function formatDateTime12(raw?: string | Date | Dayjs | null) {
  if (raw == null || raw === "") return "—"
  const d = parseApiDate(raw)
  return d ? d.format("D MMM YYYY · h:mm A") : "—"
}

/**
 * Relative age: minutes → hours (< 24h) → whole days after 24h.
 * e.g. "3 hours ago", "1 day ago", "5 days ago"
 */
export function relativeAgo(raw?: string | Date | Dayjs | null) {
  if (raw == null || raw === "") return "—"
  const d = parseApiDate(raw)
  if (!d) return "—"
  const mins = Math.max(0, dayjs().diff(d, "minute"))
  if (mins < 1) return "just now"
  if (mins < 60) return mins === 1 ? "1 min ago" : `${mins} min ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`
  const days = Math.floor(mins / (60 * 24))
  if (days === 1) return "1 day ago"
  if (days < 30) return `${days} days ago`
  const months = Math.floor(days / 30)
  if (months === 1) return "1 month ago"
  if (months < 12) return `${months} months ago`
  const years = Math.floor(days / 365)
  return years === 1 ? "1 year ago" : `${years} years ago`
}

/**
 * Compact elapsed age for ops queues.
 * Under 24h: `45m`, `3h`, `3h 12m`. From 24h on, days replace hour-blocks:
 * `48h 49m` → `2d 49m`, `25h` → `1d 1h`.
 */
export function elapsedCompact(mins: number) {
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

/** Always 2 decimals — better for invoices / thermal slips. */
export function money2(n?: number | null) {
  if (n == null || Number.isNaN(Number(n))) return "—"
  return `₹${Number(n).toFixed(2)}`
}

/** Google retailer bootstrap uses +91R…; guests use +91GUEST… — never show as a real mobile. */
export function isPlaceholderPhone(phone?: string | null) {
  if (!phone) return true
  const p = String(phone)
  if (/GUEST/i.test(p)) return true
  return p.startsWith("+91R") || p.startsWith("91R") || p.startsWith("+91G")
}

export function displayPhone(phone?: string | null) {
  if (isPlaceholderPhone(phone)) return "—"
  return String(phone)
}

/** Prefer shop WhatsApp/contact; fall back to login phone only if real. */
export function shopContactPhone(s: {
  contact_phone?: string | null
  phone?: string | null
}) {
  if (!isPlaceholderPhone(s.contact_phone)) return String(s.contact_phone)
  if (!isPlaceholderPhone(s.phone)) return String(s.phone)
  return "—"
}

export function shopLoginLabel(s: {
  phone?: string | null
  email?: string | null
}) {
  if (s.email) return String(s.email)
  if (!isPlaceholderPhone(s.phone)) return String(s.phone)
  return "Google account (no phone login)"
}

export function statusLabel(v?: string | null) {
  if (!v) return "—"
  return String(v).replace(/_/g, " ")
}

export function statusClass(v?: string | null) {
  const s = (v || "").toLowerCase()
  // Explicit brand colors so badges stay readable after Nuxt UI token changes
  if (["delivered", "accepted", "payment_received"].includes(s)) return "bg-green-100 text-[#1f6b3a]"
  if (["cancelled", "rejected"].includes(s)) return "bg-red-100 text-[#b42318]"
  if (["packed", "preparing", "out_for_delivery"].includes(s)) return "bg-orange-100 text-honey"
  return "bg-blush/70 text-cocoa"
}

export function apiError(err: unknown) {
  const e = err as {
    data?: { detail?: string | { msg?: string }[]; message?: string }
    message?: string
  }
  const detail = e?.data?.detail
  if (typeof detail === "string" && detail.trim()) return detail
  if (Array.isArray(detail) && detail[0]?.msg) return String(detail[0].msg)
  if (typeof e?.data?.message === "string" && e.data.message.trim()) return e.data.message
  return e?.message || "Something went wrong"
}

export function money(n?: number | null) {
  if (n == null || Number.isNaN(n)) return "—"
  return `₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`
}

/** Google retailer bootstrap uses +91R… — never show as a real mobile. */
export function isPlaceholderPhone(phone?: string | null) {
  if (!phone) return true
  return phone.startsWith("+91R") || phone.startsWith("91R")
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
  const e = err as { data?: { detail?: string }; message?: string }
  return e?.data?.detail || e?.message || "Something went wrong"
}

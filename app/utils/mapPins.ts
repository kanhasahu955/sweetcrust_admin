/** Shared SweetCrust map pin HTML (Google Maps overlays). */

export type PinKind = "hub" | "admin" | "shop" | "customer" | "rider" | "place" | "drop"

const ADMIN_LOGO = "/brand/sweetcrust-logo.png"
const HUB_LOGO = "/brand/sweetcrust-logo.png"

/** Default rider silhouette (data URI) when photo_url missing. */
export const RIDER_FALLBACK_LOGO =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
      <rect width="64" height="64" rx="32" fill="#e8f6ee"/>
      <circle cx="32" cy="24" r="12" fill="#2e7d4f"/>
      <path d="M12 56c4-14 14-20 20-20s16 6 20 20" fill="#2e7d4f"/>
    </svg>`,
  )

export function escHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] || c)
}

/** Turn relative upload paths into absolute URLs for map <img>. */
export function resolveMediaUrl(raw?: string | null, apiBase?: string): string | null {
  const s = String(raw || "").trim()
  if (!s) return null
  if (s.startsWith("data:") || s.startsWith("blob:")) return s
  if (/^https?:\/\//i.test(s)) return s
  if (s.startsWith("//")) return `https:${s}`
  const base = String(apiBase || "").replace(/\/$/, "")
  if (s.startsWith("/") && !s.startsWith("//")) {
    // Local public assets (brand logos) stay on admin origin
    if (s.startsWith("/brand/")) return s
    return base ? `${base}${s}` : s
  }
  return base ? `${base}/${s}` : s
}

export function pickShopLogo(row: Record<string, unknown>, apiBase?: string): string | null {
  return resolveMediaUrl(
    String(row.shop_logo_url || row.logo_url || row.photo_url || row.avatar_url || row.image_url || "").trim() || null,
    apiBase,
  )
}

export function pickRiderLogo(row: Record<string, unknown>, apiBase?: string): string {
  return (
    resolveMediaUrl(
      String(row.photo_url || row.avatar_url || row.image_url || row.rider_photo || "").trim() || null,
      apiBase,
    ) || RIDER_FALLBACK_LOGO
  )
}

export function pickGoogleShopLogo(row: Record<string, unknown>): string | null {
  // Prefer real place photo over generic category icon
  const photo = String(row.photo_url || row.logo_url || "").trim()
  if (photo && !photo.includes("gstatic.com/mapfiles/place_api/icons")) return photo
  const icon = String(row.icon || "").trim()
  return photo || icon || null
}

export function adminLogoUrl(avatar?: string | null): string {
  return resolveMediaUrl(avatar) || ADMIN_LOGO
}

export function hubLogoUrl(): string {
  return HUB_LOGO
}

export function logoPinHtml(opts: {
  kind: PinKind
  src?: string | null
  letter?: string
  selected?: boolean
}) {
  const cls = `sc-dpin sc-dpin-${opts.kind}${opts.selected ? " is-selected" : ""}`
  const letter = escHtml((opts.letter || "?").slice(0, 1).toUpperCase())
  const src = (opts.src || "").trim()
  if (src) {
    return (
      `<span class="${cls}" data-fallback="0">` +
      `<img src="${escHtml(src)}" alt="" referrerpolicy="no-referrer" ` +
      `onerror="this.style.display='none';this.parentElement.dataset.fallback='1'" />` +
      `<i>${letter}</i></span>`
    )
  }
  return `<span class="${cls}" data-fallback="1"><i>${letter}</i></span>`
}

/** Rich hover card for rider / shop / admin pins. */
export function pinTooltipHtml(opts: {
  name: string
  address?: string | null
  rating?: number | string | null
  ratingsTotal?: number | string | null
  phone?: string | null
  openNow?: boolean | null
  city?: string | null
  kindLabel?: string | null
  logo?: string | null
  lines?: Array<string | null | undefined>
}) {
  const name = escHtml(opts.name || "Shop")
  const address = escHtml(String(opts.address || "").trim())
  const phone = escHtml(String(opts.phone || "").trim())
  const city = escHtml(String(opts.city || "").trim())
  const kind = escHtml(String(opts.kindLabel || "").trim())
  const logo = (opts.logo || "").trim()
  const ratingNum = opts.rating != null && opts.rating !== "" ? Number(opts.rating) : NaN
  const rating =
    Number.isFinite(ratingNum)
      ? `★ ${ratingNum.toFixed(1)}${opts.ratingsTotal != null ? ` (${escHtml(String(opts.ratingsTotal))})` : ""}`
      : ""
  const open =
    opts.openNow === true ? `<span class="sc-tip-open">Open now</span>`
    : opts.openNow === false ? `<span class="sc-tip-closed">Closed</span>`
    : ""
  const extra = (opts.lines || [])
    .map((x) => String(x || "").trim())
    .filter(Boolean)
    .map((x) => escHtml(x))

  const thumb = logo
    ? `<img class="sc-tip-logo" src="${escHtml(logo)}" alt="" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'sc-tip-logo sc-tip-logo-fallback',textContent:'${name.slice(0, 1)}'}))" />`
    : `<span class="sc-tip-logo sc-tip-logo-fallback">${name.slice(0, 1)}</span>`

  const metaBits = [rating, phone, city, open, ...extra].filter(Boolean)

  return (
    `<div class="sc-tip">` +
    `<div class="sc-tip-row">${thumb}<div class="sc-tip-body">` +
    `<p class="sc-tip-name">${name}</p>` +
    (kind ? `<p class="sc-tip-kind">${kind}</p>` : "") +
    (address ? `<p class="sc-tip-addr">${address}</p>` : "") +
    (metaBits.length ? `<p class="sc-tip-meta">${metaBits.join(" · ")}</p>` : "") +
    `</div></div></div>`
  )
}

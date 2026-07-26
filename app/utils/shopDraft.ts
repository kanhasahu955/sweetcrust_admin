/** Stash Google Places → shop create form (routing map → /shops). */

export type ShopPlaceDraft = {
  shop_name?: string
  address_line?: string
  village?: string
  zone?: string
  city?: string
  pincode?: string
  latitude?: number | null
  longitude?: number | null
  phone?: string
  contact_phone?: string
  place_id?: string
}

const KEY = "sc_shop_place_draft"

export function stashShopDraft(draft: ShopPlaceDraft) {
  if (import.meta.server) return
  sessionStorage.setItem(KEY, JSON.stringify(draft))
}

export function takeShopDraft(): ShopPlaceDraft | null {
  if (import.meta.server) return null
  const raw = sessionStorage.getItem(KEY)
  if (!raw) return null
  sessionStorage.removeItem(KEY)
  try {
    return JSON.parse(raw) as ShopPlaceDraft
  } catch {
    return null
  }
}

export function placeToDraft(p: Record<string, unknown>): ShopPlaceDraft {
  const name = String(p.name || p.shop_name || "").trim()
  const phone = String(p.phone || p.contact_phone || "").trim()
  return {
    shop_name: name,
    address_line: String(p.address_line || p.label || "").trim(),
    village: String(p.village || p.area || "").trim() || undefined,
    zone: String(p.zone || "").trim() || undefined,
    city: String(p.city || "").trim() || undefined,
    pincode: String(p.pincode || "").trim() || undefined,
    latitude: p.latitude != null ? Number(p.latitude) : null,
    longitude: p.longitude != null ? Number(p.longitude) : null,
    phone: phone || undefined,
    contact_phone: phone || undefined,
    place_id: p.place_id != null ? String(p.place_id) : undefined,
  }
}

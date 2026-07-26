<script setup lang="ts">
/**
 * Live Google Map — logo pins (hub/admin/shops/riders) + brand colors.
 * Add-shop mode: click Google place or drop pin → Places fill → emit pickPlace.
 */
import {
  adminLogoUrl,
  hubLogoUrl,
  logoPinHtml,
  pickGoogleShopLogo,
  pickRiderLogo,
  pickShopLogo,
  pinTooltipHtml,
} from "~/utils/mapPins"

type Pt = [number, number]

const props = defineProps<{
  hub: Pt | null
  admin: Pt | null
  shops: Record<string, unknown>[]
  riders: Record<string, unknown>[]
  customers: Record<string, unknown>[]
  tracks: Record<string, unknown>[]
  route: Record<string, unknown>[]
  selectedOrderId?: number | null
  selectedShopId?: number | null
  selectedRiderId?: number | null
  live?: boolean
  addShopMode?: boolean
  googlePlaces?: Record<string, unknown>[]
  adminName?: string | null
  adminAvatarUrl?: string | null
  layers?: {
    hub?: boolean
    admin?: boolean
    shops?: boolean
    customers?: boolean
    riders?: boolean
    route?: boolean
    google?: boolean
  }
  selectedPlaceId?: string | null
}>()

const runtimeConfig = useRuntimeConfig()
const apiBase = computed(() => String(runtimeConfig.public.apiBase || "").replace(/\/$/, ""))

const emit = defineEmits<{
  selectOrder: [orderId: number]
  selectShop: [shopUserId: number]
  selectRider: [riderId: number]
  pickPlace: [payload: { placeId?: string; lat: number; lng: number }]
}>()

const showGoogle = computed(() => props.layers?.google !== false || !!props.addShopMode)

const { loadGoogleMaps, key: mapsKey } = useGoogleMaps()
const CITY_DEFAULT: Pt = [19.3149, 84.7941]
const mapEl = ref<HTMLElement | null>(null)
const ready = ref(false)
const loadError = ref("")
const counts = ref({ shops: 0, customers: 0, riders: 0, places: 0 })

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let gmaps: any = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let map: any = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let routeLine: any = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pickMarker: any = null
const overlays = new Map<string, { setMap: (m: unknown) => void }>()
let clickListener: { remove: () => void } | null = null
let sizeTimer: ReturnType<typeof setTimeout> | null = null
let fittedOnce = false

function layerOn(key: keyof NonNullable<typeof props.layers>) {
  return props.layers?.[key] !== false
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** India theatre — used for shops/customers. Riders use `any` (simulators often report SF). */
function inIndia(lat: number, lng: number) {
  return lat >= 6 && lat <= 37 && lng >= 68 && lng <= 97
}

function asPoint(latRaw: unknown, lngRaw: unknown, mode: "india" | "any" = "india"): Pt | null {
  let lat = num(latRaw)
  let lng = num(lngRaw)
  if (lat == null || lng == null) return null
  if (Math.abs(lat) < 0.05 && Math.abs(lng) < 0.05) return null
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  const looksInLat = (a: number) => a >= 6 && a <= 37
  const looksInLng = (a: number) => a >= 68 && a <= 97
  // Swap if values look like lng/lat flipped inside India
  if (!looksInLat(lat) && looksInLng(lat) && looksInLat(lng) && !looksInLng(lng)) {
    ;[lat, lng] = [lng, lat]
  }
  if (mode === "india" && !inIndia(lat, lng)) return null
  return [lat, lng]
}

/** HTML overlay marker — logos + brand ring colors + hover tooltip. */
function makeHtmlOverlay(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  maps: any,
  position: { lat: number; lng: number },
  html: string,
  tooltipHtml: string,
  onClick: () => void,
  zIndex = 100,
) {
  class HtmlPin extends maps.OverlayView {
    div: HTMLDivElement | null = null
    pos = position
    pinHtml = html
    tipHtml = tooltipHtml
    constructor() {
      super()
    }
    paint() {
      if (!this.div) return
      this.div.innerHTML =
        `<div class="sc-tip-wrap">${this.tipHtml || ""}</div>` + this.pinHtml
    }
    onAdd() {
      const div = document.createElement("div")
      div.className = "sc-gpin"
      div.style.cursor = "pointer"
      div.style.zIndex = String(zIndex)
      div.addEventListener("click", (e) => {
        e.stopPropagation()
        onClick()
      })
      this.div = div
      this.paint()
      this.getPanes()?.overlayMouseTarget.appendChild(div)
    }
    draw() {
      if (!this.div) return
      const proj = this.getProjection()
      if (!proj) return
      const pt = proj.fromLatLngToDivPixel(new maps.LatLng(this.pos.lat, this.pos.lng))
      if (!pt) return
      this.div.style.left = `${pt.x}px`
      this.div.style.top = `${pt.y}px`
    }
    onRemove() {
      this.div?.remove()
      this.div = null
    }
    setPosition(lat: number, lng: number) {
      this.pos = { lat, lng }
      this.draw()
    }
    setContent(nextHtml: string, nextTip: string) {
      this.pinHtml = nextHtml
      this.tipHtml = nextTip
      this.paint()
    }
  }
  const pin = new HtmlPin()
  pin.setMap(map)
  return pin
}

function clearOverlays() {
  for (const o of overlays.values()) o.setMap(null)
  overlays.clear()
}

function upsertOverlay(
  key: string,
  pt: Pt,
  html: string,
  tooltipHtml: string,
  onClick: () => void,
  zIndex = 100,
) {
  if (!map || !gmaps) return
  const existing = overlays.get(key) as
    | {
        setMap: (m: unknown) => void
        setPosition?: (a: number, b: number) => void
        setContent?: (h: string, t: string) => void
      }
    | undefined
  if (existing?.setPosition && existing.setContent) {
    existing.setPosition(pt[0], pt[1])
    existing.setContent(html, tooltipHtml)
    return
  }
  if (existing) existing.setMap(null)
  overlays.set(
    key,
    makeHtmlOverlay(gmaps.maps, { lat: pt[0], lng: pt[1] }, html, tooltipHtml, onClick, zIndex),
  )
}

function placeKindLabel(types: unknown): string {
  const t = Array.isArray(types) ? types.map((x) => String(x)) : []
  if (t.includes("bakery")) return "Bakery"
  if (t.some((x) => x.includes("sweet") || x === "cafe")) return "Sweets / cafe"
  if (t.includes("store") || t.includes("food")) return "Snack / shop"
  return "Google shop"
}

function fit(points: Pt[]) {
  if (!map || !gmaps) return
  if (points.length >= 2) {
    const bounds = new gmaps.maps.LatLngBounds()
    points.forEach(([lat, lng]) => bounds.extend({ lat, lng }))
    const ne = bounds.getNorthEast()
    const sw = bounds.getSouthWest()
    // Hub in India + simulator GPS in SF spans continents — don't hide the rider.
    if (Math.abs(ne.lat() - sw.lat()) > 2.5 || Math.abs(ne.lng() - sw.lng()) > 2.5) {
      if (props.selectedRiderId) {
        const r = props.riders.find((x) => Number(x.id) === props.selectedRiderId)
        const t = props.tracks.find((x) => Number(x.delivery_person_id) === props.selectedRiderId)
        const pt = asPoint(
          r?.current_lat ?? t?.rider_lat ?? r?.lat,
          r?.current_lng ?? t?.rider_lng ?? r?.lng,
          "any",
        )
        if (pt) {
          map.setCenter({ lat: pt[0], lng: pt[1] })
          map.setZoom(14)
          return
        }
      }
      const local = points.filter(([la, ln]) => inIndia(la, ln))
      if (local.length >= 2) {
        const b2 = new gmaps.maps.LatLngBounds()
        local.forEach(([lat, lng]) => b2.extend({ lat, lng }))
        map.fitBounds(b2, 48)
        return
      }
      if (local.length === 1) {
        map.setCenter({ lat: local[0]![0], lng: local[0]![1] })
        map.setZoom(14)
        return
      }
      // No India points — show the far GPS (e.g. only simulator rider)
      map.fitBounds(bounds, 48)
      return
    }
    map.fitBounds(bounds, 48)
    return
  }
  if (points.length === 1) {
    map.setCenter({ lat: points[0]![0], lng: points[0]![1] })
    map.setZoom(14)
  } else {
    const hub = props.hub || CITY_DEFAULT
    map.setCenter({ lat: hub[0], lng: hub[1] })
    map.setZoom(12)
  }
}

function bindMapClicks() {
  if (!map || !gmaps) return
  clickListener?.remove()
  clickListener = map.addListener(
    "click",
    (e: { latLng?: { lat: () => number; lng: () => number }; placeId?: string; stop?: () => void }) => {
      if (!showGoogle.value && !props.addShopMode) return
      const lat = e.latLng?.lat()
      const lng = e.latLng?.lng()
      if (lat == null || lng == null) return
      if (e.placeId) {
        e.stop?.()
        emit("pickPlace", { placeId: e.placeId, lat, lng })
        return
      }
      if (props.addShopMode) emit("pickPlace", { lat, lng })
    },
  )
}

function render() {
  if (!map || !gmaps || !mapEl.value) return
  const points: Pt[] = []
  const hub = props.hub || CITY_DEFAULT
  const keep = new Set<string>()

  const base = apiBase.value
  const adminLogo = adminLogoUrl(props.adminAvatarUrl)
  const hubLogo = hubLogoUrl()

  if (layerOn("hub")) {
    points.push(hub)
    keep.add("hub")
    upsertOverlay(
      "hub",
      hub,
      logoPinHtml({ kind: "hub", src: hubLogo, letter: "H" }),
      pinTooltipHtml({ name: "SweetCrust hub", kindLabel: "Admin hub", logo: hubLogo }),
      () => {},
      400,
    )
  }

  if (layerOn("admin") && props.admin) {
    points.push(props.admin)
    keep.add("admin")
    const adminName = String(props.adminName || "Admin").trim() || "Admin"
    upsertOverlay(
      "admin",
      props.admin,
      logoPinHtml({ kind: "admin", src: adminLogo, letter: adminName }),
      pinTooltipHtml({
        name: adminName,
        kindLabel: "Admin · live GPS",
        logo: adminLogo,
        lines: ["Your location"],
      }),
      () => {},
      500,
    )
  }

  let shopN = 0
  if (layerOn("shops")) {
    for (const s of props.shops) {
      const id = Number(s.user_id || s.id)
      const pt = asPoint(s.latitude ?? s.lat, s.longitude ?? s.lng)
      if (!id || !pt) continue
      const key = `shop:${id}`
      keep.add(key)
      shopN += 1
      points.push(pt)
      const name = String(s.shop_name || s.name || "Shop")
      const logo = pickShopLogo(s, base)
      const owner = String(s.owner_name || s.name || "").trim()
      upsertOverlay(
        key,
        pt,
        logoPinHtml({
          kind: "shop",
          src: logo,
          letter: name,
          selected: props.selectedShopId === id,
        }),
        pinTooltipHtml({
          name,
          address: String(s.address_line || s.address_display || s.village || "").trim() || null,
          phone: String(s.contact_phone || s.phone || "").trim() || null,
          city: String(s.city || "").trim() || null,
          kindLabel: "Our shop",
          logo,
          lines: [
            owner && owner !== name ? `Owner · ${owner}` : null,
            s.is_wholesaler ? "Wholesaler" : null,
            s.approval_status ? String(s.approval_status) : null,
          ],
        }),
        () => emit("selectShop", id),
        200,
      )
    }
  }

  let custN = 0
  if (layerOn("customers")) {
    for (const c of props.customers) {
      const id = Number(c.order_id || c.id)
      const pt = asPoint(c.lat ?? c.customer_lat, c.lng ?? c.customer_lng)
      if (!id || !pt) continue
      const key = `cust:${id}`
      keep.add(key)
      custN += 1
      points.push(pt)
      const name = String(c.customer_name || c.order_number || "Customer")
      upsertOverlay(
        key,
        pt,
        logoPinHtml({
          kind: "customer",
          letter: name,
          selected: props.selectedOrderId === id,
        }),
        pinTooltipHtml({
          name,
          address: String(c.address || "").trim() || null,
          phone: String(c.customer_phone || "").trim() || null,
          kindLabel: "Customer stop",
          lines: [
            c.order_number ? String(c.order_number) : null,
            c.status ? String(c.status).replace(/_/g, " ") : null,
          ],
        }),
        () => emit("selectOrder", id),
        180,
      )
    }
  }

  const riderPts = new Map<number, { pt: Pt; row: Record<string, unknown> }>()
  if (layerOn("riders")) {
    for (const r of props.riders) {
      const id = Number(r.id)
      // world GPS — iOS Simulator defaults to SF and must still show a pin
      const pt = asPoint(r.current_lat ?? r.lat, r.current_lng ?? r.lng, "any")
      if (!id || !pt) continue
      riderPts.set(id, { pt, row: r })
    }
    for (const t of props.tracks) {
      const id = Number(t.delivery_person_id)
      const pt = asPoint(t.rider_lat ?? t.lat, t.rider_lng ?? t.lng, "any")
      if (!id || !pt) continue
      const baseRow = props.riders.find((x) => Number(x.id) === id) || {}
      riderPts.set(id, { pt, row: { ...baseRow, ...t } })
    }
  }
  let riderN = 0
  for (const [id, { pt, row }] of riderPts) {
    const key = `rider:${id}`
    keep.add(key)
    riderN += 1
    points.push(pt)
    const name = String(row.name || row.rider_name || "Rider")
    const photo = pickRiderLogo(row, base)
    const vehicle = String(row.vehicle_number || "").trim()
    const available = row.is_available === false ? "Off duty" : "Available"
    upsertOverlay(
      key,
      pt,
      logoPinHtml({
        kind: "rider",
        src: photo,
        letter: name,
        selected: props.selectedRiderId === id,
      }),
      pinTooltipHtml({
        name,
        phone: String(row.phone || "").trim() || null,
        kindLabel: "Rider",
        logo: photo,
        lines: [
          vehicle ? `Vehicle · ${vehicle}` : null,
          available,
          row.eta_minutes != null ? `ETA ${row.eta_minutes} min` : null,
          row.distance_km != null ? `${Number(row.distance_km).toFixed(1)} km` : null,
        ],
      }),
      () => emit("selectRider", id),
      300,
    )
  }

  let placeN = 0
  if (showGoogle.value) {
    for (const p of props.googlePlaces || []) {
      const placeId = String(p.place_id || "")
      const pt = asPoint(p.latitude, p.longitude)
      if (!placeId || !pt) continue
      const key = `place:${placeId}`
      keep.add(key)
      placeN += 1
      points.push(pt)
      const name = String(p.name || "Place")
      const logo = pickGoogleShopLogo(p)
      const openNow = p.open_now === true ? true : p.open_now === false ? false : null
      upsertOverlay(
        key,
        pt,
        logoPinHtml({
          kind: "place",
          src: logo,
          letter: name,
          selected: props.selectedPlaceId === placeId,
        }),
        pinTooltipHtml({
          name,
          address: String(p.address_line || p.label || "").trim() || null,
          rating: p.rating as number | null,
          ratingsTotal: p.user_ratings_total as number | null,
          openNow,
          kindLabel: `Google · ${placeKindLabel(p.types)}`,
          logo,
          lines: ["Hover details · click to save"],
        }),
        () => emit("pickPlace", { placeId, lat: pt[0], lng: pt[1] }),
        250,
      )
    }
  }

  for (const [key, o] of overlays) {
    if (!keep.has(key)) {
      o.setMap(null)
      overlays.delete(key)
    }
  }

  counts.value = { shops: shopN, customers: custN, riders: riderN, places: placeN }

  if (layerOn("route") && props.route.length) {
    const path = [{ lat: hub[0], lng: hub[1] }]
    for (const s of props.route) {
      const pt = asPoint(s.lat, s.lng)
      if (pt) {
        path.push({ lat: pt[0], lng: pt[1] })
        points.push(pt)
      }
    }
    if (path.length >= 2) {
      if (!routeLine) {
        routeLine = new gmaps.maps.Polyline({
          path,
          geodesic: true,
          strokeColor: "#e9748e",
          strokeOpacity: 0.9,
          strokeWeight: 4,
          map,
        })
      } else {
        routeLine.setPath(path)
        routeLine.setMap(map)
      }
    }
  } else if (routeLine) {
    routeLine.setMap(null)
    routeLine = null
  }

  map.setOptions({
    clickableIcons: showGoogle.value,
    draggableCursor: props.addShopMode ? "crosshair" : undefined,
  })
  bindMapClicks()

  const shouldFit =
    !fittedOnce
    || props.addShopMode
    || (shopN > 0 && counts.value.shops === 0)
    || (placeN > 0 && counts.value.places === 0)
  if (shouldFit) {
    fit(points.length ? points : [hub])
    fittedOnce = true
  }
  ready.value = true
}

async function boot() {
  if (!import.meta.client || !mapEl.value) return
  loadError.value = ""
  try {
    if (!mapsKey.value) throw new Error("Set NUXT_PUBLIC_GOOGLE_MAPS_API_KEY in admin/.env")
    const g = await loadGoogleMaps()
    gmaps = g
    const hub = props.hub || CITY_DEFAULT
    map = new g.maps.Map(mapEl.value, {
      center: { lat: hub[0], lng: hub[1] },
      zoom: 13,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: true,
      clickableIcons: true,
      styles: [
        { featureType: "poi.business", stylers: [{ visibility: "on" }] },
        { featureType: "poi", elementType: "labels.icon", stylers: [{ visibility: "on" }] },
      ],
    })
    render()
    if (props.selectedRiderId) focusRider(props.selectedRiderId)
    sizeTimer = setTimeout(() => {
      gmaps?.maps.event.trigger(map, "resize")
      if (props.selectedRiderId) focusRider(props.selectedRiderId)
    }, 120)
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : "Map failed"
  }
}

function focusRider(id: number | null | undefined) {
  if (!id || !map) return
  const r = props.riders.find((x) => Number(x.id) === id)
  const t = props.tracks.find((x) => Number(x.delivery_person_id) === id)
  const pt = asPoint(
    r?.current_lat ?? t?.rider_lat ?? r?.lat,
    r?.current_lng ?? t?.rider_lng ?? r?.lng,
    "any",
  )
  if (!pt) return
  map.setCenter({ lat: pt[0], lng: pt[1] })
  map.setZoom(14)
}

watch(
  () => [
    props.hub,
    props.admin,
    props.shops,
    props.riders,
    props.customers,
    props.tracks,
    props.route,
    props.selectedOrderId,
    props.selectedShopId,
    props.selectedRiderId,
    props.layers,
    props.addShopMode,
    props.googlePlaces,
    props.selectedPlaceId,
  ],
  () => {
    if (map && gmaps) render()
  },
  { deep: true },
)

watch(
  () => props.selectedRiderId,
  (id) => {
    nextTick(() => focusRider(id))
  },
)

onMounted(() => {
  void boot()
})

onBeforeUnmount(() => {
  if (sizeTimer) clearTimeout(sizeTimer)
  clickListener?.remove()
  clearOverlays()
  routeLine?.setMap(null)
  pickMarker?.setMap(null)
  map = null
})

defineExpose({
  focus(pt: Pt | null | undefined, zoom = 15) {
    if (pt && map) {
      map.setCenter({ lat: pt[0], lng: pt[1] })
      map.setZoom(zoom)
    }
  },
  invalidate() {
    if (map && gmaps) gmaps.maps.event.trigger(map, "resize")
  },
  dropPick(pt: Pt) {
    if (!map || !gmaps) return
    if (!pickMarker) {
      pickMarker = new gmaps.maps.Marker({
        map,
        position: { lat: pt[0], lng: pt[1] },
        draggable: true,
        icon: {
          path: gmaps.maps.SymbolPath.CIRCLE,
          scale: 10,
          fillColor: "#e9748e",
          fillOpacity: 1,
          strokeColor: "#4a2c2a",
          strokeWeight: 2,
        },
      })
      pickMarker.addListener("dragend", () => {
        const p = pickMarker.getPosition()
        if (p) emit("pickPlace", { lat: p.lat(), lng: p.lng() })
      })
    } else {
      pickMarker.setPosition({ lat: pt[0], lng: pt[1] })
      pickMarker.setMap(map)
    }
    map.panTo({ lat: pt[0], lng: pt[1] })
  },
})
</script>

<template>
  <div class="relative rounded-2xl border border-[var(--line)] bg-[#f3e7e0] shadow-[0_8px_22px_-18px_rgba(74,44,42,0.45)]">
    <div class="flex flex-wrap items-center justify-between gap-2 overflow-hidden rounded-t-2xl border-b border-[var(--line)] bg-[#fff9f5]/95 px-4 py-2.5">
      <div>
        <p class="font-display m-0 text-lg text-chocolate">Live map</p>
        <p class="m-0 text-[0.7rem] text-[var(--muted)]">
          <template v-if="addShopMode">Tap Google shop / drop pin · save to admin</template>
          <template v-else>
            Logos · hover for details
            <span class="ml-1 tabular-nums">
              · {{ counts.shops }} ours · {{ counts.places }} Google · {{ counts.riders }} riders
            </span>
          </template>
        </p>
      </div>
      <span
        class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.65rem] font-semibold"
        :class="addShopMode
          ? 'bg-[#fff0f2] text-[#e9748e]'
          : live ? 'bg-[#e8f6ee] text-[#2e7d4f]' : 'bg-[#f8ede6] text-[var(--muted)]'"
      >
        <span
          class="size-1.5 rounded-full"
          :class="addShopMode ? 'bg-[#e9748e]' : live ? 'animate-pulse bg-success' : 'bg-[#c4a39a]'"
        />
        {{ addShopMode ? "Pick shop" : live ? "GPS live" : "Google 30km" }}
      </span>
    </div>
    <div class="relative overflow-visible rounded-b-2xl">
      <div ref="mapEl" class="h-[min(56vh,460px)] w-full min-h-[300px] overflow-visible rounded-b-2xl" />
      <p
        v-if="loadError"
        class="absolute inset-x-0 top-[45%] -translate-y-1/2 px-4 text-center text-sm text-danger"
      >
        {{ loadError }}
      </p>
      <p
        v-else-if="!ready"
        class="pointer-events-none absolute inset-x-0 top-[45%] -translate-y-1/2 text-center text-sm text-[var(--muted)]"
      >
        Loading Google Map…
      </p>
    </div>
  </div>
</template>

<!-- pin chrome: assets/css/map-pins.css -->

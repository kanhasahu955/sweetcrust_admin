<script setup lang="ts">
import { statusLabel } from "~/utils/format"
import { logoPinHtml } from "~/utils/mapPins"

const props = defineProps<{
  orderId: number
  order: Record<string, unknown> | null
}>()

type Alert = { id: string; text: string; at: number; tone: "info" | "ok" | "warn" }
type Pt = [number, number]

/** Odisha / east-coast ops default — Berhampur city center */
const CITY_DEFAULT: Pt = [19.3149, 84.7941]
const CITY_ZOOM = 14

const api = useApi()
const { connect, joinOrder } = useSocket()
const { loadGoogleMaps, key: mapsKey } = useGoogleMaps()
const socketLive = useState("adminSocketLive", () => false)

const mapEl = ref<HTMLElement | null>(null)
const ready = ref(false)
const loadError = ref("")
const eta = ref<number | null>(null)
const distanceKm = ref<number | null>(null)
const riderId = ref<number | null>(null)
const lastPingAt = ref<number | null>(null)
const alerts = ref<Alert[]>([])
const path = ref<Pt[]>([])
const bakery = ref<Pt | null>(null)
const drop = ref<Pt | null>(null)
const rider = ref<Pt | null>(null)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let gmaps: any = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let map: any = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let coveredLine: any = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let plannedLine: any = null
const overlays = new Map<string, { setMap: (m: unknown) => void; setPosition?: (a: number, b: number) => void; setHtml?: (h: string) => void }>()
let pollTimer: ReturnType<typeof setInterval> | null = null
let sizeTimer: ReturnType<typeof setTimeout> | null = null
let boundSocket: ReturnType<typeof connect> = null
let booted = false

const STAGES = [
  "placed",
  "accepted",
  "preparing",
  "packed",
  "delivery_assigned",
  "picked_up",
  "out_for_delivery",
  "near_location",
  "delivered",
] as const

function num(v: unknown): number | null {
  if (v == null || v === "") return null
  const n = typeof v === "string" ? Number(v.trim()) : Number(v)
  return Number.isFinite(n) ? n : null
}

function asPoint(latRaw: unknown, lngRaw: unknown): Pt | null {
  let lat = num(latRaw)
  let lng = num(lngRaw)
  if (lat == null || lng == null) return null
  if (Math.abs(lat) < 0.05 && Math.abs(lng) < 0.05) return null
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  const looksInLat = (a: number) => a >= 6 && a <= 37
  const looksInLng = (a: number) => a >= 68 && a <= 97
  if (!looksInLat(lat) && looksInLng(lat) && looksInLat(lng) && !looksInLng(lng)) {
    ;[lat, lng] = [lng, lat]
  }
  const inOdishaBelt = lat >= 17.5 && lat <= 22.5 && lng >= 81.5 && lng <= 87.5
  const inIndia = lat >= 6 && lat <= 37 && lng >= 68 && lng <= 97
  if (!inIndia && !inOdishaBelt) return null
  return [lat, lng]
}

function pushAlert(text: string, tone: Alert["tone"] = "info") {
  alerts.value = [
    { id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, text, at: Date.now(), tone },
    ...alerts.value,
  ].slice(0, 24)
}

function addrCoords(order: Record<string, unknown> | null): Pt | null {
  const snap = (order?.address_snapshot || {}) as Record<string, unknown>
  const nested = (snap.location || snap.coords || snap.coordinates || {}) as Record<string, unknown>
  return (
    asPoint(snap.latitude ?? snap.lat, snap.longitude ?? snap.lng)
    || asPoint(nested.latitude ?? nested.lat, nested.longitude ?? nested.lng)
    || asPoint(nested[1], nested[0])
  )
}

function cityFallback(order: Record<string, unknown> | null): Pt {
  const snap = (order?.address_snapshot || {}) as Record<string, unknown>
  const blob = [
    snap.city,
    snap.area,
    snap.locality,
    snap.line1,
    snap.address_line1,
    snap.pincode,
    snap.pin,
  ]
    .map((x) => String(x || "").toLowerCase())
    .join(" ")
  if (blob.includes("761009") || blob.includes("berhampur") || blob.includes("brahmapur") || blob.includes("surala")) {
    return CITY_DEFAULT
  }
  if (blob.includes("bhubaneswar") || blob.includes("7510")) return [20.2961, 85.8245]
  return CITY_DEFAULT
}

function applyTrack(t: Record<string, unknown>) {
  const hub = asPoint(t.bakery_lat, t.bakery_lng)
  if (hub) bakery.value = hub
  const cust = asPoint(t.customer_lat, t.customer_lng)
  if (cust) drop.value = cust
  const ride = asPoint(t.rider_lat ?? t.lat, t.rider_lng ?? t.lng)
  if (ride) {
    rider.value = ride
    appendPath(ride[0], ride[1])
  }
  if (t.eta_minutes != null) eta.value = Number(t.eta_minutes)
  if (t.distance_km != null) distanceKm.value = Number(t.distance_km)
  if (t.delivery_person_id != null) riderId.value = Number(t.delivery_person_id)
  if (typeof t.route_polyline === "string" && t.route_polyline.trim().startsWith("[")) {
    try {
      const pts = JSON.parse(t.route_polyline) as unknown
      if (Array.isArray(pts) && pts.length) {
        const parsed = pts
          .map((p) => {
            if (!Array.isArray(p) || p.length < 2) return null
            return asPoint(p[0], p[1]) || asPoint(p[1], p[0])
          })
          .filter((p): p is Pt => p != null)
        if (parsed.length) path.value = parsed
      }
    } catch {
      /* ignore */
    }
  }
}

function appendPath(lat: number, lng: number) {
  const pt = asPoint(lat, lng)
  if (!pt) return
  const last = path.value[path.value.length - 1]
  if (last && Math.abs(last[0] - pt[0]) < 1e-6 && Math.abs(last[1] - pt[1]) < 1e-6) return
  path.value = [...path.value, pt].slice(-200)
}

function ensureLocalAnchors() {
  const fromAddr = addrCoords(props.order)
  if (!drop.value && fromAddr) drop.value = fromAddr
  if (!drop.value) drop.value = cityFallback(props.order)
  if (!bakery.value) {
    bakery.value = [drop.value[0] + 0.012, drop.value[1] - 0.008]
  }
  const st = String(props.order?.status || "").toLowerCase()
  if (!rider.value && (st === "delivered" || st === "out_for_delivery" || st === "near_location" || st === "picked_up")) {
    rider.value = bakery.value
  }
}

function makeHtmlOverlay(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  maps: any,
  position: { lat: number; lng: number },
  html: string,
  title: string,
  zIndex = 100,
) {
  class HtmlPin extends maps.OverlayView {
    div: HTMLDivElement | null = null
    pos = position
    onAdd() {
      const div = document.createElement("div")
      div.className = "sc-gpin"
      div.title = title
      div.innerHTML = html
      div.style.zIndex = String(zIndex)
      this.div = div
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
    setHtml(next: string) {
      if (this.div) this.div.innerHTML = next
    }
  }
  const pin = new HtmlPin()
  pin.setMap(map)
  return pin
}

function upsertOverlay(key: string, pt: Pt, html: string, title: string, zIndex = 100) {
  if (!map || !gmaps) return
  const existing = overlays.get(key)
  if (existing?.setPosition && existing.setHtml) {
    existing.setPosition(pt[0], pt[1])
    existing.setHtml(html)
    return
  }
  existing?.setMap(null)
  overlays.set(key, makeHtmlOverlay(gmaps.maps, { lat: pt[0], lng: pt[1] }, html, title, zIndex))
}

function focusCity(points: Pt[]) {
  if (!map || !gmaps) return
  if (points.length >= 2) {
    const bounds = new gmaps.maps.LatLngBounds()
    points.forEach(([lat, lng]) => bounds.extend({ lat, lng }))
    const ne = bounds.getNorthEast()
    const sw = bounds.getSouthWest()
    if (Math.abs(ne.lat() - sw.lat()) > 0.8 || Math.abs(ne.lng() - sw.lng()) > 0.8) {
      const c = drop.value || CITY_DEFAULT
      map.setCenter({ lat: c[0], lng: c[1] })
      map.setZoom(CITY_ZOOM)
      return
    }
    map.fitBounds(bounds, 56)
    return
  }
  if (points.length === 1) {
    map.setCenter({ lat: points[0]![0], lng: points[0]![1] })
    map.setZoom(CITY_ZOOM)
    return
  }
  map.setCenter({ lat: CITY_DEFAULT[0], lng: CITY_DEFAULT[1] })
  map.setZoom(CITY_ZOOM)
}

function renderMap() {
  if (!map || !gmaps || !mapEl.value) return
  ensureLocalAnchors()
  const points: Pt[] = []
  if (bakery.value) {
    points.push(bakery.value)
    upsertOverlay(
      "hub",
      bakery.value,
      logoPinHtml({ kind: "hub", src: "/brand/sweetcrust-logo.png", letter: "H" }),
      "Hub",
      400,
    )
  }
  if (drop.value) {
    points.push(drop.value)
    upsertOverlay(
      "drop",
      drop.value,
      logoPinHtml({ kind: "drop", letter: "C" }),
      "Customer",
      300,
    )
  }
  if (rider.value) {
    points.push(rider.value)
    upsertOverlay(
      "rider",
      rider.value,
      logoPinHtml({ kind: "rider", letter: "R" }),
      "Rider",
      500,
    )
  }
  path.value.forEach((p) => points.push(p))

  if (bakery.value && drop.value) {
    const planned = [
      { lat: bakery.value[0], lng: bakery.value[1] },
      { lat: drop.value[0], lng: drop.value[1] },
    ]
    if (!plannedLine) {
      plannedLine = new gmaps.maps.Polyline({
        path: planned,
        geodesic: true,
        strokeColor: "#9a7b72",
        strokeOpacity: 0.55,
        strokeWeight: 3,
        map,
        icons: [{ icon: { path: "M 0,-1 0,1", strokeOpacity: 1, scale: 3 }, offset: "0", repeat: "14px" }],
      })
    } else {
      plannedLine.setPath(planned)
      plannedLine.setMap(map)
    }
  }

  if (path.value.length >= 2) {
    const covered = path.value.map(([lat, lng]) => ({ lat, lng }))
    if (!coveredLine) {
      coveredLine = new gmaps.maps.Polyline({
        path: covered,
        geodesic: true,
        strokeColor: "#e9748e",
        strokeOpacity: 0.9,
        strokeWeight: 5,
        map,
      })
    } else {
      coveredLine.setPath(covered)
      coveredLine.setMap(map)
    }
  }

  focusCity(points)
  if (sizeTimer) clearTimeout(sizeTimer)
  sizeTimer = setTimeout(() => {
    gmaps?.maps.event.trigger(map, "resize")
    focusCity(points)
  }, 80)
  ready.value = true
}

async function bootMap() {
  if (!import.meta.client || !mapEl.value || booted) return
  loadError.value = ""
  try {
    if (!mapsKey.value) throw new Error("Set NUXT_PUBLIC_GOOGLE_MAPS_API_KEY")
    const g = await loadGoogleMaps()
    gmaps = g
    map = new g.maps.Map(mapEl.value, {
      center: { lat: CITY_DEFAULT[0], lng: CITY_DEFAULT[1] },
      zoom: CITY_ZOOM,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: true,
      clickableIcons: false,
    })
    booted = true
    renderMap()
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : "Map failed"
  }
}

async function loadTrack() {
  try {
    const live = await api.admin.liveDelivery()
    const rows = Array.isArray(live)
      ? live
      : Array.isArray((live as { active?: unknown[] })?.active)
        ? ((live as { active: unknown[] }).active)
        : []
    const hit = (rows as Record<string, unknown>[]).find((r) => Number(r.order_id) === props.orderId)
    if (hit) applyTrack(hit)
  } catch {
    /* ignore */
  }
  ensureLocalAnchors()
  await nextTick()
  if (!booted) await bootMap()
  else renderMap()
}

function destroyMap() {
  if (sizeTimer) clearTimeout(sizeTimer)
  for (const o of overlays.values()) o.setMap(null)
  overlays.clear()
  coveredLine?.setMap(null)
  plannedLine?.setMap(null)
  coveredLine = plannedLine = null
  map = null
  gmaps = null
  booted = false
  ready.value = false
}

const stageIndex = computed(() => {
  const st = String(props.order?.status || "").toLowerCase()
  const idx = STAGES.indexOf(st as (typeof STAGES)[number])
  return idx >= 0 ? idx : 0
})

const statusHeadline = computed(() => {
  const st = String(props.order?.status || "").toLowerCase()
  if (st === "out_for_delivery" || st === "near_location") {
    return eta.value != null ? `Rider en route · ETA ${eta.value} min` : "Rider en route"
  }
  if (st === "picked_up" || st === "delivery_assigned") return "Rider assigned"
  if (st === "delivered") return "Delivered"
  if (st === "packed") return "Packed — awaiting rider"
  if (!rider.value) return "Waiting for live GPS"
  return statusLabel(st)
})

function ago(ts: number) {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000))
  if (s < 5) return "now"
  if (s < 60) return `${s}s`
  return `${Math.round(s / 60)}m`
}

function onLoc(data: Record<string, unknown>) {
  if (Number(data.order_id) !== props.orderId) return
  lastPingAt.value = Date.now()
  applyTrack({
    rider_lat: data.lat ?? data.rider_lat,
    rider_lng: data.lng ?? data.rider_lng,
    eta_minutes: data.eta_minutes,
    distance_km: data.distance_km,
    delivery_person_id: data.delivery_person_id,
  })
  ensureLocalAnchors()
  if (data.eta_minutes != null) pushAlert(`Location update · ETA ${data.eta_minutes} min`, "ok")
  else pushAlert("Rider location updated", "info")
  renderMap()
}

function onStatus(data: Record<string, unknown>) {
  if (Number(data.order_id) !== props.orderId) return
  const st = String(data.status || data.order_status || "").replace(/_/g, " ")
  pushAlert(`Status · ${st}`, "warn")
  void loadTrack()
}

function bindSocket() {
  const s = connect()
  boundSocket = s
  if (!s) return
  joinOrder(props.orderId)
  s.on("delivery_location", onLoc)
  s.on("order_status", onStatus)
}

function unbindSocket() {
  boundSocket?.off("delivery_location", onLoc)
  boundSocket?.off("order_status", onStatus)
  boundSocket = null
}

watch(
  () => props.orderId,
  async (id) => {
    unbindSocket()
    destroyMap()
    path.value = []
    alerts.value = []
    bakery.value = null
    drop.value = null
    rider.value = null
    eta.value = null
    distanceKm.value = null
    lastPingAt.value = null
    if (!id) return
    pushAlert(`Tracking order #${id}`, "info")
    await nextTick()
    await loadTrack()
    bindSocket()
  },
  { immediate: true },
)

watch(
  () => props.order?.status,
  (st, prev) => {
    if (st && st !== prev) pushAlert(`Order · ${statusLabel(String(st))}`, "warn")
  },
)

onMounted(() => {
  pollTimer = setInterval(() => {
    void loadTrack()
  }, 20000)
})

onBeforeUnmount(() => {
  unbindSocket()
  destroyMap()
  if (pollTimer) clearInterval(pollTimer)
})
</script>

<template>
  <div class="overflow-hidden rounded-2xl border border-[var(--line)] bg-white shadow-[var(--shadow-md)]">
    <div class="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] bg-gradient-to-r from-[#fff9f5] to-[#fff0f2] px-4 py-3">
      <div class="min-w-0">
        <p class="truncate text-base font-semibold text-chocolate">{{ statusHeadline }}</p>
        <p class="mt-0.5 text-[0.72rem] text-[var(--muted)]">
          <span :class="socketLive ? 'font-semibold text-success' : ''">{{ socketLive ? "● Live" : "○ Offline" }}</span>
          <span v-if="lastPingAt"> · GPS {{ ago(lastPingAt) }} ago</span>
          <span v-if="riderId"> · Rider #{{ riderId }}</span>
          <span v-if="distanceKm != null"> · {{ distanceKm.toFixed(1) }} km</span>
        </p>
      </div>
      <div class="flex flex-wrap gap-1.5">
        <span class="rounded-full bg-white px-2.5 py-1 text-[0.65rem] font-semibold text-chocolate ring-1 ring-[var(--line)]">Hub</span>
        <span class="rounded-full bg-[#ffe8ec] px-2.5 py-1 text-[0.65rem] font-semibold text-[#c44d66]">Rider</span>
        <span class="rounded-full bg-[#e8f6ee] px-2.5 py-1 text-[0.65rem] font-semibold text-[#2e7d4f]">Drop</span>
      </div>
    </div>

    <div class="overflow-x-auto border-b border-[var(--line)] px-3 py-2.5">
      <div class="flex min-w-max items-center gap-1">
        <template v-for="(s, i) in STAGES" :key="s">
          <span
            class="shrink-0 rounded-full px-2.5 py-1 text-[0.65rem] font-semibold capitalize transition"
            :class="i < stageIndex
              ? 'bg-[#e9748e] text-white'
              : i === stageIndex
                ? 'bg-[#e9748e] text-white shadow-[0_0_0_3px_rgba(233,116,142,0.22)]'
                : 'bg-[#fff9f5] text-[var(--muted)]'"
          >
            {{ statusLabel(s) }}
          </span>
          <span v-if="i < STAGES.length - 1" class="h-px w-3 shrink-0 bg-[#e8d0c6]" />
        </template>
      </div>
    </div>

    <div class="relative">
      <div ref="mapEl" class="h-[340px] w-full bg-[#f3e7e0] sm:h-[400px]" />
      <div
        v-if="loadError"
        class="absolute inset-0 grid place-items-center bg-[#fff9f5]/90 px-4 text-center text-xs text-danger"
      >
        {{ loadError }}
      </div>
      <div
        v-else-if="!ready"
        class="absolute inset-0 grid place-items-center bg-[#fff9f5]/80 text-xs text-[var(--muted)]"
      >
        Loading Google Map…
      </div>
      <div
        v-if="eta != null"
        class="absolute bottom-3 left-3 rounded-2xl bg-white/95 px-3 py-2 text-xs font-semibold text-chocolate shadow-md ring-1 ring-[var(--line)] backdrop-blur"
      >
        ETA {{ eta }} min
        <span v-if="distanceKm != null" class="font-normal text-[var(--muted)]"> · {{ distanceKm.toFixed(1) }} km</span>
      </div>
    </div>

    <ul class="max-h-40 space-y-0 overflow-y-auto border-t border-[var(--line)]">
      <li
        v-for="a in alerts"
        :key="a.id"
        class="flex items-start gap-2 border-b border-[var(--line)] px-4 py-2.5 text-xs last:border-b-0"
      >
        <span
          class="mt-0.5 size-1.5 shrink-0 rounded-full"
          :class="{
            'bg-[#e9748e]': a.tone === 'info',
            'bg-success': a.tone === 'ok',
            'bg-[#ff8a65]': a.tone === 'warn',
          }"
        />
        <span class="min-w-0 flex-1 text-chocolate">{{ a.text }}</span>
        <span class="shrink-0 tabular-nums text-[var(--muted)]">{{ ago(a.at) }}</span>
      </li>
      <li v-if="!alerts.length" class="px-4 py-5 text-center text-xs text-[var(--muted)]">
        Waiting for live updates…
      </li>
    </ul>
  </div>
</template>

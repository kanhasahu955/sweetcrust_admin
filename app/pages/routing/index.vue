<script setup lang="ts">
import dayjs from "dayjs"
import {
  apiError,
  displayPhone,
  elapsedCompact,
  money,
  parseApiDate,
  relativeAgo,
  statusLabel,
} from "~/utils/format"
import { placeToDraft, stashShopDraft } from "~/utils/shopDraft"
type Stop = Record<string, unknown>
type LiveTrack = Record<string, unknown>
type Pt = [number, number]

const api = useApi()
const router = useRouter()
const toast = useAppToast()
const auth = useAuthStore()
const { connect } = useSocket()
const socketLive = useState("adminSocketLive", () => false)
const dashboardBump = useState("adminDashboardBump", () => 0)

const adminName = computed(() => String(auth.user?.name || "Admin"))
const adminAvatarUrl = computed(() => {
  const u = auth.user as { avatar_url?: string | null; photo_url?: string | null } | null
  return String(u?.avatar_url || u?.photo_url || "").trim() || null
})

const loading = ref(true)
const refreshing = ref(false)
const busy = ref(false)
const error = ref("")
const stops = ref<Stop[]>([])
const live = ref<LiveTrack[]>([])
const route = ref<Stop[]>([])
const totalKm = ref(0)
const riders = ref<Record<string, unknown>[]>([])
const shops = ref<Record<string, unknown>[]>([])
const hub = ref<Pt | null>(null)
const adminPt = ref<Pt | null>(null)
const adminGeoOk = ref(false)
const search = ref("")
const statusFilter = ref("")
const selectedIds = ref<number[]>([])
const assignForm = reactive({ order_id: 0, delivery_person_id: 0 })
const focusShopId = ref(0)
const etaResult = ref<Record<string, unknown> | null>(null)
const nowTick = ref(Date.now())
const addShopMode = ref(false)
const googlePlaces = ref<Record<string, unknown>[]>([])
const placeBusy = ref(false)
const googleLoading = ref(false)
const selectedPlace = ref<Record<string, unknown> | null>(null)
const mapRef = ref<{
  focus: (pt: Pt | null, zoom?: number) => void
  invalidate: () => void
  dropPick?: (pt: Pt) => void
} | null>(null)

const layers = reactive({
  hub: true,
  admin: true,
  shops: true,
  customers: true,
  riders: true,
  route: true,
  google: true,
})

const selectedPlaceId = computed(() =>
  selectedPlace.value?.place_id != null ? String(selectedPlace.value.place_id) : null,
)

let liveSocket: ReturnType<typeof connect> = null
let pollId: number | undefined
let tickTimer: ReturnType<typeof setInterval> | null = null
let refreshTimer: ReturnType<typeof setTimeout> | null = null
let geoWatch: number | null = null

const statusTabs = [
  { label: "All", value: "" },
  { label: "Packed", value: "packed" },
  { label: "Assigned", value: "delivery_assigned" },
  { label: "Out", value: "out_for_delivery" },
]

const shopsOnMap = computed(() =>
  shops.value.filter((s) => Number.isFinite(Number(s.latitude)) && Number.isFinite(Number(s.longitude))),
)

const filteredStops = computed(() => {
  const q = search.value.trim().toLowerCase()
  return stops.value.filter((s) => {
    const st = String(s.status || "").toLowerCase()
    if (statusFilter.value && st !== statusFilter.value) return false
    if (!q) return true
    const blob = [
      s.order_number,
      s.status,
      s.customer_name,
      s.customer_phone,
      s.address,
      s.rider_name,
      s.delivery_slot,
    ]
      .map((x) => String(x || "").toLowerCase())
      .join(" ")
    return blob.includes(q)
  })
})

const statusCounts = computed(() => {
  const c: Record<string, number> = { all: stops.value.length }
  for (const t of statusTabs) {
    if (!t.value) continue
    c[t.value] = stops.value.filter((s) => String(s.status || "").toLowerCase() === t.value).length
  }
  return c
})

const selectedStop = computed(() =>
  stops.value.find((s) => Number(s.order_id) === assignForm.order_id) || null,
)

const gpsLiveCount = computed(() => {
  const fromTracks = live.value.filter((t) => t.rider_lat != null && t.rider_lng != null).length
  const fromRiders = riders.value.filter((r) => r.current_lat != null && r.current_lng != null).length
  return Math.max(fromTracks, fromRiders)
})

watch(dashboardBump, () => scheduleRefresh())

function scheduleRefresh() {
  if (refreshTimer) clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => {
    void load({ quiet: true })
  }, 350)
}

function asPt(lat: unknown, lng: unknown): Pt | null {
  const a = Number(lat)
  const b = Number(lng)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  if (Math.abs(a) < 0.05 && Math.abs(b) < 0.05) return null
  return [a, b]
}

function riderLabel(row: { rider_name?: unknown; rider_phone?: unknown; name?: unknown; phone?: unknown; delivery_person_id?: unknown; id?: unknown } | null | undefined) {
  if (!row) return "No rider"
  const name = String(row.rider_name || row.name || "").trim()
  const phone = displayPhone(String(row.rider_phone || row.phone || ""))
  if (name && phone !== "—") return `${name} · ${phone}`
  if (name) return name
  const id = row.delivery_person_id ?? row.id
  if (!id) return "No rider"
  const r = riders.value.find((x) => Number(x.id) === Number(id))
  return r ? String(r.name || r.phone || "Rider") : "No rider"
}

function customerLabel(s: Stop) {
  const name = String(s.customer_name || "").trim()
  const phone = displayPhone(String(s.customer_phone || ""))
  if (name && phone !== "—") return `${name} · ${phone}`
  if (name) return name
  if (phone !== "—") return phone
  return "Guest customer"
}

function stopTitle(s: Stop) {
  return String(s.customer_name || s.order_number || "Stop").trim()
}

function ageOf(raw: unknown) {
  void nowTick.value
  const d = parseApiDate(raw != null ? String(raw) : null)
  if (!d) return "—"
  return elapsedCompact(dayjs().diff(d, "minute"))
}

function slotOf(s: Stop) {
  const slot = String(s.delivery_slot || "").trim()
  const date = s.delivery_date ? String(s.delivery_date).slice(0, 10) : ""
  if (slot && date) return `${date} · ${slot}`
  return slot || date || "ASAP"
}

function toggleSelect(id: number) {
  const i = selectedIds.value.indexOf(id)
  if (i >= 0) selectedIds.value = selectedIds.value.filter((x) => x !== id)
  else selectedIds.value = [...selectedIds.value, id]
}

function selectStop(s: Stop) {
  const id = Number(s.order_id)
  assignForm.order_id = id
  if (s.delivery_person_id) assignForm.delivery_person_id = Number(s.delivery_person_id)
  void checkEta(id)
  const pt = asPt(s.lat, s.lng)
  nextTick(() => mapRef.value?.focus(pt))
}

function onMapSelectOrder(orderId: number) {
  const s = stops.value.find((x) => Number(x.order_id) === orderId)
    || live.value.find((x) => Number(x.order_id) === orderId)
  if (s) selectStop(s as Stop)
  else {
    assignForm.order_id = orderId
    void checkEta(orderId)
  }
}

function onMapSelectShop(shopUserId: number) {
  focusShopId.value = shopUserId
  const s = shops.value.find((x) => Number(x.user_id) === shopUserId)
  const pt = s ? asPt(s.latitude, s.longitude) : null
  mapRef.value?.focus(pt)
}

function onMapSelectRider(riderId: number) {
  assignForm.delivery_person_id = riderId
  const r = riders.value.find((x) => Number(x.id) === riderId)
  const track = live.value.find((t) => Number(t.delivery_person_id) === riderId)
  const pt = asPt(track?.rider_lat ?? r?.current_lat, track?.rider_lng ?? r?.current_lng)
  mapRef.value?.focus(pt)
}

function focusShopFromSelect() {
  if (!focusShopId.value) return
  onMapSelectShop(focusShopId.value)
}

async function loadNearbyPlaces(center?: Pt | null) {
  const c = center || adminPt.value || hub.value || ([19.3149, 84.7941] as Pt)
  googleLoading.value = true
  try {
    const rows = await api.geo.nearby(c[0], c[1], 30000, 60)
    googlePlaces.value = Array.isArray(rows) ? rows : []
  } catch {
    googlePlaces.value = []
  } finally {
    googleLoading.value = false
  }
}

function onLayerToggle(key: keyof typeof layers) {
  layers[key] = !layers[key]
  if (key === "google" && layers.google && !googlePlaces.value.length) {
    void loadNearbyPlaces()
  }
}

async function toggleAddShopMode() {
  addShopMode.value = !addShopMode.value
  layers.google = true
  if (addShopMode.value) {
    toast.info("Tap a Google bakery / snack shop — then Save")
    if (!googlePlaces.value.length) await loadNearbyPlaces()
  }
}

async function onPickPlace(payload: { placeId?: string; lat: number; lng: number }) {
  placeBusy.value = true
  try {
    mapRef.value?.dropPick?.([payload.lat, payload.lng])
    mapRef.value?.focus([payload.lat, payload.lng], 15)
    let details: Record<string, unknown> | null = null
    if (payload.placeId) {
      details = await api.geo.place(payload.placeId)
      // Keep list pin even if details thin
      const preview = googlePlaces.value.find((p) => String(p.place_id) === payload.placeId)
      if (preview) details = { ...preview, ...(details || {}) }
    } else {
      details = await api.geo.reverse(payload.lat, payload.lng)
    }
    if (!details) {
      details = {
        latitude: payload.lat,
        longitude: payload.lng,
        address_line: `${payload.lat.toFixed(5)}, ${payload.lng.toFixed(5)}`,
      }
    }
    if (details.latitude == null) details.latitude = payload.lat
    if (details.longitude == null) details.longitude = payload.lng
    selectedPlace.value = details
    if (addShopMode.value) {
      // stay on panel — user confirms Save
    }
  } catch (e) {
    toast.error(apiError(e))
  } finally {
    placeBusy.value = false
  }
}

function saveSelectedPlace() {
  if (!selectedPlace.value) return
  const draft = placeToDraft(selectedPlace.value)
  stashShopDraft(draft)
  toast.success(draft.shop_name || "Ready to save")
  void router.push({ path: "/shops", query: { create: "1" } })
}

function pickHub(settings: Record<string, unknown> | null, shopRows: Record<string, unknown>[]) {
  const fromSettings = settings ? asPt(settings.latitude, settings.longitude) : null
  const shopPts = shopRows
    .map((s) => asPt(s.latitude, s.longitude))
    .filter((p): p is Pt => !!p)

  // Seeded Mumbai hub (Andheri) with Odisha shops → prefer shop centroid / Berhampur
  const isMumbaiSeed = fromSettings
    && Math.abs(fromSettings[0] - 19.12) < 0.08
    && Math.abs(fromSettings[1] - 72.85) < 0.08

  if (shopPts.length && (isMumbaiSeed || !fromSettings)) {
    const lat = shopPts.reduce((n, p) => n + p[0], 0) / shopPts.length
    const lng = shopPts.reduce((n, p) => n + p[1], 0) / shopPts.length
    return [lat, lng] as Pt
  }
  return fromSettings || ([19.3149, 84.7941] as Pt)
}

async function load(opts?: { quiet?: boolean }) {
  if (opts?.quiet) refreshing.value = true
  else loading.value = true
  error.value = ""
  try {
    const [s, l, r, shopRows, settings] = await Promise.all([
      api.admin.routingStops(),
      api.admin.routingLive(),
      api.admin.deliveryPersons(),
      api.admin.shops().catch(() => []),
      api.admin.settings().catch(() => null),
    ])
    stops.value = Array.isArray(s) ? s : []
    live.value = Array.isArray(l) ? (l as LiveTrack[]) : []
    // Normalize riders — API may return array or { items }
    const rawRiders = Array.isArray(r) ? r : (r as { items?: unknown[] })?.items
    riders.value = Array.isArray(rawRiders) ? (rawRiders as Record<string, unknown>[]) : []
    const rawShops = Array.isArray(shopRows) ? shopRows : (shopRows as { items?: unknown[] })?.items
    shops.value = Array.isArray(rawShops) ? (rawShops as Record<string, unknown>[]) : []
    hub.value = pickHub(settings as Record<string, unknown> | null, shops.value)
    if (layers.google && !opts?.quiet) {
      void loadNearbyPlaces(hub.value)
    } else if (layers.google && opts?.quiet && !googlePlaces.value.length) {
      void loadNearbyPlaces(hub.value)
    }
  } catch (e) {
    error.value = apiError(e)
  } finally {
    loading.value = false
    refreshing.value = false
  }
}

async function optimize() {
  busy.value = true
  error.value = ""
  try {
    const ids = selectedIds.value.length ? selectedIds.value : undefined
    const res = await api.admin.routingOptimize(ids)
    route.value = Array.isArray(res.route) ? res.route : []
    totalKm.value = Number(res.total_km) || 0
    toast.success(
      "Route optimized",
      `${res.stops || 0} stops · ${totalKm.value} km${ids ? " (selected)" : ""}`,
    )
    nextTick(() => mapRef.value?.invalidate())
  } catch (e) {
    error.value = apiError(e)
    toast.error("Optimize failed", apiError(e))
  } finally {
    busy.value = false
  }
}

async function checkEta(orderId: number) {
  if (!orderId) return
  try {
    etaResult.value = await api.admin.routingEta(orderId)
  } catch (e) {
    error.value = apiError(e)
  }
}

async function assign() {
  if (!assignForm.order_id || !assignForm.delivery_person_id) {
    toast.error("Missing fields", "Pick a stop and a rider")
    return
  }
  busy.value = true
  error.value = ""
  try {
    await api.admin.routingAssign(assignForm.order_id, assignForm.delivery_person_id)
    toast.success(
      "Assigned",
      `${stopTitle(selectedStop.value || {})} → ${riderLabel({ delivery_person_id: assignForm.delivery_person_id })}`,
    )
    await load({ quiet: true })
  } catch (e) {
    error.value = apiError(e)
    toast.error("Assign failed", apiError(e))
  } finally {
    busy.value = false
  }
}

async function quickAssign(orderId: number) {
  if (!assignForm.delivery_person_id) {
    assignForm.order_id = orderId
    toast.info("Pick a rider", "Select a rider above, then assign")
    return
  }
  assignForm.order_id = orderId
  await assign()
}

function patchGps(data: Record<string, unknown>) {
  const orderId = Number(data.order_id)
  const riderId = Number(data.delivery_person_id)
  const lat = data.lat ?? data.rider_lat
  const lng = data.lng ?? data.rider_lng

  if (riderId && lat != null && lng != null) {
    const ri = riders.value.findIndex((x) => Number(x.id) === riderId)
    if (ri >= 0) {
      const row = { ...riders.value[ri]!, current_lat: lat, current_lng: lng }
      riders.value = [...riders.value.slice(0, ri), row, ...riders.value.slice(ri + 1)]
    }
  }

  if (!orderId) {
    if (!riderId) scheduleRefresh()
    return
  }
  const idx = live.value.findIndex((t) => Number(t.order_id) === orderId)
  if (idx >= 0) {
    const row = { ...live.value[idx]! }
    if (lat != null) row.rider_lat = lat
    if (lng != null) row.rider_lng = lng
    if (data.eta_minutes != null) row.eta_minutes = data.eta_minutes
    if (data.distance_km != null) row.distance_km = data.distance_km
    if (riderId) row.delivery_person_id = riderId
    row.updated_at = new Date().toISOString()
    live.value = [...live.value.slice(0, idx), row, ...live.value.slice(idx + 1)]
  } else {
    scheduleRefresh()
  }
}

function onOrderStatus() {
  scheduleRefresh()
}

function onAdminEvent(data: Record<string, unknown>) {
  const kind = String(data.kind || "")
  if (
    kind.includes("routing")
    || kind.includes("order")
    || kind.includes("delivery")
    || kind.includes("picking")
    || kind.includes("shop")
  ) {
    scheduleRefresh()
  }
}

function startAdminGeo() {
  if (!import.meta.client || !navigator.geolocation) return
  geoWatch = navigator.geolocation.watchPosition(
    (pos) => {
      adminPt.value = [pos.coords.latitude, pos.coords.longitude]
      adminGeoOk.value = true
    },
    () => {
      adminGeoOk.value = false
    },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
  )
}

onMounted(() => {
  void load()
  startAdminGeo()
  liveSocket = connect()
  liveSocket?.on("order_status", onOrderStatus)
  liveSocket?.on("admin_event", onAdminEvent)
  liveSocket?.on("delivery_location", patchGps)
  pollId = window.setInterval(() => {
    if (document.visibilityState === "visible") void load({ quiet: true })
  }, socketLive.value ? 15000 : 5000)
  tickTimer = setInterval(() => {
    nowTick.value = Date.now()
  }, 20000)
})

onBeforeUnmount(() => {
  liveSocket?.off("order_status", onOrderStatus)
  liveSocket?.off("admin_event", onAdminEvent)
  liveSocket?.off("delivery_location", patchGps)
  if (pollId) window.clearInterval(pollId)
  if (tickTimer) clearInterval(tickTimer)
  if (refreshTimer) clearTimeout(refreshTimer)
  if (geoWatch != null) navigator.geolocation.clearWatch(geoWatch)
})
</script>

<template>
  <div>
    <div class="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <p class="m-0 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-[#e9748e]">Dispatch</p>
        <h1 class="font-display m-0 mt-1 text-2xl text-chocolate sm:text-3xl">Routing</h1>
        <p class="m-0 mt-1 text-sm text-[var(--muted)]">
          Everyone on one live map — hub, you, shops, customers, riders
          <span
            class="ml-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.65rem] font-semibold"
            :class="socketLive ? 'bg-[#e8f6ee] text-[#2e7d4f]' : 'bg-[#f8ede6] text-[var(--muted)]'"
          >
            <span
              class="size-1.5 rounded-full"
              :class="socketLive ? 'animate-pulse bg-success' : 'bg-[#c4a39a]'"
            />
            {{ socketLive ? "Live" : "Polling" }}
            <span v-if="refreshing" class="font-normal">· updating</span>
          </span>
          <span
            v-if="adminGeoOk"
            class="ml-1 inline-flex items-center gap-1 rounded-full bg-[#fff0f2] px-2 py-0.5 text-[0.65rem] font-semibold text-[#e9748e]"
          >
            Admin GPS on
          </span>
        </p>
      </div>
      <div class="flex flex-wrap gap-2">
        <UButton
          color="primary"
          variant="soft"
          icon="i-lucide-refresh-cw"
          :loading="loading || refreshing"
          label="Refresh"
          @click="load()"
        />
        <UButton
          color="secondary"
          icon="i-lucide-route"
          :loading="busy"
          :label="selectedIds.length ? `Optimize (${selectedIds.length})` : 'Optimize route'"
          @click="optimize"
        />
        <UButton to="/delivery" color="secondary" variant="outline" icon="i-lucide-bike" label="Riders" />
        <UButton to="/shops" color="secondary" variant="outline" icon="i-lucide-store" label="Shops" />
        <UButton
          color="primary"
          variant="soft"
          icon="i-lucide-radar"
          :loading="googleLoading"
          label="Find Google (30km)"
          @click="loadNearbyPlaces()"
        />
        <UButton
          :color="addShopMode ? 'secondary' : 'primary'"
          :variant="addShopMode ? 'solid' : 'outline'"
          icon="i-lucide-map-pin-plus"
          :loading="placeBusy"
          :label="addShopMode ? 'Done picking' : 'Pick & save shop'"
          @click="toggleAddShopMode"
        />
      </div>
    </div>

    <p v-if="error" class="mb-3 text-sm text-danger">{{ error }}</p>

    <div v-if="loading" class="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <div v-for="n in 4" :key="n" class="sc-skeleton h-24 rounded-xl" />
    </div>
    <div v-else class="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="Open stops" :value="stops.length" icon="lucide:map-pin" />
      <StatCard label="Our shops" :value="shopsOnMap.length" icon="lucide:store" />
      <StatCard
        label="Google 30km"
        :value="googleLoading ? '…' : googlePlaces.length"
        icon="lucide:globe"
        tone="warn"
      />
      <StatCard label="Riders" :value="riders.length" icon="lucide:bike" tone="ok" :hint="`${gpsLiveCount} GPS`" />
    </div>

    <!-- Layer toggles -->
    <div class="mb-3 flex flex-wrap gap-1.5">
      <button
        v-for="item in [
          { key: 'hub', label: 'Hub' },
          { key: 'admin', label: 'Admin' },
          { key: 'shops', label: 'Our shops' },
          { key: 'google', label: 'Google' },
          { key: 'customers', label: 'Customers' },
          { key: 'riders', label: 'Riders' },
          { key: 'route', label: 'Route' },
        ]"
        :key="item.key"
        type="button"
        class="rounded-full px-3 py-1.5 text-xs font-semibold transition"
        :class="layers[item.key as keyof typeof layers]
          ? 'bg-chocolate text-cream'
          : 'bg-white text-chocolate ring-1 ring-[var(--line)]'"
        @click="onLayerToggle(item.key as keyof typeof layers)"
      >
        {{ item.label }}
      </button>
    </div>

    <ClientOnly>
      <RoutingDispatchMap
        ref="mapRef"
        class="mb-4"
        :hub="hub"
        :admin="adminPt"
        :shops="shops"
        :riders="riders"
        :customers="filteredStops"
        :tracks="live"
        :route="route"
        :selected-order-id="assignForm.order_id || null"
        :selected-shop-id="focusShopId || null"
        :selected-rider-id="assignForm.delivery_person_id || null"
        :live="socketLive || adminGeoOk"
        :layers="layers"
        :add-shop-mode="addShopMode"
        :google-places="googlePlaces"
        :selected-place-id="selectedPlaceId"
        :admin-name="adminName"
        :admin-avatar-url="adminAvatarUrl"
        @select-order="onMapSelectOrder"
        @select-shop="onMapSelectShop"
        @select-rider="onMapSelectRider"
        @pick-place="onPickPlace"
      />
      <template #fallback>
        <div class="sc-skeleton mb-4 h-[min(56vh,460px)] rounded-2xl" />
      </template>
    </ClientOnly>

    <div
      v-if="selectedPlace"
      class="mb-4 rounded-2xl border border-[#e9748e]/35 bg-white p-4 shadow-[0_8px_22px_-18px_rgba(74,44,42,0.4)]"
    >
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="flex min-w-0 flex-1 gap-3">
          <img
            v-if="selectedPlace.photo_url || selectedPlace.logo_url || selectedPlace.icon"
            :src="String(selectedPlace.photo_url || selectedPlace.logo_url || selectedPlace.icon)"
            alt=""
            class="size-14 shrink-0 rounded-xl object-cover ring-1 ring-[var(--line)]"
          >
          <div class="min-w-0">
          <p class="font-display m-0 text-xl text-chocolate">
            {{ selectedPlace.name || selectedPlace.shop_name || "Google place" }}
          </p>
          <p class="m-0 mt-1 text-sm text-[var(--muted)]">
            {{ selectedPlace.address_line || selectedPlace.label }}
          </p>
          <div class="mt-2 flex flex-wrap gap-2 text-xs text-chocolate">
            <span v-if="selectedPlace.rating != null" class="rounded-full bg-[#fff5f7] px-2 py-0.5 font-semibold">
              ★ {{ selectedPlace.rating }}
              <span v-if="selectedPlace.user_ratings_total" class="text-[var(--muted)]">
                ({{ selectedPlace.user_ratings_total }})
              </span>
            </span>
            <span v-if="selectedPlace.open_now === true" class="rounded-full bg-[#e8f6ee] px-2 py-0.5 text-[#2e7d4f]">Open</span>
            <span v-else-if="selectedPlace.open_now === false" class="rounded-full bg-[#f8ede6] px-2 py-0.5">Closed</span>
            <span v-if="selectedPlace.phone" class="rounded-full bg-[#fff9f5] px-2 py-0.5">{{ selectedPlace.phone }}</span>
            <span v-if="selectedPlace.city" class="rounded-full bg-[#fff9f5] px-2 py-0.5">{{ selectedPlace.city }}</span>
            <span v-if="selectedPlace.pincode" class="rounded-full bg-[#fff9f5] px-2 py-0.5">{{ selectedPlace.pincode }}</span>
          </div>
          <p v-if="Array.isArray(selectedPlace.types) && selectedPlace.types.length" class="m-0 mt-2 text-[0.7rem] text-[var(--muted)]">
            {{ (selectedPlace.types as string[]).filter((t) => !t.includes('political')).slice(0, 6).join(' · ') }}
          </p>
          <ul v-if="Array.isArray(selectedPlace.weekday_hours) && selectedPlace.weekday_hours.length" class="m-0 mt-2 list-none p-0 text-[0.7rem] text-[var(--muted)]">
            <li v-for="(h, i) in (selectedPlace.weekday_hours as string[]).slice(0, 3)" :key="i">{{ h }}</li>
          </ul>
          </div>
        </div>
        <div class="flex flex-col gap-2">
          <UButton
            color="secondary"
            icon="i-lucide-save"
            :loading="placeBusy"
            label="Save to admin"
            @click="saveSelectedPlace"
          />
          <UButton
            v-if="selectedPlace.maps_url || selectedPlace.website"
            color="neutral"
            variant="outline"
            size="sm"
            :to="String(selectedPlace.maps_url || selectedPlace.website)"
            target="_blank"
            label="Open Google"
          />
          <UButton color="neutral" variant="ghost" size="sm" label="Close" @click="selectedPlace = null" />
        </div>
      </div>
    </div>

    <div class="mb-2 flex flex-wrap gap-3 text-[0.68rem] text-[var(--muted)]">
      <span class="inline-flex items-center gap-1.5"><span class="size-2.5 rounded-full bg-chocolate" /> Hub logo</span>
      <span class="inline-flex items-center gap-1.5"><span class="size-2.5 rounded-full bg-[#e9748e]" /> Admin logo</span>
      <span class="inline-flex items-center gap-1.5"><span class="size-2.5 rounded-full bg-[#8b5e3c]" /> Shop logo</span>
      <span class="inline-flex items-center gap-1.5"><span class="size-2.5 rounded-full border border-dashed border-[#e9748e] bg-[#fff9f5]" /> Google shop photo</span>
      <span class="inline-flex items-center gap-1.5"><span class="size-2.5 rounded-full bg-[#2e7d4f]" /> Rider photo</span>
      <span class="text-[var(--muted)]">· Hover any pin for details</span>
    </div>

    <!-- Assign + focus -->
    <div class="mb-4 rounded-2xl border border-[var(--line)] bg-white p-4 shadow-[0_8px_22px_-18px_rgba(74,44,42,0.4)]">
      <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p class="m-0 text-xs font-semibold uppercase tracking-[0.1em] text-[var(--muted)]">Assign & focus</p>
        <p v-if="etaResult" class="m-0 text-xs text-chocolate">
          ETA
          <span v-if="selectedStop" class="font-semibold">{{ stopTitle(selectedStop) }}</span>
          · <span class="font-bold">{{ etaResult.eta_minutes }} min</span>
        </p>
      </div>
      <div class="grid gap-3 lg:grid-cols-4">
        <label>
          <span class="sc-label">Customer stop</span>
          <select v-model.number="assignForm.order_id" class="sc-input !rounded-xl" @change="checkEta(assignForm.order_id)">
            <option :value="0">Select stop… ({{ stops.length }})</option>
            <option v-for="s in stops" :key="String(s.order_id)" :value="Number(s.order_id)">
              {{ stopTitle(s) }} · {{ statusLabel(String(s.status || '')) }}
            </option>
          </select>
        </label>
        <label>
          <span class="sc-label">Rider</span>
          <select v-model.number="assignForm.delivery_person_id" class="sc-input !rounded-xl" @change="onMapSelectRider(assignForm.delivery_person_id)">
            <option :value="0">Select rider… ({{ riders.length }})</option>
            <option v-for="r in riders" :key="String(r.id)" :value="Number(r.id)">
              {{ r.name || r.phone }}{{ r.is_available === false ? ' · off' : '' }}{{ r.vehicle_number ? ` · ${r.vehicle_number}` : '' }}
            </option>
          </select>
        </label>
        <label>
          <span class="sc-label">Shop (focus map)</span>
          <select v-model.number="focusShopId" class="sc-input !rounded-xl" @change="focusShopFromSelect">
            <option :value="0">Select shop… ({{ shops.length }})</option>
            <option v-for="s in shops" :key="String(s.user_id)" :value="Number(s.user_id)">
              {{ s.shop_name || s.name || 'Shop' }}{{ s.latitude == null ? ' · no GPS' : '' }}
            </option>
          </select>
        </label>
        <div class="flex items-end gap-2">
          <UButton color="secondary" :loading="busy" icon="i-lucide-user-plus" label="Assign" @click="assign" />
          <UButton
            color="neutral"
            variant="outline"
            icon="i-lucide-timer"
            label="ETA"
            :disabled="!assignForm.order_id"
            @click="checkEta(assignForm.order_id)"
          />
        </div>
      </div>
      <p v-if="!riders.length || !shops.length" class="mt-2 text-xs text-[var(--muted)]">
        <span v-if="!riders.length">No riders loaded — add them under Delivery. </span>
        <span v-if="!shops.length">No shops loaded — check Shops. </span>
        Allow location when prompted so your admin pin appears.
      </p>
    </div>

    <div class="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <label class="relative block w-full max-w-md">
        <UIcon name="i-lucide-search" class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--muted)]" />
        <input
          v-model="search"
          class="sc-input w-full !rounded-xl !py-2.5 !pl-9"
          placeholder="Search customer, phone, address, rider…"
        >
      </label>
      <div class="flex flex-wrap gap-1.5">
        <button
          v-for="t in statusTabs"
          :key="t.value || 'all'"
          type="button"
          class="rounded-full px-3 py-1.5 text-xs font-semibold transition"
          :class="statusFilter === t.value ? 'bg-chocolate text-cream' : 'bg-white text-chocolate ring-1 ring-[var(--line)] hover:bg-[#fff0f2]'"
          @click="statusFilter = t.value"
        >
          {{ t.label }}
          <span class="opacity-70">({{ t.value ? (statusCounts[t.value] || 0) : statusCounts.all }})</span>
        </button>
      </div>
    </div>

    <div class="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
      <section>
        <div class="mb-2.5 flex items-center justify-between px-0.5">
          <p class="m-0 text-xs font-semibold uppercase tracking-[0.1em] text-[var(--muted)]">
            {{ filteredStops.length }} open stop{{ filteredStops.length === 1 ? "" : "s" }}
          </p>
          <button
            v-if="selectedIds.length"
            type="button"
            class="text-xs font-semibold text-[#e9748e]"
            @click="selectedIds = []"
          >
            Clear selection ({{ selectedIds.length }})
          </button>
        </div>

        <div
          v-if="!loading && !filteredStops.length"
          class="rounded-2xl border border-dashed border-[var(--line)] bg-white px-6 py-14 text-center"
        >
          <span class="mx-auto grid size-14 place-items-center rounded-2xl bg-[#fff0f2]">
            <UIcon name="i-lucide-map-pin-off" class="size-7 text-[#e9748e]" />
          </span>
          <p class="font-display mt-4 text-xl text-chocolate">No open stops</p>
          <p class="mt-1 text-sm text-[var(--muted)]">
            Shops ({{ shopsOnMap.length }}) and riders ({{ riders.length }}) still show on the map when GPS exists.
          </p>
        </div>

        <div v-else class="space-y-2.5">
          <article
            v-for="s in filteredStops"
            :key="String(s.order_id)"
            class="rounded-2xl border border-[var(--line)] bg-white p-3.5 shadow-[0_8px_22px_-18px_rgba(74,44,42,0.4)] transition hover:-translate-y-0.5 hover:border-[#f2a7ad]/70"
            :class="assignForm.order_id === Number(s.order_id) ? 'border-[#e9748e]/50 bg-[#fff5f7] ring-2 ring-[#e9748e]/15' : ''"
          >
            <div class="flex items-start gap-3">
              <label class="mt-1 flex cursor-pointer items-center">
                <input
                  type="checkbox"
                  class="size-4 rounded border-[var(--line)] text-[#e9748e] focus:ring-[#e9748e]"
                  :checked="selectedIds.includes(Number(s.order_id))"
                  @change="toggleSelect(Number(s.order_id))"
                  @click.stop
                >
              </label>
              <button type="button" class="min-w-0 flex-1 text-left" @click="selectStop(s)">
                <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span class="font-semibold text-chocolate">{{ stopTitle(s) }}</span>
                  <StatusBadge :status="String(s.status || '—')" />
                  <span class="text-[0.7rem] font-bold tabular-nums text-[var(--muted)]">{{ ageOf(s.created_at) }}</span>
                </div>
                <p class="mt-1 text-[0.7rem] text-[var(--muted)]">{{ s.order_number }} · {{ customerLabel(s) }}</p>
                <p class="mt-1 flex items-start gap-1.5 text-xs text-[var(--muted)]">
                  <UIcon name="i-lucide-map-pin" class="mt-0.5 size-3.5 shrink-0 text-[#e9748e]" />
                  <span class="line-clamp-2">{{ s.address || "No address" }}</span>
                </p>
                <div class="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[0.7rem] text-[var(--muted)]">
                  <span>Slot {{ slotOf(s) }}</span>
                  <span class="font-semibold text-chocolate">{{ s.distance_km != null ? `${s.distance_km} km` : "No GPS" }}</span>
                  <span :class="s.rider_name || s.delivery_person_id ? '' : 'text-[#e9748e]'">{{ riderLabel(s) }}</span>
                  <span v-if="s.final_amount != null">{{ money(Number(s.final_amount)) }}</span>
                </div>
              </button>
              <div class="flex shrink-0 flex-col gap-1">
                <UButton size="xs" color="secondary" variant="soft" label="Map" @click="selectStop(s)" />
                <UButton size="xs" color="neutral" variant="outline" label="Assign" @click="quickAssign(Number(s.order_id))" />
              </div>
            </div>
          </article>
        </div>
      </section>

      <div class="space-y-4">
        <section class="overflow-hidden rounded-2xl border border-[var(--line)] bg-white shadow-[0_8px_22px_-18px_rgba(74,44,42,0.4)]">
          <div class="flex items-center justify-between border-b border-[var(--line)] bg-[#fff9f5] px-4 py-3">
            <div>
              <p class="font-display m-0 text-lg text-chocolate">Optimized route</p>
              <p class="m-0 mt-0.5 text-[0.7rem] text-[var(--muted)]">
                Nearest-neighbor
                <span v-if="totalKm"> · {{ totalKm }} km</span>
              </p>
            </div>
            <UButton size="xs" color="secondary" :loading="busy" icon="i-lucide-route" label="Run" @click="optimize" />
          </div>
          <ol v-if="route.length" class="m-0 list-none divide-y divide-[var(--line)] p-0">
            <li v-for="(s, i) in route" :key="`r-${s.order_id}`" class="flex items-center gap-3 px-4 py-3">
              <span class="grid size-8 place-items-center rounded-full bg-[#fff0f2] text-xs font-bold text-chocolate">{{ i + 1 }}</span>
              <button type="button" class="min-w-0 flex-1 text-left" @click="selectStop(s)">
                <p class="m-0 truncate text-sm font-semibold text-chocolate">{{ stopTitle(s) }}</p>
                <p class="m-0 mt-0.5 truncate text-[0.7rem] text-[var(--muted)]">{{ s.address || "—" }} · +{{ s.leg_km }} km</p>
              </button>
            </li>
          </ol>
          <div v-else class="px-6 py-10 text-center text-sm text-[var(--muted)]">
            Run Optimize to draw the pink path across customer stops.
          </div>
        </section>

        <section class="overflow-hidden rounded-2xl border border-[var(--line)] bg-white shadow-[0_8px_22px_-18px_rgba(74,44,42,0.4)]">
          <div class="border-b border-[var(--line)] bg-[#fff9f5] px-4 py-3">
            <p class="font-display m-0 text-lg text-chocolate">Live rider tracks</p>
            <p class="m-0 mt-0.5 text-[0.7rem] text-[var(--muted)]">GPS patches the map instantly</p>
          </div>
          <div v-if="live.length" class="divide-y divide-[var(--line)]">
            <button
              v-for="t in live"
              :key="String(t.id || t.order_id)"
              type="button"
              class="flex w-full items-start justify-between gap-3 px-4 py-3 text-left hover:bg-[#fff0f2]/40"
              @click="onMapSelectOrder(Number(t.order_id))"
            >
              <div class="min-w-0">
                <p class="m-0 truncate text-sm font-semibold text-chocolate">
                  {{ t.customer_name || t.order_number || "Delivery" }}
                </p>
                <p class="m-0 mt-0.5 text-[0.7rem] text-[var(--muted)]">
                  {{ riderLabel(t) }}
                  <span v-if="t.order_status"> · {{ statusLabel(String(t.order_status)) }}</span>
                </p>
                <p class="m-0 mt-1 text-[0.65rem] text-[var(--muted)]">
                  Updated {{ relativeAgo(String(t.updated_at || '')) }}
                </p>
              </div>
              <div class="shrink-0 text-right text-xs">
                <p class="m-0 font-bold tabular-nums text-chocolate">{{ t.eta_minutes != null ? `${t.eta_minutes} min` : "—" }}</p>
                <p class="m-0 mt-0.5 tabular-nums text-[var(--muted)]">{{ t.distance_km != null ? `${t.distance_km} km` : "—" }}</p>
              </div>
            </button>
          </div>
          <div v-else class="px-6 py-8 text-center text-sm text-[var(--muted)]">
            No active tracks — riders with saved GPS still appear on the map.
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

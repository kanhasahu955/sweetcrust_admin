<script setup lang="ts">
import { apiError, displayPhone, money, relativeAgo } from "~/utils/format"
import { patchListRow, upsertListRow } from "~/utils/list"
import { resolveMediaUrl } from "~/utils/mapPins"

type Pt = [number, number]

const api = useApi()
const toast = useAppToast()
const config = useRuntimeConfig()
const socketLive = useState("adminSocketLive", () => false)
const { connect } = useSocket()

const riders = ref<Record<string, unknown>[]>([])
const liveRows = ref<Record<string, unknown>[]>([])
const loading = ref(true)
const refreshing = ref(false)
const busy = ref(false)
const uploading = ref<string | null>(null)
const error = ref("")
const q = ref("")
const flag = ref<"all" | "available" | "busy" | "gps" | "no_login" | "docs">("all")
const panelOpen = ref(false)
const selectedId = ref<number | null>(null)
const mapRef = ref<{ focus: (pt: Pt | null | undefined, zoom?: number) => void; invalidate?: () => void } | null>(null)

const form = reactive({
  id: 0,
  name: "",
  phone: "",
  password: "",
  vehicle_number: "",
  default_trip_cost: 40,
  is_available: true,
  photo_url: "",
  aadhaar_url: "",
  pan_url: "",
})

const filterTabs = [
  { value: "all" as const, label: "All" },
  { value: "available" as const, label: "Available" },
  { value: "busy" as const, label: "Busy" },
  { value: "gps" as const, label: "GPS live" },
  { value: "no_login" as const, label: "No login" },
  { value: "docs" as const, label: "Docs incomplete" },
]

const stats = computed(() => {
  const list = riders.value
  return {
    total: list.length,
    available: list.filter((r) => r.is_available !== false).length,
    withGps: list.filter((r) => r.has_gps || (r.current_lat != null && r.current_lng != null)).length,
    activeTrips: liveRows.value.length,
    noLogin: list.filter((r) => !r.has_login && !r.user_id).length,
  }
})

const filtered = computed(() => {
  const ql = q.value.trim().toLowerCase()
  return riders.value.filter((r) => {
    if (flag.value === "available" && r.is_available === false) return false
    if (flag.value === "busy" && r.is_available !== false) return false
    if (flag.value === "gps" && !(r.has_gps || (r.current_lat != null && r.current_lng != null))) return false
    if (flag.value === "no_login" && (r.has_login || r.user_id)) return false
    if (flag.value === "docs" && r.docs_complete) return false
    if (!ql) return true
    return (
      String(r.name || "").toLowerCase().includes(ql)
      || String(r.phone || "").toLowerCase().includes(ql)
      || String(r.vehicle_number || "").toLowerCase().includes(ql)
    )
  })
})

const HUB_DEFAULT: Pt = [19.3149, 84.7941]

const selected = computed(() =>
  selectedId.value ? riders.value.find((r) => Number(r.id) === selectedId.value) || null : null,
)

/** Always keep every active trip on the map (selection only highlights). */
const mapTracks = computed(() => liveRows.value)

const selectedTracks = computed(() => {
  if (!selectedId.value) return liveRows.value
  return liveRows.value.filter((t) => Number(t.delivery_person_id) === selectedId.value)
})

function trackGpsFor(riderId: number): { lat: number; lng: number } | null {
  const t = liveRows.value.find(
    (x) => Number(x.delivery_person_id) === riderId && x.rider_lat != null && x.rider_lng != null,
  )
  if (!t) return null
  return { lat: Number(t.rider_lat), lng: Number(t.rider_lng) }
}

/** All riders — fill missing current_* from live track so pins never disappear when following someone else. */
const mapRiders = computed(() =>
  riders.value.map((r) => {
    if (r.current_lat != null && r.current_lng != null) return r
    const g = trackGpsFor(Number(r.id))
    return g ? { ...r, current_lat: g.lat, current_lng: g.lng, has_gps: true } : r
  }),
)

const selectedHasGps = computed(() => {
  if (!selected.value) return false
  if (selected.value.current_lat != null && selected.value.current_lng != null) return true
  return !!trackGpsFor(Number(selected.value.id))
})

const hub = computed<Pt | null>(() => {
  // Prefer hub near rider GPS. Old tracks often carry Mumbai bakery_lat while ops are Odisha.
  const gps = mapRiders.value.find((r) => r.current_lat != null && r.current_lng != null)
  const t = selectedTracks.value[0] || liveRows.value[0]
  if (t?.bakery_lat != null && t?.bakery_lng != null) {
    const blat = Number(t.bakery_lat)
    const blng = Number(t.bakery_lng)
    if (gps && Math.abs(Number(gps.current_lng) - blng) > 4) return HUB_DEFAULT
    return [blat, blng]
  }
  if (gps) return HUB_DEFAULT
  return HUB_DEFAULT
})

function thumb(url: unknown) {
  return resolveMediaUrl(String(url || ""), String(config.public.apiBase || ""))
}

function hideBrokenImg(e: Event) {
  const el = e.target as HTMLImageElement | null
  if (el) el.style.display = "none"
}

function initial(label: unknown) {
  return String(label || "?").trim().slice(0, 1).toUpperCase() || "?"
}

function docsCount(r: Record<string, unknown>) {
  const d = (r.docs || {}) as Record<string, unknown>
  return [d.photo || r.photo_url, d.aadhaar || r.aadhaar_url, d.pan || r.pan_url].filter(Boolean).length
}

function resetForm() {
  form.id = 0
  form.name = ""
  form.phone = ""
  form.password = ""
  form.vehicle_number = ""
  form.default_trip_cost = 40
  form.is_available = true
  form.photo_url = ""
  form.aadhaar_url = ""
  form.pan_url = ""
}

function openCreate() {
  resetForm()
  panelOpen.value = true
}

function openEdit(r: Record<string, unknown>) {
  form.id = Number(r.id)
  form.name = String(r.name || "")
  form.phone = String(r.phone || "")
  form.password = ""
  form.vehicle_number = String(r.vehicle_number || "")
  form.default_trip_cost = Number(r.default_trip_cost) || 40
  form.is_available = r.is_available !== false
  form.photo_url = String(r.photo_url || "")
  form.aadhaar_url = String(r.aadhaar_url || "")
  form.pan_url = String(r.pan_url || "")
  panelOpen.value = true
}

function focusBestGps(preferId?: number | null) {
  const enriched = mapRiders.value
  const preferred = preferId
    ? enriched.find((r) => Number(r.id) === preferId && r.current_lat != null)
    : null
  const target = preferred || enriched.find((r) => r.current_lat != null && r.current_lng != null)
  if (target?.current_lat != null && target.current_lng != null) {
    mapRef.value?.focus([Number(target.current_lat), Number(target.current_lng)], 14)
    return
  }
  mapRef.value?.focus(HUB_DEFAULT, 12)
}

function selectRider(r: Record<string, unknown>) {
  const id = Number(r.id)
  const next = selectedId.value === id ? null : id
  selectedId.value = next
  nextTick(() => {
    if (next) {
      const g = trackGpsFor(id)
      const lat = r.current_lat ?? g?.lat
      const lng = r.current_lng ?? g?.lng
      if (lat != null && lng != null) {
        mapRef.value?.focus([Number(lat), Number(lng)], 15)
      } else {
        toast.info("No GPS yet", `${r.name || "Rider"} — showing other live pins`)
        focusBestGps()
      }
    } else {
      focusBestGps()
    }
  })
}

function clearSelection() {
  selectedId.value = null
  nextTick(() => focusBestGps())
}

function onMapSelectRider(riderId: number) {
  const r = riders.value.find((x) => Number(x.id) === riderId)
  if (r) selectRider(r)
}

async function load(opts?: { quiet?: boolean }) {
  if (opts?.quiet) refreshing.value = true
  else loading.value = true
  error.value = ""
  try {
    const [r, l] = await Promise.all([
      api.admin.deliveryPersons(),
      api.admin.liveDelivery().catch(() => []),
    ])
    riders.value = Array.isArray(r) ? (r as Record<string, unknown>[]) : []
    if (Array.isArray(l)) {
      liveRows.value = l as Record<string, unknown>[]
    } else {
      const obj = (l || {}) as Record<string, unknown>
      liveRows.value = (Array.isArray(obj.active) ? obj.active : []) as Record<string, unknown>[]
    }
    // First paint: follow a rider that actually has GPS (not the first card without coords)
    if (!opts?.quiet) {
      const withGps = riders.value.find(
        (x) => x.current_lat != null && x.current_lng != null,
      ) || riders.value.find((x) => trackGpsFor(Number(x.id)))
      if (withGps) {
        selectedId.value = Number(withGps.id)
        nextTick(() => focusBestGps(Number(withGps.id)))
      } else {
        nextTick(() => focusBestGps())
      }
    }
  } catch (e) {
    error.value = apiError(e)
  } finally {
    loading.value = false
    refreshing.value = false
  }
}

async function onUpload(kind: "photo_url" | "aadhaar_url" | "pan_url", e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ""
  if (!file) return
  if (!file.type.startsWith("image/") && file.type !== "application/pdf") {
    toast.error("Use an image or PDF")
    return
  }
  uploading.value = kind
  try {
    const res = await api.uploadFile(file, "rider")
    const url = String(res?.url || "")
    if (!url) throw new Error("Upload failed")
    form[kind] = url
    toast.success("Uploaded")
  } catch (err) {
    toast.error(apiError(err))
  } finally {
    uploading.value = null
  }
}

async function save() {
  if (!form.name.trim() || !form.phone.trim()) {
    toast.info("Name and phone required")
    return
  }
  if (form.password.trim() && form.password.trim().length < 6) {
    toast.info("Password must be at least 6 characters")
    return
  }
  busy.value = true
  error.value = ""
  const body: Record<string, unknown> = {
    name: form.name.trim(),
    phone: form.phone.trim(),
    vehicle_number: form.vehicle_number.trim() || "TBD",
    default_trip_cost: Number(form.default_trip_cost) || 40,
    is_available: form.is_available,
    photo_url: form.photo_url.trim() || null,
    aadhaar_url: form.aadhaar_url.trim() || null,
    pan_url: form.pan_url.trim() || null,
  }
  if (form.password.trim()) body.password = form.password.trim()
  try {
    if (form.id) {
      const saved = (await api.admin.patchRider(form.id, body)) as Record<string, unknown>
      if (!upsertListRow(riders, saved)) patchListRow(riders, form.id, body)
      toast.success("Rider updated", form.name)
    } else {
      const created = (await api.admin.addRider(body)) as Record<string, unknown>
      upsertListRow(riders, created)
      toast.success(
        "Rider saved",
        form.password.trim()
          ? `Login: ${displayPhone(form.phone)}`
          : "Profile only — enable login later",
      )
    }
    panelOpen.value = false
    void load({ quiet: true })
  } catch (e) {
    error.value = apiError(e)
    toast.error(apiError(e))
  } finally {
    busy.value = false
  }
}

async function enableLogin(r: Record<string, unknown>) {
  const password = window.prompt(`Set login password for ${r.name || r.phone}`, "rider123")
  if (password == null) return
  if (password.trim().length < 6) {
    toast.info("Password must be at least 6 characters")
    return
  }
  busy.value = true
  try {
    const saved = (await api.admin.patchRider(Number(r.id), {
      password: password.trim(),
      phone: r.phone,
      name: r.name,
    })) as Record<string, unknown>
    if (!upsertListRow(riders, saved)) patchListRow(riders, Number(r.id), { has_login: true, user_id: saved.user_id })
    toast.success("Login enabled", `${displayPhone(String(r.phone))} / ${password.trim()}`)
    void load({ quiet: true })
  } catch (e) {
    toast.error(apiError(e))
  } finally {
    busy.value = false
  }
}

async function toggleAvailable(r: Record<string, unknown>) {
  const next = r.is_available === false
  busy.value = true
  try {
    const saved = (await api.admin.patchRider(Number(r.id), { is_available: next })) as Record<string, unknown>
    if (!upsertListRow(riders, saved)) patchListRow(riders, Number(r.id), { is_available: next })
  } catch (e) {
    toast.error(apiError(e))
  } finally {
    busy.value = false
  }
}

function patchGps(data: Record<string, unknown>) {
  const orderId = Number(data.order_id)
  const riderId = Number(data.delivery_person_id)
  const lat = data.lat ?? data.rider_lat
  const lng = data.lng ?? data.rider_lng
  if (riderId && lat != null && lng != null) {
    const ri = riders.value.findIndex((x) => Number(x.id) === riderId)
    if (ri >= 0) {
      const row = { ...riders.value[ri]!, current_lat: lat, current_lng: lng, has_gps: true }
      riders.value = [...riders.value.slice(0, ri), row, ...riders.value.slice(ri + 1)]
    }
    if (selectedId.value === riderId) {
      mapRef.value?.focus([Number(lat), Number(lng)], 15)
    }
  }
  if (!orderId) return
  const idx = liveRows.value.findIndex((t) => Number(t.order_id) === orderId)
  if (idx >= 0) {
    const row = { ...liveRows.value[idx]! }
    if (lat != null) row.rider_lat = lat
    if (lng != null) row.rider_lng = lng
    if (data.eta_minutes != null) row.eta_minutes = data.eta_minutes
    if (riderId) row.delivery_person_id = riderId
    liveRows.value = [...liveRows.value.slice(0, idx), row, ...liveRows.value.slice(idx + 1)]
  } else {
    void load({ quiet: true })
  }
}

let liveSocket: ReturnType<typeof connect> = null
const onAdminEvent = (data: Record<string, unknown>) => {
  const kind = String(data?.kind || "")
  if (kind.includes("delivery") || kind.includes("order") || kind.includes("assign")) {
    void load({ quiet: true })
  }
}
onMounted(() => {
  void load()
  liveSocket = connect()
  liveSocket?.on("delivery_location", patchGps)
  liveSocket?.on("admin_event", onAdminEvent)
})
onBeforeUnmount(() => {
  liveSocket?.off("delivery_location", patchGps)
  liveSocket?.off("admin_event", onAdminEvent)
})
</script>

<template>
  <div>
    <div class="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="font-display m-0 text-2xl text-chocolate sm:text-3xl">Riders & delivery</h1>
        <p class="m-0 mt-1 flex flex-wrap items-center gap-2 text-sm text-[var(--muted)]">
          <span
            class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.65rem] font-semibold"
            :class="socketLive ? 'bg-[#e8f6ee] text-[#2e7d4f]' : 'bg-[#f8ede6] text-[var(--muted)]'"
          >
            <span class="size-1.5 rounded-full" :class="socketLive ? 'animate-pulse bg-success' : 'bg-[#c4a39a]'" />
            {{ socketLive ? "Live" : "Offline" }}
          </span>
          <span>Profiles, KYC docs, trip cost — tap a rider to track</span>
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
        <UButton to="/routing" color="neutral" variant="outline" icon="i-lucide-map" label="Routing map" />
        <UButton color="secondary" icon="i-lucide-plus" label="Add rider" @click="openCreate" />
      </div>
    </div>

    <p v-if="error" class="mb-3 text-sm text-danger">{{ error }}</p>

    <div class="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="Riders" :value="stats.total" icon="lucide:bike" />
      <StatCard label="Available" :value="stats.available" icon="lucide:check-circle" tone="ok" />
      <StatCard label="GPS live" :value="stats.withGps" icon="lucide:radio" />
      <StatCard label="Active trips" :value="stats.activeTrips" icon="lucide:truck" tone="warn" />
    </div>

    <div class="mb-4 grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
      <div class="overflow-hidden rounded-2xl border border-[var(--line)] bg-white shadow-[0_8px_22px_-18px_rgba(74,44,42,0.35)]">
        <div class="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] bg-[#fff9f5] px-4 py-3">
          <div>
            <h3 class="font-display m-0 text-lg text-chocolate">Live track</h3>
            <p class="m-0 text-xs text-[var(--muted)]">
              <template v-if="selected">
                Following {{ selected.name }}
                <span v-if="!selectedHasGps" class="text-[#e9748e]"> · no GPS on this rider</span>
              </template>
              <template v-else>All riders with GPS · click a card to focus</template>
            </p>
          </div>
          <div class="flex gap-1.5">
            <span class="rounded-full bg-[#fff0f2] px-2.5 py-1 text-[0.65rem] font-semibold text-[#e9748e]">
              {{ mapTracks.length }} active
            </span>
            <span class="rounded-full bg-[#e8f6ee] px-2.5 py-1 text-[0.65rem] font-semibold text-[#2e7d4f]">
              {{ mapRiders.filter((r) => r.current_lat != null).length }} pins
            </span>
            <UButton
              v-if="selectedId"
              size="xs"
              color="neutral"
              variant="soft"
              label="Show all"
              @click="clearSelection"
            />
          </div>
        </div>
        <div class="h-[320px] sm:h-[380px]">
          <RoutingDispatchMap
            ref="mapRef"
            :hub="hub"
            :admin="null"
            :shops="[]"
            :riders="mapRiders"
            :customers="[]"
            :tracks="mapTracks"
            :route="[]"
            :selected-rider-id="selectedId"
            :live="socketLive"
            :layers="{ hub: true, admin: false, shops: false, customers: false, riders: true, route: false, google: false }"
            @select-rider="onMapSelectRider"
          />
        </div>
        <p
          v-if="selected && !selectedHasGps"
          class="border-t border-[var(--line)] bg-[#fff0f2] px-4 py-2 text-xs font-medium text-[#e9748e]"
        >
          {{ selected.name }} has no live GPS — other riders with GPS stay on the map.
        </p>
        <ul v-if="mapTracks.length" class="divide-y divide-[var(--line)] border-t border-[var(--line)]">
          <li
            v-for="t in mapTracks.slice(0, 6)"
            :key="String(t.id || t.order_id)"
            class="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm"
          >
            <NuxtLink :to="`/orders/${t.order_id}`" class="font-semibold text-chocolate hover:text-[#e9748e]">
              Order #{{ t.order_id }}
            </NuxtLink>
            <span class="text-xs text-[var(--muted)]">
              {{ t.rider_name || 'Rider' }}
              · ETA {{ t.eta_minutes != null ? `${t.eta_minutes}m` : '—' }}
              <span v-if="t.updated_at"> · {{ relativeAgo(String(t.updated_at)) }}</span>
            </span>
          </li>
        </ul>
      </div>

      <div class="rounded-2xl border border-[var(--line)] bg-white p-4 shadow-[0_8px_22px_-18px_rgba(74,44,42,0.35)]">
        <h3 class="font-display m-0 text-lg text-chocolate">Quick add</h3>
        <p class="m-0 mt-1 text-xs text-[var(--muted)]">Password optional — KYC docs in the full form</p>
        <div class="mt-3 grid gap-2">
          <input v-model="form.name" class="sc-input !rounded-xl" placeholder="Name">
          <input v-model="form.phone" class="sc-input !rounded-xl" placeholder="Phone +91…">
          <input v-model="form.vehicle_number" class="sc-input !rounded-xl" placeholder="Vehicle OD-00-0000">
          <input v-model.number="form.default_trip_cost" type="number" min="0" class="sc-input !rounded-xl" placeholder="Trip ₹">
          <input
            v-model="form.password"
            class="sc-input !rounded-xl"
            type="password"
            placeholder="Login password (optional)"
            autocomplete="new-password"
          >
          <div class="flex flex-wrap gap-2">
            <UButton color="secondary" :loading="busy" label="Save rider" class="flex-1" @click="save" />
            <UButton color="neutral" variant="soft" label="KYC docs" @click="panelOpen = true" />
          </div>
        </div>
      </div>
    </div>

    <div class="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <label class="relative block w-full max-w-md">
        <UIcon name="i-lucide-search" class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--muted)]" />
        <input
          v-model="q"
          class="sc-input w-full !rounded-xl !py-2.5 !pl-9"
          placeholder="Search name, phone, vehicle…"
        >
      </label>
      <p class="m-0 text-sm text-[var(--muted)]">{{ filtered.length }} shown · {{ stats.noLogin }} without login</p>
    </div>

    <div class="mb-4 flex flex-wrap gap-1.5">
      <button
        v-for="t in filterTabs"
        :key="t.value"
        type="button"
        class="rounded-full px-3 py-1.5 text-xs font-semibold transition"
        :class="flag === t.value ? 'bg-chocolate text-cream' : 'bg-white text-chocolate ring-1 ring-[var(--line)]'"
        @click="flag = t.value"
      >
        {{ t.label }}
      </button>
    </div>

    <div v-if="loading" class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <div v-for="n in 6" :key="n" class="sc-skeleton h-44 rounded-2xl" />
    </div>

    <div
      v-else-if="!filtered.length"
      class="rounded-2xl border border-dashed border-[var(--line)] py-16 text-center text-sm text-[var(--muted)]"
    >
      No riders match
    </div>

    <div v-else class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <article
        v-for="r in filtered"
        :key="String(r.id)"
        class="cursor-pointer rounded-2xl border bg-white p-3.5 shadow-[0_8px_22px_-18px_rgba(74,44,42,0.35)] transition"
        :class="selectedId === Number(r.id) ? 'border-[#e9748e] ring-2 ring-[#e9748e]/25' : 'border-[var(--line)] hover:border-[#e9748e]/35'"
        @click="selectRider(r)"
      >
        <div class="flex gap-3">
          <div class="size-14 shrink-0 overflow-hidden rounded-xl bg-[#fff5f7] ring-1 ring-[var(--line)]">
            <img
              v-if="thumb(r.photo_url)"
              :src="thumb(r.photo_url) || undefined"
              alt=""
              class="size-full object-cover"
              @error="hideBrokenImg"
            >
            <div v-else class="grid size-full place-items-center font-bold text-[#e9748e]">
              {{ initial(r.name) }}
            </div>
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex items-start justify-between gap-2">
              <p class="m-0 truncate font-semibold text-chocolate">{{ r.name }}</p>
              <span
                class="shrink-0 rounded-full px-2 py-0.5 text-[0.65rem] font-semibold"
                :class="r.is_available === false ? 'bg-[#fff0f2] text-[#e9748e]' : 'bg-[#e8f6ee] text-[#2e7d4f]'"
              >
                {{ r.is_available === false ? "Busy" : "Available" }}
              </span>
            </div>
            <p class="m-0 mt-0.5 text-xs text-[var(--muted)]">
              {{ displayPhone(String(r.phone || '')) }} · {{ r.vehicle_number || '—' }}
            </p>
            <div class="mt-1.5 flex flex-wrap gap-1">
              <span
                class="rounded-full px-2 py-0.5 text-[0.65rem] font-semibold"
                :class="r.has_login || r.user_id ? 'bg-[#e8f6ee] text-[#2e7d4f]' : 'bg-[#f8ede6] text-[var(--muted)]'"
              >
                {{ r.has_login || r.user_id ? "Login on" : "No login" }}
              </span>
              <span
                class="rounded-full px-2 py-0.5 text-[0.65rem] font-semibold"
                :class="r.has_gps || r.current_lat != null ? 'bg-[#fff0f2] text-[#e9748e]' : 'bg-[#f8ede6] text-[var(--muted)]'"
              >
                {{ r.has_gps || r.current_lat != null ? "GPS" : "No GPS" }}
              </span>
              <span class="rounded-full bg-[#fff9f5] px-2 py-0.5 text-[0.65rem] font-semibold text-chocolate ring-1 ring-[var(--line)]">
                Docs {{ docsCount(r) }}/3
              </span>
            </div>
          </div>
        </div>

        <div class="mt-3 grid grid-cols-3 gap-2 rounded-xl bg-[#fff9f5] px-2.5 py-2 text-center">
          <div>
            <p class="m-0 text-[0.6rem] font-semibold uppercase tracking-wide text-[var(--muted)]">Trip</p>
            <p class="m-0 text-sm font-bold text-chocolate">{{ money(Number(r.default_trip_cost ?? 40)) }}</p>
          </div>
          <div>
            <p class="m-0 text-[0.6rem] font-semibold uppercase tracking-wide text-[var(--muted)]">Trips</p>
            <p class="m-0 text-sm font-bold text-chocolate">{{ r.active_trips ?? 0 }}</p>
          </div>
          <div>
            <p class="m-0 text-[0.6rem] font-semibold uppercase tracking-wide text-[var(--muted)]">Track</p>
            <p class="m-0 text-sm font-bold text-[#e9748e]">
              {{ selectedId === Number(r.id) ? "On" : "Tap" }}
            </p>
          </div>
        </div>

        <div class="mt-3 flex flex-wrap gap-1.5" @click.stop>
          <UButton size="xs" color="secondary" variant="soft" label="Edit / KYC" @click="openEdit(r)" />
          <UButton
            v-if="!(r.has_login || r.user_id)"
            size="xs"
            color="neutral"
            variant="soft"
            label="Enable login"
            @click="enableLogin(r)"
          />
          <UButton
            size="xs"
            color="neutral"
            variant="ghost"
            :label="r.is_available === false ? 'Set available' : 'Set busy'"
            @click="toggleAvailable(r)"
          />
        </div>
      </article>
    </div>

    <USlideover
      v-model:open="panelOpen"
      side="right"
      :title="form.id ? form.name || 'Edit rider' : 'Add rider'"
      description="Profile, optional login, Aadhaar · PAN · passport photo"
      :ui="{ content: 'w-full max-w-lg bg-[#fffaf8]' }"
    >
      <template #body>
        <form class="flex flex-col gap-3 pb-6" @submit.prevent="save">
          <div class="flex gap-3">
            <div class="size-16 shrink-0 overflow-hidden rounded-xl bg-[#fff5f7] ring-1 ring-[var(--line)]">
              <img
                v-if="thumb(form.photo_url)"
                :src="thumb(form.photo_url) || undefined"
                alt=""
                class="size-full object-cover"
              >
              <div v-else class="grid size-full place-items-center font-bold text-[#e9748e]">
                {{ initial(form.name) }}
              </div>
            </div>
            <div class="min-w-0">
              <p class="m-0 font-semibold text-chocolate">{{ form.id ? "Edit profile" : "New rider" }}</p>
              <p class="m-0 text-xs text-[var(--muted)]">Login password is optional for now</p>
            </div>
          </div>

          <label>
            <span class="sc-label">Name *</span>
            <input v-model="form.name" class="sc-input !rounded-xl" required>
          </label>
          <label>
            <span class="sc-label">Phone *</span>
            <input v-model="form.phone" class="sc-input !rounded-xl" placeholder="+91…" required>
          </label>
          <label>
            <span class="sc-label">Vehicle</span>
            <input v-model="form.vehicle_number" class="sc-input !rounded-xl" placeholder="OD-00-0000">
          </label>
          <div class="grid grid-cols-2 gap-3">
            <label>
              <span class="sc-label">Trip cost ₹</span>
              <input v-model.number="form.default_trip_cost" type="number" min="0" class="sc-input !rounded-xl">
            </label>
            <label>
              <span class="sc-label">Login password</span>
              <input
                v-model="form.password"
                type="password"
                class="sc-input !rounded-xl"
                :placeholder="form.id ? 'Leave blank to keep' : 'Optional'"
                autocomplete="new-password"
              >
            </label>
          </div>

          <label class="flex items-center gap-2 rounded-xl bg-[#fff9f5] px-3 py-2.5 ring-1 ring-[var(--line)]">
            <input v-model="form.is_available" type="checkbox" class="size-4 accent-[#e9748e]">
            <span class="text-sm font-semibold text-chocolate">Available for dispatch</span>
          </label>

          <div class="rounded-2xl bg-[#fff9f5] p-3 ring-1 ring-[var(--line)]">
            <p class="m-0 text-sm font-semibold text-chocolate">KYC documents</p>
            <p class="m-0 mt-0.5 text-xs text-[var(--muted)]">Passport photo · Aadhaar · PAN — optional now</p>
            <div class="mt-3 grid gap-3">
              <div v-for="doc in [
                { key: 'photo_url' as const, label: 'Passport photo' },
                { key: 'aadhaar_url' as const, label: 'Aadhaar card' },
                { key: 'pan_url' as const, label: 'PAN card' },
              ]" :key="doc.key" class="flex items-center gap-3">
                <div class="size-12 shrink-0 overflow-hidden rounded-lg bg-white ring-1 ring-[var(--line)]">
                  <img
                    v-if="thumb(form[doc.key]) && !String(form[doc.key]).toLowerCase().endsWith('.pdf')"
                    :src="thumb(form[doc.key]) || undefined"
                    alt=""
                    class="size-full object-cover"
                  >
                  <div v-else class="grid size-full place-items-center text-[0.65rem] text-[var(--muted)]">
                    {{ form[doc.key] ? "File" : "—" }}
                  </div>
                </div>
                <div class="min-w-0 flex-1">
                  <p class="m-0 text-xs font-semibold text-chocolate">{{ doc.label }}</p>
                  <p class="m-0 truncate text-[0.65rem] text-[var(--muted)]">{{ form[doc.key] || "Not uploaded" }}</p>
                  <div class="mt-1 flex gap-1">
                    <label class="cursor-pointer">
                      <span class="inline-flex items-center rounded-lg bg-white px-2 py-1 text-[0.65rem] font-semibold text-chocolate ring-1 ring-[var(--line)]">
                        {{ uploading === doc.key ? "…" : "Upload" }}
                      </span>
                      <input
                        type="file"
                        accept="image/*,application/pdf"
                        class="hidden"
                        :disabled="!!uploading"
                        @change="onUpload(doc.key, $event)"
                      >
                    </label>
                    <button
                      v-if="form[doc.key]"
                      type="button"
                      class="text-[0.65rem] font-semibold text-[#e9748e]"
                      @click="form[doc.key] = ''"
                    >
                      Clear
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="sticky bottom-0 mt-2 flex gap-2 bg-[#fffaf8]/95 pt-2 backdrop-blur">
            <UButton type="submit" color="secondary" :loading="busy" class="flex-1" :label="form.id ? 'Save changes' : 'Save rider'" />
            <UButton type="button" color="neutral" variant="soft" label="Cancel" @click="panelOpen = false" />
          </div>
        </form>
      </template>
    </USlideover>
  </div>
</template>

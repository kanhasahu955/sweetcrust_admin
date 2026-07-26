<script setup lang="ts">
/**
 * Google Map pin + Places search → autofill shop create fields.
 */
import { placeToDraft, type ShopPlaceDraft } from "~/utils/shopDraft"

const emit = defineEmits<{
  filled: [draft: ShopPlaceDraft]
}>()

const api = useApi()
const { loadGoogleMaps, key: mapsKey } = useGoogleMaps()
const toast = useAppToast()

const mapEl = ref<HTMLElement | null>(null)
const q = ref("")
const suggestions = ref<Record<string, unknown>[]>([])
const nearby = ref<Record<string, unknown>[]>([])
const busy = ref(false)
const loadError = ref("")
const sessionToken = ref(`${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`)

const CITY: [number, number] = [19.3149, 84.7941]

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let gmaps: any = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let map: any = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pin: any = null
const placeMarkers = new Map<string, { setMap: (m: unknown) => void }>()
let suggestTimer: ReturnType<typeof setTimeout> | null = null

function applyDetails(raw: Record<string, unknown> | null | undefined) {
  if (!raw || raw.latitude == null || raw.longitude == null) {
    toast.error("No address for this place")
    return
  }
  const draft = placeToDraft(raw)
  emit("filled", draft)
  const lat = Number(raw.latitude)
  const lng = Number(raw.longitude)
  dropPin(lat, lng)
  map?.panTo({ lat, lng })
  map?.setZoom(16)
  toast.success(draft.shop_name || "Location set")
}

async function resolvePlaceId(placeId: string) {
  busy.value = true
  try {
    const details = await api.geo.place(placeId, sessionToken.value)
    applyDetails(details)
    sessionToken.value = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    suggestions.value = []
  } catch {
    toast.error("Could not load place")
  } finally {
    busy.value = false
  }
}

async function resolvePin(lat: number, lng: number) {
  busy.value = true
  try {
    const details = await api.geo.reverse(lat, lng)
    applyDetails(details || { latitude: lat, longitude: lng, address_line: `${lat.toFixed(5)}, ${lng.toFixed(5)}` })
    void loadNearby(lat, lng)
  } catch {
    applyDetails({ latitude: lat, longitude: lng, address_line: `${lat.toFixed(5)}, ${lng.toFixed(5)}` })
  } finally {
    busy.value = false
  }
}

function dropPin(lat: number, lng: number) {
  if (!map || !gmaps) return
  if (!pin) {
    pin = new gmaps.maps.Marker({
      map,
      position: { lat, lng },
      draggable: true,
      icon: {
        path: gmaps.maps.SymbolPath.CIRCLE,
        scale: 11,
        fillColor: "#e9748e",
        fillOpacity: 1,
        strokeColor: "#4a2c2a",
        strokeWeight: 2,
      },
    })
    pin.addListener("dragend", () => {
      const p = pin.getPosition()
      if (p) void resolvePin(p.lat(), p.lng())
    })
  } else {
    pin.setPosition({ lat, lng })
    pin.setMap(map)
  }
}

function clearPlaceMarkers() {
  for (const m of placeMarkers.values()) m.setMap(null)
  placeMarkers.clear()
}

function showNearbyMarkers(rows: Record<string, unknown>[]) {
  if (!map || !gmaps) return
  clearPlaceMarkers()
  for (const row of rows) {
    const placeId = String(row.place_id || "")
    const lat = Number(row.latitude)
    const lng = Number(row.longitude)
    if (!placeId || !Number.isFinite(lat) || !Number.isFinite(lng)) continue
    const m = new gmaps.maps.Marker({
      map,
      position: { lat, lng },
      title: String(row.name || "Shop"),
      label: {
        text: String(row.name || "?").slice(0, 1).toUpperCase(),
        color: "#4a2c2a",
        fontWeight: "700",
        fontSize: "11px",
      },
      icon: {
        path: gmaps.maps.SymbolPath.CIRCLE,
        scale: 14,
        fillColor: "#fff9f5",
        fillOpacity: 1,
        strokeColor: "#e9748e",
        strokeWeight: 2,
        strokeOpacity: 1,
      },
    })
    m.addListener("click", () => void resolvePlaceId(placeId))
    placeMarkers.set(placeId, m)
  }
}

async function loadNearby(lat: number, lng: number) {
  try {
    const rows = await api.geo.nearby(lat, lng, 30000, 60)
    nearby.value = Array.isArray(rows) ? rows : []
    showNearbyMarkers(nearby.value)
  } catch {
    nearby.value = []
  }
}

function onQuery() {
  if (suggestTimer) clearTimeout(suggestTimer)
  const text = q.value.trim()
  if (text.length < 2) {
    suggestions.value = []
    return
  }
  suggestTimer = setTimeout(async () => {
    try {
      const rows = await api.geo.suggest(text, 6, sessionToken.value)
      suggestions.value = Array.isArray(rows) ? rows : []
    } catch {
      suggestions.value = []
    }
  }, 280)
}

async function boot() {
  if (!import.meta.client || !mapEl.value) return
  try {
    if (!mapsKey.value) throw new Error("Set NUXT_PUBLIC_GOOGLE_MAPS_API_KEY")
    const g = await loadGoogleMaps()
    gmaps = g
    map = new g.maps.Map(mapEl.value, {
      center: { lat: CITY[0], lng: CITY[1] },
      zoom: 14,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
      clickableIcons: true,
    })
    map.addListener("click", (e: { latLng?: { lat: () => number; lng: () => number }; placeId?: string; stop?: () => void }) => {
      const lat = e.latLng?.lat()
      const lng = e.latLng?.lng()
      if (lat == null || lng == null) return
      if (e.placeId) {
        e.stop?.()
        void resolvePlaceId(e.placeId)
        return
      }
      void resolvePin(lat, lng)
    })
    dropPin(CITY[0], CITY[1])
    void loadNearby(CITY[0], CITY[1])
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const lat = pos.coords.latitude
          const lng = pos.coords.longitude
          map.setCenter({ lat, lng })
          dropPin(lat, lng)
          void loadNearby(lat, lng)
        },
        () => {},
        { enableHighAccuracy: true, timeout: 8000 },
      )
    }
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : "Map failed"
  }
}

onMounted(() => {
  void boot()
})

onBeforeUnmount(() => {
  if (suggestTimer) clearTimeout(suggestTimer)
  clearPlaceMarkers()
  pin?.setMap(null)
  map = null
})
</script>

<template>
  <div class="overflow-hidden rounded-xl border border-[var(--line)] bg-[#fff9f5]">
    <div class="relative border-b border-[var(--line)] p-2">
      <div class="relative">
        <UIcon name="i-lucide-search" class="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-[var(--muted)]" />
        <input
          v-model="q"
          class="sc-input w-full !rounded-lg !py-2 !pl-8"
          placeholder="Search bakery / shop on Google…"
          @input="onQuery"
        >
      </div>
      <ul
        v-if="suggestions.length"
        class="absolute left-2 right-2 z-20 mt-1 max-h-48 overflow-auto rounded-lg border border-[var(--line)] bg-white shadow-lg"
      >
        <li v-for="s in suggestions" :key="String(s.place_id)">
          <button
            type="button"
            class="block w-full px-3 py-2 text-left text-sm text-chocolate hover:bg-[#fff5f7]"
            :disabled="busy"
            @click="resolvePlaceId(String(s.place_id))"
          >
            {{ s.label || s.address_line }}
          </button>
        </li>
      </ul>
    </div>
    <div ref="mapEl" class="h-56 w-full bg-[#f3e7e0]" />
    <p v-if="loadError" class="m-0 px-3 py-2 text-xs text-danger">{{ loadError }}</p>
    <p v-else class="m-0 px-3 py-2 text-[0.7rem] text-[var(--muted)]">
      Tap a Google shop, search, or drag the pink pin — details fill automatically.
      <span v-if="busy" class="text-[#e9748e]"> · Loading…</span>
    </p>
    <div v-if="nearby.length" class="flex flex-wrap gap-1.5 border-t border-[var(--line)] px-2 py-2">
      <button
        v-for="n in nearby.slice(0, 8)"
        :key="String(n.place_id)"
        type="button"
        class="rounded-full bg-white px-2.5 py-1 text-[0.7rem] font-semibold text-chocolate ring-1 ring-[var(--line)] hover:ring-[#e9748e]"
        :disabled="busy"
        @click="resolvePlaceId(String(n.place_id))"
      >
        {{ n.name }}
      </button>
    </div>
  </div>
</template>

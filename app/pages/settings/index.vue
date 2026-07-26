<script setup lang="ts">
import { apiError, relativeAgo } from "~/utils/format"
import { resolveMediaUrl } from "~/utils/mapPins"

type Tab =
  | "account"
  | "bakery"
  | "delivery"
  | "policies"
  | "location"
  | "apis"
  | "notifications"
  | "live"
  | "config"

const api = useApi()
const auth = useAuthStore()
const toast = useAppToast()
const config = useRuntimeConfig()
const route = useRoute()
const socketLive = useState("adminSocketLive", () => false)
const { connect } = useSocket()
const { setPrefs } = useAdminNotifyPrefs()

const loading = ref(true)
const busy = ref(false)
const accountBusy = ref(false)
const pwBusy = ref(false)
const checking = ref(false)
const locating = ref(false)
const liveBusy = ref(false)
const uploading = ref(false)
const error = ref("")
const dirty = ref(false)
const tab = ref<Tab>("account")
const updatedAt = ref("")
const fileRef = ref<HTMLInputElement | null>(null)

const integrations = ref<Record<string, unknown> | null>(null)
const platform = ref<Record<string, unknown> | null>(null)
const liveCheck = ref<{ razorpay?: Record<string, unknown>, imagekit?: Record<string, unknown> } | null>(null)
const stats = ref({
  has_logo: false,
  has_gstin: false,
  has_upi: false,
  cod_enabled: true,
  integrations_ready: 0,
  integrations_total: 4,
})

const profile = reactive({
  name: "",
  email: "",
  phone: "",
  language: "en",
  avatar_url: "",
  role: "",
  email_verified: false,
})

const password = reactive({
  current: "",
  next: "",
  confirm: "",
})

const notify = reactive({
  orders: true,
  chat: true,
  tickets: true,
  payments: true,
  returns: true,
  sound: true,
})

const live = reactive({
  gatewayOk: null as boolean | null,
  gatewayUrl: String(config.public.apiBase || "").replace(/\/$/, ""),
  socketUrl: String(config.public.socketBase || "").replace(/\/$/, ""),
  up: 0,
  down: 0,
  total: 0,
  avgMs: null as number | null,
  probedAt: "",
  note: "",
  top: [] as { name: string, ok?: boolean | null, ms?: number | null, group?: string }[],
})

const form = reactive({
  bakery_name: "",
  owner_name: "",
  phone: "",
  email: "",
  address: "",
  gstin: "",
  upi_id: "",
  logo_url: "",
  latitude: 19.1709305,
  longitude: 84.7192807,
  delivery_charge: 40,
  free_delivery_min: 499,
  min_order_value: 149,
  cod_enabled: true,
  chatbot_tone: "warm",
  cancellation_policy: "",
  return_policy: "",
  refund_policy: "",
  delivery_slots: "10:00-12:00, 12:00-14:00, 16:00-18:00, 18:00-20:00",
  open_time: "09:00",
  close_time: "21:00",
  bank_name: "",
  account_name: "",
  account_number: "",
  ifsc: "",
  gst_pct: 5,
  chatbot_languages: "en, hi",
})

const tabs: { value: Tab, label: string, icon: string }[] = [
  { value: "account", label: "Account", icon: "i-lucide-user-round" },
  { value: "bakery", label: "Bakery", icon: "i-lucide-store" },
  { value: "delivery", label: "Delivery", icon: "i-lucide-truck" },
  { value: "policies", label: "Policies", icon: "i-lucide-scroll-text" },
  { value: "location", label: "Location", icon: "i-lucide-map-pin" },
  { value: "apis", label: "APIs", icon: "i-lucide-plug" },
  { value: "notifications", label: "Alerts", icon: "i-lucide-bell" },
  { value: "live", label: "Live", icon: "i-lucide-activity" },
  { value: "config", label: "Config", icon: "i-lucide-sliders-horizontal" },
]

const toneOptions = [
  { value: "warm", label: "Warm" },
  { value: "friendly", label: "Friendly" },
  { value: "professional", label: "Professional" },
  { value: "playful", label: "Playful" },
]

const mapsConfigured = computed(() => Boolean(String(config.public.googleMapsApiKey || "").trim()))

const notifyList = [
  { key: "orders" as const, label: "New orders", hint: "Toast when an order lands" },
  { key: "chat" as const, label: "Chat messages", hint: "Customer / shop chats" },
  { key: "tickets" as const, label: "Support tickets", hint: "New or updated tickets" },
  { key: "payments" as const, label: "Payments", hint: "Razorpay / COD updates" },
  { key: "returns" as const, label: "Returns", hint: "Return request changes" },
  { key: "sound" as const, label: "Sound", hint: "Play chime with alerts" },
]

function logoSrc(url: string) {
  return resolveMediaUrl(url, String(config.public.apiBase || "")) || ""
}

function applySettings(s: Record<string, unknown>) {
  integrations.value = (s.integrations as Record<string, unknown>) || null
  platform.value = (s.platform as Record<string, unknown>) || null
  if (s.stats && typeof s.stats === "object") {
    const st = s.stats as Record<string, unknown>
    stats.value = {
      has_logo: Boolean(st.has_logo),
      has_gstin: Boolean(st.has_gstin),
      has_upi: Boolean(st.has_upi),
      cod_enabled: st.cod_enabled !== false,
      integrations_ready: Number(st.integrations_ready) || 0,
      integrations_total: Number(st.integrations_total) || 4,
    }
  }
  updatedAt.value = String(s.updated_at || "")
  const wh = (s.working_hours || {}) as { delivery_slots?: string[] }
  const slots = Array.isArray(wh.delivery_slots) ? wh.delivery_slots.join(", ") : form.delivery_slots
  const bank = (s.bank_details || {}) as Record<string, unknown>
  const tax = (s.tax_settings || {}) as Record<string, unknown>
  const langs = Array.isArray(s.chatbot_languages)
    ? (s.chatbot_languages as string[]).join(", ")
    : form.chatbot_languages
  const prefs = (s.notification_prefs || {}) as Record<string, unknown>
  Object.assign(notify, {
    orders: prefs.orders !== false,
    chat: prefs.chat !== false,
    tickets: prefs.tickets !== false,
    payments: prefs.payments !== false,
    returns: prefs.returns !== false,
    sound: prefs.sound !== false,
  })
  setPrefs(notify)
  Object.assign(form, {
    bakery_name: String(s.bakery_name || ""),
    owner_name: String(s.owner_name || ""),
    phone: String(s.phone || ""),
    email: String(s.email || ""),
    address: String(s.address || ""),
    gstin: String(s.gstin || ""),
    upi_id: String(s.upi_id || ""),
    logo_url: String(s.logo_url || ""),
    latitude: Number(s.latitude ?? 19.1709305),
    longitude: Number(s.longitude ?? 84.7192807),
    delivery_charge: Number(s.delivery_charge ?? 40),
    free_delivery_min: Number(s.free_delivery_min ?? 499),
    min_order_value: Number(s.min_order_value ?? 149),
    cod_enabled: s.cod_enabled !== false,
    chatbot_tone: String(s.chatbot_tone || "warm"),
    cancellation_policy: String(s.cancellation_policy || ""),
    return_policy: String(s.return_policy || ""),
    refund_policy: String(s.refund_policy || ""),
    delivery_slots: slots,
    open_time: String(s.open_time || "09:00").slice(0, 5),
    close_time: String(s.close_time || "21:00").slice(0, 5),
    bank_name: String(bank.bank_name || ""),
    account_name: String(bank.account_name || ""),
    account_number: String(bank.account_number || ""),
    ifsc: String(bank.ifsc || ""),
    gst_pct: Number(tax.gst_pct ?? 5),
    chatbot_languages: langs,
  })
  dirty.value = false
}

function applyProfile(u: Record<string, unknown>) {
  Object.assign(profile, {
    name: String(u.name || ""),
    email: String(u.email || ""),
    phone: String(u.phone || ""),
    language: String(u.language || "en"),
    avatar_url: String(u.avatar_url || ""),
    role: String(u.role || ""),
    email_verified: Boolean(u.email_verified),
  })
}

async function loadLive(opts?: { quiet?: boolean }) {
  if (!opts?.quiet) liveBusy.value = true
  try {
    const [gw, reg] = await Promise.all([
      api.gatewayHealth().catch(() => ({ ok: false })),
      api.services(),
    ])
    live.gatewayOk = gw?.ok !== false
    live.gatewayUrl = String(reg.gateway || live.gatewayUrl)
    live.socketUrl = String(reg.socket || live.socketUrl || config.public.socketBase || "")
    live.note = String(reg.note || "")
    live.probedAt = String(reg.probed_at || "")
    const st = reg.stats || { total: 0, up: 0, down: 0, avg_ms: null }
    live.total = Number(st.total) || 0
    live.up = Number(st.up) || 0
    live.down = Number(st.down) || 0
    live.avgMs = st.avg_ms == null ? null : Number(st.avg_ms)
    live.top = (reg.services || [])
      .filter((s) => s.group === "admin" || ["store_ops", "auth", "gateway", "realtime"].includes(s.name))
      .slice(0, 8)
      .map((s) => ({ name: s.name, ok: s.ok, ms: s.ms, group: s.group }))
  } catch (e) {
    if (!opts?.quiet) toast.error(apiError(e))
  } finally {
    liveBusy.value = false
  }
}

async function load(opts?: { quiet?: boolean }) {
  if (!opts?.quiet) loading.value = true
  error.value = ""
  try {
    const [settings, me] = await Promise.all([
      api.admin.settings() as Promise<Record<string, unknown>>,
      api.auth.me().catch(() => null),
    ])
    applySettings(settings)
    if (me) {
      applyProfile(me as Record<string, unknown>)
      auth.setTokens(auth.accessToken, auth.refreshToken, {
        id: Number(me.id),
        phone: String(me.phone || ""),
        name: me.name,
        email: me.email,
        role: String(me.role || "admin"),
      })
    }
    if (tab.value === "live") void loadLive({ quiet: true })
  } catch (e) {
    error.value = apiError(e)
    if (!opts?.quiet) toast.error(error.value)
  } finally {
    loading.value = false
  }
}

function markDirty() {
  dirty.value = true
}

function buildBody() {
  const slots = form.delivery_slots
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
  const langs = form.chatbot_languages
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
  return {
    bakery_name: form.bakery_name.trim(),
    owner_name: form.owner_name.trim(),
    phone: form.phone.trim(),
    email: form.email.trim(),
    address: form.address.trim(),
    gstin: form.gstin.trim(),
    upi_id: form.upi_id.trim(),
    logo_url: form.logo_url.trim(),
    latitude: Number(form.latitude),
    longitude: Number(form.longitude),
    delivery_charge: Number(form.delivery_charge),
    free_delivery_min: Number(form.free_delivery_min),
    min_order_value: Number(form.min_order_value),
    cod_enabled: Boolean(form.cod_enabled),
    chatbot_tone: form.chatbot_tone.trim() || "warm",
    cancellation_policy: form.cancellation_policy.trim(),
    return_policy: form.return_policy.trim(),
    refund_policy: form.refund_policy.trim(),
    working_hours: { delivery_slots: slots },
    open_time: form.open_time || null,
    close_time: form.close_time || null,
    bank_details: {
      bank_name: form.bank_name.trim(),
      account_name: form.account_name.trim(),
      account_number: form.account_number.trim(),
      ifsc: form.ifsc.trim().toUpperCase(),
    },
    tax_settings: { gst_pct: Number(form.gst_pct) || 0 },
    chatbot_languages: langs,
    notification_prefs: { ...notify },
  }
}

async function save() {
  if (!form.bakery_name.trim()) {
    toast.error("Bakery name required")
    tab.value = "bakery"
    return
  }
  if (form.email && !form.email.includes("@")) {
    toast.error("Enter a valid email")
    tab.value = "bakery"
    return
  }
  // Address was saved earlier without geocoding — fix pin before persist.
  if (form.address.trim() && looksLikeStaleMumbaiPin(Number(form.latitude), Number(form.longitude))) {
    await locateFromAddress({ quiet: true })
  }
  busy.value = true
  error.value = ""
  try {
    applySettings((await api.admin.updateSettings(buildBody())) as Record<string, unknown>)
    setPrefs(notify)
    toast.success("Settings saved")
  } catch (e) {
    error.value = apiError(e)
    toast.error(error.value)
  } finally {
    busy.value = false
  }
}

async function saveProfile() {
  if (!profile.name.trim()) {
    toast.error("Name required")
    return
  }
  accountBusy.value = true
  try {
    const me = await api.auth.updateMe({
      name: profile.name.trim(),
      email: profile.email.trim() || undefined,
      language: profile.language.trim() || "en",
      avatar_url: profile.avatar_url.trim() || undefined,
    })
    applyProfile(me as Record<string, unknown>)
    auth.setTokens(auth.accessToken, auth.refreshToken, {
      id: Number(me.id),
      phone: String(me.phone || ""),
      name: me.name,
      email: me.email,
      role: String(me.role || "admin"),
    })
    toast.success("Profile updated")
  } catch (e) {
    toast.error(apiError(e))
  } finally {
    accountBusy.value = false
  }
}

async function savePassword() {
  if (password.next.length < 6) {
    toast.error("New password must be at least 6 characters")
    return
  }
  if (password.next !== password.confirm) {
    toast.error("Passwords do not match")
    return
  }
  pwBusy.value = true
  try {
    await api.auth.changePassword({
      current_password: password.current,
      new_password: password.next,
    })
    password.current = ""
    password.next = ""
    password.confirm = ""
    toast.success("Password changed")
  } catch (e) {
    toast.error(apiError(e))
  } finally {
    pwBusy.value = false
  }
}

async function logout() {
  try {
    await api.auth.logout(auth.refreshToken)
  } catch {
    /* still clear local */
  }
  auth.clear()
  await navigateTo("/login")
}

/** Old Mumbai seed still in some DBs — address-only saves left the pin there. */
function looksLikeStaleMumbaiPin(lat: number, lng: number) {
  return Math.abs(lat - 19.1197) < 0.02 && Math.abs(lng - 72.8468) < 0.02
}

/** Google Places autocomplete chokes on Open Location Codes (e.g. 5PC9+9P2). */
function cleanGeoQuery(raw: string) {
  return raw
    .replace(/\b[23456789CFGHJMPQRVWX]{4,}\+[23456789CFGHJMPQRVWX]{2,}\b/gi, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s,]+|[\s,]+$/g, "")
    .trim()
}

function locateQueryVariants(raw: string) {
  const cleaned = cleanGeoQuery(raw)
  const pin = (raw.match(/\b\d{6}\b/) || [])[0] || ""
  const variants = [
    cleaned,
    cleaned.replace(/,\s*India\s*$/i, "").trim(),
    // drop leading plus-code residue / keep locality core
    cleaned.split(",").slice(0, 3).join(",").trim(),
    pin ? `${pin}, Odisha, India` : "",
    pin,
  ].filter((q, i, arr) => q && arr.indexOf(q) === i)
  return variants
}

async function locateFromAddress(opts?: { quiet?: boolean }) {
  const raw = form.address.trim()
  if (!raw) {
    if (!opts?.quiet) toast.error("Add bakery address first")
    tab.value = "bakery"
    return false
  }
  locating.value = true
  try {
    let placeId = ""
    for (const q of locateQueryVariants(raw)) {
      const hits = await api.geo.suggest(q, 5)
      placeId = String(hits?.[0]?.place_id || "")
      if (placeId) break
    }
    if (!placeId) {
      if (!opts?.quiet) toast.error("No map match for this address")
      return false
    }
    const place = await api.geo.place(placeId)
    const lat = Number(place.latitude)
    const lng = Number(place.longitude)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      if (!opts?.quiet) toast.error("Place has no coordinates")
      return false
    }
    form.latitude = lat
    form.longitude = lng
    // Prefer human address without Plus Code prefix.
    const label = cleanGeoQuery(String(place.label || place.address_line || ""))
    if (label) form.address = label
    dirty.value = true
    if (!opts?.quiet) toast.success("Pin updated", `${lat.toFixed(5)}, ${lng.toFixed(5)}`)
    return true
  } catch (e) {
    if (!opts?.quiet) toast.error(apiError(e))
    return false
  } finally {
    locating.value = false
  }
}

async function checkCredentials() {
  checking.value = true
  error.value = ""
  try {
    liveCheck.value = await api.admin.integrationsCheck()
    const rz = liveCheck.value?.razorpay?.ok
    const ik = liveCheck.value?.imagekit?.ok
    toast.success(
      "Credentials checked",
      `Razorpay ${rz ? "OK" : "issue"} · ImageKit ${ik ? "OK" : "issue"}`,
    )
  } catch (e) {
    error.value = apiError(e)
    toast.error(error.value)
  } finally {
    checking.value = false
  }
}

async function onLogoPick(ev: Event) {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  if (!file.type.startsWith("image/")) {
    toast.error("Choose an image file")
    return
  }
  if (file.size > 8 * 1024 * 1024) {
    toast.error("Logo must be under 8MB")
    return
  }
  uploading.value = true
  try {
    const res = await api.uploadFile(file, "banner", "sweetcrust")
    const url = String(res.url || "")
    if (!url) throw new Error("Upload returned no URL")
    form.logo_url = url
    dirty.value = true
    toast.success("Logo uploaded — save to keep")
  } catch (e) {
    toast.error(apiError(e))
  } finally {
    uploading.value = false
    if (input) input.value = ""
  }
}

function clearLogo() {
  form.logo_url = ""
  dirty.value = true
}

function integOk(key: "razorpay" | "imagekit") {
  const liveRes = liveCheck.value?.[key]
  if (liveRes && typeof liveRes === "object" && "ok" in liveRes) return Boolean(liveRes.ok)
  return Boolean(integrations.value?.[key])
}

function flagOk(v: unknown) {
  return Boolean(v)
}

watch(tab, (t) => {
  if (t === "live") void loadLive()
  if (import.meta.client) {
    const url = new URL(window.location.href)
    url.searchParams.set("tab", t)
    history.replaceState(null, "", url.toString())
  }
})

let liveSocket: ReturnType<typeof connect> = null
onMounted(() => {
  const q = String(route.query.tab || "")
  if (tabs.some((t) => t.value === q)) tab.value = q as Tab
  void load()
  liveSocket = connect()
})
onBeforeUnmount(() => {
  liveSocket = null
})
</script>

<template>
  <div>
    <div class="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="font-display m-0 text-2xl text-chocolate sm:text-3xl">Settings</h1>
        <p class="m-0 mt-1 flex flex-wrap items-center gap-2 text-sm text-[var(--muted)]">
          <span
            class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.65rem] font-semibold"
            :class="socketLive ? 'bg-[#e8f6ee] text-[#2e7d4f]' : 'bg-[#f8ede6] text-[var(--muted)]'"
          >
            <span class="size-1.5 rounded-full" :class="socketLive ? 'animate-pulse bg-success' : 'bg-[#c4a39a]'" />
            {{ socketLive ? "Live" : "Offline" }}
          </span>
          <span>Account · bakery · APIs · alerts · live</span>
          <span v-if="updatedAt">· saved {{ relativeAgo(updatedAt) }}</span>
          <span v-if="dirty" class="rounded-full bg-[#fff0f2] px-2 py-0.5 text-[0.65rem] font-semibold text-[#e9748e]">
            Unsaved
          </span>
        </p>
      </div>
      <div class="flex flex-wrap gap-2">
        <UButton
          color="primary"
          variant="soft"
          icon="i-lucide-refresh-cw"
          :loading="loading"
          label="Refresh"
          @click="load()"
        />
        <UButton
          v-if="tab !== 'account' && tab !== 'live'"
          color="secondary"
          icon="i-lucide-save"
          label="Save settings"
          :loading="busy"
          :disabled="loading"
          @click="save"
        />
      </div>
    </div>

    <p v-if="error" class="mb-3 text-sm text-danger">{{ error }}</p>

    <div class="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="Admin" :value="profile.name || '—'" icon="lucide:user-round" hint="Signed-in profile" />
      <StatCard label="GSTIN" :value="stats.has_gstin ? 'Set' : 'Missing'" icon="lucide:badge-check" :tone="stats.has_gstin ? 'ok' : 'warn'" />
      <StatCard
        label="Platform"
        :value="`${stats.integrations_ready}/${stats.integrations_total}`"
        icon="lucide:plug"
        :tone="stats.integrations_ready >= 3 ? 'ok' : 'warn'"
        hint="Razorpay · ImageKit · Mail · Redis"
      />
      <StatCard
        label="Realtime"
        :value="socketLive ? 'Connected' : 'Offline'"
        icon="lucide:radio"
        :tone="socketLive ? 'ok' : 'warn'"
      />
    </div>

    <div class="mb-4 flex flex-wrap gap-1.5">
      <button
        v-for="t in tabs"
        :key="t.value"
        type="button"
        class="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition"
        :class="tab === t.value ? 'bg-chocolate text-cream' : 'bg-white text-chocolate ring-1 ring-[var(--line)]'"
        @click="tab = t.value"
      >
        <UIcon :name="t.icon" class="size-3.5" />
        {{ t.label }}
      </button>
    </div>

    <div v-if="loading" class="grid gap-3 lg:grid-cols-2">
      <div class="sc-skeleton h-72 rounded-2xl" />
      <div class="sc-skeleton h-72 rounded-2xl" />
    </div>

    <div v-else class="grid gap-4">
      <!-- Account -->
      <div v-show="tab === 'account'" class="grid gap-4 lg:grid-cols-2">
        <div class="rounded-2xl border border-[var(--line)] bg-white p-4 shadow-[0_8px_22px_-18px_rgba(74,44,42,0.35)]">
          <h2 class="font-display m-0 text-lg text-chocolate">Admin profile</h2>
          <p class="m-0 mb-3 text-xs text-[var(--muted)]">
            {{ profile.role || "admin" }}
            <span v-if="profile.email_verified"> · email verified</span>
          </p>
          <div class="grid gap-3">
            <label>
              <span class="sc-label">Name</span>
              <input v-model="profile.name" class="sc-input !rounded-xl">
            </label>
            <label>
              <span class="sc-label">Email</span>
              <input v-model="profile.email" type="email" class="sc-input !rounded-xl">
            </label>
            <label>
              <span class="sc-label">Phone</span>
              <input :value="profile.phone" class="sc-input !rounded-xl" disabled>
            </label>
            <label>
              <span class="sc-label">Language</span>
              <select v-model="profile.language" class="sc-input !rounded-xl">
                <option value="en">English</option>
                <option value="hi">Hindi</option>
                <option value="or">Odia</option>
              </select>
            </label>
            <div class="flex flex-wrap gap-2 pt-1">
              <UButton color="secondary" :loading="accountBusy" label="Save profile" @click="saveProfile" />
              <UButton color="neutral" variant="soft" label="Log out" @click="logout" />
            </div>
          </div>
        </div>

        <div class="rounded-2xl border border-[var(--line)] bg-white p-4 shadow-[0_8px_22px_-18px_rgba(74,44,42,0.35)]">
          <h2 class="font-display m-0 text-lg text-chocolate">Change password</h2>
          <p class="m-0 mb-3 text-xs text-[var(--muted)]">Requires your current password</p>
          <div class="grid gap-3">
            <label>
              <span class="sc-label">Current password</span>
              <input v-model="password.current" type="password" class="sc-input !rounded-xl" autocomplete="current-password">
            </label>
            <label>
              <span class="sc-label">New password</span>
              <input v-model="password.next" type="password" class="sc-input !rounded-xl" autocomplete="new-password">
            </label>
            <label>
              <span class="sc-label">Confirm new password</span>
              <input v-model="password.confirm" type="password" class="sc-input !rounded-xl" autocomplete="new-password">
            </label>
            <UButton color="secondary" :loading="pwBusy" label="Update password" @click="savePassword" />
          </div>
        </div>
      </div>

      <form v-show="tab !== 'account' && tab !== 'live'" class="grid gap-4" @submit.prevent="save" @input="markDirty">
        <!-- Bakery -->
        <div v-show="tab === 'bakery'" class="grid gap-4 lg:grid-cols-[220px_1fr]">
          <div class="rounded-2xl border border-[var(--line)] bg-white p-4 shadow-[0_8px_22px_-18px_rgba(74,44,42,0.35)]">
            <p class="sc-label m-0 mb-2">Logo</p>
            <div class="relative flex aspect-square items-center justify-center overflow-hidden rounded-2xl bg-[#fff9f5] ring-1 ring-[var(--line)]">
              <img v-if="form.logo_url" :src="logoSrc(form.logo_url)" alt="Bakery logo" class="h-full w-full object-cover">
              <span v-else class="text-sm text-[var(--muted)]">No logo</span>
              <div class="absolute inset-x-2 bottom-2 flex gap-1.5">
                <UButton type="button" size="xs" color="secondary" class="flex-1" :loading="uploading" label="Upload" @click="fileRef?.click()" />
                <UButton v-if="form.logo_url" type="button" size="xs" color="neutral" variant="soft" label="Clear" @click="clearLogo" />
              </div>
            </div>
            <input ref="fileRef" type="file" accept="image/*" class="hidden" @change="onLogoPick">
          </div>
          <div class="grid gap-3 rounded-2xl border border-[var(--line)] bg-white p-4 shadow-[0_8px_22px_-18px_rgba(74,44,42,0.35)] sm:grid-cols-2">
            <label class="sm:col-span-2">
              <span class="sc-label">Bakery name</span>
              <input v-model="form.bakery_name" class="sc-input !rounded-xl" required>
            </label>
            <label>
              <span class="sc-label">Owner name</span>
              <input v-model="form.owner_name" class="sc-input !rounded-xl">
            </label>
            <label>
              <span class="sc-label">Phone</span>
              <input v-model="form.phone" class="sc-input !rounded-xl" placeholder="+91…">
            </label>
            <label>
              <span class="sc-label">Email</span>
              <input v-model="form.email" type="email" class="sc-input !rounded-xl">
            </label>
            <label>
              <span class="sc-label">GSTIN</span>
              <input v-model="form.gstin" class="sc-input !rounded-xl font-mono" placeholder="27AABCS1234A1Z5">
            </label>
            <label class="sm:col-span-2">
              <span class="sc-label">Address</span>
              <textarea v-model="form.address" rows="3" class="sc-input !rounded-xl" />
            </label>
            <label class="sm:col-span-2">
              <span class="sc-label">UPI ID</span>
              <input v-model="form.upi_id" class="sc-input !rounded-xl" placeholder="yourshop@upi">
            </label>
          </div>
        </div>

        <!-- Delivery -->
        <div v-show="tab === 'delivery'" class="grid gap-3 rounded-2xl border border-[var(--line)] bg-white p-4 shadow-[0_8px_22px_-18px_rgba(74,44,42,0.35)] sm:grid-cols-2">
          <label>
            <span class="sc-label">Delivery charge ₹</span>
            <input v-model.number="form.delivery_charge" type="number" min="0" step="1" class="sc-input !rounded-xl">
          </label>
          <label>
            <span class="sc-label">Free delivery above ₹</span>
            <input v-model.number="form.free_delivery_min" type="number" min="0" step="1" class="sc-input !rounded-xl">
          </label>
          <label>
            <span class="sc-label">Min order value ₹</span>
            <input v-model.number="form.min_order_value" type="number" min="0" step="1" class="sc-input !rounded-xl">
          </label>
          <label class="flex items-end gap-2 pb-2">
            <input v-model="form.cod_enabled" type="checkbox" class="size-4 accent-chocolate" @change="markDirty">
            <span class="text-sm font-semibold text-chocolate">COD enabled</span>
          </label>
          <label class="sm:col-span-2">
            <span class="sc-label">Delivery slots</span>
            <input v-model="form.delivery_slots" class="sc-input !rounded-xl" placeholder="10:00-12:00, 16:00-18:00">
          </label>
          <label>
            <span class="sc-label">Chatbot tone</span>
            <select v-model="form.chatbot_tone" class="sc-input !rounded-xl" @change="markDirty">
              <option v-for="o in toneOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
            </select>
          </label>
        </div>

        <!-- Policies -->
        <div v-show="tab === 'policies'" class="grid gap-3 rounded-2xl border border-[var(--line)] bg-white p-4 shadow-[0_8px_22px_-18px_rgba(74,44,42,0.35)]">
          <label>
            <span class="sc-label">Cancellation policy</span>
            <textarea v-model="form.cancellation_policy" rows="3" class="sc-input !rounded-xl" />
          </label>
          <label>
            <span class="sc-label">Return policy</span>
            <textarea v-model="form.return_policy" rows="3" class="sc-input !rounded-xl" />
          </label>
          <label>
            <span class="sc-label">Refund policy</span>
            <textarea v-model="form.refund_policy" rows="3" class="sc-input !rounded-xl" />
          </label>
        </div>

        <!-- Location -->
        <div v-show="tab === 'location'" class="grid gap-3 rounded-2xl border border-[var(--line)] bg-white p-4 shadow-[0_8px_22px_-18px_rgba(74,44,42,0.35)] sm:grid-cols-2">
          <label class="sm:col-span-2">
            <span class="sc-label">Address used for pin</span>
            <textarea v-model="form.address" rows="2" class="sc-input !rounded-xl" placeholder="Surala Junction, Girisola, Ganjam, Odisha 761009" />
          </label>
          <label>
            <span class="sc-label">Latitude</span>
            <input v-model.number="form.latitude" type="number" step="any" class="sc-input !rounded-xl">
          </label>
          <label>
            <span class="sc-label">Longitude</span>
            <input v-model.number="form.longitude" type="number" step="any" class="sc-input !rounded-xl">
          </label>
          <p
            v-if="looksLikeStaleMumbaiPin(Number(form.latitude), Number(form.longitude))"
            class="m-0 rounded-xl bg-[#fff0f2] px-3 py-2 text-sm text-[#c44d66] sm:col-span-2"
          >
            Pin still looks like the old Mumbai seed. Use Locate address → Ganjam / Odisha.
          </p>
          <div class="flex flex-wrap items-center gap-2 sm:col-span-2">
            <UButton
              type="button"
              color="secondary"
              icon="i-lucide-map-pinned"
              :loading="locating"
              label="Locate address"
              @click="locateFromAddress()"
            />
            <a
              class="text-sm font-semibold text-[#e9748e] hover:underline"
              :href="`https://www.google.com/maps?q=${form.latitude},${form.longitude}`"
              target="_blank"
              rel="noopener"
            >
              Open in Google Maps
            </a>
          </div>
          <p class="m-0 text-xs text-[var(--muted)] sm:col-span-2">
            Current pin:
            <span class="font-mono text-chocolate">{{ Number(form.latitude).toFixed(5) }}, {{ Number(form.longitude).toFixed(5) }}</span>
          </p>
        </div>

        <!-- APIs -->
        <div v-show="tab === 'apis'" class="rounded-2xl border border-[var(--line)] bg-white p-4 shadow-[0_8px_22px_-18px_rgba(74,44,42,0.35)]">
          <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 class="font-display m-0 text-lg text-chocolate">APIs & integrations</h2>
              <p class="m-0 text-xs text-[var(--muted)]">Secrets stay in backend / Nuxt env — never typed here</p>
            </div>
            <UButton type="button" color="primary" variant="soft" icon="i-lucide-shield-check" :loading="checking" label="Check credentials" @click="checkCredentials" />
          </div>
          <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <article class="rounded-2xl bg-[#fff9f5] p-3.5 ring-1 ring-[var(--line)]">
              <div class="flex items-start justify-between gap-2">
                <p class="m-0 font-semibold text-chocolate">Razorpay</p>
                <span class="rounded-full px-2 py-0.5 text-[0.65rem] font-semibold" :class="integOk('razorpay') ? 'bg-[#e8f6ee] text-[#2e7d4f]' : 'bg-[#fff0f2] text-[#e9748e]'">
                  {{ integOk('razorpay') ? 'Ready' : 'Missing' }}
                </span>
              </div>
              <p class="m-0 mt-1 text-sm text-[var(--muted)]">
                Env: {{ integrations?.razorpay ? 'configured' : 'missing' }}
                <span v-if="integrations?.razorpay_key_id_prefix"> · {{ integrations.razorpay_key_id_prefix }}</span>
              </p>
              <p v-if="liveCheck?.razorpay" class="m-0 mt-1 text-sm" :class="liveCheck.razorpay.ok ? 'text-[#2e7d4f]' : 'text-[#c0392b]'">
                Live: {{ liveCheck.razorpay.ok ? `valid (${liveCheck.razorpay.mode || 'ok'})` : (liveCheck.razorpay.detail || 'failed') }}
              </p>
            </article>
            <article class="rounded-2xl bg-[#fff9f5] p-3.5 ring-1 ring-[var(--line)]">
              <div class="flex items-start justify-between gap-2">
                <p class="m-0 font-semibold text-chocolate">ImageKit</p>
                <span class="rounded-full px-2 py-0.5 text-[0.65rem] font-semibold" :class="integOk('imagekit') ? 'bg-[#e8f6ee] text-[#2e7d4f]' : 'bg-[#fff0f2] text-[#e9748e]'">
                  {{ integOk('imagekit') ? 'Ready' : 'Local uploads' }}
                </span>
              </div>
              <p class="m-0 mt-1 text-sm text-[var(--muted)]">
                Env: {{ integrations?.imagekit ? 'configured' : 'missing' }} · {{ integrations?.imagekit_provider || 'local' }}
              </p>
            </article>
            <article class="rounded-2xl bg-[#fff9f5] p-3.5 ring-1 ring-[var(--line)]">
              <div class="flex items-start justify-between gap-2">
                <p class="m-0 font-semibold text-chocolate">SMTP mail</p>
                <span class="rounded-full px-2 py-0.5 text-[0.65rem] font-semibold" :class="flagOk(integrations?.mail) ? 'bg-[#e8f6ee] text-[#2e7d4f]' : 'bg-[#fff0f2] text-[#e9748e]'">
                  {{ flagOk(integrations?.mail) ? 'Ready' : 'Missing' }}
                </span>
              </div>
              <p class="m-0 mt-1 text-sm text-[var(--muted)]">Admin confirm / login notices</p>
            </article>
            <article class="rounded-2xl bg-[#fff9f5] p-3.5 ring-1 ring-[var(--line)]">
              <div class="flex items-start justify-between gap-2">
                <p class="m-0 font-semibold text-chocolate">Redis</p>
                <span class="rounded-full px-2 py-0.5 text-[0.65rem] font-semibold" :class="flagOk(integrations?.redis) ? 'bg-[#e8f6ee] text-[#2e7d4f]' : 'bg-[#fff0f2] text-[#e9748e]'">
                  {{ flagOk(integrations?.redis) ? 'Ready' : 'Missing' }}
                </span>
              </div>
              <p class="m-0 mt-1 text-sm text-[var(--muted)]">OTP cache · pub/sub · presence</p>
            </article>
            <article class="rounded-2xl bg-[#fff9f5] p-3.5 ring-1 ring-[var(--line)]">
              <div class="flex items-start justify-between gap-2">
                <p class="m-0 font-semibold text-chocolate">Google Maps</p>
                <span class="rounded-full px-2 py-0.5 text-[0.65rem] font-semibold" :class="mapsConfigured ? 'bg-[#e8f6ee] text-[#2e7d4f]' : 'bg-[#fff0f2] text-[#e9748e]'">
                  {{ mapsConfigured ? 'Ready' : 'Missing' }}
                </span>
              </div>
              <p class="m-0 mt-1 text-sm text-[var(--muted)]">NUXT_PUBLIC_GOOGLE_MAPS_API_KEY</p>
            </article>
            <article class="rounded-2xl bg-[#fff9f5] p-3.5 ring-1 ring-[var(--line)]">
              <p class="m-0 font-semibold text-chocolate">Gateway</p>
              <p class="m-0 mt-1 break-all font-mono text-xs text-[var(--muted)]">{{ live.gatewayUrl || '—' }}</p>
              <p class="m-0 mt-1 break-all font-mono text-xs text-[var(--muted)]">socket {{ live.socketUrl || '—' }}</p>
              <p v-if="platform?.env" class="m-0 mt-1 text-xs text-[var(--muted)]">env · {{ platform.env }}</p>
            </article>
          </div>
        </div>

        <!-- Notifications prefs -->
        <div v-show="tab === 'notifications'" class="rounded-2xl border border-[var(--line)] bg-white p-4 shadow-[0_8px_22px_-18px_rgba(74,44,42,0.35)]">
          <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 class="font-display m-0 text-lg text-chocolate">Alert preferences</h2>
              <p class="m-0 text-xs text-[var(--muted)]">Controls which live events toast in admin</p>
            </div>
            <UButton to="/notifications" color="neutral" variant="outline" icon="i-lucide-inbox" label="Open inbox" />
          </div>
          <div class="grid gap-2 sm:grid-cols-2">
            <label
              v-for="n in notifyList"
              :key="n.key"
              class="flex cursor-pointer items-start gap-3 rounded-xl bg-[#fff9f5] p-3 ring-1 ring-[var(--line)]"
            >
              <input v-model="notify[n.key]" type="checkbox" class="mt-0.5 size-4 accent-chocolate" @change="markDirty">
              <span>
                <span class="block text-sm font-semibold text-chocolate">{{ n.label }}</span>
                <span class="block text-xs text-[var(--muted)]">{{ n.hint }}</span>
              </span>
            </label>
          </div>
        </div>

        <!-- Config -->
        <div v-show="tab === 'config'" class="grid gap-3 rounded-2xl border border-[var(--line)] bg-white p-4 shadow-[0_8px_22px_-18px_rgba(74,44,42,0.35)] sm:grid-cols-2">
          <label>
            <span class="sc-label">Open time</span>
            <input v-model="form.open_time" type="time" class="sc-input !rounded-xl">
          </label>
          <label>
            <span class="sc-label">Close time</span>
            <input v-model="form.close_time" type="time" class="sc-input !rounded-xl">
          </label>
          <label>
            <span class="sc-label">GST %</span>
            <input v-model.number="form.gst_pct" type="number" min="0" step="0.5" class="sc-input !rounded-xl">
          </label>
          <label>
            <span class="sc-label">Chatbot languages</span>
            <input v-model="form.chatbot_languages" class="sc-input !rounded-xl" placeholder="en, hi, or">
          </label>
          <label class="sm:col-span-2">
            <span class="sc-label">Bank name</span>
            <input v-model="form.bank_name" class="sc-input !rounded-xl">
          </label>
          <label>
            <span class="sc-label">Account name</span>
            <input v-model="form.account_name" class="sc-input !rounded-xl">
          </label>
          <label>
            <span class="sc-label">Account number</span>
            <input v-model="form.account_number" class="sc-input !rounded-xl font-mono">
          </label>
          <label class="sm:col-span-2">
            <span class="sc-label">IFSC</span>
            <input v-model="form.ifsc" class="sc-input !rounded-xl font-mono uppercase" placeholder="SBIN0001234">
          </label>
        </div>

        <div class="sticky bottom-3 z-10 flex justify-end">
          <UButton type="submit" color="secondary" size="lg" icon="i-lucide-save" :loading="busy" :label="dirty ? 'Save changes' : 'Save settings'" />
        </div>
      </form>

      <!-- Live -->
      <div v-show="tab === 'live'" class="rounded-2xl border border-[var(--line)] bg-white p-4 shadow-[0_8px_22px_-18px_rgba(74,44,42,0.35)]">
        <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 class="font-display m-0 text-lg text-chocolate">Live platform</h2>
            <p class="m-0 text-xs text-[var(--muted)]">
              Socket {{ socketLive ? "connected" : "offline" }}
              <span v-if="live.probedAt"> · probed {{ relativeAgo(live.probedAt) }}</span>
            </p>
          </div>
          <div class="flex flex-wrap gap-2">
            <UButton color="primary" variant="soft" icon="i-lucide-refresh-cw" :loading="liveBusy" label="Probe" @click="loadLive()" />
            <UButton to="/services" color="neutral" variant="outline" icon="i-lucide-server" label="All services" />
          </div>
        </div>
        <div class="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Gateway" :value="live.gatewayOk ? 'Up' : 'Down'" icon="lucide:globe" :tone="live.gatewayOk ? 'ok' : 'warn'" />
          <StatCard label="Services up" :value="`${live.up}/${live.total}`" icon="lucide:server" :tone="live.down === 0 ? 'ok' : 'warn'" />
          <StatCard label="Avg latency" :value="live.avgMs != null ? `${Math.round(live.avgMs)} ms` : '—'" icon="lucide:gauge" />
          <StatCard label="Socket" :value="socketLive ? 'Live' : 'Offline'" icon="lucide:radio" :tone="socketLive ? 'ok' : 'warn'" />
        </div>
        <div class="grid gap-2 sm:grid-cols-2">
          <article
            v-for="s in live.top"
            :key="s.name"
            class="flex items-center justify-between rounded-xl bg-[#fff9f5] px-3 py-2.5 ring-1 ring-[var(--line)]"
          >
            <div>
              <p class="m-0 text-sm font-semibold text-chocolate">{{ s.name }}</p>
              <p class="m-0 text-xs text-[var(--muted)]">{{ s.group || "service" }}</p>
            </div>
            <span
              class="rounded-full px-2 py-0.5 text-[0.65rem] font-semibold"
              :class="s.ok ? 'bg-[#e8f6ee] text-[#2e7d4f]' : 'bg-[#fff0f2] text-[#e9748e]'"
            >
              {{ s.ok ? `up${s.ms != null ? ` · ${s.ms}ms` : ""}` : "down" }}
            </span>
          </article>
        </div>
        <p v-if="live.note" class="m-0 mt-3 text-xs text-[var(--muted)]">{{ live.note }}</p>
      </div>
    </div>
  </div>
</template>

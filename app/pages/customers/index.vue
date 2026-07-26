<script setup lang="ts">
import { apiError, displayPhone, money, relativeAgo, statusLabel } from "~/utils/format"
import { patchListRow, upsertListRow } from "~/utils/list"
import { resolveMediaUrl } from "~/utils/mapPins"

const api = useApi()
const toast = useAppToast()
const config = useRuntimeConfig()
const route = useRoute()
const router = useRouter()
const socketLive = useState("adminSocketLive", () => false)
const { connect } = useSocket()

const rows = ref<Record<string, unknown>[]>([])
const loading = ref(true)
const refreshing = ref(false)
const busy = ref(false)
const error = ref("")
const q = ref("")
const flag = ref<"all" | "online" | "guests" | "orders" | "inactive" | "high">("all")
const panelOpen = ref(false)
const detail = ref<Record<string, unknown> | null>(null)

const edit = reactive({
  id: 0,
  name: "",
  email: "",
  segment: "",
  notes: "",
  is_active: true,
})

const stats = ref({
  total: 0,
  online: 0,
  guests: 0,
  with_orders: 0,
  total_spent: 0,
})

const segmentOptions = [
  { value: "", label: "Auto / none" },
  { value: "new", label: "New" },
  { value: "loyal", label: "Loyal" },
  { value: "high_value", label: "High value" },
  { value: "inactive", label: "Inactive" },
  { value: "discount_focused", label: "Discount focused" },
  { value: "cake", label: "Cake" },
  { value: "corporate", label: "Corporate" },
]

const filterTabs = [
  { value: "all" as const, label: "All" },
  { value: "online" as const, label: "Online" },
  { value: "orders" as const, label: "With orders" },
  { value: "guests" as const, label: "Guests" },
  { value: "high" as const, label: "High spend" },
  { value: "inactive" as const, label: "Inactive" },
]

const filtered = computed(() => {
  const ql = q.value.trim().toLowerCase()
  return rows.value.filter((c) => {
    if (flag.value === "online" && !c.is_online) return false
    if (flag.value === "guests" && !c.is_guest) return false
    if (flag.value === "orders" && !(Number(c.total_orders) > 0)) return false
    if (flag.value === "high" && !(Number(c.total_spent) >= 1000 || Number(c.total_orders) >= 5)) return false
    if (flag.value === "inactive") {
      const seg = String(c.segment || c.segment_suggested || "")
      if (seg !== "inactive" && c.is_active !== false) return false
    }
    if (!ql) return true
    return (
      String(c.name || "").toLowerCase().includes(ql)
      || String(c.phone || "").toLowerCase().includes(ql)
      || String(c.email || "").toLowerCase().includes(ql)
      || String(c.segment || "").toLowerCase().includes(ql)
      || String(c.notes || "").toLowerCase().includes(ql)
    )
  })
})

function thumb(url: unknown) {
  return resolveMediaUrl(String(url || ""), String(config.public.apiBase || ""))
}

function initials(name: unknown) {
  const n = String(name || "C").trim()
  const parts = n.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return `${parts[0]![0]}${parts[1]![0]}`.toUpperCase()
  return n.slice(0, 2).toUpperCase()
}

function segmentLabel(c: Record<string, unknown>) {
  const s = String(c.segment || c.segment_suggested || "")
  if (!s) return "—"
  return statusLabel(s) + (c.segment ? "" : " · auto")
}

function parseList(data: unknown) {
  if (Array.isArray(data)) {
    rows.value = data as Record<string, unknown>[]
    stats.value = {
      total: rows.value.length,
      online: rows.value.filter((c) => c.is_online).length,
      guests: rows.value.filter((c) => c.is_guest).length,
      with_orders: rows.value.filter((c) => Number(c.total_orders) > 0).length,
      total_spent: rows.value.reduce((n, c) => n + (Number(c.total_spent) || 0), 0),
    }
    return
  }
  const obj = (data || {}) as { items?: unknown[]; stats?: Record<string, number> }
  rows.value = Array.isArray(obj.items) ? (obj.items as Record<string, unknown>[]) : []
  if (obj.stats) {
    stats.value = {
      total: Number(obj.stats.total) || rows.value.length,
      online: Number(obj.stats.online) || 0,
      guests: Number(obj.stats.guests) || 0,
      with_orders: Number(obj.stats.with_orders) || 0,
      total_spent: Number(obj.stats.total_spent) || 0,
    }
  }
}

async function load(opts?: { quiet?: boolean }) {
  if (opts?.quiet) refreshing.value = true
  else loading.value = true
  error.value = ""
  try {
    parseList(await api.admin.customers())
  } catch (e) {
    error.value = apiError(e)
  } finally {
    loading.value = false
    refreshing.value = false
  }
}

async function openCustomer(c: Record<string, unknown>) {
  const id = Number(c.id)
  panelOpen.value = true
  busy.value = true
  detail.value = { ...c }
  edit.id = id
  edit.name = String(c.name || "")
  edit.email = String(c.email || "")
  edit.segment = String(c.segment || "")
  edit.notes = String(c.notes || "")
  edit.is_active = c.is_active !== false
  void router.replace({ query: { ...route.query, id: String(id) } })
  try {
    const d = await api.admin.customer(id)
    detail.value = d
    edit.name = String(d.name || "")
    edit.email = String(d.email || "")
    edit.segment = String(d.segment || "")
    edit.notes = String(d.notes || "")
    edit.is_active = d.is_active !== false
    if (!upsertListRow(rows, d)) patchListRow(rows, id, d)
  } catch (e) {
    toast.error(apiError(e))
  } finally {
    busy.value = false
  }
}

function closePanel() {
  panelOpen.value = false
  const qy = { ...route.query }
  delete qy.id
  void router.replace({ query: qy })
}

async function save() {
  if (!edit.id) return
  busy.value = true
  try {
    const saved = await api.admin.patchCustomer(edit.id, {
      name: edit.name.trim() || undefined,
      email: edit.email.trim() || null,
      segment: edit.segment || null,
      notes: edit.notes.trim() || null,
      is_active: edit.is_active,
    })
    detail.value = saved
    if (!upsertListRow(rows, saved)) patchListRow(rows, edit.id, saved)
    toast.success("Customer updated")
    void load({ quiet: true })
  } catch (e) {
    toast.error(apiError(e))
  } finally {
    busy.value = false
  }
}

async function callCustomer() {
  if (!detail.value) return
  busy.value = true
  try {
    await api.admin.aiOutboundCall({
      user_id: Number(detail.value.id),
      phone: String(detail.value.phone || ""),
      purpose: "customer_followup",
    })
    toast.success("Outbound call queued")
  } catch (e) {
    toast.error(apiError(e))
  } finally {
    busy.value = false
  }
}

let liveSocket: ReturnType<typeof connect> = null
const onPresence = () => {
  void load({ quiet: true })
}

onMounted(async () => {
  await load()
  const qid = Number(route.query.id)
  if (qid) {
    const row = rows.value.find((c) => Number(c.id) === qid) || { id: qid }
    await openCustomer(row)
  }
  liveSocket = connect()
  liveSocket?.on("user_presence", onPresence)
  liveSocket?.on("admin_event", (data: Record<string, unknown>) => {
    const kind = String(data?.kind || "")
    if (kind.includes("order") || kind.includes("customer")) void load({ quiet: true })
  })
})
onBeforeUnmount(() => {
  liveSocket?.off("user_presence", onPresence)
})
</script>

<template>
  <div>
    <div class="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="font-display m-0 text-2xl text-chocolate sm:text-3xl">Customers</h1>
        <p class="m-0 mt-1 flex flex-wrap items-center gap-2 text-sm text-[var(--muted)]">
          <span
            class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.65rem] font-semibold"
            :class="socketLive ? 'bg-[#e8f6ee] text-[#2e7d4f]' : 'bg-[#f8ede6] text-[var(--muted)]'"
          >
            <span class="size-1.5 rounded-full" :class="socketLive ? 'animate-pulse bg-success' : 'bg-[#c4a39a]'" />
            {{ socketLive ? "Live" : "Offline" }}
          </span>
          <span>B2C locals — orders, spend, presence</span>
        </p>
      </div>
      <UButton
        color="primary"
        variant="soft"
        icon="i-lucide-refresh-cw"
        :loading="loading || refreshing"
        label="Refresh"
        @click="load()"
      />
    </div>

    <p v-if="error" class="mb-3 text-sm text-danger">{{ error }}</p>

    <div class="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="Customers" :value="stats.total" icon="lucide:users" />
      <StatCard label="Online now" :value="stats.online" icon="lucide:wifi" tone="ok" />
      <StatCard label="With orders" :value="stats.with_orders" icon="lucide:shopping-bag" />
      <StatCard label="Total spent" :value="money(stats.total_spent)" icon="lucide:wallet" />
    </div>

    <div class="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <label class="relative block w-full max-w-md">
        <UIcon name="i-lucide-search" class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--muted)]" />
        <input
          v-model="q"
          class="sc-input w-full !rounded-xl !py-2.5 !pl-9"
          placeholder="Search name, phone, email, notes…"
        >
      </label>
      <p class="m-0 text-sm text-[var(--muted)]">{{ filtered.length }} shown · {{ stats.guests }} guests</p>
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
        <span v-if="t.value === 'online'"> {{ stats.online }}</span>
        <span v-else-if="t.value === 'orders'"> {{ stats.with_orders }}</span>
        <span v-else-if="t.value === 'guests'"> {{ stats.guests }}</span>
      </button>
    </div>

    <div v-if="loading" class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <div v-for="n in 6" :key="n" class="sc-skeleton h-40 rounded-2xl" />
    </div>

    <div
      v-else-if="!filtered.length"
      class="rounded-2xl border border-dashed border-[var(--line)] py-16 text-center text-sm text-[var(--muted)]"
    >
      No customers match
    </div>

    <div v-else class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <article
        v-for="c in filtered"
        :key="String(c.id)"
        class="cursor-pointer rounded-2xl border border-[var(--line)] bg-white p-3.5 shadow-[0_8px_22px_-18px_rgba(74,44,42,0.35)] transition hover:border-[#e9748e]/35"
        @click="openCustomer(c)"
      >
        <div class="flex gap-3">
          <div class="relative size-14 shrink-0 overflow-hidden rounded-full bg-[#fff5f7] ring-1 ring-[var(--line)]">
            <img
              v-if="thumb(c.avatar_url)"
              :src="thumb(c.avatar_url) || undefined"
              alt=""
              class="size-full object-cover"
            >
            <div v-else class="grid size-full place-items-center text-sm font-bold text-[#e9748e]">
              {{ initials(c.name) }}
            </div>
            <span
              class="absolute bottom-0.5 right-0.5 size-3 rounded-full ring-2 ring-white"
              :class="c.is_online ? 'bg-success' : 'bg-[#d4b8ae]'"
            />
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex items-start justify-between gap-2">
              <p class="m-0 truncate font-semibold text-chocolate">{{ c.name || "Customer" }}</p>
              <span
                class="shrink-0 rounded-full px-2 py-0.5 text-[0.65rem] font-semibold"
                :class="c.is_online ? 'bg-[#e8f6ee] text-[#2e7d4f]' : 'bg-[#f8ede6] text-[var(--muted)]'"
              >
                {{ c.is_online ? "Online" : "Offline" }}
              </span>
            </div>
            <p class="m-0 mt-0.5 truncate text-xs text-[var(--muted)]">
              {{ displayPhone(String(c.phone || "")) }}
              <span v-if="c.email"> · {{ c.email }}</span>
            </p>
            <div class="mt-1.5 flex flex-wrap gap-1">
              <span
                v-if="c.is_guest"
                class="rounded-full bg-[#fff0f2] px-2 py-0.5 text-[0.65rem] font-semibold text-[#e9748e]"
              >
                Guest
              </span>
              <span class="rounded-full bg-[#fff9f5] px-2 py-0.5 text-[0.65rem] font-semibold capitalize text-chocolate ring-1 ring-[var(--line)]">
                {{ segmentLabel(c) }}
              </span>
              <span
                v-if="c.is_active === false"
                class="rounded-full bg-[#fdecea] px-2 py-0.5 text-[0.65rem] font-semibold text-[#c0392b]"
              >
                Disabled
              </span>
            </div>
          </div>
        </div>

        <div class="mt-3 grid grid-cols-3 gap-2 rounded-xl bg-[#fff9f5] px-2.5 py-2 text-center">
          <div>
            <p class="m-0 text-[0.6rem] font-semibold uppercase tracking-wide text-[var(--muted)]">Orders</p>
            <p class="m-0 text-sm font-bold text-chocolate">{{ c.total_orders ?? 0 }}</p>
          </div>
          <div>
            <p class="m-0 text-[0.6rem] font-semibold uppercase tracking-wide text-[var(--muted)]">Spent</p>
            <p class="m-0 text-sm font-bold text-chocolate">{{ money(Number(c.total_spent || 0)) }}</p>
          </div>
          <div>
            <p class="m-0 text-[0.6rem] font-semibold uppercase tracking-wide text-[var(--muted)]">Last order</p>
            <p class="m-0 truncate text-xs font-semibold text-chocolate">
              {{ c.last_order_at ? relativeAgo(String(c.last_order_at)) : "—" }}
            </p>
          </div>
        </div>
      </article>
    </div>

    <USlideover
      v-model:open="panelOpen"
      side="right"
      :title="edit.name || 'Customer'"
      description="Profile, segment, notes, recent orders"
      :ui="{ content: 'w-full max-w-lg bg-[#fffaf8]' }"
      @update:open="(v: boolean) => { if (!v) closePanel() }"
    >
      <template #body>
        <div v-if="detail" class="flex flex-col gap-3 pb-6">
          <div class="flex gap-3">
            <div class="relative size-16 shrink-0 overflow-hidden rounded-full bg-[#fff5f7] ring-1 ring-[var(--line)]">
              <img
                v-if="thumb(detail.avatar_url)"
                :src="thumb(detail.avatar_url) || undefined"
                alt=""
                class="size-full object-cover"
              >
              <div v-else class="grid size-full place-items-center font-bold text-[#e9748e]">
                {{ initials(edit.name) }}
              </div>
            </div>
            <div class="min-w-0">
              <p class="m-0 font-semibold text-chocolate">{{ edit.name }}</p>
              <p class="m-0 text-xs text-[var(--muted)]">
                {{ displayPhone(String(detail.phone || "")) }}
                ·
                {{ detail.is_online ? "Online" : detail.last_seen_at ? `Seen ${relativeAgo(String(detail.last_seen_at))}` : "Offline" }}
              </p>
              <div class="mt-2 flex flex-wrap gap-1.5">
                <UButton
                  v-if="detail.conversation_id"
                  size="xs"
                  color="secondary"
                  variant="soft"
                  icon="i-lucide-messages-square"
                  label="Open chat"
                  :to="`/chats?id=${detail.conversation_id}`"
                />
                <UButton
                  size="xs"
                  color="neutral"
                  variant="soft"
                  icon="i-lucide-phone"
                  label="Call"
                  :loading="busy"
                  @click="callCustomer"
                />
              </div>
            </div>
          </div>

          <form class="flex flex-col gap-3" @submit.prevent="save">
            <label>
              <span class="sc-label">Name</span>
              <input v-model="edit.name" class="sc-input !rounded-xl">
            </label>
            <label>
              <span class="sc-label">Email</span>
              <input v-model="edit.email" type="email" class="sc-input !rounded-xl" placeholder="optional">
            </label>
            <label>
              <span class="sc-label">Segment</span>
              <select v-model="edit.segment" class="sc-input !rounded-xl">
                <option v-for="s in segmentOptions" :key="s.value || 'none'" :value="s.value">{{ s.label }}</option>
              </select>
              <span v-if="detail.segment_suggested && !edit.segment" class="mt-1 block text-[0.7rem] text-[var(--muted)]">
                Suggested: {{ statusLabel(String(detail.segment_suggested)) }}
              </span>
            </label>
            <label>
              <span class="sc-label">Notes</span>
              <textarea v-model="edit.notes" rows="3" class="sc-input !rounded-xl min-h-20" placeholder="Internal notes…" />
            </label>
            <label class="flex items-center gap-2 rounded-xl bg-[#fff9f5] px-3 py-2.5 ring-1 ring-[var(--line)]">
              <input v-model="edit.is_active" type="checkbox" class="size-4 accent-[#e9748e]">
              <span class="text-sm font-semibold text-chocolate">Active account</span>
            </label>
            <UButton type="submit" color="secondary" :loading="busy" label="Save profile" />
          </form>

          <div class="rounded-2xl border border-[var(--line)] bg-white overflow-hidden">
            <div class="border-b border-[var(--line)] bg-[#fff9f5] px-3 py-2">
              <p class="m-0 text-sm font-semibold text-chocolate">Recent orders</p>
            </div>
            <ul v-if="Array.isArray(detail.recent_orders) && detail.recent_orders.length" class="m-0 divide-y divide-[var(--line)] p-0">
              <li
                v-for="o in (detail.recent_orders as Record<string, unknown>[])"
                :key="String(o.id)"
                class="flex items-center justify-between gap-2 px-3 py-2.5 text-sm"
              >
                <div class="min-w-0">
                  <NuxtLink :to="`/orders/${o.id}`" class="font-semibold text-chocolate hover:text-[#e9748e]">
                    {{ o.order_number || `#${o.id}` }}
                  </NuxtLink>
                  <p class="m-0 text-xs capitalize text-[var(--muted)]">
                    {{ statusLabel(String(o.status || "")) }} · {{ relativeAgo(String(o.created_at || "")) }}
                  </p>
                </div>
                <span class="shrink-0 font-bold text-chocolate">{{ money(Number(o.final_amount || 0)) }}</span>
              </li>
            </ul>
            <p v-else class="m-0 px-3 py-6 text-center text-xs text-[var(--muted)]">No orders yet</p>
          </div>
        </div>
      </template>
    </USlideover>
  </div>
</template>

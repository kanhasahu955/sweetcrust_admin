<script setup lang="ts">
import dayjs from "dayjs"
import {
  displayPhone,
  elapsedCompact,
  formatDateTime12,
  money,
  parseApiDate,
  statusLabel,
} from "~/utils/format"

const api = useApi()
const status = ref("")
const q = ref("")
const view = ref<"list" | "board">("list")
const loading = ref(true)
const refreshing = ref(false)
const error = ref("")
const rows = ref<Record<string, unknown>[]>([])
const shops = ref<Record<string, unknown>[]>([])
const riders = ref<Record<string, unknown>[]>([])
const selectedId = ref<number | null>(null)
const detail = ref<Record<string, unknown> | null>(null)
const detailItems = ref<Record<string, unknown>[]>([])
const detailLoading = ref(false)
const dashboardBump = useState("adminDashboardBump", () => 0)
const socketLive = useState("adminSocketLive", () => false)

let refreshTimer: ReturnType<typeof setTimeout> | null = null
const nowTick = ref(Date.now())
let tickTimer: ReturnType<typeof setInterval> | null = null

const tabs = [
  { label: "All", value: "" },
  { label: "Placed", value: "placed" },
  { label: "Accepted", value: "accepted" },
  { label: "Preparing", value: "preparing" },
  { label: "Packed", value: "packed" },
  { label: "Out", value: "out_for_delivery" },
  { label: "Delivered", value: "delivered" },
  { label: "Cancelled", value: "cancelled" },
]

function withLocalNames(o: Record<string, unknown>) {
  const shopId = Number(o.shop_user_id || 0)
  const riderId = Number(o.delivery_person_id || 0)
  const shop = shopId ? shops.value.find((s) => Number(s.user_id || s.id) === shopId) : null
  const rider = riderId ? riders.value.find((r) => Number(r.id) === riderId) : null
  return {
    ...o,
    customer_name: o.customer_name || null,
    shop_name: o.shop_name || shop?.shop_name || shop?.name || null,
    shop_owner: o.shop_owner || shop?.owner_name || null,
    shop_phone: o.shop_phone || shop?.contact_phone || shop?.phone || null,
    rider_name: o.rider_name || rider?.name || null,
    rider_phone: o.rider_phone || rider?.phone || null,
    rider_vehicle: o.rider_vehicle || rider?.vehicle_number || null,
  }
}

async function load(quiet = false) {
  if (quiet) refreshing.value = true
  else loading.value = true
  error.value = ""
  try {
    const [data, shopRows, riderRows] = await Promise.all([
      api.admin.orders(status.value || undefined),
      shops.value.length ? Promise.resolve(shops.value) : api.admin.shops().catch(() => []),
      riders.value.length ? Promise.resolve(riders.value) : api.admin.deliveryPersons().catch(() => []),
    ])
    if (!shops.value.length && Array.isArray(shopRows)) shops.value = shopRows as Record<string, unknown>[]
    if (!riders.value.length && Array.isArray(riderRows)) riders.value = riderRows as Record<string, unknown>[]
    const list = Array.isArray(data) ? (data as Record<string, unknown>[]) : []
    rows.value = list.map(withLocalNames)
  } catch (e) {
    error.value = apiError(e)
  } finally {
    loading.value = false
    refreshing.value = false
  }
}

function scheduleRefresh() {
  if (refreshTimer) clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => {
    void load(true)
    if (selectedId.value) void openDetail(selectedId.value, true)
  }, 400)
}

watch(dashboardBump, () => scheduleRefresh())
watch(status, () => {
  selectedId.value = null
  detail.value = null
  void load()
})

onMounted(() => {
  void load()
  tickTimer = setInterval(() => {
    nowTick.value = Date.now()
  }, 20000)
})

onBeforeUnmount(() => {
  if (refreshTimer) clearTimeout(refreshTimer)
  if (tickTimer) clearInterval(tickTimer)
})

const filtered = computed(() => {
  const needle = q.value.trim().toLowerCase()
  let list = rows.value
  if (status.value) {
    list = list.filter((o) => String(o.status || "").toLowerCase() === status.value)
  }
  if (!needle) return list
  return list.filter((o) => {
    const addr = addressLine(o)
    const hay = [
      o.order_number,
      o.status,
      o.payment_status,
      o.payment_method,
      o.order_type,
      o.customer_phone,
      o.customer_name,
      o.shop_name,
      o.shop_owner,
      o.rider_name,
      o.rider_phone,
      addr,
    ]
      .join(" ")
      .toLowerCase()
    return hay.includes(needle)
  })
})

const counts = computed(() => {
  const c: Record<string, number> = { all: rows.value.length }
  for (const t of tabs) {
    if (!t.value) continue
    c[t.value] = rows.value.filter((o) => String(o.status || "").toLowerCase() === t.value).length
  }
  return c
})

const boardCols = computed(() => {
  const cols = [
    { key: "placed", title: "New" },
    { key: "accepted", title: "Accepted" },
    { key: "preparing", title: "Preparing" },
    { key: "packed", title: "Packed" },
    { key: "out_for_delivery", title: "On road" },
  ]
  return cols.map((c) => ({
    ...c,
    items: filtered.value.filter((o) => String(o.status || "").toLowerCase() === c.key),
  }))
})

function orderId(o: Record<string, unknown>) {
  return Number(o.id)
}

function addressLine(o: Record<string, unknown>) {
  const snap = (o.address_snapshot || {}) as Record<string, unknown>
  const parts = [
    snap.line1 || snap.address_line1 || snap.street,
    snap.area || snap.locality,
    snap.city,
    snap.pincode || snap.pin,
  ]
    .map((x) => (x != null ? String(x).trim() : ""))
    .filter(Boolean)
  return parts.join(", ") || "—"
}

function customerLabel(o: Record<string, unknown>) {
  const snap = (o.address_snapshot || {}) as Record<string, unknown>
  const name = String(
    o.customer_name
    || snap.full_name
    || snap.name
    || snap.customer_name
    || snap.receiver_name
    || snap.shop_name
    || "",
  ).trim()
  const phone = displayPhone(String(o.customer_phone || snap.phone || ""))
  if (name && phone !== "—") return `${name} · ${phone}`
  if (name) return name
  if (phone !== "—") return phone
  return "Guest customer"
}

function shopLabel(o: Record<string, unknown>) {
  const name = String(o.shop_name || "").trim()
  if (name) return name
  const owner = String(o.shop_owner || "").trim()
  if (owner) return owner
  return "Direct / bakery"
}

function riderLabel(o: Record<string, unknown>) {
  const name = String(o.rider_name || "").trim()
  if (!name) return "No rider"
  const phone = displayPhone(String(o.rider_phone || ""))
  const vehicle = String(o.rider_vehicle || "").trim()
  const bits = [name]
  if (phone !== "—") bits.push(phone)
  if (vehicle) bits.push(vehicle)
  return bits.join(" · ")
}

function typeLabel(o: Record<string, unknown>) {
  const t = String(o.order_type || "").toLowerCase()
  if (t.includes("b2b") || t.includes("wholesale") || t.includes("shop")) return "B2B"
  if (t.includes("b2c")) return "B2C"
  return statusLabel(t || "order")
}

function ageLabel(o: Record<string, unknown>) {
  void nowTick.value
  const created = parseApiDate(o.created_at != null ? String(o.created_at) : null)
  if (!created) return "—"
  return elapsedCompact(dayjs().diff(created, "minute"))
}

function ageTone(o: Record<string, unknown>) {
  void nowTick.value
  const st = String(o.status || "").toLowerCase()
  if (["delivered", "cancelled"].includes(st)) return "muted"
  const created = parseApiDate(o.created_at != null ? String(o.created_at) : null)
  if (!created) return "muted"
  const mins = Math.max(0, dayjs().diff(created, "minute"))
  if (mins >= 45) return "danger"
  if (mins >= 20) return "warn"
  return "ok"
}

function whenLabel(o: Record<string, unknown>) {
  return formatDateTime12(o.created_at != null ? String(o.created_at) : null)
}

function slotLabel(o: Record<string, unknown>) {
  const slot = String(o.delivery_slot || "").trim()
  const date = o.delivery_date ? String(o.delivery_date).slice(0, 10) : ""
  if (slot && date) return `${date} · ${slot}`
  return slot || date || "ASAP"
}

async function openDetail(id: number, quiet = false) {
  selectedId.value = id
  if (!quiet) detailLoading.value = true
  try {
    const res = await api.admin.order(id)
    const nested = res.order && typeof res.order === "object" ? (res.order as Record<string, unknown>) : res
    detail.value = withLocalNames(nested)
    const items = res.items ?? res.lines ?? nested.items
    detailItems.value = Array.isArray(items) ? (items as Record<string, unknown>[]) : []
  } catch (e) {
    error.value = apiError(e)
  } finally {
    detailLoading.value = false
  }
}

function closeDetail() {
  selectedId.value = null
  detail.value = null
  detailItems.value = []
}

function lineName(line: Record<string, unknown>) {
  return String(line.product_name || line.name || `#${line.product_id || ""}`)
}

function selectRow(o: Record<string, unknown>) {
  void openDetail(orderId(o))
}
</script>

<template>
  <div>
    <div class="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <p class="m-0 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-[#e9748e]">Fulfillment</p>
        <h1 class="font-display m-0 mt-1 text-2xl text-chocolate sm:text-3xl">Orders</h1>
        <p class="m-0 mt-1 text-sm text-[var(--muted)]">
          Status, payment, delivery, and line items
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
        </p>
      </div>
      <div class="flex flex-wrap gap-2">
        <UButton
          color="neutral"
          variant="outline"
          size="sm"
          :icon="view === 'list' ? 'i-lucide-columns-3' : 'i-lucide-list'"
          :label="view === 'list' ? 'Board' : 'List'"
          @click="view = view === 'list' ? 'board' : 'list'"
        />
        <UButton
          color="primary"
          variant="soft"
          size="sm"
          icon="i-lucide-refresh-cw"
          :loading="loading || refreshing"
          label="Refresh"
          @click="load()"
        />
        <UButton to="/picking" color="secondary" size="sm" icon="i-lucide-clipboard-list" label="Picking" />
      </div>
    </div>

    <div class="mb-4 flex flex-wrap gap-1.5">
      <button
        v-for="t in tabs"
        :key="t.value || 'all'"
        type="button"
        class="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition"
        :class="status === t.value ? 'bg-chocolate text-cream' : 'bg-white text-chocolate ring-1 ring-[var(--line)] hover:bg-[#fff0f2]'"
        @click="status = t.value"
      >
        {{ t.label }}
        <span class="tabular-nums opacity-70">
          ({{ t.value ? (counts[t.value] || 0) : counts.all }})
        </span>
      </button>
    </div>

    <label class="relative mb-4 block w-full max-w-xl">
      <UIcon name="i-lucide-search" class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--muted)]" />
      <input
        v-model="q"
        class="sc-input w-full !rounded-xl !py-2.5 !pl-9"
        placeholder="Search order #, phone, address, rider…"
      >
    </label>

    <p v-if="error" class="mb-3 text-sm text-danger">{{ error }}</p>

    <div v-if="loading" class="space-y-2">
      <div v-for="i in 6" :key="i" class="sc-skeleton h-24 rounded-xl" />
    </div>

    <template v-else-if="view === 'board'">
      <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <div v-for="col in boardCols" :key="col.key" class="sc-panel min-h-[240px]">
          <div class="flex items-center justify-between border-b border-[var(--line)] bg-[#fff9f5] px-3 py-2.5">
            <p class="text-xs font-bold uppercase tracking-wide text-chocolate">{{ col.title }}</p>
            <span class="sc-badge sc-badge-muted">{{ col.items.length }}</span>
          </div>
          <div class="max-h-[70vh] space-y-2 overflow-y-auto p-2">
            <button
              v-for="o in col.items"
              :key="String(o.id)"
              type="button"
              class="w-full rounded-xl border border-[var(--line)] bg-white p-3 text-left shadow-sm transition hover:border-[#e9748e]/45"
              :class="selectedId === orderId(o) ? 'ring-2 ring-[#e9748e]/35' : ''"
              @click="selectRow(o)"
            >
              <div class="flex items-start justify-between gap-2">
                <p class="font-semibold text-chocolate">{{ o.order_number }}</p>
                <span
                  class="shrink-0 text-[0.65rem] font-bold tabular-nums"
                  :class="{
                    'text-success': ageTone(o) === 'ok',
                    'text-[#e9748e]': ageTone(o) === 'warn',
                    'text-danger': ageTone(o) === 'danger',
                    'text-[var(--muted)]': ageTone(o) === 'muted',
                  }"
                >{{ ageLabel(o) }}</span>
              </div>
              <p class="mt-1 truncate text-xs text-[var(--muted)]">{{ customerLabel(o) }}</p>
              <p class="mt-0.5 truncate text-xs text-[var(--muted)]">{{ addressLine(o) }}</p>
              <p class="mt-0.5 truncate text-[0.65rem] text-[var(--muted)]">
                {{ shopLabel(o) }} · {{ riderLabel(o) }}
              </p>
              <div class="mt-2 flex flex-wrap items-center gap-1.5">
                <span class="text-sm font-semibold tabular-nums text-chocolate">{{ money(Number(o.final_amount)) }}</span>
                <StatusBadge :status="String(o.payment_status || '—')" />
                <span class="sc-badge sc-badge-muted">{{ typeLabel(o) }}</span>
              </div>
            </button>
            <p v-if="!col.items.length" class="px-2 py-8 text-center text-xs text-[var(--muted)]">No orders</p>
          </div>
        </div>
      </div>
    </template>

    <div v-else class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(340px,420px)]">
      <div>
        <div class="mb-2.5 flex items-center justify-between px-0.5">
          <p class="m-0 text-xs font-semibold uppercase tracking-[0.1em] text-[var(--muted)]">
            {{ filtered.length }} order{{ filtered.length === 1 ? "" : "s" }}
          </p>
          <NuxtLink to="/picking" class="text-xs font-semibold text-[#e9748e]">Picking queue</NuxtLink>
        </div>

        <div v-if="filtered.length" class="space-y-2.5">
          <button
            v-for="o in filtered"
            :key="String(o.id)"
            type="button"
            class="flex w-full gap-3 rounded-2xl border border-[var(--line)] bg-white px-4 py-3.5 text-left shadow-[0_8px_22px_-18px_rgba(74,44,42,0.4)] transition hover:-translate-y-0.5 hover:border-[#f2a7ad]/70"
            :class="selectedId === orderId(o) ? 'border-[#e9748e]/50 bg-[#fff5f7] ring-2 ring-[#e9748e]/20' : ''"
            @click="selectRow(o)"
          >
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span class="font-semibold text-chocolate">{{ o.order_number }}</span>
                <span class="rounded-full bg-[#f8ede6] px-2 py-0.5 text-[0.62rem] font-semibold text-chocolate">
                  {{ typeLabel(o) }}
                </span>
                <StatusBadge :status="String(o.status || '—')" />
                <span
                  class="text-[0.7rem] font-bold tabular-nums"
                  :class="{
                    'text-success': ageTone(o) === 'ok',
                    'text-[#e9748e]': ageTone(o) === 'warn',
                    'text-danger': ageTone(o) === 'danger',
                    'text-[var(--muted)]': ageTone(o) === 'muted',
                  }"
                  :title="whenLabel(o)"
                >{{ ageLabel(o) }}</span>
              </div>
              <p class="mt-1.5 flex items-center gap-1.5 truncate text-sm text-chocolate/90">
                <UIcon name="i-lucide-user" class="size-3.5 shrink-0 text-[#e9748e]" />
                {{ customerLabel(o) }}
              </p>
              <p class="mt-0.5 flex items-start gap-1.5 truncate text-xs text-[var(--muted)]">
                <UIcon name="i-lucide-map-pin" class="mt-0.5 size-3.5 shrink-0 text-[#e9748e]" />
                <span class="truncate">{{ addressLine(o) }}</span>
              </p>
              <div class="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[0.7rem] text-[var(--muted)]">
                <span class="inline-flex items-center gap-1">
                  <UIcon name="i-lucide-clock" class="size-3 text-[#e9748e]" />
                  Slot {{ slotLabel(o) }}
                </span>
                <span class="inline-flex items-center gap-1">
                  <UIcon name="i-lucide-store" class="size-3 text-[#e9748e]" />
                  {{ shopLabel(o) }}
                </span>
                <span
                  class="inline-flex items-center gap-1"
                  :class="o.rider_name ? '' : 'text-[#e9748e]'"
                >
                  <UIcon name="i-lucide-bike" class="size-3 text-[#e9748e]" />
                  {{ riderLabel(o) }}
                </span>
                <span v-if="o.coupon_code">Coupon {{ o.coupon_code }}</span>
              </div>
            </div>
            <div class="shrink-0 text-right">
              <p class="font-display text-lg tabular-nums text-chocolate">{{ money(Number(o.final_amount)) }}</p>
              <p class="mt-0.5 text-[0.7rem] capitalize text-[var(--muted)]">
                {{ statusLabel(String(o.payment_method || "—")) }}
              </p>
              <StatusBadge class="mt-1" :status="String(o.payment_status || '—')" />
            </div>
          </button>
        </div>

        <div
          v-else
          class="rounded-2xl border border-dashed border-[var(--line)] bg-white px-6 py-14 text-center"
        >
          <span class="mx-auto grid size-12 place-items-center rounded-2xl bg-[#fff0f2]">
            <UIcon name="i-lucide-shopping-bag" class="size-6 text-[#e9748e]" />
          </span>
          <p class="font-display mt-3 text-lg text-chocolate">No orders in this filter</p>
          <p class="mt-1 text-sm text-[var(--muted)]">Adjust status or search, or wait for the next placement.</p>
        </div>
      </div>

      <aside class="sticky top-20 flex max-h-[calc(100vh-7rem)] flex-col overflow-hidden rounded-2xl border border-[var(--line)] bg-white shadow-[0_8px_22px_-18px_rgba(74,44,42,0.4)]">
        <template v-if="selectedId && detailLoading && !detail">
          <div class="space-y-2 p-4">
            <div class="sc-skeleton h-8" />
            <div class="sc-skeleton h-24" />
            <div class="sc-skeleton h-40" />
          </div>
        </template>

        <template v-else-if="detail">
          <div class="flex items-start justify-between gap-2 border-b border-[var(--line)] bg-[#fff9f5] px-4 py-3">
            <div class="min-w-0">
              <p class="truncate font-semibold text-chocolate">{{ detail.order_number }}</p>
              <p class="mt-0.5 text-xs text-[var(--muted)]">
                {{ whenLabel(detail) }}
                <span class="mx-1 opacity-40">·</span>
                <span
                  class="font-bold tabular-nums"
                  :class="{
                    'text-success': ageTone(detail) === 'ok',
                    'text-[#e9748e]': ageTone(detail) === 'warn',
                    'text-danger': ageTone(detail) === 'danger',
                    'text-[var(--muted)]': ageTone(detail) === 'muted',
                  }"
                >{{ ageLabel(detail) }}</span>
              </p>
            </div>
            <div class="flex shrink-0 gap-1">
              <UButton
                :to="`/orders/${selectedId}`"
                size="xs"
                color="secondary"
                label="Full page"
              />
              <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-x" @click="closeDetail" />
            </div>
          </div>

          <div class="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 text-sm">
            <ClientOnly>
              <OrdersOrderLiveTrack
                v-if="selectedId"
                :order-id="selectedId"
                :order="detail"
              />
            </ClientOnly>

            <div class="flex flex-wrap gap-2">
              <StatusBadge :status="String(detail.status || '—')" />
              <StatusBadge :status="String(detail.payment_status || '—')" />
              <span class="sc-badge sc-badge-muted">{{ typeLabel(detail) }}</span>
            </div>

            <div>
              <p class="font-display text-2xl tabular-nums text-chocolate">
                {{ money(Number(detail.final_amount)) }}
              </p>
              <dl class="mt-2 grid grid-cols-2 gap-2 text-xs">
                <div>
                  <dt class="text-[var(--muted)]">Subtotal</dt>
                  <dd class="tabular-nums">{{ money(Number(detail.subtotal)) }}</dd>
                </div>
                <div>
                  <dt class="text-[var(--muted)]">Delivery</dt>
                  <dd class="tabular-nums">{{ money(Number(detail.delivery_fee)) }}</dd>
                </div>
                <div>
                  <dt class="text-[var(--muted)]">GST</dt>
                  <dd class="tabular-nums">{{ money(Number(detail.gst_amount)) }}</dd>
                </div>
                <div>
                  <dt class="text-[var(--muted)]">Discount</dt>
                  <dd class="tabular-nums">{{ money(Number(detail.discount)) }}</dd>
                </div>
                <div>
                  <dt class="text-[var(--muted)]">Paid</dt>
                  <dd class="tabular-nums">{{ money(Number(detail.paid_amount)) }}</dd>
                </div>
                <div>
                  <dt class="text-[var(--muted)]">Method</dt>
                  <dd class="capitalize">{{ statusLabel(String(detail.payment_method || "—")) }}</dd>
                </div>
              </dl>
            </div>

            <div class="rounded-xl border border-[var(--line)] bg-[#fff9f5]/70 p-3">
              <p class="text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--muted)]">Customer</p>
              <p class="mt-1 font-semibold text-chocolate">{{ customerLabel(detail) }}</p>
              <p class="mt-1 text-xs leading-relaxed text-[var(--muted)]">{{ addressLine(detail) }}</p>
              <p class="mt-2 text-xs text-[var(--muted)]">Slot · {{ slotLabel(detail) }}</p>
              <p v-if="detail.delivery_instructions" class="mt-1 text-xs text-chocolate">
                Note: {{ detail.delivery_instructions }}
              </p>
            </div>

            <div>
              <div class="mb-2 flex items-center justify-between">
                <p class="text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--muted)]">
                  Items ({{ detailItems.length }})
                </p>
                <span v-if="detailLoading" class="text-[0.65rem] text-[#e9748e]">Refreshing…</span>
              </div>
              <ul class="divide-y divide-[var(--line)] rounded-xl border border-[var(--line)]">
                <li
                  v-for="(line, i) in detailItems"
                  :key="i"
                  class="flex items-start justify-between gap-3 px-3 py-2.5"
                >
                  <div class="min-w-0">
                    <p class="truncate font-medium text-chocolate">{{ lineName(line) }}</p>
                    <p class="text-[0.7rem] text-[var(--muted)]">
                      Qty {{ line.quantity ?? line.qty ?? 0 }}
                      <span v-if="line.variant"> · {{ line.variant }}</span>
                    </p>
                  </div>
                  <p class="shrink-0 tabular-nums font-semibold">
                    {{ money(Number(line.total_price ?? line.total ?? 0)) }}
                  </p>
                </li>
              </ul>
              <p v-if="!detailItems.length" class="py-4 text-center text-xs text-[var(--muted)]">
                No line items returned
              </p>
            </div>

            <div class="grid grid-cols-2 gap-2 text-xs">
              <div class="rounded-xl border border-[var(--line)] p-2.5">
                <p class="text-[var(--muted)]">Rider</p>
                <p class="mt-0.5 font-semibold text-chocolate">{{ riderLabel(detail) }}</p>
                <p v-if="detail.rider_vehicle" class="mt-0.5 text-[0.65rem] text-[var(--muted)]">
                  {{ detail.rider_vehicle }}
                </p>
              </div>
              <div class="rounded-xl border border-[var(--line)] p-2.5">
                <p class="text-[var(--muted)]">Shop</p>
                <p class="mt-0.5 font-semibold text-chocolate">{{ shopLabel(detail) }}</p>
                <p v-if="detail.shop_owner || detail.shop_phone" class="mt-0.5 text-[0.65rem] text-[var(--muted)]">
                  {{ [detail.shop_owner, displayPhone(String(detail.shop_phone || ''))].filter((x) => x && x !== '—').join(' · ') }}
                </p>
              </div>
            </div>
          </div>

          <div class="border-t border-[var(--line)] p-3">
            <UButton
              :to="`/orders/${selectedId}`"
              color="secondary"
              block
              label="Assign rider & update status"
              trailing-icon="i-lucide-arrow-right"
            />
          </div>
        </template>

        <div v-else class="grid flex-1 place-items-center p-8 text-center">
          <div>
            <span class="mx-auto grid size-14 place-items-center rounded-2xl bg-[#fff0f2]">
              <UIcon name="i-lucide-map" class="size-7 text-[#e9748e]" />
            </span>
            <p class="font-display mt-4 text-lg text-chocolate">Select an order</p>
            <p class="mt-1 text-xs text-[var(--muted)]">
              Then open Assign rider & update status to control fulfillment.
            </p>
          </div>
        </div>
      </aside>
    </div>

    <!-- Board detail drawer (mobile / board mode) -->
    <div
      v-if="view === 'board' && selectedId"
      class="fixed inset-0 z-40 bg-[#2a1614]/40 backdrop-blur-[2px] xl:hidden"
      @click="closeDetail"
    />
    <aside
      v-if="view === 'board' && selectedId"
      class="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-[var(--line)] bg-[var(--surface)] shadow-[var(--shadow-lg)] xl:hidden"
    >
      <div class="flex items-center justify-between border-b border-[var(--line)] px-4 py-3">
        <p class="font-semibold text-chocolate">Order detail</p>
        <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-x" @click="closeDetail" />
      </div>
      <div v-if="detailLoading && !detail" class="space-y-2 p-4">
        <div class="sc-skeleton h-24" />
      </div>
      <div v-else-if="detail" class="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 text-sm">
        <ClientOnly>
          <OrdersOrderLiveTrack
            v-if="selectedId"
            :order-id="selectedId"
            :order="detail"
          />
        </ClientOnly>
        <p class="font-semibold">{{ detail.order_number }}</p>
        <StatusBadge :status="String(detail.status || '—')" />
        <p class="font-display text-xl">{{ money(Number(detail.final_amount)) }}</p>
        <p class="text-xs text-[var(--muted)]">{{ customerLabel(detail) }}</p>
        <p class="text-xs text-[var(--muted)]">{{ addressLine(detail) }}</p>
        <ul class="divide-y divide-[var(--line)] rounded-xl border border-[var(--line)]">
          <li v-for="(line, i) in detailItems" :key="i" class="flex justify-between px-3 py-2">
            <span>{{ lineName(line) }} × {{ line.quantity }}</span>
            <span>{{ money(Number(line.total_price)) }}</span>
          </li>
        </ul>
        <UButton :to="`/orders/${selectedId}`" color="secondary" block label="Assign rider & update status" />
      </div>
    </aside>
  </div>
</template>

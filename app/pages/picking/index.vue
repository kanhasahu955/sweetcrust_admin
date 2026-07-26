<script setup lang="ts">
import {
  apiError,
  displayPhone,
  formatDateTime12,
  money,
  relativeAgo,
  statusLabel,
} from "~/utils/format"

type Line = {
  id?: number
  product_name?: string
  product_image?: string | null
  variant?: string | null
  quantity?: number
  unit_price?: number
  total_price?: number
}

type QueueRow = {
  order?: Record<string, unknown>
  items?: Line[]
  item_count?: number
}

const api = useApi()
const toast = useAppToast()
const { connect } = useSocket()
const socketLive = useState("adminSocketLive", () => false)

const loading = ref(true)
const error = ref("")
const filter = ref("")
const search = ref("")
const items = ref<QueueRow[]>([])
const stats = ref<Record<string, number>>({})
const busyId = ref<number | null>(null)
const expandedId = ref<number | null>(null)
const PAGE_SIZE = 12
const visibleCount = ref(PAGE_SIZE)
const loadMoreEl = ref<HTMLElement | null>(null)
let loadMoreObs: IntersectionObserver | null = null
let liveSocket: ReturnType<typeof connect> = null
let pollId: number | undefined
let refreshTimer: ReturnType<typeof setTimeout> | null = null

const filterTabs = [
  { label: "All open", value: "" },
  { label: "Accepted", value: "accepted" },
  { label: "Preparing", value: "preparing" },
  { label: "Packed", value: "packed" },
]

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return items.value
  return items.value.filter((row) => {
    const o = orderOf(row)
    const blob = [
      o.id,
      o.order_number,
      o.customer_phone,
      o.status,
      o.delivery_slot,
      ...(linesOf(row).map((l) => l.product_name)),
    ]
      .map((x) => String(x || "").toLowerCase())
      .join(" ")
    return blob.includes(q)
  })
})

const visible = computed(() => filtered.value.slice(0, visibleCount.value))
const hasMore = computed(() => visibleCount.value < filtered.value.length)
const queueTotal = computed(
  () => (Number(stats.value.accepted) || 0) + (Number(stats.value.preparing) || 0) + (Number(stats.value.packed) || 0),
)

watch([filter, search], () => {
  visibleCount.value = PAGE_SIZE
})

function orderOf(row: QueueRow) {
  return (row.order || {}) as Record<string, unknown>
}

function linesOf(row: QueueRow): Line[] {
  return Array.isArray(row.items) ? row.items : []
}

function orderId(row: QueueRow) {
  return Number(orderOf(row).id) || 0
}

function addrLine(o: Record<string, unknown>) {
  const snap = (o.address_snapshot || {}) as Record<string, unknown>
  const parts = [
    snap.line1 || snap.address_line1 || snap.street,
    snap.area || snap.locality || snap.village,
    snap.city,
    snap.pincode || snap.pin,
  ]
    .map((x) => String(x || "").trim())
    .filter(Boolean)
  return parts.join(", ") || "—"
}

function canStart(st: string) {
  return ["accepted", "payment_received", "placed"].includes(st)
}

function canPack(st: string) {
  return ["preparing", "accepted"].includes(st)
}

function loadMore() {
  if (!hasMore.value) return
  visibleCount.value = Math.min(visibleCount.value + PAGE_SIZE, filtered.value.length)
}

function scheduleRefresh() {
  if (refreshTimer) clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => {
    void load({ quiet: true })
  }, 250)
}

async function load(opts?: { quiet?: boolean }) {
  if (!opts?.quiet) loading.value = true
  error.value = ""
  try {
    const [q, s] = await Promise.all([
      api.admin.pickingQueue(filter.value || undefined),
      api.admin.pickingStats(),
    ])
    items.value = Array.isArray(q.items) ? (q.items as QueueRow[]) : []
    stats.value = s || {}
  } catch (e) {
    error.value = apiError(e)
  } finally {
    loading.value = false
  }
}

async function start(id: number) {
  busyId.value = id
  error.value = ""
  try {
    await api.admin.pickingStart(id)
    toast.success("Preparing", `Order #${id} started`)
    await load({ quiet: true })
  } catch (e) {
    error.value = apiError(e)
    toast.error("Start failed", apiError(e))
  } finally {
    busyId.value = null
  }
}

async function pack(id: number) {
  busyId.value = id
  error.value = ""
  try {
    await api.admin.pickingPack(id)
    toast.success("Packed", `Order #${id} ready for dispatch`)
    await load({ quiet: true })
  } catch (e) {
    error.value = apiError(e)
    toast.error("Pack failed", apiError(e))
  } finally {
    busyId.value = null
  }
}

function onOrderStatus(data: Record<string, unknown>) {
  const st = String(data.status || data.order_status || "").toLowerCase()
  if (["accepted", "preparing", "packed", "cancelled", "out_for_delivery", "delivered"].includes(st)) {
    scheduleRefresh()
  }
}

function onAdminEvent(data: Record<string, unknown>) {
  const kind = String(data.kind || "")
  if (
    kind.includes("picking")
    || kind.includes("order")
    || ["order_paid", "order_placed", "order_accepted"].includes(kind)
  ) {
    scheduleRefresh()
  }
}

onMounted(() => {
  void load()
  liveSocket = connect()
  liveSocket?.on("order_status", onOrderStatus)
  liveSocket?.on("admin_event", onAdminEvent)
  pollId = window.setInterval(() => {
    if (document.visibilityState === "visible") void load({ quiet: true })
  }, socketLive.value ? 20000 : 6000)

  loadMoreObs = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) loadMore()
    },
    { root: null, rootMargin: "240px 0px", threshold: 0 },
  )
  watch(
    loadMoreEl,
    (el, prev) => {
      if (prev) loadMoreObs?.unobserve(prev)
      if (el) loadMoreObs?.observe(el)
    },
    { flush: "post" },
  )
})

onBeforeUnmount(() => {
  liveSocket?.off("order_status", onOrderStatus)
  liveSocket?.off("admin_event", onAdminEvent)
  if (pollId) window.clearInterval(pollId)
  if (refreshTimer) clearTimeout(refreshTimer)
  loadMoreObs?.disconnect()
})

watch(filter, () => {
  void load()
})
</script>

<template>
  <div>
    <div class="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <p class="m-0 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-[#e9748e]">Kitchen</p>
        <h1 class="font-display m-0 mt-1 text-2xl text-chocolate sm:text-3xl">Picking</h1>
        <p class="m-0 mt-1 text-sm text-[var(--muted)]">
          Pack queue — start preparing, then mark packed
          <span
            class="ml-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.65rem] font-semibold"
            :class="socketLive ? 'bg-[#e8f6ee] text-[#2e7d4f]' : 'bg-[#f8ede6] text-[var(--muted)]'"
          >
            <span class="size-1.5 rounded-full" :class="socketLive ? 'bg-success' : 'bg-[#c4a39a]'" />
            {{ socketLive ? "Live" : "Polling" }}
          </span>
        </p>
      </div>
      <div class="flex flex-wrap gap-2">
        <UButton color="primary" variant="soft" icon="i-lucide-refresh-cw" :loading="loading" label="Refresh" @click="load()" />
        <UButton to="/orders" color="secondary" icon="i-lucide-shopping-bag" label="All orders" />
      </div>
    </div>

    <p v-if="error" class="mb-3 text-sm text-danger">{{ error }}</p>

    <div class="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="Accepted" :value="stats.accepted ?? 0" icon="lucide:clipboard-check" hint="Ready to start" />
      <StatCard label="Preparing" :value="stats.preparing ?? 0" icon="lucide:chef-hat" tone="warn" hint="In kitchen" />
      <StatCard label="Packed" :value="stats.packed ?? 0" icon="lucide:package-check" tone="ok" hint="Awaiting rider" />
      <StatCard label="In queue" :value="queueTotal" icon="lucide:list-ordered" hint="Accepted + preparing + packed" />
    </div>

    <div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <label class="relative block w-full max-w-md">
        <UIcon name="i-lucide-search" class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--muted)]" />
        <input
          v-model="search"
          class="sc-input w-full !rounded-xl !py-2.5 !pl-9"
          placeholder="Search order, phone, product…"
        >
      </label>
      <div class="flex flex-wrap gap-1.5">
        <button
          v-for="t in filterTabs"
          :key="t.value || 'all'"
          type="button"
          class="rounded-full px-3 py-1.5 text-xs font-semibold transition"
          :class="filter === t.value ? 'bg-chocolate text-cream' : 'bg-white text-chocolate ring-1 ring-[var(--line)] hover:bg-[#fff0f2]'"
          @click="filter = t.value"
        >
          {{ t.label }}
          <span v-if="t.value" class="opacity-70">
            ({{ stats[t.value] ?? 0 }})
          </span>
          <span v-else class="opacity-70">({{ queueTotal }})</span>
        </button>
      </div>
    </div>

    <div v-if="loading" class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <div v-for="n in 6" :key="n" class="sc-skeleton h-44 rounded-xl" />
    </div>

    <div
      v-else-if="!filtered.length"
      class="rounded-2xl border border-dashed border-[var(--line)] bg-white px-6 py-16 text-center"
    >
      <span class="mx-auto grid size-14 place-items-center rounded-2xl bg-[#fff0f2]">
        <UIcon name="i-lucide-package-open" class="size-7 text-[#e9748e]" />
      </span>
      <p class="font-display mt-4 text-xl text-chocolate">Queue empty</p>
      <p class="mt-1 text-sm text-[var(--muted)]">No orders waiting to pick.</p>
    </div>

    <template v-else>
      <p class="mb-2 text-xs text-[var(--muted)]">
        Showing {{ visible.length }} of {{ filtered.length }}
      </p>
      <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <article
          v-for="row in visible"
          :key="String(orderId(row))"
          class="flex flex-col rounded-xl border border-[var(--line)] bg-white p-3.5 shadow-[0_8px_22px_-18px_rgba(74,44,42,0.4)] transition hover:-translate-y-0.5 hover:border-[#f2a7ad]/70"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <p class="m-0 truncate text-sm font-semibold text-chocolate">
                {{ orderOf(row).order_number || `Order #${orderOf(row).id}` }}
              </p>
              <p class="m-0 mt-0.5 text-[0.7rem] text-[var(--muted)]" :title="formatDateTime12(String(orderOf(row).created_at || ''))">
                {{ relativeAgo(String(orderOf(row).created_at || '')) }}
                · {{ formatDateTime12(String(orderOf(row).created_at || '')) }}
              </p>
            </div>
            <StatusBadge :status="String(orderOf(row).status || '—')" />
          </div>

          <div class="mt-2.5 grid grid-cols-3 gap-1 rounded-lg bg-[#fff9f5] px-2 py-2 text-center">
            <div>
              <p class="m-0 text-[0.55rem] uppercase tracking-wide text-[var(--muted)]">Items</p>
              <p class="m-0 mt-0.5 text-[0.75rem] font-bold text-chocolate">{{ row.item_count || linesOf(row).length }}</p>
            </div>
            <div>
              <p class="m-0 text-[0.55rem] uppercase tracking-wide text-[var(--muted)]">Total</p>
              <p class="m-0 mt-0.5 text-[0.75rem] font-bold tabular-nums text-chocolate">
                {{ money(Number(orderOf(row).final_amount)) }}
              </p>
            </div>
            <div>
              <p class="m-0 text-[0.55rem] uppercase tracking-wide text-[var(--muted)]">Pay</p>
              <p class="m-0 mt-0.5 truncate text-[0.7rem] font-semibold capitalize text-chocolate">
                {{ statusLabel(String(orderOf(row).payment_status || "—")) }}
              </p>
            </div>
          </div>

          <ul class="m-0 mt-2.5 list-none space-y-1 p-0 text-[0.72rem] text-[var(--muted)]">
            <li class="flex items-start gap-1.5">
              <UIcon name="i-lucide-map-pin" class="mt-0.5 size-3.5 shrink-0 text-[#e9748e]" />
              <span class="line-clamp-2 leading-snug">{{ addrLine(orderOf(row)) }}</span>
            </li>
            <li class="flex items-center gap-1.5">
              <UIcon name="i-lucide-phone" class="size-3.5 shrink-0 text-[#e9748e]" />
              <span class="tabular-nums">{{ displayPhone(String(orderOf(row).customer_phone || '')) }}</span>
            </li>
            <li v-if="orderOf(row).delivery_slot || orderOf(row).delivery_date" class="flex items-center gap-1.5">
              <UIcon name="i-lucide-clock" class="size-3.5 shrink-0 text-[#e9748e]" />
              <span>Slot {{ orderOf(row).delivery_slot || orderOf(row).delivery_date }}</span>
            </li>
          </ul>

          <div class="mt-2 flex flex-wrap gap-1">
            <span
              v-for="(line, i) in linesOf(row).slice(0, 3)"
              :key="String(line.id || i)"
              class="rounded-full bg-[#fff0f2] px-2 py-0.5 text-[0.62rem] font-medium text-chocolate"
            >
              {{ line.quantity }}× {{ line.product_name }}
            </span>
            <span
              v-if="linesOf(row).length > 3"
              class="rounded-full bg-[#f8ede6] px-2 py-0.5 text-[0.62rem] text-[var(--muted)]"
            >
              +{{ linesOf(row).length - 3 }} more
            </span>
          </div>

          <div
            v-if="expandedId === orderId(row)"
            class="mt-2 space-y-1.5 rounded-lg border border-[var(--line)] bg-[#fffaf8] p-2"
          >
            <div
              v-for="(line, i) in linesOf(row)"
              :key="`x-${line.id || i}`"
              class="flex items-center gap-2 text-xs"
            >
              <img
                v-if="line.product_image"
                :src="String(line.product_image)"
                alt=""
                class="size-8 rounded-md object-cover"
              >
              <span
                v-else
                class="grid size-8 place-items-center rounded-md bg-[#f8ede6] text-[0.6rem] text-[var(--muted)]"
              >
                —
              </span>
              <span class="min-w-0 flex-1 truncate text-chocolate">
                {{ line.quantity }}× {{ line.product_name }}
                <span v-if="line.variant" class="text-[var(--muted)]"> · {{ line.variant }}</span>
              </span>
              <span class="shrink-0 tabular-nums text-[var(--muted)]">{{ money(Number(line.total_price)) }}</span>
            </div>
          </div>

          <div class="mt-auto flex flex-wrap items-center gap-1.5 pt-3">
            <UButton
              v-if="canStart(String(orderOf(row).status || ''))"
              size="xs"
              color="secondary"
              icon="i-lucide-play"
              :loading="busyId === orderId(row)"
              label="Start"
              @click="start(orderId(row))"
            />
            <UButton
              v-if="canPack(String(orderOf(row).status || ''))"
              size="xs"
              color="secondary"
              :variant="String(orderOf(row).status) === 'preparing' ? 'solid' : 'outline'"
              icon="i-lucide-package-check"
              :loading="busyId === orderId(row)"
              label="Pack"
              @click="pack(orderId(row))"
            />
            <UButton
              size="xs"
              color="neutral"
              variant="soft"
              :label="expandedId === orderId(row) ? 'Hide lines' : 'Lines'"
              @click="expandedId = expandedId === orderId(row) ? null : orderId(row)"
            />
            <UButton
              size="xs"
              color="neutral"
              variant="outline"
              :to="`/orders/${orderId(row)}`"
              label="Open"
            />
          </div>
        </article>
      </div>

      <div ref="loadMoreEl" class="flex min-h-10 items-center justify-center py-4">
        <button
          v-if="hasMore"
          type="button"
          class="rounded-full bg-white px-4 py-1.5 text-xs font-semibold text-chocolate ring-1 ring-[var(--line)] transition hover:bg-[#fff0f2]"
          @click="loadMore"
        >
          Load more · {{ filtered.length - visible.length }} left
        </button>
        <p v-else-if="filtered.length > PAGE_SIZE" class="m-0 text-xs text-[var(--muted)]">
          All {{ filtered.length }} orders loaded
        </p>
      </div>
    </template>
  </div>
</template>

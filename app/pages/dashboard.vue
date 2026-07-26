<script setup lang="ts">
import dayjs from "dayjs"
import { money, statusLabel } from "~/utils/format"
import type { AdminActivityItem } from "~/plugins/admin-realtime.client"

const api = useApi()
const loading = ref(true)
const refreshing = ref(false)
const error = ref("")
const data = ref<Record<string, unknown> | null>(null)
const shops = ref<Record<string, unknown>[]>([])
const report = ref<Record<string, unknown> | null>(null)
const lastSyncedAt = ref<number | null>(null)
const activityFeed = useState<AdminActivityItem[]>("adminActivityFeed", () => [])
const dashboardBump = useState("adminDashboardBump", () => 0)
const socketLive = useState("adminSocketLive", () => false)
const chatUnread = useAdminChatUnread().total

let refreshTimer: ReturnType<typeof setTimeout> | null = null
const nowTick = ref(Date.now())
let tickTimer: ReturnType<typeof setInterval> | null = null

async function load(quiet = false) {
  if (quiet) refreshing.value = true
  else loading.value = true
  error.value = ""
  try {
    const [d, s, r] = await Promise.all([
      api.admin.dashboard(),
      api.admin.shops().catch(() => []),
      api.admin.reports("weekly").catch(() => null),
    ])
    data.value = d
    shops.value = Array.isArray(s) ? (s as Record<string, unknown>[]) : []
    report.value = r as Record<string, unknown> | null
    lastSyncedAt.value = Date.now()
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
  }, 450)
}

watch(dashboardBump, () => {
  scheduleRefresh()
})

onMounted(() => {
  void load()
  tickTimer = setInterval(() => {
    nowTick.value = Date.now()
  }, 15000)
})

onBeforeUnmount(() => {
  if (refreshTimer) clearTimeout(refreshTimer)
  if (tickTimer) clearInterval(tickTimer)
})

const cards = computed(() => (data.value?.cards || {}) as Record<string, number>)
const due = computed(() =>
  shops.value.reduce((a, s) => a + (Number(s.outstanding_balance) || 0), 0),
)
const recent = computed(() => ((data.value?.recent_orders || []) as Record<string, unknown>[]).slice(0, 8))
const lowStock = computed(() => ((data.value?.low_stock || []) as Record<string, unknown>[]).slice(0, 6))
const series = computed(() =>
  ((data.value?.revenue_graph || []) as { date: string; revenue: number; orders: number }[]),
)
const bestsellers = computed(() =>
  ((data.value?.best_selling_products || []) as { name: string; sales_count: number }[])
    .map((p) => ({ name: String(p.name || "SKU"), sales_count: Number(p.sales_count) || 0 }))
    .slice(0, 5),
)
const liveCount = computed(() => ((data.value?.live_deliveries || []) as unknown[]).length)
const pendingShops = computed(() =>
  shops.value.filter((s) => {
    const st = String(s.approval_status || "")
    return st === "pending" || st === "incomplete"
  }).length,
)

const unreadChats = computed(() =>
  Math.max(Number(cards.value.unread_chats) || 0, Number(chatUnread.value) || 0),
)

const statusSegments = computed(() => [
  { label: "Pending", value: Number(cards.value.pending_orders) || 0, color: "#E9748E" },
  { label: "Preparing", value: Number(cards.value.preparing_orders) || 0, color: "#F2A7AD" },
  { label: "Out", value: Number(cards.value.out_for_delivery) || 0, color: "#4A2C2A" },
  { label: "Delivered", value: Number(cards.value.delivered_orders) || 0, color: "#2E7D4F" },
])

const opsQueue = computed(() => [
  {
    key: "new",
    title: "New orders",
    count: Number(cards.value.pending_orders) || 0,
    to: "/orders",
    hint: "Awaiting accept",
    icon: "i-lucide-inbox",
  },
  {
    key: "prep",
    title: "Picking",
    count: Number(cards.value.preparing_orders) || 0,
    to: "/picking",
    hint: "Pack queue",
    icon: "i-lucide-package-check",
  },
  {
    key: "route",
    title: "Out for delivery",
    count: Number(cards.value.out_for_delivery) || 0,
    to: "/routing",
    hint: "Stops & ETA",
    icon: "i-lucide-route",
  },
  {
    key: "live",
    title: "Live tracks",
    count: liveCount.value,
    to: "/delivery",
    hint: "Active riders",
    icon: "i-lucide-radio",
  },
])

const shortcuts = [
  { label: "Purchases", to: "/purchases", icon: "i-lucide-shopping-cart" },
  { label: "Products", to: "/products", icon: "i-lucide-package" },
  { label: "Shops", to: "/shops", icon: "i-lucide-store" },
  { label: "Payments", to: "/payments", icon: "i-lucide-wallet" },
  { label: "Reports", to: "/reports", icon: "i-lucide-chart-column" },
]

const attention = computed(() => {
  const items: { label: string; value: string | number; to: string; tone: "warn" | "danger" | "muted" }[] = []
  if (pendingShops.value) {
    items.push({ label: "Shops awaiting approval", value: pendingShops.value, to: "/shops", tone: "warn" })
  }
  if (cards.value.pending_orders) {
    items.push({ label: "Orders to process", value: cards.value.pending_orders, to: "/orders", tone: "warn" })
  }
  if (unreadChats.value) {
    items.push({ label: "Unread chats", value: unreadChats.value, to: "/chats", tone: "warn" })
  }
  if (cards.value.low_stock_products || lowStock.value.length) {
    items.push({
      label: "Low stock SKUs",
      value: cards.value.low_stock_products || lowStock.value.length,
      to: "/inventory",
      tone: "danger",
    })
  }
  if (cards.value.failed_payments) {
    items.push({ label: "Failed payments", value: cards.value.failed_payments, to: "/payments", tone: "danger" })
  }
  if (cards.value.pending_returns) {
    items.push({ label: "Returns pending", value: cards.value.pending_returns, to: "/returns", tone: "muted" })
  }
  return items
})

const weekNet = computed(() =>
  report.value?.net_profit != null ? money(Number(report.value.net_profit)) : "—",
)
const weekRevenue = computed(() =>
  report.value?.sales_total != null || report.value?.revenue != null
    ? money(Number(report.value.sales_total ?? report.value.revenue))
    : "—",
)

const syncedLabel = computed(() => {
  void nowTick.value
  if (!lastSyncedAt.value) return "—"
  const sec = Math.max(0, Math.round((Date.now() - lastSyncedAt.value) / 1000))
  if (sec < 5) return "just now"
  if (sec < 60) return `${sec}s ago`
  return dayjs(lastSyncedAt.value).format("h:mm A")
})

function ago(ts: number) {
  void nowTick.value
  const m = Math.max(0, Math.round((Date.now() - ts) / 60000))
  if (m < 1) return "now"
  if (m < 60) return `${m}m`
  return dayjs(ts).format("h:mm A")
}

function activityIcon(kind: string) {
  if (kind.includes("chat")) return "i-lucide-messages-square"
  if (kind.includes("shop")) return "i-lucide-store"
  if (kind.includes("po") || kind.includes("collection")) return "i-lucide-wallet"
  if (kind.includes("delivery") || kind.includes("location")) return "i-lucide-bike"
  if (kind.includes("order") || kind.includes("paid")) return "i-lucide-shopping-bag"
  return "i-lucide-activity"
}
</script>

<template>
  <div>
    <PageHeader title="Operations" subtitle="Orders, stock, delivery, and collections — live">
      <template #actions>
        <div
          class="mr-1 flex items-center gap-2 rounded-full border border-[var(--line)] bg-white/80 px-3 py-1.5 text-xs font-semibold"
          :class="socketLive ? 'text-success' : 'text-[var(--muted)]'"
        >
          <span
            class="size-2 rounded-full"
            :class="socketLive ? 'bg-success animate-pulse' : 'bg-stone-300'"
          />
          {{ socketLive ? "Live" : "Offline" }}
          <span class="font-normal text-[var(--muted)]">· synced {{ syncedLabel }}</span>
        </div>
        <UButton
          color="neutral"
          variant="outline"
          icon="i-lucide-refresh-cw"
          :loading="loading || refreshing"
          @click="load()"
        />
        <UButton to="/reports" color="primary" variant="soft" label="P&L" />
        <UButton to="/orders" color="secondary" label="Orders" />
      </template>
    </PageHeader>

    <p v-if="error" class="mb-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-danger">{{ error }}</p>

    <!-- Pipeline -->
    <section class="mb-5 overflow-hidden rounded-2xl border border-[var(--line)] bg-white shadow-[var(--shadow-sm)]">
      <div class="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] bg-[#fff9f5] px-4 py-2.5">
        <p class="text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">
          Fulfillment pipeline
        </p>
        <p v-if="refreshing" class="text-[0.7rem] font-medium text-[#e9748e]">Updating…</p>
      </div>
      <div class="grid sm:grid-cols-2 xl:grid-cols-4">
        <NuxtLink
          v-for="(q, idx) in opsQueue"
          :key="q.key"
          :to="q.to"
          class="group relative flex items-center justify-between gap-3 p-4 transition hover:bg-[#fff0f2]/55"
          :class="idx < opsQueue.length - 1 ? 'border-b border-[var(--line)] xl:border-b-0 xl:border-r' : ''"
        >
          <div class="min-w-0">
            <div class="mb-2 flex items-center gap-2">
              <span class="grid size-8 place-items-center rounded-xl bg-[#ffe8ec] text-chocolate">
                <UIcon :name="q.icon" class="size-4" />
              </span>
              <p class="text-[0.68rem] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
                {{ q.title }}
              </p>
            </div>
            <p class="font-display text-3xl leading-none text-chocolate">
              {{ loading ? "…" : q.count }}
            </p>
            <p class="mt-1.5 text-xs text-[var(--muted)]">{{ q.hint }}</p>
          </div>
          <UIcon
            name="i-lucide-chevron-right"
            class="size-5 shrink-0 text-[#e9748e] opacity-40 transition group-hover:translate-x-0.5 group-hover:opacity-100"
          />
        </NuxtLink>
      </div>
    </section>

    <!-- Shortcuts -->
    <div class="mb-5 flex flex-wrap gap-2">
      <NuxtLink
        v-for="s in shortcuts"
        :key="s.to"
        :to="s.to"
        class="inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-white px-3 py-1.5 text-xs font-semibold text-chocolate shadow-[var(--shadow-sm)] transition hover:border-[#e9748e]/40 hover:bg-[#fff0f2]"
      >
        <UIcon :name="s.icon" class="size-3.5 text-[#e9748e]" />
        {{ s.label }}
      </NuxtLink>
    </div>

    <div v-if="loading" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div v-for="i in 8" :key="i" class="sc-skeleton h-28" />
    </div>

    <template v-else>
      <div class="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Today revenue"
          :value="money(cards.todays_revenue)"
          icon="lucide:indian-rupee"
          hint="Paid orders today"
          tone="accent"
        />
        <StatCard
          label="Today orders"
          :value="cards.todays_orders ?? 0"
          icon="lucide:shopping-bag"
          :hint="`${cards.pending_orders || 0} pending`"
        />
        <StatCard
          label="Shop udhaar"
          :value="money(due)"
          icon="lucide:wallet"
          :hint="pendingShops ? `${pendingShops} shops pending KYC` : 'Outstanding receivable'"
          tone="warn"
        />
        <StatCard
          label="Week net profit"
          :value="weekNet"
          icon="lucide:trending-up"
          :hint="`Sales ${weekRevenue}`"
          tone="ok"
        />
        <StatCard
          label="Out for delivery"
          :value="cards.out_for_delivery ?? 0"
          icon="lucide:bike"
          :hint="`${liveCount} live tracks`"
        />
        <StatCard
          label="Low stock"
          :value="cards.low_stock_products ?? lowStock.length"
          icon="lucide:package-x"
          hint="Below threshold"
          tone="warn"
        />
        <StatCard
          label="Unread chats"
          :value="unreadChats"
          icon="lucide:messages-square"
          hint="Shop & customer"
        />
        <StatCard
          label="Failed payments"
          :value="cards.failed_payments ?? 0"
          icon="lucide:circle-alert"
          hint="Review payments"
          tone="warn"
        />
      </div>

      <div class="mb-6 grid gap-4 xl:grid-cols-[1.35fr_1fr_0.95fr]">
        <div class="sc-panel p-4">
          <div class="mb-3 flex items-center justify-between gap-2">
            <div>
              <h3 class="font-display m-0 text-lg text-chocolate">Revenue · 7 days</h3>
              <p class="text-xs text-[var(--muted)]">Paid revenue vs order count</p>
            </div>
            <NuxtLink to="/reports" class="text-xs font-semibold text-[#e9748e]">Reports</NuxtLink>
          </div>
          <div class="h-[260px]">
            <ClientOnly>
              <ChartsRevenueChart :series="series" />
              <template #fallback>
                <div class="grid h-full place-items-center text-sm text-[var(--muted)]">Loading chart…</div>
              </template>
            </ClientOnly>
          </div>
        </div>

        <div class="sc-panel p-4">
          <div class="mb-3">
            <h3 class="font-display m-0 text-lg text-chocolate">Order status</h3>
            <p class="text-xs text-[var(--muted)]">Current pipeline mix</p>
          </div>
          <div class="h-[260px]">
            <ClientOnly>
              <ChartsStatusChart :segments="statusSegments" />
              <template #fallback>
                <div class="grid h-full place-items-center text-sm text-[var(--muted)]">Loading…</div>
              </template>
            </ClientOnly>
          </div>
        </div>

        <div class="sc-panel flex flex-col overflow-hidden">
          <div class="flex items-center justify-between border-b border-[var(--line)] bg-[#fff9f5]/80 px-4 py-3">
            <h3 class="font-display m-0 text-lg text-chocolate">Activity</h3>
            <span
              class="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wide"
              :class="socketLive ? 'bg-emerald-50 text-success' : 'bg-[#f8ede6] text-[var(--muted)]'"
            >
              <span class="size-1.5 rounded-full" :class="socketLive ? 'bg-success' : 'bg-stone-300'" />
              {{ socketLive ? "Socket" : "Idle" }}
            </span>
          </div>
          <ul class="min-h-[240px] flex-1 space-y-0 overflow-y-auto">
            <li
              v-for="a in activityFeed.slice(0, 14)"
              :key="a.id"
              class="flex gap-3 border-b border-[var(--line)] px-4 py-2.5 last:border-b-0"
            >
              <span class="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-[#ffe8ec] text-chocolate">
                <UIcon :name="activityIcon(a.kind)" class="size-3.5" />
              </span>
              <div class="min-w-0 flex-1">
                <div class="flex items-start justify-between gap-2">
                  <p class="truncate text-sm font-semibold text-chocolate">{{ a.title }}</p>
                  <span class="shrink-0 text-[0.65rem] tabular-nums text-[var(--muted)]">{{ ago(a.at) }}</span>
                </div>
                <p class="mt-0.5 truncate text-xs text-[var(--muted)]">{{ a.body }}</p>
              </div>
            </li>
            <li
              v-if="!activityFeed.length"
              class="grid h-[240px] place-items-center px-6 text-center text-sm text-[var(--muted)]"
            >
              No events yet.<br>
              <span class="mt-1 block text-xs">Orders, payments, shops, and chat updates stream here.</span>
            </li>
          </ul>
        </div>
      </div>

      <div class="mb-6 grid gap-4 lg:grid-cols-[1fr_1.15fr_1fr]">
        <div class="sc-panel p-4">
          <h3 class="font-display m-0 text-lg text-chocolate">Action required</h3>
          <ul v-if="attention.length" class="mt-3 space-y-2">
            <li v-for="a in attention" :key="a.label">
              <NuxtLink
                :to="a.to"
                class="flex items-center justify-between rounded-xl border border-[var(--line)] px-3 py-2.5 text-sm transition hover:border-[#e9748e]/40 hover:bg-[#fff0f2]/50"
              >
                <span class="text-[var(--muted)]">{{ a.label }}</span>
                <span
                  class="font-display text-lg tabular-nums"
                  :class="{
                    'text-[#e9748e]': a.tone === 'warn',
                    'text-danger': a.tone === 'danger',
                    'text-chocolate': a.tone === 'muted',
                  }"
                >{{ a.value }}</span>
              </NuxtLink>
            </li>
          </ul>
          <p v-else class="mt-4 text-sm text-[var(--muted)]">
            Nothing queued. Pipeline is clear.
          </p>
        </div>

        <div class="sc-panel p-4">
          <div class="mb-3 flex items-center justify-between">
            <h3 class="font-display m-0 text-lg text-chocolate">Best sellers</h3>
            <NuxtLink to="/products" class="text-xs font-semibold text-[#e9748e]">Catalog</NuxtLink>
          </div>
          <div class="h-[240px]">
            <ClientOnly>
              <ChartsBestsellersChart v-if="bestsellers.length" :items="bestsellers" />
              <div v-else class="grid h-full place-items-center text-sm text-[var(--muted)]">
                No sales in this window
              </div>
            </ClientOnly>
          </div>
        </div>

        <div class="sc-panel flex flex-col p-4">
          <h3 class="font-display m-0 text-lg text-chocolate">Stock alerts</h3>
          <ul class="mt-3 flex-1 space-y-0 text-sm">
            <li
              v-for="p in lowStock"
              :key="String(p.id)"
              class="flex justify-between gap-2 border-b border-[var(--line)] py-2"
            >
              <span class="truncate pr-2 text-chocolate">{{ p.name }}</span>
              <span class="shrink-0 font-semibold tabular-nums text-danger">{{ p.stock_qty }}</span>
            </li>
            <li v-if="!lowStock.length" class="py-6 text-sm text-[var(--muted)]">
              No SKUs below threshold
            </li>
          </ul>
          <UButton to="/inventory" color="primary" variant="soft" class="mt-3" size="sm" label="Inventory" />
        </div>
      </div>

      <div class="sc-panel">
        <div class="flex items-center justify-between border-b border-[var(--line)] px-4 py-3">
          <h3 class="font-display m-0 text-lg text-chocolate">Recent orders</h3>
          <NuxtLink to="/orders" class="text-sm font-semibold text-[#e9748e]">View all</NuxtLink>
        </div>
        <div class="overflow-x-auto">
          <table class="sc-table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Amount</th>
                <th>Payment</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="o in recent" :key="String(o.id)">
                <td>
                  <NuxtLink :to="`/orders/${o.id}`" class="font-semibold text-chocolate hover:text-[#e9748e]">
                    {{ o.order_number }}
                  </NuxtLink>
                </td>
                <td class="tabular-nums">{{ money(Number(o.final_amount)) }}</td>
                <td class="capitalize">{{ statusLabel(String(o.payment_status || o.payment_method || "—")) }}</td>
                <td>
                  <StatusBadge :status="String(o.status || '—')" />
                </td>
              </tr>
              <tr v-if="!recent.length">
                <td colspan="4" class="py-10 text-center text-[var(--muted)]">
                  No recent orders
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </div>
</template>

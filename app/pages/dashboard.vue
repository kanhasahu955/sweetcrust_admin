<script setup lang="ts">
import { money, statusClass, statusLabel } from "~/utils/format"

const api = useApi()
const loading = ref(true)
const error = ref("")
const data = ref<Record<string, unknown> | null>(null)
const shops = ref<Record<string, unknown>[]>([])
const report = ref<Record<string, unknown> | null>(null)

onMounted(async () => {
  try {
    const [d, s, r] = await Promise.all([
      api.admin.dashboard(),
      api.admin.shops().catch(() => []),
      api.admin.reports("weekly").catch(() => null),
    ])
    data.value = d
    shops.value = Array.isArray(s) ? (s as Record<string, unknown>[]) : []
    report.value = r as Record<string, unknown> | null
  } catch (e) {
    error.value = apiError(e)
  } finally {
    loading.value = false
  }
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
  shops.value.filter((s) => String(s.approval_status || "") === "pending").length,
)
const insights = computed(() => {
  const raw = data.value?.ai_insights
  if (Array.isArray(raw)) return raw.map(String).slice(0, 4)
  if (raw && typeof raw === "object") {
    return Object.values(raw as Record<string, unknown>).map(String).slice(0, 4)
  }
  return [] as string[]
})

const statusSegments = computed(() => [
  { label: "Pending", value: Number(cards.value.pending_orders) || 0, color: "#E8A020" },
  { label: "Preparing", value: Number(cards.value.preparing_orders) || 0, color: "#D4893A" },
  { label: "Out", value: Number(cards.value.out_for_delivery) || 0, color: "#5C4030" },
  { label: "Delivered", value: Number(cards.value.delivered_orders) || 0, color: "#2A7A48" },
])

const flow = [
  {
    n: "1",
    title: "Buy stock",
    body: "Purchase from village shops / wholesalers",
    to: "/purchases",
    icon: "lucide:shopping-cart",
  },
  {
    n: "2",
    title: "Price & publish",
    body: "Set shop price, cost, stock in catalog",
    to: "/products",
    icon: "lucide:package",
  },
  {
    n: "3",
    title: "Approve shops",
    body: "KYC → credit limit → they can order",
    to: "/shops",
    icon: "lucide:store",
  },
  {
    n: "4",
    title: "Fulfill orders",
    body: "Accept → pack → assign rider",
    to: "/orders",
    icon: "lucide:shopping-bag",
  },
  {
    n: "5",
    title: "Collect & profit",
    body: "Udhaar collection + weekly P&L",
    to: "/reports",
    icon: "lucide:chart-column",
  },
]

const attention = computed(() => {
  const items: { label: string; value: string | number; to: string; tone: string }[] = []
  if (pendingShops.value) {
    items.push({ label: "Shops awaiting KYC", value: pendingShops.value, to: "/shops", tone: "warn" })
  }
  if (cards.value.pending_orders) {
    items.push({ label: "Orders to process", value: cards.value.pending_orders, to: "/orders", tone: "warn" })
  }
  if (cards.value.unread_chats) {
    items.push({ label: "Unread chats", value: cards.value.unread_chats, to: "/chats", tone: "info" })
  }
  if (cards.value.low_stock_products) {
    items.push({ label: "Low stock SKUs", value: cards.value.low_stock_products, to: "/inventory", tone: "danger" })
  }
  if (cards.value.failed_payments) {
    items.push({ label: "Failed payments", value: cards.value.failed_payments, to: "/payments", tone: "danger" })
  }
  if (cards.value.pending_returns) {
    items.push({ label: "Returns to review", value: cards.value.pending_returns, to: "/returns", tone: "info" })
  }
  if (!items.length) {
    items.push({ label: "All clear", value: "✓", to: "/orders", tone: "ok" })
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
</script>

<template>
  <div>
    <PageHeader title="Command center" subtitle="See money, stock, and delivery at a glance — then follow the flow below">
      <template #actions>
        <UButton to="/reports" color="primary" variant="soft" label="Full P&L" />
        <UButton to="/orders" color="primary" variant="solid" label="Process orders" />
      </template>
    </PageHeader>

    <p v-if="error" class="mb-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-danger">{{ error }}</p>

    <!-- Business flow -->
    <section class="sc-card mb-6 overflow-hidden">
      <div class="border-b border-[var(--line)] bg-gradient-to-r from-[#2a1a12] to-[#3d2314] px-5 py-4 text-cream">
        <p class="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-honey/90">How money moves</p>
        <h2 class="font-display m-0 mt-1 text-xl">Buy → Publish → Shop orders → Deliver → Collect</h2>
      </div>
      <div class="grid gap-0 sm:grid-cols-5">
        <NuxtLink
          v-for="(step, idx) in flow"
          :key="step.n"
          :to="step.to"
          class="group relative border-[var(--line)] p-4 transition hover:bg-cream/50 sm:border-r sm:last:border-r-0"
          :class="idx > 0 ? 'border-t sm:border-t-0' : ''"
        >
          <div class="mb-2 flex items-center gap-2">
            <span class="grid size-8 place-items-center rounded-lg bg-chocolate text-xs font-bold text-cream">{{ step.n }}</span>
            <Icon :name="step.icon" class="size-4 text-honey" />
          </div>
          <p class="font-semibold text-chocolate group-hover:text-honey">{{ step.title }}</p>
          <p class="mt-1 text-xs leading-relaxed text-[var(--muted)]">{{ step.body }}</p>
        </NuxtLink>
      </div>
    </section>

    <div v-if="loading" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div v-for="i in 8" :key="i" class="sc-card h-28 animate-pulse bg-cream/80" />
    </div>

    <template v-else>
      <!-- KPIs -->
      <div class="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Today revenue" :value="money(cards.todays_revenue)" icon="lucide:indian-rupee" hint="Paid orders today" />
        <KpiCard label="Today orders" :value="cards.todays_orders ?? 0" icon="lucide:shopping-bag" :hint="`${cards.pending_orders || 0} pending`" />
        <KpiCard label="Shop udhaar due" :value="money(due)" icon="lucide:wallet" :hint="pendingShops ? `${pendingShops} KYC pending` : 'Collect from shops'" />
        <KpiCard label="Week net profit" :value="weekNet" icon="lucide:trending-up" :hint="`Sales ${weekRevenue}`" />
        <KpiCard label="Out for delivery" :value="cards.out_for_delivery ?? 0" icon="lucide:bike" :hint="`${liveCount} live tracks`" />
        <KpiCard label="Low stock" :value="cards.low_stock_products ?? lowStock.length" icon="lucide:package-x" hint="Needs restock" />
        <KpiCard label="Unread chats" :value="cards.unread_chats ?? 0" icon="lucide:messages-square" hint="Shop support" />
        <KpiCard label="Failed payments" :value="cards.failed_payments ?? 0" icon="lucide:circle-alert" hint="Check payments" />
      </div>

      <!-- Charts -->
      <div class="mb-6 grid gap-4 xl:grid-cols-[1.45fr_1fr]">
        <div class="sc-card p-4">
          <div class="mb-3 flex items-center justify-between gap-2">
            <div>
              <h3 class="font-display m-0 text-lg text-chocolate">Revenue · last 7 days</h3>
              <p class="text-xs text-[var(--muted)]">Paid revenue (left) vs order count (right)</p>
            </div>
            <NuxtLink to="/reports" class="text-xs font-semibold text-honey">Details</NuxtLink>
          </div>
          <div class="h-[280px]">
            <ClientOnly>
              <ChartsRevenueChart :series="series" />
              <template #fallback>
                <div class="grid h-full place-items-center text-sm text-[var(--muted)]">Loading chart…</div>
              </template>
            </ClientOnly>
          </div>
        </div>

        <div class="sc-card p-4">
          <div class="mb-3">
            <h3 class="font-display m-0 text-lg text-chocolate">Order pipeline</h3>
            <p class="text-xs text-[var(--muted)]">Where orders sit right now</p>
          </div>
          <div class="h-[280px]">
            <ClientOnly>
              <ChartsStatusChart :segments="statusSegments" />
              <template #fallback>
                <div class="grid h-full place-items-center text-sm text-[var(--muted)]">Loading…</div>
              </template>
            </ClientOnly>
          </div>
        </div>
      </div>

      <div class="mb-6 grid gap-4 lg:grid-cols-[1fr_1.2fr_1fr]">
        <!-- Needs attention -->
        <div class="sc-card p-4">
          <h3 class="font-display m-0 text-lg text-chocolate">Needs attention</h3>
          <ul class="mt-3 space-y-2">
            <li v-for="a in attention" :key="a.label">
              <NuxtLink
                :to="a.to"
                class="flex items-center justify-between rounded-xl border border-[var(--line)] px-3 py-2.5 text-sm transition hover:border-honey/50 hover:bg-cream/40"
              >
                <span class="text-[var(--muted)]">{{ a.label }}</span>
                <span
                  class="font-display text-lg"
                  :class="{
                    'text-honey': a.tone === 'warn',
                    'text-danger': a.tone === 'danger',
                    'text-cocoa': a.tone === 'info',
                    'text-success': a.tone === 'ok',
                  }"
                >{{ a.value }}</span>
              </NuxtLink>
            </li>
          </ul>
        </div>

        <!-- Bestsellers -->
        <div class="sc-card p-4">
          <div class="mb-3 flex items-center justify-between">
            <h3 class="font-display m-0 text-lg text-chocolate">Best sellers</h3>
            <NuxtLink to="/products" class="text-xs font-semibold text-honey">Catalog</NuxtLink>
          </div>
          <div class="h-[240px]">
            <ClientOnly>
              <ChartsBestsellersChart v-if="bestsellers.length" :items="bestsellers" />
              <div v-else class="grid h-full place-items-center text-sm text-[var(--muted)]">No sales data yet</div>
            </ClientOnly>
          </div>
        </div>

        <!-- Low stock + insights -->
        <div class="sc-card flex flex-col p-4">
          <h3 class="font-display m-0 text-lg text-chocolate">Stock alerts</h3>
          <ul class="mt-3 flex-1 space-y-2 text-sm">
            <li
              v-for="p in lowStock"
              :key="String(p.id)"
              class="flex justify-between border-b border-[var(--line)] py-2"
            >
              <span class="truncate pr-2">{{ p.name }}</span>
              <span class="shrink-0 font-semibold text-danger">{{ p.stock_qty }}</span>
            </li>
            <li v-if="!lowStock.length" class="text-[var(--muted)]">Stock looks fine</li>
          </ul>
          <UButton to="/inventory" color="primary" variant="soft" class=" mt-3 text-xs">Open inventory</UButton>
          <div v-if="insights.length" class="mt-4 rounded-xl bg-cream/80 p-3">
            <p class="text-[0.65rem] font-semibold uppercase tracking-wider text-[var(--muted)]">Insights</p>
            <ul class="mt-1 space-y-1 text-xs text-cocoa">
              <li v-for="(tip, i) in insights" :key="i">· {{ tip }}</li>
            </ul>
          </div>
        </div>
      </div>

      <!-- Recent orders -->
      <div class="sc-card overflow-hidden">
        <div class="flex items-center justify-between border-b border-[var(--line)] px-4 py-3">
          <h3 class="font-display m-0 text-lg">Recent orders</h3>
          <NuxtLink to="/orders" class="text-sm font-semibold text-honey">All orders →</NuxtLink>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="bg-cream/80 text-left text-[0.68rem] uppercase tracking-wider text-[var(--muted)]">
                <th class="px-4 py-3">Order</th>
                <th class="px-4 py-3">Amount</th>
                <th class="px-4 py-3">Payment</th>
                <th class="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="o in recent" :key="String(o.id)" class="border-t border-[var(--line)] hover:bg-cream/30">
                <td class="px-4 py-3">
                  <NuxtLink :to="`/orders/${o.id}`" class="font-semibold text-cocoa hover:text-honey">
                    {{ o.order_number }}
                  </NuxtLink>
                </td>
                <td class="px-4 py-3">{{ money(Number(o.final_amount)) }}</td>
                <td class="px-4 py-3 capitalize">{{ statusLabel(String(o.payment_status || o.payment_method || "—")) }}</td>
                <td class="px-4 py-3">
                  <span class="sc-badge" :class="statusClass(String(o.status))">{{ statusLabel(String(o.status)) }}</span>
                </td>
              </tr>
              <tr v-if="!recent.length">
                <td colspan="4" class="px-4 py-10 text-center text-[var(--muted)]">No orders yet — approve a shop and wait for first cart.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </div>
</template>

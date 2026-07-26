<script setup lang="ts">
import dayjs from "dayjs"
import { apiError, money, relativeAgo } from "~/utils/format"

const api = useApi()
const toast = useAppToast()
const socketLive = useState("adminSocketLive", () => false)
const { connect } = useSocket()

const period = ref<"daily" | "weekly" | "monthly">("weekly")
const tab = ref<"overview" | "shops" | "customers" | "riders" | "products">("overview")
const q = ref("")
const loading = ref(true)
const refreshing = ref(false)
const aiBusy = ref(false)
const error = ref("")
const loadedAt = ref("")

const data = ref<Record<string, unknown> | null>(null)
const ai = ref<{
  headline?: string
  insights?: string[]
  actions?: string[]
  provider?: string
} | null>(null)

const periodChips = [
  { label: "Daily", value: "daily" as const },
  { label: "Weekly", value: "weekly" as const },
  { label: "Monthly", value: "monthly" as const },
]

const tabs = [
  { value: "overview" as const, label: "Overview" },
  { value: "shops" as const, label: "Shops" },
  { value: "customers" as const, label: "Customers" },
  { value: "riders" as const, label: "Riders" },
  { value: "products" as const, label: "Products" },
]

const n = (k: string) => Number(data.value?.[k] ?? 0) || 0
const days = computed(() => Number(data.value?.days) || ({ daily: 1, weekly: 7, monthly: 30 }[period.value]))

const series = computed(() => {
  const raw = Array.isArray(data.value?.series) ? (data.value!.series as Record<string, unknown>[]) : []
  if (raw.length) {
    return raw.map((d) => ({
      date: String(d.date || ""),
      revenue: Number(d.revenue) || 0,
      orders: Number(d.orders) || 0,
    }))
  }
  // fill empty window so chart isn't blank
  const end = dayjs().startOf("day")
  return Array.from({ length: days.value }, (_, i) => {
    const d = end.subtract(days.value - 1 - i, "day")
    return { date: d.format("YYYY-MM-DD"), revenue: 0, orders: 0 }
  })
})

const maxSeries = computed(() => Math.max(1, ...series.value.map((d) => d.revenue)))

const chartPaths = computed(() => {
  const rows = series.value
  if (!rows.length) return { line: "", area: "" }
  const max = maxSeries.value
  const padX = 2
  const padY = 3
  const w = 100 - padX * 2
  const h = 40 - padY * 2
  const pts = rows.map((d, i) => {
    const x = padX + (rows.length === 1 ? w / 2 : (i / (rows.length - 1)) * w)
    const y = padY + h - (d.revenue / max) * h
    return { x, y }
  })
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ")
  const area = `${line} L${pts[pts.length - 1]!.x.toFixed(2)},${(padY + h).toFixed(2)} L${pts[0]!.x.toFixed(2)},${(padY + h).toFixed(2)} Z`
  return { line, area }
})

const stack = computed(() => {
  const raw = Array.isArray(data.value?.stack) ? (data.value!.stack as Record<string, unknown>[]) : []
  if (raw.length) {
    return raw.map((s) => ({
      key: String(s.key || s.label || ""),
      label: String(s.label || s.key || ""),
      value: Number(s.value) || 0,
    }))
  }
  return [
    { key: "revenue", label: "Revenue", value: n("sales_total") || n("revenue") },
    { key: "cogs", label: "COGS", value: n("cogs") },
    { key: "gross", label: "Gross", value: n("gross_profit") },
    { key: "rider", label: "Rider", value: n("rider_cost") },
    { key: "net", label: "Net", value: n("net_profit") || n("profit") },
  ]
})

const maxStack = computed(() => Math.max(1, ...stack.value.map((s) => Math.abs(s.value))))

const stackColor: Record<string, string> = {
  revenue: "bg-[#c8971a]",
  cogs: "bg-[#c4a39a]",
  gross: "bg-chocolate",
  rider: "bg-[#e8a87c]",
  net: "bg-[#e9748e]",
}

const byRider = computed(() =>
  Array.isArray(data.value?.by_rider) ? (data.value!.by_rider as Record<string, unknown>[]) : [],
)
const byRetailer = computed(() =>
  Array.isArray(data.value?.by_retailer) ? (data.value!.by_retailer as Record<string, unknown>[]) : [],
)
const byCustomer = computed(() =>
  Array.isArray(data.value?.by_customer) ? (data.value!.by_customer as Record<string, unknown>[]) : [],
)
const productSales = computed(() => {
  const raw = data.value?.product_sales
  if (Array.isArray(raw)) return raw as Record<string, unknown>[]
  if (raw && typeof raw === "object") {
    return Object.entries(raw as Record<string, number>).map(([name, qty]) => ({
      name,
      qty,
      revenue: 0,
      margin: 0,
    }))
  }
  return []
})

function filterRows(rows: Record<string, unknown>[], keys: string[]) {
  const ql = q.value.trim().toLowerCase()
  if (!ql) return rows
  return rows.filter((r) => keys.some((k) => String(r[k] || "").toLowerCase().includes(ql)))
}

const filteredShops = computed(() => filterRows(byRetailer.value, ["name"]))
const filteredCustomers = computed(() => filterRows(byCustomer.value, ["name"]))
const filteredRiders = computed(() => filterRows(byRider.value, ["name"]))
const filteredProducts = computed(() => filterRows(productSales.value, ["name", "product_name"]))

const maxProductRev = computed(() =>
  Math.max(1, ...productSales.value.map((p) => Number(p.revenue) || 0)),
)

function dayLabel(raw: unknown) {
  const d = dayjs(String(raw || ""))
  return d.isValid() ? d.format("D MMM") : String(raw || "—")
}

async function load(opts?: { quiet?: boolean }) {
  if (opts?.quiet) refreshing.value = true
  else loading.value = true
  error.value = ""
  try {
    data.value = (await api.admin.reports(period.value)) as Record<string, unknown>
    loadedAt.value = new Date().toISOString()
  } catch (e) {
    error.value = apiError(e)
    if (!opts?.quiet) toast.error(error.value)
  } finally {
    loading.value = false
    refreshing.value = false
  }
}

async function loadAi() {
  aiBusy.value = true
  try {
    const res = await api.admin.aiProfitSuggest(period.value)
    ai.value = {
      headline: String(res.headline || ""),
      insights: Array.isArray(res.insights) ? (res.insights as string[]) : [],
      actions: Array.isArray(res.actions) ? (res.actions as string[]) : [],
      provider: String(res.provider || ""),
    }
    if (!ai.value.insights?.length) toast.info("No AI tips yet — need a bit more sales history")
  } catch (e) {
    toast.error(apiError(e))
  } finally {
    aiBusy.value = false
  }
}

function exportCsv() {
  const d = data.value
  if (!d || !import.meta.client) return
  const lines = [
    ["metric", "value"],
    ["period", String(d.period || period.value)],
    ["revenue", String(n("sales_total") || n("revenue"))],
    ["cogs", String(n("cogs"))],
    ["gross_profit", String(n("gross_profit"))],
    ["rider_cost", String(n("rider_cost"))],
    ["net_profit", String(n("net_profit") || n("profit"))],
    ["gst_total", String(n("gst_total"))],
    ["collections", String(n("collections"))],
    ["purchase_spend", String(n("purchase_spend"))],
    ["payable_outstanding", String(n("payable_outstanding"))],
    [],
    ["section", "name", "orders", "revenue", "margin"],
    ...byRetailer.value.map((r) => ["shop", r.name, r.orders, r.revenue, r.margin]),
    ...byCustomer.value.map((r) => ["customer", r.name, r.orders, r.revenue, r.margin]),
    ...byRider.value.map((r) => ["rider", r.name, r.trips, r.order_revenue, r.contribution]),
    ...productSales.value.map((p) => ["product", p.name || p.product_name, p.qty, p.revenue, p.margin]),
  ]
  const csv = lines.map((row) => row.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n")
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `sweetcrust-profit-${period.value}-${dayjs().format("YYYYMMDD")}.csv`
  a.click()
  URL.revokeObjectURL(url)
  toast.success("CSV exported")
}

watch(period, () => {
  ai.value = null
  void load()
})

let liveSocket: ReturnType<typeof connect> = null
const onAdminEvent = (payload: Record<string, unknown>) => {
  const kind = String(payload?.kind || "")
  if (kind.includes("order") || kind.includes("payment") || kind.includes("purchase") || kind.includes("invoice")) {
    void load({ quiet: true })
  }
}

onMounted(() => {
  void load()
  liveSocket = connect()
  liveSocket?.on("admin_event", onAdminEvent)
})
onBeforeUnmount(() => {
  liveSocket?.off("admin_event", onAdminEvent)
})
</script>

<template>
  <div>
    <div class="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="font-display m-0 text-2xl text-chocolate sm:text-3xl">Profit & Reports</h1>
        <p class="m-0 mt-1 flex flex-wrap items-center gap-2 text-sm text-[var(--muted)]">
          <span
            class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.65rem] font-semibold"
            :class="socketLive ? 'bg-[#e8f6ee] text-[#2e7d4f]' : 'bg-[#f8ede6] text-[var(--muted)]'"
          >
            <span class="size-1.5 rounded-full" :class="socketLive ? 'animate-pulse bg-success' : 'bg-[#c4a39a]'" />
            {{ socketLive ? "Live" : "Offline" }}
          </span>
          <span>Customers · shops · riders · GST</span>
          <span v-if="loadedAt">· {{ relativeAgo(loadedAt) }}</span>
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
        <UButton color="neutral" variant="outline" icon="i-lucide-download" label="CSV" @click="exportCsv" />
        <UButton to="/invoices" color="neutral" variant="outline" icon="i-lucide-file-text" label="Invoices" />
        <UButton
          color="secondary"
          icon="i-lucide-sparkles"
          label="AI insights"
          :loading="aiBusy"
          @click="loadAi"
        />
      </div>
    </div>

    <p v-if="error" class="mb-3 text-sm text-danger">{{ error }}</p>

    <div class="mb-4 flex flex-wrap items-center gap-2">
      <button
        v-for="p in periodChips"
        :key="p.value"
        type="button"
        class="rounded-full px-3 py-1.5 text-xs font-semibold transition"
        :class="period === p.value ? 'bg-chocolate text-cream' : 'bg-white text-chocolate ring-1 ring-[var(--line)]'"
        @click="period = p.value"
      >
        {{ p.label }}
      </button>
      <p class="m-0 text-xs text-[var(--muted)] sm:ml-2">
        Net ≈ (sell − purchase cost) × qty + delivery − rider trips. Set product costs & buy-from-shops for accurate COGS.
      </p>
    </div>

    <div
      v-if="ai"
      class="mb-4 rounded-2xl border border-[var(--line)] bg-gradient-to-br from-white via-[#fff9f5] to-[#fff0f2] p-4 shadow-[0_8px_22px_-18px_rgba(74,44,42,0.35)]"
    >
      <div class="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p class="m-0 text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-[#e9748e]">AI profit pulse</p>
          <p class="font-display m-0 mt-1 text-xl text-chocolate">{{ ai.headline || "Insights" }}</p>
        </div>
        <span v-if="ai.provider" class="rounded-full bg-white px-2 py-0.5 text-[0.65rem] text-[var(--muted)] ring-1 ring-[var(--line)]">
          {{ ai.provider }}
        </span>
      </div>
      <ul class="mt-3 space-y-1.5 pl-4 text-sm text-chocolate">
        <li v-for="(tip, i) in ai.insights || []" :key="i">{{ tip }}</li>
      </ul>
      <div v-if="ai.actions?.length" class="mt-3 flex flex-wrap gap-1.5">
        <span
          v-for="(a, i) in ai.actions"
          :key="i"
          class="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-chocolate ring-1 ring-[var(--line)]"
        >
          {{ a }}
        </span>
      </div>
    </div>

    <div v-if="loading" class="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <div v-for="i in 8" :key="i" class="sc-skeleton h-24 rounded-2xl" />
    </div>
    <template v-else>
      <div class="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Revenue" :value="money(n('sales_total') || n('revenue'))" icon="lucide:wallet" />
        <StatCard label="COGS" :value="money(n('cogs'))" icon="lucide:package" :tone="n('missing_cost_lines') ? 'warn' : undefined" />
        <StatCard label="Gross profit" :value="money(n('gross_profit'))" icon="lucide:trending-up" tone="ok" />
        <StatCard
          label="Net profit"
          :value="money(n('net_profit') || n('profit'))"
          icon="lucide:indian-rupee"
          :hint="n('margin_pct') + '% margin · avg ' + money(n('avg_order'))"
        />
        <StatCard label="Rider cost" :value="money(n('rider_cost'))" icon="lucide:bike" />
        <StatCard label="Udhaar collected" :value="money(n('collections'))" icon="lucide:hand-coins" />
        <StatCard label="Bought from shops" :value="money(n('purchase_spend'))" icon="lucide:store" />
        <StatCard label="Still owe shops" :value="money(n('payable_outstanding'))" icon="lucide:scale" tone="warn" />
      </div>

      <div class="mb-4 grid gap-3 lg:grid-cols-3">
        <div class="rounded-2xl border border-[var(--line)] bg-white p-4 shadow-[0_8px_22px_-18px_rgba(74,44,42,0.35)] lg:col-span-2">
          <div class="mb-2 flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 class="font-display m-0 text-lg text-chocolate">Revenue series</h2>
              <p class="m-0 text-xs text-[var(--muted)]">Last {{ days }} days · peak {{ money(maxSeries) }}</p>
            </div>
            <span class="text-xs text-[var(--muted)]">
              {{ n('paid_order_count') || n('order_count') }} paid · GST {{ money(n('gst_total')) }}
            </span>
          </div>
          <div class="relative h-[200px] w-full">
            <svg viewBox="0 0 100 40" class="h-full w-full" preserveAspectRatio="none">
              <defs>
                <linearGradient id="profitArea" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stop-color="#e9748e" stop-opacity="0.35" />
                  <stop offset="100%" stop-color="#e9748e" stop-opacity="0.02" />
                </linearGradient>
              </defs>
              <path :d="chartPaths.area" fill="url(#profitArea)" />
              <path :d="chartPaths.line" fill="none" stroke="#e9748e" stroke-width="0.8" stroke-linecap="round" />
            </svg>
            <div class="mt-1 flex justify-between text-[0.65rem] text-[var(--muted)]">
              <span>{{ dayLabel(series[0]?.date) }}</span>
              <span>{{ dayLabel(series[series.length - 1]?.date) }}</span>
            </div>
          </div>
        </div>

        <div class="rounded-2xl border border-[var(--line)] bg-white p-4 shadow-[0_8px_22px_-18px_rgba(74,44,42,0.35)]">
          <h2 class="font-display m-0 text-lg text-chocolate">Profit stack</h2>
          <p class="m-0 mb-3 text-xs text-[var(--muted)]">Revenue → cost → profit</p>
          <div class="space-y-2.5">
            <div v-for="s in stack" :key="s.key">
              <div class="mb-0.5 flex justify-between text-xs">
                <span class="font-medium text-chocolate">{{ s.label }}</span>
                <span class="tabular-nums text-[var(--muted)]">{{ money(s.value) }}</span>
              </div>
              <div class="h-2 overflow-hidden rounded-full bg-[#fff9f5]">
                <div
                  class="h-full rounded-full transition-all"
                  :class="stackColor[s.key] || 'bg-[#e9748e]'"
                  :style="{ width: `${Math.min(100, (Math.abs(s.value) / maxStack) * 100)}%` }"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="t in tabs"
            :key="t.value"
            type="button"
            class="rounded-full px-3 py-1.5 text-xs font-semibold transition"
            :class="tab === t.value ? 'bg-chocolate text-cream' : 'bg-white text-chocolate ring-1 ring-[var(--line)]'"
            @click="tab = t.value"
          >
            {{ t.label }}
            <span v-if="t.value === 'shops'"> {{ byRetailer.length }}</span>
            <span v-else-if="t.value === 'customers'"> {{ byCustomer.length }}</span>
            <span v-else-if="t.value === 'riders'"> {{ byRider.length }}</span>
            <span v-else-if="t.value === 'products'"> {{ productSales.length }}</span>
          </button>
        </div>
        <label v-if="tab !== 'overview'" class="relative block w-full max-w-md">
          <UIcon name="i-lucide-search" class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--muted)]" />
          <input v-model="q" class="sc-input w-full !rounded-xl !py-2.5 !pl-9" placeholder="Search name…">
        </label>
      </div>

      <div v-if="tab === 'overview'" class="grid gap-3 lg:grid-cols-3">
        <article class="rounded-2xl border border-[var(--line)] bg-white p-4 shadow-[0_8px_22px_-18px_rgba(74,44,42,0.35)]">
          <p class="m-0 text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--muted)]">GST collected</p>
          <p class="font-display m-0 mt-1 text-3xl text-chocolate">{{ money(n('gst_total')) }}</p>
          <p class="m-0 mt-2 text-sm text-[var(--muted)]">Per-order tax docs live on Invoices.</p>
          <UButton to="/invoices" size="sm" color="secondary" variant="soft" class="mt-3" label="Open invoices" />
        </article>
        <article class="rounded-2xl border border-[var(--line)] bg-white p-4 shadow-[0_8px_22px_-18px_rgba(74,44,42,0.35)]">
          <p class="m-0 text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--muted)]">Orders in window</p>
          <p class="font-display m-0 mt-1 text-3xl text-chocolate">{{ n('order_count') }}</p>
          <p class="m-0 mt-2 text-sm text-[var(--muted)]">
            {{ n('paid_order_count') }} paid · {{ n('return_count') }} returns · {{ n('payment_count') }} payments
          </p>
          <UButton to="/orders" size="sm" color="neutral" variant="soft" class="mt-3" label="Orders" />
        </article>
        <article class="rounded-2xl border border-[var(--line)] bg-white p-4 shadow-[0_8px_22px_-18px_rgba(74,44,42,0.35)]">
          <p class="m-0 text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--muted)]">Cost hygiene</p>
          <p class="font-display m-0 mt-1 text-3xl text-chocolate">{{ n('missing_cost_lines') }}</p>
          <p class="m-0 mt-2 text-sm text-[var(--muted)]">Line items without unit cost in this period.</p>
          <UButton to="/pricing" size="sm" color="neutral" variant="soft" class="mt-3" label="Pricing / costs" />
        </article>
      </div>

      <div v-else-if="tab === 'shops'" class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <div
          v-if="!filteredShops.length"
          class="col-span-full rounded-2xl border border-dashed border-[var(--line)] py-16 text-center text-sm text-[var(--muted)]"
        >
          No B2B shop sales in this period
        </div>
        <article
          v-for="r in filteredShops"
          :key="String(r.user_id)"
          class="rounded-2xl border border-[var(--line)] bg-white p-3.5 shadow-[0_8px_22px_-18px_rgba(74,44,42,0.35)]"
        >
          <p class="m-0 truncate font-semibold text-chocolate">{{ r.name }}</p>
          <p class="m-0 mt-0.5 text-xs text-[var(--muted)]">{{ r.orders }} orders · rev {{ money(Number(r.revenue)) }}</p>
          <p class="m-0 mt-3 text-lg font-bold text-[#e9748e]">{{ money(Number(r.margin)) }}</p>
          <p class="m-0 text-[0.65rem] uppercase tracking-wide text-[var(--muted)]">Margin</p>
        </article>
      </div>

      <div v-else-if="tab === 'customers'" class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <div
          v-if="!filteredCustomers.length"
          class="col-span-full rounded-2xl border border-dashed border-[var(--line)] py-16 text-center text-sm text-[var(--muted)]"
        >
          No customer sales in this period
        </div>
        <article
          v-for="r in filteredCustomers"
          :key="String(r.user_id)"
          class="rounded-2xl border border-[var(--line)] bg-white p-3.5 shadow-[0_8px_22px_-18px_rgba(74,44,42,0.35)]"
        >
          <p class="m-0 truncate font-semibold text-chocolate">{{ r.name }}</p>
          <p class="m-0 mt-0.5 text-xs text-[var(--muted)]">{{ r.orders }} orders · rev {{ money(Number(r.revenue)) }}</p>
          <p class="m-0 mt-3 text-lg font-bold text-[#e9748e]">{{ money(Number(r.margin)) }}</p>
        </article>
      </div>

      <div v-else-if="tab === 'riders'" class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <div
          v-if="!filteredRiders.length"
          class="col-span-full rounded-2xl border border-dashed border-[var(--line)] py-16 text-center text-sm text-[var(--muted)]"
        >
          No delivered trips in this period
        </div>
        <article
          v-for="r in filteredRiders"
          :key="String(r.rider_id)"
          class="rounded-2xl border border-[var(--line)] bg-white p-3.5 shadow-[0_8px_22px_-18px_rgba(74,44,42,0.35)]"
        >
          <div class="flex items-start justify-between gap-2">
            <p class="m-0 truncate font-semibold text-chocolate">{{ r.name }}</p>
            <span class="shrink-0 text-sm font-bold text-[#e9748e]">{{ money(Number(r.contribution)) }}</span>
          </div>
          <p class="m-0 mt-2 text-xs text-[var(--muted)]">
            {{ r.trips }} trips · cost {{ money(Number(r.trip_cost)) }} · margin {{ money(Number(r.item_margin)) }}
          </p>
        </article>
      </div>

      <div v-else class="space-y-2">
        <div
          v-if="!filteredProducts.length"
          class="rounded-2xl border border-dashed border-[var(--line)] py-16 text-center text-sm text-[var(--muted)]"
        >
          No product sales in period
        </div>
        <article
          v-for="(p, i) in filteredProducts"
          :key="String(p.product_id || p.name || i)"
          class="rounded-2xl border border-[var(--line)] bg-white px-3.5 py-3 shadow-[0_8px_22px_-18px_rgba(74,44,42,0.35)]"
        >
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="min-w-0">
              <p class="m-0 truncate font-semibold text-chocolate">{{ p.name || p.product_name }}</p>
              <p class="m-0 text-xs text-[var(--muted)]">
                {{ p.qty ?? p.quantity ?? "—" }} sold · margin {{ money(Number(p.margin || 0)) }}
              </p>
            </div>
            <p class="m-0 shrink-0 font-bold text-chocolate">{{ money(Number(p.revenue || p.total || 0)) }}</p>
          </div>
          <div class="mt-2 h-1.5 overflow-hidden rounded-full bg-[#fff9f5]">
            <div
              class="h-full rounded-full bg-[#e9748e]"
              :style="{ width: `${Math.min(100, (Number(p.revenue || 0) / maxProductRev) * 100)}%` }"
            />
          </div>
        </article>
      </div>
    </template>
  </div>
</template>

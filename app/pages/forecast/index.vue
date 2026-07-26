<script setup lang="ts">
import dayjs from "dayjs"
import { apiError, money, statusLabel } from "~/utils/format"
import { resolveMediaUrl } from "~/utils/mapPins"

const api = useApi()
const toast = useAppToast()
const config = useRuntimeConfig()
const router = useRouter()
const socketLive = useState("adminSocketLive", () => false)
const { connect } = useSocket()

const loading = ref(true)
const refreshing = ref(false)
const skuBusy = ref(false)
const error = ref("")
const period = ref<"daily" | "weekly" | "monthly">("weekly")
const tab = ref<"demand" | "risk" | "revenue">("demand")
const riskFlag = ref<"all" | "critical" | "watch" | "low">("all")
const q = ref("")

const series = ref<Record<string, unknown>[]>([])
const topSkus = ref<Record<string, unknown>[]>([])
const atRisk = ref<Record<string, unknown>[]>([])
const catalog = ref<Record<string, unknown>[]>([])
const days = ref(7)

const stats = ref({
  projected_revenue: 0,
  actual_revenue: 0,
  avg_daily_revenue: 0,
  order_count: 0,
  units_sold: 0,
  sku_count: 0,
  skus_at_risk: 0,
  critical_risk: 0,
  top_sku: null as string | null,
  top_sku_qty: 0,
})

const panelOpen = ref(false)
const skuDetail = ref<Record<string, unknown> | null>(null)
const skuPick = ref("")

const periodChips = [
  { label: "Daily", value: "daily" as const },
  { label: "Weekly", value: "weekly" as const },
  { label: "Monthly", value: "monthly" as const },
]

const tabs = [
  { value: "demand" as const, label: "Top SKUs" },
  { value: "risk" as const, label: "Stockout risk" },
  { value: "revenue" as const, label: "Revenue" },
]

const riskTabs = [
  { value: "all" as const, label: "All" },
  { value: "critical" as const, label: "Critical" },
  { value: "watch" as const, label: "Watch" },
  { value: "low" as const, label: "Low stock" },
]

/** Fill every day in the window so the chart isn't one lonely fat bar. */
const chartSeries = computed(() => {
  const map = new Map(
    series.value.map((d) => [String(d.date), Number(d.revenue) || 0] as const),
  )
  const n = Math.max(1, days.value)
  const end = dayjs().startOf("day")
  const out: { date: string, revenue: number }[] = []
  for (let i = n - 1; i >= 0; i--) {
    const d = end.subtract(i, "day")
    const key = d.format("YYYY-MM-DD")
    out.push({ date: key, revenue: map.get(key) || 0 })
  }
  return out
})

const maxSeries = computed(() =>
  Math.max(1, ...chartSeries.value.map((d) => d.revenue)),
)

const yTicks = computed(() => {
  const max = maxSeries.value
  const step = max / 3
  return [0, step, step * 2, max].map((v) => Math.round(v * 100) / 100)
})

/** SVG polyline / area for the revenue chart (viewBox 0 0 100 40). */
const chartPaths = computed(() => {
  const rows = chartSeries.value
  if (!rows.length) return { line: "", area: "", points: [] as { x: number, y: number, r: number, date: string }[] }
  const max = maxSeries.value
  const padX = 2
  const padY = 3
  const w = 100 - padX * 2
  const h = 40 - padY * 2
  const pts = rows.map((d, i) => {
    const x = padX + (rows.length === 1 ? w / 2 : (i / (rows.length - 1)) * w)
    const y = padY + h - (d.revenue / max) * h
    return { x, y, r: d.revenue, date: d.date }
  })
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ")
  const area = `${line} L${pts[pts.length - 1]!.x.toFixed(2)},${(padY + h).toFixed(2)} L${pts[0]!.x.toFixed(2)},${(padY + h).toFixed(2)} Z`
  return { line, area, points: pts }
})

const maxSkuQty = computed(() =>
  Math.max(1, ...topSkus.value.map((s) => Number(s.qty) || 0)),
)

const filteredSkus = computed(() => {
  const ql = q.value.trim().toLowerCase()
  return topSkus.value.filter((s) => {
    if (!ql) return true
    return (
      String(s.name || "").toLowerCase().includes(ql)
      || String(s.product_id || "").includes(ql)
    )
  })
})

const filteredRisk = computed(() => {
  const ql = q.value.trim().toLowerCase()
  return atRisk.value.filter((r) => {
    if (riskFlag.value !== "all" && String(r.severity) !== riskFlag.value) return false
    if (!ql) return true
    return (
      String(r.name || "").toLowerCase().includes(ql)
      || String(r.product_id || "").includes(ql)
    )
  })
})

const catalogOptions = computed(() => {
  const ql = skuPick.value.trim().toLowerCase()
  const rows = catalog.value
    .filter((p) => {
      if (!ql) return true
      return String(p.name || "").toLowerCase().includes(ql) || String(p.id).includes(ql)
    })
    .slice(0, 12)
  return rows
})

function thumb(url: unknown) {
  return resolveMediaUrl(String(url || ""), String(config.public.apiBase || ""))
}

function hideBrokenImg(e: Event) {
  const el = e.target as HTMLImageElement | null
  if (el) el.style.display = "none"
}

function dayLabel(raw: unknown) {
  const d = dayjs(String(raw || ""))
  return d.isValid() ? d.format("D MMM") : String(raw || "—")
}

function coverTone(daysCover: unknown) {
  if (daysCover == null || daysCover === "") return "text-[var(--muted)]"
  const n = Number(daysCover)
  if (Number.isNaN(n)) return "text-[var(--muted)]"
  if (n < 1) return "text-[#c0392b]"
  if (n < 3) return "text-[#e9748e]"
  return "text-[#2e7d4f]"
}

function severityClass(sev: unknown) {
  const s = String(sev || "")
  if (s === "critical") return "bg-[#fdecea] text-[#c0392b]"
  if (s === "watch") return "bg-[#fff0f2] text-[#e9748e]"
  return "bg-[#f8ede6] text-chocolate"
}

async function load(opts: { quiet?: boolean } = {}) {
  if (opts.quiet) refreshing.value = true
  else loading.value = true
  error.value = ""
  try {
    const data = await api.admin.forecast(period.value)
    series.value = Array.isArray(data.series) ? data.series : []
    topSkus.value = Array.isArray(data.top_skus) ? data.top_skus : []
    atRisk.value = Array.isArray(data.at_risk) ? data.at_risk : []
    catalog.value = Array.isArray(data.catalog) ? data.catalog : []
    days.value = Number(data.days) || 7
    const st = data.stats || {}
    stats.value = {
      projected_revenue: Number(st.projected_revenue) || 0,
      actual_revenue: Number(st.actual_revenue) || 0,
      avg_daily_revenue: Number(st.avg_daily_revenue) || 0,
      order_count: Number(st.order_count) || 0,
      units_sold: Number(st.units_sold) || 0,
      sku_count: Number(st.sku_count) || 0,
      skus_at_risk: Number(st.skus_at_risk) || 0,
      critical_risk: Number(st.critical_risk) || 0,
      top_sku: st.top_sku != null ? String(st.top_sku) : null,
      top_sku_qty: Number(st.top_sku_qty) || 0,
    }
  } catch (e) {
    error.value = apiError(e)
    if (!opts.quiet) toast.error(error.value)
  } finally {
    loading.value = false
    refreshing.value = false
  }
}

async function openSku(productId: number) {
  if (!productId) return
  panelOpen.value = true
  skuBusy.value = true
  skuDetail.value = null
  try {
    skuDetail.value = await api.admin.forecastSku(productId, period.value)
  } catch (e) {
    toast.error(apiError(e))
    panelOpen.value = false
  } finally {
    skuBusy.value = false
  }
}

function pickCatalog(p: Record<string, unknown>) {
  skuPick.value = String(p.name || "")
  void openSku(Number(p.id))
}

function goInventory() {
  void router.push("/inventory")
}

function closePanel() {
  panelOpen.value = false
  skuDetail.value = null
}

watch(period, () => {
  void load()
})

let liveSocket: ReturnType<typeof connect> = null
onMounted(async () => {
  await load()
  liveSocket = connect()
  liveSocket?.on("admin_event", (data: Record<string, unknown>) => {
    const kind = String(data?.kind || "")
    if (kind.includes("order") || kind.includes("stock") || kind.includes("product")) {
      void load({ quiet: true })
    }
  })
})
onBeforeUnmount(() => {
  liveSocket?.off("admin_event")
})
</script>

<template>
  <div>
    <div class="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="font-display m-0 text-2xl text-chocolate sm:text-3xl">Forecast</h1>
        <p class="m-0 mt-1 flex flex-wrap items-center gap-2 text-sm text-[var(--muted)]">
          <span
            class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.65rem] font-semibold"
            :class="socketLive ? 'bg-[#e8f6ee] text-[#2e7d4f]' : 'bg-[#f8ede6] text-[var(--muted)]'"
          >
            <span class="size-1.5 rounded-full" :class="socketLive ? 'animate-pulse bg-success' : 'bg-[#c4a39a]'" />
            {{ socketLive ? "Live" : "Offline" }}
          </span>
          <span>Demand, stockout risk, revenue · next {{ days }} days</span>
        </p>
      </div>
      <div class="flex flex-wrap gap-2">
        <UButton
          to="/inventory"
          color="neutral"
          variant="outline"
          icon="i-lucide-boxes"
          label="Inventory"
        />
        <UButton
          color="primary"
          variant="soft"
          icon="i-lucide-refresh-cw"
          :loading="loading || refreshing"
          label="Refresh"
          @click="load()"
        />
      </div>
    </div>

    <p v-if="error" class="mb-3 text-sm text-danger">{{ error }}</p>

    <div class="mb-4 flex flex-wrap gap-1.5">
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
    </div>

    <div v-if="loading" class="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <div v-for="n in 4" :key="n" class="sc-skeleton h-24 rounded-2xl" />
    </div>
    <div v-else class="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard
        label="Projected revenue"
        :value="money(stats.projected_revenue)"
        icon="lucide:trending-up"
      />
      <StatCard
        label="Actual in window"
        :value="money(stats.actual_revenue)"
        icon="lucide:wallet"
      />
      <StatCard
        label="SKUs at risk"
        :value="stats.skus_at_risk"
        icon="lucide:alert-triangle"
        :tone="stats.skus_at_risk ? 'warn' : 'ok'"
      />
      <StatCard
        label="Units sold"
        :value="stats.units_sold"
        icon="lucide:package"
      />
    </div>

    <div class="mb-4 grid gap-3 lg:grid-cols-3">
      <div class="rounded-2xl border border-[var(--line)] bg-white p-4 shadow-[0_8px_22px_-18px_rgba(74,44,42,0.35)] lg:col-span-2">
        <div class="mb-1 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 class="font-display m-0 text-lg text-chocolate">Revenue series</h2>
            <p class="m-0 text-xs text-[var(--muted)]">
              Last {{ days }} days · peak {{ money(maxSeries) }}
            </p>
          </div>
          <span class="text-xs text-[var(--muted)]">
            avg {{ money(stats.avg_daily_revenue) }}/day · {{ stats.order_count }} orders
          </span>
        </div>

        <div class="mt-3 flex gap-3">
          <div class="flex w-10 shrink-0 flex-col justify-between py-1 text-right text-[0.6rem] font-medium text-[var(--muted)]">
            <span v-for="t in [...yTicks].reverse()" :key="t">{{ t >= 1000 ? `${(t / 1000).toFixed(1)}k` : Math.round(t) }}</span>
          </div>
          <div class="min-w-0 flex-1">
            <div class="relative h-48 overflow-hidden rounded-2xl bg-[#fff9f5] ring-1 ring-[var(--line)]">
              <div class="pointer-events-none absolute inset-3 flex flex-col justify-between">
                <div v-for="n in 4" :key="n" class="border-t border-dashed border-[#e8d5cc]" />
              </div>

              <svg class="absolute inset-3" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
                <defs>
                  <linearGradient id="fcRevFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="#e9748e" stop-opacity="0.4" />
                    <stop offset="100%" stop-color="#e9748e" stop-opacity="0" />
                  </linearGradient>
                </defs>
                <path v-if="chartPaths.area" :d="chartPaths.area" fill="url(#fcRevFill)" />
                <path
                  v-if="chartPaths.line"
                  :d="chartPaths.line"
                  fill="none"
                  stroke="#c45a72"
                  stroke-width="1.2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  vector-effect="non-scaling-stroke"
                />
              </svg>

              <div class="absolute inset-3">
                <span
                  v-for="p in chartPaths.points"
                  :key="p.date"
                  class="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white transition"
                  :class="p.r > 0 ? 'bg-chocolate' : 'bg-[#d4b8ae]'"
                  :style="{ left: `${p.x}%`, top: `${(p.y / 40) * 100}%` }"
                />
              </div>

              <!-- hover hit targets -->
              <div class="absolute inset-3 flex">
                <div
                  v-for="d in chartSeries"
                  :key="`hit-${d.date}`"
                  class="group relative min-w-0 flex-1"
                >
                  <div
                    class="pointer-events-none absolute top-2 left-1/2 z-10 hidden -translate-x-1/2 rounded-lg bg-chocolate px-2.5 py-1.5 text-[0.7rem] font-semibold text-cream shadow-lg whitespace-nowrap group-hover:block"
                  >
                    {{ dayLabel(d.date) }} · {{ money(d.revenue) }}
                  </div>
                  <div class="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-[#e9748e]/0 group-hover:bg-[#e9748e]/35" />
                </div>
              </div>
            </div>
            <div class="mt-2 flex px-1">
              <span
                v-for="(d, i) in chartSeries"
                :key="`lbl-${d.date}`"
                class="min-w-0 flex-1 truncate text-center text-[0.65rem] font-medium"
                :class="d.revenue > 0 ? 'text-chocolate' : 'text-[var(--muted)]'"
              >
                <template v-if="days <= 7 || i === 0 || i === chartSeries.length - 1 || i % Math.ceil(days / 7) === 0">
                  {{ dayjs(d.date).format(days > 14 ? "D/M" : "ddd") }}
                </template>
              </span>
            </div>
          </div>
        </div>
      </div>

      <div class="rounded-2xl border border-[var(--line)] bg-white p-4 shadow-[0_8px_22px_-18px_rgba(74,44,42,0.35)]">
        <h2 class="font-display m-0 text-lg text-chocolate">Spotlight</h2>
        <p class="m-0 mt-3 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Top seller</p>
        <p class="m-0 mt-1 text-lg font-semibold text-chocolate">
          {{ stats.top_sku || "—" }}
        </p>
        <p class="m-0 text-sm text-[var(--muted)]">
          {{ stats.top_sku_qty }} units · {{ stats.sku_count }} SKUs moving
        </p>
        <div class="mt-4 grid grid-cols-2 gap-2 rounded-xl bg-[#fff9f5] p-2.5 text-center">
          <div>
            <p class="m-0 text-[0.6rem] font-semibold uppercase tracking-wide text-[var(--muted)]">Critical</p>
            <p class="m-0 text-base font-bold text-[#c0392b]">{{ stats.critical_risk }}</p>
          </div>
          <div>
            <p class="m-0 text-[0.6rem] font-semibold uppercase tracking-wide text-[var(--muted)]">Window</p>
            <p class="m-0 text-base font-bold text-chocolate">{{ days }}d</p>
          </div>
        </div>
        <label class="mt-4 block">
          <span class="sc-label">Look up SKU</span>
          <input
            v-model="skuPick"
            class="sc-input w-full !rounded-xl"
            placeholder="Search product name…"
            autocomplete="off"
          >
        </label>
        <ul
          v-if="skuPick.trim() && catalogOptions.length"
          class="mt-1 max-h-40 overflow-y-auto rounded-xl border border-[var(--line)] bg-[#fffaf8]"
        >
          <li
            v-for="p in catalogOptions"
            :key="String(p.id)"
            class="flex cursor-pointer items-center gap-2 px-2.5 py-2 text-sm hover:bg-[#fff0f2]"
            @click="pickCatalog(p)"
          >
            <div class="size-8 shrink-0 overflow-hidden rounded-lg bg-[#fff5f7] ring-1 ring-[var(--line)]">
              <img
                v-if="thumb(p.cover_image_url)"
                :src="thumb(p.cover_image_url) || undefined"
                alt=""
                class="size-full object-cover"
                @error="hideBrokenImg"
              >
            </div>
            <span class="truncate font-medium text-chocolate">{{ p.name }}</span>
          </li>
        </ul>
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
          <span v-if="t.value === 'demand'"> {{ stats.sku_count }}</span>
          <span v-else-if="t.value === 'risk'"> {{ stats.skus_at_risk }}</span>
          <span v-else-if="t.value === 'revenue'"> {{ chartSeries.length }}</span>
        </button>
      </div>
      <label class="relative block w-full max-w-md">
        <UIcon name="i-lucide-search" class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--muted)]" />
        <input
          v-model="q"
          class="sc-input w-full !rounded-xl !py-2.5 !pl-9"
          placeholder="Filter SKUs…"
        >
      </label>
    </div>

    <!-- Demand / Top SKUs -->
    <template v-if="tab === 'demand'">
      <div v-if="loading" class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <div v-for="n in 6" :key="n" class="sc-skeleton h-36 rounded-2xl" />
      </div>
      <div
        v-else-if="!filteredSkus.length"
        class="rounded-2xl border border-dashed border-[var(--line)] py-16 text-center text-sm text-[var(--muted)]"
      >
        No sales in this window
      </div>
      <div v-else class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <article
          v-for="s in filteredSkus"
          :key="String(s.product_id)"
          class="cursor-pointer rounded-2xl border border-[var(--line)] bg-white p-3.5 shadow-[0_8px_22px_-18px_rgba(74,44,42,0.35)] transition hover:border-[#e9748e]/35"
          @click="openSku(Number(s.product_id))"
        >
          <div class="flex gap-3">
            <div class="size-14 shrink-0 overflow-hidden rounded-xl bg-[#fff5f7] ring-1 ring-[var(--line)]">
              <img
                v-if="thumb(s.cover_image_url)"
                :src="thumb(s.cover_image_url) || undefined"
                alt=""
                class="size-full object-cover"
                @error="hideBrokenImg"
              >
              <div v-else class="grid size-full place-items-center text-[#e9748e]">
                <UIcon name="i-lucide-cookie" class="size-6" />
              </div>
            </div>
            <div class="min-w-0 flex-1">
              <p class="m-0 truncate font-semibold text-chocolate">{{ s.name }}</p>
              <p class="m-0 mt-0.5 text-xs text-[var(--muted)]">
                {{ s.avg_per_day }} / day · cover
                <span :class="coverTone(s.days_of_cover)">
                  {{ s.days_of_cover != null ? `${s.days_of_cover}d` : "—" }}
                </span>
              </p>
              <div class="mt-2 h-1.5 overflow-hidden rounded-full bg-[#f8ede6]">
                <div
                  class="h-full rounded-full bg-[#e9748e]"
                  :style="{ width: `${Math.round((Number(s.qty) / maxSkuQty) * 100)}%` }"
                />
              </div>
            </div>
          </div>
          <div class="mt-3 grid grid-cols-3 gap-2 rounded-xl bg-[#fff9f5] px-2.5 py-2 text-center">
            <div>
              <p class="m-0 text-[0.6rem] font-semibold uppercase tracking-wide text-[var(--muted)]">Sold</p>
              <p class="m-0 text-sm font-bold text-chocolate">{{ s.qty }}</p>
            </div>
            <div>
              <p class="m-0 text-[0.6rem] font-semibold uppercase tracking-wide text-[var(--muted)]">Revenue</p>
              <p class="m-0 text-sm font-bold text-chocolate">{{ money(Number(s.revenue || 0)) }}</p>
            </div>
            <div>
              <p class="m-0 text-[0.6rem] font-semibold uppercase tracking-wide text-[var(--muted)]">Stock</p>
              <p class="m-0 text-sm font-bold text-chocolate">{{ s.stock_qty ?? "—" }}</p>
            </div>
          </div>
        </article>
      </div>
    </template>

    <!-- Stockout risk -->
    <template v-else-if="tab === 'risk'">
      <div class="mb-3 flex flex-wrap gap-1.5">
        <button
          v-for="t in riskTabs"
          :key="t.value"
          type="button"
          class="rounded-full px-3 py-1.5 text-xs font-semibold transition"
          :class="riskFlag === t.value ? 'bg-chocolate text-cream' : 'bg-white text-chocolate ring-1 ring-[var(--line)]'"
          @click="riskFlag = t.value"
        >
          {{ t.label }}
          <span v-if="t.value === 'critical'"> {{ stats.critical_risk }}</span>
        </button>
      </div>
      <div v-if="loading" class="grid gap-3 sm:grid-cols-2">
        <div v-for="n in 4" :key="n" class="sc-skeleton h-32 rounded-2xl" />
      </div>
      <div
        v-else-if="!filteredRisk.length"
        class="rounded-2xl border border-dashed border-[var(--line)] py-16 text-center text-sm text-[var(--muted)]"
      >
        No stockout risk — shelves look healthy
      </div>
      <div v-else class="grid gap-3 sm:grid-cols-2">
        <article
          v-for="r in filteredRisk"
          :key="String(r.product_id)"
          class="cursor-pointer rounded-2xl border border-[var(--line)] bg-white p-3.5 shadow-[0_8px_22px_-18px_rgba(74,44,42,0.35)] transition hover:border-[#e9748e]/35"
          @click="openSku(Number(r.product_id))"
        >
          <div class="flex gap-3">
            <div class="size-14 shrink-0 overflow-hidden rounded-xl bg-[#fff5f7] ring-1 ring-[var(--line)]">
              <img
                v-if="thumb(r.cover_image_url)"
                :src="thumb(r.cover_image_url) || undefined"
                alt=""
                class="size-full object-cover"
                @error="hideBrokenImg"
              >
              <div v-else class="grid size-full place-items-center text-[#e9748e]">
                <UIcon name="i-lucide-alert-triangle" class="size-5" />
              </div>
            </div>
            <div class="min-w-0 flex-1">
              <div class="flex items-start justify-between gap-2">
                <p class="m-0 truncate font-semibold text-chocolate">{{ r.name }}</p>
                <span
                  class="shrink-0 rounded-full px-2 py-0.5 text-[0.65rem] font-semibold capitalize"
                  :class="severityClass(r.severity)"
                >
                  {{ r.severity || "low" }}
                </span>
              </div>
              <p class="m-0 mt-0.5 text-xs text-[var(--muted)]">
                {{ statusLabel(String(r.stock_status || "")) }} · {{ r.velocity_per_day }}/day
              </p>
            </div>
          </div>
          <div class="mt-3 grid grid-cols-4 gap-2 rounded-xl bg-[#fff9f5] px-2.5 py-2 text-center">
            <div>
              <p class="m-0 text-[0.55rem] font-semibold uppercase tracking-wide text-[var(--muted)]">Stock</p>
              <p class="m-0 text-sm font-bold text-chocolate">{{ r.stock_qty }}</p>
            </div>
            <div>
              <p class="m-0 text-[0.55rem] font-semibold uppercase tracking-wide text-[var(--muted)]">Cover</p>
              <p class="m-0 text-sm font-bold" :class="coverTone(r.days_of_cover)">
                {{ r.days_of_cover != null ? `${r.days_of_cover}d` : "—" }}
              </p>
            </div>
            <div>
              <p class="m-0 text-[0.55rem] font-semibold uppercase tracking-wide text-[var(--muted)]">Restock</p>
              <p class="m-0 text-sm font-bold text-chocolate">{{ r.suggested_restock || 0 }}</p>
            </div>
            <div>
              <p class="m-0 text-[0.55rem] font-semibold uppercase tracking-wide text-[var(--muted)]">Price</p>
              <p class="m-0 text-sm font-bold text-chocolate">{{ money(Number(r.selling_price || 0)) }}</p>
            </div>
          </div>
        </article>
      </div>
    </template>

    <!-- Revenue table -->
    <template v-else>
      <div class="overflow-hidden rounded-2xl border border-[var(--line)] bg-white shadow-[0_8px_22px_-18px_rgba(74,44,42,0.35)]">
        <table class="sc-table">
          <thead>
            <tr>
              <th>Date</th>
              <th class="text-right">Revenue</th>
              <th class="hidden sm:table-cell">Share</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="d in [...chartSeries].reverse()" :key="d.date">
              <td class="font-semibold text-chocolate">{{ dayLabel(d.date) }}</td>
              <td class="text-right font-semibold text-chocolate">{{ money(d.revenue) }}</td>
              <td class="hidden sm:table-cell">
                <div class="flex items-center gap-2">
                  <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-[#f8ede6]">
                    <div
                      class="h-full rounded-full bg-[#e9748e]"
                      :style="{ width: `${Math.round((d.revenue / maxSeries) * 100)}%` }"
                    />
                  </div>
                  <span class="w-10 text-right text-xs text-[var(--muted)]">
                    {{ Math.round((d.revenue / maxSeries) * 100) }}%
                  </span>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <USlideover
      v-model:open="panelOpen"
      side="right"
      :title="String(skuDetail?.name || 'SKU forecast')"
      description="Velocity, cover, restock suggestion"
      :ui="{ content: 'w-full max-w-lg bg-[#fffaf8]' }"
      @update:open="(v: boolean) => { if (!v) closePanel() }"
    >
      <template #body>
        <div v-if="skuBusy" class="space-y-3">
          <div class="sc-skeleton h-20 rounded-2xl" />
          <div class="sc-skeleton h-32 rounded-2xl" />
        </div>
        <div v-else-if="skuDetail" class="flex flex-col gap-3 pb-6">
          <div class="flex gap-3">
            <div class="size-16 shrink-0 overflow-hidden rounded-2xl bg-[#fff5f7] ring-1 ring-[var(--line)]">
              <img
                v-if="thumb(skuDetail.cover_image_url)"
                :src="thumb(skuDetail.cover_image_url) || undefined"
                alt=""
                class="size-full object-cover"
                @error="hideBrokenImg"
              >
              <div v-else class="grid size-full place-items-center text-[#e9748e]">
                <UIcon name="i-lucide-cookie" class="size-7" />
              </div>
            </div>
            <div class="min-w-0">
              <p class="m-0 font-semibold text-chocolate">{{ skuDetail.name || `#${skuDetail.product_id}` }}</p>
              <p class="m-0 mt-0.5 text-xs text-[var(--muted)]">
                {{ statusLabel(String(skuDetail.stock_status || "—")) }}
                · {{ money(Number(skuDetail.selling_price || 0)) }}
              </p>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-2">
            <div class="rounded-xl bg-white p-3 ring-1 ring-[var(--line)]">
              <p class="m-0 text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--muted)]">Sold</p>
              <p class="m-0 text-xl font-bold text-chocolate">{{ skuDetail.units_sold }}</p>
              <p class="m-0 text-xs text-[var(--muted)]">{{ money(Number(skuDetail.revenue || 0)) }}</p>
            </div>
            <div class="rounded-xl bg-white p-3 ring-1 ring-[var(--line)]">
              <p class="m-0 text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--muted)]">Avg / day</p>
              <p class="m-0 text-xl font-bold text-chocolate">{{ skuDetail.avg_per_day }}</p>
              <p class="m-0 text-xs text-[var(--muted)]">proj {{ skuDetail.projected_units }} {{ skuDetail.unit_label }}</p>
            </div>
            <div class="rounded-xl bg-white p-3 ring-1 ring-[var(--line)]">
              <p class="m-0 text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--muted)]">Stock</p>
              <p class="m-0 text-xl font-bold text-chocolate">{{ skuDetail.stock_qty }}</p>
              <p class="m-0 text-xs text-[var(--muted)]">low @ {{ skuDetail.low_stock_threshold }}</p>
            </div>
            <div class="rounded-xl bg-white p-3 ring-1 ring-[var(--line)]">
              <p class="m-0 text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--muted)]">Days cover</p>
              <p class="m-0 text-xl font-bold" :class="coverTone(skuDetail.days_of_cover)">
                {{ skuDetail.days_of_cover != null ? skuDetail.days_of_cover : "—" }}
              </p>
              <p class="m-0 text-xs text-[var(--muted)]">suggest +{{ skuDetail.suggested_restock || 0 }}</p>
            </div>
          </div>

          <div class="flex flex-wrap gap-2 pt-1">
            <UButton
              color="primary"
              icon="i-lucide-boxes"
              label="Open inventory"
              @click="goInventory()"
            />
            <UButton
              color="neutral"
              variant="outline"
              icon="i-lucide-package"
              label="Products"
              to="/products"
            />
          </div>
        </div>
      </template>
    </USlideover>
  </div>
</template>

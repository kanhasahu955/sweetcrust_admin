<script setup lang="ts">
import { money } from "~/utils/format"

const api = useApi()
const period = ref("weekly")
const data = ref<Record<string, unknown> | null>(null)
const error = ref("")
const loading = ref(false)

async function load() {
  loading.value = true
  error.value = ""
  try {
    data.value = (await api.admin.reports(period.value)) as Record<string, unknown>
  } catch (e) {
    error.value = apiError(e)
  } finally {
    loading.value = false
  }
}

const cards = computed(() => {
  const d = data.value || {}
  const n = (k: string) => (d[k] != null ? Number(d[k]) : null)
  return [
    { label: "Revenue", value: n("sales_total") ?? n("revenue"), money: true },
    { label: "COGS (cost)", value: n("cogs"), money: true },
    { label: "Gross profit", value: n("gross_profit"), money: true },
    { label: "Net profit", value: n("net_profit") ?? n("profit"), money: true },
    { label: "Rider cost", value: n("rider_cost"), money: true },
    { label: "Udhaar collected", value: n("collections"), money: true },
    { label: "Bought from shops", value: n("purchase_spend"), money: true },
    { label: "Still owe shops", value: n("payable_outstanding"), money: true },
  ]
})

const profitBars = computed(() => {
  const d = data.value || {}
  const n = (k: string) => Number(d[k] || 0)
  return [
    { name: "Revenue", sales_count: Math.max(0, Math.round(n("sales_total") || n("revenue"))) },
    { name: "COGS", sales_count: Math.max(0, Math.round(n("cogs"))) },
    { name: "Gross", sales_count: Math.max(0, Math.round(n("gross_profit"))) },
    { name: "Rider", sales_count: Math.max(0, Math.round(n("rider_cost"))) },
    { name: "Net", sales_count: Math.max(0, Math.round(n("net_profit") || n("profit"))) },
  ]
})

const byRider = computed(() => (Array.isArray(data.value?.by_rider) ? data.value!.by_rider as Record<string, unknown>[] : []))
const byRetailer = computed(() => (Array.isArray(data.value?.by_retailer) ? data.value!.by_retailer as Record<string, unknown>[] : []))
const byCustomer = computed(() => (Array.isArray(data.value?.by_customer) ? data.value!.by_customer as Record<string, unknown>[] : []))
const productSales = computed(() =>
  Array.isArray(data.value?.product_sales) ? (data.value!.product_sales as Record<string, unknown>[]).slice(0, 12) : [],
)
const gstTotal = computed(() => (data.value?.gst_total != null ? Number(data.value.gst_total) : null))

onMounted(load)
watch(period, load)
</script>

<template>
  <div>
    <PageHeader title="Profit & Reports" subtitle="Your bakery profit across customers, shops, and riders">
      <template #actions>
        <select v-model="period" class="sc-input !w-auto">
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
        </select>
      </template>
    </PageHeader>
    <p v-if="error" class="mb-3 text-sm text-danger">{{ error }}</p>

    <p class="mb-4 text-sm text-[var(--muted)]">
      Net profit ≈ (sell price − purchase cost) × qty + delivery fees − rider trip costs.
      Set product <em>purchase cost</em> and use <strong>Buy from shops</strong> so costs stay accurate.
    </p>

    <div v-if="loading" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div v-for="i in 8" :key="i" class="sc-card h-24 animate-pulse" />
    </div>
    <div v-else class="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div v-for="c in cards" :key="c.label" class="sc-card p-4">
        <p class="sc-label !mb-1">{{ c.label }}</p>
        <p class="font-display text-2xl text-chocolate">
          {{ c.value == null || Number.isNaN(c.value) ? "—" : c.money ? money(c.value) : c.value }}
        </p>
      </div>
    </div>

    <div v-if="!loading" class="sc-card mb-6 p-4">
      <h3 class="font-display m-0 text-lg text-chocolate">Profit stack (₹)</h3>
      <p class="mb-3 text-xs text-[var(--muted)]">Compare revenue → cost → profit for this period</p>
      <div class="h-[240px]">
        <ClientOnly>
          <ChartsBestsellersChart :items="profitBars" />
        </ClientOnly>
      </div>
    </div>

    <div class="grid gap-4 lg:grid-cols-3">
      <div class="sc-card overflow-hidden">
        <p class="border-b border-[var(--line)] px-4 py-2 font-semibold">By shop (B2B margin)</p>
        <div class="max-h-72 divide-y divide-[var(--line)] overflow-y-auto text-sm">
          <div v-for="r in byRetailer" :key="String(r.user_id)" class="flex justify-between gap-2 px-4 py-2">
            <span>{{ r.name }} <span class="text-xs text-[var(--muted)]">({{ r.orders }} orders)</span></span>
            <span class="font-semibold text-honey">{{ money(Number(r.margin)) }}</span>
          </div>
          <EmptyState v-if="!byRetailer.length" class="m-3" title="No shop sales" />
        </div>
      </div>

      <div class="sc-card overflow-hidden">
        <p class="border-b border-[var(--line)] px-4 py-2 font-semibold">By customer (B2C margin)</p>
        <div class="max-h-72 divide-y divide-[var(--line)] overflow-y-auto text-sm">
          <div v-for="r in byCustomer" :key="String(r.user_id)" class="flex justify-between gap-2 px-4 py-2">
            <span>{{ r.name }} <span class="text-xs text-[var(--muted)]">({{ r.orders }})</span></span>
            <span class="font-semibold text-honey">{{ money(Number(r.margin)) }}</span>
          </div>
          <EmptyState v-if="!byCustomer.length" class="m-3" title="No customer sales" />
        </div>
      </div>

      <div class="sc-card overflow-hidden">
        <p class="border-b border-[var(--line)] px-4 py-2 font-semibold">By rider (margin − trip cost)</p>
        <div class="max-h-72 divide-y divide-[var(--line)] overflow-y-auto text-sm">
          <div v-for="r in byRider" :key="String(r.rider_id)" class="px-4 py-2">
            <div class="flex justify-between gap-2">
              <span class="font-semibold">{{ r.name }}</span>
              <span class="text-honey">{{ money(Number(r.contribution)) }}</span>
            </div>
            <p class="text-xs text-[var(--muted)]">
              {{ r.trips }} trips · cost {{ money(Number(r.trip_cost)) }} · margin {{ money(Number(r.item_margin)) }}
            </p>
          </div>
          <EmptyState v-if="!byRider.length" class="m-3" title="No delivered trips" />
        </div>
      </div>
    </div>

    <div class="mt-4 grid gap-4 lg:grid-cols-2">
      <div class="sc-card overflow-hidden">
        <p class="border-b border-[var(--line)] px-4 py-2 font-semibold">Top products</p>
        <div class="max-h-72 divide-y divide-[var(--line)] overflow-y-auto text-sm">
          <div v-for="(p, i) in productSales" :key="String(p.product_id || p.name || i)" class="flex justify-between gap-2 px-4 py-2">
            <span>{{ p.name || p.product_name || `SKU ${p.product_id}` }}</span>
            <span class="font-semibold">{{ p.qty ?? p.quantity ?? "—" }} · {{ money(Number(p.revenue ?? p.total ?? 0)) }}</span>
          </div>
          <EmptyState v-if="!productSales.length" class="m-3" title="No product sales in period" />
        </div>
      </div>
      <div class="sc-card p-4">
        <p class="sc-label">GST collected (period)</p>
        <p class="font-display text-2xl text-chocolate">{{ gstTotal == null || Number.isNaN(gstTotal) ? "—" : money(gstTotal) }}</p>
        <p class="mt-2 text-sm text-[var(--muted)]">Also see Invoices for per-order GST docs.</p>
        <UButton to="/invoices" color="primary" variant="soft" class=" mt-3 text-xs">Invoices</UButton>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { money } from "~/utils/format"

const api = useApi()
const loading = ref(true)
const error = ref("")
const period = ref("weekly")
const demand = ref<Record<string, unknown> | null>(null)
const stockout = ref<Record<string, unknown> | null>(null)
const revenue = ref<Record<string, unknown> | null>(null)
const skuId = ref<number | null>(null)
const sku = ref<Record<string, unknown> | null>(null)

const topSkus = computed(() =>
  Array.isArray(demand.value?.top_skus) ? (demand.value!.top_skus as Record<string, unknown>[]) : [],
)
const series = computed(() =>
  Array.isArray(demand.value?.series) ? (demand.value!.series as Record<string, unknown>[]) : [],
)
const atRisk = computed(() =>
  Array.isArray(stockout.value?.at_risk) ? (stockout.value!.at_risk as Record<string, unknown>[]) : [],
)

async function load() {
  loading.value = true
  error.value = ""
  try {
    const [d, s, r] = await Promise.all([
      api.admin.forecastDemand(period.value),
      api.admin.forecastStockout(period.value),
      api.admin.forecastRevenue(period.value),
    ])
    demand.value = d
    stockout.value = s
    revenue.value = r
  } catch (e) {
    error.value = apiError(e)
  } finally {
    loading.value = false
  }
}

async function loadSku() {
  if (!skuId.value) return
  try {
    sku.value = await api.admin.forecastSku(skuId.value, period.value)
  } catch (e) {
    error.value = apiError(e)
  }
}

onMounted(load)
watch(period, load)
</script>

<template>
  <div>
    <PageHeader title="Forecast" subtitle="Demand, stockout risk, and revenue projection">
      <template #actions>
        <select v-model="period" class="sc-input !w-auto">
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
        </select>
        <UButton color="primary" variant="soft" label="Refresh" @click="load" />
      </template>
    </PageHeader>

    <p v-if="error" class="mb-3 text-sm text-danger">{{ error }}</p>

    <div class="mb-4 grid gap-3 sm:grid-cols-3">
      <div class="sc-card p-4">
        <p class="sc-label">Projected revenue</p>
        <p class="font-display text-2xl text-chocolate">
          {{ money(Number(revenue?.projected_revenue ?? demand?.projected_revenue)) }}
        </p>
      </div>
      <div class="sc-card p-4">
        <p class="sc-label">SKUs at risk</p>
        <p class="font-display text-2xl text-honey">{{ stockout?.count ?? atRisk.length }}</p>
      </div>
      <div class="sc-card p-4">
        <p class="sc-label">Days in window</p>
        <p class="font-display text-2xl text-cocoa">{{ demand?.days ?? "—" }}</p>
      </div>
    </div>

    <div class="mb-4 grid gap-4 lg:grid-cols-2">
      <div class="sc-card p-4">
        <h3 class="font-display m-0 text-lg text-chocolate">Top SKUs</h3>
        <ul class="mt-3 space-y-1 text-sm">
          <li v-for="s in topSkus" :key="String(s.name)" class="flex justify-between border-b border-[var(--line)] py-1.5">
            <span>{{ s.name }}</span>
            <span class="font-semibold">{{ s.qty }}</span>
          </li>
        </ul>
        <EmptyState v-if="!loading && !topSkus.length" class="mt-2" title="No sales in window" />
      </div>

      <div class="sc-card p-4">
        <h3 class="font-display m-0 text-lg text-chocolate">Revenue series</h3>
        <ul class="mt-3 max-h-72 space-y-1 overflow-y-auto text-sm">
          <li v-for="d in series" :key="String(d.date)" class="flex justify-between border-b border-[var(--line)] py-1.5">
            <span class="text-[var(--muted)]">{{ d.date }}</span>
            <span class="font-semibold">{{ money(Number(d.revenue)) }}</span>
          </li>
        </ul>
        <EmptyState v-if="!loading && !series.length" class="mt-2" title="No series yet" />
      </div>
    </div>

    <div class="sc-card mb-4 overflow-x-auto">
      <p class="border-b border-[var(--line)] px-4 py-2 font-semibold">Stockout risk</p>
      <table class="w-full text-sm">
        <thead>
          <tr class="text-left text-[0.68rem] uppercase text-[var(--muted)]">
            <th class="px-4 py-2">Product</th>
            <th class="px-4 py-2">Stock</th>
            <th class="px-4 py-2">Velocity/day</th>
            <th class="px-4 py-2">Days cover</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in atRisk" :key="String(r.product_id)" class="border-t border-[var(--line)]">
            <td class="px-4 py-2 font-semibold">{{ r.name }}</td>
            <td class="px-4 py-2">{{ r.stock_qty }}</td>
            <td class="px-4 py-2">{{ r.velocity_per_day }}</td>
            <td class="px-4 py-2" :class="Number(r.days_of_cover) < 3 ? 'text-danger font-semibold' : ''">
              {{ r.days_of_cover ?? "—" }}
            </td>
          </tr>
        </tbody>
      </table>
      <EmptyState v-if="!loading && !atRisk.length" class="m-4" title="No stockout risk" />
    </div>

    <div class="sc-card grid gap-3 p-4 sm:grid-cols-3">
      <label class="sm:col-span-2">
        <span class="sc-label">SKU forecast (product id)</span>
        <input v-model.number="skuId" type="number" class="sc-input" placeholder="e.g. 12">
      </label>
      <div class="flex items-end">
        <UButton class="w-full" label="Lookup" @click="loadSku" />
      </div>
      <p v-if="sku" class="sm:col-span-3 text-sm">
        <span class="font-semibold">{{ sku.name || `#${sku.product_id}` }}</span>
        · sold {{ sku.units_sold }} · avg/day {{ sku.avg_per_day }} · projected {{ sku.projected_units }}
      </p>
    </div>
  </div>
</template>

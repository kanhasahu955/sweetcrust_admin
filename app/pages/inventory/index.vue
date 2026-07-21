<script setup lang="ts">
import { money } from "~/utils/format"
import { patchListRow, upsertListRow } from "~/utils/list"

const api = useApi()
const loading = ref(true)
const error = ref("")
const items = ref<Record<string, unknown>[]>([])
const lowStock = ref<Record<string, unknown>[]>([])
const suggestions = ref<Record<string, unknown>[]>([])
const movements = ref<Record<string, unknown>[]>([])
const stockForm = reactive({ id: 0, name: "", stock_qty: 0, reason: "adjust" })

async function load(quiet = false) {
  if (!quiet) loading.value = true
  error.value = ""
  try {
    const data = (await api.admin.inventory()) as Record<string, unknown>
    const current = Array.isArray(data?.current) ? data.current : []
    items.value = current as Record<string, unknown>[]
    lowStock.value = (Array.isArray(data?.low_stock) ? data.low_stock : []) as Record<string, unknown>[]
    movements.value = (Array.isArray(data?.movements) ? data.movements : []) as Record<string, unknown>[]
    const ai = (data?.ai || {}) as Record<string, unknown>
    suggestions.value = (Array.isArray(ai.restock_suggestions) ? ai.restock_suggestions : []) as Record<string, unknown>[]
  } catch (e) {
    error.value = apiError(e)
  } finally {
    if (!quiet) loading.value = false
  }
}

function pick(p: Record<string, unknown>) {
  stockForm.id = Number(p.id)
  stockForm.name = String(p.name || "")
  stockForm.stock_qty = Number(p.stock_qty) || 0
}

async function updateStock() {
  if (!stockForm.id) return
  error.value = ""
  try {
    const saved = await api.admin.updateStock(stockForm.id, {
      stock_qty: stockForm.stock_qty,
      reason: stockForm.reason,
    })
    if (!upsertListRow(items, saved)) {
      patchListRow(items, stockForm.id, { stock_qty: stockForm.stock_qty })
    }
    void load(true)
  } catch (e) {
    error.value = apiError(e)
  }
}

onMounted(load)
</script>

<template>
  <div>
    <PageHeader title="Inventory" subtitle="Stock levels, low stock alerts, and quick adjustments">
      <template #actions>
        <UButton type="button" color="primary" variant="soft" @click="load">Refresh</UButton>
        <UButton to="/purchases">Buy from shops</UButton>
      </template>
    </PageHeader>
    <p v-if="error" class="mb-3 text-sm text-danger">{{ error }}</p>

    <div class="mb-4 grid gap-3 sm:grid-cols-3">
      <div class="sc-card p-4">
        <p class="sc-label">SKUs</p>
        <p class="font-display text-2xl text-chocolate">{{ items.length }}</p>
      </div>
      <div class="sc-card p-4">
        <p class="sc-label">Low stock</p>
        <p class="font-display text-2xl text-honey">{{ lowStock.length }}</p>
      </div>
      <div class="sc-card p-4">
        <p class="sc-label">Restock tips</p>
        <p class="font-display text-2xl text-cocoa">{{ suggestions.length }}</p>
      </div>
    </div>

    <div class="sc-card mb-4 grid gap-3 p-4 sm:grid-cols-4">
      <label>
        <span class="sc-label">Product</span>
        <input :value="stockForm.name || (stockForm.id ? `#${stockForm.id}` : '')" class="sc-input" readonly placeholder="Click a row">
      </label>
      <label>
        <span class="sc-label">New qty</span>
        <input v-model.number="stockForm.stock_qty" type="number" class="sc-input">
      </label>
      <label>
        <span class="sc-label">Reason</span>
        <input v-model="stockForm.reason" class="sc-input" placeholder="adjust / purchase / damage">
      </label>
      <div class="flex items-end">
        <UButton type="button" class=" w-full" :disabled="!stockForm.id" @click="updateStock">Update stock</UButton>
      </div>
    </div>

    <div v-if="suggestions.length" class="sc-card mb-4 p-4">
      <h3 class="font-display m-0 text-lg">Restock suggestions</h3>
      <ul class="mt-2 space-y-1 text-sm">
        <li v-for="s in suggestions" :key="String(s.product_id)" class="flex justify-between border-b border-[var(--line)] py-1.5">
          <span>{{ s.name }}</span>
          <button type="button" class="text-honey font-semibold" @click="pick({ id: s.product_id, name: s.name, stock_qty: s.suggest_qty })">
            Suggest {{ s.suggest_qty }}
          </button>
        </li>
      </ul>
    </div>

    <div class="sc-card mb-4 overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="bg-cream/80 text-left text-[0.68rem] uppercase tracking-wider text-[var(--muted)]">
            <th class="px-4 py-3">ID</th>
            <th class="px-4 py-3">Name</th>
            <th class="px-4 py-3">Brand</th>
            <th class="px-4 py-3">Stock</th>
            <th class="px-4 py-3">Status</th>
            <th class="px-4 py-3">Cost</th>
            <th class="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="p in items"
            :key="String(p.id)"
            class="border-t border-[var(--line)] cursor-pointer hover:bg-cream/40"
            @click="pick(p)"
          >
            <td class="px-4 py-3">{{ p.id }}</td>
            <td class="px-4 py-3 font-semibold">{{ p.name }}</td>
            <td class="px-4 py-3 text-xs text-[var(--muted)]">{{ p.brand_name || "—" }}</td>
            <td class="px-4 py-3" :class="Number(p.stock_qty) < 10 ? 'text-danger font-semibold' : ''">{{ p.stock_qty }}</td>
            <td class="px-4 py-3 capitalize">{{ String(p.stock_status || "—").replace(/_/g, " ") }}</td>
            <td class="px-4 py-3">{{ money(Number(p.purchase_cost || 0)) }}</td>
            <td class="px-4 py-3 text-right">
              <UButton type="button" color="primary" variant="soft" class=" !py-1 text-xs" @click.stop="pick(p)">Adjust</UButton>
            </td>
          </tr>
        </tbody>
      </table>
      <EmptyState v-if="!loading && !items.length" class="m-4" title="No inventory rows" body="Add products first." />
    </div>

    <div v-if="movements.length" class="sc-card overflow-x-auto">
      <p class="border-b border-[var(--line)] px-4 py-2 font-semibold">Recent movements</p>
      <table class="w-full text-sm">
        <thead>
          <tr class="text-left text-[0.68rem] uppercase tracking-wider text-[var(--muted)]">
            <th class="px-4 py-2">Product</th>
            <th class="px-4 py-2">Qty</th>
            <th class="px-4 py-2">Reason</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="m in movements.slice(0, 20)" :key="String(m.id)" class="border-t border-[var(--line)]">
            <td class="px-4 py-2">#{{ m.product_id }}</td>
            <td class="px-4 py-2">{{ m.change_qty ?? m.quantity ?? m.delta }}</td>
            <td class="px-4 py-2">{{ m.reason || m.note || "—" }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { money } from "~/utils/format"
import { patchListRow, upsertListRow } from "~/utils/list"

const api = useApi()
const loading = ref(true)
const error = ref("")
const info = ref("")
const rows = ref<Record<string, unknown>[]>([])
const total = ref(0)
const page = ref(1)
const edit = reactive({
  id: 0,
  name: "",
  selling_price: 0,
  customer_price: 0,
  shop_price: 0,
  purchase_cost: 0,
  discount_percent: 0,
  gst_rate: 0,
})
const busy = ref(false)

async function load() {
  loading.value = true
  error.value = ""
  try {
    const res = await api.admin.pricingProducts(page.value, 50)
    rows.value = Array.isArray(res.items) ? res.items : []
    total.value = Number(res.total) || rows.value.length
  } catch (e) {
    error.value = apiError(e)
  } finally {
    loading.value = false
  }
}

function pick(r: Record<string, unknown>) {
  edit.id = Number(r.id)
  edit.name = String(r.name || "")
  edit.selling_price = Number(r.selling_price) || 0
  edit.customer_price = Number(r.customer_price) || 0
  edit.shop_price = Number(r.shop_price) || 0
  edit.purchase_cost = Number(r.purchase_cost) || 0
  edit.discount_percent = Number(r.discount_percent) || 0
  edit.gst_rate = Number(r.gst_rate) || 0
}

async function save() {
  if (!edit.id) return
  busy.value = true
  error.value = ""
  const patch = {
    selling_price: edit.selling_price,
    customer_price: edit.customer_price,
    shop_price: edit.shop_price,
    purchase_cost: edit.purchase_cost,
    discount_percent: edit.discount_percent,
    gst_rate: edit.gst_rate,
  }
  try {
    const saved = await api.admin.patchPricing(edit.id, patch)
    if (!upsertListRow(rows, saved)) patchListRow(rows, edit.id, patch)
    info.value = `Saved prices for #${edit.id}`
    void load()
  } catch (e) {
    error.value = apiError(e)
  } finally {
    busy.value = false
  }
}

onMounted(load)
watch(page, load)
</script>

<template>
  <div>
    <PageHeader title="Pricing" subtitle="Customer, shop, and cost prices per SKU">
      <template #actions>
        <UButton color="primary" variant="soft" label="Refresh" @click="load" />
      </template>
    </PageHeader>

    <p v-if="error" class="mb-3 text-sm text-danger">{{ error }}</p>
    <p v-if="info" class="mb-3 rounded-xl bg-blush/50 px-3 py-2 text-sm text-cocoa">{{ info }}</p>

    <div v-if="edit.id" class="sc-card mb-4 grid gap-3 p-4 sm:grid-cols-3 lg:grid-cols-4">
      <p class="sm:col-span-3 lg:col-span-4 font-display text-lg text-chocolate">Edit · {{ edit.name }} (#{{ edit.id }})</p>
      <label><span class="sc-label">Selling</span><input v-model.number="edit.selling_price" type="number" class="sc-input"></label>
      <label><span class="sc-label">Customer</span><input v-model.number="edit.customer_price" type="number" class="sc-input"></label>
      <label><span class="sc-label">Shop (B2B)</span><input v-model.number="edit.shop_price" type="number" class="sc-input"></label>
      <label><span class="sc-label">Cost</span><input v-model.number="edit.purchase_cost" type="number" class="sc-input"></label>
      <label><span class="sc-label">Discount %</span><input v-model.number="edit.discount_percent" type="number" class="sc-input"></label>
      <label><span class="sc-label">GST %</span><input v-model.number="edit.gst_rate" type="number" class="sc-input"></label>
      <div class="flex items-end gap-2 sm:col-span-2">
        <UButton :loading="busy" label="Save prices" @click="save" />
        <UButton color="neutral" variant="outline" label="Cancel" @click="edit.id = 0" />
      </div>
    </div>

    <div class="sc-card overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="bg-cream/80 text-left text-[0.68rem] uppercase tracking-wider text-[var(--muted)]">
            <th class="px-4 py-3">ID</th>
            <th class="px-4 py-3">Name</th>
            <th class="px-4 py-3">Brand</th>
            <th class="px-4 py-3">Customer</th>
            <th class="px-4 py-3">Shop</th>
            <th class="px-4 py-3">Cost</th>
            <th class="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="String(r.id)" class="border-t border-[var(--line)] hover:bg-cream/40">
            <td class="px-4 py-3">{{ r.id }}</td>
            <td class="px-4 py-3 font-semibold">{{ r.name }}</td>
            <td class="px-4 py-3 text-xs text-[var(--muted)]">{{ r.brand_name || "—" }}</td>
            <td class="px-4 py-3">{{ money(Number(r.customer_unit ?? r.customer_price)) }}</td>
            <td class="px-4 py-3">{{ money(Number(r.shop_unit ?? r.shop_price)) }}</td>
            <td class="px-4 py-3">{{ money(Number(r.purchase_cost)) }}</td>
            <td class="px-4 py-3 text-right">
              <UButton size="xs" color="primary" variant="soft" label="Edit" @click="pick(r)" />
            </td>
          </tr>
        </tbody>
      </table>
      <EmptyState v-if="!loading && !rows.length" class="m-4" title="No priced products" />
    </div>

    <div v-if="total > 50" class="mt-3 flex gap-2">
      <UButton color="neutral" variant="outline" size="sm" :disabled="page <= 1" label="Prev" @click="page--" />
      <span class="text-sm text-[var(--muted)] self-center">Page {{ page }} · {{ total }} SKUs</span>
      <UButton color="neutral" variant="outline" size="sm" :disabled="page * 50 >= total" label="Next" @click="page++" />
    </div>
  </div>
</template>

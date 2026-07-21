<script setup lang="ts">
import { money, statusLabel } from "~/utils/format"

const api = useApi()
const loading = ref(true)
const error = ref("")
const info = ref("")
const orders = ref<Record<string, unknown>[]>([])
const busyId = ref<number | null>(null)

async function load() {
  loading.value = true
  try {
    const data = await api.admin.orders()
    orders.value = Array.isArray(data) ? (data as Record<string, unknown>[]).slice(0, 40) : []
  } catch (e) {
    error.value = apiError(e)
  } finally {
    loading.value = false
  }
}

async function invoice(id: number) {
  busyId.value = id
  error.value = ""
  try {
    const res = await api.admin.createInvoice(id)
    info.value = String(res.invoice_number || res.message || `Invoice created for #${id}`)
  } catch (e) {
    error.value = apiError(e)
  } finally {
    busyId.value = null
  }
}

onMounted(load)
</script>

<template>
  <div>
    <PageHeader title="Invoices / GST" subtitle="Generate invoice from recent orders" />
    <p v-if="error" class="mb-3 text-sm text-danger">{{ error }}</p>
    <p v-if="info" class="mb-3 rounded-xl bg-blush/50 px-3 py-2 text-sm text-cocoa">{{ info }}</p>
    <div class="sc-card overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="bg-cream/80 text-left text-[0.68rem] uppercase tracking-wider text-[var(--muted)]">
            <th class="px-4 py-3">Order</th>
            <th class="px-4 py-3">Status</th>
            <th class="px-4 py-3">Amount</th>
            <th class="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          <tr v-for="o in orders" :key="String(o.id)" class="border-t border-[var(--line)]">
            <td class="px-4 py-3 font-semibold">
              <NuxtLink :to="`/orders/${o.id}`" class="hover:text-honey">{{ o.order_number || o.id }}</NuxtLink>
            </td>
            <td class="px-4 py-3 capitalize">{{ statusLabel(String(o.status)) }}</td>
            <td class="px-4 py-3">{{ money(Number(o.final_amount)) }}</td>
            <td class="px-4 py-3 text-right">
              <UButton type="button" color="primary" variant="soft" class=" !py-1.5 text-xs" :disabled="busyId === Number(o.id)" @click="invoice(Number(o.id))">
                Invoice
              </UButton>
            </td>
          </tr>
        </tbody>
      </table>
      <EmptyState v-if="!loading && !orders.length" class="m-4" title="No orders yet" body="Invoices are created from order detail or here." />
    </div>
  </div>
</template>

<script setup lang="ts">
import { money, statusClass, statusLabel } from "~/utils/format"

const api = useApi()
const status = ref("")
const loading = ref(true)
const error = ref("")
const rows = ref<Record<string, unknown>[]>([])

const tabs = [
  { label: "All", value: "" },
  { label: "Placed", value: "placed" },
  { label: "Accepted", value: "accepted" },
  { label: "Packed", value: "packed" },
  { label: "Out", value: "out_for_delivery" },
  { label: "Delivered", value: "delivered" },
  { label: "Cancelled", value: "cancelled" },
]

async function load() {
  loading.value = true
  error.value = ""
  try {
    const data = await api.admin.orders(status.value || undefined)
    rows.value = Array.isArray(data) ? (data as Record<string, unknown>[]) : []
  } catch (e) {
    error.value = apiError(e)
  } finally {
    loading.value = false
  }
}

watch(status, load, { immediate: true })
</script>

<template>
  <div>
    <PageHeader title="Orders" subtitle="B2B shop orders and local deliveries" />
    <div class="mb-4 flex flex-wrap gap-2">
      <button
        v-for="t in tabs"
        :key="t.value || 'all'"
        type="button"
        class="rounded-full px-3 py-1.5 text-xs font-semibold"
        :class="status === t.value ? 'bg-cocoa text-cream' : 'bg-cream text-[var(--muted)]'"
        @click="status = t.value"
      >
        {{ t.label }}
      </button>
    </div>
    <p v-if="error" class="mb-3 text-sm text-danger">{{ error }}</p>
    <div v-if="loading" class="sc-card h-40 animate-pulse" />
    <div v-else class="sc-card overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="bg-cream/80 text-left text-[0.68rem] uppercase tracking-wider text-[var(--muted)]">
            <th class="px-4 py-3">Order</th>
            <th class="px-4 py-3">Type</th>
            <th class="px-4 py-3">Amount</th>
            <th class="px-4 py-3">Pay</th>
            <th class="px-4 py-3">Status</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="o in rows" :key="String(o.id)" class="border-t border-[var(--line)] hover:bg-cream/40">
            <td class="px-4 py-3">
              <NuxtLink :to="`/orders/${o.id}`" class="font-semibold text-cocoa">{{ o.order_number }}</NuxtLink>
            </td>
            <td class="px-4 py-3 capitalize">{{ statusLabel(String(o.order_type || "—")) }}</td>
            <td class="px-4 py-3">{{ money(Number(o.final_amount)) }}</td>
            <td class="px-4 py-3 capitalize">{{ statusLabel(String(o.payment_method || o.payment_status || "—")) }}</td>
            <td class="px-4 py-3">
              <span class="sc-badge" :class="statusClass(String(o.status))">{{ statusLabel(String(o.status)) }}</span>
            </td>
          </tr>
        </tbody>
      </table>
      <EmptyState v-if="!rows.length" class="m-4" title="No orders" body="New shop orders will show here." />
    </div>
  </div>
</template>

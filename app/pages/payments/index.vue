<script setup lang="ts">
import { useAppToast } from "~/composables/useAppToast"
import { money, statusLabel } from "~/utils/format"

const api = useApi()
const toast = useAppToast()
const { confirm } = useConfirm()
const rows = ref<Record<string, unknown>[]>([])
const shops = ref<Record<string, unknown>[]>([])
const error = ref("")
const info = ref("")
const busyId = ref<number | null>(null)

const udhaarDue = computed(() =>
  shops.value.reduce((a, s) => a + (Number(s.outstanding_balance) || 0), 0),
)

async function load() {
  error.value = ""
  try {
    const [payments, shopList] = await Promise.all([
      api.admin.payments(),
      api.admin.shops().catch(() => []),
    ])
    rows.value = Array.isArray(payments) ? (payments as Record<string, unknown>[]) : []
    shops.value = Array.isArray(shopList) ? (shopList as Record<string, unknown>[]) : []
  } catch (e) {
    error.value = apiError(e)
  }
}

async function refund(id: number) {
  const ok = await confirm({
    title: "Refund payment",
    message: `Refund payment #${id}? This marks the payment as refunded.`,
    confirmText: "Refund",
    tone: "danger",
  })
  if (!ok) return
  busyId.value = id
  error.value = ""
  info.value = ""
  try {
    await api.admin.refundPayment(id, {})
    info.value = `Payment #${id} marked refunded`
    toast.success("Payment refunded")
    await load()
  } catch (e) {
    error.value = apiError(e)
    toast.error("Refund failed", apiError(e))
  } finally {
    busyId.value = null
  }
}

function canRefund(p: Record<string, unknown>) {
  const s = String(p.status || "").toLowerCase()
  return s === "paid" || s === "partially_paid"
}

onMounted(load)
</script>

<template>
  <div>
    <PageHeader title="Payments & Credit" subtitle="UPI, COD, refunds — collect shop udhaar from Shops">
      <template #actions>
        <UButton type="button" color="primary" variant="soft" @click="load">Refresh</UButton>
        <UButton to="/shops">Collect udhaar</UButton>
      </template>
    </PageHeader>
    <p v-if="error" class="mb-3 text-sm text-danger">{{ error }}</p>
    <p v-if="info" class="mb-3 rounded-xl bg-blush/50 px-3 py-2 text-sm text-cocoa">{{ info }}</p>

    <div class="mb-4 grid gap-3 sm:grid-cols-2">
      <div class="sc-card p-4">
        <p class="sc-label">Shop udhaar outstanding</p>
        <p class="font-display text-2xl text-chocolate">{{ money(udhaarDue) }}</p>
        <NuxtLink to="/shops" class="mt-2 inline-block text-sm font-semibold text-honey">Open shops →</NuxtLink>
      </div>
      <div class="sc-card p-4">
        <p class="sc-label">Payment rows</p>
        <p class="font-display text-2xl text-chocolate">{{ rows.length }}</p>
      </div>
    </div>

    <div class="sc-card overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="bg-cream/80 text-left text-[0.68rem] uppercase tracking-wider text-[var(--muted)]">
            <th class="px-4 py-3">ID</th>
            <th class="px-4 py-3">Order</th>
            <th class="px-4 py-3">Amount</th>
            <th class="px-4 py-3">Method</th>
            <th class="px-4 py-3">Status</th>
            <th class="px-4 py-3">When</th>
            <th class="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in rows" :key="String(p.id)" class="border-t border-[var(--line)]">
            <td class="px-4 py-3">{{ p.id }}</td>
            <td class="px-4 py-3">
              <NuxtLink v-if="p.order_id" :to="`/orders/${p.order_id}`" class="font-semibold text-cocoa hover:text-honey">
                #{{ p.order_id }}
              </NuxtLink>
              <span v-else>—</span>
            </td>
            <td class="px-4 py-3">{{ money(Number(p.amount)) }}</td>
            <td class="px-4 py-3 capitalize">{{ statusLabel(String(p.method || p.payment_method || "—")) }}</td>
            <td class="px-4 py-3 capitalize">{{ statusLabel(String(p.status || "—")) }}</td>
            <td class="px-4 py-3 text-[var(--muted)] text-xs">
              {{ p.paid_at || p.created_at ? String(p.paid_at || p.created_at).slice(0, 16).replace("T", " ") : "—" }}
            </td>
            <td class="px-4 py-3 text-right">
              <UButton color="neutral" variant="outline" v-if="canRefund(p)"
                type="button" class="!py-1 text-xs" 
                :disabled="busyId === Number(p.id)"
                @click="refund(Number(p.id))"
              >
                Refund
              </UButton>
            </td>
          </tr>
        </tbody>
      </table>
      <EmptyState v-if="!rows.length" class="m-4" title="No payments yet" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { money, statusClass, statusLabel } from "~/utils/format"

const route = useRoute()
const api = useApi()
const toast = useAppToast()
const { connect } = useSocket()
const id = computed(() => Number(route.params.id))
const loading = ref(true)
const error = ref("")
const info = ref("")
const order = ref<Record<string, unknown> | null>(null)
const riders = ref<Record<string, unknown>[]>([])
const nextStatus = ref("")
const riderId = ref<number | "">("")
const busy = ref(false)
const paymentUrl = ref("")

async function load() {
  loading.value = true
  try {
    const [o, r] = await Promise.all([
      api.admin.order(id.value),
      api.admin.deliveryPersons().catch(() => []),
    ])
    order.value = o
    nextStatus.value = String(o?.status || "")
    riders.value = Array.isArray(r) ? (r as Record<string, unknown>[]) : []
    const assigned = Number(o?.delivery_person_id || 0)
    riderId.value = assigned || ""
  } catch (e) {
    error.value = apiError(e)
  } finally {
    loading.value = false
  }
}

async function saveStatus() {
  busy.value = true
  error.value = ""
  try {
    const body: { status: string; delivery_person_id?: number } = { status: nextStatus.value }
    if (riderId.value) body.delivery_person_id = Number(riderId.value)
    await api.admin.updateOrderStatus(id.value, body)
    info.value = "Status updated"
    await load()
  } catch (e) {
    error.value = apiError(e)
  } finally {
    busy.value = false
  }
}

async function assignRider() {
  if (!riderId.value) {
    error.value = "Pick a rider first"
    return
  }
  busy.value = true
  error.value = ""
  try {
    await api.admin.assignDelivery(id.value, Number(riderId.value))
    info.value = "Rider assigned"
    await load()
  } catch (e) {
    error.value = apiError(e)
  } finally {
    busy.value = false
  }
}

async function makeInvoice() {
  busy.value = true
  error.value = ""
  try {
    const res = await api.admin.createInvoice(id.value)
    info.value = String(res.message || res.invoice_number || "Invoice generated")
    await load()
  } catch (e) {
    error.value = apiError(e)
  } finally {
    busy.value = false
  }
}

async function makePaymentLink() {
  busy.value = true
  error.value = ""
  try {
    const res = await api.admin.paymentLink(id.value)
    const url = String(res.short_url || res.url || (res.razorpay as { short_url?: string } | undefined)?.short_url || "")
    paymentUrl.value = url || String(res.upi_link || "")
    info.value = paymentUrl.value || String(res.message || "Payment link created")
    if (url && import.meta.client) {
      window.open(url, "_blank", "noopener,noreferrer")
      toast.success("Razorpay link opened — status updates live when paid")
    }
  } catch (e) {
    error.value = apiError(e)
  } finally {
    busy.value = false
  }
}

let liveSocket: ReturnType<typeof connect> = null
const onAdminEvent = (data: Record<string, unknown>) => {
  if (String(data?.kind) === "order_paid" && Number(data.order_id) === id.value) {
    toast.success("Razorpay paid", String(data.order_number || ""))
    void load()
  }
}

function lineName(line: Record<string, unknown>) {
  return String(line.product_name || line.name || line.title || `#${line.product_id || ""}`)
}

function lineQty(line: Record<string, unknown>) {
  return Number(line.quantity ?? line.qty ?? 0)
}

function lineTotal(line: Record<string, unknown>) {
  return Number(line.total_price ?? line.total ?? line.line_total ?? 0)
}

const payload = computed(() => {
  const o = order.value
  if (!o) return null
  // API may nest under order / profile keys
  if (o.order && typeof o.order === "object") return o.order as Record<string, unknown>
  return o
})

const lines = computed(() => {
  const o = order.value
  if (!o) return [] as Record<string, unknown>[]
  const raw = o.items ?? o.lines ?? (payload.value as { items?: unknown })?.items
  return Array.isArray(raw) ? (raw as Record<string, unknown>[]) : []
})

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
    <PageHeader
      :title="payload ? String(payload.order_number || `Order #${id}`) : 'Order'"
      subtitle="Status, rider assign, invoice & payment"
    >
      <template #actions>
        <UButton to="/orders" color="neutral" variant="outline">Back</UButton>
      </template>
    </PageHeader>
    <p v-if="error" class="mb-3 text-sm text-danger">{{ error }}</p>
    <p v-if="info" class="mb-3 rounded-xl bg-blush/50 px-3 py-2 text-sm text-cocoa">{{ info }}</p>
    <div v-if="loading" class="sc-card h-48 animate-pulse" />
    <div v-else-if="payload" class="grid gap-4 lg:grid-cols-[1fr_1.1fr]">
      <div class="sc-card space-y-4 p-5">
        <div class="flex flex-wrap items-center gap-2">
          <span class="sc-badge" :class="statusClass(String(payload.status))">{{ statusLabel(String(payload.status)) }}</span>
          <span class="text-sm text-[var(--muted)] capitalize">{{ statusLabel(String(payload.order_type || "order")) }}</span>
        </div>
        <p class="font-display text-2xl">{{ money(Number(payload.final_amount ?? payload.total_amount)) }}</p>
        <dl class="grid gap-2 text-sm sm:grid-cols-2">
          <div><dt class="text-[var(--muted)]">Payment</dt><dd class="capitalize">{{ statusLabel(String(payload.payment_method || "—")) }}</dd></div>
          <div><dt class="text-[var(--muted)]">Pay status</dt><dd class="capitalize">{{ statusLabel(String(payload.payment_status || "—")) }}</dd></div>
        </dl>

        <label class="block">
          <span class="sc-label">Update status</span>
          <select v-model="nextStatus" class="sc-input">
            <option
              v-for="s in ['placed','accepted','preparing','packed','out_for_delivery','delivered','cancelled']"
              :key="s"
              :value="s"
            >
              {{ statusLabel(s) }}
            </option>
          </select>
        </label>
        <UButton type="button" :disabled="busy" @click="saveStatus">Save status</UButton>

        <div class="border-t border-[var(--line)] pt-4">
          <span class="sc-label">Assign rider</span>
          <select v-model="riderId" class="sc-input">
            <option value="">Select rider…</option>
            <option v-for="r in riders" :key="String(r.id)" :value="Number(r.id)">
              {{ r.name || r.phone }} {{ r.vehicle_number ? `· ${r.vehicle_number}` : "" }}
            </option>
          </select>
          <UButton type="button" color="primary" variant="soft" class=" mt-2" :disabled="busy || !riderId" @click="assignRider">
            Assign delivery
          </UButton>
        </div>

        <div class="flex flex-wrap gap-2 border-t border-[var(--line)] pt-4">
          <UButton type="button" color="neutral" variant="outline" :disabled="busy" @click="makeInvoice">Generate invoice</UButton>
          <UButton type="button" color="neutral" variant="outline" :disabled="busy" @click="makePaymentLink">Payment link</UButton>
        </div>
      </div>

      <div class="sc-card p-5">
        <h3 class="font-display m-0 text-lg">Line items</h3>
        <ul class="mt-3 divide-y divide-[var(--line)] text-sm">
          <li v-for="(line, i) in lines" :key="i" class="flex items-start justify-between gap-3 py-3">
            <div>
              <p class="font-semibold">{{ lineName(line) }}</p>
              <p class="text-xs text-[var(--muted)]">Qty {{ lineQty(line) }}</p>
            </div>
            <p class="tabular-nums font-medium">{{ money(lineTotal(line)) }}</p>
          </li>
          <li v-if="!lines.length" class="py-6 text-[var(--muted)]">No line items in response</li>
        </ul>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { displayPhone, formatDateTime12, isPlaceholderPhone, money, money2, statusLabel } from "~/utils/format"

const route = useRoute()
const api = useApi()
const toast = useAppToast()
const { connect, joinOrder } = useSocket()
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
const showOps = ref(true)

const TRACK_STEPS = [
  { key: "placed", label: "Received" },
  { key: "accepted", label: "Accepted" },
  { key: "preparing", label: "Processing" },
  { key: "packed", label: "Packed" },
  { key: "out_for_delivery", label: "On the way" },
  { key: "delivered", label: "Delivered" },
] as const

const STATUS_RANK: Record<string, number> = {
  placed: 0,
  payment_received: 0,
  accepted: 1,
  preparing: 2,
  packed: 3,
  delivery_offered: 3,
  delivery_assigned: 3,
  picked_up: 4,
  out_for_delivery: 4,
  near_location: 4,
  delivered: 5,
  cancelled: -1,
}

async function load() {
  loading.value = true
  try {
    const [o, r] = await Promise.all([
      api.admin.order(id.value),
      api.admin.deliveryPersons().catch(() => []),
    ])
    order.value = o
    const nested = o?.order && typeof o.order === "object" ? (o.order as Record<string, unknown>) : o
    nextStatus.value = String(nested?.status || o?.status || "")
    riders.value = Array.isArray(r) ? (r as Record<string, unknown>[]) : []
    const assigned = Number(nested?.delivery_person_id || o?.delivery_person_id || 0)
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

async function offerRider() {
  if (!riderId.value) {
    error.value = "Pick a rider first"
    return
  }
  busy.value = true
  error.value = ""
  try {
    await api.admin.offerDelivery(id.value, Number(riderId.value))
    info.value = "Offer sent — rider has 45s to accept"
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
    toast.success("Invoice", info.value)
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
    const nested = (res.razorpay_payment_link || res.payment_link || res.razorpay) as
      | { short_url?: string }
      | undefined
    const url = String(res.short_url || nested?.short_url || res.url || "")
    const status = String(res.status || "")
    if (status === "already_paid") {
      info.value = String(res.message || "Order already paid")
      toast.success("Already paid", info.value)
      return
    }
    paymentUrl.value = url || String(res.upi_link || "")
    info.value = String(res.message || (url ? "Payment link ready" : "UPI link ready"))
    if (url && import.meta.client) {
      window.open(url, "_blank", "noopener,noreferrer")
      toast.success(status === "existing" ? "Opened existing link" : "Payment link opened")
    } else if (paymentUrl.value) {
      toast.success("UPI link ready")
    }
  } catch (e) {
    error.value = apiError(e)
  } finally {
    busy.value = false
  }
}

function printSlip() {
  if (import.meta.client) window.print()
}

let liveSocket: ReturnType<typeof connect> = null
const onAdminEvent = (data: Record<string, unknown>) => {
  if (String(data?.kind) === "order_paid" && Number(data.order_id) === id.value) {
    toast.success("Payment received", String(data.order_number || ""))
    void load()
  }
}
const onOrderStatus = (data: Record<string, unknown>) => {
  if (Number(data.order_id) === id.value) void load()
}

function lineName(line: Record<string, unknown>) {
  return String(line.product_name || line.name || line.title || `#${line.product_id || ""}`)
}
function lineQty(line: Record<string, unknown>) {
  return Number(line.quantity ?? line.qty ?? 0)
}
function lineUnit(line: Record<string, unknown>) {
  return Number(line.unit_price ?? line.price ?? 0)
}
function lineTotal(line: Record<string, unknown>) {
  return Number(line.total_price ?? line.total ?? line.line_total ?? 0)
}
function lineImage(line: Record<string, unknown>) {
  return String(line.product_image || line.image_url || line.image || "")
}

const payload = computed(() => {
  const o = order.value
  if (!o) return null
  if (o.order && typeof o.order === "object") return o.order as Record<string, unknown>
  return o
})

const lines = computed(() => {
  const o = order.value
  if (!o) return [] as Record<string, unknown>[]
  const raw = o.items ?? o.lines ?? (payload.value as { items?: unknown })?.items
  return Array.isArray(raw) ? (raw as Record<string, unknown>[]) : []
})

const address = computed(() => (payload.value?.address_snapshot || {}) as Record<string, unknown>)

function addrLines(snap: Record<string, unknown>) {
  return [
    snap.line1 || snap.address_line1 || snap.street,
    snap.area || snap.locality,
    [snap.city, snap.pincode || snap.pin].filter(Boolean).join(" "),
  ]
    .map((x) => (x != null ? String(x).trim() : ""))
    .filter(Boolean)
}

const customerName = computed(() => {
  const a = address.value
  const name = String(a.name || a.customer_name || a.receiver_name || payload.value?.customer_name || "").trim()
  if (!name || /^customer$/i.test(name) || /^guest$/i.test(name)) return "Walk-in / Guest"
  return name
})
const customerPhone = computed(() => {
  const a = address.value
  const p = payload.value
  const candidates = [
    a.phone,
    a.mobile,
    a.contact_phone,
    p?.checkout_phone,
    p?.delivery_phone,
    p?.customer_phone,
  ]
  for (const c of candidates) {
    const s = String(c || "").trim()
    if (s && !isPlaceholderPhone(s)) return displayPhone(s)
  }
  return "—"
})
const customerEmail = computed(() => String(address.value.email || payload.value?.customer_email || "").trim() || "—")
const shippingLines = computed(() => addrLines(address.value))

function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/** Canonical bill lines from order fields (matches checkout: taxable + gst + delivery). */
const bill = computed(() => {
  const p = payload.value
  if (!p) {
    return {
      subtotal: 0,
      discount: 0,
      taxable: 0,
      delivery: 0,
      gst: 0,
      cgst: 0,
      sgst: 0,
      total: 0,
    }
  }
  const subtotal = round2(Number(p.subtotal) || 0)
  const discount = round2(Number(p.discount) || 0)
  const delivery = round2(Number(p.delivery_fee) || 0)
  const taxable = round2(Math.max(subtotal - discount, 0))
  let gst = round2(Number(p.gst_amount) || 0)
  let total = round2(Number(p.final_amount) || 0)
  // If gst missing but total implies it, back-fill for display
  if (!gst && total > 0) {
    const implied = round2(total - taxable - delivery)
    if (implied > 0) gst = implied
  }
  // Prefer stored total; if clearly broken (0) rebuild from parts
  const parts = round2(taxable + gst + delivery)
  if (!total && parts) total = parts
  const cgst = round2(gst / 2)
  const sgst = round2(gst - cgst)
  return { subtotal, discount, taxable, delivery, gst, cgst, sgst, total }
})

const assignedRider = computed(() => {
  const rid = Number(payload.value?.delivery_person_id || 0)
  if (!rid) return null
  return riders.value.find((r) => Number(r.id) === rid) || null
})

const trackIndex = computed(() => {
  const st = String(payload.value?.status || "").toLowerCase()
  if (st === "cancelled") return -1
  const rank = STATUS_RANK[st]
  return rank == null ? 0 : rank
})

const placedAt = computed(() => {
  const raw = payload.value?.created_at
  if (!raw) return "—"
  return formatDateTime12(String(raw))
})

const invoiceNo = computed(() => {
  const n = String(payload.value?.order_number || id.value)
  return `INV-${n}`
})

const payLabel = computed(() => {
  const m = String(payload.value?.payment_method || "").toLowerCase()
  const s = String(payload.value?.payment_status || "").toLowerCase()
  const method =
    m === "razorpay" || m === "online"
      ? "Online"
      : m === "cod" || m === "cash"
        ? "COD"
        : m === "upi"
          ? "UPI"
          : statusLabel(m || "—")
  const status =
    ["paid", "payment_received", "captured", "success"].includes(s)
      ? "Paid"
      : ["pending", "created", "authorized"].includes(s)
        ? "Unpaid"
        : ["failed", "refunded"].includes(s)
          ? statusLabel(s)
          : statusLabel(s || "—")
  return `${method} · ${status}`
})

onMounted(() => {
  void load()
  liveSocket = connect()
  liveSocket?.on("admin_event", onAdminEvent)
  liveSocket?.on("order_status", onOrderStatus)
  joinOrder(id.value)
})
onBeforeUnmount(() => {
  liveSocket?.off("admin_event", onAdminEvent)
  liveSocket?.off("order_status", onOrderStatus)
})
</script>

<template>
  <div>
    <div class="no-print mb-4 flex flex-wrap items-center justify-between gap-3">
      <UButton to="/orders" color="neutral" variant="outline" icon="i-lucide-arrow-left" label="Back" />
      <div class="flex flex-wrap gap-2">
        <UButton
          color="neutral"
          variant="outline"
          icon="i-lucide-bike"
          :label="showOps ? 'Hide status & rider' : 'Status & rider'"
          @click="showOps = !showOps"
        />
        <UButton color="neutral" variant="outline" icon="i-lucide-printer" label="Print slip" @click="printSlip" />
        <UButton color="secondary" :loading="busy" label="Generate invoice" @click="makeInvoice" />
      </div>
    </div>

    <p v-if="error" class="no-print mb-3 text-sm text-danger">{{ error }}</p>
    <p v-if="info" class="no-print mb-3 rounded-xl bg-[#ffe8ec] px-3 py-2 text-sm text-chocolate">{{ info }}</p>

    <div v-if="loading" class="no-print space-y-3">
      <div class="sc-skeleton h-40" />
      <div class="sc-skeleton h-64" />
    </div>

    <template v-else-if="payload">
      <!-- Screen invoice (not printed) -->
      <article class="no-print invoice-sheet overflow-hidden">
        <header class="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--line)] bg-[#fff9f5] px-5 py-5 sm:px-8">
          <div class="flex items-center gap-3">
            <BrandLogo size="lg" />
            <div class="hidden border-l border-[var(--line)] pl-3 sm:block">
              <p class="m-0 text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-[#e9748e]">Tax invoice</p>
              <p class="m-0 mt-0.5 text-xs text-[var(--muted)]">Village supply & delivery</p>
            </div>
          </div>
          <div class="text-right">
            <p class="font-display m-0 text-2xl text-chocolate">{{ invoiceNo }}</p>
            <p class="mt-1 text-xs text-[var(--muted)]">Order {{ payload.order_number || id }} · {{ placedAt }}</p>
            <div class="mt-2 flex justify-end gap-1.5">
              <StatusBadge :status="String(payload.status || '—')" />
              <StatusBadge :status="String(payload.payment_status || '—')" />
            </div>
          </div>
        </header>

        <section class="border-b border-[var(--line)] px-5 py-4 sm:px-8">
          <h2 class="m-0 mb-3 text-sm font-semibold uppercase tracking-[0.1em] text-[var(--muted)]">Track order</h2>
          <div v-if="trackIndex < 0" class="rounded-xl bg-red-50 px-4 py-3 text-sm text-danger">
            Cancelled{{ payload.cancel_reason ? ` — ${payload.cancel_reason}` : "" }}
          </div>
          <div v-else class="relative pt-1">
            <div class="pointer-events-none absolute left-[8%] right-[8%] top-[1.85rem] h-1 overflow-hidden rounded-full bg-[#f0ddd4]">
              <div
                class="h-full rounded-full bg-[#e9748e] transition-all duration-500"
                :style="{ width: `${(trackIndex / Math.max(TRACK_STEPS.length - 1, 1)) * 100}%` }"
              />
            </div>
            <ol class="relative z-[1] m-0 flex list-none justify-between p-0">
              <li
                v-for="(step, i) in TRACK_STEPS"
                :key="step.key"
                class="flex min-w-0 flex-1 flex-col items-center text-center"
              >
                <span
                  class="mb-2 grid size-7 place-items-center rounded-full text-[0.65rem] font-bold ring-[3px] ring-white sm:size-8"
                  :class="i <= trackIndex ? 'bg-[#e9748e] text-white' : 'bg-white text-[#c4a39a] ring-1 ring-[#e8d0c6]'"
                >
                  <span v-if="i < trackIndex">✓</span>
                  <span v-else>{{ i + 1 }}</span>
                </span>
                <span
                  class="max-w-[4.5rem] text-[0.62rem] font-semibold leading-tight sm:max-w-none sm:text-xs"
                  :class="i <= trackIndex ? 'text-chocolate' : 'text-[var(--muted)]'"
                >
                  {{ step.label }}
                </span>
              </li>
            </ol>
          </div>
        </section>

        <section class="grid gap-0 border-b border-[var(--line)] sm:grid-cols-2 xl:grid-cols-4">
          <div class="border-b border-[var(--line)] p-5 sm:border-r xl:border-b-0">
            <p class="text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-[#e9748e]">Billing</p>
            <p class="mt-2 font-semibold text-chocolate">{{ customerName }}</p>
            <p class="mt-1 text-sm leading-relaxed text-[var(--muted)]">{{ shippingLines.join(", ") || "—" }}</p>
            <p class="mt-3 text-xs text-[var(--muted)]">Phone · <span class="text-chocolate">{{ customerPhone }}</span></p>
            <p v-if="customerEmail !== '—'" class="text-xs text-[var(--muted)]">Email · <span class="text-chocolate">{{ customerEmail }}</span></p>
          </div>
          <div class="border-b border-[var(--line)] p-5 xl:border-b-0 xl:border-r">
            <p class="text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-[#e9748e]">Shipping</p>
            <p class="mt-2 font-semibold text-chocolate">{{ customerName }}</p>
            <p class="mt-1 text-sm leading-relaxed text-[var(--muted)]">{{ shippingLines.join(", ") || "—" }}</p>
            <p class="mt-3 text-xs text-[var(--muted)]">
              Slot · <span class="text-chocolate">{{ payload.delivery_slot || payload.delivery_date || "ASAP" }}</span>
            </p>
          </div>
          <div class="border-b border-[var(--line)] p-5 sm:border-r xl:border-b-0">
            <p class="text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-[#e9748e]">Payment</p>
            <dl class="mt-3 space-y-2 text-sm">
              <div class="flex justify-between"><dt class="text-[var(--muted)]">Items</dt><dd class="tabular-nums">{{ money2(bill.subtotal) }}</dd></div>
              <div v-if="bill.discount" class="flex justify-between">
                <dt class="text-[var(--muted)]">Discount</dt>
                <dd class="tabular-nums">−{{ money2(bill.discount) }}</dd>
              </div>
              <div class="flex justify-between"><dt class="text-[var(--muted)]">Taxable</dt><dd class="tabular-nums">{{ money2(bill.taxable) }}</dd></div>
              <div class="flex justify-between"><dt class="text-[var(--muted)]">CGST 2.5%</dt><dd class="tabular-nums">{{ money2(bill.cgst) }}</dd></div>
              <div class="flex justify-between"><dt class="text-[var(--muted)]">SGST 2.5%</dt><dd class="tabular-nums">{{ money2(bill.sgst) }}</dd></div>
              <div class="flex justify-between">
                <dt class="text-[var(--muted)]">Delivery</dt>
                <dd class="tabular-nums">{{ bill.delivery ? money2(bill.delivery) : "Free" }}</dd>
              </div>
              <div class="flex justify-between border-t border-[var(--line)] pt-2 font-semibold text-chocolate">
                <dt>Total</dt>
                <dd class="font-display text-lg tabular-nums">{{ money2(bill.total) }}</dd>
              </div>
              <p class="m-0 text-[0.7rem] text-[var(--muted)]">{{ payLabel }}</p>
            </dl>
          </div>
          <div class="p-5">
            <p class="text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-[#e9748e]">Logistics</p>
            <p class="mt-2 font-semibold text-chocolate">
              {{ assignedRider ? String(assignedRider.name || assignedRider.phone || "Rider") : "Unassigned" }}
            </p>
            <p class="mt-1 text-xs text-[var(--muted)]">{{ payLabel }}</p>
            <p v-if="assignedRider?.vehicle_number" class="mt-2 text-xs text-[var(--muted)]">
              Vehicle · <span class="text-chocolate">{{ assignedRider.vehicle_number }}</span>
            </p>
          </div>
        </section>

        <section class="grid xl:grid-cols-[1.35fr_0.85fr]">
          <div class="border-b border-[var(--line)] xl:border-b-0 xl:border-r">
            <div class="border-b border-[var(--line)] px-5 py-3 sm:px-8">
              <h2 class="m-0 text-sm font-semibold uppercase tracking-[0.1em] text-[var(--muted)]">Products</h2>
            </div>
            <table class="w-full text-sm">
              <thead>
                <tr class="bg-[#fff9f5] text-left text-[0.68rem] uppercase tracking-wider text-[var(--muted)]">
                  <th class="px-5 py-3 sm:px-8">Product</th>
                  <th class="px-3 py-3 text-right">Price</th>
                  <th class="px-3 py-3 text-right">Qty</th>
                  <th class="px-5 py-3 text-right sm:px-8">Amount</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(line, i) in lines" :key="i" class="border-t border-[var(--line)]">
                  <td class="px-5 py-3.5 sm:px-8">
                    <div class="flex items-center gap-3">
                      <div
                        v-if="lineImage(line)"
                        class="size-11 shrink-0 overflow-hidden rounded-xl bg-[#f8ede6] ring-1 ring-[var(--line)]"
                      >
                        <img :src="lineImage(line)" :alt="lineName(line)" class="size-full object-cover">
                      </div>
                      <div class="min-w-0">
                        <p class="truncate font-semibold text-chocolate">{{ lineName(line) }}</p>
                        <p v-if="line.variant" class="text-xs text-[var(--muted)]">{{ line.variant }}</p>
                      </div>
                    </div>
                  </td>
                  <td class="px-3 py-3.5 text-right tabular-nums">{{ money(lineUnit(line)) }}</td>
                  <td class="px-3 py-3.5 text-right tabular-nums">{{ lineQty(line) }}×</td>
                  <td class="px-5 py-3.5 text-right font-semibold tabular-nums sm:px-8">{{ money(lineTotal(line)) }}</td>
                </tr>
                <tr v-if="!lines.length">
                  <td colspan="4" class="px-8 py-10 text-center text-[var(--muted)]">No line items</td>
                </tr>
              </tbody>
            </table>
          </div>

          <aside>
            <div class="border-b border-[var(--line)] px-5 py-4">
              <h2 class="m-0 text-sm font-semibold text-chocolate">Order summary</h2>
              <p class="m-0 mt-0.5 text-xs text-[var(--muted)]">{{ payload.order_number || id }}</p>
            </div>
            <ul class="m-0 list-none divide-y divide-[var(--line)] p-0">
              <li v-for="(line, i) in lines" :key="`s-${i}`" class="flex items-center gap-3 px-5 py-3">
                <p class="min-w-0 flex-1 truncate text-sm font-medium text-chocolate">
                  {{ lineQty(line) }}× {{ lineName(line) }}
                </p>
                <p class="shrink-0 text-sm font-semibold tabular-nums">{{ money(lineTotal(line)) }}</p>
              </li>
            </ul>
            <div class="space-y-2 border-t border-[var(--line)] px-5 py-5 text-sm">
              <div class="flex justify-between"><span class="text-[var(--muted)]">Items</span><span class="tabular-nums">{{ money2(bill.subtotal) }}</span></div>
              <div v-if="bill.discount" class="flex justify-between">
                <span class="text-[var(--muted)]">Discount</span>
                <span class="tabular-nums">−{{ money2(bill.discount) }}</span>
              </div>
              <div class="flex justify-between"><span class="text-[var(--muted)]">Taxable</span><span class="tabular-nums">{{ money2(bill.taxable) }}</span></div>
              <div class="flex justify-between"><span class="text-[var(--muted)]">CGST 2.5%</span><span class="tabular-nums">{{ money2(bill.cgst) }}</span></div>
              <div class="flex justify-between"><span class="text-[var(--muted)]">SGST 2.5%</span><span class="tabular-nums">{{ money2(bill.sgst) }}</span></div>
              <div class="flex justify-between">
                <span class="text-[var(--muted)]">Delivery</span>
                <span class="tabular-nums">{{ bill.delivery ? money2(bill.delivery) : "Free" }}</span>
              </div>
              <div class="mt-2 flex items-end justify-between rounded-2xl bg-chocolate px-4 py-3 text-cream">
                <span class="text-sm font-semibold">Total</span>
                <span class="font-display text-2xl tabular-nums">{{ money2(bill.total) }}</span>
              </div>
              <div class="flex flex-wrap gap-2 pt-2">
                <UButton color="secondary" size="sm" :loading="busy" label="Save invoice" @click="makeInvoice" />
                <UButton
                  color="neutral"
                  variant="outline"
                  size="sm"
                  :loading="busy"
                  :disabled="String(payload.payment_status || '').toLowerCase() === 'paid'"
                  :label="String(payload.payment_status || '').toLowerCase() === 'paid' ? 'Already paid' : 'Payment link'"
                  @click="makePaymentLink"
                />
              </div>
            </div>
          </aside>
        </section>

        <footer class="border-t border-[var(--line)] px-5 py-3 text-center text-xs text-[var(--muted)] sm:px-8">
          Thank you for your order · Made with love
        </footer>
      </article>

      <!-- Thermal / Bluetooth slip — preview on screen; only this prints -->
      <section class="thermal-wrap no-print-hide mt-4">
        <div class="no-print mb-2 flex items-center justify-between gap-2">
          <p class="m-0 text-sm font-semibold text-chocolate">Print slip · 80mm</p>
          <UButton size="xs" color="neutral" variant="outline" icon="i-lucide-printer" label="Print" @click="printSlip" />
        </div>
        <div id="thermal-receipt" class="thermal-receipt">
          <div class="thermal-inner">
            <img src="/brand/sweetcrust-logo.png" alt="" class="thermal-logo">
            <p class="thermal-shop">SWEETCRUST BAKERY</p>
            <p class="thermal-muted">Made with love · Berhampur</p>
            <p class="thermal-title">TAX INVOICE</p>
            <p class="thermal-strong">{{ invoiceNo }}</p>
            <p class="thermal-muted">{{ payload.order_number || id }} · {{ placedAt }}</p>
            <div class="thermal-rule" />
            <p class="thermal-section">BILL TO</p>
            <p class="thermal-strong thermal-left">{{ customerName }}</p>
            <p v-if="customerPhone !== '—'" class="thermal-left">Ph {{ customerPhone }}</p>
            <p v-for="(line, i) in shippingLines" :key="`a-${i}`" class="thermal-left">{{ line }}</p>
            <p v-if="payload.delivery_slot || payload.delivery_date" class="thermal-left">
              Slot {{ payload.delivery_slot || payload.delivery_date }}
            </p>
            <div class="thermal-rule" />
            <div class="thermal-cols thermal-head">
              <span>Item</span>
              <span class="t-qty">Qty</span>
              <span class="t-amt">Amt</span>
            </div>
            <div v-for="(line, i) in lines" :key="`t-${i}`" class="thermal-item">
              <div class="thermal-cols">
                <span>
                  {{ lineName(line) }}
                  <span class="thermal-muted"> @{{ money2(lineUnit(line)) }}</span>
                </span>
                <span class="t-qty">{{ lineQty(line) }}</span>
                <span class="t-amt">{{ money2(lineTotal(line)) }}</span>
              </div>
            </div>
            <div v-if="!lines.length" class="thermal-cols"><span>No items</span><span /><span /></div>
            <div class="thermal-rule" />
            <div class="thermal-row"><span>Items</span><span>{{ money2(bill.subtotal) }}</span></div>
            <div v-if="bill.discount" class="thermal-row">
              <span>Discount</span><span>-{{ money2(bill.discount) }}</span>
            </div>
            <div class="thermal-row"><span>Taxable</span><span>{{ money2(bill.taxable) }}</span></div>
            <div class="thermal-row"><span>CGST 2.5%</span><span>{{ money2(bill.cgst) }}</span></div>
            <div class="thermal-row"><span>SGST 2.5%</span><span>{{ money2(bill.sgst) }}</span></div>
            <div class="thermal-row">
              <span>Delivery</span>
              <span>{{ bill.delivery ? money2(bill.delivery) : "Free" }}</span>
            </div>
            <div class="thermal-rule thermal-rule-double" />
            <div class="thermal-row thermal-total">
              <span>TOTAL</span>
              <span>{{ money2(bill.total) }}</span>
            </div>
            <p class="thermal-pay">{{ payLabel }}</p>
            <p v-if="assignedRider" class="thermal-muted">
              Rider {{ assignedRider.name || assignedRider.phone }}
            </p>
            <div class="thermal-rule" />
            <p class="thermal-thanks">Thank you · Visit again</p>
          </div>
        </div>
      </section>

      <section class="no-print mt-4">
        <ClientOnly>
          <OrdersOrderLiveTrack :order-id="id" :order="payload" />
        </ClientOnly>
      </section>

      <section v-if="showOps" class="no-print sc-card-smoke mt-4 grid gap-4 p-5 lg:grid-cols-2">
        <div>
          <p class="sc-label">Update status</p>
          <select v-model="nextStatus" class="sc-input">
            <option
              v-for="s in ['placed','accepted','preparing','packed','out_for_delivery','delivered','cancelled']"
              :key="s"
              :value="s"
            >
              {{ statusLabel(s) }}
            </option>
          </select>
          <UButton class="mt-2" type="button" color="secondary" :disabled="busy" @click="saveStatus">Save status</UButton>
        </div>
        <div>
          <p class="sc-label">Assign rider</p>
          <select v-model="riderId" class="sc-input">
            <option value="">Select rider…</option>
            <option v-for="r in riders" :key="String(r.id)" :value="Number(r.id)">
              {{ r.name || r.phone }} {{ r.vehicle_number ? `· ${r.vehicle_number}` : "" }}
            </option>
          </select>
          <div class="mt-2 flex flex-wrap gap-2">
            <UButton type="button" color="secondary" :disabled="busy || !riderId" @click="assignRider">Assign (force)</UButton>
            <UButton type="button" color="neutral" variant="outline" :disabled="busy || !riderId" @click="offerRider">Offer (45s)</UButton>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.invoice-sheet {
  border-radius: 1.25rem;
  border: 1px solid var(--line);
  background: #fff;
  box-shadow: 0 18px 40px -28px rgba(74, 44, 42, 0.35);
}

.thermal-wrap {
  max-width: 320px;
}

.thermal-receipt {
  border-radius: 0.75rem;
  border: 1px dashed #c4a39a;
  background: #fff;
  padding: 14px 12px 16px;
  box-shadow: 0 10px 28px -22px rgba(74, 44, 42, 0.35);
}
</style>

<style>
/* Shared thermal layout (screen preview + print) */
#thermal-receipt .thermal-inner {
  width: 100%;
  max-width: 72mm;
  margin: 0 auto;
  font-family: "Courier New", Courier, monospace;
  font-size: 12px;
  line-height: 1.4;
  color: #111;
}

#thermal-receipt .thermal-logo {
  display: block;
  width: 42mm;
  max-width: 70%;
  height: auto;
  margin: 0 auto 6px;
  filter: grayscale(1) contrast(1.15);
}

#thermal-receipt .thermal-shop {
  margin: 0;
  text-align: center;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.06em;
}

#thermal-receipt .thermal-title {
  margin: 8px 0 2px;
  text-align: center;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.14em;
}

#thermal-receipt .thermal-strong {
  margin: 2px 0;
  font-weight: 700;
  text-align: center;
}

#thermal-receipt .thermal-left {
  text-align: left !important;
}

#thermal-receipt .thermal-section {
  margin: 0 0 2px;
  text-align: left;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
}

#thermal-receipt .thermal-muted {
  margin: 1px 0;
  text-align: center;
  font-size: 10px;
  color: #444;
}

#thermal-receipt .thermal-inner > p {
  margin: 1px 0;
  text-align: center;
}

#thermal-receipt .thermal-rule {
  border-top: 1px dashed #222;
  margin: 8px 0;
}

#thermal-receipt .thermal-rule-double {
  border-top-style: solid;
  border-top-width: 2px;
  margin-top: 6px;
  margin-bottom: 6px;
  box-shadow: 0 -3px 0 0 #fff, 0 -4px 0 0 #222;
}

#thermal-receipt .thermal-row,
#thermal-receipt .thermal-cols {
  display: flex;
  justify-content: space-between;
  gap: 6px;
  text-align: left;
}

#thermal-receipt .thermal-cols > span:first-child {
  flex: 1;
  min-width: 0;
}

#thermal-receipt .t-qty {
  width: 2.2em;
  text-align: right;
  flex-shrink: 0;
}

#thermal-receipt .t-amt {
  width: 5.2em;
  text-align: right;
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}

#thermal-receipt .thermal-head {
  font-weight: 700;
  margin-bottom: 4px;
  font-size: 11px;
}

#thermal-receipt .thermal-item {
  margin-bottom: 4px;
}

#thermal-receipt .thermal-total {
  font-size: 14px;
  font-weight: 700;
}

#thermal-receipt .thermal-pay,
#thermal-receipt .thermal-thanks {
  margin: 6px 0 0;
  text-align: center;
  font-weight: 600;
}

@media print {
  @page {
    size: 80mm auto;
    margin: 2mm;
  }

  html,
  body {
    background: #fff !important;
    margin: 0 !important;
    padding: 0 !important;
  }

  body * {
    visibility: hidden !important;
  }

  #thermal-receipt,
  #thermal-receipt * {
    visibility: visible !important;
  }

  .no-print,
  .no-print-hide .no-print {
    display: none !important;
  }

  #thermal-receipt {
    position: absolute !important;
    left: 0 !important;
    top: 0 !important;
    width: 72mm !important;
    border: none !important;
    border-radius: 0 !important;
    box-shadow: none !important;
    padding: 0 !important;
    background: #fff !important;
    color: #000 !important;
  }

  #thermal-receipt .thermal-inner {
    width: 72mm;
    color: #000;
  }

  #thermal-receipt .thermal-muted {
    color: #000;
  }

  #thermal-receipt .thermal-logo {
    width: 32mm;
    filter: grayscale(1) contrast(1.35);
  }
}
</style>

<script setup lang="ts">
import { money } from "~/utils/format"
import { patchListRow, upsertListRow } from "~/utils/list"

const api = useApi()
const route = useRoute()
const router = useRouter()
const toast = useAppToast()
const { openCheckout } = useRazorpayCheckout()
const { connect } = useSocket()
const shops = ref<Record<string, unknown>[]>([])
const products = ref<Record<string, unknown>[]>([])
const rows = ref<Record<string, unknown>[]>([])
const error = ref("")
const info = ref("")
const busy = ref(false)
const payRow = ref<Record<string, unknown> | null>(null)
const payForm = reactive({ amount: 0, pay_method: "razorpay", note: "" })
const statusFilter = ref<"all" | "pending" | "received" | "partial" | "paid" | "rejected">("all")
const form = reactive({
  supplier_user_id: 0,
  product_id: 0,
  qty: 10,
  unit_cost: 0,
  note: "",
  mark_paid: false,
  instant_receive: false,
  pay_method: "upi",
})

const wholesalers = computed(() =>
  shops.value.filter((s) => s.is_wholesaler !== false && String(s.approval_status || "approved") === "approved"),
)

const payableTotal = computed(() =>
  shops.value.reduce((n, s) => n + (Number(s.payable_balance) || 0), 0),
)

const supplierFilterId = computed(() => {
  const raw = route.query.supplier_user_id
  const n = Number(Array.isArray(raw) ? raw[0] : raw)
  return Number.isFinite(n) && n > 0 ? n : null
})

const previewTotal = computed(() => Math.round(form.qty * form.unit_cost * 100) / 100)

const filteredRows = computed(() => {
  let list = rows.value
  if (supplierFilterId.value) {
    list = list.filter((r) => Number(r.supplier_user_id) === supplierFilterId.value)
  }
  if (statusFilter.value !== "all") {
    list = list.filter((r) => String(r.status) === statusFilter.value)
  }
  return list
})

const filterShopName = computed(() => {
  if (!supplierFilterId.value) return ""
  const s = shops.value.find((x) => Number(x.user_id) === supplierFilterId.value)
  return s ? String(s.shop_name || "") : `Shop #${supplierFilterId.value}`
})

function canPay(r: Record<string, unknown>) {
  const st = String(r.status || "")
  return Number(r.due) > 0 && (st === "received" || st === "partial")
}

function statusClass(status: unknown) {
  const s = String(status || "")
  if (s === "pending") return "bg-honey/25 text-chocolate"
  if (s === "rejected") return "bg-rose-100 text-rose-800"
  if (s === "paid") return "bg-emerald-100 text-emerald-800"
  if (s === "partial") return "bg-amber-100 text-amber-900"
  return "bg-cream text-cocoa"
}

async function load() {
  error.value = ""
  try {
    const [s, p, buys] = await Promise.all([
      api.admin.shops(),
      api.admin.products(undefined, 1),
      api.admin.purchases(supplierFilterId.value || undefined),
    ])
    shops.value = Array.isArray(s) ? (s as Record<string, unknown>[]) : []
    const plist = Array.isArray(p) ? p : (p as { items?: unknown[] })?.items || (p as { results?: unknown[] })?.results || []
    products.value = Array.isArray(plist) ? (plist as Record<string, unknown>[]) : []
    rows.value = Array.isArray(buys) ? (buys as Record<string, unknown>[]) : []
    if (supplierFilterId.value) {
      form.supplier_user_id = supplierFilterId.value
    } else if (!form.supplier_user_id && wholesalers.value[0]) {
      form.supplier_user_id = Number(wholesalers.value[0].user_id)
    }
    if (!form.product_id && products.value[0]) {
      const first = products.value[0]
      form.product_id = Number(first.id)
      form.unit_cost = Number(first.purchase_cost || first.shop_price || first.selling_price || 0)
    }
  } catch (e) {
    error.value = apiError(e)
  }
}

function onProduct() {
  const p = products.value.find((x) => Number(x.id) === Number(form.product_id))
  if (!p) return
  form.unit_cost = Number(p.purchase_cost || p.shop_price || p.selling_price || 0)
  if (p.supplier_user_id) form.supplier_user_id = Number(p.supplier_user_id)
}

function clearSupplierFilter() {
  const next = { ...route.query }
  delete next.supplier_user_id
  void router.replace({ query: next })
}

async function buy() {
  if (!form.supplier_user_id || !form.product_id || form.qty <= 0) {
    error.value = "Pick shop, product, qty"
    return
  }
  busy.value = true
  error.value = ""
  info.value = ""
  try {
    const created = (await api.admin.createPurchase({ ...form })) as Record<string, unknown>
    upsertListRow(rows, created)
    if (form.mark_paid) {
      info.value = "Stock received and shop paid"
    } else if (form.instant_receive) {
      info.value = "Stock received — payable added (pay when ready)"
    } else {
      info.value = "PO sent — waiting for supplier to accept in the retailer app"
    }
    void load()
  } catch (e) {
    error.value = apiError(e)
  } finally {
    busy.value = false
  }
}

function openPay(r: Record<string, unknown>) {
  const due = Number(r.due) || 0
  const total = Number(r.total) || 0
  const already = Number(r.paid_amount) || 0
  const minFirst = Math.round(total * 0.8 * 100) / 100
  payRow.value = r
  payForm.amount = already <= 0.001 ? Math.min(due, minFirst) : due
  payForm.pay_method = "razorpay"
  payForm.note = ""
  error.value = ""
}

async function confirmPay() {
  if (!payRow.value) return
  const id = Number(payRow.value.id)
  busy.value = true
  error.value = ""
  try {
    if (payForm.pay_method === "razorpay") {
      const created = await api.admin.createPurchaseRazorpay(id, { amount: payForm.amount })
      const keyId = String(created.key_id || "")
      const orderId = String(created.razorpay_order_id || "")
      const amountPaise = Number(created.amount_paise ?? Math.round(Number(created.amount || payForm.amount) * 100))
      if (!keyId || !orderId) throw new Error("Razorpay create failed — check integrations")
      const rz = await openCheckout({
        key_id: keyId,
        razorpay_order_id: orderId,
        amount_paise: amountPaise,
        name: "SweetCrust",
        description: String(created.bill_no || `PO #${id}`),
      })
      const saved = await api.admin.verifyPurchaseRazorpay(id, {
        razorpay_order_id: rz.razorpay_order_id,
        razorpay_payment_id: rz.razorpay_payment_id,
        razorpay_signature: rz.razorpay_signature,
        amount: payForm.amount,
      })
      if (!upsertListRow(rows, saved)) patchListRow(rows, id, saved)
      info.value = Number(saved.due) > 0
        ? `Razorpay partial pay — due ${money(Number(saved.due))}`
        : "Razorpay paid — supplier payable updated"
      toast.success("Razorpay payment verified")
      payRow.value = null
      void load()
      return
    }

    const saved = await api.admin.payPurchase(id, {
      amount: payForm.amount,
      pay_method: payForm.pay_method,
      note: payForm.note || undefined,
    })
    if (!upsertListRow(rows, saved)) patchListRow(rows, id, { is_paid: true, status: "paid" })
    info.value = Number((saved as Record<string, unknown>).due) > 0
      ? `Partial payment recorded — due ${money(Number((saved as Record<string, unknown>).due))}`
      : "Fully paid to wholesaler"
    payRow.value = null
    void load()
  } catch (e) {
    const msg = apiError(e)
    if (msg && !/cancelled/i.test(msg)) error.value = msg
    if (/cancelled/i.test(String(e))) toast.info("Payment cancelled")
  } finally {
    busy.value = false
  }
}

watch(supplierFilterId, () => {
  void load()
})

let liveSocket: ReturnType<typeof connect> = null
const onAdminEvent = (data: Record<string, unknown>) => {
  const kind = String(data?.kind || "")
  if (kind === "po_paid" || kind === "po_received") void load()
}

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
      title="Buy from shops"
      subtitle="Create a PO — supplier accepts in the app, then stock rises. Instant receive skips the wait."
    >
      <template #actions>
        <span class="text-sm text-[var(--muted)]">
          Payable (we owe them): <strong class="text-chocolate">{{ money(payableTotal) }}</strong>
        </span>
      </template>
    </PageHeader>

    <p v-if="error" class="mb-3 text-sm text-danger">{{ error }}</p>
    <p v-if="info" class="mb-3 rounded-xl bg-blush/50 px-3 py-2 text-sm text-cocoa">{{ info }}</p>

    <div
      v-if="supplierFilterId"
      class="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm"
    >
      <span>Filtered supplier: <strong class="text-chocolate">{{ filterShopName }}</strong></span>
      <UButton type="button" size="xs" color="neutral" variant="outline" label="Clear filter" @click="clearSupplierFilter" />
    </div>

    <div class="mb-4 grid gap-4 lg:grid-cols-2">
      <form class="sc-card grid gap-3 p-4" @submit.prevent="buy">
        <h3 class="font-display m-0 text-lg">New purchase</h3>
        <ol class="m-0 list-decimal space-y-1 pl-5 text-xs text-[var(--muted)]">
          <li>Select supplier</li>
          <li>Select product + qty / cost</li>
          <li>Preview total → Place PO</li>
        </ol>
        <label class="text-sm">
          Wholesaler shop
          <select v-model.number="form.supplier_user_id" class="sc-input mt-1 w-full" required>
            <option v-for="s in wholesalers" :key="String(s.user_id)" :value="Number(s.user_id)">
              {{ s.shop_name }} · owe {{ money(Number(s.payable_balance || 0)) }}
            </option>
          </select>
        </label>
        <label class="text-sm">
          Product (into your catalog stock)
          <select v-model.number="form.product_id" class="sc-input mt-1 w-full" required @change="onProduct">
            <option v-for="p in products" :key="String(p.id)" :value="Number(p.id)">
              {{ p.brand_name ? `[${p.brand_name}] ` : "" }}{{ p.name }} · cost {{ money(Number(p.purchase_cost || 0)) }}
            </option>
          </select>
        </label>
        <div class="grid grid-cols-2 gap-3">
          <label class="text-sm">Qty<input v-model.number="form.qty" type="number" min="1" class="sc-input mt-1 w-full"></label>
          <label class="text-sm">Unit cost ₹<input v-model.number="form.unit_cost" type="number" min="0" step="0.01" class="sc-input mt-1 w-full"></label>
        </div>
        <div class="rounded-md bg-cream/70 px-3 py-2 text-sm">
          <span class="text-[var(--muted)]">Preview total</span>
          <strong class="ml-2 text-chocolate">{{ money(previewTotal) }}</strong>
          <span class="ml-2 text-xs text-[var(--muted)]">· stock after accept / instant receive</span>
        </div>
        <label class="text-sm">Note<input v-model="form.note" class="sc-input mt-1 w-full" placeholder="Optional"></label>
        <label class="flex items-center gap-2 text-sm">
          <input v-model="form.instant_receive" type="checkbox" :disabled="form.mark_paid">
          Instant receive (skip supplier accept)
        </label>
        <label class="flex items-center gap-2 text-sm">
          <input v-model="form.mark_paid" type="checkbox" @change="form.mark_paid && (form.instant_receive = true)">
          Pay now (UPI/cash) — also receives stock
        </label>
        <label v-if="form.mark_paid" class="text-sm">
          Pay method
          <select v-model="form.pay_method" class="sc-input mt-1 w-full">
            <option value="upi">UPI</option>
            <option value="cod">COD</option>
            <option value="cash">Cash</option>
          </select>
        </label>
        <UButton type="submit" :disabled="busy">Place PO</UButton>
      </form>

      <div class="sc-card p-4 text-sm">
        <h3 class="font-display m-0 text-lg">Lifecycle</h3>
        <ol class="mt-3 list-decimal space-y-2 pl-5 text-[var(--muted)]">
          <li><strong class="text-chocolate">pending</strong> — PO sent, stock not in warehouse</li>
          <li><strong class="text-chocolate">received</strong> — stock applied, payable up (if unpaid)</li>
          <li><strong class="text-chocolate">partial / paid</strong> — supplier payments</li>
          <li><strong class="text-chocolate">rejected</strong> — supplier declined (no stock)</li>
        </ol>
        <p class="mt-3 text-xs text-[var(--muted)]">
          First payment ≥ 80% of bill; remainder can be paid later (COD/UPI/cash).
        </p>
      </div>
    </div>

    <div v-if="payRow" class="sc-card mb-4 grid max-w-md gap-3 p-4">
      <h3 class="font-display m-0 text-lg">Pay {{ payRow.bill_no || `SP-${payRow.id}` }}</h3>
      <p class="m-0 text-sm text-[var(--muted)]">
        Total {{ money(Number(payRow.total)) }} · paid {{ money(Number(payRow.paid_amount || 0)) }} · due {{ money(Number(payRow.due)) }}
      </p>
      <p v-if="Number(payRow.paid_amount || 0) <= 0" class="m-0 text-xs text-[var(--muted)]">
        First payment must be at least 80% ({{ money(Math.round(Number(payRow.total) * 0.8 * 100) / 100) }})
      </p>
      <label class="text-sm">
        Amount ₹
        <input v-model.number="payForm.amount" type="number" min="0.01" step="0.01" class="sc-input mt-1 w-full">
      </label>
      <label class="text-sm">
        Method
        <select v-model="payForm.pay_method" class="sc-input mt-1 w-full">
          <option value="razorpay">Razorpay</option>
          <option value="upi">UPI (record)</option>
          <option value="cod">COD</option>
          <option value="cash">Cash</option>
        </select>
      </label>
      <p v-if="payForm.pay_method === 'razorpay'" class="m-0 text-xs text-[var(--muted)]">
        Opens Razorpay Checkout — payable updates only after successful verify.
      </p>
      <label class="text-sm">Note<input v-model="payForm.note" class="sc-input mt-1 w-full" placeholder="Optional"></label>
      <div class="flex gap-2">
        <UButton type="button" :disabled="busy || !payForm.amount" @click="confirmPay">
          {{ payForm.pay_method === "razorpay" ? "Pay with Razorpay" : "Record payment" }}
        </UButton>
        <UButton type="button" color="neutral" variant="soft" :disabled="busy" @click="payRow = null">Cancel</UButton>
      </div>
    </div>

    <div class="mb-3 flex flex-wrap gap-2">
      <button
        v-for="f in (['all', 'pending', 'received', 'partial', 'paid', 'rejected'] as const)"
        :key="f"
        type="button"
        class="rounded-md px-3 py-1.5 text-xs font-semibold capitalize transition"
        :class="statusFilter === f ? 'bg-cocoa text-cream' : 'bg-cream text-cocoa hover:bg-blush/50'"
        @click="statusFilter = f"
      >
        {{ f }}
      </button>
    </div>

    <div class="sc-card overflow-x-auto">
      <table class="w-full min-w-[920px] text-left text-sm">
        <thead class="bg-cream/60 text-xs uppercase tracking-wide text-[var(--muted)]">
          <tr>
            <th class="px-4 py-3">Bill</th>
            <th class="px-4 py-3">Shop</th>
            <th class="px-4 py-3">Item / qty</th>
            <th class="px-4 py-3">Stock</th>
            <th class="px-4 py-3">Total</th>
            <th class="px-4 py-3">PO</th>
            <th class="px-4 py-3">Payment</th>
            <th class="px-4 py-3">Due</th>
            <th class="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in filteredRows" :key="String(r.id)" class="border-t border-[var(--line)]">
            <td class="px-4 py-3">
              <div class="font-semibold">{{ r.bill_no || `SP-${r.id}` }}</div>
              <div class="text-xs text-[var(--muted)]">{{ String(r.created_at || "").slice(0, 16) }}</div>
            </td>
            <td class="px-4 py-3 font-semibold">{{ r.shop_name }}</td>
            <td class="px-4 py-3">
              <div>{{ r.product_name }}</div>
              <div class="text-xs text-[var(--muted)]">{{ r.qty }} × {{ money(Number(r.unit_cost)) }}</div>
            </td>
            <td class="px-4 py-3 text-xs">
              <div>WH {{ r.warehouse_stock_qty ?? "—" }}</div>
              <div class="text-[var(--muted)]">Offer {{ r.supplier_available_qty ?? "—" }}</div>
            </td>
            <td class="px-4 py-3">{{ money(Number(r.total)) }}</td>
            <td class="px-4 py-3">
              <span class="sc-badge capitalize" :class="statusClass(r.status)">{{ r.status || "—" }}</span>
            </td>
            <td class="px-4 py-3">
              <span class="sc-badge capitalize" :class="statusClass(r.payment_status || r.status)">
                {{ String(r.payment_status || "—").replace(/_/g, " ") }}
              </span>
              <div v-if="r.paid_at" class="mt-1 text-xs text-[var(--muted)]">
                {{ String(r.pay_method || "") }} {{ String(r.paid_at).slice(0, 10) }}
              </div>
            </td>
            <td class="px-4 py-3">
              <span class="sc-badge" :class="Number(r.due) > 0 ? 'bg-honey/25 text-chocolate' : 'bg-emerald-100 text-emerald-800'">
                {{ Number(r.due) > 0 ? money(Number(r.due)) : (String(r.status) === "rejected" || String(r.status) === "pending" ? "—" : "Paid") }}
              </span>
            </td>
            <td class="px-4 py-3 text-right">
              <UButton
                v-if="canPay(r)"
                type="button"
                color="primary"
                variant="soft"
                size="xs"
                :disabled="busy"
                label="Pay"
                @click="openPay(r)"
              />
            </td>
          </tr>
        </tbody>
      </table>
      <EmptyState v-if="!filteredRows.length" class="m-4" title="No purchases" body="Create a PO above, or clear filters." />
    </div>
  </div>
</template>

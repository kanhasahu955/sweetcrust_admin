<script setup lang="ts">
import {
  apiError,
  formatDateTime12,
  money,
  relativeAgo,
} from "~/utils/format"
import { patchListRow, upsertListRow } from "~/utils/list"
import { resolveMediaUrl } from "~/utils/mapPins"

const api = useApi()
const route = useRoute()
const router = useRouter()
const toast = useAppToast()
const { confirm } = useConfirm()
const { openCheckout } = useRazorpayCheckout()
const { connect } = useSocket()
const config = useRuntimeConfig()
const socketLive = useState("adminSocketLive", () => false)
const lastPoBump = useState("adminLastPoBump", () => 0)

const loading = ref(true)
const refreshing = ref(false)
const catalogLoading = ref(false)
const shops = ref<Record<string, unknown>[]>([])
const products = ref<Record<string, unknown>[]>([])
const lowAlerts = ref<Record<string, unknown>[]>([])
const rows = ref<Record<string, unknown>[]>([])
const error = ref("")
const busy = ref(false)
const search = ref("")
const payRow = ref<Record<string, unknown> | null>(null)
const detailRow = ref<Record<string, unknown> | null>(null)
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

const statusTabs = [
  { value: "all" as const, label: "All" },
  { value: "pending" as const, label: "Pending" },
  { value: "received" as const, label: "Received" },
  { value: "partial" as const, label: "Partial" },
  { value: "paid" as const, label: "Paid" },
  { value: "rejected" as const, label: "Rejected" },
]

const wholesalers = computed(() =>
  shops.value.filter(
    (s) => s.is_wholesaler !== false && String(s.approval_status || "approved") === "approved",
  ),
)

const payableTotal = computed(() =>
  shops.value.reduce((n, s) => n + (Number(s.payable_balance) || 0), 0),
)

const openDueTotal = computed(() =>
  rows.value.reduce((n, r) => n + (Number(r.due) || 0), 0),
)

const pendingCount = computed(() => rows.value.filter((r) => String(r.status) === "pending").length)

const supplierFilterId = computed(() => {
  const raw = route.query.supplier_user_id
  const n = Number(Array.isArray(raw) ? raw[0] : raw)
  return Number.isFinite(n) && n > 0 ? n : null
})

const previewTotal = computed(() => Math.round(form.qty * form.unit_cost * 100) / 100)

const selectedProduct = computed(() =>
  products.value.find((p) => Number(p.id) === Number(form.product_id)) || null,
)

const selectedShop = computed(() =>
  wholesalers.value.find((s) => Number(s.user_id) === Number(form.supplier_user_id)) || null,
)

const unitLabel = computed(() => String(selectedProduct.value?.unit_label || "pcs"))

const filteredRows = computed(() => {
  let list = rows.value
  if (supplierFilterId.value) {
    list = list.filter((r) => Number(r.supplier_user_id) === supplierFilterId.value)
  }
  if (statusFilter.value !== "all") {
    list = list.filter((r) => String(r.status) === statusFilter.value)
  }
  const q = search.value.trim().toLowerCase()
  if (q) {
    list = list.filter((r) => {
      const blob = [r.shop_name, r.product_name, r.bill_no, r.status, r.brand_name]
        .map((x) => String(x || "").toLowerCase())
        .join(" ")
      return blob.includes(q)
    })
  }
  return list
})

const statusCounts = computed(() => {
  const base = supplierFilterId.value
    ? rows.value.filter((r) => Number(r.supplier_user_id) === supplierFilterId.value)
    : rows.value
  const c: Record<string, number> = { all: base.length }
  for (const t of statusTabs) {
    if (t.value === "all") continue
    c[t.value] = base.filter((r) => String(r.status) === t.value).length
  }
  return c
})

const filterShopName = computed(() => {
  if (!supplierFilterId.value) return ""
  const s = shops.value.find((x) => Number(x.user_id) === supplierFilterId.value)
  return s ? String(s.shop_name || "") : "Supplier"
})

const shopDueRows = computed(() =>
  filteredRows.value.filter((r) => Number(r.due) > 0).slice(0, 5),
)

function wholesaleOf(p: Record<string, unknown> | null | undefined) {
  if (!p) return 0
  for (const key of ["shop_price", "wholesale_price", "purchase_cost", "selling_price", "customer_price"] as const) {
    const n = Number(p[key])
    if (Number.isFinite(n) && n > 0) return n
  }
  return 0
}

function applyWholesale(p?: Record<string, unknown> | null) {
  const prod = p ?? selectedProduct.value
  form.unit_cost = wholesaleOf(prod)
}

function canPay(r: Record<string, unknown>) {
  const st = String(r.status || "")
  return Number(r.due) > 0 && (st === "received" || st === "partial")
}

function canReceive(r: Record<string, unknown>) {
  return String(r.status || "") === "pending"
}

function nameOf(r: Record<string, unknown>) {
  return String(r.product_name || r.name || "Purchase").trim()
}

function shopOf(r: Record<string, unknown>) {
  return String(r.shop_name || "Shop").trim()
}

function thumb(r: Record<string, unknown>) {
  return resolveMediaUrl(String(r.cover_image_url || ""), String(config.public.apiBase || ""))
}

function hideBrokenImg(e: Event) {
  const el = e.target as HTMLImageElement | null
  if (el) el.style.display = "none"
}

function asProductList(raw: unknown): Record<string, unknown>[] {
  if (Array.isArray(raw)) return raw as Record<string, unknown>[]
  const o = raw as { items?: unknown[]; results?: unknown[]; products?: unknown[] } | null
  const list = o?.items || o?.results || o?.products || []
  return Array.isArray(list) ? (list as Record<string, unknown>[]) : []
}

async function loadShopCatalog(supplierUserId: number) {
  if (!supplierUserId) {
    products.value = []
    form.product_id = 0
    form.unit_cost = 0
    return
  }
  catalogLoading.value = true
  try {
    const p = await api.admin.products(undefined, 1, undefined, supplierUserId, 100)
    products.value = asProductList(p)
    syncProductDefault()
  } catch (e) {
    error.value = apiError(e)
    products.value = []
  } finally {
    catalogLoading.value = false
  }
}

function syncProductDefault() {
  const list = products.value
  if (!list.length) {
    form.product_id = 0
    form.unit_cost = 0
    return
  }
  const still = list.find((x) => Number(x.id) === form.product_id)
  const pick = still || list[0]!
  form.product_id = Number(pick.id)
  applyWholesale(pick)
}

async function onSupplierChange() {
  form.product_id = 0
  await loadShopCatalog(form.supplier_user_id)
}

function onProduct() {
  const p = products.value.find((x) => Number(x.id) === Number(form.product_id))
  if (!p) return
  applyWholesale(p)
  if (p.supplier_user_id) form.supplier_user_id = Number(p.supplier_user_id)
}

async function orderLow(p: Record<string, unknown>) {
  const sid = Number(p.supplier_user_id || 0)
  if (!sid) {
    toast.error("No shop on this product")
    return
  }
  form.supplier_user_id = sid
  await loadShopCatalog(sid)
  const match = products.value.find((x) => Number(x.id) === Number(p.id))
  if (match) {
    form.product_id = Number(match.id)
    applyWholesale(match)
  }
  const thr = Number(p.low_stock_threshold)
  const need = Math.max(10, (Number.isFinite(thr) ? thr : 5) * 2 - (Number(p.stock_qty) || 0))
  form.qty = Math.max(1, need)
  toast.success(String(p.name || "Product"), `Qty set to ${form.qty}`)
}

function clearSupplierFilter() {
  const next = { ...route.query }
  delete next.supplier_user_id
  void router.replace({ query: next })
}

function setSupplierFilter(id: number) {
  void router.replace({ query: { ...route.query, supplier_user_id: String(id) } })
}

function onShopFilter(e: Event) {
  const n = Number((e.target as HTMLSelectElement).value) || 0
  if (!n) clearSupplierFilter()
  else setSupplierFilter(n)
}

async function load(opts?: { quiet?: boolean }) {
  if (opts?.quiet) refreshing.value = true
  else loading.value = true
  error.value = ""
  try {
    const [s, buys, inv] = await Promise.all([
      api.admin.shops(),
      api.admin.purchases(supplierFilterId.value || undefined),
      api.admin.inventory(),
    ])
    shops.value = Array.isArray(s) ? (s as Record<string, unknown>[]) : []
    rows.value = Array.isArray(buys) ? (buys as Record<string, unknown>[]) : []

    const invObj = (inv || {}) as { low_stock?: unknown[]; out_of_stock?: unknown[] }
    const low = Array.isArray(invObj.low_stock) ? invObj.low_stock : []
    const out = Array.isArray(invObj.out_of_stock) ? invObj.out_of_stock : []
    lowAlerts.value = [...out, ...low]
      .map((x) => x as Record<string, unknown>)
      .filter((p) => Number(p.supplier_user_id) > 0)
      .slice(0, 10)

    if (supplierFilterId.value) form.supplier_user_id = supplierFilterId.value
    else if (!form.supplier_user_id && wholesalers.value[0]) {
      form.supplier_user_id = Number(wholesalers.value[0].user_id)
    }
    if (form.supplier_user_id) await loadShopCatalog(form.supplier_user_id)
  } catch (e) {
    error.value = apiError(e)
  } finally {
    loading.value = false
    refreshing.value = false
  }
}

async function buy() {
  if (!form.supplier_user_id || !form.product_id || form.qty <= 0) {
    toast.error("Pick shop & product")
    return
  }
  if (form.unit_cost <= 0) applyWholesale()
  busy.value = true
  error.value = ""
  try {
    const created = (await api.admin.createPurchase({ ...form })) as Record<string, unknown>
    upsertListRow(rows, created)
    toast.success(form.mark_paid ? "Paid & received" : form.instant_receive ? "Received" : "PO placed")
    form.note = ""
    form.mark_paid = false
    form.instant_receive = false
    void load({ quiet: true })
  } catch (e) {
    error.value = apiError(e)
    toast.error(apiError(e))
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
  detailRow.value = null
  payForm.amount = already <= 0.001 ? Math.min(due, minFirst) : due
  payForm.pay_method = "razorpay"
  payForm.note = ""
  error.value = ""
}

function openDetail(r: Record<string, unknown>) {
  detailRow.value = r
  payRow.value = null
}

async function receivePo(r: Record<string, unknown>) {
  const id = Number(r.id)
  if (!id) return
  const ok = await confirm({
    title: "Receive into warehouse?",
    message: `${nameOf(r)} · ${r.qty} ${r.unit_label || "pcs"} from ${shopOf(r)}`,
    confirmText: "Receive",
  })
  if (!ok) return
  busy.value = true
  try {
    const saved = (await api.admin.receivePurchase(id)) as Record<string, unknown>
    if (!upsertListRow(rows, saved)) patchListRow(rows, id, saved)
    if (detailRow.value && Number(detailRow.value.id) === id) detailRow.value = saved
    toast.success("Received", "Stock updated")
    void load({ quiet: true })
  } catch (e) {
    toast.error(apiError(e))
  } finally {
    busy.value = false
  }
}

async function rejectPo(r: Record<string, unknown>) {
  const id = Number(r.id)
  if (!id) return
  const ok = await confirm({
    title: "Reject this PO?",
    message: `${nameOf(r)} · ${shopOf(r)} — no stock will be added.`,
    confirmText: "Reject",
    tone: "danger",
  })
  if (!ok) return
  busy.value = true
  try {
    const saved = (await api.admin.rejectPurchase(id, { note: "admin cancel" })) as Record<string, unknown>
    if (!upsertListRow(rows, saved)) patchListRow(rows, id, saved)
    if (detailRow.value && Number(detailRow.value.id) === id) detailRow.value = saved
    toast.success("Rejected")
    void load({ quiet: true })
  } catch (e) {
    toast.error(apiError(e))
  } finally {
    busy.value = false
  }
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
      if (!keyId || !orderId) throw new Error("Razorpay failed")
      const rz = await openCheckout({
        key_id: keyId,
        razorpay_order_id: orderId,
        amount_paise: amountPaise,
        name: "SweetCrust",
        description: nameOf(payRow.value),
      })
      const saved = await api.admin.verifyPurchaseRazorpay(id, {
        razorpay_order_id: rz.razorpay_order_id,
        razorpay_payment_id: rz.razorpay_payment_id,
        razorpay_signature: rz.razorpay_signature,
        amount: payForm.amount,
      })
      if (!upsertListRow(rows, saved)) patchListRow(rows, id, saved)
      toast.success("Paid")
      payRow.value = null
      void load({ quiet: true })
      return
    }

    const saved = await api.admin.payPurchase(id, {
      amount: payForm.amount,
      pay_method: payForm.pay_method,
      note: payForm.note || undefined,
    })
    if (!upsertListRow(rows, saved)) patchListRow(rows, id, { is_paid: true, status: "paid" })
    toast.success("Paid")
    payRow.value = null
    void load({ quiet: true })
  } catch (e) {
    const msg = apiError(e)
    if (msg && !/cancelled/i.test(msg)) {
      error.value = msg
      toast.error(msg)
    }
  } finally {
    busy.value = false
  }
}

watch(supplierFilterId, () => {
  void load()
})
watch(lastPoBump, () => {
  void load({ quiet: true })
})

let liveSocket: ReturnType<typeof connect> = null
const onAdminEvent = (data: Record<string, unknown>) => {
  const kind = String(data?.kind || "")
  if (kind.startsWith("po_") || kind.includes("purchase") || kind.includes("supplier") || kind.includes("stock")) {
    void load({ quiet: true })
  }
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
    <div class="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="font-display m-0 text-2xl text-chocolate sm:text-3xl">Buy from shops</h1>
        <p class="m-0 mt-1 flex flex-wrap items-center gap-2 text-sm text-[var(--muted)]">
          <span
            class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.65rem] font-semibold"
            :class="socketLive ? 'bg-[#e8f6ee] text-[#2e7d4f]' : 'bg-[#f8ede6] text-[var(--muted)]'"
          >
            <span class="size-1.5 rounded-full" :class="socketLive ? 'animate-pulse bg-success' : 'bg-[#c4a39a]'" />
            {{ socketLive ? "Live" : "Offline" }}
          </span>
          <span>Wholesale PO · receive stock · settle shops</span>
        </p>
      </div>
      <div class="flex flex-wrap gap-2">
        <UButton color="primary" variant="soft" icon="i-lucide-refresh-cw" :loading="loading || refreshing" @click="load()" />
        <UButton to="/inventory" color="neutral" variant="outline" icon="i-lucide-boxes" label="Inventory" />
        <UButton to="/shops" color="secondary" variant="outline" icon="i-lucide-store" label="Shops" />
      </div>
    </div>

    <p v-if="error" class="mb-3 text-sm text-danger">{{ error }}</p>

    <div
      v-if="lowAlerts.length"
      class="mb-4 rounded-2xl border border-[#e9748e]/30 bg-[#fff5f7] px-3 py-2.5"
    >
      <div class="mb-1.5 flex items-center justify-between gap-2">
        <p class="m-0 text-xs font-semibold uppercase tracking-wide text-[#e9748e]">
          Low stock · tap to prefill PO
        </p>
        <UButton to="/inventory" size="xs" color="neutral" variant="ghost" label="Inventory" />
      </div>
      <div class="flex flex-wrap gap-1.5">
        <button
          v-for="p in lowAlerts"
          :key="String(p.id)"
          type="button"
          class="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-chocolate ring-1 ring-[var(--line)] transition hover:ring-[#e9748e]"
          @click="orderLow(p)"
        >
          {{ p.name }} · {{ Number(p.stock_qty) || 0 }}
        </button>
      </div>
    </div>

    <div class="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="Suppliers" :value="wholesalers.length" icon="lucide:store" />
      <StatCard label="Open due" :value="money(openDueTotal)" icon="lucide:wallet" tone="warn" />
      <StatCard label="Shop payable" :value="money(payableTotal)" icon="lucide:banknote" />
      <StatCard label="Pending POs" :value="pendingCount" icon="lucide:clock" />
    </div>

    <div
      v-if="supplierFilterId"
      class="mb-3 flex items-center justify-between gap-2 rounded-xl bg-chocolate px-3 py-2 text-sm text-cream"
    >
      <span class="inline-flex items-center gap-1.5 font-semibold">
        <UIcon name="i-lucide-store" class="size-4" />
        {{ filterShopName }}
      </span>
      <button type="button" class="text-xs font-semibold text-[#ffc9d4]" @click="clearSupplierFilter">Clear filter</button>
    </div>

    <div class="mb-4 grid gap-4 lg:grid-cols-2">
      <form
        class="rounded-2xl border border-[var(--line)] bg-white p-4 shadow-[0_8px_22px_-18px_rgba(74,44,42,0.35)]"
        @submit.prevent="buy"
      >
        <p class="font-display m-0 mb-3 text-lg text-chocolate">New purchase</p>

        <label class="mb-3 block">
          <span class="sc-label">Shop</span>
          <select
            v-model.number="form.supplier_user_id"
            class="sc-input !rounded-xl"
            required
            @change="onSupplierChange"
          >
            <option v-for="s in wholesalers" :key="String(s.user_id)" :value="Number(s.user_id)">
              {{ s.shop_name }}{{ Number(s.payable_balance) ? ` · due ${money(Number(s.payable_balance))}` : '' }}
            </option>
          </select>
        </label>

        <label class="mb-3 block">
          <span class="sc-label">Product</span>
          <select
            v-model.number="form.product_id"
            class="sc-input !rounded-xl"
            required
            :disabled="catalogLoading || !products.length"
            @change="onProduct"
          >
            <option v-if="!products.length" :value="0">
              {{ catalogLoading ? "Loading…" : "No products for this shop" }}
            </option>
            <option v-for="p in products" :key="String(p.id)" :value="Number(p.id)">
              {{ p.name }} · {{ money(wholesaleOf(p)) }} · WH {{ Number(p.stock_qty) || 0 }}
            </option>
          </select>
        </label>

        <div class="mb-3 grid grid-cols-2 gap-3">
          <label>
            <span class="sc-label">Qty · {{ unitLabel }}</span>
            <input v-model.number="form.qty" type="number" min="1" class="sc-input !rounded-xl">
          </label>
          <label>
            <span class="sc-label">Wholesale ₹</span>
            <input v-model.number="form.unit_cost" type="number" min="0" step="0.01" class="sc-input !rounded-xl">
          </label>
        </div>

        <div
          v-if="selectedProduct"
          class="mb-3 flex flex-wrap gap-2 text-xs text-[var(--muted)]"
        >
          <span class="rounded-full bg-[#fff9f5] px-2 py-0.5 ring-1 ring-[var(--line)]">
            WH stock {{ Number(selectedProduct.stock_qty) || 0 }}
          </span>
          <span
            v-if="selectedProduct.supplier_available_qty != null"
            class="rounded-full bg-[#fff9f5] px-2 py-0.5 ring-1 ring-[var(--line)]"
          >
            Shop offer {{ Number(selectedProduct.supplier_available_qty) || 0 }}
          </span>
          <span
            v-if="selectedProduct.brand_name"
            class="rounded-full bg-[#fff9f5] px-2 py-0.5 ring-1 ring-[var(--line)]"
          >
            {{ selectedProduct.brand_name }}
          </span>
        </div>

        <p class="font-display m-0 mb-3 text-2xl text-chocolate">{{ money(previewTotal) }}</p>

        <label class="mb-3 block">
          <span class="sc-label">Note</span>
          <input v-model="form.note" class="sc-input !rounded-xl" placeholder="Optional">
        </label>

        <label class="mb-2 flex items-center gap-2 text-sm text-chocolate">
          <input v-model="form.instant_receive" type="checkbox" class="size-4 accent-[#e9748e]" :disabled="form.mark_paid">
          Instant receive (stock in now)
        </label>
        <label class="mb-3 flex items-center gap-2 text-sm text-chocolate">
          <input
            v-model="form.mark_paid"
            type="checkbox"
            class="size-4 accent-[#e9748e]"
            @change="form.mark_paid && (form.instant_receive = true)"
          >
          Pay now
        </label>
        <select v-if="form.mark_paid" v-model="form.pay_method" class="sc-input mb-3 !rounded-xl">
          <option value="upi">UPI</option>
          <option value="cod">COD</option>
          <option value="cash">Cash</option>
        </select>

        <UButton
          type="submit"
          color="secondary"
          block
          :loading="busy"
          :disabled="busy || !form.supplier_user_id || !form.product_id"
          :label="form.mark_paid ? 'Pay & receive' : form.instant_receive ? 'Receive PO' : 'Place PO'"
        />
      </form>

      <!-- Pay panel OR shop summary -->
      <div
        v-if="payRow"
        class="rounded-2xl border border-[#e9748e]/35 bg-[#fff5f7] p-4 shadow-[0_8px_22px_-18px_rgba(74,44,42,0.35)]"
      >
        <p class="font-display m-0 text-lg text-chocolate">Pay supplier</p>
        <p class="m-0 mt-1 font-semibold text-chocolate">{{ nameOf(payRow) }}</p>
        <p class="m-0 text-sm text-[var(--muted)]">{{ shopOf(payRow) }} · {{ payRow.bill_no }}</p>
        <p class="m-0 mt-2 text-sm">
          {{ money(Number(payRow.total)) }}
          · due <span class="font-bold text-[#e9748e]">{{ money(Number(payRow.due)) }}</span>
        </p>
        <label class="mt-3 block">
          <span class="sc-label">Amount</span>
          <input v-model.number="payForm.amount" type="number" min="0.01" step="0.01" class="sc-input !rounded-xl">
        </label>
        <label class="mt-3 block">
          <span class="sc-label">Method</span>
          <select v-model="payForm.pay_method" class="sc-input !rounded-xl">
            <option value="razorpay">Razorpay</option>
            <option value="upi">UPI</option>
            <option value="cod">COD</option>
            <option value="cash">Cash</option>
          </select>
        </label>
        <label class="mt-3 block">
          <span class="sc-label">Note</span>
          <input v-model="payForm.note" class="sc-input !rounded-xl" placeholder="Optional">
        </label>
        <div class="mt-3 flex gap-2">
          <UButton
            color="secondary"
            :loading="busy"
            :disabled="busy || !payForm.amount"
            :label="payForm.pay_method === 'razorpay' ? 'Razorpay' : 'Record pay'"
            @click="confirmPay"
          />
          <UButton color="neutral" variant="soft" label="Cancel" @click="payRow = null" />
        </div>
      </div>

      <div
        v-else-if="detailRow"
        class="rounded-2xl border border-[var(--line)] bg-white p-4 shadow-[0_8px_22px_-18px_rgba(74,44,42,0.35)]"
      >
        <div class="flex items-start justify-between gap-2">
          <div>
            <p class="font-display m-0 text-lg text-chocolate">{{ nameOf(detailRow) }}</p>
            <p class="m-0 text-sm text-[var(--muted)]">{{ detailRow.bill_no }} · {{ shopOf(detailRow) }}</p>
          </div>
          <StatusBadge :status="String(detailRow.status || '—')" />
        </div>
        <div class="mt-3 grid grid-cols-2 gap-2 rounded-xl bg-[#fff9f5] p-3 text-sm">
          <div>
            <p class="m-0 text-[0.65rem] uppercase text-[var(--muted)]">Total</p>
            <p class="m-0 font-bold text-chocolate">{{ money(Number(detailRow.total)) }}</p>
          </div>
          <div>
            <p class="m-0 text-[0.65rem] uppercase text-[var(--muted)]">Due</p>
            <p class="m-0 font-bold text-[#e9748e]">{{ money(Number(detailRow.due)) }}</p>
          </div>
          <div>
            <p class="m-0 text-[0.65rem] uppercase text-[var(--muted)]">Qty</p>
            <p class="m-0 font-semibold text-chocolate">{{ detailRow.qty }} {{ detailRow.unit_label || 'pcs' }}</p>
          </div>
          <div>
            <p class="m-0 text-[0.65rem] uppercase text-[var(--muted)]">Unit</p>
            <p class="m-0 font-semibold text-chocolate">{{ money(Number(detailRow.unit_cost)) }}</p>
          </div>
        </div>
        <p v-if="detailRow.note" class="m-0 mt-2 text-xs text-[var(--muted)]">{{ detailRow.note }}</p>
        <p class="m-0 mt-1 text-xs text-[var(--muted)]" :title="formatDateTime12(String(detailRow.created_at || ''))">
          {{ relativeAgo(String(detailRow.created_at || '')) }}
          · WH {{ detailRow.warehouse_stock_qty ?? '—' }}
        </p>
        <div class="mt-3 flex flex-wrap gap-1.5">
          <UButton
            v-if="canReceive(detailRow)"
            size="sm"
            color="secondary"
            label="Receive"
            :disabled="busy"
            @click="receivePo(detailRow)"
          />
          <UButton
            v-if="canReceive(detailRow)"
            size="sm"
            color="neutral"
            variant="outline"
            label="Reject"
            :disabled="busy"
            @click="rejectPo(detailRow)"
          />
          <UButton
            v-if="canPay(detailRow)"
            size="sm"
            color="secondary"
            label="Pay"
            :disabled="busy"
            @click="openPay(detailRow)"
          />
          <UButton size="sm" color="neutral" variant="soft" label="Close" @click="detailRow = null" />
        </div>
      </div>

      <div
        v-else
        class="rounded-2xl border border-dashed border-[var(--line)] bg-white p-4"
      >
        <p class="font-display m-0 text-lg text-chocolate">
          {{ selectedShop?.shop_name || 'Shop desk' }}
        </p>
        <p class="m-0 mt-1 text-sm text-[var(--muted)]">
          Payable {{ money(Number(selectedShop?.payable_balance) || 0) }}
          · {{ products.length }} SKUs
        </p>
        <div v-if="shopDueRows.length" class="mt-3 space-y-2">
          <p class="m-0 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Open dues</p>
          <button
            v-for="r in shopDueRows"
            :key="String(r.id)"
            type="button"
            class="flex w-full items-center justify-between rounded-xl bg-[#fff9f5] px-3 py-2 text-left text-sm ring-1 ring-[var(--line)] transition hover:ring-[#e9748e]"
            @click="openPay(r)"
          >
            <span class="truncate font-semibold text-chocolate">{{ nameOf(r) }}</span>
            <span class="shrink-0 font-bold text-[#e9748e]">{{ money(Number(r.due)) }}</span>
          </button>
        </div>
        <p v-else class="m-0 mt-6 text-center text-sm text-[var(--muted)]">
          Select a bill to pay, or open a card for receive / reject
        </p>
      </div>
    </div>

    <div class="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <label class="relative block w-full max-w-sm">
        <UIcon name="i-lucide-search" class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--muted)]" />
        <input v-model="search" class="sc-input w-full !rounded-xl !py-2.5 !pl-9" placeholder="Search bill, product, shop…">
      </label>
      <select
        class="sc-input !w-auto !rounded-xl !py-2"
        :value="supplierFilterId || 0"
        @change="onShopFilter"
      >
        <option :value="0">All shops</option>
        <option v-for="s in wholesalers" :key="String(s.user_id)" :value="Number(s.user_id)">
          {{ s.shop_name }}
        </option>
      </select>
    </div>

    <div class="mb-4 flex flex-wrap gap-1.5">
      <button
        v-for="t in statusTabs"
        :key="t.value"
        type="button"
        class="rounded-full px-3 py-1.5 text-xs font-semibold transition"
        :class="statusFilter === t.value ? 'bg-chocolate text-cream' : 'bg-white text-chocolate ring-1 ring-[var(--line)]'"
        @click="statusFilter = t.value"
      >
        {{ t.label }} {{ statusCounts[t.value] || 0 }}
      </button>
    </div>

    <div v-if="loading" class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <div v-for="n in 6" :key="n" class="sc-skeleton h-36 rounded-2xl" />
    </div>

    <div
      v-else-if="!filteredRows.length"
      class="rounded-2xl border border-dashed border-[var(--line)] py-14 text-center text-sm text-[var(--muted)]"
    >
      No purchases
    </div>

    <div v-else class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <article
        v-for="r in filteredRows"
        :key="String(r.id)"
        class="cursor-pointer rounded-2xl border border-[var(--line)] bg-white p-3.5 shadow-[0_8px_22px_-18px_rgba(74,44,42,0.35)] transition hover:border-[#e9748e]/35"
        @click="openDetail(r)"
      >
        <div class="flex gap-3">
          <div class="size-12 shrink-0 overflow-hidden rounded-xl bg-[#fff5f7] ring-1 ring-[var(--line)]">
            <img
              v-if="thumb(r)"
              :src="thumb(r) || undefined"
              alt=""
              class="size-full object-cover"
              @error="hideBrokenImg"
            >
            <div v-else class="grid size-full place-items-center text-sm font-bold text-[#e9748e]">
              {{ nameOf(r).slice(0, 1) }}
            </div>
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <p class="m-0 truncate font-semibold text-chocolate">{{ nameOf(r) }}</p>
                <span class="mt-1 inline-flex max-w-full items-center gap-1 truncate rounded-full bg-chocolate px-2 py-0.5 text-[0.65rem] font-semibold text-cream">
                  <UIcon name="i-lucide-store" class="size-3 shrink-0" />
                  <span class="truncate">{{ shopOf(r) }}</span>
                </span>
              </div>
              <StatusBadge :status="String(r.status || '—')" />
            </div>
          </div>
        </div>

        <div class="mt-3 flex items-end justify-between gap-2">
          <div>
            <p class="font-display m-0 text-xl text-chocolate">{{ money(Number(r.total)) }}</p>
            <p class="m-0 text-xs text-[var(--muted)]" :title="formatDateTime12(String(r.created_at || ''))">
              {{ r.bill_no }} · {{ r.qty }} {{ r.unit_label || 'pcs' }} × {{ money(Number(r.unit_cost)) }}
              · {{ relativeAgo(String(r.created_at || '')) }}
            </p>
            <p v-if="Number(r.due) > 0" class="m-0 mt-0.5 text-xs font-semibold text-[#e9748e]">
              Due {{ money(Number(r.due)) }}
            </p>
            <p v-else-if="String(r.status) === 'paid'" class="m-0 mt-0.5 text-xs font-semibold text-[#2e7d4f]">
              Settled{{ r.pay_method ? ` · ${r.pay_method}` : '' }}
            </p>
          </div>
          <div class="flex shrink-0 flex-col gap-1" @click.stop>
            <UButton
              v-if="canReceive(r)"
              size="xs"
              color="secondary"
              variant="soft"
              label="Receive"
              :disabled="busy"
              @click="receivePo(r)"
            />
            <UButton
              v-if="canPay(r)"
              size="xs"
              color="secondary"
              label="Pay"
              :disabled="busy"
              @click="openPay(r)"
            />
            <UButton
              v-if="canReceive(r)"
              size="xs"
              color="neutral"
              variant="ghost"
              class="!text-danger"
              label="Reject"
              :disabled="busy"
              @click="rejectPo(r)"
            />
          </div>
        </div>
      </article>
    </div>
  </div>
</template>

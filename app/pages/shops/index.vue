<script setup lang="ts">
import { useAppToast } from "~/composables/useAppToast"
import { money, shopContactPhone, shopLoginLabel } from "~/utils/format"
import { patchListRow, upsertListRow } from "~/utils/list"

const api = useApi()
const toast = useAppToast()
const { confirm } = useConfirm()
const { connect } = useSocket()
const { openCheckout } = useRazorpayCheckout()
const pendingBump = useState("adminShopPendingBump", () => 0)

const loading = ref(true)
const accountLoading = ref(false)
const error = ref("")
const info = ref("")
const shops = ref<Record<string, unknown>[]>([])
const selected = ref<Record<string, unknown> | null>(null)
const account = ref<Record<string, unknown> | null>(null)
const showCreate = ref(false)
const showPassword = ref(false)
const createdCreds = ref<{ phone: string; password: string; shop_name: string } | null>(null)
const filter = ref<"all" | "pending" | "incomplete" | "approved" | "rejected">("all")
const detailOpen = ref(false)
const tab = ref<"overview" | "orders" | "payments" | "supplier">("overview")
const expandedOrderId = ref<number | null>(null)
const supplierPay = ref<Record<string, unknown> | null>(null)
const supplierPayForm = reactive({ amount: 0, pay_method: "razorpay", note: "" })
const collect = reactive({ amount: 0, method: "upi", note: "" })
const approveForm = reactive({ credit_allowed: true, credit_limit: 25000 })
const form = reactive({
  shop_name: "",
  owner_name: "",
  phone: "",
  contact_phone: "",
  password: "",
  address_line: "",
  village: "",
  zone: "",
  city: "Bhubaneswar",
  pincode: "",
  credit_limit: 25000,
  credit_allowed: true,
})
const busy = ref(false)

const STATUS_RANK: Record<string, number> = { pending: 0, incomplete: 1, approved: 2, rejected: 3 }
const filterChips = [
  { value: "all" as const, label: "All" },
  { value: "pending" as const, label: "Awaiting approval" },
  { value: "incomplete" as const, label: "Profile incomplete" },
  { value: "approved" as const, label: "Active" },
  { value: "rejected" as const, label: "Rejected" },
]

const pendingCount = computed(() => shops.value.filter((s) => statusOf(s) === "pending").length)
const incompleteCount = computed(() => shops.value.filter((s) => statusOf(s) === "incomplete").length)
const theyOweTotal = computed(() => shops.value.reduce((n, s) => n + (Number(s.outstanding_balance) || 0), 0))
const weOweTotal = computed(() =>
  shops.value.reduce((n, s) => (isSupplier(s) ? n + (Number(s.payable_balance) || 0) : n), 0),
)

const filtered = computed(() => {
  const rows = filter.value === "all"
    ? [...shops.value]
    : shops.value.filter((s) => statusOf(s) === filter.value)
  return rows.sort((a, b) => {
    const ra = STATUS_RANK[statusOf(a)] ?? 9
    const rb = STATUS_RANK[statusOf(b)] ?? 9
    if (ra !== rb) return ra - rb
    return String(a.shop_name || "").localeCompare(String(b.shop_name || ""))
  })
})

const totals = computed(() => (account.value?.totals || {}) as Record<string, number>)
const orders = computed(() => (Array.isArray(account.value?.orders) ? account.value!.orders : []) as Record<string, unknown>[])
const ledger = computed(() => (Array.isArray(account.value?.ledger) ? account.value!.ledger : []) as Record<string, unknown>[])
const supplierBills = computed(() => (Array.isArray(account.value?.supplier_bills) ? account.value!.supplier_bills : []) as Record<string, unknown>[])

const selectedDue = computed(() =>
  Number(totals.value.outstanding_balance ?? selected.value?.outstanding_balance) || 0,
)
const drawerTitle = computed(() =>
  selected.value ? String(selected.value.shop_name || selected.value.name || "Shop") : "Shop",
)
const drawerDesc = computed(() => {
  if (!selected.value) return ""
  return `${selected.value.owner_name || "—"} · ${statusLabel(statusOf(selected.value))}`
})

const drawerTabs = computed(() => {
  const tabs: { key: typeof tab.value; label: string }[] = [
    { key: "overview", label: "Account" },
    { key: "orders", label: `Orders (${orders.value.length})` },
    { key: "payments", label: "Payments" },
  ]
  if (selected.value && isSupplier(selected.value)) {
    tabs.push({ key: "supplier", label: `Supplier (${supplierBills.value.length})` })
  }
  return tabs
})

function statusOf(s: Record<string, unknown>) {
  return String(s.approval_status || "approved")
}
function statusLabel(status: string) {
  if (status === "incomplete") return "Profile incomplete"
  if (status === "pending") return "Awaiting approval"
  if (status === "rejected") return "Rejected"
  return "Active"
}
function badgeClass(status: string) {
  if (status === "incomplete") return "bg-cream text-[var(--muted)]"
  if (status === "pending") return "bg-honey/25 text-cocoa"
  if (status === "rejected") return "bg-danger/15 text-danger"
  return "bg-emerald-100 text-emerald-900"
}
function isSupplier(s: Record<string, unknown>) {
  if (typeof s.is_supplier === "boolean") return s.is_supplier
  return s.is_wholesaler !== false
}
function payBadge(status: unknown) {
  const s = String(status || "").toLowerCase()
  if (s === "paid") return "bg-emerald-100 text-emerald-900"
  if (s.includes("partial")) return "bg-amber-100 text-amber-900"
  return "bg-honey/25 text-cocoa"
}
function shopId(s: Record<string, unknown>) {
  return Number(s.user_id || s.id)
}
function isSelected(s: Record<string, unknown>) {
  return detailOpen.value && selected.value != null && shopId(selected.value) === shopId(s)
}
function entryLabel(e: Record<string, unknown>) {
  const t = String(e.entry_type || "").toLowerCase()
  if (t === "debit") return "Order / debit"
  if (t === "credit") return "Collection"
  return String(e.note || e.entry_type || "Entry")
}
function addressPrimary(s: Record<string, unknown>) {
  return String(s.address_line || s.village || s.area || "").trim()
}
function addressSecondary(s: Record<string, unknown>) {
  return [s.city, s.pincode || s.zone].filter(Boolean).map(String).join(" · ")
}
function addressFull(s: Record<string, unknown>) {
  if (s.address_display) return String(s.address_display)
  const parts = [s.address_line, s.village, s.area, s.city, s.state, s.pincode, s.zone]
  return parts.filter(Boolean).map(String).join(", ") || "—"
}
function filterCount(value: typeof filter.value) {
  if (value === "all") return shops.value.length
  return shops.value.filter((s) => statusOf(s) === value).length
}

function generatePassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
  const bytes = new Uint8Array(12)
  crypto.getRandomValues(bytes)
  let out = ""
  for (let i = 0; i < bytes.length; i++) out += alphabet[bytes[i]! % alphabet.length]!
  // Ensure at least one upper, lower, digit
  if (!/[A-Z]/.test(out)) out = `A${out.slice(1)}`
  if (!/[a-z]/.test(out)) out = `${out.slice(0, 1)}b${out.slice(2)}`
  if (!/[0-9]/.test(out)) out = `${out.slice(0, 2)}7${out.slice(3)}`
  form.password = out
  showPassword.value = true
}

async function copyText(text: string, label = "Copied") {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(label)
  } catch {
    toast.error("Could not copy")
  }
}

function resetCreateForm() {
  Object.assign(form, {
    shop_name: "",
    owner_name: "",
    phone: "",
    contact_phone: "",
    password: "",
    address_line: "",
    village: "",
    zone: "",
    city: "Bhubaneswar",
    pincode: "",
    credit_limit: 25000,
    credit_allowed: true,
  })
  showPassword.value = false
}

function collectDueFromOrder(o: Record<string, unknown>) {
  const due = Number(o.due) || 0
  const amount = due > 0 ? due : selectedDue.value
  setCollectAmount(amount)
  tab.value = "payments"
}

function toggleOrderLines(id: number) {
  expandedOrderId.value = expandedOrderId.value === id ? null : id
}

function canPaySupplier(b: Record<string, unknown>) {
  const st = String(b.status || "")
  return Number(b.due) > 0 && (st === "received" || st === "partial")
}

function openSupplierPay(b: Record<string, unknown>) {
  const due = Number(b.due) || 0
  const total = Number(b.total) || 0
  const already = Number(b.paid_amount) || 0
  const minFirst = Math.round(total * 0.8 * 100) / 100
  supplierPay.value = b
  supplierPayForm.amount = already <= 0.001 ? Math.min(due, minFirst) : due
  supplierPayForm.pay_method = "razorpay"
  supplierPayForm.note = ""
}

async function confirmSupplierPay() {
  if (!supplierPay.value || !selected.value) return
  const id = Number(supplierPay.value.id)
  busy.value = true
  error.value = ""
  try {
    if (supplierPayForm.pay_method === "razorpay") {
      const created = await api.admin.createPurchaseRazorpay(id, { amount: supplierPayForm.amount })
      const keyId = String(created.key_id || "")
      const orderId = String(created.razorpay_order_id || "")
      const amountPaise = Number(created.amount_paise ?? Math.round(Number(created.amount || supplierPayForm.amount) * 100))
      if (!keyId || !orderId) throw new Error("Razorpay create failed")
      const rz = await openCheckout({
        key_id: keyId,
        razorpay_order_id: orderId,
        amount_paise: amountPaise,
        description: String(created.bill_no || `PO #${id}`),
      })
      await api.admin.verifyPurchaseRazorpay(id, {
        razorpay_order_id: rz.razorpay_order_id,
        razorpay_payment_id: rz.razorpay_payment_id,
        razorpay_signature: rz.razorpay_signature,
        amount: supplierPayForm.amount,
      })
      toast.success("Razorpay payment verified")
    } else {
      await api.admin.payPurchase(id, {
        amount: supplierPayForm.amount,
        pay_method: supplierPayForm.pay_method,
        note: supplierPayForm.note || undefined,
      })
      toast.success("Supplier payment recorded")
    }
    supplierPay.value = null
    await load({ quiet: true })
    await loadAccount(shopId(selected.value))
    const row = shops.value.find((x) => shopId(x) === shopId(selected.value!))
    if (row) selected.value = row
  } catch (e) {
    const msg = apiError(e)
    if (msg && !/cancelled/i.test(msg)) {
      error.value = msg
      toast.error("Pay failed", msg)
    } else {
      toast.info("Payment cancelled")
    }
  } finally {
    busy.value = false
  }
}

async function load(opts: { quiet?: boolean } = {}) {
  if (!opts.quiet) loading.value = true
  error.value = ""
  try {
    const data = await api.admin.shops()
    shops.value = Array.isArray(data) ? (data as Record<string, unknown>[]) : []
    if (selected.value && detailOpen.value) {
      const row = shops.value.find((x) => shopId(x) === shopId(selected.value!))
      if (row) {
        selected.value = row
        approveForm.credit_allowed = row.credit_allowed !== false
        approveForm.credit_limit = Number(row.credit_limit) || 25000
        await loadAccount(shopId(row))
      }
    }
  } catch (e) {
    if (!opts.quiet) error.value = apiError(e)
  } finally {
    loading.value = false
  }
}

async function loadAccount(id: number) {
  accountLoading.value = true
  try {
    account.value = await api.admin.shopAccount(id)
  } catch (e) {
    account.value = null
    error.value = apiError(e)
  } finally {
    accountLoading.value = false
  }
}

function applyLiveShop(data: Record<string, unknown>) {
  if (data.user_id == null) return
  upsertListRow(shops, data, "user_id")
  const kind = String(data.kind || "")
  if (kind === "shop_submitted") {
    filter.value = "pending"
    info.value = `${data.shop_name || "Shop"} submitted — review and activate`
    const row = shops.value.find((x) => shopId(x) === Number(data.user_id))
    if (row) void openShop(row)
  } else if (selected.value && shopId(selected.value) === Number(data.user_id)) {
    selected.value = { ...selected.value, ...data }
    void loadAccount(Number(data.user_id))
  }
}

watch(pendingBump, () => {
  void load({ quiet: true })
})

async function createShop() {
  if (form.password.length < 6) {
    toast.info("Password must be at least 6 characters")
    return
  }
  busy.value = true
  error.value = ""
  info.value = ""
  const plainPassword = form.password
  const shopName = form.shop_name.trim()
  try {
    const res = (await api.admin.createShop({
      ...form,
      contact_phone: form.contact_phone || form.phone,
    })) as { phone?: string; message?: string }
    const phone = String(res.phone || form.phone)
    createdCreds.value = { phone, password: plainPassword, shop_name: shopName }
    info.value = res.message || `Shop created. Login: ${phone}`
    toast.success("Shop created — copy login once")
    showCreate.value = false
    resetCreateForm()
    await load()
  } catch (e) {
    error.value = apiError(e)
  } finally {
    busy.value = false
  }
}

async function openShop(s: Record<string, unknown>) {
  selected.value = s
  detailOpen.value = true
  tab.value = "overview"
  approveForm.credit_allowed = s.credit_allowed !== false
  approveForm.credit_limit = Number(s.credit_limit) || 25000
  collect.amount = Number(s.outstanding_balance) > 0 ? Number(s.outstanding_balance) : 0
  collect.note = ""
  await loadAccount(shopId(s))
}

function setCollectAmount(n: number) {
  collect.amount = Math.round(Math.max(0, n) * 100) / 100
}

async function approve(s: Record<string, unknown>) {
  busy.value = true
  error.value = ""
  try {
    const id = shopId(s)
    await api.admin.approveShop(id, { ...approveForm })
    toast.success("Shop activated")
    patchListRow(shops, id, {
      approval_status: "approved",
      credit_allowed: approveForm.credit_allowed,
      credit_limit: approveForm.credit_limit,
    }, "user_id")
    await load({ quiet: true })
    const row = shops.value.find((x) => shopId(x) === id)
    if (row) await openShop(row)
  } catch (e) {
    error.value = apiError(e)
    toast.error("Approve failed", apiError(e))
  } finally {
    busy.value = false
  }
}

async function reject(s: Record<string, unknown>) {
  const ok = await confirm({
    title: "Reject shop",
    message: "This shop will not be able to place wholesale orders.",
    confirmText: "Reject",
    tone: "danger",
  })
  if (!ok) return
  busy.value = true
  try {
    const id = shopId(s)
    await api.admin.rejectShop(id)
    toast.success("Shop rejected")
    patchListRow(shops, id, { approval_status: "rejected" }, "user_id")
    await load({ quiet: true })
    const row = shops.value.find((x) => shopId(x) === id)
    if (row) await openShop(row)
  } catch (e) {
    error.value = apiError(e)
    toast.error("Reject failed", apiError(e))
  } finally {
    busy.value = false
  }
}

async function toggleBlock() {
  if (!selected.value) return
  busy.value = true
  try {
    const id = shopId(selected.value)
    const next = !selected.value.is_blocked
    await api.admin.patchShop(id, { is_blocked: next })
    toast.success(next ? "Shop blocked" : "Shop unblocked")
    selected.value = { ...selected.value, is_blocked: next }
    await load({ quiet: true })
  } catch (e) {
    error.value = apiError(e)
  } finally {
    busy.value = false
  }
}

async function saveCredit() {
  if (!selected.value) return
  busy.value = true
  try {
    const id = shopId(selected.value)
    await api.admin.patchShop(id, {
      credit_allowed: approveForm.credit_allowed,
      credit_limit: approveForm.credit_limit,
    })
    toast.success("Credit saved")
    selected.value = {
      ...selected.value,
      credit_allowed: approveForm.credit_allowed,
      credit_limit: approveForm.credit_limit,
    }
    await load({ quiet: true })
    await loadAccount(id)
  } catch (e) {
    error.value = apiError(e)
  } finally {
    busy.value = false
  }
}

async function collectPay() {
  if (!selected.value || !collect.amount) return
  if (collect.amount > selectedDue.value + 0.01) {
    toast.info("Amount cannot exceed receivable")
    return
  }
  busy.value = true
  try {
    const id = shopId(selected.value)
    const res = (await api.admin.shopCollect(id, { ...collect })) as { outstanding_balance?: number }
    toast.success("Collection recorded")
    collect.note = ""
    patchListRow(shops, id, {
      outstanding_balance: res.outstanding_balance ?? Math.max(0, selectedDue.value - collect.amount),
    }, "user_id")
    if (selected.value) {
      selected.value = {
        ...selected.value,
        outstanding_balance: res.outstanding_balance ?? Math.max(0, selectedDue.value - collect.amount),
      }
    }
    collect.amount = 0
    await loadAccount(id)
    await load({ quiet: true })
    tab.value = "payments"
  } catch (e) {
    error.value = apiError(e)
    toast.error("Collection failed", apiError(e))
  } finally {
    busy.value = false
  }
}

async function toggleWholesaler() {
  if (!selected.value) return
  busy.value = true
  try {
    const id = shopId(selected.value)
    const next = selected.value.is_wholesaler === false
    await api.admin.patchShop(id, { is_wholesaler: next })
    toast.success(next ? "Supplier enabled" : "Supplier disabled")
    selected.value = { ...selected.value, is_wholesaler: next }
    await load({ quiet: true })
    await loadAccount(id)
  } catch (e) {
    error.value = apiError(e)
  } finally {
    busy.value = false
  }
}

let liveSocket: ReturnType<typeof connect> = null
let pollId: number | undefined
const onAdminEvent = (data: Record<string, unknown>) => {
  const kind = String(data?.kind || "")
  if (kind === "shop_submitted" || kind === "shop_approved" || kind === "shop_rejected") {
    applyLiveShop(data)
    return
  }
  if (kind === "shop_collection" && data.user_id != null) {
    const uid = Number(data.user_id)
    patchListRow(shops, uid, { outstanding_balance: data.outstanding_balance }, "user_id")
    if (selected.value && shopId(selected.value) === uid) {
      selected.value = { ...selected.value, outstanding_balance: data.outstanding_balance }
      void loadAccount(uid)
    }
    return
  }
  if (
    (kind === "po_paid" || kind === "po_received")
    && selected.value
    && Number(data.supplier_user_id) === shopId(selected.value)
  ) {
    void load({ quiet: true })
    void loadAccount(shopId(selected.value))
  }
}

onMounted(() => {
  void load()
  liveSocket = connect()
  liveSocket?.on("admin_event", onAdminEvent)
  pollId = window.setInterval(() => {
    if (document.visibilityState === "visible") void load({ quiet: true })
  }, 12000)
})
onBeforeUnmount(() => {
  liveSocket?.off("admin_event", onAdminEvent)
  if (pollId) window.clearInterval(pollId)
})
</script>

<template>
  <div>
    <PageHeader title="Shops">
      <template #actions>
        <UButton type="button" @click="showCreate = !showCreate">
          {{ showCreate ? "Cancel" : "Add shop" }}
        </UButton>
      </template>
    </PageHeader>

    <div class="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-sm">
      <span><strong class="text-chocolate">{{ shops.length }}</strong> <span class="text-[var(--muted)]">shops</span></span>
      <span class="text-[var(--line)]">|</span>
      <span><strong class="text-chocolate">{{ pendingCount + incompleteCount }}</strong> <span class="text-[var(--muted)]">need action</span></span>
      <span class="text-[var(--line)]">|</span>
      <span title="Shop owes bakery (B2B udhaar)">
        <span class="text-[var(--muted)]">Receivable</span>
        <span class="text-[0.65rem] text-[var(--muted)]"> (they owe us)</span>
        <strong class="ml-1 text-honey">{{ money(theyOweTotal) }}</strong>
      </span>
      <span class="text-[var(--line)]">|</span>
      <span title="Bakery owes supplier shops for unpaid purchases">
        <span class="text-[var(--muted)]">Payable</span>
        <span class="text-[0.65rem] text-[var(--muted)]"> (we owe them)</span>
        <strong class="ml-1 text-chocolate">{{ money(weOweTotal) }}</strong>
      </span>
    </div>

    <p v-if="error" class="mb-3 text-sm text-danger">{{ error }}</p>
    <p v-if="info" class="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{{ info }}</p>

    <div
      v-if="createdCreds"
      class="mb-4 rounded-lg border border-honey/40 bg-honey/10 px-4 py-3 text-sm"
    >
      <div class="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p class="m-0 font-semibold text-cocoa">Login (shown once)</p>
          <p class="m-0 mt-1 text-chocolate">
            {{ createdCreds.shop_name }} · phone <strong>{{ createdCreds.phone }}</strong>
            · password <strong class="font-mono">{{ createdCreds.password }}</strong>
          </p>
          <p class="m-0 mt-1 text-xs text-[var(--muted)]">Copy now — this will not appear again.</p>
        </div>
        <div class="flex flex-wrap gap-2">
          <UButton
            type="button"
            size="xs"
            color="primary"
            variant="soft"
            label="Copy both"
            @click="copyText(`${createdCreds.phone} / ${createdCreds.password}`, 'Credentials copied')"
          />
          <UButton type="button" size="xs" color="neutral" variant="outline" label="Dismiss" @click="createdCreds = null" />
        </div>
      </div>
    </div>

    <div class="mb-1 flex flex-wrap gap-2">
      <button
        v-for="f in filterChips"
        :key="f.value"
        type="button"
        class="rounded-md px-3 py-1.5 text-xs font-semibold transition"
        :class="filter === f.value ? 'bg-cocoa text-cream' : 'bg-cream text-cocoa hover:bg-blush/50'"
        @click="filter = f.value"
      >
        {{ f.label }} ({{ filterCount(f.value) }})
      </button>
    </div>
    <p class="mb-3 text-[0.7rem] text-[var(--muted)]">
      Status = KYC/approval. Supplier = you can buy stock from them. Blocked = cannot order.
    </p>

    <div v-if="showCreate" class="sc-card mb-4 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
      <h2 class="m-0 text-base font-semibold text-chocolate sm:col-span-2 lg:col-span-3">New shop</h2>
      <label><span class="sc-label">Shop name</span><input v-model="form.shop_name" class="sc-input" required></label>
      <label><span class="sc-label">Owner</span><input v-model="form.owner_name" class="sc-input" required></label>
      <label><span class="sc-label">Login phone</span><input v-model="form.phone" class="sc-input" placeholder="+91…" required></label>
      <label><span class="sc-label">WhatsApp / contact</span><input v-model="form.contact_phone" class="sc-input"></label>
      <div class="sm:col-span-2">
        <span class="sc-label">Password</span>
        <div class="flex flex-wrap gap-2">
          <input
            v-model="form.password"
            :type="showPassword ? 'text' : 'password'"
            class="sc-input min-w-[12rem] flex-1 font-mono"
            minlength="6"
            required
            autocomplete="new-password"
          >
          <UButton type="button" size="sm" color="primary" variant="soft" label="Generate" @click="generatePassword" />
          <UButton
            type="button"
            size="sm"
            color="neutral"
            variant="outline"
            :label="showPassword ? 'Hide' : 'Show'"
            @click="showPassword = !showPassword"
          />
          <UButton
            type="button"
            size="sm"
            color="neutral"
            variant="outline"
            label="Copy"
            :disabled="!form.password"
            @click="copyText(form.password, 'Password copied')"
          />
        </div>
        <p class="m-0 mt-1 text-xs text-[var(--muted)]">Min 6 chars — generate or type your own.</p>
      </div>
      <label class="sm:col-span-2">
        <span class="sc-label">Address</span>
        <input v-model="form.address_line" class="sc-input" placeholder="e.g. Near School Chhak">
      </label>
      <label>
        <span class="sc-label">Locality</span>
        <input v-model="form.village" class="sc-input" placeholder="Area / locality">
      </label>
      <label><span class="sc-label">Zone</span><input v-model="form.zone" class="sc-input"></label>
      <label><span class="sc-label">City</span><input v-model="form.city" class="sc-input"></label>
      <label><span class="sc-label">Pincode</span><input v-model="form.pincode" class="sc-input"></label>
      <label><span class="sc-label">Credit limit ₹</span><input v-model.number="form.credit_limit" type="number" class="sc-input"></label>
      <div class="flex items-end sm:col-span-2 lg:col-span-3">
        <UButton type="button" :disabled="busy || !form.shop_name || !form.phone || form.password.length < 6" @click="createShop">
          Create shop
        </UButton>
      </div>
    </div>

    <div class="sc-card overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full min-w-[720px] text-sm">
          <thead>
            <tr class="bg-cream/80 text-left text-[0.68rem] uppercase tracking-wider text-[var(--muted)]">
              <th class="px-4 py-3">Shop</th>
              <th class="px-4 py-3">Status</th>
              <th class="px-4 py-3">Phone</th>
              <th class="px-4 py-3">Address</th>
              <th class="px-4 py-3" title="Shop owes bakery (B2B udhaar)">
                Receivable
                <span class="mt-0.5 block normal-case tracking-normal text-[0.6rem] font-normal">(they owe us)</span>
              </th>
              <th class="px-4 py-3" title="Bakery owes shop for supplier purchases">
                Payable
                <span class="mt-0.5 block normal-case tracking-normal text-[0.6rem] font-normal">(we owe them)</span>
              </th>
              <th class="px-4 py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="s in filtered"
              :key="String(shopId(s))"
              class="border-t border-[var(--line)] transition hover:bg-cream/40"
              :class="isSelected(s) ? 'bg-honey/10' : ''"
            >
              <td class="px-4 py-3">
                <div class="flex items-center gap-2.5">
                  <img
                    v-if="s.shop_logo_url"
                    :src="String(s.shop_logo_url)"
                    alt=""
                    class="h-9 w-9 shrink-0 rounded-md object-cover ring-1 ring-[var(--line)]"
                  >
                  <span
                    v-else
                    class="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-cream text-xs font-bold text-cocoa ring-1 ring-[var(--line)]"
                  >
                    {{ String(s.shop_name || "?").slice(0, 1).toUpperCase() }}
                  </span>
                  <div class="min-w-0">
                    <p class="m-0 flex items-center gap-2 font-semibold text-chocolate">
                      <span class="inline-block size-2 shrink-0 rounded-full" :class="s.is_online ? 'bg-emerald-500' : 'bg-stone-300'" />
                      {{ s.shop_name || s.name || "—" }}
                    </p>
                    <p class="m-0 text-xs text-[var(--muted)]">{{ s.owner_name || "—" }}</p>
                    <div class="mt-1 flex flex-wrap gap-1">
                      <span v-if="isSupplier(s)" class="sc-badge bg-cream text-cocoa">Supplier</span>
                      <span v-if="s.is_blocked" class="sc-badge bg-danger/15 text-danger">Blocked</span>
                    </div>
                  </div>
                </div>
              </td>
              <td class="px-4 py-3">
                <span class="sc-badge" :class="badgeClass(statusOf(s))">{{ statusLabel(statusOf(s)) }}</span>
              </td>
              <td class="px-4 py-3 tabular-nums">{{ shopContactPhone(s as never) }}</td>
              <td class="px-4 py-3" :title="addressFull(s)">
                <p class="m-0 max-w-[12rem] truncate font-medium">{{ addressPrimary(s) || "—" }}</p>
                <p v-if="addressSecondary(s)" class="m-0 text-xs text-[var(--muted)]">{{ addressSecondary(s) }}</p>
              </td>
              <td class="px-4 py-3 font-semibold text-honey">{{ money(Number(s.outstanding_balance)) }}</td>
              <td class="px-4 py-3 font-semibold text-chocolate">
                {{ isSupplier(s) ? money(Number(s.payable_balance)) : "—" }}
              </td>
              <td class="px-4 py-3 text-right">
                <UButton type="button" size="xs" color="primary" variant="soft" @click="openShop(s)">
                  View
                </UButton>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-if="loading" class="p-6 text-sm text-[var(--muted)]">Loading shops…</div>
      <EmptyState v-else-if="!filtered.length" class="m-4" title="No shops" body="Add a shop, or wait for a retailer signup." />
    </div>

    <USlideover
      v-model:open="detailOpen"
      side="right"
      :title="drawerTitle"
      :description="drawerDesc"
      :ui="{ content: 'w-full max-w-xl sm:max-w-2xl' }"
    >
      <template v-if="selected" #body>
        <div class="space-y-4">
          <!-- Tabs -->
          <div class="flex flex-wrap gap-1 border-b border-[var(--line)] pb-2">
            <button
              v-for="t in drawerTabs"
              :key="t.key"
              type="button"
              class="rounded-md px-3 py-1.5 text-xs font-semibold"
              :class="tab === t.key ? 'bg-cocoa text-cream' : 'text-cocoa hover:bg-cream'"
              @click="tab = t.key"
            >
              {{ t.label }}
            </button>
          </div>

          <p v-if="accountLoading" class="text-sm text-[var(--muted)]">Loading account…</p>

          <!-- OVERVIEW -->
          <template v-else-if="tab === 'overview'">
            <div class="flex items-center gap-3 rounded-md border border-[var(--line)] p-3">
              <img
                v-if="selected.shop_logo_url"
                :src="String(selected.shop_logo_url)"
                alt="Shop logo"
                class="h-16 w-16 shrink-0 rounded-md object-cover ring-1 ring-[var(--line)]"
              >
              <span
                v-else
                class="flex h-16 w-16 shrink-0 items-center justify-center rounded-md bg-cream text-xl font-bold text-cocoa ring-1 ring-[var(--line)]"
              >
                {{ String(selected.shop_name || "?").slice(0, 1).toUpperCase() }}
              </span>
              <div class="min-w-0">
                <p class="m-0 font-semibold text-chocolate">{{ selected.shop_name || selected.name }}</p>
                <p class="m-0 text-sm text-[var(--muted)]">{{ selected.owner_name || "—" }}</p>
                <div class="mt-1 flex flex-wrap gap-1">
                  <span class="sc-badge" :class="badgeClass(statusOf(selected))">{{ statusLabel(statusOf(selected)) }}</span>
                  <span v-if="isSupplier(selected)" class="sc-badge bg-cream text-cocoa">Supplier</span>
                  <span v-if="selected.is_blocked" class="sc-badge bg-danger/15 text-danger">Blocked</span>
                </div>
              </div>
            </div>

            <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <div class="rounded-md border border-honey/40 bg-honey/10 px-3 py-2">
                <p class="sc-label !mb-0">Receivable</p>
                <p class="m-0 text-[0.65rem] text-[var(--muted)]">They owe us</p>
                <p class="m-0 font-semibold text-honey">{{ money(totals.outstanding_balance) }}</p>
              </div>
              <div class="rounded-md border border-[var(--line)] px-3 py-2">
                <p class="sc-label !mb-0">Credit left</p>
                <p class="m-0 text-[0.65rem] text-[var(--muted)]">Limit {{ money(totals.credit_limit) }}</p>
                <p class="m-0 font-semibold">{{ money(totals.credit_remaining) }}</p>
              </div>
              <div
                v-if="isSupplier(selected)"
                class="rounded-md border border-[var(--line)] px-3 py-2"
              >
                <p class="sc-label !mb-0">Payable</p>
                <p class="m-0 text-[0.65rem] text-[var(--muted)]">We owe them (supplier)</p>
                <p class="m-0 font-semibold text-chocolate">{{ money(totals.payable_balance) }}</p>
              </div>
              <div class="rounded-md border border-[var(--line)] px-3 py-2">
                <p class="sc-label !mb-0">Billed</p>
                <p class="m-0 font-semibold text-chocolate">{{ money(totals.billed) }}</p>
              </div>
              <div class="rounded-md border border-[var(--line)] px-3 py-2">
                <p class="sc-label !mb-0">Paid on orders</p>
                <p class="m-0 font-semibold text-emerald-800">{{ money(totals.paid_on_orders) }}</p>
              </div>
              <div class="rounded-md border border-[var(--line)] px-3 py-2">
                <p class="sc-label !mb-0">Order due</p>
                <p class="m-0 font-semibold text-honey">{{ money(totals.order_due) }}</p>
              </div>
            </div>

            <div class="rounded-md bg-cream/60 px-3 py-2 text-sm">
              <p class="m-0 font-medium text-chocolate">Billing maths</p>
              <p class="m-0 mt-1 text-[var(--muted)]">
                Subtotal {{ money(totals.subtotal) }}
                + GST {{ money(totals.gst) }}
                = Billed {{ money(totals.billed) }}
              </p>
              <p class="m-0 text-[var(--muted)]">
                Paid {{ money(totals.paid_on_orders) }}
                · Due on invoices {{ money(totals.order_due) }}
                · Ledger collections {{ money(totals.ledger_collections) }}
              </p>
              <p class="m-0 text-[var(--muted)]">
                Net {{ money(totals.net_position) }}
                = Payable − Receivable (positive = we owe them more)
              </p>
            </div>

            <dl class="grid gap-0 text-sm">
              <div class="flex justify-between gap-3 border-b border-[var(--line)] py-2">
                <dt class="text-[var(--muted)]">Contact</dt>
                <dd class="m-0 font-medium tabular-nums">{{ shopContactPhone(selected as never) }}</dd>
              </div>
              <div class="flex justify-between gap-3 border-b border-[var(--line)] py-2">
                <dt class="text-[var(--muted)]">Login</dt>
                <dd class="m-0 max-w-[65%] truncate text-right">{{ shopLoginLabel(selected as never) }}</dd>
              </div>
              <div class="flex justify-between gap-3 border-b border-[var(--line)] py-2">
                <dt class="shrink-0 text-[var(--muted)]">Address</dt>
                <dd class="m-0 max-w-[70%] text-right leading-snug">
                  {{ addressFull(selected) }}
                </dd>
              </div>
              <div v-if="selected.gstin" class="flex justify-between gap-3 py-2">
                <dt class="text-[var(--muted)]">GSTIN</dt>
                <dd class="m-0">{{ selected.gstin }}</dd>
              </div>
            </dl>

            <div
              v-if="statusOf(selected) === 'pending' || statusOf(selected) === 'incomplete'"
              class="space-y-3 rounded-md border border-honey/40 bg-honey/10 p-3"
            >
              <p class="m-0 text-sm font-semibold text-cocoa">Activate shop</p>
              <label>
                <span class="sc-label">Credit limit ₹</span>
                <input v-model.number="approveForm.credit_limit" type="number" min="0" class="sc-input">
              </label>
              <label class="flex items-center gap-2 text-sm">
                <input v-model="approveForm.credit_allowed" type="checkbox" class="size-4">
                Allow credit (udhaar)
              </label>
              <div class="flex flex-wrap gap-2">
                <UButton type="button" :disabled="busy" @click="approve(selected)">Activate</UButton>
                <UButton type="button" color="neutral" variant="outline" :disabled="busy" @click="reject(selected)">Reject</UButton>
              </div>
            </div>

            <div v-else class="space-y-3 rounded-md border border-[var(--line)] p-3">
              <p class="m-0 text-sm font-semibold text-chocolate">Credit & access</p>
              <label>
                <span class="sc-label">Credit limit ₹</span>
                <input v-model.number="approveForm.credit_limit" type="number" min="0" class="sc-input">
              </label>
              <label class="flex items-center gap-2 text-sm">
                <input v-model="approveForm.credit_allowed" type="checkbox" class="size-4">
                Allow credit (udhaar)
              </label>
              <div class="flex flex-wrap gap-2">
                <UButton type="button" color="primary" variant="soft" :disabled="busy" @click="saveCredit">Save credit</UButton>
                <UButton
                  v-if="statusOf(selected) === 'rejected'"
                  type="button"
                  :disabled="busy"
                  @click="approve(selected)"
                >
                  Re-activate
                </UButton>
                <UButton type="button" color="primary" variant="soft" :disabled="busy" @click="toggleWholesaler">
                  {{ selected.is_wholesaler === false ? "Enable supplier" : "Disable supplier" }}
                </UButton>
                <UButton type="button" color="neutral" variant="outline" :disabled="busy" @click="toggleBlock">
                  {{ selected.is_blocked ? "Unblock" : "Block" }}
                </UButton>
              </div>
            </div>
          </template>

          <!-- ORDERS / INVOICES -->
          <template v-else-if="tab === 'orders'">
            <EmptyState
              v-if="!orders.length"
              title="No wholesale orders yet"
              body="When this shop buys from the bakery, invoices show here."
            />
            <ul v-else class="m-0 list-none space-y-3 p-0">
              <li
                v-for="o in orders"
                :key="String(o.order_id)"
                class="rounded-md border border-[var(--line)] p-3 text-sm"
              >
                <div class="flex items-start justify-between gap-2">
                  <div>
                    <p class="m-0 font-semibold text-chocolate">{{ o.invoice_number || o.order_number }}</p>
                    <p class="m-0 text-xs text-[var(--muted)]">{{ String(o.created_at || "").slice(0, 16) }} · {{ o.payment_method || "—" }}</p>
                  </div>
                  <span class="sc-badge capitalize" :class="payBadge(o.payment_status)">
                    {{ String(o.payment_status || "—").replace(/_/g, " ") }}
                  </span>
                </div>
                <div class="mt-2 grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <p class="sc-label !mb-0">Bill</p>
                    <p class="m-0 font-semibold">{{ money(Number(o.final_amount)) }}</p>
                  </div>
                  <div>
                    <p class="sc-label !mb-0">Paid</p>
                    <p class="m-0 font-semibold text-emerald-800">{{ money(Number(o.paid_amount)) }}</p>
                  </div>
                  <div>
                    <p class="sc-label !mb-0">Due</p>
                    <p class="m-0 font-semibold text-honey">{{ money(Number(o.due)) }}</p>
                  </div>
                </div>
                <p class="m-0 mt-1 text-xs text-[var(--muted)]">
                  Subtotal {{ money(Number(o.subtotal)) }} + GST {{ money(Number(o.gst_amount)) }}
                </p>
                <div class="mt-2 flex flex-wrap gap-2">
                  <UButton
                    v-if="Array.isArray(o.lines) && o.lines.length"
                    type="button"
                    size="xs"
                    color="neutral"
                    variant="soft"
                    :label="expandedOrderId === Number(o.order_id) ? 'Hide lines' : 'Lines'"
                    @click="toggleOrderLines(Number(o.order_id))"
                  />
                  <UButton
                    v-if="Number(o.due) > 0 || selectedDue > 0"
                    type="button"
                    size="xs"
                    color="primary"
                    variant="soft"
                    label="Collect due"
                    @click="collectDueFromOrder(o)"
                  />
                  <UButton
                    v-if="o.order_id"
                    :to="`/orders/${o.order_id}`"
                    size="xs"
                    color="neutral"
                    variant="outline"
                    label="Open order"
                  />
                </div>
                <ul
                  v-if="expandedOrderId === Number(o.order_id) && Array.isArray(o.lines)"
                  class="mt-2 space-y-0.5 border-t border-[var(--line)] pt-2 text-xs text-[var(--muted)]"
                >
                  <li v-for="(line, i) in (o.lines as Record<string, unknown>[])" :key="i">
                    · {{ line.product_name }} × {{ line.qty }} = {{ money(Number(line.line_total)) }}
                  </li>
                </ul>
              </li>
            </ul>
          </template>

          <!-- PAYMENTS -->
          <template v-else-if="tab === 'payments'">
            <div class="space-y-2 rounded-md border border-[var(--line)] p-3">
              <div class="flex items-center justify-between gap-2">
                <p class="m-0 font-semibold text-chocolate">Record collection</p>
                <p class="m-0 text-sm text-honey">Receivable {{ money(selectedDue) }}</p>
              </div>
              <div class="flex flex-wrap gap-2">
                <UButton type="button" size="xs" color="neutral" variant="soft" :disabled="selectedDue <= 0" @click="setCollectAmount(selectedDue)">
                  Full due
                </UButton>
                <UButton
                  type="button"
                  size="xs"
                  color="neutral"
                  variant="soft"
                  :disabled="selectedDue <= 0"
                  @click="setCollectAmount(Math.round(selectedDue * 0.8 * 100) / 100)"
                >
                  80%
                </UButton>
              </div>
              <label>
                <span class="sc-label">Amount ₹</span>
                <input v-model.number="collect.amount" type="number" min="0" step="0.01" class="sc-input">
              </label>
              <label>
                <span class="sc-label">Method</span>
                <select v-model="collect.method" class="sc-input">
                  <option value="upi">UPI</option>
                  <option value="cod">COD</option>
                  <option value="cash">Cash</option>
                </select>
              </label>
              <label>
                <span class="sc-label">Note</span>
                <input v-model="collect.note" class="sc-input" placeholder="Optional">
              </label>
              <UButton
                type="button"
                block
                :disabled="busy || !collect.amount || collect.amount <= 0 || selectedDue <= 0 || collect.amount > selectedDue + 0.01"
                @click="collectPay"
              >
                Record collection
              </UButton>
            </div>

            <div>
              <p class="m-0 mb-2 text-sm font-semibold text-chocolate">
                Ledger
                <span class="font-normal text-[var(--muted)]">
                  · collections {{ money(totals.ledger_collections) }}
                  · debits {{ money(totals.ledger_debits) }}
                </span>
              </p>
              <ul class="m-0 max-h-72 list-none space-y-0 overflow-y-auto p-0 text-sm">
                <li
                  v-for="(e, i) in ledger"
                  :key="String(e.id || i)"
                  class="flex items-start justify-between gap-3 border-b border-[var(--line)] py-2"
                >
                  <div class="min-w-0">
                    <p class="m-0 font-medium">{{ entryLabel(e) }}</p>
                    <p v-if="e.note" class="m-0 truncate text-xs text-[var(--muted)]">{{ e.note }}</p>
                    <p class="m-0 text-xs text-[var(--muted)]">{{ String(e.created_at || "").slice(0, 16) }}</p>
                  </div>
                  <div class="shrink-0 text-right">
                    <p
                      class="m-0 font-semibold"
                      :class="String(e.entry_type).toLowerCase() === 'credit' ? 'text-emerald-700' : 'text-honey'"
                    >
                      {{ String(e.entry_type).toLowerCase() === 'credit' ? '−' : '+' }}{{ money(Number(e.amount)) }}
                    </p>
                    <p class="m-0 text-xs text-[var(--muted)]">Bal {{ money(Number(e.balance_after)) }}</p>
                  </div>
                </li>
                <li v-if="!ledger.length" class="py-3 text-[var(--muted)]">No payments or ledger entries yet.</li>
              </ul>
            </div>
          </template>

          <!-- SUPPLIER POs -->
          <template v-else-if="tab === 'supplier'">
            <div class="mb-3 flex flex-wrap gap-2">
              <UButton
                v-if="selected"
                :to="`/purchases?supplier_user_id=${shopId(selected)}`"
                size="xs"
                color="primary"
                variant="soft"
                label="New purchase"
              />
              <UButton
                v-if="selected"
                :to="`/purchases?supplier_user_id=${shopId(selected)}`"
                size="xs"
                color="neutral"
                variant="outline"
                label="Open purchases"
              />
            </div>

            <div v-if="supplierPay" class="mb-3 space-y-2 rounded-md border border-[var(--line)] p-3">
              <p class="m-0 font-semibold text-chocolate">
                Pay {{ supplierPay.bill_no || `SP-${supplierPay.id}` }}
              </p>
              <p class="m-0 text-xs text-[var(--muted)]">
                Total {{ money(Number(supplierPay.total)) }}
                · paid {{ money(Number(supplierPay.paid_amount || 0)) }}
                · due {{ money(Number(supplierPay.due)) }}
              </p>
              <label>
                <span class="sc-label">Amount ₹</span>
                <input v-model.number="supplierPayForm.amount" type="number" min="0.01" step="0.01" class="sc-input">
              </label>
              <label>
                <span class="sc-label">Method</span>
                <select v-model="supplierPayForm.pay_method" class="sc-input">
                  <option value="razorpay">Razorpay</option>
                  <option value="upi">UPI (record)</option>
                  <option value="cod">COD</option>
                  <option value="cash">Cash</option>
                </select>
              </label>
              <label>
                <span class="sc-label">Note</span>
                <input v-model="supplierPayForm.note" class="sc-input" placeholder="Optional">
              </label>
              <div class="flex gap-2">
                <UButton type="button" size="sm" :disabled="busy || !supplierPayForm.amount" @click="confirmSupplierPay">
                  {{ supplierPayForm.pay_method === "razorpay" ? "Pay with Razorpay" : "Record payment" }}
                </UButton>
                <UButton type="button" size="sm" color="neutral" variant="outline" @click="supplierPay = null">
                  Cancel
                </UButton>
              </div>
            </div>

            <EmptyState
              v-if="!supplierBills.length"
              title="No purchase orders yet"
              body="Create a PO under Buy from shops for this supplier."
            />
            <ul v-else class="m-0 list-none space-y-2 p-0 text-sm">
              <li
                v-for="b in supplierBills"
                :key="String(b.id)"
                class="rounded-md border border-[var(--line)] px-3 py-2"
              >
                <div class="flex items-start justify-between gap-3">
                  <div>
                    <p class="m-0 font-semibold">{{ b.bill_no || `SP-${b.id}` }}</p>
                    <p class="m-0 text-xs text-[var(--muted)]">{{ b.product_name }} × {{ b.qty }}</p>
                    <p class="m-0 text-xs capitalize text-[var(--muted)]">{{ b.status }} · {{ String(b.payment_status || "").replace(/_/g, " ") }}</p>
                  </div>
                  <div class="text-right">
                    <p class="m-0 font-semibold">{{ money(Number(b.total)) }}</p>
                    <p class="m-0 text-xs text-honey">Due {{ money(Number(b.due)) }}</p>
                  </div>
                </div>
                <div class="mt-2 flex justify-end">
                  <UButton
                    v-if="canPaySupplier(b)"
                    type="button"
                    size="xs"
                    color="primary"
                    variant="soft"
                    label="Pay due"
                    :disabled="busy"
                    @click="openSupplierPay(b)"
                  />
                </div>
              </li>
            </ul>
          </template>
        </div>
      </template>
    </USlideover>
  </div>
</template>

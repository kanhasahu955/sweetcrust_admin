<script setup lang="ts">
import dayjs from "dayjs"
import { useAppToast } from "~/composables/useAppToast"
import {
  formatDateTime12,
  formatTime12,
  money,
  relativeAgo,
  shopContactPhone,
  shopLoginLabel,
} from "~/utils/format"
import { patchListRow, upsertListRow } from "~/utils/list"
import { takeShopDraft, type ShopPlaceDraft } from "~/utils/shopDraft"

const api = useApi()
const route = useRoute()
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
const search = ref("")
const PAGE_SIZE = 12
const visibleCount = ref(PAGE_SIZE)
const loadMoreEl = ref<HTMLElement | null>(null)
let loadMoreObs: IntersectionObserver | null = null
const detailOpen = ref(false)
const tab = ref<"overview" | "catalog" | "orders" | "payments" | "supplier">("overview")
const catalogSection = ref<"products" | "offers" | "banners" | "sales">("products")
const catalogLoading = ref(false)
const catalog = ref<{
  products?: Record<string, unknown>[]
  banners?: Record<string, unknown>[]
  coupons?: Record<string, unknown>[]
  sales?: Record<string, unknown>[]
  counts?: Record<string, number>
} | null>(null)
const expandedProductId = ref<number | null>(null)
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
  city: "Berhampur",
  pincode: "",
  latitude: null as number | null,
  longitude: null as number | null,
})
const busy = ref(false)
const socketLive = useState("adminSocketLive", () => false)

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
  let rows = filter.value === "all"
    ? [...shops.value]
    : shops.value.filter((s) => statusOf(s) === filter.value)
  const q = search.value.trim().toLowerCase()
  if (q) {
    rows = rows.filter((s) => {
      const blob = [
        s.shop_name,
        s.name,
        s.owner_name,
        s.phone,
        s.contact_phone,
        s.email,
        s.city,
        s.village,
        s.address_line,
        s.address_display,
      ]
        .map((x) => String(x || "").toLowerCase())
        .join(" ")
      return blob.includes(q)
    })
  }
  return rows.sort((a, b) => {
    const ra = STATUS_RANK[statusOf(a)] ?? 9
    const rb = STATUS_RANK[statusOf(b)] ?? 9
    if (ra !== rb) return ra - rb
    return String(a.shop_name || "").localeCompare(String(b.shop_name || ""))
  })
})

const visibleShops = computed(() => filtered.value.slice(0, visibleCount.value))
const hasMore = computed(() => visibleCount.value < filtered.value.length)

watch([filter, search], () => {
  visibleCount.value = PAGE_SIZE
})

watch(
  () => shops.value.length,
  () => {
    if (visibleCount.value < PAGE_SIZE) visibleCount.value = PAGE_SIZE
  },
)

function loadMore() {
  if (!hasMore.value) return
  visibleCount.value = Math.min(visibleCount.value + PAGE_SIZE, filtered.value.length)
}

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

const catalogCounts = computed(() => catalog.value?.counts || {})
const catalogProducts = computed(() =>
  Array.isArray(catalog.value?.products) ? catalog.value!.products! : [],
)
const catalogCoupons = computed(() =>
  Array.isArray(catalog.value?.coupons) ? catalog.value!.coupons! : [],
)
const catalogBanners = computed(() =>
  Array.isArray(catalog.value?.banners) ? catalog.value!.banners! : [],
)
const catalogSales = computed(() =>
  Array.isArray(catalog.value?.sales) ? catalog.value!.sales! : [],
)

const drawerTabs = computed(() => {
  const pc = Number(catalogCounts.value.products ?? 0)
  const tabs: { key: typeof tab.value; label: string }[] = [
    { key: "overview", label: "Account" },
    { key: "catalog", label: pc ? `Catalog (${pc})` : "Catalog" },
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
  if (status === "pending") return "bg-[#ffe8ec] text-chocolate"
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
  return "bg-[#ffe8ec] text-chocolate"
}
function shopId(s: Record<string, unknown>) {
  return Number(s.user_id || s.id)
}
function saleOrder(row: Record<string, unknown>) {
  const o = row.order
  return o && typeof o === "object" ? (o as Record<string, unknown>) : {}
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

function shopInitials(s: Record<string, unknown>) {
  const n = String(s.shop_name || s.name || "S").trim()
  const parts = n.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return `${parts[0]![0]}${parts[1]![0]}`.toUpperCase()
  return n.slice(0, 2).toUpperCase()
}

function shopEmail(s: Record<string, unknown>) {
  const e = String(s.email || "").trim()
  return e || "—"
}

function shopHours(s: Record<string, unknown>) {
  return `${formatTime12(String(s.shop_open_time || "09:00").slice(0, 5))} – ${formatTime12(String(s.shop_close_time || "21:00").slice(0, 5))}`
}

function shopZoneLine(s: Record<string, unknown>) {
  return [s.zone, s.city, s.pincode].filter(Boolean).map(String).join(" · ") || "—"
}

function sellLabel(s: Record<string, unknown>) {
  const st = String(s.sell_subscription_status || "none").toLowerCase()
  if (st === "active") return "Sell on"
  if (st === "trial") return "Sell trial"
  if (st === "paused") return "Sell paused"
  return "Sell off"
}

function lastSeenAt(s: Record<string, unknown>) {
  const raw = s.last_seen_at
  if (!raw) return null
  const d = dayjs(String(raw))
  return d.isValid() ? d : null
}

/** Short line for cards */
function lastSeenLabel(s: Record<string, unknown>) {
  if (s.is_online) return "Online now"
  const d = lastSeenAt(s)
  if (!d) return "Never logged in"
  return `Last seen ${relativeAgo(d)}`
}

/** Full date/time for tooltip + detail (12-hour clock) */
function lastSeenFull(s: Record<string, unknown>) {
  if (s.is_online) {
    const d = lastSeenAt(s)
    return d ? `Online now · ${formatDateTime12(d)}` : "Online now"
  }
  const d = lastSeenAt(s)
  if (!d) return "Never logged in"
  return `${formatDateTime12(d)} · ${relativeAgo(d)}`
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
    city: "Berhampur",
    pincode: "",
    latitude: null,
    longitude: null,
  })
  showPassword.value = false
}

function applyPlaceDraft(d: ShopPlaceDraft) {
  if (d.shop_name) form.shop_name = d.shop_name
  if (d.address_line) form.address_line = d.address_line
  if (d.village) form.village = d.village
  if (d.zone) form.zone = d.zone
  if (d.city) form.city = d.city
  if (d.pincode) form.pincode = d.pincode
  if (d.latitude != null && Number.isFinite(Number(d.latitude))) form.latitude = Number(d.latitude)
  if (d.longitude != null && Number.isFinite(Number(d.longitude))) form.longitude = Number(d.longitude)
  if (d.phone && !form.phone) form.phone = d.phone
  if (d.contact_phone) form.contact_phone = d.contact_phone
  else if (d.phone) form.contact_phone = d.phone
  showCreate.value = true
}

function hasGps(s: Record<string, unknown>) {
  const lat = Number(s.latitude)
  const lng = Number(s.longitude)
  return Number.isFinite(lat) && Number.isFinite(lng) && !(Math.abs(lat) < 0.05 && Math.abs(lng) < 0.05)
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

async function loadCatalog(id: number) {
  catalogLoading.value = true
  try {
    catalog.value = await api.admin.shopCatalog(id)
  } catch (e) {
    error.value = apiError(e)
    catalog.value = null
  } finally {
    catalogLoading.value = false
  }
}

async function setDrawerTab(next: typeof tab.value) {
  tab.value = next
  if (next === "catalog" && selected.value) {
    await loadCatalog(shopId(selected.value))
  }
}

async function toggleShopProduct(p: Record<string, unknown>, is_active: boolean) {
  const id = Number(p.id)
  if (!id || !selected.value) return
  busy.value = true
  try {
    await api.admin.updateProduct(id, { is_active })
    toast.success(is_active ? "Product activated" : "Product deactivated")
    await loadCatalog(shopId(selected.value))
  } catch (e) {
    toast.error("Update failed", apiError(e))
  } finally {
    busy.value = false
  }
}

async function deleteShopProduct(p: Record<string, unknown>) {
  const id = Number(p.id)
  if (!id || !selected.value) return
  const okDel = await confirm({
    title: "Delete product",
    message: `Remove “${p.name || id}” from this shop catalog?`,
    confirmText: "Delete",
    tone: "danger",
  })
  if (!okDel) return
  busy.value = true
  try {
    await api.admin.deleteProduct(id)
    toast.success("Product deleted")
    expandedProductId.value = null
    await loadCatalog(shopId(selected.value))
  } catch (e) {
    toast.error("Delete failed", apiError(e))
  } finally {
    busy.value = false
  }
}

async function toggleShopBanner(b: Record<string, unknown>, is_active: boolean) {
  const id = Number(b.id)
  if (!id || !selected.value) return
  busy.value = true
  try {
    await api.admin.shopBannerActive(shopId(selected.value), id, is_active)
    toast.success(is_active ? "Banner on" : "Banner off")
    await loadCatalog(shopId(selected.value))
  } catch (e) {
    toast.error("Update failed", apiError(e))
  } finally {
    busy.value = false
  }
}

async function toggleShopCoupon(c: Record<string, unknown>, is_active: boolean) {
  const id = Number(c.id)
  if (!id || !selected.value) return
  busy.value = true
  try {
    await api.admin.shopCouponActive(shopId(selected.value), id, is_active)
    toast.success(is_active ? "Offer on" : "Offer off")
    await loadCatalog(shopId(selected.value))
  } catch (e) {
    toast.error("Update failed", apiError(e))
  } finally {
    busy.value = false
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
    const lat = form.latitude != null && form.latitude !== ("" as never) ? Number(form.latitude) : null
    const lng = form.longitude != null && form.longitude !== ("" as never) ? Number(form.longitude) : null
    const res = (await api.admin.createShop({
      shop_name: form.shop_name.trim(),
      owner_name: form.owner_name.trim(),
      phone: form.phone,
      password: form.password,
      contact_phone: form.contact_phone || form.phone,
      address_line: form.address_line || undefined,
      village: form.village || undefined,
      zone: form.zone || undefined,
      city: form.city || "Berhampur",
      pincode: form.pincode || undefined,
      latitude: Number.isFinite(lat as number) ? lat : undefined,
      longitude: Number.isFinite(lng as number) ? lng : undefined,
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
  catalogSection.value = "products"
  catalog.value = null
  expandedProductId.value = null
  approveForm.credit_allowed = s.credit_allowed !== false
  approveForm.credit_limit = Number(s.credit_limit) || 25000
  collect.amount = Number(s.outstanding_balance) > 0 ? Number(s.outstanding_balance) : 0
  collect.note = ""
  await loadAccount(shopId(s))
  // Prefetch catalog so the Catalog tab has counts ready
  void loadCatalog(shopId(s))
}

function setCollectAmount(n: number) {
  collect.amount = Math.round(Math.max(0, n) * 100) / 100
}

async function approve(s: Record<string, unknown>) {
  busy.value = true
  error.value = ""
  try {
    const id = shopId(s)
    await api.admin.approveShop(id, {})
    toast.success("Shop activated")
    patchListRow(shops, id, { approval_status: "approved" }, "user_id")
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

function sellSubOf(s: Record<string, unknown>) {
  return String(s.sell_subscription_status || "none")
}

async function setSellSub(s: Record<string, unknown>, status: string) {
  busy.value = true
  error.value = ""
  try {
    const id = shopId(s)
    await api.admin.setSellSubscription(id, status)
    toast.success(`Sell subscription → ${status}`)
    patchListRow(shops, id, { sell_subscription_status: status }, "user_id")
    await load({ quiet: true })
    const row = shops.value.find((x) => shopId(x) === id)
    if (row) await openShop(row)
  } catch (e) {
    error.value = apiError(e)
    toast.error("Sell subscription update failed", apiError(e))
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
  if (kind === "shop_hours_closed" && data.user_id != null) {
    const uid = Number(data.user_id)
    patchListRow(shops, uid, { is_open: false }, "user_id")
    if (selected.value && shopId(selected.value) === uid) {
      selected.value = { ...selected.value, is_open: false }
    }
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

const onUserPresence = (data: Record<string, unknown>) => {
  const uid = Number(data?.user_id)
  if (!Number.isFinite(uid) || uid <= 0) return
  const online = Boolean(data?.online ?? data?.is_online)
  const idx = shops.value.findIndex((s) => shopId(s) === uid)
  if (idx < 0) return
  const patch: Record<string, unknown> = {
    is_online: online,
    last_seen_at: data.last_seen_at || new Date().toISOString(),
  }
  patchListRow(shops, uid, patch, "user_id")
  if (selected.value && shopId(selected.value) === uid) {
    selected.value = { ...selected.value, ...patch }
  }
}

onMounted(() => {
  void load()
  const draft = takeShopDraft()
  if (draft) applyPlaceDraft(draft)
  else if (route.query.create === "1" || route.query.map === "1") showCreate.value = true
  liveSocket = connect()
  liveSocket?.on("admin_event", onAdminEvent)
  liveSocket?.on("user_presence", onUserPresence)
  pollId = window.setInterval(() => {
    if (document.visibilityState === "visible") void load({ quiet: true })
  }, 12000)

  loadMoreObs = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) loadMore()
    },
    { root: null, rootMargin: "240px 0px", threshold: 0 },
  )
  watch(
    loadMoreEl,
    (el, prev) => {
      if (prev) loadMoreObs?.unobserve(prev)
      if (el) loadMoreObs?.observe(el)
    },
    { flush: "post" },
  )
})
onBeforeUnmount(() => {
  liveSocket?.off("admin_event", onAdminEvent)
  liveSocket?.off("user_presence", onUserPresence)
  if (pollId) window.clearInterval(pollId)
  loadMoreObs?.disconnect()
  loadMoreObs = null
})
</script>

<template>
  <div>
    <div class="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <p class="m-0 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-[#e9748e]">B2B</p>
        <h1 class="font-display m-0 mt-1 text-2xl text-chocolate sm:text-3xl">Shops</h1>
        <p class="m-0 mt-1 text-sm text-[var(--muted)]">
          {{ shops.length }} shops
          <span v-if="pendingCount + incompleteCount"> · {{ pendingCount + incompleteCount }} need action</span>
          <span> · Receivable {{ money(theyOweTotal) }}</span>
          <span> · Payable {{ money(weOweTotal) }}</span>
          <span
            class="ml-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.65rem] font-semibold"
            :class="socketLive ? 'bg-[#e8f6ee] text-[#2e7d4f]' : 'bg-[#f8ede6] text-[var(--muted)]'"
          >
            <span class="size-1.5 rounded-full" :class="socketLive ? 'animate-pulse bg-success' : 'bg-[#c4a39a]'" />
            {{ socketLive ? "Live" : "Polling" }}
          </span>
        </p>
      </div>
      <div class="flex flex-wrap gap-2">
        <UButton type="button" color="primary" variant="soft" icon="i-lucide-refresh-cw" label="Refresh" @click="load()" />
        <UButton
          type="button"
          color="secondary"
          :icon="showCreate ? 'i-lucide-x' : 'i-lucide-plus'"
          :label="showCreate ? 'Cancel' : 'Add shop'"
          @click="showCreate = !showCreate; if (!showCreate) resetCreateForm()"
        />
        <UButton to="/routing" color="secondary" variant="outline" icon="i-lucide-map" label="Map" />
      </div>
    </div>

    <div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <label class="relative block w-full max-w-md">
        <UIcon name="i-lucide-search" class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--muted)]" />
        <input
          v-model="search"
          class="sc-input w-full !rounded-xl !py-2.5 !pl-9"
          placeholder="Search shop, phone, city…"
        >
      </label>
      <div class="flex flex-wrap gap-1.5">
        <button
          v-for="f in filterChips"
          :key="f.value"
          type="button"
          class="rounded-full px-3 py-1.5 text-xs font-semibold transition"
          :class="filter === f.value ? 'bg-chocolate text-cream' : 'bg-white text-chocolate ring-1 ring-[var(--line)] hover:bg-[#fff0f2]'"
          @click="filter = f.value"
        >
          {{ f.label }} ({{ filterCount(f.value) }})
        </button>
      </div>
    </div>

    <p v-if="error" class="mb-3 text-sm text-danger">{{ error }}</p>
    <p v-if="info" class="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{{ info }}</p>

    <div
      v-if="createdCreds"
      class="mb-4 rounded-lg border border-[#e9748e]/40 bg-[#fff0f2] px-4 py-3 text-sm"
    >
      <div class="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p class="m-0 font-semibold text-chocolate">Login (shown once)</p>
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

    <div
      v-if="showCreate"
      class="mb-4 overflow-hidden rounded-2xl border border-[var(--line)] bg-white shadow-[0_8px_22px_-18px_rgba(74,44,42,0.4)]"
    >
      <div class="border-b border-[var(--line)] bg-[#fff9f5] px-4 py-3">
        <p class="font-display m-0 text-lg text-chocolate">New shop</p>
        <p class="m-0 mt-0.5 text-xs text-[var(--muted)]">Pick on Google Map — name & address fill in</p>
      </div>
      <div class="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
        <div class="sm:col-span-2 lg:col-span-3">
          <ClientOnly>
            <ShopsPlacePicker @filled="applyPlaceDraft" />
          </ClientOnly>
        </div>
        <label><span class="sc-label">Shop name</span><input v-model="form.shop_name" class="sc-input !rounded-xl" required></label>
        <label><span class="sc-label">Owner</span><input v-model="form.owner_name" class="sc-input !rounded-xl" required></label>
        <label><span class="sc-label">Login phone</span><input v-model="form.phone" class="sc-input !rounded-xl" placeholder="+91…" required></label>
        <label><span class="sc-label">WhatsApp / contact</span><input v-model="form.contact_phone" class="sc-input !rounded-xl"></label>
        <div class="sm:col-span-2">
          <span class="sc-label">Password</span>
          <div class="flex flex-wrap gap-2">
            <input
              v-model="form.password"
              :type="showPassword ? 'text' : 'password'"
              class="sc-input min-w-[12rem] flex-1 !rounded-xl font-mono"
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
          <p class="m-0 mt-1 text-xs text-[var(--muted)]">Min 6 characters</p>
        </div>
        <label class="sm:col-span-2 lg:col-span-3">
          <span class="sc-label">Address</span>
          <input v-model="form.address_line" class="sc-input !rounded-xl" placeholder="e.g. Near School Chhak">
        </label>
        <label>
          <span class="sc-label">Locality</span>
          <input v-model="form.village" class="sc-input !rounded-xl" placeholder="Area / locality">
        </label>
        <label><span class="sc-label">Zone</span><input v-model="form.zone" class="sc-input !rounded-xl"></label>
        <label><span class="sc-label">City</span><input v-model="form.city" class="sc-input !rounded-xl"></label>
        <label><span class="sc-label">Pincode</span><input v-model="form.pincode" class="sc-input !rounded-xl"></label>
        <label>
          <span class="sc-label">Latitude</span>
          <input v-model.number="form.latitude" type="number" step="any" class="sc-input !rounded-xl" placeholder="19.31…" readonly>
        </label>
        <label>
          <span class="sc-label">Longitude</span>
          <input v-model.number="form.longitude" type="number" step="any" class="sc-input !rounded-xl" placeholder="84.79…" readonly>
        </label>
        <div class="flex flex-wrap items-end gap-2 sm:col-span-2 lg:col-span-3">
          <UButton
            type="button"
            color="secondary"
            :loading="busy"
            :disabled="busy || !form.shop_name || !form.owner_name || !form.phone || form.password.length < 6"
            label="Create shop"
            @click="createShop"
          />
          <p class="m-0 text-xs text-[var(--muted)]">
            <span v-if="form.latitude != null && form.longitude != null" class="font-semibold text-[#2e7d4f]">GPS set</span>
            <span v-else class="text-[#e9748e]">Pick on map for GPS</span>
          </p>
        </div>
      </div>
    </div>

    <div v-if="loading" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      <div v-for="n in 8" :key="n" class="sc-skeleton h-56 rounded-xl" />
    </div>

    <div
      v-else-if="!filtered.length"
      class="rounded-2xl border border-dashed border-[var(--line)] bg-white px-6 py-16 text-center"
    >
      <UIcon name="i-lucide-store" class="mx-auto size-10 text-[#e8d0c6]" />
      <p class="mt-3 font-display text-xl text-chocolate">No shops</p>
      <p class="mt-1 text-sm text-[var(--muted)]">Add a shop, or wait for a retailer signup.</p>
    </div>

    <template v-else>
      <p class="mb-2 text-xs text-[var(--muted)]">
        Showing {{ visibleShops.length }} of {{ filtered.length }}
      </p>
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <article
          v-for="s in visibleShops"
          :key="String(shopId(s))"
          class="shop-card relative flex flex-col rounded-xl border border-[var(--line)] bg-white p-3.5 shadow-[0_8px_22px_-18px_rgba(74,44,42,0.4)] transition hover:-translate-y-0.5 hover:border-[#f2a7ad]/70 hover:shadow-[0_14px_32px_-20px_rgba(74,44,42,0.45)]"
          :class="isSelected(s) ? 'ring-2 ring-[#e9748e]/40' : ''"
        >
          <button
            type="button"
            class="absolute right-2 top-2 grid size-7 place-items-center rounded-lg bg-[#fff9f5] text-chocolate ring-1 ring-[var(--line)] transition hover:bg-[#fff0f2] hover:text-[#e9748e]"
            title="Open shop"
            @click="openShop(s)"
          >
            <UIcon name="i-lucide-pencil" class="size-3.5" />
          </button>

          <div class="flex items-start gap-2.5 pr-8">
            <div class="relative shrink-0">
              <img
                v-if="s.shop_logo_url"
                :src="String(s.shop_logo_url)"
                alt=""
                class="size-11 rounded-full object-cover ring-2 ring-[#fff0f2]"
              >
              <span
                v-else
                class="grid size-11 place-items-center rounded-full bg-gradient-to-br from-[#e9748e] to-[#c44d66] text-xs font-bold text-white ring-2 ring-[#fff0f2]"
              >
                {{ shopInitials(s) }}
              </span>
              <span
                class="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-white"
                :class="s.is_online ? 'bg-success' : 'bg-[#d4b8ae]'"
                :title="s.is_online ? 'Online' : 'Offline'"
              />
            </div>
            <div class="min-w-0 flex-1">
              <h2 class="m-0 truncate text-sm font-semibold text-chocolate">
                {{ s.shop_name || s.name || "—" }}
              </h2>
              <p class="m-0 truncate text-[0.7rem] text-[var(--muted)]">{{ s.owner_name || "Owner" }}</p>
              <div class="mt-1.5 flex flex-wrap gap-1">
                <span class="rounded-full px-1.5 py-0.5 text-[0.58rem] font-semibold" :class="badgeClass(statusOf(s))">
                  {{ statusLabel(statusOf(s)) }}
                </span>
                <span
                  class="rounded-full px-1.5 py-0.5 text-[0.58rem] font-semibold"
                  :class="s.is_open === false ? 'bg-[#f8ede6] text-[var(--muted)]' : 'bg-[#ffe8ec] text-chocolate'"
                >
                  {{ s.is_open === false ? "Closed" : "Open" }}
                </span>
                <span v-if="isSupplier(s)" class="rounded-full bg-[#f8ede6] px-1.5 py-0.5 text-[0.58rem] font-semibold text-chocolate">
                  Supplier
                </span>
                <span v-if="s.is_blocked" class="rounded-full bg-danger/15 px-1.5 py-0.5 text-[0.58rem] font-semibold text-danger">
                  Blocked
                </span>
                <span class="rounded-full bg-[#fff0f2] px-1.5 py-0.5 text-[0.58rem] font-semibold text-[#c44d66]">
                  {{ sellLabel(s) }}
                </span>
              </div>
            </div>
          </div>

          <div class="mt-3 grid grid-cols-3 gap-1 rounded-lg bg-[#fff9f5] px-2 py-2 text-center">
            <div>
              <p class="m-0 text-[0.55rem] uppercase tracking-wide text-[var(--muted)]">Recv</p>
              <p class="m-0 mt-0.5 text-[0.72rem] font-bold tabular-nums text-[#e9748e]">{{ money(Number(s.outstanding_balance)) }}</p>
            </div>
            <div>
              <p class="m-0 text-[0.55rem] uppercase tracking-wide text-[var(--muted)]">Pay</p>
              <p class="m-0 mt-0.5 text-[0.72rem] font-bold tabular-nums text-chocolate">
                {{ money(Number(s.payable_balance)) }}
              </p>
            </div>
            <div>
              <p class="m-0 text-[0.55rem] uppercase tracking-wide text-[var(--muted)]">Map</p>
              <p
                class="m-0 mt-0.5 text-[0.72rem] font-bold"
                :class="hasGps(s) ? 'text-[#2e7d4f]' : 'text-[var(--muted)]'"
              >
                {{ hasGps(s) ? "GPS" : "—" }}
              </p>
            </div>
          </div>

          <ul class="m-0 mt-2.5 list-none space-y-1.5 p-0 text-[0.72rem] text-[var(--muted)]">
            <li class="flex items-start gap-1.5">
              <UIcon name="i-lucide-map-pin" class="mt-0.5 size-3.5 shrink-0 text-[#e9748e]" />
              <span class="line-clamp-2 min-w-0 leading-snug" :title="addressFull(s)">{{ addressFull(s) }}</span>
            </li>
            <li class="flex items-center gap-1.5">
              <UIcon name="i-lucide-navigation" class="size-3.5 shrink-0 text-[#e9748e]" />
              <span class="truncate">{{ shopZoneLine(s) }}</span>
            </li>
            <li class="flex items-center gap-1.5">
              <UIcon name="i-lucide-phone" class="size-3.5 shrink-0 text-[#e9748e]" />
              <span class="truncate tabular-nums">{{ shopContactPhone(s as never) }}</span>
            </li>
            <li class="flex items-center gap-1.5">
              <UIcon name="i-lucide-mail" class="size-3.5 shrink-0 text-[#e9748e]" />
              <span class="truncate">{{ shopEmail(s) }}</span>
            </li>
            <li class="flex items-center gap-1.5">
              <UIcon name="i-lucide-clock" class="size-3.5 shrink-0 text-[#e9748e]" />
              <span>{{ shopHours(s) }}</span>
              <span v-if="s.gstin" class="truncate">· GST {{ s.gstin }}</span>
            </li>
            <li class="flex items-start gap-1.5" :title="lastSeenFull(s)">
              <UIcon name="i-lucide-log-in" class="mt-0.5 size-3.5 shrink-0 text-[#e9748e]" />
              <span class="min-w-0 leading-snug">
                <span :class="s.is_online ? 'font-semibold text-[#2e7d4f]' : ''">{{ lastSeenLabel(s) }}</span>
                <span v-if="lastSeenAt(s) && !s.is_online" class="mt-0.5 block text-[0.62rem] text-[var(--muted)]">
                  {{ formatDateTime12(lastSeenAt(s)) }}
                </span>
              </span>
            </li>
          </ul>

          <div class="mt-auto flex items-center justify-between gap-2 pt-3">
            <button
              type="button"
              class="rounded-lg bg-[#e9748e] px-2.5 py-1.5 text-[0.68rem] font-semibold text-white transition hover:bg-[#d45a78]"
              @click="openShop(s)"
            >
              View detail
            </button>
            <span class="truncate text-[0.6rem] text-[var(--muted)]" :title="String(shopLoginLabel(s as never))">
              {{ shopLoginLabel(s as never) }}
            </span>
          </div>
        </article>
      </div>

      <div ref="loadMoreEl" class="flex min-h-10 items-center justify-center py-4">
        <button
          v-if="hasMore"
          type="button"
          class="rounded-full bg-white px-4 py-1.5 text-xs font-semibold text-chocolate ring-1 ring-[var(--line)] transition hover:bg-[#fff0f2]"
          @click="loadMore"
        >
          Load more · {{ filtered.length - visibleShops.length }} left
        </button>
        <p v-else-if="filtered.length > PAGE_SIZE" class="m-0 text-xs text-[var(--muted)]">
          All {{ filtered.length }} shops loaded
        </p>
      </div>
    </template>

    <USlideover
      v-model:open="detailOpen"
      side="right"
      :title="drawerTitle"
      :description="drawerDesc"
      :ui="{ content: 'w-full max-w-xl sm:max-w-2xl bg-[#fffaf8]' }"
    >
      <template v-if="selected" #body>
        <div class="space-y-4 pb-6">
          <!-- Sticky-ish tab rail -->
          <div class="sticky top-0 z-10 -mx-1 rounded-xl bg-[#fffaf8]/95 px-1 py-1 backdrop-blur">
            <div class="flex flex-wrap gap-1 rounded-xl bg-[#f8ede6] p-1">
              <button
                v-for="t in drawerTabs"
                :key="t.key"
                type="button"
                class="rounded-lg px-3 py-2 text-xs font-semibold transition"
                :class="tab === t.key ? 'bg-chocolate text-cream shadow-sm' : 'text-chocolate/70 hover:bg-white/70 hover:text-chocolate'"
                @click="setDrawerTab(t.key)"
              >
                {{ t.label }}
              </button>
            </div>
            <div class="mt-2 flex flex-wrap items-center gap-2 px-0.5">
              <span
                class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.65rem] font-semibold"
                :class="selected.is_online ? 'bg-[#e8f6ee] text-[#2e7d4f]' : 'bg-white text-[var(--muted)] ring-1 ring-[var(--line)]'"
              >
                <span class="size-1.5 rounded-full" :class="selected.is_online ? 'bg-success' : 'bg-[#d4b8ae]'" />
                {{ selected.is_online ? "Online" : "Offline" }}
              </span>
              <span class="truncate text-[0.65rem] text-[var(--muted)]" :title="lastSeenFull(selected)">
                {{ lastSeenFull(selected) }}
              </span>
              <button
                type="button"
                class="ml-auto text-[0.65rem] font-semibold text-[#e9748e] hover:underline"
                :disabled="accountLoading || catalogLoading"
                @click="selected && (tab === 'catalog' ? loadCatalog(shopId(selected)) : loadAccount(shopId(selected)))"
              >
                Refresh
              </button>
            </div>
          </div>

          <p v-if="accountLoading && tab !== 'catalog'" class="text-sm text-[var(--muted)]">Loading account…</p>

          <!-- CATALOG -->
          <template v-else-if="tab === 'catalog'">
            <p v-if="catalogLoading" class="text-sm text-[var(--muted)]">Loading shop catalog…</p>
            <template v-else>
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div class="flex flex-wrap gap-1">
                  <button
                    v-for="s in [
                      { key: 'products' as const, label: `Products (${catalogCounts.products || 0})` },
                      { key: 'offers' as const, label: `Offers (${catalogCounts.coupons || 0})` },
                      { key: 'banners' as const, label: `Banners (${catalogCounts.banners || 0})` },
                      { key: 'sales' as const, label: `Sales (${catalogCounts.sales || 0})` },
                    ]"
                    :key="s.key"
                    type="button"
                    class="rounded-full px-2.5 py-1 text-[11px] font-semibold"
                    :class="catalogSection === s.key ? 'bg-[#ffe8ec] text-chocolate' : 'bg-cream text-[var(--muted)]'"
                    @click="catalogSection = s.key"
                  >
                    {{ s.label }}
                  </button>
                </div>
                <NuxtLink
                  class="text-xs font-semibold text-chocolate underline"
                  :to="`/products?supplier_user_id=${shopId(selected)}`"
                >
                  Open products
                </NuxtLink>
              </div>

              <!-- Products -->
              <template v-if="catalogSection === 'products'">
                <EmptyState
                  v-if="!catalogProducts.length"
                  title="No products"
                  body="When this shop adds sell products, they show up here."
                />
                <ul v-else class="m-0 list-none space-y-2.5 p-0">
                  <li
                    v-for="p in catalogProducts"
                    :key="String(p.id)"
                    class="rounded-2xl border border-[var(--line)] bg-white px-3 py-2.5 shadow-sm"
                  >
                    <button
                      type="button"
                      class="flex w-full items-start gap-3 text-left"
                      @click="expandedProductId = expandedProductId === Number(p.id) ? null : Number(p.id)"
                    >
                      <img
                        v-if="p.cover_image_url"
                        :src="String(p.cover_image_url)"
                        alt=""
                        class="h-14 w-14 shrink-0 rounded-md object-cover ring-1 ring-[var(--line)]"
                      >
                      <span
                        v-else
                        class="flex h-14 w-14 shrink-0 items-center justify-center rounded-md bg-cream text-xs text-[var(--muted)] ring-1 ring-[var(--line)]"
                      >
                        —
                      </span>
                      <div class="min-w-0 flex-1">
                        <p class="m-0 font-semibold text-chocolate">{{ p.name }}</p>
                        <p class="m-0 text-xs text-[var(--muted)]">
                          {{ money(Number(p.selling_price)) }} · stock {{ p.stock_qty ?? 0 }}
                          <span v-if="p.is_active === false"> · inactive</span>
                        </p>
                        <p v-if="p.short_description" class="m-0 mt-0.5 line-clamp-2 text-xs text-[var(--muted)]">
                          {{ p.short_description }}
                        </p>
                      </div>
                    </button>
                    <div v-if="expandedProductId === Number(p.id)" class="mt-2 space-y-2 border-t border-[var(--line)] pt-2">
                      <pre
                        v-if="p.description"
                        class="m-0 whitespace-pre-wrap font-sans text-xs leading-relaxed text-chocolate"
                      >{{ p.description }}</pre>
                      <p v-else class="m-0 text-xs text-[var(--muted)]">No details</p>
                      <p v-if="p.weight" class="m-0 text-xs text-[var(--muted)]">Weight · {{ p.weight }}</p>
                      <div class="flex flex-wrap gap-2">
                        <UButton
                          type="button"
                          size="xs"
                          color="neutral"
                          variant="outline"
                          :disabled="busy"
                          :label="p.is_active === false ? 'Activate' : 'Deactivate'"
                          @click="toggleShopProduct(p, p.is_active === false)"
                        />
                        <UButton
                          type="button"
                          size="xs"
                          color="error"
                          variant="soft"
                          label="Delete"
                          :disabled="busy"
                          @click="deleteShopProduct(p)"
                        />
                        <NuxtLink
                          class="inline-flex items-center rounded-md px-2 text-xs font-semibold text-chocolate underline"
                          :to="`/products?q=${encodeURIComponent(String(p.name || ''))}&supplier_user_id=${shopId(selected)}`"
                        >
                          Edit in Products
                        </NuxtLink>
                      </div>
                    </div>
                  </li>
                </ul>
              </template>

              <!-- Offers -->
              <template v-else-if="catalogSection === 'offers'">
                <EmptyState
                  v-if="!catalogCoupons.length"
                  title="No offers"
                  body="Shop coupons created from the retailer Sell tab appear here."
                />
                <ul v-else class="m-0 list-none space-y-2 p-0 text-sm">
                  <li
                    v-for="c in catalogCoupons"
                    :key="String(c.id)"
                    class="flex items-center justify-between gap-3 rounded-md border border-[var(--line)] px-3 py-2"
                  >
                    <div class="min-w-0">
                      <p class="m-0 font-semibold">{{ c.code }}</p>
                      <p class="m-0 text-xs text-[var(--muted)]">
                        {{ c.title }} · {{ c.value }}{{ c.coupon_type === 'percentage' ? '%' : '' }}
                        <span v-if="c.is_active === false"> · off</span>
                      </p>
                    </div>
                    <UButton
                      type="button"
                      size="xs"
                      color="neutral"
                      variant="outline"
                      :disabled="busy"
                      :label="c.is_active === false ? 'Activate' : 'Deactivate'"
                      @click="toggleShopCoupon(c, c.is_active === false)"
                    />
                  </li>
                </ul>
              </template>

              <!-- Banners -->
              <template v-else-if="catalogSection === 'banners'">
                <EmptyState
                  v-if="!catalogBanners.length"
                  title="No banners"
                  body="Shop banners from the retailer Sell tab appear here."
                />
                <ul v-else class="m-0 list-none space-y-2 p-0 text-sm">
                  <li
                    v-for="b in catalogBanners"
                    :key="String(b.id)"
                    class="flex items-center gap-3 rounded-md border border-[var(--line)] px-3 py-2"
                  >
                    <img
                      v-if="b.image_url"
                      :src="String(b.image_url)"
                      alt=""
                      class="h-12 w-16 shrink-0 rounded object-cover ring-1 ring-[var(--line)]"
                    >
                    <div class="min-w-0 flex-1">
                      <p class="m-0 font-semibold">{{ b.title }}</p>
                      <p v-if="b.subtitle" class="m-0 text-xs text-[var(--muted)]">{{ b.subtitle }}</p>
                    </div>
                    <UButton
                      type="button"
                      size="xs"
                      color="neutral"
                      variant="outline"
                      :disabled="busy"
                      :label="b.is_active === false ? 'Activate' : 'Deactivate'"
                      @click="toggleShopBanner(b, b.is_active === false)"
                    />
                  </li>
                </ul>
              </template>

              <!-- B2C Sales -->
              <template v-else>
                <EmptyState
                  v-if="!catalogSales.length"
                  title="No customer sales"
                  body="B2C orders for this shop show up here."
                />
                <ul v-else class="m-0 list-none space-y-2.5 p-0 text-sm">
                  <li
                    v-for="row in catalogSales"
                    :key="String(saleOrder(row).id || Math.random())"
                    class="rounded-2xl border border-[var(--line)] bg-white px-3.5 py-3 shadow-sm"
                  >
                    <div class="flex items-start justify-between gap-3">
                      <div class="min-w-0">
                        <p class="m-0 font-semibold text-chocolate">
                          {{ saleOrder(row).order_number || `#${saleOrder(row).id}` }}
                        </p>
                        <p class="m-0 mt-0.5 text-xs capitalize text-[var(--muted)]">
                          {{ String(saleOrder(row).status || "").replace(/_/g, " ") }}
                          · {{ String(saleOrder(row).payment_status || "").replace(/_/g, " ") }}
                        </p>
                        <p v-if="saleOrder(row).created_at" class="m-0 text-xs text-[var(--muted)]">
                          {{ formatDateTime12(saleOrder(row).created_at as string) }}
                        </p>
                      </div>
                      <div class="text-right">
                        <p class="m-0 font-bold tabular-nums text-chocolate">
                          {{ money(Number(saleOrder(row).final_amount)) }}
                        </p>
                        <UButton
                          v-if="saleOrder(row).id"
                          :to="`/orders/${saleOrder(row).id}`"
                          size="xs"
                          color="neutral"
                          variant="outline"
                          class="mt-1.5"
                          label="Open"
                        />
                      </div>
                    </div>
                  </li>
                </ul>
              </template>
            </template>
          </template>

          <!-- OVERVIEW -->
          <template v-else-if="tab === 'overview' && !accountLoading">
            <div class="rounded-2xl border border-[var(--line)] bg-white p-4 shadow-sm">
              <div class="flex items-start gap-3">
                <img
                  v-if="selected.shop_logo_url"
                  :src="String(selected.shop_logo_url)"
                  alt="Shop logo"
                  class="size-14 shrink-0 rounded-2xl object-cover ring-2 ring-[#fff0f2]"
                >
                <span
                  v-else
                  class="grid size-14 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-[#e9748e] to-[#c44d66] text-lg font-bold text-white"
                >
                  {{ shopInitials(selected) }}
                </span>
                <div class="min-w-0 flex-1">
                  <p class="m-0 text-lg font-semibold text-chocolate">{{ selected.shop_name || selected.name }}</p>
                  <p class="m-0 text-sm text-[var(--muted)]">{{ selected.owner_name || "—" }}</p>
                  <div class="mt-2 flex flex-wrap gap-1">
                    <span class="rounded-full px-2 py-0.5 text-[0.65rem] font-semibold" :class="badgeClass(statusOf(selected))">
                      {{ statusLabel(statusOf(selected)) }}
                    </span>
                    <span
                      class="rounded-full px-2 py-0.5 text-[0.65rem] font-semibold"
                      :class="selected.is_open === false ? 'bg-[#f8ede6] text-[var(--muted)]' : 'bg-[#ffe8ec] text-chocolate'"
                    >
                      {{ selected.is_open === false ? "Closed" : "Open" }}
                    </span>
                    <span v-if="isSupplier(selected)" class="rounded-full bg-[#f8ede6] px-2 py-0.5 text-[0.65rem] font-semibold text-chocolate">
                      Supplier
                    </span>
                    <span v-if="selected.is_blocked" class="rounded-full bg-danger/15 px-2 py-0.5 text-[0.65rem] font-semibold text-danger">
                      Blocked
                    </span>
                    <span class="rounded-full bg-[#fff0f2] px-2 py-0.5 text-[0.65rem] font-semibold text-[#c44d66]">
                      {{ sellLabel(selected) }}
                    </span>
                  </div>
                  <p class="m-0 mt-2 text-xs text-[var(--muted)]">
                    Hours {{ shopHours(selected) }}
                    <span v-if="selected.shop_days"> · {{ selected.shop_days }}</span>
                  </p>
                </div>
              </div>
              <div class="mt-3 flex flex-wrap gap-2 border-t border-[var(--line)] pt-3">
                <UButton to="/chats" size="xs" color="secondary" variant="soft" icon="i-lucide-messages-square" label="Open chat" />
                <UButton
                  size="xs"
                  color="neutral"
                  variant="outline"
                  icon="i-lucide-shopping-bag"
                  label="Orders"
                  @click="setDrawerTab('orders')"
                />
                <UButton
                  size="xs"
                  color="neutral"
                  variant="outline"
                  icon="i-lucide-wallet"
                  label="Collect"
                  @click="setDrawerTab('payments')"
                />
              </div>
            </div>

            <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <div class="rounded-xl border border-[#e9748e]/35 bg-[#fff0f2] px-3 py-2.5">
                <p class="m-0 text-[0.6rem] font-semibold uppercase tracking-wide text-[var(--muted)]">Receivable</p>
                <p class="m-0 text-[0.65rem] text-[var(--muted)]">They owe us</p>
                <p class="m-0 mt-1 text-base font-bold tabular-nums text-[#e9748e]">{{ money(totals.outstanding_balance) }}</p>
              </div>
              <div class="rounded-xl border border-[var(--line)] bg-white px-3 py-2.5">
                <p class="m-0 text-[0.6rem] font-semibold uppercase tracking-wide text-[var(--muted)]">Map pin</p>
                <p class="m-0 text-[0.65rem] text-[var(--muted)]">Routing GPS</p>
                <p
                  class="m-0 mt-1 text-base font-bold"
                  :class="hasGps(selected) ? 'text-[#2e7d4f]' : 'text-[#e9748e]'"
                >
                  {{ hasGps(selected) ? "On map" : "Missing" }}
                </p>
              </div>
              <div
                v-if="isSupplier(selected)"
                class="rounded-xl border border-[var(--line)] bg-white px-3 py-2.5"
              >
                <p class="m-0 text-[0.6rem] font-semibold uppercase tracking-wide text-[var(--muted)]">Payable</p>
                <p class="m-0 text-[0.65rem] text-[var(--muted)]">We owe them</p>
                <p class="m-0 mt-1 text-base font-bold tabular-nums text-chocolate">{{ money(totals.payable_balance) }}</p>
              </div>
              <div class="rounded-xl border border-[var(--line)] bg-white px-3 py-2.5">
                <p class="m-0 text-[0.6rem] font-semibold uppercase tracking-wide text-[var(--muted)]">Billed</p>
                <p class="m-0 mt-1 text-base font-bold tabular-nums text-chocolate">{{ money(totals.billed) }}</p>
              </div>
              <div class="rounded-xl border border-[var(--line)] bg-white px-3 py-2.5">
                <p class="m-0 text-[0.6rem] font-semibold uppercase tracking-wide text-[var(--muted)]">Paid on orders</p>
                <p class="m-0 mt-1 text-base font-bold tabular-nums text-emerald-800">{{ money(totals.paid_on_orders) }}</p>
              </div>
              <div class="rounded-xl border border-[var(--line)] bg-white px-3 py-2.5">
                <p class="m-0 text-[0.6rem] font-semibold uppercase tracking-wide text-[var(--muted)]">Order due</p>
                <p class="m-0 mt-1 text-base font-bold tabular-nums text-[#e9748e]">{{ money(totals.order_due) }}</p>
              </div>
            </div>

            <div class="rounded-xl border border-[var(--line)] bg-white px-3.5 py-3 text-sm">
              <p class="m-0 font-semibold text-chocolate">Billing maths</p>
              <p class="m-0 mt-1.5 text-xs leading-relaxed text-[var(--muted)]">
                Subtotal {{ money(totals.subtotal) }}
                + GST {{ money(totals.gst) }}
                = Billed {{ money(totals.billed) }}
              </p>
              <p class="m-0 text-xs leading-relaxed text-[var(--muted)]">
                Paid {{ money(totals.paid_on_orders) }}
                · Due on invoices {{ money(totals.order_due) }}
                · Ledger collections {{ money(totals.ledger_collections) }}
              </p>
              <p class="m-0 text-xs leading-relaxed text-[var(--muted)]">
                Net {{ money(totals.net_position) }}
                = Payable − Receivable
              </p>
            </div>

            <div class="overflow-hidden rounded-xl border border-[var(--line)] bg-white text-sm">
              <div class="flex justify-between gap-3 border-b border-[var(--line)] px-3.5 py-2.5">
                <span class="text-[var(--muted)]">Contact</span>
                <span class="font-medium tabular-nums text-chocolate">{{ shopContactPhone(selected as never) }}</span>
              </div>
              <div class="flex justify-between gap-3 border-b border-[var(--line)] px-3.5 py-2.5">
                <span class="text-[var(--muted)]">Login</span>
                <span class="max-w-[65%] truncate text-right font-medium text-chocolate">{{ shopLoginLabel(selected as never) }}</span>
              </div>
              <div class="flex justify-between gap-3 border-b border-[var(--line)] px-3.5 py-2.5">
                <span class="shrink-0 text-[var(--muted)]">Address</span>
                <span class="max-w-[70%] text-right leading-snug text-chocolate">{{ addressFull(selected) }}</span>
              </div>
              <div class="flex justify-between gap-3 border-b border-[var(--line)] px-3.5 py-2.5">
                <span class="text-[var(--muted)]">Zone / city</span>
                <span class="text-right text-chocolate">{{ shopZoneLine(selected) }}</span>
              </div>
              <div v-if="selected.gstin" class="flex justify-between gap-3 px-3.5 py-2.5">
                <span class="text-[var(--muted)]">GSTIN</span>
                <span class="font-medium text-chocolate">{{ selected.gstin }}</span>
              </div>
            </div>

            <div
              v-if="statusOf(selected) === 'pending' || statusOf(selected) === 'incomplete'"
              class="space-y-3 rounded-2xl border border-[#e9748e]/40 bg-[#fff0f2] p-4"
            >
              <p class="m-0 text-sm font-semibold text-chocolate">Activate shop</p>
              <p class="m-0 text-xs text-[var(--muted)]">Approve so they can sign in and place B2B orders.</p>
              <div class="flex flex-wrap gap-2">
                <UButton type="button" :disabled="busy" label="Activate" @click="approve(selected)" />
                <UButton type="button" color="neutral" variant="outline" :disabled="busy" label="Reject" @click="reject(selected)" />
              </div>
            </div>

            <div
              v-if="statusOf(selected) === 'approved'"
              class="space-y-3 rounded-2xl border border-[#e9748e]/40 bg-[#fff0f2] p-4"
            >
              <p class="m-0 text-sm font-semibold text-chocolate">
                Sell subscription:
                <span class="font-normal">{{ sellSubOf(selected) }}</span>
              </p>
              <p class="m-0 text-xs text-[var(--muted)]">
                Lets the shop add categories, products, banners and coupons for their customers.
              </p>
              <div class="flex flex-wrap gap-2">
                <UButton
                  type="button"
                  :disabled="busy || sellSubOf(selected) === 'approved'"
                  @click="setSellSub(selected, 'approved')"
                >
                  Approve sell
                </UButton>
                <UButton
                  type="button"
                  color="neutral"
                  variant="outline"
                  :disabled="busy || sellSubOf(selected) === 'rejected'"
                  @click="setSellSub(selected, 'rejected')"
                >
                  Reject sell
                </UButton>
                <UButton
                  v-if="sellSubOf(selected) === 'pending'"
                  type="button"
                  color="primary"
                  variant="soft"
                  :disabled="busy"
                  @click="setSellSub(selected, 'none')"
                >
                  Clear request
                </UButton>
              </div>
            </div>

            <div v-if="statusOf(selected) === 'approved' || statusOf(selected) === 'rejected'" class="space-y-3 rounded-2xl border border-[var(--line)] bg-white p-4 shadow-sm">
              <p class="m-0 text-sm font-semibold text-chocolate">Access</p>
              <p class="m-0 text-xs text-[var(--muted)]">
                Supplier flag · block login · map pin
                <span v-if="hasGps(selected)" class="text-[#2e7d4f]"> · GPS set</span>
                <span v-else class="text-[#e9748e]"> · no GPS</span>
              </p>
              <div class="flex flex-wrap gap-2">
                <UButton
                  v-if="statusOf(selected) === 'rejected'"
                  type="button"
                  :disabled="busy"
                  label="Re-activate"
                  @click="approve(selected)"
                />
                <UButton type="button" color="primary" variant="soft" :disabled="busy" @click="toggleWholesaler">
                  {{ selected.is_wholesaler === false ? "Enable supplier" : "Disable supplier" }}
                </UButton>
                <UButton type="button" color="neutral" variant="outline" :disabled="busy" @click="toggleBlock">
                  {{ selected.is_blocked ? "Unblock" : "Block" }}
                </UButton>
                <UButton
                  to="/routing"
                  color="secondary"
                  variant="outline"
                  size="sm"
                  icon="i-lucide-map"
                  label="Open map"
                />
              </div>
            </div>
          </template>

          <!-- ORDERS / INVOICES -->
          <template v-else-if="tab === 'orders'">
            <div class="flex items-center justify-between gap-2">
              <p class="m-0 text-sm font-semibold text-chocolate">
                Wholesale orders
                <span class="font-normal text-[var(--muted)]">· {{ orders.length }}</span>
              </p>
              <UButton
                v-if="selectedDue > 0"
                size="xs"
                color="secondary"
                label="Collect receivable"
                @click="setDrawerTab('payments')"
              />
            </div>
            <EmptyState
              v-if="!orders.length"
              title="No wholesale orders yet"
              body="When this shop buys from the bakery, invoices show here."
            />
            <ul v-else class="m-0 list-none space-y-3 p-0">
              <li
                v-for="o in orders"
                :key="String(o.order_id)"
                class="rounded-2xl border border-[var(--line)] bg-white p-3.5 text-sm shadow-sm"
              >
                <div class="flex items-start justify-between gap-2">
                  <div class="min-w-0">
                    <p class="m-0 truncate font-semibold text-chocolate">{{ o.invoice_number || o.order_number }}</p>
                    <p class="m-0 mt-0.5 text-xs text-[var(--muted)]">
                      {{ formatDateTime12(o.created_at as string) }}
                      · {{ String(o.payment_method || "—").replace(/_/g, " ") }}
                    </p>
                  </div>
                  <span class="shrink-0 rounded-full px-2 py-0.5 text-[0.65rem] font-semibold capitalize" :class="payBadge(o.payment_status)">
                    {{ String(o.payment_status || "—").replace(/_/g, " ") }}
                  </span>
                </div>
                <div class="mt-3 grid grid-cols-3 gap-2 rounded-xl bg-[#fff9f5] px-2.5 py-2 text-center text-xs">
                  <div>
                    <p class="m-0 text-[0.6rem] uppercase tracking-wide text-[var(--muted)]">Bill</p>
                    <p class="m-0 mt-0.5 font-bold tabular-nums text-chocolate">{{ money(Number(o.final_amount)) }}</p>
                  </div>
                  <div>
                    <p class="m-0 text-[0.6rem] uppercase tracking-wide text-[var(--muted)]">Paid</p>
                    <p class="m-0 mt-0.5 font-bold tabular-nums text-emerald-800">{{ money(Number(o.paid_amount)) }}</p>
                  </div>
                  <div>
                    <p class="m-0 text-[0.6rem] uppercase tracking-wide text-[var(--muted)]">Due</p>
                    <p class="m-0 mt-0.5 font-bold tabular-nums text-[#e9748e]">{{ money(Number(o.due)) }}</p>
                  </div>
                </div>
                <p class="m-0 mt-2 text-xs text-[var(--muted)]">
                  Subtotal {{ money(Number(o.subtotal)) }} + GST {{ money(Number(o.gst_amount)) }}
                </p>
                <div class="mt-2.5 flex flex-wrap gap-2">
                  <UButton
                    v-if="Array.isArray(o.lines) && o.lines.length"
                    type="button"
                    size="xs"
                    color="neutral"
                    variant="soft"
                    :label="expandedOrderId === Number(o.order_id) ? 'Hide lines' : `Lines (${(o.lines as unknown[]).length})`"
                    @click="toggleOrderLines(Number(o.order_id))"
                  />
                  <UButton
                    v-if="Number(o.due) > 0 || selectedDue > 0"
                    type="button"
                    size="xs"
                    color="secondary"
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
                  class="mt-2 space-y-1 border-t border-[var(--line)] pt-2 text-xs text-[var(--muted)]"
                >
                  <li v-for="(line, i) in (o.lines as Record<string, unknown>[])" :key="i" class="flex justify-between gap-2">
                    <span class="min-w-0 truncate">{{ line.product_name }} × {{ line.qty }}</span>
                    <span class="shrink-0 tabular-nums text-chocolate">{{ money(Number(line.line_total)) }}</span>
                  </li>
                </ul>
              </li>
            </ul>
          </template>

          <!-- PAYMENTS -->
          <template v-else-if="tab === 'payments'">
            <div class="space-y-3 rounded-2xl border border-[var(--line)] bg-white p-4 shadow-sm">
              <div class="flex items-center justify-between gap-2">
                <div>
                  <p class="m-0 font-semibold text-chocolate">Record collection</p>
                  <p class="m-0 text-xs text-[var(--muted)]">Udhaar / invoice collections from this shop</p>
                </div>
                <p class="m-0 rounded-full bg-[#fff0f2] px-2.5 py-1 text-sm font-bold text-[#e9748e]">
                  {{ money(selectedDue) }}
                </p>
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
              <div class="grid gap-2 sm:grid-cols-2">
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
              </div>
              <label>
                <span class="sc-label">Note</span>
                <input v-model="collect.note" class="sc-input" placeholder="Optional">
              </label>
              <UButton
                type="button"
                block
                color="secondary"
                :disabled="busy || !collect.amount || collect.amount <= 0 || selectedDue <= 0 || collect.amount > selectedDue + 0.01"
                @click="collectPay"
              >
                Record collection
              </UButton>
            </div>

            <div class="rounded-2xl border border-[var(--line)] bg-white p-4 shadow-sm">
              <p class="m-0 mb-3 text-sm font-semibold text-chocolate">
                Ledger
                <span class="font-normal text-[var(--muted)]">
                  · collections {{ money(totals.ledger_collections) }}
                  · debits {{ money(totals.ledger_debits) }}
                </span>
              </p>
              <ul class="m-0 max-h-80 list-none space-y-0 overflow-y-auto p-0 text-sm">
                <li
                  v-for="(e, i) in ledger"
                  :key="String(e.id || i)"
                  class="flex items-start justify-between gap-3 border-b border-[var(--line)] py-2.5 last:border-b-0"
                >
                  <div class="min-w-0">
                    <p class="m-0 font-medium text-chocolate">{{ entryLabel(e) }}</p>
                    <p v-if="e.note" class="m-0 truncate text-xs text-[var(--muted)]">{{ e.note }}</p>
                    <p class="m-0 text-xs text-[var(--muted)]">{{ formatDateTime12(e.created_at as string) }}</p>
                  </div>
                  <div class="shrink-0 text-right">
                    <p
                      class="m-0 font-semibold tabular-nums"
                      :class="String(e.entry_type).toLowerCase() === 'credit' ? 'text-emerald-700' : 'text-[#e9748e]'"
                    >
                      {{ String(e.entry_type).toLowerCase() === 'credit' ? '−' : '+' }}{{ money(Number(e.amount)) }}
                    </p>
                    <p class="m-0 text-xs text-[var(--muted)]">Bal {{ money(Number(e.balance_after)) }}</p>
                  </div>
                </li>
                <li v-if="!ledger.length" class="py-6 text-center text-[var(--muted)]">
                  No payments or ledger entries yet.
                </li>
              </ul>
            </div>
          </template>

          <!-- SUPPLIER POs -->
          <template v-else-if="tab === 'supplier'">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <p class="m-0 text-sm font-semibold text-chocolate">
                Supplier purchases
                <span class="font-normal text-[var(--muted)]">· {{ supplierBills.length }}</span>
              </p>
              <div class="flex flex-wrap gap-2">
                <UButton
                  v-if="selected"
                  :to="`/purchases?supplier_user_id=${shopId(selected)}`"
                  size="xs"
                  color="secondary"
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
            </div>

            <div v-if="supplierPay" class="space-y-3 rounded-2xl border border-[#e9748e]/35 bg-[#fff0f2] p-4">
              <p class="m-0 font-semibold text-chocolate">
                Pay {{ supplierPay.bill_no || `SP-${supplierPay.id}` }}
              </p>
              <p class="m-0 text-xs text-[var(--muted)]">
                Total {{ money(Number(supplierPay.total)) }}
                · paid {{ money(Number(supplierPay.paid_amount || 0)) }}
                · due {{ money(Number(supplierPay.due)) }}
              </p>
              <div class="grid gap-2 sm:grid-cols-2">
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
              </div>
              <label>
                <span class="sc-label">Note</span>
                <input v-model="supplierPayForm.note" class="sc-input" placeholder="Optional">
              </label>
              <div class="flex gap-2">
                <UButton type="button" size="sm" color="secondary" :disabled="busy || !supplierPayForm.amount" @click="confirmSupplierPay">
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
            <ul v-else class="m-0 list-none space-y-2.5 p-0 text-sm">
              <li
                v-for="b in supplierBills"
                :key="String(b.id)"
                class="rounded-2xl border border-[var(--line)] bg-white px-3.5 py-3 shadow-sm"
              >
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <p class="m-0 font-semibold text-chocolate">{{ b.bill_no || `SP-${b.id}` }}</p>
                    <p class="m-0 mt-0.5 text-xs text-[var(--muted)]">{{ b.product_name }} × {{ b.qty }}</p>
                    <p class="m-0 text-xs capitalize text-[var(--muted)]">
                      {{ String(b.status || "").replace(/_/g, " ") }}
                      · {{ String(b.payment_status || "").replace(/_/g, " ") }}
                    </p>
                    <p v-if="b.created_at" class="m-0 text-xs text-[var(--muted)]">
                      {{ formatDateTime12(b.created_at as string) }}
                    </p>
                  </div>
                  <div class="text-right">
                    <p class="m-0 font-bold tabular-nums text-chocolate">{{ money(Number(b.total)) }}</p>
                    <p class="m-0 text-xs font-semibold text-[#e9748e]">Due {{ money(Number(b.due)) }}</p>
                  </div>
                </div>
                <div class="mt-2.5 flex justify-end">
                  <UButton
                    v-if="canPaySupplier(b)"
                    type="button"
                    size="xs"
                    color="secondary"
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

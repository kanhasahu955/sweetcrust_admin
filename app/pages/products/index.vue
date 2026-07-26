<script setup lang="ts">
import ProductDetailDrawer from "~/components/products/ProductDetailDrawer.vue"
import ProductFormDrawer from "~/components/products/ProductFormDrawer.vue"
import { apiError, money } from "~/utils/format"
import { patchListRow, upsertListRow } from "~/utils/list"
import { resolveMediaUrl } from "~/utils/mapPins"

const api = useApi()
const route = useRoute()
const router = useRouter()
const toast = useAppToast()
const { confirm } = useConfirm()
const { connect } = useSocket()
const config = useRuntimeConfig()
const socketLive = useState("adminSocketLive", () => false)

const q = ref(String(Array.isArray(route.query.q) ? route.query.q[0] : route.query.q || ""))
const loading = ref(true)
const refreshing = ref(false)
const busy = ref(false)
const error = ref("")
const products = ref<Record<string, unknown>[]>([])
const categories = ref<Record<string, unknown>[]>([])
const wholesalers = ref<Record<string, unknown>[]>([])
const units = ref<{ code: string; label: string }[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = 48
const panelOpen = ref(false)
const detailOpen = ref(false)
const detailId = ref<number | null>(null)
const editProduct = ref<Record<string, unknown> | null>(null)
const stockId = ref<number | null>(null)
const stockQty = ref(0)
const stockReason = ref("adjust")
const statusFilter = ref<"all" | "active" | "inactive" | "draft" | "low">("all")
const stockOpen = computed({
  get: () => stockId.value != null,
  set: (v: boolean) => {
    if (!v) stockId.value = null
  },
})
const editId = computed(() => (editProduct.value ? Number(editProduct.value.id) || null : null))

const filterCategoryId = computed(() => {
  const raw = route.query.category_id
  const n = Number(Array.isArray(raw) ? raw[0] : raw)
  return Number.isFinite(n) && n > 0 ? n : null
})
const filterSupplierUserId = computed(() => {
  const raw = route.query.supplier_user_id
  const n = Number(Array.isArray(raw) ? raw[0] : raw)
  return Number.isFinite(n) && n > 0 ? n : null
})

const shopMap = computed(() => {
  const m = new Map<number, Record<string, unknown>>()
  for (const s of wholesalers.value) m.set(Number(s.user_id), s)
  return m
})

const statusTabs = [
  { value: "all" as const, label: "All" },
  { value: "active" as const, label: "Active" },
  { value: "draft" as const, label: "Draft" },
  { value: "low" as const, label: "Low stock" },
  { value: "inactive" as const, label: "Inactive" },
]

const filtered = computed(() => {
  let rows = products.value
  if (statusFilter.value === "active") {
    rows = rows.filter((p) => p.is_active !== false && p.is_draft !== true)
  } else if (statusFilter.value === "inactive") {
    rows = rows.filter((p) => p.is_active === false)
  } else if (statusFilter.value === "draft") {
    rows = rows.filter((p) => p.is_draft === true)
  } else if (statusFilter.value === "low") {
    rows = rows.filter((p) => isLow(p))
  }
  return rows
})

const stats = computed(() => {
  const all = products.value
  return {
    total: total.value || all.length,
    active: all.filter((p) => p.is_active !== false && p.is_draft !== true).length,
    low: all.filter((p) => isLow(p)).length,
    draft: all.filter((p) => p.is_draft === true).length,
  }
})

const canMore = computed(() => products.value.length < total.value)

function isLow(p: Record<string, unknown>) {
  const qty = Number(p.stock_qty) || 0
  const thr = Number(p.low_stock_threshold)
  const limit = Number.isFinite(thr) ? thr : 5
  return qty <= limit || String(p.stock_status || "") === "low_stock" || String(p.stock_status || "") === "out_of_stock"
}

function shopName(p: Record<string, unknown>) {
  const sid = Number(p.supplier_user_id)
  if (!sid) return "—"
  const s = shopMap.value.get(sid)
  return s ? String(s.shop_name || s.name || "Shop") : "Shop"
}

function catName(p: Record<string, unknown>) {
  const id = Number(p.category_id)
  const c = categories.value.find((x) => Number(x.id) === id)
  return c ? String(c.name || "") : "—"
}

function thumb(p: Record<string, unknown>) {
  return resolveMediaUrl(String(p.cover_image_url || ""), String(config.public.apiBase || ""))
}

function openCreate() {
  editProduct.value = null
  panelOpen.value = true
}

function startEdit(p: Record<string, unknown>) {
  detailOpen.value = false
  editProduct.value = p
  panelOpen.value = true
}

function openDetail(p: Record<string, unknown>) {
  detailId.value = Number(p.id) || null
  detailOpen.value = true
}

function onProductSaved(saved: Record<string, unknown>) {
  const id = Number(saved.id)
  const existed = products.value.some((p) => Number(p.id) === id)
  if (!upsertListRow(products, saved) && id) patchListRow(products, id, saved)
  if (!existed) total.value += 1
  editProduct.value = null
  void load({ quiet: true })
}

function stars(n: unknown) {
  const full = Math.round(Math.max(0, Math.min(5, Number(n) || 0)))
  return "★".repeat(full) + "☆".repeat(5 - full)
}

function ratingLabel(p: Record<string, unknown>) {
  const r = Number(p.rating) || 0
  return r > 0 ? r.toFixed(1) : "—"
}

function openStock(p: Record<string, unknown>) {
  stockId.value = Number(p.id)
  stockQty.value = Number(p.stock_qty) || 0
  stockReason.value = "adjust"
}

function setQuery(patch: Record<string, string | number | undefined | null>) {
  const next: Record<string, string> = {}
  for (const [k, v] of Object.entries({ ...route.query, ...patch })) {
    if (v == null || v === "" || v === 0) continue
    next[k] = String(Array.isArray(v) ? v[0] : v)
  }
  // drop cleared keys
  for (const k of Object.keys(patch)) {
    if (patch[k] == null || patch[k] === "" || patch[k] === 0) delete next[k]
  }
  void router.replace({ query: next })
}

function onShopFilter(e: Event) {
  const n = Number((e.target as HTMLSelectElement).value) || null
  setQuery({ supplier_user_id: n })
}

function onCategoryFilter(e: Event) {
  const n = Number((e.target as HTMLSelectElement).value) || null
  setQuery({ category_id: n })
}

function hideBrokenImg(e: Event) {
  const el = e.target as HTMLImageElement | null
  if (el) el.style.display = "none"
}

async function load(opts?: { quiet?: boolean; append?: boolean }) {
  if (opts?.quiet) refreshing.value = true
  else if (!opts?.append) loading.value = true
  error.value = ""
  try {
    if (!opts?.append) page.value = 1
    const [data, cats, shops, unitRows] = await Promise.all([
      api.admin.products(
        q.value.trim() || undefined,
        page.value,
        filterCategoryId.value || undefined,
        filterSupplierUserId.value || undefined,
        pageSize,
      ),
      opts?.append ? Promise.resolve(categories.value) : api.admin.categories().catch(() => []),
      opts?.append ? Promise.resolve(wholesalers.value) : api.admin.shops().catch(() => []),
      opts?.append ? Promise.resolve(units.value) : api.admin.units().catch(() => []),
    ])
    const list = Array.isArray(data)
      ? data
      : (data as { items?: unknown[] })?.items || []
    const rows = list as Record<string, unknown>[]
    total.value = Array.isArray(data) ? rows.length : Number((data as { total?: number })?.total) || rows.length
    products.value = opts?.append ? [...products.value, ...rows] : rows
    if (!opts?.append) {
      categories.value = Array.isArray(cats) ? (cats as Record<string, unknown>[]) : categories.value
      units.value = Array.isArray(unitRows) ? (unitRows as { code: string; label: string }[]) : units.value
      const shopList = Array.isArray(shops) ? (shops as Record<string, unknown>[]) : []
      wholesalers.value = shopList.filter(
        (s) => s.is_wholesaler !== false && String(s.approval_status || "approved") === "approved",
      )
    }
  } catch (e) {
    error.value = apiError(e)
  } finally {
    loading.value = false
    refreshing.value = false
  }
}

async function loadMore() {
  if (!canMore.value || busy.value) return
  page.value += 1
  await load({ append: true, quiet: true })
}

async function search() {
  setQuery({ q: q.value.trim() || null })
  await load()
}

async function dup(p: Record<string, unknown>) {
  busy.value = true
  try {
    const created = (await api.admin.duplicateProduct(Number(p.id))) as Record<string, unknown>
    upsertListRow(products, created)
    total.value += 1
    toast.success("Duplicated as draft")
  } catch (e) {
    toast.error(apiError(e))
  } finally {
    busy.value = false
  }
}

async function publish(p: Record<string, unknown>) {
  busy.value = true
  try {
    const saved = (await api.admin.updateProduct(Number(p.id), { is_draft: false, is_active: true })) as Record<string, unknown>
    if (!upsertListRow(products, saved)) patchListRow(products, Number(p.id), { is_draft: false, is_active: true })
    toast.success("Published")
  } catch (e) {
    toast.error(apiError(e))
  } finally {
    busy.value = false
  }
}

async function activate(p: Record<string, unknown>) {
  busy.value = true
  try {
    const saved = (await api.admin.updateProduct(Number(p.id), { is_active: true })) as Record<string, unknown>
    if (!upsertListRow(products, saved)) patchListRow(products, Number(p.id), { is_active: true })
    toast.success("Activated")
  } catch (e) {
    toast.error(apiError(e))
  } finally {
    busy.value = false
  }
}

async function remove(p: Record<string, unknown>) {
  const ok = await confirm({
    title: "Disable product?",
    description: String(p.name || "This SKU will be marked inactive."),
    confirmLabel: "Disable",
  })
  if (!ok) return
  busy.value = true
  try {
    await api.admin.deleteProduct(Number(p.id))
    patchListRow(products, Number(p.id), { is_active: false })
    toast.success("Disabled")
  } catch (e) {
    toast.error(apiError(e))
  } finally {
    busy.value = false
  }
}

async function saveStock() {
  if (!stockId.value) return
  busy.value = true
  try {
    const saved = (await api.admin.updateStock(stockId.value, {
      stock_qty: Number(stockQty.value) || 0,
      reason: stockReason.value || "adjust",
    })) as Record<string, unknown>
    if (!upsertListRow(products, saved)) {
      patchListRow(products, stockId.value, { stock_qty: stockQty.value })
    }
    toast.success("Stock updated")
    stockId.value = null
    void load({ quiet: true })
  } catch (e) {
    toast.error(apiError(e))
  } finally {
    busy.value = false
  }
}

watch([filterCategoryId, filterSupplierUserId], () => {
  void load()
})

let liveSocket: ReturnType<typeof connect> = null
const onAdminEvent = (data: Record<string, unknown>) => {
  const kind = String(data?.kind || "")
  if (kind.includes("product") || kind.includes("stock") || kind.includes("catalog")) {
    void load({ quiet: true })
  }
}

onMounted(() => {
  if (route.query.q && !q.value) {
    q.value = String(Array.isArray(route.query.q) ? route.query.q[0] : route.query.q)
  }
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
        <h1 class="font-display m-0 text-2xl text-chocolate sm:text-3xl">Products</h1>
        <p class="m-0 mt-1 flex flex-wrap items-center gap-2 text-sm text-[var(--muted)]">
          <span
            class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.65rem] font-semibold"
            :class="socketLive ? 'bg-[#e8f6ee] text-[#2e7d4f]' : 'bg-[#f8ede6] text-[var(--muted)]'"
          >
            <span class="size-1.5 rounded-full" :class="socketLive ? 'animate-pulse bg-success' : 'bg-[#c4a39a]'" />
            {{ socketLive ? "Live" : "Offline" }}
          </span>
          <span>SKU · shop wholesale · stock</span>
        </p>
      </div>
      <div class="flex flex-wrap gap-2">
        <UButton color="primary" variant="soft" icon="i-lucide-refresh-cw" :loading="loading || refreshing" @click="load()" />
        <UButton to="/categories" color="neutral" variant="outline" icon="i-lucide-tags" label="Categories" />
        <UButton to="/inventory" color="neutral" variant="outline" icon="i-lucide-boxes" label="Inventory" />
        <UButton color="secondary" icon="i-lucide-plus" label="Add product" @click="openCreate" />
      </div>
    </div>

    <p v-if="error" class="mb-3 text-sm text-danger">{{ error }}</p>

    <div class="mb-4 grid gap-3 sm:grid-cols-4">
      <StatCard label="SKUs" :value="stats.total" icon="lucide:package" />
      <StatCard label="Active" :value="stats.active" icon="lucide:check-circle" tone="ok" />
      <StatCard label="Low stock" :value="stats.low" icon="lucide:alert-triangle" tone="warn" />
      <StatCard label="Drafts" :value="stats.draft" icon="lucide:file-pen" />
    </div>

    <div class="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <label class="relative block w-full max-w-md">
        <UIcon name="i-lucide-search" class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--muted)]" />
        <input
          v-model="q"
          class="sc-input w-full !rounded-xl !py-2.5 !pl-9"
          placeholder="Search name or brand…"
          @keyup.enter="search"
        >
      </label>
      <div class="flex flex-wrap gap-2">
        <select
          class="sc-input !w-auto !rounded-xl !py-2"
          :value="filterSupplierUserId || 0"
          @change="onShopFilter"
        >
          <option :value="0">All shops</option>
          <option v-for="s in wholesalers" :key="String(s.user_id)" :value="Number(s.user_id)">
            {{ s.shop_name }}
          </option>
        </select>
        <select
          class="sc-input !w-auto !rounded-xl !py-2"
          :value="filterCategoryId || 0"
          @change="onCategoryFilter"
        >
          <option :value="0">All categories</option>
          <option v-for="c in categories" :key="String(c.id)" :value="Number(c.id)">
            {{ c.name }}
          </option>
        </select>
        <UButton color="secondary" variant="soft" icon="i-lucide-search" label="Search" @click="search" />
      </div>
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
        {{ t.label }}
        <span v-if="t.value === 'all'"> {{ stats.total }}</span>
        <span v-else-if="t.value === 'active'"> {{ stats.active }}</span>
        <span v-else-if="t.value === 'low'"> {{ stats.low }}</span>
        <span v-else-if="t.value === 'draft'"> {{ stats.draft }}</span>
      </button>
    </div>

    <div v-if="loading" class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <div v-for="n in 6" :key="n" class="sc-skeleton h-40 rounded-2xl" />
    </div>

    <div
      v-else-if="!filtered.length"
      class="rounded-2xl border border-dashed border-[var(--line)] py-16 text-center text-sm text-[var(--muted)]"
    >
      No products
    </div>

    <div v-else class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <article
        v-for="p in filtered"
        :key="String(p.id)"
        class="cursor-pointer rounded-2xl border border-[var(--line)] bg-white p-3.5 shadow-[0_8px_22px_-18px_rgba(74,44,42,0.35)] transition hover:border-[#e9748e]/40 hover:shadow-[0_12px_28px_-16px_rgba(74,44,42,0.45)]"
        @click="openDetail(p)"
      >
        <div class="flex gap-3">
          <div class="size-16 shrink-0 overflow-hidden rounded-xl bg-[#fff5f7] ring-1 ring-[var(--line)]">
            <img
              v-if="thumb(p)"
              :src="thumb(p) || undefined"
              alt=""
              class="size-full object-cover"
              @error="hideBrokenImg"
            >
            <div v-else class="grid size-full place-items-center text-lg font-bold text-[#e9748e]">
              {{ String(p.name || '?').slice(0, 1) }}
            </div>
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <p class="m-0 truncate font-semibold text-chocolate">{{ p.name }}</p>
                <div class="mt-1 flex flex-wrap items-center gap-1.5">
                  <span
                    v-if="p.shop_name || p.supplier_user_id"
                    class="inline-flex max-w-full items-center gap-1 truncate rounded-full bg-chocolate px-2 py-0.5 text-[0.65rem] font-semibold text-cream"
                    :title="String(p.shop_name || shopName(p))"
                  >
                    <UIcon name="i-lucide-store" class="size-3 shrink-0" />
                    <span class="truncate">{{ p.shop_name || shopName(p) }}</span>
                  </span>
                  <span
                    v-if="p.category_name || catName(p) !== '—'"
                    class="inline-flex items-center gap-1 rounded-full bg-[#fff0f2] px-2 py-0.5 text-[0.65rem] font-semibold text-[#e9748e]"
                  >
                    {{ p.category_name || catName(p) }}
                  </span>
                </div>
                <p v-if="p.brand_name" class="m-0 mt-1 truncate text-xs text-[var(--muted)]">
                  {{ p.brand_name }}
                </p>
              </div>
              <div class="flex shrink-0 flex-col items-end gap-1">
                <span
                  v-if="p.is_draft"
                  class="rounded-full bg-[#fff0f2] px-2 py-0.5 text-[0.65rem] font-semibold text-[#e9748e]"
                >Draft</span>
                <span
                  v-else-if="p.is_active === false"
                  class="rounded-full bg-[#f8ede6] px-2 py-0.5 text-[0.65rem] font-semibold text-[var(--muted)]"
                >Off</span>
                <StatusBadge v-if="p.stock_status" :status="String(p.stock_status)" />
              </div>
            </div>
            <p class="m-0 mt-1 line-clamp-2 text-xs text-[var(--muted)]">
              {{ p.short_description || '—' }}
            </p>
            <div class="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
              <span class="font-semibold text-[#e9748e]" :title="`${ratingLabel(p)} / 5`">
                {{ stars(p.rating) }}
                <span class="text-chocolate">{{ ratingLabel(p) }}</span>
              </span>
              <span class="text-[var(--muted)]">{{ Number(p.review_count) || 0 }} reviews</span>
              <span class="text-[var(--muted)]">{{ Number(p.comment_count) || 0 }} comments</span>
              <span class="font-semibold text-[#e9748e]">♥ {{ Number(p.favorite_count) || 0 }}</span>
            </div>
          </div>
        </div>

        <div class="mt-3 grid grid-cols-4 gap-2 rounded-xl bg-[#fff9f5] px-2.5 py-2 text-center">
          <div>
            <p class="m-0 text-[0.6rem] font-semibold uppercase tracking-wide text-[var(--muted)]">Wholesale</p>
            <p class="m-0 text-sm font-bold text-chocolate">{{ money(Number(p.shop_price)) }}</p>
          </div>
          <div>
            <p class="m-0 text-[0.6rem] font-semibold uppercase tracking-wide text-[var(--muted)]">Customer</p>
            <p class="m-0 text-sm font-bold text-chocolate">{{ money(Number(p.customer_price ?? p.selling_price)) }}</p>
          </div>
          <div>
            <p class="m-0 text-[0.6rem] font-semibold uppercase tracking-wide text-[var(--muted)]">Cost</p>
            <p class="m-0 text-sm font-bold text-chocolate">{{ money(Number(p.purchase_cost)) }}</p>
          </div>
          <div>
            <p class="m-0 text-[0.6rem] font-semibold uppercase tracking-wide text-[var(--muted)]">Stock</p>
            <p class="m-0 text-sm font-bold" :class="isLow(p) ? 'text-[#e9748e]' : 'text-chocolate'">
              {{ Number(p.stock_qty) || 0 }}
              <span class="text-[0.65rem] font-normal text-[var(--muted)]">{{ p.unit_label || 'pcs' }}</span>
            </p>
          </div>
        </div>

        <div class="mt-3 flex flex-wrap gap-1.5" @click.stop>
          <UButton size="xs" color="neutral" variant="soft" label="View" @click="openDetail(p)" />
          <UButton size="xs" color="secondary" variant="soft" label="Edit" :disabled="busy" @click="startEdit(p)" />
          <UButton size="xs" color="neutral" variant="outline" label="Stock" :disabled="busy" @click="openStock(p)" />
          <UButton size="xs" color="neutral" variant="outline" label="Dup" :disabled="busy" @click="dup(p)" />
          <UButton
            v-if="p.is_draft"
            size="xs"
            color="primary"
            variant="soft"
            label="Publish"
            :disabled="busy"
            @click="publish(p)"
          />
          <UButton
            v-else-if="p.is_active === false"
            size="xs"
            color="primary"
            variant="soft"
            label="Activate"
            :disabled="busy"
            @click="activate(p)"
          />
          <UButton
            v-if="p.supplier_user_id"
            size="xs"
            color="neutral"
            variant="ghost"
            label="Shop"
            :to="`/products?supplier_user_id=${p.supplier_user_id}`"
          />
          <UButton
            size="xs"
            color="neutral"
            variant="ghost"
            class="!text-danger"
            label="Del"
            :disabled="busy"
            @click="remove(p)"
          />
        </div>
      </article>
    </div>

    <div v-if="canMore && !loading" class="mt-4 flex justify-center">
      <UButton color="neutral" variant="outline" :loading="refreshing" label="Load more" @click="loadMore" />
    </div>

    <ProductDetailDrawer
      v-model:open="detailOpen"
      :product-id="detailId"
      @edit="startEdit"
    />

    <ProductFormDrawer
      v-model:open="panelOpen"
      :edit-id="editId"
      :product="editProduct"
      :categories="categories"
      :units="units"
      :wholesalers="wholesalers"
      :default-category-id="filterCategoryId"
      :default-supplier-user-id="filterSupplierUserId"
      @saved="onProductSaved"
    />

    <!-- Stock adjust -->
    <div
      v-if="stockOpen"
      class="fixed inset-0 z-50 grid place-items-center bg-chocolate/40 p-4"
      @click.self="stockId = null"
    >
      <div class="w-full max-w-sm rounded-2xl bg-white p-4 shadow-xl">
        <p class="font-display m-0 text-lg text-chocolate">Adjust stock</p>
        <label class="mt-3 block">
          <span class="sc-label">Qty</span>
          <input v-model.number="stockQty" type="number" min="0" class="sc-input !rounded-xl">
        </label>
        <label class="mt-3 block">
          <span class="sc-label">Reason</span>
          <select v-model="stockReason" class="sc-input !rounded-xl">
            <option value="adjust">Adjust</option>
            <option value="receive">Receive</option>
            <option value="damage">Damage</option>
            <option value="count">Count</option>
          </select>
        </label>
        <div class="mt-4 flex gap-2">
          <UButton color="secondary" :loading="busy" label="Update stock" @click="saveStock" />
          <UButton color="neutral" variant="soft" label="Cancel" @click="stockId = null" />
        </div>
      </div>
    </div>
  </div>
</template>

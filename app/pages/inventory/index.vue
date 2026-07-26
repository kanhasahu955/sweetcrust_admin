<script setup lang="ts">
import { apiError, money, relativeAgo } from "~/utils/format"
import { patchListRow, upsertListRow } from "~/utils/list"
import { resolveMediaUrl } from "~/utils/mapPins"

const api = useApi()
const toast = useAppToast()
const config = useRuntimeConfig()
const socketLive = useState("adminSocketLive", () => false)
const { connect } = useSocket()

const loading = ref(true)
const refreshing = ref(false)
const busy = ref(false)
const error = ref("")
const items = ref<Record<string, unknown>[]>([])
const shops = ref<Record<string, unknown>[]>([])
const suggestions = ref<Record<string, unknown>[]>([])
const movements = ref<Record<string, unknown>[]>([])
const stats = ref({
  total: 0,
  in_stock: 0,
  low_stock: 0,
  out_of_stock: 0,
  restock_tips: 0,
})

const q = ref("")
const shopFilter = ref(0)
const flag = ref<"all" | "in_stock" | "low_stock" | "out_of_stock">("all")
const panelOpen = ref(false)

const stockForm = reactive({
  id: 0,
  name: "",
  shop_name: "",
  brand_name: "",
  cover_image_url: "",
  stock_qty: 0,
  prev_qty: 0,
  low_stock_threshold: 5,
  unit_label: "",
  reason: "adjust",
  note: "",
  supplier_user_id: 0,
})

const reasonOptions = [
  { value: "adjust", label: "Adjust" },
  { value: "receive", label: "Receive / restock" },
  { value: "count", label: "Stock count" },
  { value: "damage", label: "Damage / waste" },
  { value: "order", label: "Order correction" },
]

const filterTabs = [
  { value: "all" as const, label: "All" },
  { value: "in_stock" as const, label: "In stock" },
  { value: "low_stock" as const, label: "Low" },
  { value: "out_of_stock" as const, label: "Out" },
]

const wholesalers = computed(() =>
  shops.value.filter(
    (s) => s.is_wholesaler !== false && String(s.approval_status || "approved") === "approved",
  ),
)

const filtered = computed(() => {
  const ql = q.value.trim().toLowerCase()
  return items.value.filter((p) => {
    const status = String(p.stock_status || "")
    if (flag.value !== "all" && status !== flag.value) return false
    if (shopFilter.value && Number(p.supplier_user_id) !== shopFilter.value) return false
    if (!ql) return true
    return (
      String(p.name || "").toLowerCase().includes(ql)
      || String(p.brand_name || "").toLowerCase().includes(ql)
      || String(p.shop_name || "").toLowerCase().includes(ql)
      || String(p.category_name || "").toLowerCase().includes(ql)
    )
  })
})

const delta = computed(() => Number(stockForm.stock_qty) - Number(stockForm.prev_qty))

function thumb(r: Record<string, unknown>) {
  return resolveMediaUrl(String(r.cover_image_url || ""), String(config.public.apiBase || ""))
}

function hideBrokenImg(e: Event) {
  const el = e.target as HTMLImageElement | null
  if (el) el.style.display = "none"
}

function stockTone(p: Record<string, unknown>) {
  const status = String(p.stock_status || "")
  if (status === "out_of_stock") return "text-[#c0392b]"
  if (status === "low_stock") return "text-[#e9748e]"
  const qty = Number(p.stock_qty) || 0
  const thr = Number(p.low_stock_threshold) || 5
  if (qty <= thr) return "text-[#e9748e]"
  return "text-chocolate"
}

function statusLabel(status: unknown) {
  const s = String(status || "—").replace(/_/g, " ")
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function statusClass(status: unknown) {
  const s = String(status || "")
  if (s === "out_of_stock") return "bg-[#fdecea] text-[#c0392b]"
  if (s === "low_stock") return "bg-[#fff0f2] text-[#e9748e]"
  return "bg-[#e8f6ee] text-[#2e7d4f]"
}

function recomputeStats(list: Record<string, unknown>[], tipsLen: number) {
  stats.value = {
    total: list.length,
    in_stock: list.filter((p) => String(p.stock_status) === "in_stock").length,
    low_stock: list.filter((p) => String(p.stock_status) === "low_stock").length,
    out_of_stock: list.filter((p) => String(p.stock_status) === "out_of_stock").length,
    restock_tips: tipsLen,
  }
}

async function load(opts?: { quiet?: boolean }) {
  if (opts?.quiet) refreshing.value = true
  else loading.value = true
  error.value = ""
  try {
    const [data, shopRows] = await Promise.all([
      api.admin.inventory() as Promise<Record<string, unknown>>,
      shops.value.length ? Promise.resolve(shops.value) : api.admin.shops().catch(() => []),
    ])
    const current = Array.isArray(data?.current) ? data.current : []
    items.value = current as Record<string, unknown>[]
    const ai = (data?.ai || {}) as Record<string, unknown>
    suggestions.value = (Array.isArray(ai.restock_suggestions) ? ai.restock_suggestions : []) as Record<string, unknown>[]
    movements.value = (Array.isArray(data?.movements) ? data.movements : []) as Record<string, unknown>[]
    const s = (data?.stats || {}) as Record<string, unknown>
    if (s.total != null) {
      stats.value = {
        total: Number(s.total) || 0,
        in_stock: Number(s.in_stock) || 0,
        low_stock: Number(s.low_stock) || 0,
        out_of_stock: Number(s.out_of_stock) || 0,
        restock_tips: Number(s.restock_tips) || suggestions.value.length,
      }
    } else {
      recomputeStats(items.value, suggestions.value.length)
    }
    if (Array.isArray(shopRows) && shopRows.length) {
      shops.value = shopRows as Record<string, unknown>[]
    }
  } catch (e) {
    error.value = apiError(e)
  } finally {
    loading.value = false
    refreshing.value = false
  }
}

function pick(p: Record<string, unknown>, opts?: { qty?: number; open?: boolean }) {
  stockForm.id = Number(p.id || p.product_id)
  stockForm.name = String(p.name || "")
  stockForm.shop_name = String(p.shop_name || "")
  stockForm.brand_name = String(p.brand_name || "")
  stockForm.cover_image_url = String(p.cover_image_url || "")
  stockForm.prev_qty = Number(p.stock_qty ?? p.current_qty) || 0
  stockForm.stock_qty = opts?.qty != null ? Number(opts.qty) : stockForm.prev_qty
  stockForm.low_stock_threshold = Number(p.low_stock_threshold) || 5
  stockForm.unit_label = String(p.unit_label || "")
  stockForm.reason = "adjust"
  stockForm.note = ""
  stockForm.supplier_user_id = Number(p.supplier_user_id) || 0
  if (opts?.open !== false) panelOpen.value = true
}

function applySuggest(s: Record<string, unknown>) {
  const row = items.value.find((p) => Number(p.id) === Number(s.product_id)) || s
  pick(
    {
      ...row,
      id: s.product_id || row.id,
      name: s.name || row.name,
      stock_qty: row.stock_qty ?? s.current_qty,
    },
    { qty: Number(s.suggest_qty) || 0 },
  )
  stockForm.reason = "receive"
}

async function updateStock() {
  if (!stockForm.id) return
  busy.value = true
  error.value = ""
  try {
    const saved = (await api.admin.updateStock(stockForm.id, {
      stock_qty: Number(stockForm.stock_qty) || 0,
      reason: stockForm.reason || "adjust",
      note: stockForm.note.trim() || undefined,
    })) as Record<string, unknown>
    if (!upsertListRow(items, saved)) {
      patchListRow(items, stockForm.id, {
        stock_qty: stockForm.stock_qty,
        stock_status: saved.stock_status,
      })
    }
    toast.success("Stock updated", stockForm.name)
    panelOpen.value = false
    void load({ quiet: true })
  } catch (e) {
    error.value = apiError(e)
    toast.error(apiError(e))
  } finally {
    busy.value = false
  }
}

function buyLink(p: Record<string, unknown>) {
  const sid = Number(p.supplier_user_id)
  return sid ? `/purchases?supplier_user_id=${sid}` : "/purchases"
}

const dashboardBump = useState("adminDashboardBump", () => 0)
watch(dashboardBump, () => {
  void load({ quiet: true })
})

let liveSocket: ReturnType<typeof connect> = null
const onAdminEvent = (data: Record<string, unknown>) => {
  const kind = String(data?.kind || "")
  if (kind.includes("product") || kind.includes("stock") || kind.includes("catalog") || kind.includes("po_") || kind === "low_stock") {
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
        <h1 class="font-display m-0 text-2xl text-chocolate sm:text-3xl">Inventory</h1>
        <p class="m-0 mt-1 flex flex-wrap items-center gap-2 text-sm text-[var(--muted)]">
          <span
            class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.65rem] font-semibold"
            :class="socketLive ? 'bg-[#e8f6ee] text-[#2e7d4f]' : 'bg-[#f8ede6] text-[var(--muted)]'"
          >
            <span class="size-1.5 rounded-full" :class="socketLive ? 'animate-pulse bg-success' : 'bg-[#c4a39a]'" />
            {{ socketLive ? "Live" : "Offline" }}
          </span>
          <span>Stock levels, alerts, and quick adjustments</span>
        </p>
      </div>
      <div class="flex flex-wrap gap-2">
        <UButton
          color="primary"
          variant="soft"
          icon="i-lucide-refresh-cw"
          :loading="loading || refreshing"
          label="Refresh"
          @click="load()"
        />
        <UButton to="/products" color="neutral" variant="outline" icon="i-lucide-package" label="Products" />
        <UButton to="/purchases" color="secondary" icon="i-lucide-shopping-bag" label="Buy from shops" />
      </div>
    </div>

    <p v-if="error" class="mb-3 text-sm text-danger">{{ error }}</p>

    <div class="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="SKUs" :value="stats.total" icon="lucide:package" />
      <StatCard label="In stock" :value="stats.in_stock" icon="lucide:check-circle" tone="ok" />
      <StatCard label="Low stock" :value="stats.low_stock" icon="lucide:alert-triangle" tone="warn" />
      <StatCard label="Restock tips" :value="stats.restock_tips" icon="lucide:sparkles" />
    </div>

    <div class="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <label class="relative block w-full max-w-md">
        <UIcon name="i-lucide-search" class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--muted)]" />
        <input
          v-model="q"
          class="sc-input w-full !rounded-xl !py-2.5 !pl-9"
          placeholder="Search name, brand, shop…"
        >
      </label>
      <select v-model.number="shopFilter" class="sc-input !w-auto !rounded-xl !py-2">
        <option :value="0">All shops</option>
        <option v-for="s in wholesalers" :key="String(s.user_id)" :value="Number(s.user_id)">
          {{ s.shop_name }}
        </option>
      </select>
    </div>

    <div class="mb-4 flex flex-wrap gap-1.5">
      <button
        v-for="t in filterTabs"
        :key="t.value"
        type="button"
        class="rounded-full px-3 py-1.5 text-xs font-semibold transition"
        :class="flag === t.value ? 'bg-chocolate text-cream' : 'bg-white text-chocolate ring-1 ring-[var(--line)]'"
        @click="flag = t.value"
      >
        {{ t.label }}
        <span v-if="t.value === 'all'"> {{ stats.total }}</span>
        <span v-else-if="t.value === 'in_stock'"> {{ stats.in_stock }}</span>
        <span v-else-if="t.value === 'low_stock'"> {{ stats.low_stock }}</span>
        <span v-else-if="t.value === 'out_of_stock'"> {{ stats.out_of_stock }}</span>
      </button>
    </div>

    <div v-if="suggestions.length" class="mb-4 overflow-hidden rounded-2xl border border-[var(--line)] bg-white shadow-[0_8px_22px_-18px_rgba(74,44,42,0.35)]">
      <div class="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] bg-[#fff9f5] px-4 py-3">
        <div>
          <h3 class="font-display m-0 text-lg text-chocolate">Restock tips</h3>
          <p class="m-0 text-xs text-[var(--muted)]">Suggested fill levels for low / out SKUs</p>
        </div>
        <UButton to="/purchases" size="xs" color="secondary" variant="soft" icon="i-lucide-shopping-bag" label="Open purchases" />
      </div>
      <ul class="divide-y divide-[var(--line)]">
        <li
          v-for="s in suggestions"
          :key="String(s.product_id)"
          class="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
        >
          <div class="min-w-0">
            <p class="m-0 truncate font-semibold text-chocolate">{{ s.name }}</p>
            <p class="m-0 text-xs text-[var(--muted)]">
              Now {{ s.current_qty ?? 0 }}
              <span v-if="s.shop_name"> · {{ s.shop_name }}</span>
            </p>
          </div>
          <div class="flex flex-wrap gap-1.5">
            <UButton size="xs" color="secondary" variant="soft" :label="`Set ${s.suggest_qty}`" @click="applySuggest(s)" />
            <UButton
              size="xs"
              color="neutral"
              variant="ghost"
              label="Buy"
              :to="buyLink(s)"
            />
          </div>
        </li>
      </ul>
    </div>

    <p class="mb-3 text-sm text-[var(--muted)]">{{ filtered.length }} shown</p>

    <div v-if="loading" class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <div v-for="n in 6" :key="n" class="sc-skeleton h-44 rounded-2xl" />
    </div>

    <div
      v-else-if="!filtered.length"
      class="rounded-2xl border border-dashed border-[var(--line)] py-16 text-center text-sm text-[var(--muted)]"
    >
      No inventory rows match
    </div>

    <div v-else class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <article
        v-for="p in filtered"
        :key="String(p.id)"
        class="rounded-2xl border border-[var(--line)] bg-white p-3.5 shadow-[0_8px_22px_-18px_rgba(74,44,42,0.35)] transition hover:border-[#e9748e]/35"
      >
        <div class="flex gap-3">
          <div class="size-14 shrink-0 overflow-hidden rounded-xl bg-[#fff5f7] ring-1 ring-[var(--line)]">
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
              <p class="m-0 truncate font-semibold text-chocolate">{{ p.name }}</p>
              <span
                class="shrink-0 rounded-full px-2 py-0.5 text-[0.65rem] font-semibold"
                :class="statusClass(p.stock_status)"
              >
                {{ statusLabel(p.stock_status) }}
              </span>
            </div>
            <div class="mt-1 flex flex-wrap items-center gap-1.5">
              <span
                v-if="p.shop_name"
                class="inline-flex max-w-full items-center gap-1 truncate rounded-full bg-chocolate px-2 py-0.5 text-[0.65rem] font-semibold text-cream"
              >
                <UIcon name="i-lucide-store" class="size-3 shrink-0" />
                <span class="truncate">{{ p.shop_name }}</span>
              </span>
              <span
                v-if="p.category_name"
                class="rounded-full bg-[#fff0f2] px-2 py-0.5 text-[0.65rem] font-semibold text-[#e9748e]"
              >
                {{ p.category_name }}
              </span>
            </div>
            <p class="m-0 mt-1 truncate text-xs text-[var(--muted)]">{{ p.brand_name || '—' }}</p>
          </div>
        </div>

        <div class="mt-3 grid grid-cols-3 gap-2 rounded-xl bg-[#fff9f5] px-2.5 py-2 text-center">
          <div>
            <p class="m-0 text-[0.6rem] font-semibold uppercase tracking-wide text-[var(--muted)]">Stock</p>
            <p class="m-0 text-sm font-bold" :class="stockTone(p)">
              {{ p.stock_qty ?? 0 }}
              <span v-if="p.unit_label" class="text-[0.65rem] font-medium text-[var(--muted)]">{{ p.unit_label }}</span>
            </p>
          </div>
          <div>
            <p class="m-0 text-[0.6rem] font-semibold uppercase tracking-wide text-[var(--muted)]">Alert @</p>
            <p class="m-0 text-sm font-bold text-chocolate">{{ p.low_stock_threshold ?? 5 }}</p>
          </div>
          <div>
            <p class="m-0 text-[0.6rem] font-semibold uppercase tracking-wide text-[var(--muted)]">Cost</p>
            <p class="m-0 text-sm font-bold text-chocolate">{{ money(Number(p.purchase_cost || 0)) }}</p>
          </div>
        </div>

        <div class="mt-2 flex flex-wrap items-center gap-3 text-[0.7rem] text-[var(--muted)]">
          <span v-if="Number(p.rating) > 0" class="inline-flex items-center gap-0.5">
            <UIcon name="i-lucide-star" class="size-3 text-[#e9748e]" />
            {{ Number(p.rating).toFixed(1) }}
            <template v-if="p.review_count">({{ p.review_count }})</template>
          </span>
          <span v-if="Number(p.favorite_count) > 0" class="inline-flex items-center gap-0.5">
            <UIcon name="i-lucide-heart" class="size-3" />
            {{ p.favorite_count }}
          </span>
          <span v-if="Number(p.comment_count) > 0" class="inline-flex items-center gap-0.5">
            <UIcon name="i-lucide-message-circle" class="size-3" />
            {{ p.comment_count }}
          </span>
        </div>

        <div class="mt-3 flex flex-wrap gap-1.5">
          <UButton size="xs" color="secondary" variant="soft" label="Adjust" @click="pick(p)" />
          <UButton size="xs" color="neutral" variant="ghost" label="Buy" :to="buyLink(p)" />
          <UButton
            size="xs"
            color="neutral"
            variant="ghost"
            label="SKU"
            :to="`/products?q=${encodeURIComponent(String(p.name || ''))}`"
          />
        </div>
      </article>
    </div>

    <div v-if="movements.length" class="mt-6 overflow-hidden rounded-2xl border border-[var(--line)] bg-white shadow-[0_8px_22px_-18px_rgba(74,44,42,0.35)]">
      <div class="border-b border-[var(--line)] bg-[#fff9f5] px-4 py-3">
        <p class="font-display m-0 text-lg text-chocolate">Recent movements</p>
        <p class="m-0 text-xs text-[var(--muted)]">Last {{ Math.min(movements.length, 20) }} changes</p>
      </div>
      <ul class="divide-y divide-[var(--line)]">
        <li
          v-for="m in movements.slice(0, 20)"
          :key="String(m.id)"
          class="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm"
        >
          <div class="min-w-0">
            <p class="m-0 truncate font-semibold text-chocolate">{{ m.product_name || `#${m.product_id}` }}</p>
            <p class="m-0 text-xs text-[var(--muted)]">
              {{ m.reason || '—' }}
              <span v-if="m.note"> · {{ m.note }}</span>
              · {{ relativeAgo(String(m.created_at || '')) }}
            </p>
          </div>
          <span
            class="shrink-0 font-bold"
            :class="Number(m.change_qty) < 0 ? 'text-[#c0392b]' : 'text-[#2e7d4f]'"
          >
            {{ Number(m.change_qty) > 0 ? '+' : '' }}{{ m.change_qty ?? m.quantity ?? m.delta }}
          </span>
        </li>
      </ul>
    </div>

    <USlideover
      v-model:open="panelOpen"
      side="right"
      :title="stockForm.name || 'Adjust stock'"
      description="Set quantity, reason, and optional note"
      :ui="{ content: 'w-full max-w-lg bg-[#fffaf8]' }"
    >
      <template #body>
        <form class="flex flex-col gap-3 pb-6" @submit.prevent="updateStock">
          <div class="flex gap-3">
            <div class="size-16 shrink-0 overflow-hidden rounded-xl bg-[#fff5f7] ring-1 ring-[var(--line)]">
              <img
                v-if="stockForm.cover_image_url"
                :src="resolveMediaUrl(stockForm.cover_image_url, String(config.public.apiBase || '')) || undefined"
                alt=""
                class="size-full object-cover"
              >
              <div v-else class="grid size-full place-items-center font-bold text-[#e9748e]">
                {{ stockForm.name.slice(0, 1) || '?' }}
              </div>
            </div>
            <div class="min-w-0">
              <p class="m-0 font-semibold text-chocolate">{{ stockForm.name }}</p>
              <p class="m-0 text-xs text-[var(--muted)]">
                {{ stockForm.shop_name || '—' }} · {{ stockForm.brand_name || '—' }}
              </p>
            </div>
          </div>

          <div class="grid grid-cols-3 gap-2 rounded-2xl bg-[#fff9f5] p-3 ring-1 ring-[var(--line)]">
            <div>
              <p class="m-0 text-[0.65rem] font-semibold uppercase text-[var(--muted)]">Was</p>
              <p class="m-0 text-lg font-bold text-chocolate">{{ stockForm.prev_qty }}</p>
            </div>
            <div>
              <p class="m-0 text-[0.65rem] font-semibold uppercase text-[var(--muted)]">Delta</p>
              <p
                class="m-0 text-lg font-bold"
                :class="delta < 0 ? 'text-[#c0392b]' : delta > 0 ? 'text-[#2e7d4f]' : 'text-chocolate'"
              >
                {{ delta > 0 ? '+' : '' }}{{ delta }}
              </p>
            </div>
            <div>
              <p class="m-0 text-[0.65rem] font-semibold uppercase text-[var(--muted)]">Alert @</p>
              <p class="m-0 text-lg font-bold text-chocolate">{{ stockForm.low_stock_threshold }}</p>
            </div>
          </div>

          <label>
            <span class="sc-label">New quantity</span>
            <input v-model.number="stockForm.stock_qty" type="number" min="0" step="1" class="sc-input !rounded-xl">
          </label>

          <label>
            <span class="sc-label">Reason</span>
            <select v-model="stockForm.reason" class="sc-input !rounded-xl">
              <option v-for="r in reasonOptions" :key="r.value" :value="r.value">{{ r.label }}</option>
            </select>
          </label>

          <label>
            <span class="sc-label">Note (optional)</span>
            <input v-model="stockForm.note" class="sc-input !rounded-xl" placeholder="e.g. shelf count, damaged tray">
          </label>

          <div class="flex flex-wrap gap-1.5">
            <UButton
              type="button"
              size="xs"
              color="neutral"
              variant="soft"
              label="+5"
              @click="stockForm.stock_qty = Number(stockForm.stock_qty || 0) + 5"
            />
            <UButton
              type="button"
              size="xs"
              color="neutral"
              variant="soft"
              label="+10"
              @click="stockForm.stock_qty = Number(stockForm.stock_qty || 0) + 10"
            />
            <UButton
              type="button"
              size="xs"
              color="neutral"
              variant="soft"
              :label="`Fill ${Math.max(20, stockForm.low_stock_threshold * 4)}`"
              @click="stockForm.stock_qty = Math.max(20, stockForm.low_stock_threshold * 4); stockForm.reason = 'receive'"
            />
            <UButton
              type="button"
              size="xs"
              color="neutral"
              variant="soft"
              label="Zero"
              @click="stockForm.stock_qty = 0; stockForm.reason = 'count'"
            />
          </div>

          <UButton
            v-if="stockForm.supplier_user_id"
            type="button"
            size="xs"
            color="secondary"
            variant="outline"
            icon="i-lucide-shopping-bag"
            label="Buy from this shop"
            :to="`/purchases?supplier_user_id=${stockForm.supplier_user_id}`"
          />

          <div class="sticky bottom-0 mt-2 flex gap-2 bg-[#fffaf8]/95 pt-2 backdrop-blur">
            <UButton type="submit" color="secondary" :loading="busy" label="Update stock" class="flex-1" />
            <UButton type="button" color="neutral" variant="soft" label="Cancel" @click="panelOpen = false" />
          </div>
        </form>
      </template>
    </USlideover>
  </div>
</template>

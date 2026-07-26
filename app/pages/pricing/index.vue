<script setup lang="ts">
import { apiError, money } from "~/utils/format"
import { patchListRow, upsertListRow } from "~/utils/list"
import { resolveMediaUrl } from "~/utils/mapPins"

const api = useApi()
const toast = useAppToast()
const config = useRuntimeConfig()
const socketLive = useState("adminSocketLive", () => false)
const { connect } = useSocket()

const loading = ref(true)
const refreshing = ref(false)
const error = ref("")
const rows = ref<Record<string, unknown>[]>([])
const shops = ref<Record<string, unknown>[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = 48
const q = ref("")
const shopFilter = ref(0)
const flag = ref<"all" | "live" | "low_margin" | "zero_cost" | "draft">("all")
const busy = ref(false)
const panelOpen = ref(false)
const stats = ref({
  total: 0,
  avg_customer_margin: 0,
  zero_cost: 0,
  low_margin: 0,
})

const edit = reactive({
  id: 0,
  name: "",
  shop_name: "",
  brand_name: "",
  cover_image_url: "",
  selling_price: 0,
  customer_price: 0,
  shop_price: 0,
  purchase_cost: 0,
  original_price: 0,
  discount_percent: 0,
  gst_rate: 5,
})

const filterTabs = [
  { value: "all" as const, label: "All" },
  { value: "live" as const, label: "Live" },
  { value: "low_margin" as const, label: "Low margin" },
  { value: "zero_cost" as const, label: "No cost" },
  { value: "draft" as const, label: "Drafts" },
]

const wholesalers = computed(() =>
  shops.value.filter(
    (s) => s.is_wholesaler !== false && String(s.approval_status || "approved") === "approved",
  ),
)

const canMore = computed(() => rows.value.length < total.value)

const editCustomerMargin = computed(() => {
  const c = Number(edit.customer_price) || Number(edit.selling_price) || 0
  const cost = Number(edit.purchase_cost) || 0
  return Math.round((c - cost) * 100) / 100
})

const editShopMargin = computed(() => {
  const s = Number(edit.shop_price) || 0
  const cost = Number(edit.purchase_cost) || 0
  return Math.round((s - cost) * 100) / 100
})

function thumb(r: Record<string, unknown>) {
  return resolveMediaUrl(String(r.cover_image_url || ""), String(config.public.apiBase || ""))
}

function hideBrokenImg(e: Event) {
  const el = e.target as HTMLImageElement | null
  if (el) el.style.display = "none"
}

function marginTone(m: unknown) {
  const n = Number(m)
  if (!Number.isFinite(n)) return "text-[var(--muted)]"
  if (n < 0) return "text-[#c0392b]"
  if (n < 15) return "text-[#e9748e]"
  return "text-[#2e7d4f]"
}

async function load(opts?: { quiet?: boolean; append?: boolean }) {
  if (opts?.quiet) refreshing.value = true
  else if (!opts?.append) loading.value = true
  error.value = ""
  try {
    if (!opts?.append) page.value = 1
    const [res, shopRows] = await Promise.all([
      api.admin.pricingProducts({
        page: page.value,
        page_size: pageSize,
        q: q.value.trim() || undefined,
        supplier_user_id: shopFilter.value || undefined,
        flag: flag.value === "all" ? undefined : flag.value,
      }),
      opts?.append ? Promise.resolve(shops.value) : api.admin.shops().catch(() => []),
    ])
    const items = Array.isArray(res.items) ? res.items : []
    rows.value = opts?.append ? [...rows.value, ...items] : items
    total.value = Number(res.total) || rows.value.length
    if (res.stats) {
      stats.value = {
        total: Number(res.stats.total) || 0,
        avg_customer_margin: Number(res.stats.avg_customer_margin) || 0,
        zero_cost: Number(res.stats.zero_cost) || 0,
        low_margin: Number(res.stats.low_margin) || 0,
      }
    }
    if (!opts?.append && Array.isArray(shopRows)) {
      shops.value = shopRows as Record<string, unknown>[]
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

function pick(r: Record<string, unknown>) {
  edit.id = Number(r.id)
  edit.name = String(r.name || "")
  edit.shop_name = String(r.shop_name || "")
  edit.brand_name = String(r.brand_name || "")
  edit.cover_image_url = String(r.cover_image_url || "")
  edit.selling_price = Number(r.selling_price) || 0
  edit.customer_price = Number(r.customer_price ?? r.customer_unit) || 0
  edit.shop_price = Number(r.shop_price ?? r.shop_unit) || 0
  edit.purchase_cost = Number(r.purchase_cost) || 0
  edit.original_price = Number(r.original_price) || 0
  edit.discount_percent = Number(r.discount_percent) || 0
  edit.gst_rate = Number(r.gst_rate) || 5
  panelOpen.value = true
}

function syncSelling() {
  if (!edit.selling_price && edit.customer_price) edit.selling_price = Number(edit.customer_price)
}

function matchShopToCost() {
  if (edit.purchase_cost) edit.shop_price = Number(edit.purchase_cost)
}

async function save() {
  if (!edit.id) return
  busy.value = true
  error.value = ""
  syncSelling()
  const patch = {
    selling_price: edit.selling_price,
    customer_price: edit.customer_price,
    shop_price: edit.shop_price,
    purchase_cost: edit.purchase_cost,
    original_price: edit.original_price || undefined,
    discount_percent: edit.discount_percent,
    gst_rate: edit.gst_rate,
  }
  try {
    const saved = (await api.admin.patchPricing(edit.id, patch)) as Record<string, unknown>
    if (!upsertListRow(rows, saved)) patchListRow(rows, edit.id, patch)
    toast.success("Prices saved", edit.name)
    panelOpen.value = false
    void load({ quiet: true })
  } catch (e) {
    error.value = apiError(e)
    toast.error(apiError(e))
  } finally {
    busy.value = false
  }
}

watch([flag, shopFilter], () => {
  void load()
})

let liveSocket: ReturnType<typeof connect> = null
const onAdminEvent = (data: Record<string, unknown>) => {
  const kind = String(data?.kind || "")
  if (kind.includes("product") || kind.includes("stock") || kind.includes("catalog") || kind.includes("po_")) {
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
        <h1 class="font-display m-0 text-2xl text-chocolate sm:text-3xl">Pricing</h1>
        <p class="m-0 mt-1 flex flex-wrap items-center gap-2 text-sm text-[var(--muted)]">
          <span
            class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.65rem] font-semibold"
            :class="socketLive ? 'bg-[#e8f6ee] text-[#2e7d4f]' : 'bg-[#f8ede6] text-[var(--muted)]'"
          >
            <span class="size-1.5 rounded-full" :class="socketLive ? 'animate-pulse bg-success' : 'bg-[#c4a39a]'" />
            {{ socketLive ? "Live" : "Offline" }}
          </span>
          <span>Customer · wholesale · cost · margins</span>
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
        <UButton to="/products" color="secondary" variant="outline" icon="i-lucide-package" label="Products" />
        <UButton to="/purchases" color="neutral" variant="outline" icon="i-lucide-shopping-bag" label="Buy" />
      </div>
    </div>

    <p v-if="error" class="mb-3 text-sm text-danger">{{ error }}</p>

    <div class="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="SKUs" :value="stats.total" icon="lucide:tags" />
      <StatCard label="Avg margin" :value="money(stats.avg_customer_margin)" icon="lucide:trending-up" tone="ok" />
      <StatCard label="Low margin" :value="stats.low_margin" icon="lucide:alert-triangle" tone="warn" />
      <StatCard label="No cost set" :value="stats.zero_cost" icon="lucide:circle-slash" />
    </div>

    <div class="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <label class="relative block w-full max-w-md">
        <UIcon name="i-lucide-search" class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--muted)]" />
        <input
          v-model="q"
          class="sc-input w-full !rounded-xl !py-2.5 !pl-9"
          placeholder="Search name or brand…"
          @keyup.enter="load()"
        >
      </label>
      <div class="flex flex-wrap gap-2">
        <select v-model.number="shopFilter" class="sc-input !w-auto !rounded-xl !py-2">
          <option :value="0">All shops</option>
          <option v-for="s in wholesalers" :key="String(s.user_id)" :value="Number(s.user_id)">
            {{ s.shop_name }}
          </option>
        </select>
        <UButton color="secondary" variant="soft" icon="i-lucide-search" label="Search" @click="load()" />
      </div>
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
        <span v-else-if="t.value === 'low_margin'"> {{ stats.low_margin }}</span>
        <span v-else-if="t.value === 'zero_cost'"> {{ stats.zero_cost }}</span>
      </button>
    </div>

    <p class="mb-3 text-sm text-[var(--muted)]">{{ total }} shown</p>

    <div v-if="loading" class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <div v-for="n in 6" :key="n" class="sc-skeleton h-40 rounded-2xl" />
    </div>

    <div
      v-else-if="!rows.length"
      class="rounded-2xl border border-dashed border-[var(--line)] py-16 text-center text-sm text-[var(--muted)]"
    >
      No priced products
    </div>

    <div v-else class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <article
        v-for="r in rows"
        :key="String(r.id)"
        class="rounded-2xl border border-[var(--line)] bg-white p-3.5 shadow-[0_8px_22px_-18px_rgba(74,44,42,0.35)] transition hover:border-[#e9748e]/35"
      >
        <div class="flex gap-3">
          <div class="size-14 shrink-0 overflow-hidden rounded-xl bg-[#fff5f7] ring-1 ring-[var(--line)]">
            <img
              v-if="thumb(r)"
              :src="thumb(r) || undefined"
              alt=""
              class="size-full object-cover"
              @error="hideBrokenImg"
            >
            <div v-else class="grid size-full place-items-center text-lg font-bold text-[#e9748e]">
              {{ String(r.name || '?').slice(0, 1) }}
            </div>
          </div>
          <div class="min-w-0 flex-1">
            <p class="m-0 truncate font-semibold text-chocolate">{{ r.name }}</p>
            <div class="mt-1 flex flex-wrap items-center gap-1.5">
              <span
                v-if="r.shop_name"
                class="inline-flex max-w-full items-center gap-1 truncate rounded-full bg-chocolate px-2 py-0.5 text-[0.65rem] font-semibold text-cream"
              >
                <UIcon name="i-lucide-store" class="size-3 shrink-0" />
                <span class="truncate">{{ r.shop_name }}</span>
              </span>
              <span
                v-if="r.category_name"
                class="rounded-full bg-[#fff0f2] px-2 py-0.5 text-[0.65rem] font-semibold text-[#e9748e]"
              >
                {{ r.category_name }}
              </span>
            </div>
            <p class="m-0 mt-1 truncate text-xs text-[var(--muted)]">{{ r.brand_name || '—' }}</p>
          </div>
        </div>

        <div class="mt-3 grid grid-cols-3 gap-2 rounded-xl bg-[#fff9f5] px-2.5 py-2 text-center">
          <div>
            <p class="m-0 text-[0.6rem] font-semibold uppercase tracking-wide text-[var(--muted)]">Customer</p>
            <p class="m-0 text-sm font-bold text-chocolate">{{ money(Number(r.customer_unit ?? r.customer_price)) }}</p>
          </div>
          <div>
            <p class="m-0 text-[0.6rem] font-semibold uppercase tracking-wide text-[var(--muted)]">Wholesale</p>
            <p class="m-0 text-sm font-bold text-chocolate">{{ money(Number(r.shop_unit ?? r.shop_price)) }}</p>
          </div>
          <div>
            <p class="m-0 text-[0.6rem] font-semibold uppercase tracking-wide text-[var(--muted)]">Cost</p>
            <p class="m-0 text-sm font-bold text-chocolate">{{ money(Number(r.purchase_cost)) }}</p>
          </div>
        </div>

        <div class="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
          <span :class="marginTone(r.customer_margin_pct)">
            Margin {{ r.customer_margin != null ? money(Number(r.customer_margin)) : '—' }}
            <template v-if="r.customer_margin_pct != null"> ({{ Number(r.customer_margin_pct).toFixed(0) }}%)</template>
          </span>
          <span class="text-[var(--muted)]">GST {{ Number(r.gst_rate) || 0 }}%</span>
        </div>

        <div class="mt-3 flex flex-wrap gap-1.5">
          <UButton size="xs" color="secondary" variant="soft" label="Edit prices" @click="pick(r)" />
          <UButton
            size="xs"
            color="neutral"
            variant="ghost"
            label="SKU"
            :to="`/products?q=${encodeURIComponent(String(r.name || ''))}`"
          />
        </div>
      </article>
    </div>

    <div v-if="canMore && !loading" class="mt-4 flex justify-center">
      <UButton color="neutral" variant="outline" :loading="refreshing" label="Load more" @click="loadMore" />
    </div>

    <USlideover
      v-model:open="panelOpen"
      side="right"
      :title="edit.name || 'Edit prices'"
      description="Customer · wholesale · cost · GST"
      :ui="{ content: 'w-full max-w-lg bg-[#fffaf8]' }"
    >
      <template #body>
        <form class="flex flex-col gap-3 pb-6" @submit.prevent="save">
          <div class="flex gap-3">
            <div class="size-16 shrink-0 overflow-hidden rounded-xl bg-[#fff5f7] ring-1 ring-[var(--line)]">
              <img
                v-if="edit.cover_image_url"
                :src="resolveMediaUrl(edit.cover_image_url, String(config.public.apiBase || '')) || undefined"
                alt=""
                class="size-full object-cover"
              >
              <div v-else class="grid size-full place-items-center font-bold text-[#e9748e]">
                {{ edit.name.slice(0, 1) || '?' }}
              </div>
            </div>
            <div class="min-w-0">
              <p class="m-0 font-semibold text-chocolate">{{ edit.name }}</p>
              <p class="m-0 text-xs text-[var(--muted)]">
                {{ edit.shop_name || '—' }} · {{ edit.brand_name || '—' }}
              </p>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-2 rounded-2xl bg-[#fff9f5] p-3 ring-1 ring-[var(--line)]">
            <div>
              <p class="m-0 text-[0.65rem] font-semibold uppercase text-[var(--muted)]">Customer margin</p>
              <p class="m-0 text-lg font-bold" :class="editCustomerMargin >= 0 ? 'text-[#2e7d4f]' : 'text-[#c0392b]'">
                {{ money(editCustomerMargin) }}
              </p>
            </div>
            <div>
              <p class="m-0 text-[0.65rem] font-semibold uppercase text-[var(--muted)]">Wholesale margin</p>
              <p class="m-0 text-lg font-bold" :class="editShopMargin >= 0 ? 'text-chocolate' : 'text-[#c0392b]'">
                {{ money(editShopMargin) }}
              </p>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <label>
              <span class="sc-label">Cost ₹</span>
              <input v-model.number="edit.purchase_cost" type="number" min="0" step="0.01" class="sc-input !rounded-xl">
            </label>
            <label>
              <span class="sc-label">Wholesale ₹</span>
              <input v-model.number="edit.shop_price" type="number" min="0" step="0.01" class="sc-input !rounded-xl">
            </label>
            <label>
              <span class="sc-label">Customer ₹</span>
              <input
                v-model.number="edit.customer_price"
                type="number"
                min="0"
                step="0.01"
                class="sc-input !rounded-xl"
                @blur="syncSelling"
              >
            </label>
            <label>
              <span class="sc-label">Selling ₹</span>
              <input v-model.number="edit.selling_price" type="number" min="0" step="0.01" class="sc-input !rounded-xl">
            </label>
            <label>
              <span class="sc-label">MRP ₹</span>
              <input v-model.number="edit.original_price" type="number" min="0" step="0.01" class="sc-input !rounded-xl">
            </label>
            <label>
              <span class="sc-label">Discount %</span>
              <input v-model.number="edit.discount_percent" type="number" min="0" step="0.1" class="sc-input !rounded-xl">
            </label>
            <label class="col-span-2">
              <span class="sc-label">GST %</span>
              <input v-model.number="edit.gst_rate" type="number" min="0" step="0.1" class="sc-input !rounded-xl">
            </label>
          </div>

          <UButton
            type="button"
            size="xs"
            color="neutral"
            variant="soft"
            label="Match wholesale = cost"
            @click="matchShopToCost"
          />

          <div class="sticky bottom-0 mt-2 flex gap-2 bg-[#fffaf8]/95 pt-2 backdrop-blur">
            <UButton type="submit" color="secondary" :loading="busy" label="Save prices" class="flex-1" />
            <UButton type="button" color="neutral" variant="soft" label="Cancel" @click="panelOpen = false" />
          </div>
        </form>
      </template>
    </USlideover>
  </div>
</template>

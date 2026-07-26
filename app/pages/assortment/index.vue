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
const q = ref("")
const filter = ref<"all" | "live" | "draft" | "trending" | "bestseller" | "festival">("all")
const rows = ref<Record<string, unknown>[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = 48
const busyId = ref<number | null>(null)
const stats = ref({
  total: 0,
  active: 0,
  draft: 0,
  trending: 0,
  bestseller: 0,
  festival: 0,
})

const filterTabs = [
  { label: "All", value: "all" as const },
  { label: "Live", value: "live" as const },
  { label: "Drafts", value: "draft" as const },
  { label: "Trending", value: "trending" as const },
  { label: "Bestseller", value: "bestseller" as const },
  { label: "Festival", value: "festival" as const },
]

const canMore = computed(() => rows.value.length < total.value)

const flagDefs = [
  { key: "is_active", on: "Active", off: "Off", tone: "ok" as const },
  { key: "is_draft", on: "Draft", off: "Live", tone: "warn" as const },
  { key: "is_trending", on: "Trending", off: "Trend", tone: "pink" as const },
  { key: "is_bestseller", on: "Bestseller", off: "Seller", tone: "pink" as const },
  { key: "is_festival", on: "Festival", off: "Fest", tone: "pink" as const },
]

function thumb(p: Record<string, unknown>) {
  return resolveMediaUrl(String(p.cover_image_url || ""), String(config.public.apiBase || ""))
}

function stars(n: unknown) {
  const full = Math.round(Math.max(0, Math.min(5, Number(n) || 0)))
  return "★".repeat(full) + "☆".repeat(5 - full)
}

function hideBrokenImg(e: Event) {
  const el = e.target as HTMLImageElement | null
  if (el) el.style.display = "none"
}

function flagClass(on: boolean, tone: "ok" | "warn" | "pink") {
  if (!on) return "bg-white text-[var(--muted)] ring-1 ring-[var(--line)]"
  if (tone === "ok") return "bg-[#e8f6ee] text-[#2e7d4f] ring-1 ring-[#cfe9d8]"
  if (tone === "warn") return "bg-[#fff0f2] text-[#e9748e] ring-1 ring-[#f7d4dc]"
  return "bg-chocolate text-cream"
}

async function load(opts?: { quiet?: boolean; append?: boolean }) {
  if (opts?.quiet) refreshing.value = true
  else if (!opts?.append) loading.value = true
  error.value = ""
  try {
    if (!opts?.append) page.value = 1
    const flag =
      filter.value === "all" || filter.value === "draft"
        ? undefined
        : filter.value
    const res = await api.admin.assortmentProducts({
      q: q.value.trim() || undefined,
      draft: filter.value === "draft" ? true : undefined,
      flag,
      page: page.value,
      page_size: pageSize,
    })
    const items = Array.isArray(res.items) ? res.items : []
    rows.value = opts?.append ? [...rows.value, ...items] : items
    total.value = Number(res.total) || rows.value.length
    if (res.stats) {
      stats.value = {
        total: Number(res.stats.total) || 0,
        active: Number(res.stats.active) || 0,
        draft: Number(res.stats.draft) || 0,
        trending: Number(res.stats.trending) || 0,
        bestseller: Number(res.stats.bestseller) || 0,
        festival: Number(res.stats.festival) || 0,
      }
    }
  } catch (e) {
    error.value = apiError(e)
  } finally {
    loading.value = false
    refreshing.value = false
  }
}

async function loadMore() {
  if (!canMore.value || busyId.value) return
  page.value += 1
  await load({ append: true, quiet: true })
}

async function toggle(row: Record<string, unknown>, key: string) {
  const id = Number(row.id)
  if (!id) return
  busyId.value = id
  error.value = ""
  const next = !row[key]
  // Draft off + active on when publishing via draft toggle
  const body: Record<string, unknown> = { [key]: next }
  if (key === "is_draft" && !next) body.is_active = true
  try {
    const saved = await api.admin.patchAssortment(id, body)
    if (!upsertListRow(rows, saved as Record<string, unknown>)) {
      patchListRow(rows, id, body)
    }
    toast.success("Updated", String(row.name || `#${id}`))
    void load({ quiet: true })
  } catch (e) {
    error.value = apiError(e)
    toast.error(apiError(e))
  } finally {
    busyId.value = null
  }
}

async function publishDrafts() {
  const drafts = rows.value.filter((r) => r.is_draft)
  if (!drafts.length) {
    toast.info("No drafts on this page")
    return
  }
  busyId.value = -1
  try {
    for (const r of drafts) {
      const id = Number(r.id)
      if (!id) continue
      const saved = await api.admin.patchAssortment(id, { is_draft: false, is_active: true })
      if (!upsertListRow(rows, saved as Record<string, unknown>)) {
        patchListRow(rows, id, { is_draft: false, is_active: true })
      }
    }
    toast.success("Published", `${drafts.length} draft(s) live`)
    void load({ quiet: true })
  } catch (e) {
    toast.error(apiError(e))
  } finally {
    busyId.value = null
  }
}

let liveSocket: ReturnType<typeof connect> = null
const onAdminEvent = (data: Record<string, unknown>) => {
  const kind = String(data?.kind || "")
  if (kind.includes("product") || kind.includes("stock") || kind.includes("catalog") || kind.includes("low_stock")) {
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
watch(filter, () => {
  void load()
})
</script>

<template>
  <div>
    <div class="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="font-display m-0 text-2xl text-chocolate sm:text-3xl">Assortment</h1>
        <p class="m-0 mt-1 flex flex-wrap items-center gap-2 text-sm text-[var(--muted)]">
          <span
            class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.65rem] font-semibold"
            :class="socketLive ? 'bg-[#e8f6ee] text-[#2e7d4f]' : 'bg-[#f8ede6] text-[var(--muted)]'"
          >
            <span class="size-1.5 rounded-full" :class="socketLive ? 'animate-pulse bg-success' : 'bg-[#c4a39a]'" />
            {{ socketLive ? "Live" : "Offline" }}
          </span>
          <span>Publish · draft · trending · bestseller · festival</span>
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
        <UButton
          color="neutral"
          variant="outline"
          icon="i-lucide-megaphone"
          label="Publish drafts"
          :disabled="busyId != null"
          @click="publishDrafts"
        />
        <UButton to="/products" color="secondary" icon="i-lucide-package" label="All products" />
      </div>
    </div>

    <p v-if="error" class="mb-3 text-sm text-danger">{{ error }}</p>

    <div class="mb-4 grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
      <StatCard label="SKUs" :value="stats.total" icon="lucide:layers" />
      <StatCard label="Live" :value="stats.active" icon="lucide:check-circle" tone="ok" />
      <StatCard label="Drafts" :value="stats.draft" icon="lucide:file-pen" />
      <StatCard label="Trending" :value="stats.trending" icon="lucide:flame" />
      <StatCard label="Bestseller" :value="stats.bestseller" icon="lucide:trophy" />
      <StatCard label="Festival" :value="stats.festival" icon="lucide:sparkles" />
    </div>

    <div class="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <label class="relative block w-full max-w-md">
        <UIcon name="i-lucide-search" class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--muted)]" />
        <input
          v-model="q"
          class="sc-input w-full !rounded-xl !py-2.5 !pl-9"
          placeholder="Search product or brand…"
          @keyup.enter="load()"
        >
      </label>
      <UButton color="secondary" variant="soft" icon="i-lucide-search" label="Search" @click="load()" />
    </div>

    <div class="mb-4 flex flex-wrap gap-1.5">
      <button
        v-for="t in filterTabs"
        :key="t.value"
        type="button"
        class="rounded-full px-3 py-1.5 text-xs font-semibold transition"
        :class="filter === t.value ? 'bg-chocolate text-cream' : 'bg-white text-chocolate ring-1 ring-[var(--line)]'"
        @click="filter = t.value"
      >
        {{ t.label }}
        <span v-if="t.value === 'all'"> {{ stats.total }}</span>
        <span v-else-if="t.value === 'live'"> {{ stats.active }}</span>
        <span v-else-if="t.value === 'draft'"> {{ stats.draft }}</span>
        <span v-else-if="t.value === 'trending'"> {{ stats.trending }}</span>
        <span v-else-if="t.value === 'bestseller'"> {{ stats.bestseller }}</span>
        <span v-else-if="t.value === 'festival'"> {{ stats.festival }}</span>
      </button>
    </div>

    <p class="mb-3 text-sm text-[var(--muted)]">{{ total }} shown</p>

    <div v-if="loading" class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <div v-for="n in 6" :key="n" class="sc-skeleton h-44 rounded-2xl" />
    </div>

    <div
      v-else-if="!rows.length"
      class="rounded-2xl border border-dashed border-[var(--line)] py-16 text-center text-sm text-[var(--muted)]"
    >
      No assortment rows — add products first.
    </div>

    <div v-else class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <article
        v-for="r in rows"
        :key="String(r.id)"
        class="rounded-2xl border border-[var(--line)] bg-white p-3.5 shadow-[0_8px_22px_-18px_rgba(74,44,42,0.35)]"
      >
        <div class="flex gap-3">
          <div class="size-16 shrink-0 overflow-hidden rounded-xl bg-[#fff5f7] ring-1 ring-[var(--line)]">
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
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
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
                <p class="m-0 mt-1 truncate text-xs text-[var(--muted)]">
                  {{ r.brand_name || '—' }}
                  <span v-if="Number(r.rating)"> · {{ stars(r.rating) }} {{ Number(r.rating).toFixed(1) }}</span>
                </p>
              </div>
              <StatusBadge v-if="r.stock_status" :status="String(r.stock_status)" />
            </div>
          </div>
        </div>

        <div class="mt-3 grid grid-cols-3 gap-2 rounded-xl bg-[#fff9f5] px-2.5 py-2 text-center">
          <div>
            <p class="m-0 text-[0.6rem] font-semibold uppercase tracking-wide text-[var(--muted)]">Customer</p>
            <p class="m-0 text-sm font-bold text-chocolate">{{ money(Number(r.customer_price ?? r.selling_price)) }}</p>
          </div>
          <div>
            <p class="m-0 text-[0.6rem] font-semibold uppercase tracking-wide text-[var(--muted)]">Stock</p>
            <p class="m-0 text-sm font-bold text-chocolate">{{ Number(r.stock_qty) || 0 }}</p>
          </div>
          <div>
            <p class="m-0 text-[0.6rem] font-semibold uppercase tracking-wide text-[var(--muted)]">Sales</p>
            <p class="m-0 text-sm font-bold text-chocolate">{{ Number(r.sales_count) || 0 }}</p>
          </div>
        </div>

        <div class="mt-3 flex flex-wrap gap-1.5">
          <button
            v-for="f in flagDefs"
            :key="f.key"
            type="button"
            class="rounded-full px-2.5 py-1 text-[0.7rem] font-semibold transition disabled:opacity-50"
            :class="flagClass(!!r[f.key], f.tone)"
            :disabled="busyId === Number(r.id) || busyId === -1"
            @click="toggle(r, f.key)"
          >
            {{ r[f.key] ? f.on : f.off }}
          </button>
        </div>

        <div class="mt-2 flex gap-1.5">
          <UButton size="xs" color="neutral" variant="ghost" label="Edit SKU" :to="`/products?q=${encodeURIComponent(String(r.name || ''))}`" />
          <UButton
            v-if="r.supplier_user_id"
            size="xs"
            color="neutral"
            variant="ghost"
            label="Shop SKUs"
            :to="`/products?supplier_user_id=${r.supplier_user_id}`"
          />
        </div>
      </article>
    </div>

    <div v-if="canMore && !loading" class="mt-4 flex justify-center">
      <UButton color="neutral" variant="outline" :loading="refreshing" label="Load more" @click="loadMore" />
    </div>
  </div>
</template>

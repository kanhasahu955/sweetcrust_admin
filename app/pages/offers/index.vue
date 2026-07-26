<script setup lang="ts">
import { apiError, money, relativeAgo, statusLabel } from "~/utils/format"
import { patchListRow, removeListRow, upsertListRow } from "~/utils/list"

const api = useApi()
const toast = useAppToast()
const { confirm } = useConfirm()
const socketLive = useState("adminSocketLive", () => false)
const { connect } = useSocket()

const rows = ref<Record<string, unknown>[]>([])
const loading = ref(true)
const refreshing = ref(false)
const busy = ref(false)
const error = ref("")
const q = ref("")
const flag = ref<"all" | "active" | "inactive" | "expired" | "platform" | "shop">("all")
const panelOpen = ref(false)

const stats = ref({
  total: 0,
  active: 0,
  inactive: 0,
  expired: 0,
  scheduled: 0,
  platform: 0,
  shop: 0,
  redemptions: 0,
})

const form = reactive({
  id: 0,
  code: "",
  title: "",
  description: "",
  coupon_type: "percentage",
  value: 10,
  min_order_amount: 0,
  max_discount: null as number | null,
  usage_limit: null as number | null,
  is_active: true,
})

const typeOptions = [
  { value: "percentage", label: "Percent %" },
  { value: "flat", label: "Flat ₹" },
]

const filterTabs = [
  { value: "all" as const, label: "All" },
  { value: "active" as const, label: "Active" },
  { value: "inactive" as const, label: "Off" },
  { value: "expired" as const, label: "Expired" },
  { value: "platform" as const, label: "Platform" },
  { value: "shop" as const, label: "Shop" },
]

const starters = [
  { code: "HOLI10", title: "Holi special", coupon_type: "percentage", value: 10, description: "Festival sweet treat" },
  { code: "FLAT50", title: "₹50 off", coupon_type: "flat", value: 50, description: "Min order applies" },
  { code: "WEEKEND15", title: "Weekend bake", coupon_type: "percentage", value: 15, description: "Sat–Sun orders" },
]

const filtered = computed(() => {
  const ql = q.value.trim().toLowerCase()
  return rows.value.filter((c) => {
    const life = String(c.lifecycle || (c.is_active === false ? "inactive" : "active"))
    if (flag.value === "active" && life !== "active") return false
    if (flag.value === "inactive" && life !== "inactive") return false
    if (flag.value === "expired" && life !== "expired") return false
    if (flag.value === "platform" && c.scope !== "platform") return false
    if (flag.value === "shop" && c.scope !== "shop") return false
    if (!ql) return true
    return (
      String(c.code || "").toLowerCase().includes(ql)
      || String(c.title || "").toLowerCase().includes(ql)
      || String(c.description || "").toLowerCase().includes(ql)
      || String(c.shop_name || "").toLowerCase().includes(ql)
    )
  })
})

function valueLabel(c: Record<string, unknown>) {
  const v = Number(c.value) || 0
  if (String(c.coupon_type) === "flat") return money(v)
  return `${v}%`
}

function lifeClass(life: unknown) {
  const s = String(life || "")
  if (s === "active") return "bg-[#e8f6ee] text-[#2e7d4f]"
  if (s === "expired" || s === "exhausted") return "bg-[#fdecea] text-[#c0392b]"
  if (s === "scheduled") return "bg-[#fff0f2] text-[#e9748e]"
  return "bg-[#f8ede6] text-[var(--muted)]"
}

function resetForm() {
  form.id = 0
  form.code = ""
  form.title = ""
  form.description = ""
  form.coupon_type = "percentage"
  form.value = 10
  form.min_order_amount = 0
  form.max_discount = null
  form.usage_limit = null
  form.is_active = true
}

function openCreate(starter?: (typeof starters)[number]) {
  resetForm()
  if (starter) {
    form.code = starter.code
    form.title = starter.title
    form.description = starter.description
    form.coupon_type = starter.coupon_type
    form.value = starter.value
  }
  panelOpen.value = true
}

function openEdit(c: Record<string, unknown>) {
  form.id = Number(c.id)
  form.code = String(c.code || "")
  form.title = String(c.title || "")
  form.description = String(c.description || "")
  form.coupon_type = String(c.coupon_type || "percentage")
  form.value = Number(c.value) || 0
  form.min_order_amount = Number(c.min_order_amount) || 0
  form.max_discount = c.max_discount != null ? Number(c.max_discount) : null
  form.usage_limit = c.usage_limit != null ? Number(c.usage_limit) : null
  form.is_active = c.is_active !== false
  panelOpen.value = true
}

function closePanel() {
  panelOpen.value = false
}

function parseList(data: unknown) {
  if (Array.isArray(data)) {
    rows.value = data as Record<string, unknown>[]
    stats.value = {
      total: rows.value.length,
      active: rows.value.filter((c) => c.is_active !== false).length,
      inactive: rows.value.filter((c) => c.is_active === false).length,
      expired: 0,
      scheduled: 0,
      platform: rows.value.filter((c) => !c.shop_user_id).length,
      shop: rows.value.filter((c) => c.shop_user_id).length,
      redemptions: rows.value.reduce((n, c) => n + (Number(c.orders_used) || Number(c.used_count) || 0), 0),
    }
    return
  }
  const obj = (data || {}) as { items?: unknown[], stats?: Record<string, number> }
  rows.value = Array.isArray(obj.items) ? (obj.items as Record<string, unknown>[]) : []
  if (obj.stats) {
    stats.value = {
      total: Number(obj.stats.total) || rows.value.length,
      active: Number(obj.stats.active) || 0,
      inactive: Number(obj.stats.inactive) || 0,
      expired: Number(obj.stats.expired) || 0,
      scheduled: Number(obj.stats.scheduled) || 0,
      platform: Number(obj.stats.platform) || 0,
      shop: Number(obj.stats.shop) || 0,
      redemptions: Number(obj.stats.redemptions) || 0,
    }
  }
}

async function load(opts: { quiet?: boolean } = {}) {
  if (opts.quiet) refreshing.value = true
  else loading.value = true
  error.value = ""
  try {
    parseList(await api.admin.coupons())
  } catch (e) {
    error.value = apiError(e)
    if (!opts.quiet) toast.error(error.value)
  } finally {
    loading.value = false
    refreshing.value = false
  }
}

async function save() {
  if (!form.code.trim() && !form.id) {
    toast.error("Coupon code required")
    return
  }
  if (!form.title.trim() && !form.code.trim()) {
    toast.error("Title or code required")
    return
  }
  busy.value = true
  try {
    const body: Record<string, unknown> = {
      title: form.title.trim() || form.code.trim().toUpperCase(),
      description: form.description.trim() || undefined,
      coupon_type: form.coupon_type,
      value: Number(form.value) || 0,
      min_order_amount: Number(form.min_order_amount) || 0,
      max_discount: form.max_discount != null && !Number.isNaN(Number(form.max_discount)) ? Number(form.max_discount) : null,
      usage_limit: form.usage_limit != null && !Number.isNaN(Number(form.usage_limit)) ? Number(form.usage_limit) : null,
      is_active: form.is_active,
    }
    let saved: Record<string, unknown>
    if (form.id) {
      saved = await api.admin.patchCoupon(form.id, body)
    } else {
      saved = await api.admin.createCoupon({
        ...body,
        code: form.code.trim().toUpperCase(),
      })
    }
    upsertListRow(rows, saved)
    toast.success(form.id ? "Offer updated" : "Offer created")
    panelOpen.value = false
    void load({ quiet: true })
  } catch (e) {
    toast.error(apiError(e))
  } finally {
    busy.value = false
  }
}

async function toggle(c: Record<string, unknown>) {
  busy.value = true
  try {
    const next = c.is_active === false
    const saved = await api.admin.patchCoupon(Number(c.id), { is_active: next })
    if (!upsertListRow(rows, saved)) patchListRow(rows, Number(c.id), { is_active: next, lifecycle: next ? "active" : "inactive" })
    toast.success(next ? "Offer enabled" : "Offer disabled")
    void load({ quiet: true })
  } catch (e) {
    toast.error(apiError(e))
  } finally {
    busy.value = false
  }
}

async function remove(c: Record<string, unknown>) {
  const ok = await confirm({
    title: "Delete offer",
    message: `Delete ${c.code || c.title}? Customers won’t be able to use this code.`,
    confirmText: "Delete",
    tone: "danger",
  })
  if (!ok) return
  busy.value = true
  try {
    await api.admin.deleteCoupon(Number(c.id))
    removeListRow(rows, Number(c.id))
    toast.success("Offer deleted")
    void load({ quiet: true })
  } catch (e) {
    toast.error(apiError(e))
  } finally {
    busy.value = false
  }
}

async function aiSuggest() {
  busy.value = true
  try {
    const s = await api.admin.aiCouponSuggest()
    openCreate()
    form.code = String(s.code || s.title || "OFFER").replace(/\W+/g, "").slice(0, 12).toUpperCase() || "OFFER"
    form.title = String(s.title || "")
    form.description = String(s.description || "")
    form.coupon_type = String(s.coupon_type || "percentage")
    form.value = Number(s.discount_amount ?? s.value) || 10
    form.min_order_amount = Number(s.min_order_amount) || 0
    form.max_discount = s.max_discount != null ? Number(s.max_discount) : null
    const provider = String(s.provider || "ai")
    const impact = s.expected_impact ? ` · ${s.expected_impact}` : ""
    toast.success(`AI filled (${provider})${impact}`)
  } catch (e) {
    toast.error(apiError(e))
  } finally {
    busy.value = false
  }
}

async function copyCode(code: unknown) {
  const text = String(code || "")
  if (!text || !import.meta.client) return
  try {
    await navigator.clipboard.writeText(text)
    toast.success(`Copied ${text}`)
  } catch {
    toast.info(text)
  }
}

let liveSocket: ReturnType<typeof connect> = null
onMounted(async () => {
  await load()
  liveSocket = connect()
  liveSocket?.on("admin_event", (data: Record<string, unknown>) => {
    const kind = String(data?.kind || "")
    if (kind.includes("coupon") || kind.includes("offer")) void load({ quiet: true })
  })
})
onBeforeUnmount(() => {
  liveSocket?.off("admin_event")
})
</script>

<template>
  <div>
    <div class="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="font-display m-0 text-2xl text-chocolate sm:text-3xl">Offers & Schemes</h1>
        <p class="m-0 mt-1 flex flex-wrap items-center gap-2 text-sm text-[var(--muted)]">
          <span
            class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.65rem] font-semibold"
            :class="socketLive ? 'bg-[#e8f6ee] text-[#2e7d4f]' : 'bg-[#f8ede6] text-[var(--muted)]'"
          >
            <span class="size-1.5 rounded-full" :class="socketLive ? 'animate-pulse bg-success' : 'bg-[#c4a39a]'" />
            {{ socketLive ? "Live" : "Offline" }}
          </span>
          <span>Festival codes · shop coupons · redemptions</span>
        </p>
      </div>
      <div class="flex flex-wrap gap-2">
        <UButton
          color="primary"
          variant="soft"
          icon="i-lucide-sparkles"
          :loading="busy"
          label="AI suggest"
          @click="aiSuggest"
        />
        <UButton color="secondary" icon="i-lucide-plus" label="New offer" @click="openCreate()" />
        <UButton
          color="primary"
          variant="soft"
          icon="i-lucide-refresh-cw"
          :loading="loading || refreshing"
          label="Refresh"
          @click="load()"
        />
      </div>
    </div>

    <p v-if="error" class="mb-3 text-sm text-danger">{{ error }}</p>

    <div v-if="loading" class="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <div v-for="n in 4" :key="n" class="sc-skeleton h-24 rounded-2xl" />
    </div>
    <div v-else class="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="Total offers" :value="stats.total" icon="lucide:tag" />
      <StatCard label="Active" :value="stats.active" icon="lucide:badge-check" tone="ok" />
      <StatCard label="Shop offers" :value="stats.shop" icon="lucide:store" />
      <StatCard label="Redemptions" :value="stats.redemptions" icon="lucide:shopping-bag" />
    </div>

    <div class="mb-4 grid gap-3 lg:grid-cols-3">
      <div class="rounded-2xl border border-[var(--line)] bg-white p-4 shadow-[0_8px_22px_-18px_rgba(74,44,42,0.35)] lg:col-span-2">
        <h2 class="font-display m-0 text-lg text-chocolate">Quick starters</h2>
        <p class="m-0 mt-1 text-xs text-[var(--muted)]">Tap to draft a festival code</p>
        <div class="mt-3 grid gap-2 sm:grid-cols-3">
          <button
            v-for="s in starters"
            :key="s.code"
            type="button"
            class="rounded-xl bg-[#fff9f5] px-3 py-3 text-left ring-1 ring-[var(--line)] transition hover:bg-[#fff0f2]"
            @click="openCreate(s)"
          >
            <p class="m-0 text-xs font-bold tracking-wide text-[#e9748e]">{{ s.code }}</p>
            <p class="m-0 mt-0.5 text-sm font-semibold text-chocolate">{{ s.title }}</p>
            <p class="m-0 text-xs text-[var(--muted)]">
              {{ s.coupon_type === "flat" ? money(s.value) : `${s.value}%` }}
            </p>
          </button>
        </div>
      </div>
      <div class="rounded-2xl border border-[var(--line)] bg-white p-4 shadow-[0_8px_22px_-18px_rgba(74,44,42,0.35)]">
        <h2 class="font-display m-0 text-lg text-chocolate">Snapshot</h2>
        <div class="mt-3 grid grid-cols-2 gap-2 text-center">
          <div class="rounded-xl bg-[#fff9f5] px-2 py-2">
            <p class="m-0 text-[0.6rem] font-semibold uppercase tracking-wide text-[var(--muted)]">Platform</p>
            <p class="m-0 text-lg font-bold text-chocolate">{{ stats.platform }}</p>
          </div>
          <div class="rounded-xl bg-[#fff9f5] px-2 py-2">
            <p class="m-0 text-[0.6rem] font-semibold uppercase tracking-wide text-[var(--muted)]">Expired</p>
            <p class="m-0 text-lg font-bold text-chocolate">{{ stats.expired }}</p>
          </div>
          <div class="rounded-xl bg-[#fff9f5] px-2 py-2">
            <p class="m-0 text-[0.6rem] font-semibold uppercase tracking-wide text-[var(--muted)]">Scheduled</p>
            <p class="m-0 text-lg font-bold text-chocolate">{{ stats.scheduled }}</p>
          </div>
          <div class="rounded-xl bg-[#fff9f5] px-2 py-2">
            <p class="m-0 text-[0.6rem] font-semibold uppercase tracking-wide text-[var(--muted)]">Off</p>
            <p class="m-0 text-lg font-bold text-chocolate">{{ stats.inactive }}</p>
          </div>
        </div>
      </div>
    </div>

    <div class="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <label class="relative block w-full max-w-md">
        <UIcon name="i-lucide-search" class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--muted)]" />
        <input
          v-model="q"
          class="sc-input w-full !rounded-xl !py-2.5 !pl-9"
          placeholder="Search code, title, shop…"
        >
      </label>
      <p class="m-0 text-sm text-[var(--muted)]">{{ filtered.length }} shown</p>
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
        <span v-if="t.value === 'active'"> {{ stats.active }}</span>
        <span v-else-if="t.value === 'shop'"> {{ stats.shop }}</span>
        <span v-else-if="t.value === 'platform'"> {{ stats.platform }}</span>
      </button>
    </div>

    <div v-if="loading" class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <div v-for="n in 6" :key="n" class="sc-skeleton h-40 rounded-2xl" />
    </div>
    <div
      v-else-if="!filtered.length"
      class="rounded-2xl border border-dashed border-[var(--line)] py-16 text-center text-sm text-[var(--muted)]"
    >
      No offers yet — create a festival code
    </div>
    <div v-else class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <article
        v-for="c in filtered"
        :key="String(c.id)"
        class="rounded-2xl border border-[var(--line)] bg-white p-3.5 shadow-[0_8px_22px_-18px_rgba(74,44,42,0.35)] transition hover:border-[#e9748e]/35"
      >
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <button
              type="button"
              class="m-0 truncate font-mono text-sm font-bold tracking-wide text-[#e9748e] hover:underline"
              @click="copyCode(c.code)"
            >
              {{ c.code }}
            </button>
            <p class="m-0 mt-0.5 truncate font-semibold text-chocolate">{{ c.title || "Offer" }}</p>
          </div>
          <span
            class="shrink-0 rounded-full px-2 py-0.5 text-[0.65rem] font-semibold capitalize"
            :class="lifeClass(c.lifecycle)"
          >
            {{ statusLabel(String(c.lifecycle || "—")) }}
          </span>
        </div>
        <p class="m-0 mt-1.5 line-clamp-2 text-xs text-[var(--muted)]">
          {{ c.description || "No description" }}
        </p>
        <div class="mt-2 flex flex-wrap gap-1">
          <span class="rounded-full bg-[#fff9f5] px-2 py-0.5 text-[0.65rem] font-semibold text-chocolate ring-1 ring-[var(--line)]">
            {{ valueLabel(c) }} off
          </span>
          <span class="rounded-full bg-[#fff9f5] px-2 py-0.5 text-[0.65rem] font-semibold capitalize text-chocolate ring-1 ring-[var(--line)]">
            {{ c.scope || "platform" }}
          </span>
          <span v-if="c.shop_name" class="rounded-full bg-[#fff0f2] px-2 py-0.5 text-[0.65rem] font-semibold text-[#e9748e]">
            {{ c.shop_name }}
          </span>
        </div>
        <div class="mt-3 grid grid-cols-3 gap-2 rounded-xl bg-[#fff9f5] px-2.5 py-2 text-center">
          <div>
            <p class="m-0 text-[0.55rem] font-semibold uppercase tracking-wide text-[var(--muted)]">Min</p>
            <p class="m-0 text-sm font-bold text-chocolate">{{ money(Number(c.min_order_amount || 0)) }}</p>
          </div>
          <div>
            <p class="m-0 text-[0.55rem] font-semibold uppercase tracking-wide text-[var(--muted)]">Used</p>
            <p class="m-0 text-sm font-bold text-chocolate">
              {{ c.orders_used ?? c.used_count ?? 0 }}<span v-if="c.usage_limit" class="text-[var(--muted)]">/{{ c.usage_limit }}</span>
            </p>
          </div>
          <div>
            <p class="m-0 text-[0.55rem] font-semibold uppercase tracking-wide text-[var(--muted)]">Created</p>
            <p class="m-0 truncate text-xs font-semibold text-chocolate">
              {{ c.created_at ? relativeAgo(String(c.created_at)) : "—" }}
            </p>
          </div>
        </div>
        <div class="mt-3 flex flex-wrap gap-1.5">
          <UButton size="xs" color="primary" variant="soft" icon="i-lucide-pencil" label="Edit" :disabled="busy" @click="openEdit(c)" />
          <UButton
            size="xs"
            color="neutral"
            variant="outline"
            :icon="c.is_active === false ? 'i-lucide-eye' : 'i-lucide-eye-off'"
            :label="c.is_active === false ? 'Enable' : 'Disable'"
            :disabled="busy"
            @click="toggle(c)"
          />
          <UButton size="xs" color="neutral" variant="ghost" class="text-danger" icon="i-lucide-trash-2" label="Delete" :disabled="busy" @click="remove(c)" />
        </div>
      </article>
    </div>

    <USlideover
      v-model:open="panelOpen"
      side="right"
      :title="form.id ? 'Edit offer' : 'New offer'"
      description="Platform festival codes customers and shops can apply"
      :ui="{ content: 'w-full max-w-lg bg-[#fffaf8]' }"
      @update:open="(v: boolean) => { if (!v) closePanel() }"
    >
      <template #body>
        <form class="flex flex-col gap-3 pb-6" @submit.prevent="save">
          <label>
            <span class="sc-label">Code</span>
            <input
              v-model="form.code"
              class="sc-input w-full !rounded-xl font-mono uppercase"
              placeholder="HOLI10"
              :disabled="!!form.id"
              required
            >
          </label>
          <label>
            <span class="sc-label">Title</span>
            <input v-model="form.title" class="sc-input w-full !rounded-xl" placeholder="Holi special">
          </label>
          <label>
            <span class="sc-label">Description</span>
            <textarea v-model="form.description" class="sc-input min-h-[80px] w-full !rounded-xl" placeholder="Shown in apps…" />
          </label>
          <div class="grid grid-cols-2 gap-2">
            <label>
              <span class="sc-label">Type</span>
              <select v-model="form.coupon_type" class="sc-input w-full !rounded-xl">
                <option v-for="o in typeOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
              </select>
            </label>
            <label>
              <span class="sc-label">Value</span>
              <input v-model.number="form.value" type="number" min="0" step="0.01" class="sc-input w-full !rounded-xl" required>
            </label>
            <label>
              <span class="sc-label">Min order ₹</span>
              <input v-model.number="form.min_order_amount" type="number" min="0" class="sc-input w-full !rounded-xl">
            </label>
            <label>
              <span class="sc-label">Max discount ₹</span>
              <input v-model.number="form.max_discount" type="number" min="0" class="sc-input w-full !rounded-xl" placeholder="Optional">
            </label>
            <label class="col-span-2">
              <span class="sc-label">Usage limit</span>
              <input v-model.number="form.usage_limit" type="number" min="1" class="sc-input w-full !rounded-xl" placeholder="Unlimited">
            </label>
          </div>
          <label class="flex items-center gap-2 text-sm text-chocolate">
            <input v-model="form.is_active" type="checkbox" class="size-4 rounded border-[var(--line)]">
            Active
          </label>
          <div class="flex flex-wrap gap-2 pt-1">
            <UButton color="secondary" type="submit" :loading="busy" :label="form.id ? 'Save changes' : 'Create offer'" />
            <UButton color="neutral" variant="outline" type="button" label="Cancel" @click="closePanel" />
          </div>
        </form>
      </template>
    </USlideover>
  </div>
</template>

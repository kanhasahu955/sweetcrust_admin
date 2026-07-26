<script setup lang="ts">
import { apiError, relativeAgo, statusLabel } from "~/utils/format"
import { patchListRow, removeListRow, upsertListRow } from "~/utils/list"
import { resolveMediaUrl } from "~/utils/mapPins"

const api = useApi()
const toast = useAppToast()
const { confirm } = useConfirm()
const config = useRuntimeConfig()
const socketLive = useState("adminSocketLive", () => false)
const { connect } = useSocket()

const rows = ref<Record<string, unknown>[]>([])
const loading = ref(true)
const refreshing = ref(false)
const busy = ref(false)
const uploading = ref(false)
const error = ref("")
const q = ref("")
const flag = ref<"all" | "active" | "inactive" | "platform" | "shop">("all")
const panelOpen = ref(false)
const fileRef = ref<HTMLInputElement | null>(null)

const stats = ref({
  total: 0,
  active: 0,
  inactive: 0,
  platform: 0,
  shop: 0,
})

const form = reactive({
  id: 0,
  title: "",
  subtitle: "",
  image_url: "",
  link_type: "none",
  link_value: "",
  is_active: true,
  sort_order: 0,
})

const linkOptions = [
  { value: "none", label: "No link" },
  { value: "product", label: "Product id" },
  { value: "category", label: "Category id" },
  { value: "coupon", label: "Coupon code" },
  { value: "url", label: "External URL" },
]

const filterTabs = [
  { value: "all" as const, label: "All" },
  { value: "active" as const, label: "Active" },
  { value: "inactive" as const, label: "Off" },
  { value: "platform" as const, label: "Platform" },
  { value: "shop" as const, label: "Shop" },
]

const filtered = computed(() => {
  const ql = q.value.trim().toLowerCase()
  return rows.value.filter((b) => {
    if (flag.value === "active" && b.is_active === false) return false
    if (flag.value === "inactive" && b.is_active !== false) return false
    if (flag.value === "platform" && b.scope !== "platform") return false
    if (flag.value === "shop" && b.scope !== "shop") return false
    if (!ql) return true
    return (
      String(b.title || "").toLowerCase().includes(ql)
      || String(b.subtitle || "").toLowerCase().includes(ql)
      || String(b.shop_name || "").toLowerCase().includes(ql)
      || String(b.link_type || "").toLowerCase().includes(ql)
      || String(b.link_value || "").toLowerCase().includes(ql)
    )
  })
})

function thumb(url: unknown) {
  const s = String(url || "")
  if (!s || s.startsWith("theme:")) return ""
  return resolveMediaUrl(s, String(config.public.apiBase || ""))
}

function themeColor(url: unknown) {
  const s = String(url || "")
  if (!s.startsWith("theme:")) return ""
  const c = s.slice(6).trim()
  return c.startsWith("#") ? c : `#${c}`
}

function hideBrokenImg(e: Event) {
  const el = e.target as HTMLImageElement | null
  if (el) el.style.display = "none"
}

function resetForm() {
  form.id = 0
  form.title = ""
  form.subtitle = ""
  form.image_url = ""
  form.link_type = "none"
  form.link_value = ""
  form.is_active = true
  form.sort_order = 0
}

function openCreate() {
  resetForm()
  panelOpen.value = true
}

function openEdit(b: Record<string, unknown>) {
  form.id = Number(b.id)
  form.title = String(b.title || "")
  form.subtitle = String(b.subtitle || "")
  form.image_url = String(b.image_url || "")
  form.link_type = String(b.link_type || "none")
  form.link_value = String(b.link_value || "")
  form.is_active = b.is_active !== false
  form.sort_order = Number(b.sort_order) || 0
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
      active: rows.value.filter((b) => b.is_active !== false).length,
      inactive: rows.value.filter((b) => b.is_active === false).length,
      platform: rows.value.filter((b) => !b.shop_user_id).length,
      shop: rows.value.filter((b) => b.shop_user_id).length,
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
      platform: Number(obj.stats.platform) || 0,
      shop: Number(obj.stats.shop) || 0,
    }
  }
}

async function load(opts: { quiet?: boolean } = {}) {
  if (opts.quiet) refreshing.value = true
  else loading.value = true
  error.value = ""
  try {
    parseList(await api.admin.banners())
  } catch (e) {
    error.value = apiError(e)
    if (!opts.quiet) toast.error(error.value)
  } finally {
    loading.value = false
    refreshing.value = false
  }
}

async function save() {
  if (!form.title.trim()) {
    toast.error("Title required")
    return
  }
  if (!form.image_url.trim()) {
    toast.error("Image URL or upload required")
    return
  }
  busy.value = true
  try {
    const body = {
      title: form.title.trim(),
      subtitle: form.subtitle.trim() || undefined,
      image_url: form.image_url.trim(),
      link_type: form.link_type,
      link_value: form.link_type === "none" ? undefined : form.link_value.trim() || undefined,
      is_active: form.is_active,
      sort_order: Number(form.sort_order) || 0,
    }
    const saved = form.id
      ? await api.admin.patchBanner(form.id, body)
      : await api.admin.createBanner(body)
    upsertListRow(rows, saved)
    toast.success(form.id ? "Banner updated" : "Banner created")
    panelOpen.value = false
    void load({ quiet: true })
  } catch (e) {
    toast.error(apiError(e))
  } finally {
    busy.value = false
  }
}

async function toggle(b: Record<string, unknown>) {
  busy.value = true
  try {
    const next = b.is_active === false
    const saved = await api.admin.patchBanner(Number(b.id), { is_active: next })
    if (!upsertListRow(rows, saved)) patchListRow(rows, Number(b.id), { is_active: next })
    toast.success(next ? "Banner enabled" : "Banner disabled")
    void load({ quiet: true })
  } catch (e) {
    toast.error(apiError(e))
  } finally {
    busy.value = false
  }
}

async function remove(b: Record<string, unknown>) {
  const ok = await confirm({
    title: "Delete banner",
    message: `Delete “${b.title}”? It will disappear from the app carousel.`,
    confirmText: "Delete",
    tone: "danger",
  })
  if (!ok) return
  busy.value = true
  try {
    await api.admin.deleteBanner(Number(b.id))
    removeListRow(rows, Number(b.id))
    toast.success("Banner deleted")
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
    const s = await api.admin.aiBannerSuggest()
    openCreate()
    form.title = String(s.title || "")
    form.subtitle = String(s.subtitle || "")
    form.image_url = String(s.image_url || form.image_url || "")
    form.link_type = String(s.link_type || "none")
    form.link_value = s.link_value != null ? String(s.link_value) : ""
    form.is_active = s.is_active !== false
    toast.success(`AI filled (${String(s.provider || "ai")})`)
  } catch (e) {
    toast.error(apiError(e))
  } finally {
    busy.value = false
  }
}

async function onPickFile(ev: Event) {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ""
  if (!file) return
  if (!file.type.startsWith("image/")) {
    toast.error("Pick an image file (JPG, PNG, WebP…)")
    return
  }
  if (file.size > 15 * 1024 * 1024) {
    toast.error("Max 15MB")
    return
  }
  uploading.value = true
  try {
    const res = await api.uploadFile(file, "banner", "sweetcrust")
    const url = String(res?.url || "")
    if (!url) throw new Error("Upload returned no URL")
    form.image_url = url
    toast.success(res.provider === "imagekit" ? "Photo uploaded (ImageKit)" : "Photo uploaded")
  } catch (e) {
    toast.error(apiError(e))
  } finally {
    uploading.value = false
  }
}

let liveSocket: ReturnType<typeof connect> = null
onMounted(async () => {
  await load()
  liveSocket = connect()
  liveSocket?.on("admin_event", (data: Record<string, unknown>) => {
    const kind = String(data?.kind || "")
    if (kind.includes("banner")) void load({ quiet: true })
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
        <h1 class="font-display m-0 text-2xl text-chocolate sm:text-3xl">Banners</h1>
        <p class="m-0 mt-1 flex flex-wrap items-center gap-2 text-sm text-[var(--muted)]">
          <span
            class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.65rem] font-semibold"
            :class="socketLive ? 'bg-[#e8f6ee] text-[#2e7d4f]' : 'bg-[#f8ede6] text-[var(--muted)]'"
          >
            <span class="size-1.5 rounded-full" :class="socketLive ? 'animate-pulse bg-success' : 'bg-[#c4a39a]'" />
            {{ socketLive ? "Live" : "Offline" }}
          </span>
          <span>Home carousel for customer & shop apps</span>
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
        <UButton color="secondary" icon="i-lucide-plus" label="New banner" @click="openCreate()" />
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
      <StatCard label="Total banners" :value="stats.total" icon="lucide:image" />
      <StatCard label="Active" :value="stats.active" icon="lucide:badge-check" tone="ok" />
      <StatCard label="Platform" :value="stats.platform" icon="lucide:layout-template" />
      <StatCard label="Shop banners" :value="stats.shop" icon="lucide:store" />
    </div>

    <div class="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <label class="relative block w-full max-w-md">
        <UIcon name="i-lucide-search" class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--muted)]" />
        <input
          v-model="q"
          class="sc-input w-full !rounded-xl !py-2.5 !pl-9"
          placeholder="Search title, link, shop…"
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
        <span v-else-if="t.value === 'platform'"> {{ stats.platform }}</span>
        <span v-else-if="t.value === 'shop'"> {{ stats.shop }}</span>
      </button>
    </div>

    <div v-if="loading" class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <div v-for="n in 6" :key="n" class="sc-skeleton h-52 rounded-2xl" />
    </div>
    <div
      v-else-if="!filtered.length"
      class="rounded-2xl border border-dashed border-[var(--line)] py-16 text-center text-sm text-[var(--muted)]"
    >
      No banners yet — use AI suggest or create one
    </div>
    <div v-else class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <article
        v-for="b in filtered"
        :key="String(b.id)"
        class="overflow-hidden rounded-2xl border border-[var(--line)] bg-white shadow-[0_8px_22px_-18px_rgba(74,44,42,0.35)] transition hover:border-[#e9748e]/35"
        :class="b.is_active === false ? 'opacity-70' : ''"
      >
        <div class="relative h-36 w-full bg-[#fff5f7]">
          <img
            v-if="thumb(b.image_url)"
            :src="thumb(b.image_url) || undefined"
            alt=""
            class="size-full object-cover"
            @error="hideBrokenImg"
          >
          <div
            v-else-if="themeColor(b.image_url)"
            class="size-full"
            :style="{ background: `linear-gradient(135deg, ${themeColor(b.image_url)}, #4a2c2a)` }"
          />
          <div v-else class="grid size-full place-items-center text-[#e9748e]">
            <UIcon name="i-lucide-image" class="size-8" />
          </div>
          <span
            class="absolute top-2 right-2 rounded-full px-2 py-0.5 text-[0.65rem] font-semibold"
            :class="b.is_active !== false ? 'bg-[#e8f6ee] text-[#2e7d4f]' : 'bg-[#f8ede6] text-[var(--muted)]'"
          >
            {{ b.is_active !== false ? "Active" : "Off" }}
          </span>
        </div>
        <div class="p-3.5">
          <p class="m-0 font-semibold text-chocolate">{{ b.title }}</p>
          <p class="m-0 mt-0.5 line-clamp-2 text-xs text-[var(--muted)]">{{ b.subtitle || "—" }}</p>
          <div class="mt-2 flex flex-wrap gap-1">
            <span class="rounded-full bg-[#fff9f5] px-2 py-0.5 text-[0.65rem] font-semibold capitalize text-chocolate ring-1 ring-[var(--line)]">
              {{ b.scope || "platform" }}
            </span>
            <span class="rounded-full bg-[#fff9f5] px-2 py-0.5 text-[0.65rem] font-semibold capitalize text-chocolate ring-1 ring-[var(--line)]">
              {{ statusLabel(String(b.link_type || "none")) }}
              <template v-if="b.link_value"> · {{ b.link_value }}</template>
            </span>
            <span v-if="b.shop_name" class="rounded-full bg-[#fff0f2] px-2 py-0.5 text-[0.65rem] font-semibold text-[#e9748e]">
              {{ b.shop_name }}
            </span>
          </div>
          <p class="m-0 mt-2 text-[0.65rem] text-[var(--muted)]">
            Sort {{ b.sort_order ?? 0 }}
            <span v-if="b.created_at"> · {{ relativeAgo(String(b.created_at)) }}</span>
          </p>
          <div class="mt-3 flex flex-wrap gap-1.5">
            <UButton size="xs" color="primary" variant="soft" icon="i-lucide-pencil" label="Edit" :disabled="busy" @click="openEdit(b)" />
            <UButton
              size="xs"
              color="neutral"
              variant="outline"
              :icon="b.is_active === false ? 'i-lucide-eye' : 'i-lucide-eye-off'"
              :label="b.is_active === false ? 'Enable' : 'Disable'"
              :disabled="busy"
              @click="toggle(b)"
            />
            <UButton size="xs" color="neutral" variant="ghost" class="text-danger" icon="i-lucide-trash-2" label="Delete" :disabled="busy" @click="remove(b)" />
          </div>
        </div>
      </article>
    </div>

    <USlideover
      v-model:open="panelOpen"
      side="right"
      :title="form.id ? 'Edit banner' : 'New banner'"
      description="Shown on the home carousel when active"
      :ui="{ content: 'w-full max-w-lg bg-[#fffaf8]' }"
      @update:open="(v: boolean) => { if (!v) closePanel() }"
    >
      <template #body>
        <form class="flex flex-col gap-3 pb-6" @submit.prevent="save">
          <div class="relative h-44 overflow-hidden rounded-2xl bg-[#fff5f7] ring-1 ring-[var(--line)]">
            <img
              v-if="thumb(form.image_url)"
              :src="thumb(form.image_url) || undefined"
              alt=""
              class="size-full object-cover"
              @error="hideBrokenImg"
            >
            <div
              v-else-if="themeColor(form.image_url)"
              class="size-full"
              :style="{ background: `linear-gradient(135deg, ${themeColor(form.image_url)}, #4a2c2a)` }"
            />
            <div v-else class="grid size-full place-items-center text-sm text-[var(--muted)]">
              <div class="text-center">
                <UIcon name="i-lucide-image-plus" class="mx-auto mb-1 size-8 text-[#e9748e]/70" />
                <p class="m-0">Banner photo</p>
              </div>
            </div>
            <div class="absolute inset-x-0 bottom-0 flex flex-wrap gap-2 bg-gradient-to-t from-chocolate/70 to-transparent p-3">
              <UButton
                type="button"
                size="xs"
                color="secondary"
                icon="i-lucide-upload"
                :loading="uploading"
                label="Upload photo"
                @click="fileRef?.click()"
              />
              <UButton
                v-if="form.image_url"
                type="button"
                size="xs"
                color="neutral"
                variant="soft"
                label="Clear"
                @click="form.image_url = ''"
              />
            </div>
            <input ref="fileRef" type="file" accept="image/*" class="hidden" @change="onPickFile">
          </div>

          <label>
            <span class="sc-label">Title</span>
            <input v-model="form.title" class="sc-input w-full !rounded-xl" required>
          </label>
          <label>
            <span class="sc-label">Subtitle</span>
            <input v-model="form.subtitle" class="sc-input w-full !rounded-xl" placeholder="Short CTA line">
          </label>
          <label>
            <span class="sc-label">Or paste image URL</span>
            <input v-model="form.image_url" class="sc-input w-full !rounded-xl" placeholder="https://… · /uploads/… · theme:#e9748e">
          </label>
          <div class="grid grid-cols-2 gap-2">
            <label>
              <span class="sc-label">Link type</span>
              <select v-model="form.link_type" class="sc-input w-full !rounded-xl">
                <option v-for="o in linkOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
              </select>
            </label>
            <label>
              <span class="sc-label">Link value</span>
              <input
                v-model="form.link_value"
                class="sc-input w-full !rounded-xl"
                :disabled="form.link_type === 'none'"
                :placeholder="form.link_type === 'coupon' ? 'HOLI10' : 'id or url'"
              >
            </label>
            <label>
              <span class="sc-label">Sort order</span>
              <input v-model.number="form.sort_order" type="number" class="sc-input w-full !rounded-xl">
            </label>
            <label class="flex items-end gap-2 pb-2 text-sm text-chocolate">
              <input v-model="form.is_active" type="checkbox" class="size-4 rounded border-[var(--line)]">
              Active
            </label>
          </div>
          <div class="flex flex-wrap gap-2 pt-1">
            <UButton color="secondary" type="submit" :loading="busy || uploading" :label="form.id ? 'Save changes' : 'Create banner'" />
            <UButton color="neutral" variant="outline" type="button" label="Cancel" @click="closePanel" />
          </div>
        </form>
      </template>
    </USlideover>
  </div>
</template>

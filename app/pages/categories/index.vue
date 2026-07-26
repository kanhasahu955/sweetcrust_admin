<script setup lang="ts">
import { apiError, relativeAgo } from "~/utils/format"
import { patchListRow, upsertListRow } from "~/utils/list"
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
const flag = ref<"all" | "active" | "off" | "platform" | "shop">("all")
const panelOpen = ref(false)
const fileRef = ref<HTMLInputElement | null>(null)

const form = reactive({
  id: 0,
  name: "",
  description: "",
  image_url: "",
  display_order: 0,
  is_active: true,
  parent_id: 0,
  product_count: 0,
  source: "platform",
  owner_shop_name: "",
})

const filterTabs = [
  { value: "all" as const, label: "All" },
  { value: "active" as const, label: "Active" },
  { value: "off" as const, label: "Off" },
  { value: "platform" as const, label: "Platform" },
  { value: "shop" as const, label: "Shop" },
]

const stats = computed(() => {
  const list = rows.value
  return {
    total: list.length,
    active: list.filter((r) => r.is_active !== false).length,
    off: list.filter((r) => r.is_active === false).length,
    shop: list.filter((r) => r.source === "shop").length,
    products: list.reduce((n, r) => n + (Number(r.product_count) || 0), 0),
  }
})

const parentOptions = computed(() =>
  rows.value
    .filter((r) => r.is_active !== false && Number(r.id) !== form.id)
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""))),
)

const filtered = computed(() => {
  const ql = q.value.trim().toLowerCase()
  const list = rows.value.filter((r) => {
    if (flag.value === "active" && r.is_active === false) return false
    if (flag.value === "off" && r.is_active !== false) return false
    if (flag.value === "platform" && r.source === "shop") return false
    if (flag.value === "shop" && r.source !== "shop") return false
    if (!ql) return true
    return (
      String(r.name || "").toLowerCase().includes(ql)
      || String(r.description || "").toLowerCase().includes(ql)
      || String(r.owner_shop_name || "").toLowerCase().includes(ql)
      || String(r.slug || "").toLowerCase().includes(ql)
    )
  })
  return list.sort((a, b) => {
    const aa = a.is_active === false ? 1 : 0
    const bb = b.is_active === false ? 1 : 0
    if (aa !== bb) return aa - bb
    const oa = Number(a.display_order) || 0
    const ob = Number(b.display_order) || 0
    if (oa !== ob) return oa - ob
    return String(a.name || "").localeCompare(String(b.name || ""))
  })
})

function thumb(url: unknown) {
  return resolveMediaUrl(String(url || ""), String(config.public.apiBase || ""))
}

function hideBrokenImg(e: Event) {
  const el = e.target as HTMLImageElement | null
  if (el) el.style.display = "none"
}

function initial(label: unknown) {
  const s = String(label || "?").trim()
  return (s[0] || "?").toUpperCase()
}

function resetForm() {
  form.id = 0
  form.name = ""
  form.description = ""
  form.image_url = ""
  form.display_order = rows.value.length
  form.is_active = true
  form.parent_id = 0
  form.product_count = 0
  form.source = "platform"
  form.owner_shop_name = ""
}

function openCreate() {
  resetForm()
  panelOpen.value = true
}

function openEdit(c: Record<string, unknown>) {
  form.id = Number(c.id)
  form.name = String(c.name || "")
  form.description = String(c.description || "")
  form.image_url = String(c.image_url || "")
  form.display_order = Number(c.display_order) || 0
  form.is_active = c.is_active !== false
  form.parent_id = Number(c.parent_id) || 0
  form.product_count = Number(c.product_count) || 0
  form.source = String(c.source || "platform")
  form.owner_shop_name = String(c.owner_shop_name || "")
  panelOpen.value = true
}

async function load(opts?: { quiet?: boolean }) {
  if (opts?.quiet) refreshing.value = true
  else loading.value = true
  error.value = ""
  try {
    const data = await api.admin.categories()
    rows.value = Array.isArray(data) ? (data as Record<string, unknown>[]) : []
  } catch (e) {
    error.value = apiError(e)
    toast.error("Could not load categories", apiError(e))
  } finally {
    loading.value = false
    refreshing.value = false
  }
}

async function onPickFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ""
  if (!file) return
  if (!file.type.startsWith("image/")) {
    toast.error("Pick an image file")
    return
  }
  uploading.value = true
  try {
    const res = await api.uploadFile(file, "category")
    const url = String(res?.url || "")
    if (!url) throw new Error("Upload failed")
    form.image_url = url
    toast.success("Image uploaded")
  } catch (err) {
    toast.error(apiError(err))
  } finally {
    uploading.value = false
  }
}

async function aiImage() {
  if (!form.name.trim()) {
    toast.info("Enter a category name first")
    return
  }
  busy.value = true
  try {
    const res = await api.admin.aiCategoryImage(form.name.trim())
    const url = String(res.image_url || "")
    if (!url) {
      toast.error("AI image returned no URL")
      return
    }
    form.image_url = url
    toast.success(
      res.stub ? "Placeholder only" : "Photo ready",
      res.stub ? String(res.note || "Configure OpenAI for real images") : "Save to keep this image",
    )
  } catch (e) {
    toast.error("AI image failed", apiError(e))
  } finally {
    busy.value = false
  }
}

async function save() {
  if (!form.name.trim()) {
    toast.info("Enter a category name")
    return
  }
  busy.value = true
  error.value = ""
  const body = {
    name: form.name.trim(),
    description: form.description.trim() || null,
    image_url: form.image_url.trim() || null,
    display_order: Number(form.display_order) || 0,
    is_active: form.is_active,
    parent_id: form.parent_id || null,
  }
  try {
    if (form.id) {
      const updated = (await api.admin.updateCategory(form.id, body)) as Record<string, unknown>
      if (!upsertListRow(rows, updated)) patchListRow(rows, form.id, body)
      toast.success("Category updated", form.name)
    } else {
      const created = (await api.admin.createCategory(body)) as Record<string, unknown>
      upsertListRow(rows, created)
      toast.success("Category added", form.name)
    }
    panelOpen.value = false
    void load({ quiet: true })
  } catch (e) {
    error.value = apiError(e)
    toast.error(form.id ? "Update failed" : "Add failed", apiError(e))
  } finally {
    busy.value = false
  }
}

async function setActive(c: Record<string, unknown>, active: boolean) {
  const id = Number(c.id)
  if (!active) {
    const ok = await confirm({
      title: "Disable category",
      message: `Disable “${c.name}”? Hidden from new product assignment.`,
      confirmText: "Disable",
      tone: "danger",
    })
    if (!ok) return
  }
  busy.value = true
  try {
    if (!active) {
      await api.admin.deleteCategory(id)
      patchListRow(rows, id, { is_active: false })
      toast.success("Category disabled")
    } else {
      const updated = (await api.admin.updateCategory(id, {
        name: String(c.name || ""),
        is_active: true,
      })) as Record<string, unknown>
      if (!upsertListRow(rows, updated)) patchListRow(rows, id, { is_active: true })
      toast.success("Category enabled")
    }
    void load({ quiet: true })
  } catch (e) {
    toast.error(active ? "Enable failed" : "Disable failed", apiError(e))
  } finally {
    busy.value = false
  }
}

async function bumpOrder(c: Record<string, unknown>, dir: -1 | 1) {
  const id = Number(c.id)
  const next = Math.max(0, (Number(c.display_order) || 0) + dir)
  busy.value = true
  try {
    const updated = (await api.admin.updateCategory(id, {
      name: String(c.name || ""),
      display_order: next,
    })) as Record<string, unknown>
    if (!upsertListRow(rows, updated)) patchListRow(rows, id, { display_order: next })
  } catch (e) {
    toast.error(apiError(e))
  } finally {
    busy.value = false
  }
}

let liveSocket: ReturnType<typeof connect> = null
const onAdminEvent = (data: Record<string, unknown>) => {
  const kind = String(data?.kind || "")
  if (kind.includes("product") || kind.includes("catalog") || kind.includes("categor")) {
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
        <h1 class="font-display m-0 text-2xl text-chocolate sm:text-3xl">Categories</h1>
        <p class="m-0 mt-1 flex flex-wrap items-center gap-2 text-sm text-[var(--muted)]">
          <span
            class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.65rem] font-semibold"
            :class="socketLive ? 'bg-[#e8f6ee] text-[#2e7d4f]' : 'bg-[#f8ede6] text-[var(--muted)]'"
          >
            <span class="size-1.5 rounded-full" :class="socketLive ? 'animate-pulse bg-success' : 'bg-[#c4a39a]'" />
            {{ socketLive ? "Live" : "Offline" }}
          </span>
          <span>Shelf groups for the catalog — pickles, papad, namkeen, bakery</span>
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
        <UButton color="secondary" icon="i-lucide-plus" label="Add category" @click="openCreate" />
      </div>
    </div>

    <p v-if="error" class="mb-3 text-sm text-danger">{{ error }}</p>

    <div class="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="Categories" :value="stats.total" icon="lucide:folder-tree" />
      <StatCard label="Active" :value="stats.active" icon="lucide:check-circle" tone="ok" />
      <StatCard label="Shop-owned" :value="stats.shop" icon="lucide:store" />
      <StatCard label="SKUs linked" :value="stats.products" icon="lucide:package" />
    </div>

    <div class="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <label class="relative block w-full max-w-md">
        <UIcon name="i-lucide-search" class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--muted)]" />
        <input
          v-model="q"
          class="sc-input w-full !rounded-xl !py-2.5 !pl-9"
          placeholder="Search name, shop, description…"
        >
      </label>
      <p class="m-0 text-sm text-[var(--muted)]">{{ filtered.length }} shown · {{ stats.active }} active</p>
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
        <span v-else-if="t.value === 'active'"> {{ stats.active }}</span>
        <span v-else-if="t.value === 'off'"> {{ stats.off }}</span>
        <span v-else-if="t.value === 'shop'"> {{ stats.shop }}</span>
      </button>
    </div>

    <div v-if="loading" class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <div v-for="n in 6" :key="n" class="sc-skeleton h-40 rounded-2xl" />
    </div>

    <div
      v-else-if="!filtered.length"
      class="rounded-2xl border border-dashed border-[var(--line)] py-16 text-center text-sm text-[var(--muted)]"
    >
      No categories match — add a shelf group to get started.
    </div>

    <div v-else class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <article
        v-for="row in filtered"
        :key="String(row.id)"
        class="rounded-2xl border border-[var(--line)] bg-white p-3.5 shadow-[0_8px_22px_-18px_rgba(74,44,42,0.35)] transition hover:border-[#e9748e]/35"
        :class="row.is_active === false ? 'opacity-70' : ''"
      >
        <div class="flex gap-3">
          <div class="size-16 shrink-0 overflow-hidden rounded-xl bg-[#fff5f7] ring-1 ring-[var(--line)]">
            <img
              v-if="thumb(row.image_url)"
              :src="thumb(row.image_url) || undefined"
              alt=""
              class="size-full object-cover"
              @error="hideBrokenImg"
            >
            <div
              v-else
              class="grid size-full place-items-center font-display text-xl font-semibold text-[#e9748e]/70"
            >
              {{ initial(row.name) }}
            </div>
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex items-start justify-between gap-2">
              <p
                class="m-0 truncate font-semibold text-chocolate"
                :class="row.is_active === false ? 'line-through decoration-[var(--muted)]' : ''"
              >
                {{ row.name }}
              </p>
              <span
                class="shrink-0 rounded-full px-2 py-0.5 text-[0.65rem] font-semibold"
                :class="row.is_active === false ? 'bg-[#f8ede6] text-[var(--muted)]' : 'bg-[#e8f6ee] text-[#2e7d4f]'"
              >
                {{ row.is_active === false ? "Off" : "Active" }}
              </span>
            </div>
            <div class="mt-1 flex flex-wrap items-center gap-1.5">
              <span
                v-if="row.source === 'shop'"
                class="inline-flex max-w-full items-center gap-1 truncate rounded-full bg-chocolate px-2 py-0.5 text-[0.65rem] font-semibold text-cream"
              >
                <UIcon name="i-lucide-store" class="size-3 shrink-0" />
                <span class="truncate">{{ row.owner_shop_name || "Shop" }}</span>
              </span>
              <span
                v-else
                class="rounded-full bg-[#fff0f2] px-2 py-0.5 text-[0.65rem] font-semibold text-[#e9748e]"
              >
                Platform
              </span>
              <span
                v-if="row.parent_name"
                class="rounded-full bg-[#fff9f5] px-2 py-0.5 text-[0.65rem] font-semibold text-[var(--muted)] ring-1 ring-[var(--line)]"
              >
                under {{ row.parent_name }}
              </span>
            </div>
            <p class="m-0 mt-1 line-clamp-2 text-xs text-[var(--muted)]">
              {{ row.description || "No description" }}
            </p>
          </div>
        </div>

        <div class="mt-3 grid grid-cols-3 gap-2 rounded-xl bg-[#fff9f5] px-2.5 py-2 text-center">
          <div>
            <p class="m-0 text-[0.6rem] font-semibold uppercase tracking-wide text-[var(--muted)]">SKUs</p>
            <p class="m-0 text-sm font-bold text-chocolate">{{ row.product_count ?? 0 }}</p>
          </div>
          <div>
            <p class="m-0 text-[0.6rem] font-semibold uppercase tracking-wide text-[var(--muted)]">Order</p>
            <p class="m-0 text-sm font-bold text-chocolate">{{ row.display_order ?? 0 }}</p>
          </div>
          <div>
            <p class="m-0 text-[0.6rem] font-semibold uppercase tracking-wide text-[var(--muted)]">Updated</p>
            <p class="m-0 truncate text-xs font-semibold text-chocolate">{{ relativeAgo(String(row.updated_at || '')) }}</p>
          </div>
        </div>

        <div class="mt-3 flex flex-wrap gap-1.5">
          <UButton
            size="xs"
            color="secondary"
            variant="soft"
            label="View products"
            :to="`/products?category_id=${row.id}`"
          />
          <UButton size="xs" color="neutral" variant="soft" label="Edit" @click="openEdit(row)" />
          <UButton
            size="xs"
            color="neutral"
            variant="ghost"
            icon="i-lucide-chevron-up"
            :disabled="busy"
            @click="bumpOrder(row, -1)"
          />
          <UButton
            size="xs"
            color="neutral"
            variant="ghost"
            icon="i-lucide-chevron-down"
            :disabled="busy"
            @click="bumpOrder(row, 1)"
          />
          <UButton
            v-if="row.is_active !== false"
            size="xs"
            color="neutral"
            variant="ghost"
            label="Disable"
            @click="setActive(row, false)"
          />
          <UButton
            v-else
            size="xs"
            color="secondary"
            variant="ghost"
            label="Enable"
            @click="setActive(row, true)"
          />
        </div>
      </article>
    </div>

    <USlideover
      v-model:open="panelOpen"
      side="right"
      :title="form.id ? form.name || 'Edit category' : 'Add category'"
      description="Name, image, order, and shelf description"
      :ui="{ content: 'w-full max-w-lg bg-[#fffaf8]' }"
    >
      <template #body>
        <form class="flex flex-col gap-3 pb-6" @submit.prevent="save">
          <div class="flex gap-3">
            <div class="relative size-20 shrink-0 overflow-hidden rounded-xl bg-[#fff5f7] ring-1 ring-[var(--line)]">
              <img
                v-if="thumb(form.image_url)"
                :src="thumb(form.image_url) || undefined"
                alt=""
                class="size-full object-cover"
              >
              <div
                v-else
                class="grid size-full place-items-center font-display text-2xl font-semibold text-[#e9748e]/70"
              >
                {{ initial(form.name) }}
              </div>
            </div>
            <div class="min-w-0 flex-1">
              <p class="m-0 text-sm font-semibold text-chocolate">
                {{ form.id ? "Editing shelf group" : "New shelf group" }}
              </p>
              <p class="m-0 mt-0.5 text-xs text-[var(--muted)]">
                <template v-if="form.id">
                  {{ form.product_count }} SKUs
                  <span v-if="form.source === 'shop'"> · {{ form.owner_shop_name || "Shop" }}</span>
                </template>
                <template v-else>Upload a photo, paste a URL, or generate with AI</template>
              </p>
              <div class="mt-2 flex flex-wrap gap-1.5">
                <UButton
                  type="button"
                  size="xs"
                  color="neutral"
                  variant="soft"
                  icon="i-lucide-upload"
                  :loading="uploading"
                  label="Upload"
                  @click="fileRef?.click()"
                />
                <UButton
                  type="button"
                  size="xs"
                  color="primary"
                  variant="soft"
                  icon="i-lucide-sparkles"
                  :loading="busy"
                  label="AI image"
                  @click="aiImage"
                />
                <UButton
                  v-if="form.image_url"
                  type="button"
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  label="Clear"
                  @click="form.image_url = ''"
                />
              </div>
              <input ref="fileRef" type="file" accept="image/*" class="hidden" @change="onPickFile">
            </div>
          </div>

          <label>
            <span class="sc-label">Name *</span>
            <input v-model="form.name" class="sc-input !rounded-xl" placeholder="e.g. Pickles" required>
          </label>

          <label>
            <span class="sc-label">Description</span>
            <textarea
              v-model="form.description"
              class="sc-input !rounded-xl min-h-20"
              placeholder="Short shelf blurb for customers"
              rows="3"
            />
          </label>

          <label>
            <span class="sc-label">Image URL</span>
            <input
              v-model="form.image_url"
              class="sc-input !rounded-xl"
              placeholder="https://… or /uploads/…"
            >
          </label>

          <div class="grid grid-cols-2 gap-3">
            <label>
              <span class="sc-label">Display order</span>
              <input v-model.number="form.display_order" type="number" min="0" class="sc-input !rounded-xl">
            </label>
            <label>
              <span class="sc-label">Parent</span>
              <select v-model.number="form.parent_id" class="sc-input !rounded-xl">
                <option :value="0">None (top-level)</option>
                <option v-for="p in parentOptions" :key="String(p.id)" :value="Number(p.id)">
                  {{ p.name }}
                </option>
              </select>
            </label>
          </div>

          <label class="flex items-center gap-2 rounded-xl bg-[#fff9f5] px-3 py-2.5 ring-1 ring-[var(--line)]">
            <input v-model="form.is_active" type="checkbox" class="size-4 accent-[#e9748e]">
            <span class="text-sm font-semibold text-chocolate">Active on catalog</span>
          </label>

          <div class="sticky bottom-0 mt-2 flex gap-2 bg-[#fffaf8]/95 pt-2 backdrop-blur">
            <UButton type="submit" color="secondary" :loading="busy" class="flex-1" :label="form.id ? 'Save changes' : 'Add category'" />
            <UButton type="button" color="neutral" variant="soft" label="Cancel" @click="panelOpen = false" />
          </div>
        </form>
      </template>
    </USlideover>
  </div>
</template>

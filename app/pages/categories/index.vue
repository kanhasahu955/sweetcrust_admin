<script setup lang="ts">
import { useAppToast } from "~/composables/useAppToast"
import { patchListRow, upsertListRow } from "~/utils/list"

const api = useApi()
const toast = useAppToast()
const { confirm } = useConfirm()

const rows = ref<Record<string, unknown>[]>([])
const loading = ref(true)
const name = ref("")
const imageUrl = ref("")
const editOpen = ref(false)
const editId = ref<number | null>(null)
const editName = ref("")
const editImage = ref("")
const busy = ref(false)

const sorted = computed(() =>
  [...rows.value].sort((a, b) => {
    const aa = a.is_active === false ? 1 : 0
    const bb = b.is_active === false ? 1 : 0
    if (aa !== bb) return aa - bb
    return String(a.name || "").localeCompare(String(b.name || ""))
  }),
)

const activeCount = computed(() => rows.value.filter((r) => r.is_active !== false).length)

function initial(label: unknown) {
  const s = String(label || "?").trim()
  return (s[0] || "?").toUpperCase()
}

async function load(quiet = false) {
  if (!quiet) loading.value = true
  try {
    const data = await api.admin.categories()
    rows.value = Array.isArray(data) ? (data as Record<string, unknown>[]) : []
  } catch (e) {
    toast.error("Could not load categories", apiError(e))
  } finally {
    if (!quiet) loading.value = false
  }
}

async function create() {
  if (!name.value.trim()) {
    toast.info("Enter a category name")
    return
  }
  busy.value = true
  try {
    const created = await api.admin.createCategory({
      name: name.value.trim(),
      image_url: imageUrl.value.trim() || undefined,
      is_active: true,
    })
    upsertListRow(rows, created)
    name.value = ""
    imageUrl.value = ""
    toast.success("Category added")
    void load(true)
  } catch (e) {
    toast.error("Add failed", apiError(e))
  } finally {
    busy.value = false
  }
}

async function aiImage() {
  if (!name.value.trim()) {
    toast.info("Enter a category name first")
    return
  }
  busy.value = true
  try {
    const res = await api.admin.aiCategoryImage(name.value.trim())
    const url = String(res.image_url || "")
    if (!url) {
      toast.error("AI image returned no URL")
      return
    }
    imageUrl.value = url
    toast.success(
      res.stub ? "Placeholder only" : "Photo ready",
      res.stub ? String(res.note || "Configure OpenAI for real images") : "Click Add category to save",
    )
  } catch (e) {
    toast.error("AI image failed", apiError(e))
  } finally {
    busy.value = false
  }
}

function startEdit(c: Record<string, unknown>) {
  editId.value = Number(c.id)
  editName.value = String(c.name || "")
  editImage.value = String(c.image_url || "")
  editOpen.value = true
}

async function saveEdit() {
  if (!editId.value || !editName.value.trim()) return
  busy.value = true
  try {
    const updated = await api.admin.updateCategory(editId.value, {
      name: editName.value.trim(),
      image_url: editImage.value.trim() || null,
    })
    upsertListRow(rows, updated)
    editOpen.value = false
    editId.value = null
    toast.success("Category updated")
    void load(true)
  } catch (e) {
    toast.error("Update failed", apiError(e))
  } finally {
    busy.value = false
  }
}

async function aiImageForEdit() {
  if (!editName.value.trim()) {
    toast.info("Enter a name first")
    return
  }
  busy.value = true
  try {
    const res = await api.admin.aiCategoryImage(editName.value.trim())
    const url = String(res.image_url || "")
    if (!url) {
      toast.error("AI image returned no URL")
      return
    }
    editImage.value = url
    toast.success("Image filled — click Save")
  } catch (e) {
    toast.error("AI image failed", apiError(e))
  } finally {
    busy.value = false
  }
}

async function remove(c: Record<string, unknown>) {
  const ok = await confirm({
    title: "Disable category",
    message: `Disable “${c.name}”? It will be hidden from new product assignment.`,
    confirmText: "Disable",
    tone: "danger",
  })
  if (!ok) return
  const id = Number(c.id)
  try {
    await api.admin.deleteCategory(id)
    patchListRow(rows, id, { is_active: false })
    toast.success("Category disabled")
    void load(true)
  } catch (e) {
    toast.error("Disable failed", apiError(e))
  }
}

onMounted(() => load())
</script>

<template>
  <div>
    <PageHeader title="Categories" subtitle="Shelf groups for the catalog — pickles, papad, namkeen, bakery.">
      <template #actions>
        <span class="text-sm text-[var(--muted)]">
          <strong class="text-chocolate">{{ activeCount }}</strong> active
        </span>
        <UButton color="primary" variant="soft" label="Refresh" @click="load()" />
      </template>
    </PageHeader>

    <!-- Add strip -->
    <div class="sc-card mb-6 overflow-hidden">
      <div class="flex flex-col gap-4 p-4 sm:flex-row sm:items-stretch">
        <div
          class="relative size-24 shrink-0 overflow-hidden rounded-xl bg-[linear-gradient(145deg,#f3ebe2,#e8d9c8)] ring-1 ring-[var(--line)]"
        >
          <img
            v-if="imageUrl"
            :src="imageUrl"
            alt=""
            class="size-full object-cover"
          >
          <div
            v-else
            class="flex size-full flex-col items-center justify-center gap-1 text-[var(--muted)]"
          >
            <UIcon name="i-lucide-image" class="size-6 opacity-50" />
            <span class="text-[0.65rem] font-medium tracking-wide uppercase">Image</span>
          </div>
        </div>

        <div class="flex min-w-0 flex-1 flex-col justify-center gap-3">
          <div class="grid gap-3 sm:grid-cols-2">
            <label>
              <span class="sc-label">Name</span>
              <input
                v-model="name"
                class="sc-input"
                placeholder="e.g. Pickles"
                @keyup.enter="create"
              >
            </label>
            <label>
              <span class="sc-label">Image URL</span>
              <input
                v-model="imageUrl"
                class="sc-input"
                placeholder="Paste URL or use AI"
              >
            </label>
          </div>
          <div class="flex flex-wrap gap-2">
            <UButton type="button" :loading="busy" :disabled="busy" label="Add category" @click="create" />
            <UButton
              type="button"
              color="primary"
              variant="soft"
              :loading="busy"
              :disabled="busy"
              icon="i-lucide-sparkles"
              label="AI image"
              @click="aiImage"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <div
        v-for="n in 3"
        :key="n"
        class="h-28 animate-pulse rounded-2xl bg-[var(--surface)] ring-1 ring-[var(--line)]"
      />
    </div>

    <!-- Empty -->
    <EmptyState
      v-else-if="!sorted.length"
      title="No categories yet"
      body="Add your first shelf group — name it, optionally attach an image, then use it on products."
    />

    <!-- Visual list -->
    <ul v-else class="m-0 grid list-none gap-3 p-0 sm:grid-cols-2 xl:grid-cols-3">
      <li
        v-for="row in sorted"
        :key="String(row.id)"
        class="group relative flex overflow-hidden rounded-2xl bg-[var(--surface)] ring-1 ring-[var(--line)] transition hover:ring-cocoa/30"
        :class="row.is_active === false ? 'opacity-60' : ''"
      >
        <div class="relative w-[5.5rem] shrink-0 self-stretch bg-[linear-gradient(160deg,#efe4d6,#e0cfc0)] sm:w-28">
          <img
            v-if="row.image_url"
            :src="String(row.image_url)"
            alt=""
            class="absolute inset-0 size-full object-cover"
          >
          <div
            v-else
            class="absolute inset-0 flex items-center justify-center font-display text-2xl font-semibold text-cocoa/40"
          >
            {{ initial(row.name) }}
          </div>
        </div>

        <div class="flex min-w-0 flex-1 flex-col justify-between gap-3 p-3.5">
          <div>
            <div class="flex items-start justify-between gap-2">
              <h2
                class="font-display m-0 text-lg font-semibold leading-tight text-chocolate"
                :class="row.is_active === false ? 'line-through decoration-[var(--muted)]' : ''"
              >
                {{ row.name }}
              </h2>
              <div class="flex shrink-0 flex-col items-end gap-1">
                <span
                  class="sc-badge"
                  :class="row.is_active === false ? 'bg-cream text-[var(--muted)]' : 'bg-success/15 text-[#1f6b3a]'"
                >
                  {{ row.is_active === false ? "Off" : "Active" }}
                </span>
                <span
                  v-if="row.source === 'shop'"
                  class="sc-badge bg-honey/25 text-cocoa"
                >
                  Shop
                </span>
              </div>
            </div>
            <p class="mt-1 text-xs text-[var(--muted)]">
              #{{ row.id }}
              <span v-if="row.source === 'shop'">
                · Shop{{ row.owner_shop_name ? ` · ${row.owner_shop_name}` : "" }}
              </span>
              <span v-else-if="row.parent_id"> · subcategory</span>
              <span v-if="!row.image_url"> · no image</span>
            </p>
          </div>

          <div class="flex flex-wrap gap-1.5">
            <UButton
              :to="`/products?category_id=${row.id}`"
              size="sm"
              color="primary"
              label="View products"
            />
            <UButton
              type="button"
              size="sm"
              color="primary"
              variant="soft"
              label="Edit"
              @click="startEdit(row)"
            />
            <UButton
              v-if="row.is_active !== false"
              type="button"
              size="sm"
              color="neutral"
              variant="ghost"
              label="Disable"
              @click="remove(row)"
            />
          </div>
        </div>
      </li>
    </ul>

    <UiAppModal :open="editOpen" title="Edit category" @close="editOpen = false">
      <div class="flex flex-col gap-4 sm:flex-row">
        <div
          class="relative mx-auto size-28 shrink-0 overflow-hidden rounded-xl bg-[linear-gradient(145deg,#f3ebe2,#e8d9c8)] ring-1 ring-[var(--line)] sm:mx-0"
        >
          <img
            v-if="editImage"
            :src="editImage"
            alt=""
            class="size-full object-cover"
          >
          <div
            v-else
            class="flex size-full items-center justify-center font-display text-3xl font-semibold text-cocoa/35"
          >
            {{ initial(editName) }}
          </div>
        </div>
        <div class="min-w-0 flex-1 space-y-3">
          <label>
            <span class="sc-label">Name</span>
            <input v-model="editName" class="sc-input" @keyup.enter="saveEdit">
          </label>
          <label>
            <span class="sc-label">Image URL</span>
            <input v-model="editImage" class="sc-input" placeholder="https://…">
          </label>
          <UButton
            color="primary"
            variant="soft"
            size="sm"
            icon="i-lucide-sparkles"
            :loading="busy"
            label="AI image"
            @click="aiImageForEdit"
          />
        </div>
      </div>
      <template #footer>
        <UButton color="neutral" variant="outline" @click="editOpen = false">Cancel</UButton>
        <UButton :loading="busy" :disabled="busy" @click="saveEdit">Save</UButton>
      </template>
    </UiAppModal>
  </div>
</template>

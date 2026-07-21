<script setup lang="ts">
import { upsertListRow } from "~/utils/list"

const api = useApi()
const rows = ref<Record<string, unknown>[]>([])
const error = ref("")
const info = ref("")
const form = reactive({ title: "", image_url: "", link_type: "none", link_value: "", is_active: true, sort_order: 0 })

async function load() {
  try {
    const data = await api.admin.banners()
    rows.value = Array.isArray(data) ? (data as Record<string, unknown>[]) : []
  } catch (e) {
    error.value = apiError(e)
  }
}

async function create() {
  if (!form.title.trim()) {
    error.value = "Title required"
    return
  }
  if (!form.image_url.trim()) {
    error.value = "Image URL required"
    return
  }
  try {
    error.value = ""
    const created = await api.admin.createBanner({ ...form })
    upsertListRow(rows, created)
    info.value = "Banner created"
    form.title = ""
    form.image_url = ""
    void load()
  } catch (e) {
    error.value = apiError(e)
  }
}

onMounted(load)
</script>

<template>
  <div>
    <PageHeader title="Banners" subtitle="Promo banners for customer app (when live)" />
    <p v-if="error" class="mb-3 text-sm text-danger">{{ error }}</p>
    <p v-if="info" class="mb-3 text-sm text-success">{{ info }}</p>
    <div class="sc-card mb-4 grid gap-3 p-4 sm:grid-cols-2">
      <label><span class="sc-label">Title</span><input v-model="form.title" class="sc-input"></label>
      <label><span class="sc-label">Image URL</span><input v-model="form.image_url" class="sc-input" placeholder="https://…"></label>
      <label><span class="sc-label">Link type</span><input v-model="form.link_type" class="sc-input" placeholder="product / category / none"></label>
      <label><span class="sc-label">Link value</span><input v-model="form.link_value" class="sc-input"></label>
      <label class="flex items-center gap-2">
        <input v-model="form.is_active" type="checkbox" class="size-4">
        <span class="text-sm font-semibold">Active</span>
      </label>
      <div class="flex items-end">
        <UButton type="button" @click="create">Add banner</UButton>
      </div>
    </div>
    <div class="sc-card divide-y divide-[var(--line)]">
      <div v-for="b in rows" :key="String(b.id)" class="flex items-center gap-3 px-4 py-3 text-sm">
        <img v-if="b.image_url" :src="String(b.image_url)" alt="" class="size-12 rounded-lg object-cover bg-cream">
        <div class="flex-1">
          <p class="font-semibold">{{ b.title }}</p>
          <p class="text-xs text-[var(--muted)]">{{ b.link_type || "—" }} {{ b.link_value || "" }}</p>
        </div>
        <span class="sc-badge" :class="b.is_active ? 'bg-blush/70 text-cocoa' : 'bg-cream'">{{ b.is_active ? "Active" : "Off" }}</span>
      </div>
      <EmptyState v-if="!rows.length" class="m-4" title="No banners" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { patchListRow, upsertListRow } from "~/utils/list"

const api = useApi()
const loading = ref(true)
const error = ref("")
const info = ref("")
const q = ref("")
const filter = ref<"all" | "active" | "draft">("all")
const rows = ref<Record<string, unknown>[]>([])
const total = ref(0)
const busyId = ref<number | null>(null)

async function load(quiet = false) {
  if (!quiet) loading.value = true
  error.value = ""
  try {
    const res = await api.admin.assortmentProducts({
      q: q.value || undefined,
      active: filter.value === "active" ? true : undefined,
      draft: filter.value === "draft" ? true : undefined,
    })
    rows.value = Array.isArray(res.items) ? res.items : []
    total.value = Number(res.total) || rows.value.length
  } catch (e) {
    error.value = apiError(e)
  } finally {
    if (!quiet) loading.value = false
  }
}

async function toggle(row: Record<string, unknown>, key: string) {
  const id = Number(row.id)
  if (!id) return
  busyId.value = id
  error.value = ""
  const next = !row[key]
  try {
    const saved = await api.admin.patchAssortment(id, { [key]: next })
    if (!upsertListRow(rows, saved)) patchListRow(rows, id, { [key]: next })
    info.value = `Updated #${id}`
    void load(true)
  } catch (e) {
    error.value = apiError(e)
  } finally {
    busyId.value = null
  }
}

onMounted(() => load())
watch([filter], () => load())
</script>

<template>
  <div>
    <PageHeader title="Assortment" subtitle="Publish, draft, trending, and bestseller flags for the catalog">
      <template #actions>
        <UButton color="primary" variant="soft" label="Refresh" @click="load" />
        <UButton to="/products" label="All products" />
      </template>
    </PageHeader>

    <p v-if="error" class="mb-3 text-sm text-danger">{{ error }}</p>
    <p v-if="info" class="mb-3 rounded-xl bg-blush/50 px-3 py-2 text-sm text-cocoa">{{ info }}</p>

    <div class="sc-card mb-4 grid gap-3 p-4 sm:grid-cols-3">
      <label>
        <span class="sc-label">Search</span>
        <input v-model="q" class="sc-input" placeholder="Product or brand…" @keyup.enter="load">
      </label>
      <label>
        <span class="sc-label">Filter</span>
        <select v-model="filter" class="sc-input">
          <option value="all">All</option>
          <option value="active">Active only</option>
          <option value="draft">Drafts</option>
        </select>
      </label>
      <div class="flex items-end">
        <UButton class="w-full" label="Apply" @click="load" />
      </div>
    </div>

    <div class="mb-3 text-sm text-[var(--muted)]">{{ total }} products</div>

    <div class="sc-card overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="bg-cream/80 text-left text-[0.68rem] uppercase tracking-wider text-[var(--muted)]">
            <th class="px-4 py-3">ID</th>
            <th class="px-4 py-3">Name</th>
            <th class="px-4 py-3">Brand</th>
            <th class="px-4 py-3">Active</th>
            <th class="px-4 py-3">Draft</th>
            <th class="px-4 py-3">Trending</th>
            <th class="px-4 py-3">Bestseller</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="String(r.id)" class="border-t border-[var(--line)]">
            <td class="px-4 py-3">{{ r.id }}</td>
            <td class="px-4 py-3 font-semibold">{{ r.name }}</td>
            <td class="px-4 py-3 text-xs text-[var(--muted)]">{{ r.brand_name || "—" }}</td>
            <td class="px-4 py-3">
              <UButton size="xs" :variant="r.is_active ? 'solid' : 'outline'" :disabled="busyId === Number(r.id)" @click="toggle(r, 'is_active')">
                {{ r.is_active ? "On" : "Off" }}
              </UButton>
            </td>
            <td class="px-4 py-3">
              <UButton size="xs" color="neutral" :variant="r.is_draft ? 'solid' : 'outline'" :disabled="busyId === Number(r.id)" @click="toggle(r, 'is_draft')">
                {{ r.is_draft ? "Draft" : "Live" }}
              </UButton>
            </td>
            <td class="px-4 py-3">
              <UButton size="xs" color="primary" variant="soft" :disabled="busyId === Number(r.id)" @click="toggle(r, 'is_trending')">
                {{ r.is_trending ? "Yes" : "No" }}
              </UButton>
            </td>
            <td class="px-4 py-3">
              <UButton size="xs" color="primary" variant="soft" :disabled="busyId === Number(r.id)" @click="toggle(r, 'is_bestseller')">
                {{ r.is_bestseller ? "Yes" : "No" }}
              </UButton>
            </td>
          </tr>
        </tbody>
      </table>
      <EmptyState v-if="!loading && !rows.length" class="m-4" title="No assortment rows" body="Add products first." />
    </div>
  </div>
</template>

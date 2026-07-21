<script setup lang="ts">
import { statusLabel } from "~/utils/format"

const api = useApi()
const loading = ref(true)
const error = ref("")
const info = ref("")
const filter = ref("")
const items = ref<Record<string, unknown>[]>([])
const stats = ref<Record<string, number>>({})
const busyId = ref<number | null>(null)

function orderOf(row: Record<string, unknown>) {
  return (row.order || {}) as Record<string, unknown>
}

async function load() {
  loading.value = true
  error.value = ""
  try {
    const [q, s] = await Promise.all([
      api.admin.pickingQueue(filter.value || undefined),
      api.admin.pickingStats(),
    ])
    items.value = Array.isArray(q.items) ? q.items : []
    stats.value = s || {}
  } catch (e) {
    error.value = apiError(e)
  } finally {
    loading.value = false
  }
}

async function start(id: number) {
  busyId.value = id
  error.value = ""
  try {
    await api.admin.pickingStart(id)
    info.value = `Started picking #${id}`
    // queue row shape varies — refresh without blocking UI
    void load()
  } catch (e) {
    error.value = apiError(e)
  } finally {
    busyId.value = null
  }
}

async function pack(id: number) {
  busyId.value = id
  error.value = ""
  try {
    await api.admin.pickingPack(id)
    info.value = `Packed #${id}`
    void load()
  } catch (e) {
    error.value = apiError(e)
  } finally {
    busyId.value = null
  }
}

onMounted(load)
watch(filter, load)
</script>

<template>
  <div>
    <PageHeader title="Picking" subtitle="Kitchen / pack queue — start preparing, then mark packed">
      <template #actions>
        <UButton color="primary" variant="soft" label="Refresh" @click="load" />
        <UButton to="/orders" label="All orders" />
      </template>
    </PageHeader>

    <p v-if="error" class="mb-3 text-sm text-danger">{{ error }}</p>
    <p v-if="info" class="mb-3 rounded-xl bg-blush/50 px-3 py-2 text-sm text-cocoa">{{ info }}</p>

    <div class="mb-4 grid gap-3 sm:grid-cols-4">
      <div class="sc-card p-4">
        <p class="sc-label">Accepted</p>
        <p class="font-display text-2xl text-chocolate">{{ stats.accepted ?? 0 }}</p>
      </div>
      <div class="sc-card p-4">
        <p class="sc-label">Preparing</p>
        <p class="font-display text-2xl text-honey">{{ stats.preparing ?? 0 }}</p>
      </div>
      <div class="sc-card p-4">
        <p class="sc-label">Packed</p>
        <p class="font-display text-2xl text-cocoa">{{ stats.packed ?? 0 }}</p>
      </div>
      <div class="sc-card p-4">
        <p class="sc-label">In queue</p>
        <p class="font-display text-2xl">{{ items.length }}</p>
      </div>
    </div>

    <div class="mb-4 flex flex-wrap gap-2">
      <UButton size="sm" :variant="!filter ? 'solid' : 'outline'" label="All open" @click="filter = ''" />
      <UButton size="sm" :variant="filter === 'accepted' ? 'solid' : 'outline'" label="Accepted" @click="filter = 'accepted'" />
      <UButton size="sm" :variant="filter === 'preparing' ? 'solid' : 'outline'" label="Preparing" @click="filter = 'preparing'" />
      <UButton size="sm" :variant="filter === 'packed' ? 'solid' : 'outline'" label="Packed" @click="filter = 'packed'" />
    </div>

    <div class="sc-card divide-y divide-[var(--line)]">
      <div v-for="row in items" :key="String(orderOf(row).id)" class="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
        <div>
          <p class="font-semibold">
            Order #{{ orderOf(row).id }}
            <span class="sc-badge ml-2 bg-cream text-cocoa">{{ statusLabel(String(orderOf(row).status)) }}</span>
          </p>
          <p class="text-[var(--muted)]">{{ row.item_count || 0 }} items · ₹{{ orderOf(row).final_amount ?? "—" }}</p>
        </div>
        <div class="flex flex-wrap gap-2">
          <UButton
            size="xs"
            color="primary"
            variant="soft"
            :disabled="busyId === Number(orderOf(row).id)"
            label="Start"
            @click="start(Number(orderOf(row).id))"
          />
          <UButton
            size="xs"
            :disabled="busyId === Number(orderOf(row).id)"
            label="Pack"
            @click="pack(Number(orderOf(row).id))"
          />
          <UButton
            size="xs"
            color="neutral"
            variant="outline"
            :to="`/orders/${orderOf(row).id}`"
            label="Open"
          />
        </div>
      </div>
      <EmptyState v-if="!loading && !items.length" class="m-4" title="Queue empty" body="No orders waiting to pick." />
    </div>
  </div>
</template>

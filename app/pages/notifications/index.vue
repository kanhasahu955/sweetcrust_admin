<script setup lang="ts">
const api = useApi()
const rows = ref<Record<string, unknown>[]>([])
const error = ref("")
const busy = ref(false)

async function load() {
  try {
    const data = await api.admin.notifications()
    rows.value = Array.isArray(data) ? (data as Record<string, unknown>[]) : []
  } catch (e) {
    error.value = apiError(e)
  }
}

async function markOne(id: number) {
  busy.value = true
  try {
    await api.admin.markNotificationRead(id)
    await load()
  } catch (e) {
    error.value = apiError(e)
  } finally {
    busy.value = false
  }
}

async function markAll() {
  busy.value = true
  try {
    await api.admin.markNotificationRead()
    await load()
  } catch (e) {
    error.value = apiError(e)
  } finally {
    busy.value = false
  }
}

onMounted(load)
</script>

<template>
  <div>
    <PageHeader title="Notifications" subtitle="Order alerts and system notices">
      <template #actions>
        <UButton type="button" color="neutral" variant="outline" :disabled="busy || !rows.length" @click="markAll">Mark all read</UButton>
      </template>
    </PageHeader>
    <p v-if="error" class="mb-3 text-sm text-danger">{{ error }}</p>
    <div class="sc-card divide-y divide-[var(--line)]">
      <div
        v-for="n in rows"
        :key="String(n.id)"
        class="flex flex-wrap items-start justify-between gap-3 px-4 py-3 text-sm"
        :class="n.is_read ? 'opacity-60' : ''"
      >
        <div>
          <p class="font-semibold">{{ n.title || n.message || "Notice" }}</p>
          <p class="text-[var(--muted)]">{{ n.body || n.message || n.created_at }}</p>
        </div>
        <UButton color="primary" variant="soft" v-if="!n.is_read"
          type="button" class="!py-1.5 text-xs" 
          :disabled="busy"
          @click="markOne(Number(n.id))"
        >
          Mark read
        </UButton>
      </div>
      <EmptyState v-if="!rows.length" class="m-4" title="Inbox clear" />
    </div>
  </div>
</template>

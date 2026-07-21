<script setup lang="ts">
const api = useApi()
const rows = ref<Record<string, unknown>[]>([])
const error = ref("")

onMounted(async () => {
  try {
    const data = await api.admin.tickets()
    rows.value = Array.isArray(data) ? (data as Record<string, unknown>[]) : []
  } catch (e) {
    error.value = apiError(e)
  }
})
</script>

<template>
  <div>
    <PageHeader title="Support tickets" subtitle="Legacy ticket list — prefer Live chat for shops">
      <template #actions>
        <UButton to="/chats">Open live chat</UButton>
      </template>
    </PageHeader>
    <p v-if="error" class="mb-3 text-sm text-danger">{{ error }}</p>
    <div class="sc-card divide-y divide-[var(--line)]">
      <div v-for="t in rows" :key="String(t.id)" class="px-4 py-3 text-sm">
        <div class="flex justify-between gap-2">
          <p class="font-semibold">{{ t.subject || t.title || `Ticket #${t.id}` }}</p>
          <span class="sc-badge bg-cream capitalize">{{ t.status || "open" }}</span>
        </div>
        <p class="mt-1 text-[var(--muted)] line-clamp-2">{{ t.body || t.message || "—" }}</p>
      </div>
      <EmptyState v-if="!rows.length" class="m-4" title="No tickets" body="Shop support uses Live chat." />
    </div>
  </div>
</template>

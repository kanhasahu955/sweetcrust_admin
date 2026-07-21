<script setup lang="ts">
import { money } from "~/utils/format"

const api = useApi()
const rows = ref<Record<string, unknown>[]>([])
const error = ref("")
const q = ref("")

const filtered = computed(() => {
  const needle = q.value.trim().toLowerCase()
  if (!needle) return rows.value
  return rows.value.filter((c) =>
    [c.name, c.phone, c.email, c.segment].some((v) => String(v || "").toLowerCase().includes(needle)),
  )
})

onMounted(async () => {
  try {
    const data = await api.admin.customers()
    rows.value = Array.isArray(data) ? (data as Record<string, unknown>[]) : []
  } catch (e) {
    error.value = apiError(e)
  }
})
</script>

<template>
  <div>
    <PageHeader title="Customers" subtitle="B2C local customers — orders, spend, online">
      <template #actions>
        <input v-model="q" class="sc-input !w-48" placeholder="Search…">
      </template>
    </PageHeader>
    <p v-if="error" class="mb-3 text-sm text-danger">{{ error }}</p>
    <div class="sc-card overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="bg-cream/80 text-left text-[0.68rem] uppercase tracking-wider text-[var(--muted)]">
            <th class="px-4 py-3">Customer</th>
            <th class="px-4 py-3">Orders</th>
            <th class="px-4 py-3">Spent</th>
            <th class="px-4 py-3">Segment</th>
            <th class="px-4 py-3">Status</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in filtered" :key="String(c.id)" class="border-t border-[var(--line)]">
            <td class="px-4 py-3">
              <p class="font-semibold">{{ c.name || "Customer" }}</p>
              <p class="text-xs text-[var(--muted)]">{{ c.phone }}{{ c.email ? ` · ${c.email}` : "" }}</p>
            </td>
            <td class="px-4 py-3">{{ c.total_orders ?? 0 }}</td>
            <td class="px-4 py-3">{{ money(Number(c.total_spent || 0)) }}</td>
            <td class="px-4 py-3 capitalize">{{ c.segment || "—" }}</td>
            <td class="px-4 py-3">
              <span class="sc-badge" :class="c.is_online ? 'bg-blush/70 text-cocoa' : 'bg-cream text-[var(--muted)]'">
                {{ c.is_online ? "Online" : "Offline" }}
              </span>
            </td>
          </tr>
        </tbody>
      </table>
      <EmptyState v-if="!filtered.length" class="m-4" title="No customers yet" body="B2C will grow after village shops." />
    </div>
  </div>
</template>

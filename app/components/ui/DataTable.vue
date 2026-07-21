<script setup lang="ts">
export type DataTableColumn = {
  key: string
  label: string
  class?: string
}

withDefaults(
  defineProps<{
    columns: DataTableColumn[]
    rows: Record<string, unknown>[]
    rowKey?: string
    loading?: boolean
    emptyTitle?: string
    emptyBody?: string
  }>(),
  {
    rowKey: "id",
    loading: false,
    emptyTitle: "No rows",
    emptyBody: "",
  },
)

function cell(row: Record<string, unknown>, key: string) {
  const v = row[key]
  if (v == null || v === "") return "—"
  return String(v)
}
</script>

<template>
  <UCard :ui="{ body: 'p-0 sm:p-0' }">
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-default bg-muted/50 text-left text-xs uppercase tracking-wider text-muted">
            <th
              v-for="col in columns"
              :key="col.key"
              class="px-4 py-3 font-semibold"
              :class="col.class"
            >
              {{ col.label }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading">
            <td :colspan="columns.length" class="px-4 py-10 text-center text-muted">
              <UIcon name="i-lucide-loader-circle" class="size-5 animate-spin inline" />
              Loading…
            </td>
          </tr>
          <tr
            v-for="row in rows"
            :key="String(row[rowKey] ?? JSON.stringify(row))"
            class="border-t border-default transition hover:bg-elevated/60"
          >
            <td
              v-for="col in columns"
              :key="col.key"
              class="px-4 py-3 align-middle"
              :class="col.class"
            >
              <slot :name="`cell-${col.key}`" :row="row">
                {{ cell(row, col.key) }}
              </slot>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <EmptyState
      v-if="!loading && !rows.length"
      class="m-4"
      :title="emptyTitle"
      :body="emptyBody"
    />
  </UCard>
</template>

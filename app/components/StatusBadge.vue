<script setup lang="ts">
const props = defineProps<{
  status?: string | null
  map?: Record<string, "ok" | "warn" | "danger" | "muted">
}>()

const tone = computed(() => {
  const s = String(props.status || "").toLowerCase()
  if (props.map?.[s]) return props.map[s]
  if (["paid", "delivered", "approved", "active", "completed", "success", "online", "in_stock", "received"].includes(s))
    return "ok"
  if (["pending", "processing", "assigned", "packed", "out_for_delivery", "incomplete", "low_stock", "partial"].includes(s))
    return "warn"
  if (["cancelled", "rejected", "failed", "blocked", "refunded", "out_of_stock"].includes(s)) return "danger"
  return "muted"
})

const cls = computed(() => {
  if (tone.value === "ok") return "sc-badge sc-badge-ok"
  if (tone.value === "warn") return "sc-badge sc-badge-warn"
  if (tone.value === "danger") return "sc-badge sc-badge-danger"
  return "sc-badge sc-badge-muted"
})
</script>

<template>
  <span :class="cls">{{ status || "—" }}</span>
</template>

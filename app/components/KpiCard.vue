<script setup lang="ts">
/** Backward-compatible alias — prefer StatCard for new pages. */
defineProps<{
  label: string
  value: string | number
  icon?: string
  hint?: string
}>()
</script>

<template>
  <StatCard :label="label" :value="value" :icon="icon" :hint="hint" />
</template>

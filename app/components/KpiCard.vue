<script setup lang="ts">
defineProps<{
  label: string
  value: string | number
  icon?: string
  hint?: string
}>()

function toIcon(icon?: string) {
  if (!icon) return undefined
  return icon.startsWith("i-") ? icon : `i-${icon.replace(":", "-")}`
}
</script>

<template>
  <div class="sc-card group relative overflow-hidden p-4 transition hover:-translate-y-0.5 hover:shadow-md">
    <div class="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-honey via-apricot to-cocoa opacity-90" />
    <div class="mb-3 flex items-start justify-between gap-2">
      <p class="text-[0.68rem] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">{{ label }}</p>
      <span
        v-if="icon"
        class="grid size-8 place-items-center rounded-lg bg-gradient-to-br from-honey/25 to-blush/40 text-cocoa"
      >
        <UIcon :name="toIcon(icon)!" class="size-4" />
      </span>
    </div>
    <p class="font-display text-[1.65rem] leading-none text-chocolate">{{ value }}</p>
    <p v-if="hint" class="mt-2 text-xs text-[var(--muted)]">{{ hint }}</p>
  </div>
</template>

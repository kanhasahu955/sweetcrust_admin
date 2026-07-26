<script setup lang="ts">
defineProps<{
  label: string
  value: string | number
  icon?: string
  hint?: string
  tone?: "default" | "accent" | "ok" | "warn"
}>()

function toIcon(icon?: string) {
  if (!icon) return undefined
  return icon.startsWith("i-") ? icon : `i-${icon.replace(":", "-")}`
}
</script>

<template>
  <div
    class="sc-card-smoke group relative overflow-hidden p-4 transition duration-200 hover:-translate-y-0.5"
  >
    <div
      class="absolute inset-x-0 top-0 h-[3px]"
      :class="{
        'bg-gradient-to-r from-[#e9748e] via-[#f2a7ad] to-[#4a2c2a]': !tone || tone === 'default' || tone === 'accent',
        'bg-gradient-to-r from-[#2e7d4f] to-[#6bbf8a]': tone === 'ok',
        'bg-gradient-to-r from-[#e9748e] to-[#ff8a65]': tone === 'warn',
      }"
    />
    <div class="mb-3 flex items-start justify-between gap-2">
      <p class="text-[0.68rem] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
        {{ label }}
      </p>
      <span
        v-if="icon"
        class="grid size-8 place-items-center rounded-xl bg-gradient-to-br from-[#ffe8ec] to-[#f8ede6] text-chocolate"
      >
        <UIcon :name="toIcon(icon)!" class="size-4" />
      </span>
    </div>
    <p class="font-display text-[1.65rem] leading-none text-chocolate">{{ value }}</p>
    <p v-if="hint" class="mt-2 text-xs text-[var(--muted)]">{{ hint }}</p>
  </div>
</template>

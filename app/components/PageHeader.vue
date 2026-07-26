<script setup lang="ts">
defineProps<{ title: string; subtitle?: string }>()
</script>

<template>
  <div
    class="mb-5 flex flex-wrap items-end justify-between gap-3 border-b border-[var(--line)]/80 pb-4 sm:mb-6"
  >
    <div class="min-w-0">
      <h1 class="font-display m-0 text-[1.55rem] font-semibold leading-tight tracking-tight text-chocolate sm:text-[1.85rem]">
        {{ title }}
      </h1>
      <p v-if="subtitle" class="mt-1.5 max-w-2xl text-sm leading-relaxed text-[var(--muted)]">
        {{ subtitle }}
      </p>
    </div>
    <div v-if="$slots.actions" class="flex flex-wrap items-center gap-2">
      <slot name="actions" />
    </div>
  </div>
</template>

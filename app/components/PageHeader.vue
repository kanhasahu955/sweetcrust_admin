<script setup lang="ts">
defineProps<{ title: string; subtitle?: string }>()
</script>

<template>
  <div class="mb-6 flex flex-wrap items-end justify-between gap-3 border-b border-[var(--line)]/70 pb-4">
    <div>
      <h1 class="font-display m-0 text-[1.75rem] font-semibold leading-tight text-chocolate">
        {{ title }}
      </h1>
      <p v-if="subtitle" class="mt-1.5 max-w-2xl text-sm leading-relaxed text-[var(--muted)]">
        {{ subtitle }}
      </p>
    </div>
    <div v-if="$slots.actions" class="flex flex-wrap gap-2">
      <slot name="actions" />
    </div>
  </div>
</template>

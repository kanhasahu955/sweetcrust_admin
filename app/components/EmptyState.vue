<script setup lang="ts">
defineProps<{ title: string; body?: string; icon?: string }>()
</script>

<template>
  <div class="sc-card flex flex-col items-center justify-center px-6 py-14 text-center">
    <div class="mb-4 grid size-14 place-items-center rounded-2xl bg-gradient-to-br from-[#ffe8ec] to-[#f8ede6] text-chocolate">
      <UIcon :name="icon || 'i-lucide-inbox'" class="size-7" />
    </div>
    <h3 class="font-display m-0 text-xl text-chocolate">{{ title }}</h3>
    <p v-if="body" class="mt-2 max-w-md text-sm text-[var(--muted)]">{{ body }}</p>
    <div v-if="$slots.default" class="mt-5 flex flex-wrap justify-center gap-2">
      <slot />
    </div>
  </div>
</template>

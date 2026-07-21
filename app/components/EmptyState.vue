<script setup lang="ts">
defineProps<{ title: string; body?: string; icon?: string }>()
</script>

<template>
  <UEmpty
    :icon="icon || 'i-lucide-inbox'"
    :title="title"
    :description="body"
  >
    <template v-if="$slots.default" #actions>
      <slot />
    </template>
  </UEmpty>
</template>

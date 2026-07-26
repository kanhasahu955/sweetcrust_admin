<script setup lang="ts">
defineProps<{
  search?: string
  searchPlaceholder?: string
}>()
const emit = defineEmits<{ "update:search": [string] }>()
</script>

<template>
  <div class="sc-toolbar">
    <div v-if="search !== undefined || $slots.search" class="min-w-[200px] flex-1 sm:max-w-xs">
      <slot name="search">
        <UInput
          :model-value="search"
          :placeholder="searchPlaceholder || 'Search…'"
          icon="i-lucide-search"
          size="md"
          @update:model-value="emit('update:search', String($event ?? ''))"
        />
      </slot>
    </div>
    <div v-if="$slots.filters" class="flex flex-wrap items-center gap-2">
      <slot name="filters" />
    </div>
    <div v-if="$slots.actions" class="ml-auto flex flex-wrap items-center gap-2">
      <slot name="actions" />
    </div>
  </div>
</template>

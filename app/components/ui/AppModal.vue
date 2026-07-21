<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    open: boolean
    title?: string
    description?: string
  }>(),
  { title: "", description: undefined },
)

const emit = defineEmits<{ close: []; "update:open": [boolean] }>()

const openModel = computed({
  get: () => props.open,
  set: (v: boolean) => {
    emit("update:open", v)
    if (!v) emit("close")
  },
})
</script>

<template>
  <UModal
    v-model:open="openModel"
    :title="title || undefined"
    :description="description"
  >
    <template #body>
      <slot />
    </template>
    <template v-if="$slots.footer" #footer>
      <slot name="footer" />
    </template>
  </UModal>
</template>

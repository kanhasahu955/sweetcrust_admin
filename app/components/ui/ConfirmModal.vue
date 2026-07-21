<script setup lang="ts">
const { state, answer } = useConfirm()

const openModel = computed({
  get: () => state.open,
  set: (v: boolean) => {
    if (!v) answer(false)
  },
})
</script>

<template>
  <UModal
    v-model:open="openModel"
    :title="state.title"
    :description="state.message"
  >
    <template #footer>
      <div class="flex justify-end gap-2 w-full">
        <UButton color="neutral" variant="outline" @click="answer(false)">
          {{ state.cancelText }}
        </UButton>
        <UButton
          :color="state.tone === 'danger' ? 'error' : 'primary'"
          @click="answer(true)"
        >
          {{ state.confirmText }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>

<script setup lang="ts">
const open = ref(false)
const route = useRoute()

watch(
  () => route.fullPath,
  () => {
    open.value = false
  },
)
</script>

<template>
  <div class="min-h-screen bg-[var(--bg)]">
    <AppSidebar :open="open" @close="open = false" />
    <div class="min-w-0 transition-[padding] duration-200 lg:pl-[272px]">
      <div class="sticky top-0 z-30 border-b border-[var(--line)] bg-[color-mix(in_srgb,#fff9f5_78%,transparent)] shadow-[0_10px_28px_-22px_rgba(74,44,42,0.4)] backdrop-blur-xl">
        <AppTopbar @menu="open = true" />
      </div>
      <main class="mx-auto w-full max-w-[1600px] px-3 pb-28 pt-4 sm:px-5 lg:px-7 lg:pt-6">
        <slot />
      </main>
    </div>
  </div>
</template>

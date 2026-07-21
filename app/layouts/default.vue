<script setup lang="ts">
const open = ref(false)
</script>

<template>
  <div class="min-h-screen">
    <AppSidebar :open="open" @close="open = false" />
    <div class="min-w-0 lg:pl-[260px]">
      <div class="sticky top-0 z-30 border-b border-default/80 bg-[color-mix(in_srgb,var(--bg)_88%,transparent)] backdrop-blur-md">
        <AppTopbar @menu="open = true" />
      </div>
      <main class="mx-auto max-w-[1360px] px-4 pb-24 pt-5 lg:px-8">
        <slot />
      </main>
    </div>
  </div>
</template>

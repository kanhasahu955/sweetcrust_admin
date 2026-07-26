<script setup lang="ts">
withDefaults(
  defineProps<{
    size?: "sm" | "md" | "lg" | "xl"
  }>(),
  { size: "md" },
)

const src = "/brand/sweetcrust-logo.png"
</script>

<template>
  <img
    :src="src"
    alt="SweetCrust Bakery"
    class="w-auto object-contain"
    :class="{
      'h-8': size === 'sm',
      'h-11': size === 'md',
      'h-16': size === 'lg',
      'h-24': size === 'xl',
    }"
  >
</template>

<script setup lang="ts">
import dayjs from "dayjs"
import { useAdminChatUnread } from "~/composables/useAdminChatUnread"

defineEmits<{ menu: [] }>()

const auth = useAuthStore()
const { total: chatUnread } = useAdminChatUnread()
const hour = dayjs().hour()
const greet = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening"
const today = dayjs().format("ddd, D MMM")

const chatBadge = computed(() => {
  const n = Number(chatUnread.value) || 0
  if (n <= 0) return ""
  return n > 99 ? "99+" : String(n)
})
</script>

<template>
  <header class="flex items-center justify-between gap-3 px-4 py-4 lg:px-7">
    <div class="flex items-center gap-3">
      <UButton
        class="lg:hidden"
        color="neutral"
        variant="outline"
        icon="i-lucide-menu"
        square
        aria-label="Open menu"
        @click="$emit('menu')"
      />
      <div>
        <p class="font-display text-lg text-chocolate">{{ greet }}</p>
        <p class="text-xs text-[var(--muted)]">
          {{ today }} · {{ auth.user?.name || "Owner" }} console
        </p>
      </div>
    </div>
    <div class="flex items-center gap-2">
      <UButton
        to="/chats"
        color="neutral"
        variant="outline"
        size="sm"
        icon="i-lucide-messages-square"
        class="relative hidden sm:inline-flex"
      >
        Chat
        <span
          v-if="chatBadge"
          class="absolute -top-1.5 -right-1.5 min-w-[1.15rem] rounded-full bg-honey px-1 text-center text-[10px] font-bold leading-4 text-chocolate ring-2 ring-[var(--surface)]"
        >
          {{ chatBadge }}
        </span>
      </UButton>
      <UButton
        to="/orders"
        color="primary"
        variant="soft"
        size="sm"
        icon="i-lucide-shopping-bag"
      >
        Orders
      </UButton>
      <UButton
        to="/shops"
        color="primary"
        size="sm"
        icon="i-lucide-store"
      >
        Shops
      </UButton>
    </div>
  </header>
</template>

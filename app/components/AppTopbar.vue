<script setup lang="ts">
import dayjs from "dayjs"
import { useAdminChatUnread } from "~/composables/useAdminChatUnread"

defineEmits<{ menu: [] }>()

const auth = useAuthStore()
const api = useApi()
const { total: chatUnread } = useAdminChatUnread()
const {
  items: notifs,
  unread: notifUnread,
  loading: notifLoading,
  busyAll,
  refresh: refreshNotifs,
  markAll,
  openOne,
  whenLabel,
} = useAdminNotifications()
const socketLive = useState("adminSocketLive", () => false)
const shopPendingBump = useState("adminShopPendingBump", () => 0)

const hour = dayjs().hour()
const greet = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening"
const today = dayjs().format("ddd, D MMM")

const notifOpen = ref(false)
const profileOpen = ref(false)
const loggingOut = ref(false)
let notifCloseTimer: ReturnType<typeof setTimeout> | null = null
let profileCloseTimer: ReturnType<typeof setTimeout> | null = null

const chatBadge = computed(() => {
  const n = Number(chatUnread.value) || 0
  if (n <= 0) return ""
  return n > 99 ? "99+" : String(n)
})

const notifBadge = computed(() => {
  const n = Number(notifUnread.value) || 0
  if (n <= 0) return ""
  return n > 99 ? "99+" : String(n)
})

const initials = computed(() => {
  const n = String(auth.user?.name || "Owner").trim()
  const parts = n.split(/\s+/).filter(Boolean)
  if (!parts.length) return "O"
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase()
})

function typeIcon(type: unknown) {
  const t = String(type || "system").toLowerCase()
  if (t === "order") return "i-lucide-shopping-bag"
  if (t === "chat") return "i-lucide-message-circle"
  if (t === "payment") return "i-lucide-wallet"
  if (t === "delivery") return "i-lucide-bike"
  if (t === "return") return "i-lucide-undo-2"
  return "i-lucide-bell"
}

function openNotifPanel() {
  if (notifCloseTimer) clearTimeout(notifCloseTimer)
  notifOpen.value = true
  profileOpen.value = false
  void refreshNotifs({ quiet: true })
}

function scheduleCloseNotif() {
  if (notifCloseTimer) clearTimeout(notifCloseTimer)
  notifCloseTimer = setTimeout(() => {
    notifOpen.value = false
  }, 160)
}

function openProfilePanel() {
  if (profileCloseTimer) clearTimeout(profileCloseTimer)
  profileOpen.value = true
  notifOpen.value = false
}

function scheduleCloseProfile() {
  if (profileCloseTimer) clearTimeout(profileCloseTimer)
  profileCloseTimer = setTimeout(() => {
    profileOpen.value = false
  }, 160)
}

function toggleNotif() {
  notifOpen.value = !notifOpen.value
  profileOpen.value = false
  if (notifOpen.value) void refreshNotifs({ quiet: true })
}

async function onNotifClick(n: (typeof notifs.value)[number]) {
  notifOpen.value = false
  await openOne(n)
}

async function logout() {
  loggingOut.value = true
  try {
    await api.auth.logout(auth.refreshToken || undefined)
  } catch {
    /* still clear */
  }
  auth.clear()
  await navigateTo("/login")
}

function onDocPointer(ev: PointerEvent) {
  const t = ev.target as HTMLElement | null
  if (!t?.closest?.("[data-header-notif]") && !t?.closest?.("[data-header-profile]")) {
    notifOpen.value = false
    profileOpen.value = false
  }
}

onMounted(() => {
  void refreshNotifs({ quiet: true })
  document.addEventListener("pointerdown", onDocPointer)
})
onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", onDocPointer)
  if (notifCloseTimer) clearTimeout(notifCloseTimer)
  if (profileCloseTimer) clearTimeout(profileCloseTimer)
})
</script>

<template>
  <header class="flex items-center justify-between gap-3 px-3 py-2.5 sm:px-5 lg:px-7">
    <div class="flex min-w-0 items-center gap-3">
      <button
        type="button"
        class="grid size-10 place-items-center rounded-xl border border-[var(--line)] bg-white text-chocolate shadow-sm transition hover:border-[#f2a7ad] hover:bg-[#fff0f2] lg:hidden"
        aria-label="Open menu"
        @click="$emit('menu')"
      >
        <UIcon name="i-lucide-menu" class="size-5" />
      </button>

      <div class="min-w-0">
        <p class="font-display truncate text-[1.15rem] leading-tight text-chocolate sm:text-xl">
          {{ greet }}
        </p>
        <p class="mt-0.5 flex flex-wrap items-center gap-x-1.5 truncate text-xs text-[var(--muted)]">
          <span>{{ today }}</span>
          <span class="text-[#e8d0c6]">·</span>
          <span>{{ auth.user?.name || "Owner" }}</span>
          <span
            class="ml-0.5 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[0.62rem] font-semibold"
            :class="socketLive || shopPendingBump > 0
              ? 'bg-[#e8f6ee] text-[#2e7d4f]'
              : 'bg-[#f8ede6] text-[var(--muted)]'"
          >
            <span
              class="size-1.5 rounded-full"
              :class="socketLive || shopPendingBump > 0 ? 'bg-success' : 'bg-[#c4a39a]'"
            />
            {{ socketLive || shopPendingBump > 0 ? "Live" : "Idle" }}
          </span>
        </p>
      </div>
    </div>

    <div class="flex shrink-0 items-center gap-1.5 sm:gap-2">
      <NuxtLink
        to="/chats"
        class="relative inline-flex h-9 items-center gap-1.5 rounded-xl border border-[var(--line)] bg-white px-2.5 text-sm font-medium text-chocolate shadow-sm transition hover:border-[#f2a7ad] hover:bg-[#fff0f2] sm:px-3"
      >
        <UIcon name="i-lucide-messages-square" class="size-4 text-[#e9748e]" />
        <span class="hidden sm:inline">Chat</span>
        <span
          v-if="chatBadge"
          class="absolute -top-1.5 -right-1.5 min-w-[1.15rem] rounded-full bg-[#e9748e] px-1 text-center text-[10px] font-bold leading-4 text-white ring-2 ring-[var(--bg)]"
        >
          {{ chatBadge }}
        </span>
      </NuxtLink>

      <NuxtLink
        to="/orders"
        class="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#fff0f2] px-2.5 text-sm font-semibold text-[#c44d66] ring-1 ring-[#f2a7ad]/50 transition hover:bg-[#ffe8ec] sm:px-3"
      >
        <UIcon name="i-lucide-shopping-bag" class="size-4" />
        <span class="hidden sm:inline">Orders</span>
      </NuxtLink>

      <NuxtLink
        to="/shops"
        class="inline-flex h-9 items-center gap-1.5 rounded-xl bg-chocolate px-2.5 text-sm font-semibold text-cream shadow-sm transition hover:bg-[#3a1e1a] sm:px-3"
      >
        <UIcon name="i-lucide-store" class="size-4" />
        <span class="hidden sm:inline">Shops</span>
      </NuxtLink>

      <!-- Notifications -->
      <div
        data-header-notif
        class="relative"
        @mouseenter="openNotifPanel"
        @mouseleave="scheduleCloseNotif"
      >
        <button
          type="button"
          class="relative inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--line)] bg-white text-chocolate shadow-sm transition hover:border-[#f2a7ad] hover:bg-[#fff0f2]"
          aria-label="Notifications"
          :aria-expanded="notifOpen"
          @click="toggleNotif"
        >
          <UIcon name="i-lucide-bell" class="size-4" />
          <span
            v-if="notifBadge"
            class="absolute -top-1.5 -right-1.5 min-w-[1.15rem] rounded-full bg-[#e9748e] px-1 text-center text-[10px] font-bold leading-4 text-white ring-2 ring-[var(--bg)]"
          >
            {{ notifBadge }}
          </span>
        </button>

        <div
          v-show="notifOpen"
          class="absolute right-0 top-[calc(100%+0.4rem)] z-50 w-[min(22rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-[var(--line)] bg-white shadow-[0_18px_40px_-18px_rgba(74,44,42,0.45)]"
          @mouseenter="openNotifPanel"
          @mouseleave="scheduleCloseNotif"
        >
          <div class="flex items-center justify-between gap-2 border-b border-[var(--line)] px-3.5 py-2.5">
            <div>
              <p class="m-0 text-sm font-semibold text-chocolate">Notifications</p>
              <p class="m-0 text-[0.65rem] text-[var(--muted)]">
                {{ notifUnread ? `${notifUnread} unread` : "All caught up" }}
              </p>
            </div>
            <button
              type="button"
              class="rounded-lg px-2 py-1 text-xs font-semibold text-[#e9748e] transition hover:bg-[#fff0f2] disabled:opacity-40"
              :disabled="!notifUnread || busyAll"
              @click="markAll"
            >
              {{ busyAll ? "…" : "Read all" }}
            </button>
          </div>

          <div class="max-h-[22rem] overflow-y-auto overscroll-contain">
            <div v-if="notifLoading && !notifs.length" class="space-y-2 p-3">
              <div v-for="i in 3" :key="i" class="sc-skeleton h-14 rounded-xl" />
            </div>
            <p v-else-if="!notifs.length" class="m-0 px-4 py-10 text-center text-sm text-[var(--muted)]">
              No notifications yet
            </p>
            <ul v-else class="m-0 list-none p-0">
              <li v-for="n in notifs" :key="n.id" class="border-b border-[var(--line)] last:border-0">
                <button
                  type="button"
                  class="flex w-full items-start gap-2.5 px-3.5 py-2.5 text-left transition hover:bg-[#fff9f5]"
                  :class="n.is_read ? 'bg-white' : 'bg-[#fff9f5]'"
                  @click="onNotifClick(n)"
                >
                  <span class="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-[#fff0f2] text-[#e9748e]">
                    <UIcon :name="typeIcon(n.type)" class="size-3.5" />
                  </span>
                  <span class="min-w-0 flex-1">
                    <span class="flex items-center gap-1.5">
                      <span class="truncate text-sm font-semibold text-chocolate">{{ n.title || "Notice" }}</span>
                      <span
                        v-if="!n.is_read"
                        class="size-1.5 shrink-0 rounded-full bg-[#e9748e]"
                      />
                    </span>
                    <span class="mt-0.5 line-clamp-2 block text-xs text-[var(--muted)]">
                      {{ n.body || n.message || "—" }}
                    </span>
                    <span class="mt-1 block text-[0.65rem] text-[var(--muted)]">
                      {{ whenLabel(n.created_at) }}
                      <span v-if="n.link"> · open</span>
                    </span>
                  </span>
                </button>
              </li>
            </ul>
          </div>

          <div class="border-t border-[var(--line)] bg-[#fff9f5] px-3.5 py-2">
            <NuxtLink
              to="/notifications"
              class="block text-center text-xs font-semibold text-[#e9748e] hover:underline"
              @click="notifOpen = false"
            >
              See all notifications
            </NuxtLink>
          </div>
        </div>
      </div>

      <!-- Profile -->
      <div
        data-header-profile
        class="relative"
        @mouseenter="openProfilePanel"
        @mouseleave="scheduleCloseProfile"
      >
        <button
          type="button"
          class="inline-flex h-9 items-center gap-2 rounded-xl border border-[var(--line)] bg-white pl-1.5 pr-2.5 text-sm font-medium text-chocolate shadow-sm transition hover:border-[#f2a7ad] hover:bg-[#fff0f2]"
          aria-label="Account menu"
          :aria-expanded="profileOpen"
          @click="profileOpen = !profileOpen"
        >
          <span class="grid size-6 place-items-center rounded-lg bg-[#fff0f2] text-[0.65rem] font-bold text-[#e9748e]">
            {{ initials }}
          </span>
          <span class="hidden max-w-[7rem] truncate sm:inline">{{ auth.user?.name || "Account" }}</span>
          <UIcon name="i-lucide-chevron-down" class="size-3.5 text-[var(--muted)]" />
        </button>

        <div
          v-show="profileOpen"
          class="absolute right-0 top-[calc(100%+0.4rem)] z-50 w-56 overflow-hidden rounded-2xl border border-[var(--line)] bg-white shadow-[0_18px_40px_-18px_rgba(74,44,42,0.45)]"
          @mouseenter="openProfilePanel"
          @mouseleave="scheduleCloseProfile"
        >
          <div class="border-b border-[var(--line)] px-3.5 py-3">
            <p class="m-0 truncate text-sm font-semibold text-chocolate">{{ auth.user?.name || "Owner" }}</p>
            <p class="m-0 truncate text-xs text-[var(--muted)]">{{ auth.user?.email || auth.user?.phone || "Admin" }}</p>
          </div>
          <nav class="p-1.5">
            <NuxtLink
              to="/settings?tab=account"
              class="flex items-center gap-2 rounded-xl px-2.5 py-2 text-sm text-chocolate transition hover:bg-[#fff9f5]"
              @click="profileOpen = false"
            >
              <UIcon name="i-lucide-user-round" class="size-4 text-[#e9748e]" />
              Profile
            </NuxtLink>
            <NuxtLink
              to="/settings"
              class="flex items-center gap-2 rounded-xl px-2.5 py-2 text-sm text-chocolate transition hover:bg-[#fff9f5]"
              @click="profileOpen = false"
            >
              <UIcon name="i-lucide-settings" class="size-4 text-[#e9748e]" />
              Settings
            </NuxtLink>
            <button
              type="button"
              class="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-sm text-[#c0392b] transition hover:bg-[#fff0f2]"
              :disabled="loggingOut"
              @click="logout"
            >
              <UIcon name="i-lucide-log-out" class="size-4" />
              {{ loggingOut ? "Signing out…" : "Log out" }}
            </button>
          </nav>
        </div>
      </div>
    </div>
  </header>
</template>

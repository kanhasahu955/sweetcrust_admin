<script setup lang="ts">
defineProps<{ open: boolean }>()
defineEmits<{ close: [] }>()

const route = useRoute()
const more = ref(false)
const auth = useAuthStore()
const api = useApi()
const shopPending = ref(0)
const pendingBump = useState("adminShopPendingBump", () => 0)

async function refreshShopPending() {
  try {
    const data = await api.admin.shops()
    const rows = Array.isArray(data) ? data : []
    shopPending.value = rows.filter((s) => {
      const st = String((s as { approval_status?: string }).approval_status || "approved")
      return st === "pending" || st === "incomplete"
    }).length
  } catch {
    /* ignore */
  }
}

watch(pendingBump, () => {
  void refreshShopPending()
})

onMounted(() => {
  if (auth.accessToken) void refreshShopPending()
})


watch(
  () => route.path,
  (p) => {
    if (NAV_MORE.some((i) => p.startsWith(i.to))) more.value = true
  },
  { immediate: true },
)

async function logout() {
  try {
    await api.auth.logout(auth.refreshToken || undefined)
  } catch {
    /* ignore */
  }
  auth.clear()
  navigateTo("/login")
}

function active(to: string) {
  if (to === "/dashboard") return route.path === "/dashboard" || route.path === "/"
  return route.path === to || route.path.startsWith(`${to}/`)
}

function iconName(icon: string) {
  return icon.startsWith("i-") ? icon : `i-${icon.replace(":", "-")}`
}
</script>

<template>
  <div
    v-if="open"
    class="fixed inset-0 z-40 bg-chocolate/40 backdrop-blur-[2px] lg:hidden"
    @click="$emit('close')"
  />
  <aside
    class="fixed inset-y-0 left-0 z-50 flex h-[100dvh] w-[260px] flex-col border-r border-honey/20 bg-gradient-to-b from-[#2a1a12] via-chocolate to-[#120e0b] text-cream transition-transform duration-200 ease-out"
    :class="open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'"
  >
    <div class="shrink-0 px-5 pb-5 pt-6">
      <p class="font-display text-2xl font-semibold text-transparent bg-gradient-to-br from-[#fff8ee] via-honey to-[#e8a87c] bg-clip-text">
        SweetCrust
      </p>
      <p class="mt-1 text-[0.68rem] uppercase tracking-[0.16em] text-cream/45">Owner ops console</p>
      <p class="mt-3 rounded-lg bg-white/5 px-2.5 py-1.5 text-[0.65rem] leading-snug text-cream/50">
        Buy stock → publish → shop orders → deliver → collect
      </p>
    </div>

    <p class="mb-1 shrink-0 px-5 text-[0.65rem] uppercase tracking-[0.12em] text-cream/35">Daily work</p>
    <nav class="min-h-0 flex-1 space-y-0.5 overflow-y-auto overscroll-contain px-3 pb-4">
      <NuxtLink
        v-for="item in NAV_PRIMARY"
        :key="item.to"
        :to="item.to"
        class="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-cream/70 transition hover:bg-white/5 hover:text-white"
        :class="active(item.to) ? 'bg-honey/25 text-white shadow-[inset_3px_0_0_#d4893a]' : ''"
        @click="$emit('close')"
      >
        <UIcon :name="iconName(item.icon)" class="size-4 shrink-0 text-honey" />
        <span class="flex-1 truncate">{{ item.label }}</span>
        <span
          v-if="item.to === '/shops' && shopPending > 0"
          class="rounded-md bg-honey px-1.5 py-0.5 text-[0.65rem] font-bold text-chocolate"
        >
          {{ shopPending }}
        </span>
      </NuxtLink>

      <button
        type="button"
        class="mt-3 flex w-full items-center gap-2 rounded-xl border border-honey/25 px-3 py-2 text-left text-sm text-cream/55"
        @click="more = !more"
      >
        <UIcon :name="more ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" class="size-4" />
        {{ more ? "Hide more" : "More tools" }}
      </button>

      <template v-if="more">
        <NuxtLink
          v-for="item in NAV_MORE"
          :key="item.to"
          :to="item.to"
          class="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-cream/70 transition hover:bg-white/5 hover:text-white"
          :class="active(item.to) ? 'bg-honey/25 text-white shadow-[inset_3px_0_0_#d4893a]' : ''"
          @click="$emit('close')"
        >
          <UIcon :name="iconName(item.icon)" class="size-4 shrink-0 text-honey" />
          {{ item.label }}
        </NuxtLink>
      </template>
    </nav>

    <div class="shrink-0 border-t border-honey/15 p-3">
      <p class="mb-2 truncate px-1 text-xs text-cream/45">{{ auth.user?.name || "Owner" }}</p>
      <button
        type="button"
        class="sc-btn-ghost w-full !border-honey/30 !text-cream/85 !bg-transparent hover:!bg-white/5"
        @click="logout"
      >
        <UIcon name="i-lucide-log-out" class="size-4" />
        Log out
      </button>
    </div>
  </aside>
</template>

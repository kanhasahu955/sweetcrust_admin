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
    class="fixed inset-0 z-40 bg-[#1a100e]/50 backdrop-blur-[4px] lg:hidden"
    @click="$emit('close')"
  />
  <aside
    class="sc-shell-aside fixed inset-y-0 left-0 z-50 flex h-[100dvh] w-[272px] flex-col text-cream transition-transform duration-200 ease-out"
    :class="open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'"
  >
    <div class="relative shrink-0 px-4 pb-3 pt-5">
      <div class="pointer-events-none absolute inset-x-0 top-0 h-28 bg-[radial-gradient(ellipse_at_top,_rgba(233,116,142,0.22),_transparent_70%)]" />
      <NuxtLink
        to="/dashboard"
        class="relative flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.06] px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] transition hover:bg-white/[0.09]"
        @click="$emit('close')"
      >
        <span class="grid size-11 shrink-0 place-items-center rounded-xl bg-[#fff9f5] shadow-sm ring-1 ring-white/20">
          <BrandLogo size="sm" />
        </span>
        <span class="min-w-0">
          <span class="block text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-[#f2a7ad]">Ops desk</span>
          <span class="mt-0.5 block truncate text-sm font-semibold text-white">Daily control</span>
        </span>
      </NuxtLink>
    </div>

    <p class="mb-1.5 shrink-0 px-5 text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-cream/35">
      Daily work
    </p>
    <nav class="min-h-0 flex-1 space-y-0.5 overflow-y-auto overscroll-contain px-2.5 pb-4">
      <NuxtLink
        v-for="item in NAV_PRIMARY"
        :key="item.to"
        :to="item.to"
        class="group flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm text-cream/70 transition"
        :class="active(item.to)
          ? 'bg-[#e9748e]/20 text-white shadow-[inset_3px_0_0_#e9748e]'
          : 'hover:bg-white/[0.06] hover:text-white'"
        @click="$emit('close')"
      >
        <span
          class="grid size-8 shrink-0 place-items-center rounded-lg transition"
          :class="active(item.to) ? 'bg-[#e9748e]/35 text-white' : 'bg-white/[0.05] text-[#f2a7ad] group-hover:bg-white/10'"
        >
          <UIcon :name="iconName(item.icon)" class="size-4" />
        </span>
        <span class="flex-1 truncate font-medium">{{ item.label }}</span>
        <span
          v-if="item.to === '/shops' && shopPending > 0"
          class="rounded-full bg-[#e9748e] px-1.5 py-0.5 text-[0.65rem] font-bold leading-none text-white"
        >
          {{ shopPending }}
        </span>
      </NuxtLink>

      <button
        type="button"
        class="mt-2 flex w-full items-center justify-between gap-2 rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2 text-left text-xs font-medium text-cream/45 transition hover:border-white/15 hover:bg-white/[0.06] hover:text-cream/75"
        @click="more = !more"
      >
        <span>{{ more ? "Hide more tools" : "More tools" }}</span>
        <UIcon :name="more ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" class="size-3.5" />
      </button>

      <template v-if="more">
        <NuxtLink
          v-for="item in NAV_MORE"
          :key="item.to"
          :to="item.to"
          class="group flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm text-cream/65 transition"
          :class="active(item.to)
            ? 'bg-[#e9748e]/20 text-white shadow-[inset_3px_0_0_#e9748e]'
            : 'hover:bg-white/[0.06] hover:text-white'"
          @click="$emit('close')"
        >
          <span
            class="grid size-8 shrink-0 place-items-center rounded-lg transition"
            :class="active(item.to) ? 'bg-[#e9748e]/35 text-white' : 'bg-white/[0.05] text-[#f2a7ad] group-hover:bg-white/10'"
          >
            <UIcon :name="iconName(item.icon)" class="size-4" />
          </span>
          <span class="truncate font-medium">{{ item.label }}</span>
        </NuxtLink>
      </template>
    </nav>
  </aside>
</template>

<style scoped>
.sc-shell-aside {
  border-right: 1px solid rgba(255, 255, 255, 0.08);
  background:
    linear-gradient(180deg, rgba(233, 116, 142, 0.08) 0%, transparent 28%),
    linear-gradient(180deg, #3a1e1a 0%, #241411 48%, #140c0b 100%);
  box-shadow: 10px 0 40px -24px rgba(20, 10, 8, 0.7);
}
</style>

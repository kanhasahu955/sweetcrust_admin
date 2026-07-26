<script setup lang="ts">
import { apiError, relativeAgo, statusLabel } from "~/utils/format"
import { patchListRow, removeListRow } from "~/utils/list"

const api = useApi()
const toast = useAppToast()
const { confirm } = useConfirm()
const socketLive = useState("adminSocketLive", () => false)
const { connect } = useSocket()
const headerNotifs = useAdminNotifications()

const rows = ref<Record<string, unknown>[]>([])
const loading = ref(true)
const refreshing = ref(false)
const busyId = ref<number | null>(null)
const busyAll = ref(false)
const error = ref("")
const q = ref("")
const flag = ref<"all" | "unread" | "order" | "chat" | "payment" | "system" | "other">("all")

const stats = ref({
  total: 0,
  unread: 0,
  read: 0,
  orders: 0,
  chat: 0,
  payments: 0,
  system: 0,
})

const filterTabs = [
  { value: "all" as const, label: "All" },
  { value: "unread" as const, label: "Unread" },
  { value: "order" as const, label: "Orders" },
  { value: "chat" as const, label: "Chat" },
  { value: "payment" as const, label: "Payments" },
  { value: "system" as const, label: "System" },
  { value: "other" as const, label: "Other" },
]

const CORE_TYPES = new Set(["order", "chat", "payment", "system"])

function typeIcon(type: unknown) {
  const t = String(type || "system").toLowerCase()
  if (t === "order") return "i-lucide-shopping-bag"
  if (t === "chat") return "i-lucide-message-circle"
  if (t === "payment") return "i-lucide-wallet"
  if (t === "delivery") return "i-lucide-bike"
  if (t === "return") return "i-lucide-undo-2"
  if (t === "stock" || t === "product") return "i-lucide-package"
  if (t === "ai") return "i-lucide-sparkles"
  if (t === "call") return "i-lucide-phone"
  if (t === "offer") return "i-lucide-tag"
  if (t === "custom_cake") return "i-lucide-cake"
  return "i-lucide-bell"
}

function typeTone(type: unknown) {
  const t = String(type || "system").toLowerCase()
  if (t === "order") return "bg-[#fff0f2] text-[#e9748e]"
  if (t === "chat") return "bg-[#e8f0ff] text-[#3b6bb5]"
  if (t === "payment") return "bg-[#e8f6ee] text-[#2e7d4f]"
  if (t === "delivery") return "bg-[#fff6e8] text-[#b8860b]"
  return "bg-[#f8ede6] text-chocolate"
}

const filtered = computed(() => {
  const ql = q.value.trim().toLowerCase()
  return rows.value.filter((n) => {
    const t = String(n.type || "system").toLowerCase()
    if (flag.value === "unread" && n.is_read) return false
    if (flag.value === "order" && t !== "order") return false
    if (flag.value === "chat" && t !== "chat") return false
    if (flag.value === "payment" && t !== "payment") return false
    if (flag.value === "system" && t !== "system") return false
    if (flag.value === "other" && CORE_TYPES.has(t)) return false
    if (!ql) return true
    return (
      String(n.title || "").toLowerCase().includes(ql)
      || String(n.body || n.message || "").toLowerCase().includes(ql)
      || String(n.type || "").toLowerCase().includes(ql)
      || String(n.order_number || "").toLowerCase().includes(ql)
      || String(n.id).includes(ql)
    )
  })
})

function parseHub(data: unknown) {
  if (Array.isArray(data)) {
    rows.value = data as Record<string, unknown>[]
    const unread = rows.value.filter((n) => !n.is_read).length
    stats.value = {
      total: rows.value.length,
      unread,
      read: rows.value.length - unread,
      orders: rows.value.filter((n) => String(n.type).toLowerCase() === "order").length,
      chat: rows.value.filter((n) => String(n.type).toLowerCase() === "chat").length,
      payments: rows.value.filter((n) => String(n.type).toLowerCase() === "payment").length,
      system: rows.value.filter((n) => String(n.type).toLowerCase() === "system").length,
    }
    return
  }
  const obj = (data || {}) as { items?: unknown[], stats?: Record<string, number> }
  rows.value = Array.isArray(obj.items) ? (obj.items as Record<string, unknown>[]) : []
  if (obj.stats) {
    stats.value = {
      total: Number(obj.stats.total) || rows.value.length,
      unread: Number(obj.stats.unread) || 0,
      read: Number(obj.stats.read) || 0,
      orders: Number(obj.stats.orders) || 0,
      chat: Number(obj.stats.chat) || 0,
      payments: Number(obj.stats.payments) || 0,
      system: Number(obj.stats.system) || 0,
    }
  }
}

async function load(opts?: { quiet?: boolean }) {
  if (opts?.quiet) refreshing.value = true
  else loading.value = true
  error.value = ""
  try {
    parseHub(await api.admin.notifications())
    // keep header bell badge in sync
    headerNotifs.items.value = rows.value.slice(0, 40) as typeof headerNotifs.items.value
    headerNotifs.unread.value = stats.value.unread
    headerNotifs.loaded.value = true
  } catch (e) {
    error.value = apiError(e)
    if (!opts?.quiet) toast.error(error.value)
  } finally {
    loading.value = false
    refreshing.value = false
  }
}

async function markOne(id: number) {
  busyId.value = id
  try {
    await api.admin.markNotificationRead(id)
    patchListRow(rows, id, { is_read: true })
    if (stats.value.unread > 0) {
      stats.value.unread -= 1
      stats.value.read += 1
    }
    toast.success("Marked read")
  } catch (e) {
    toast.error(apiError(e))
  } finally {
    busyId.value = null
  }
}

async function markAll() {
  if (!stats.value.unread) {
    toast.info("Nothing unread")
    return
  }
  busyAll.value = true
  try {
    const res = await api.admin.markNotificationRead()
    rows.value = rows.value.map((n) => ({ ...n, is_read: true }))
    stats.value.read = stats.value.total
    stats.value.unread = 0
    toast.success("All caught up", `${res.count ?? ""} marked read`)
  } catch (e) {
    toast.error(apiError(e))
  } finally {
    busyAll.value = false
  }
}

async function removeOne(id: number) {
  const ok = await confirm({
    title: "Delete notification",
    message: "Remove this notice from your inbox?",
    confirmText: "Delete",
    tone: "danger",
  })
  if (!ok) return
  busyId.value = id
  try {
    await api.admin.deleteNotification(id)
    const wasUnread = rows.value.find((n) => Number(n.id) === id && !n.is_read)
    removeListRow(rows, id)
    stats.value.total = Math.max(0, stats.value.total - 1)
    if (wasUnread) stats.value.unread = Math.max(0, stats.value.unread - 1)
    else stats.value.read = Math.max(0, stats.value.read - 1)
    toast.success("Deleted")
  } catch (e) {
    toast.error(apiError(e))
  } finally {
    busyId.value = null
  }
}

async function openLink(n: Record<string, unknown>) {
  if (!n.is_read) {
    try {
      await api.admin.markNotificationRead(Number(n.id))
      patchListRow(rows, Number(n.id), { is_read: true })
      if (stats.value.unread > 0) {
        stats.value.unread -= 1
        stats.value.read += 1
      }
    } catch {
      /* still navigate */
    }
  }
  const link = String(n.link || "")
  if (link) await navigateTo(link)
}

let liveSocket: ReturnType<typeof connect> = null
const onAdminEvent = (data: Record<string, unknown>) => {
  const kind = String(data?.kind || "")
  if (
    kind.includes("notification")
    || kind.includes("order")
    || kind.includes("chat")
    || kind.includes("payment")
    || kind.includes("return")
  ) {
    void load({ quiet: true })
  }
}

onMounted(() => {
  void load()
  liveSocket = connect()
  liveSocket?.on("admin_event", onAdminEvent)
})
onBeforeUnmount(() => {
  liveSocket?.off("admin_event", onAdminEvent)
})
</script>

<template>
  <div>
    <div class="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="font-display m-0 text-2xl text-chocolate sm:text-3xl">Notifications</h1>
        <p class="m-0 mt-1 flex flex-wrap items-center gap-2 text-sm text-[var(--muted)]">
          <span
            class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.65rem] font-semibold"
            :class="socketLive ? 'bg-[#e8f6ee] text-[#2e7d4f]' : 'bg-[#f8ede6] text-[var(--muted)]'"
          >
            <span class="size-1.5 rounded-full" :class="socketLive ? 'animate-pulse bg-success' : 'bg-[#c4a39a]'" />
            {{ socketLive ? "Live" : "Offline" }}
          </span>
          <span>Orders · chat · payments · system</span>
        </p>
      </div>
      <div class="flex flex-wrap gap-2">
        <UButton
          color="primary"
          variant="soft"
          icon="i-lucide-refresh-cw"
          :loading="loading || refreshing"
          label="Refresh"
          @click="load()"
        />
        <UButton
          color="secondary"
          icon="i-lucide-check-check"
          label="Mark all read"
          :loading="busyAll"
          :disabled="!stats.unread"
          @click="markAll"
        />
      </div>
    </div>

    <p v-if="error" class="mb-3 text-sm text-danger">{{ error }}</p>

    <div class="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="Total" :value="stats.total" icon="lucide:bell" />
      <StatCard label="Unread" :value="stats.unread" icon="lucide:bell-ring" :tone="stats.unread ? 'warn' : 'ok'" />
      <StatCard label="Orders" :value="stats.orders" icon="lucide:shopping-bag" />
      <StatCard label="Chat" :value="stats.chat" icon="lucide:message-circle" />
    </div>

    <div class="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <div class="flex flex-wrap gap-1.5">
        <button
          v-for="t in filterTabs"
          :key="t.value"
          type="button"
          class="rounded-full px-3 py-1.5 text-xs font-semibold transition"
          :class="flag === t.value ? 'bg-[#e9748e] text-white' : 'bg-white text-chocolate ring-1 ring-[var(--line)]'"
          @click="flag = t.value"
        >
          {{ t.label }}
          <span v-if="t.value === 'unread'"> {{ stats.unread }}</span>
          <span v-else-if="t.value === 'order'"> {{ stats.orders }}</span>
          <span v-else-if="t.value === 'chat'"> {{ stats.chat }}</span>
          <span v-else-if="t.value === 'payment'"> {{ stats.payments }}</span>
          <span v-else-if="t.value === 'system'"> {{ stats.system }}</span>
          <span v-else-if="t.value === 'all'"> {{ stats.total }}</span>
        </button>
      </div>
      <label class="relative block w-full max-w-md">
        <UIcon name="i-lucide-search" class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--muted)]" />
        <input
          v-model="q"
          class="sc-input w-full !rounded-xl !py-2.5 !pl-9"
          placeholder="Search title, body, type…"
        >
      </label>
    </div>

    <div v-if="loading" class="space-y-2">
      <div v-for="n in 5" :key="n" class="sc-skeleton h-20 rounded-2xl" />
    </div>

    <div
      v-else-if="!filtered.length"
      class="rounded-2xl border border-dashed border-[var(--line)] bg-white px-6 py-16 text-center shadow-[0_8px_22px_-18px_rgba(74,44,42,0.35)]"
    >
      <div class="mx-auto mb-3 flex size-12 items-center justify-center rounded-2xl bg-[#fff0f2] text-[#e9748e]">
        <UIcon name="i-lucide-bell-off" class="size-6" />
      </div>
      <p class="font-display m-0 text-xl text-chocolate">Inbox clear</p>
      <p class="m-0 mt-1 text-sm text-[var(--muted)]">
        New orders, chats, and system notices land here live.
      </p>
      <UButton
        class="mt-4"
        color="neutral"
        variant="outline"
        label="Clear filters"
        :disabled="flag === 'all' && !q"
        @click="flag = 'all'; q = ''"
      />
    </div>

    <ul
      v-else
      class="m-0 divide-y divide-[var(--line)] overflow-hidden rounded-2xl border border-[var(--line)] bg-white p-0 shadow-[0_8px_22px_-18px_rgba(74,44,42,0.35)]"
    >
      <li
        v-for="n in filtered"
        :key="String(n.id)"
        class="flex flex-wrap items-start gap-3 px-3.5 py-3 transition sm:px-4"
        :class="n.is_read ? 'bg-white' : 'bg-[#fff9f5]'"
      >
        <div
          class="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl"
          :class="typeTone(n.type)"
        >
          <UIcon :name="typeIcon(n.type)" class="size-4" />
        </div>

        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            <p class="m-0 font-semibold text-chocolate">{{ n.title || "Notice" }}</p>
            <span
              v-if="!n.is_read"
              class="rounded-full bg-[#e9748e] px-1.5 py-0.5 text-[0.6rem] font-bold uppercase tracking-wide text-white"
            >
              New
            </span>
            <span class="rounded-full px-2 py-0.5 text-[0.65rem] font-semibold capitalize" :class="typeTone(n.type)">
              {{ statusLabel(String(n.type || "system")) }}
            </span>
          </div>
          <p class="m-0 mt-0.5 text-sm text-[var(--muted)]">{{ n.body || n.message || "—" }}</p>
          <p class="m-0 mt-1 text-xs text-[var(--muted)]">
            {{ relativeAgo(String(n.created_at || "")) }}
            <span v-if="n.order_number"> · {{ n.order_number }}</span>
            <span v-else-if="n.order_id"> · Order #{{ n.order_id }}</span>
          </p>
        </div>

        <div class="flex shrink-0 flex-wrap gap-1.5">
          <UButton
            v-if="n.link"
            size="xs"
            color="secondary"
            variant="soft"
            label="Open"
            @click="openLink(n)"
          />
          <UButton
            v-if="!n.is_read"
            size="xs"
            color="neutral"
            variant="soft"
            label="Read"
            :loading="busyId === Number(n.id)"
            @click="markOne(Number(n.id))"
          />
          <UButton
            size="xs"
            color="neutral"
            variant="ghost"
            icon="i-lucide-trash-2"
            :loading="busyId === Number(n.id)"
            @click="removeOne(Number(n.id))"
          />
        </div>
      </li>
    </ul>
  </div>
</template>

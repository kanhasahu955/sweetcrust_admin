<script setup lang="ts">
import dayjs from "dayjs"
import { apiError, displayPhone, parseApiDate, relativeAgo } from "~/utils/format"
import { resolveMediaUrl } from "~/utils/mapPins"

type Conv = {
  id: number
  category?: string
  participant_name?: string
  participant_user_name?: string
  participant_role?: string
  participant_online?: boolean
  participant_phone?: string
  participant_id?: number
  shop_name?: string | null
  last_message?: string
  unread_admin?: number
  is_ai?: boolean
  ai_handed_over?: boolean
  order_id?: number | null
  updated_at?: string
}

type Msg = {
  id: number
  sender_role?: string
  content?: string | null
  message_type?: string
  media_url?: string | null
  is_delivered?: boolean
  is_read?: boolean
  created_at?: string
  conversation_id?: number
}

const api = useApi()
const toast = useAppToast()
const route = useRoute()
const router = useRouter()
const config = useRuntimeConfig()
const { connect, joinChat, emitTyping } = useSocket()
const { refreshChatUnread } = useAdminChatUnread()
const socketLive = useState("adminSocketLive", () => false)

const convs = ref<Conv[]>([])
const messages = ref<Msg[]>([])
const activeId = ref<number | null>(null)
const draft = ref("")
const attachUrl = ref("")
const filter = ref<"all" | "unread" | "retailer" | "customer" | "ai">("all")
const search = ref("")
const error = ref("")
const busy = ref(false)
const uploading = ref(false)
const peerTyping = ref(false)
const threadEl = ref<HTMLElement | null>(null)
const fileRef = ref<HTMLInputElement | null>(null)
let poll: ReturnType<typeof setInterval> | null = null
let typingTimer: ReturnType<typeof setTimeout> | null = null
let liveSocket: ReturnType<typeof connect> = null

const filterTabs = [
  { value: "all" as const, label: "All" },
  { value: "unread" as const, label: "Unread" },
  { value: "retailer" as const, label: "Shops" },
  { value: "customer" as const, label: "Customers" },
  { value: "ai" as const, label: "AI" },
]

const stats = computed(() => {
  const list = convs.value
  return {
    total: list.length,
    unread: list.reduce((n, c) => n + (Number(c.unread_admin) || 0), 0),
    shops: list.filter((c) => isShop(c)).length,
    customers: list.filter((c) => !isShop(c)).length,
    ai: list.filter((c) => c.is_ai && !c.ai_handed_over).length,
  }
})

const filtered = computed(() => {
  let rows = [...convs.value]
  if (filter.value === "unread") rows = rows.filter((c) => Number(c.unread_admin) > 0)
  else if (filter.value === "retailer") rows = rows.filter((c) => isShop(c))
  else if (filter.value === "customer") rows = rows.filter((c) => !isShop(c))
  else if (filter.value === "ai") rows = rows.filter((c) => c.is_ai && !c.ai_handed_over)
  const q = search.value.trim().toLowerCase()
  if (q) {
    rows = rows.filter(
      (c) =>
        String(c.participant_name || "").toLowerCase().includes(q)
        || String(c.shop_name || "").toLowerCase().includes(q)
        || String(c.last_message || "").toLowerCase().includes(q)
        || String(c.participant_phone || "").includes(q),
    )
  }
  return rows.sort((a, b) => {
    const ua = Number(a.unread_admin) || 0
    const ub = Number(b.unread_admin) || 0
    if (ua !== ub) return ub - ua
    return String(b.updated_at || "").localeCompare(String(a.updated_at || ""))
  })
})

const active = computed(() => convs.value.find((c) => c.id === activeId.value) || null)

const mobileThreadOpen = computed(() => !!activeId.value)

function isShop(c: Conv) {
  const cat = (c.category || "").toLowerCase()
  const role = (c.participant_role || "").toLowerCase()
  return cat.startsWith("retailer") || role === "retailer"
}

function initials(name?: string | null) {
  const n = String(name || "U").trim()
  const parts = n.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return `${parts[0]![0]}${parts[1]![0]}`.toUpperCase()
  return n.slice(0, 2).toUpperCase()
}

function when(ts?: string) {
  if (!ts) return ""
  const d = parseApiDate(ts)
  if (!d) return ""
  const mins = Math.max(0, dayjs().diff(d, "minute"))
  if (mins < 24 * 60) return d.format("h:mm A")
  return relativeAgo(ts)
}

function msgTime(ts?: string) {
  if (!ts) return ""
  const d = parseApiDate(ts)
  return d ? d.format("h:mm A") : ""
}

function roleLabel(role?: string) {
  const r = String(role || "").toLowerCase()
  if (r === "admin") return "You"
  if (r === "ai") return "AI"
  if (r === "system") return "System"
  if (r === "retailer") return "Shop"
  if (r === "customer") return "Customer"
  return role || ""
}

function isMine(m: Msg) {
  return m.sender_role === "admin"
}

function isAi(m: Msg) {
  return m.sender_role === "ai" || m.sender_role === "system"
}

function mediaSrc(url?: string | null) {
  return resolveMediaUrl(String(url || ""), String(config.public.apiBase || ""))
}

function previewText(c: Conv) {
  const last = String(c.last_message || "").trim()
  if (!last) return "No messages yet"
  if (last.toLowerCase() === "image" || last.toLowerCase() === "photo") return "Photo"
  return last
}

function scrollThread() {
  nextTick(() => {
    const el = threadEl.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

function mergeMsg(m: Msg) {
  if (!m?.id || m.conversation_id !== activeId.value) return
  if (messages.value.some((x) => x.id === m.id)) return
  messages.value = [...messages.value, m]
  scrollThread()
}

async function loadConvs(quiet = false) {
  try {
    const data = await api.admin.chats()
    convs.value = Array.isArray(data) ? (data as Conv[]) : []
  } catch (e) {
    if (!quiet) error.value = apiError(e)
  }
}

async function openChat(id: number) {
  activeId.value = id
  void router.replace({ query: { ...route.query, id: String(id) } })
  const row = convs.value.find((c) => c.id === id)
  if (row) row.unread_admin = 0
  busy.value = true
  error.value = ""
  peerTyping.value = false
  attachUrl.value = ""
  try {
    const data = await api.admin.chatMessages(id)
    messages.value = Array.isArray(data) ? (data as Msg[]) : []
    joinChat(id)
    await loadConvs(true)
    await refreshChatUnread()
    scrollThread()
  } catch (e) {
    error.value = apiError(e)
  } finally {
    busy.value = false
  }
}

function closeThread() {
  activeId.value = null
  messages.value = []
  const q = { ...route.query }
  delete q.id
  void router.replace({ query: q })
}

async function send() {
  if (!activeId.value) return
  const text = draft.value.trim()
  const media = attachUrl.value.trim()
  if (!text && !media) return
  busy.value = true
  error.value = ""
  const optimistic: Msg = {
    id: -Date.now(),
    conversation_id: activeId.value,
    sender_role: "admin",
    content: text || null,
    message_type: media ? "image" : "text",
    media_url: media || null,
    is_delivered: false,
    is_read: false,
    created_at: new Date().toISOString(),
  }
  messages.value = [...messages.value, optimistic]
  scrollThread()
  draft.value = ""
  attachUrl.value = ""
  emitTyping(activeId.value, false)
  try {
    const saved = (await api.admin.sendChatMessage(activeId.value, {
      content: text || undefined,
      message_type: media ? "image" : "text",
      media_url: media || undefined,
    })) as Msg
    messages.value = messages.value.filter((m) => m.id !== optimistic.id)
    if (saved?.id) mergeMsg({ ...saved, conversation_id: activeId.value })
    else await openChat(activeId.value)
    await loadConvs(true)
  } catch (e) {
    messages.value = messages.value.filter((m) => m.id !== optimistic.id)
    error.value = apiError(e)
    toast.error(apiError(e))
  } finally {
    busy.value = false
  }
}

function onDraft() {
  if (!activeId.value) return
  emitTyping(activeId.value, true)
  if (typingTimer) clearTimeout(typingTimer)
  typingTimer = setTimeout(() => {
    if (activeId.value) emitTyping(activeId.value, false)
  }, 1200)
}

async function onPickFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ""
  if (!file) return
  if (!file.type.startsWith("image/")) {
    toast.error("Images only for now")
    return
  }
  uploading.value = true
  try {
    const res = await api.uploadFile(file, "chat")
    const url = String(res?.url || "")
    if (!url) throw new Error("Upload failed")
    attachUrl.value = url
    toast.success("Photo attached")
  } catch (err) {
    toast.error(apiError(err))
  } finally {
    uploading.value = false
  }
}

async function takeover() {
  if (!activeId.value) return
  busy.value = true
  try {
    await api.admin.takeoverChat(activeId.value)
    toast.success("You took over")
    await openChat(activeId.value)
  } catch (e) {
    toast.error(apiError(e))
  } finally {
    busy.value = false
  }
}

async function releaseAi() {
  if (!activeId.value) return
  busy.value = true
  try {
    await api.admin.releaseChatToAi(activeId.value)
    toast.success("Returned to AI")
    await openChat(activeId.value)
  } catch (e) {
    toast.error(apiError(e))
  } finally {
    busy.value = false
  }
}

function profileLink(c: Conv) {
  if (isShop(c) && c.participant_id) return `/shops?q=${encodeURIComponent(String(c.shop_name || c.participant_name || ""))}`
  return "/customers"
}

onMounted(async () => {
  await loadConvs()
  const qid = Number(route.query.id)
  if (qid) await openChat(qid)
  liveSocket = connect()
  if (liveSocket) {
    liveSocket.on("connect", () => {
      if (activeId.value) joinChat(activeId.value)
    })
    liveSocket.on("chat_message", async (m: Msg) => {
      mergeMsg(m)
      if (m.conversation_id === activeId.value && m.sender_role !== "admin") {
        try {
          const data = await api.admin.chatMessages(activeId.value)
          messages.value = Array.isArray(data) ? (data as Msg[]) : []
          const row = convs.value.find((c) => c.id === activeId.value)
          if (row) row.unread_admin = 0
          scrollThread()
        } catch { /* ignore */ }
      }
      await loadConvs(true)
      await refreshChatUnread()
    })
    liveSocket.on("typing", (p: { conversation_id?: number; is_typing?: boolean }) => {
      if (p.conversation_id === activeId.value) peerTyping.value = Boolean(p.is_typing)
    })
    liveSocket.on("user_presence", () => { void loadConvs(true) })
  }
  poll = setInterval(async () => {
    await loadConvs(true)
    if (activeId.value && !socketLive.value) {
      try {
        const data = await api.admin.chatMessages(activeId.value)
        messages.value = Array.isArray(data) ? (data as Msg[]) : []
      } catch { /* ignore */ }
    }
    await refreshChatUnread()
  }, socketLive.value ? 20000 : 5000)
})

watch(peerTyping, (v) => {
  if (v) scrollThread()
})

onUnmounted(() => {
  if (poll) clearInterval(poll)
  liveSocket?.off("chat_message")
  liveSocket?.off("typing")
  liveSocket?.off("user_presence")
})
</script>

<template>
  <!-- Fill remaining viewport — list + composer stay on screen; only panes scroll -->
  <div class="chat-page -mb-16 flex flex-col overflow-hidden lg:-mb-20">
    <div class="mb-2 flex shrink-0 flex-wrap items-center justify-between gap-2">
      <div class="min-w-0">
        <div class="flex flex-wrap items-center gap-2">
          <h1 class="font-display m-0 text-xl text-chocolate sm:text-2xl">Live chat</h1>
          <span
            class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.65rem] font-semibold"
            :class="socketLive ? 'bg-[#e8f6ee] text-[#2e7d4f]' : 'bg-[#f8ede6] text-[var(--muted)]'"
          >
            <span class="size-1.5 rounded-full" :class="socketLive ? 'animate-pulse bg-success' : 'bg-[#c4a39a]'" />
            {{ socketLive ? "Live" : "Polling" }}
          </span>
          <span class="text-xs text-[var(--muted)]">{{ stats.total }} threads</span>
          <span v-if="stats.unread" class="text-xs font-semibold text-[#e9748e]">{{ stats.unread }} unread</span>
          <span class="text-xs text-[var(--muted)]">{{ stats.shops }} shops · {{ stats.customers }} customers</span>
        </div>
      </div>
      <UButton color="primary" variant="soft" size="sm" icon="i-lucide-refresh-cw" label="Refresh" @click="loadConvs()" />
    </div>

    <p v-if="error" class="mb-2 shrink-0 text-sm text-danger">{{ error }}</p>

    <div class="mb-2 flex shrink-0 flex-wrap gap-1">
      <button
        v-for="t in filterTabs"
        :key="t.value"
        type="button"
        class="rounded-full px-2.5 py-1 text-[0.7rem] font-semibold transition"
        :class="filter === t.value ? 'bg-chocolate text-cream' : 'bg-white text-chocolate ring-1 ring-[var(--line)]'"
        @click="filter = t.value"
      >
        {{ t.label }}
        <span v-if="t.value === 'unread' && stats.unread"> {{ stats.unread }}</span>
        <span v-else-if="t.value === 'retailer'"> {{ stats.shops }}</span>
        <span v-else-if="t.value === 'customer'"> {{ stats.customers }}</span>
        <span v-else-if="t.value === 'ai' && stats.ai"> {{ stats.ai }}</span>
      </button>
    </div>

    <div
      class="chat-shell grid min-h-0 flex-1 overflow-hidden lg:grid-cols-[300px_1fr]"
      :class="mobileThreadOpen ? 'chat-shell--thread' : ''"
    >
      <!-- Thread list -->
      <aside
        class="flex h-full min-h-0 flex-col border-b border-[var(--line)] bg-[#fffaf8] lg:border-b-0 lg:border-r"
        :class="mobileThreadOpen ? 'hidden lg:flex' : 'flex'"
      >
        <div class="shrink-0 border-b border-[var(--line)] p-3">
          <label class="relative block">
            <UIcon name="i-lucide-search" class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--muted)]" />
            <input
              v-model="search"
              class="sc-input w-full !rounded-xl !py-2.5 !pl-9 text-sm"
              placeholder="Search name or message…"
            >
          </label>
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <button
            v-for="c in filtered"
            :key="c.id"
            type="button"
            class="group flex w-full items-start gap-3 px-3 py-3 text-left transition"
            :class="activeId === c.id
              ? 'bg-[#ffe8ec] shadow-[inset_3px_0_0_#e9748e]'
              : 'hover:bg-white/80'"
            @click="openChat(c.id)"
          >
            <span class="relative shrink-0">
              <span
                class="grid size-11 place-items-center rounded-full text-xs font-bold text-white"
                :class="isShop(c) ? 'bg-chocolate' : 'bg-[#e9748e]'"
              >
                {{ initials(c.participant_name) }}
              </span>
              <span
                class="absolute bottom-0 right-0 size-3 rounded-full ring-2 ring-[#fffaf8]"
                :class="c.participant_online ? 'bg-success' : 'bg-[#d4b8ae]'"
              />
            </span>
            <span class="min-w-0 flex-1">
              <span class="flex items-center justify-between gap-2">
                <span class="truncate text-sm font-semibold text-chocolate">{{ c.participant_name || "User" }}</span>
                <span class="shrink-0 text-[0.65rem] tabular-nums text-[var(--muted)]">{{ when(c.updated_at) }}</span>
              </span>
              <span class="mt-0.5 flex items-center justify-between gap-2">
                <span class="flex min-w-0 items-center gap-1 truncate text-xs text-[var(--muted)]">
                  <UIcon
                    v-if="previewText(c) === 'Photo'"
                    name="i-lucide-camera"
                    class="size-3 shrink-0"
                  />
                  <span class="truncate">{{ previewText(c) }}</span>
                </span>
                <span
                  v-if="c.unread_admin"
                  class="shrink-0 rounded-full bg-[#e9748e] px-1.5 py-0.5 text-[0.62rem] font-bold leading-none text-white"
                >
                  {{ c.unread_admin }}
                </span>
              </span>
              <span class="mt-1 inline-flex flex-wrap items-center gap-1 text-[0.62rem] font-semibold uppercase tracking-wide text-[var(--muted)]">
                <span>{{ isShop(c) ? "Shop" : "Customer" }}</span>
                <span v-if="c.is_ai && !c.ai_handed_over" class="rounded bg-[#fff0f2] px-1 text-[#c44d66]">AI</span>
                <span v-if="c.order_id" class="rounded bg-[#fff9f5] px-1 text-chocolate ring-1 ring-[var(--line)]">#{{ c.order_id }}</span>
              </span>
            </span>
          </button>

          <div v-if="!filtered.length" class="px-4 py-12 text-center">
            <UIcon name="i-lucide-messages-square" class="mx-auto size-8 text-[#e8d0c6]" />
            <p class="mt-2 text-sm font-semibold text-chocolate">No chats yet</p>
            <p class="mt-1 text-xs text-[var(--muted)]">Threads show up when shops or customers write in.</p>
          </div>
        </div>
      </aside>

      <!-- Active thread -->
      <section
        class="flex h-full min-h-0 flex-col bg-white"
        :class="mobileThreadOpen ? 'flex' : 'hidden lg:flex'"
      >
        <template v-if="active">
          <header class="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] bg-gradient-to-r from-[#fff9f5] to-white px-4 py-3">
            <div class="flex min-w-0 items-center gap-3">
              <button
                type="button"
                class="grid size-9 place-items-center rounded-xl bg-[#f8ede6] text-chocolate lg:hidden"
                aria-label="Back"
                @click="closeThread"
              >
                <UIcon name="i-lucide-arrow-left" class="size-4" />
              </button>
              <span class="relative shrink-0">
                <span
                  class="grid size-11 place-items-center rounded-full text-xs font-bold text-cream"
                  :class="isShop(active) ? 'bg-chocolate' : 'bg-[#e9748e]'"
                >
                  {{ initials(active.participant_name) }}
                </span>
                <span
                  class="absolute bottom-0 right-0 size-3 rounded-full ring-2 ring-white"
                  :class="active.participant_online ? 'bg-success' : 'bg-[#d4b8ae]'"
                />
              </span>
              <div class="min-w-0">
                <p class="m-0 truncate text-base font-semibold text-chocolate">{{ active.participant_name }}</p>
                <p class="m-0 mt-0.5 truncate text-xs text-[var(--muted)]">
                  <span v-if="peerTyping" class="font-semibold text-[#e9748e]">typing…</span>
                  <template v-else>
                    {{ active.participant_online ? "Online now" : "Offline" }}
                    <span v-if="active.participant_phone"> · {{ displayPhone(active.participant_phone) }}</span>
                  </template>
                </p>
              </div>
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <span
                v-if="active.is_ai && !active.ai_handed_over"
                class="rounded-full bg-[#fff0f2] px-2.5 py-1 text-[0.68rem] font-semibold text-[#c44d66]"
              >
                AI handling
              </span>
              <span
                v-else-if="active.ai_handed_over"
                class="rounded-full bg-[#e8f6ee] px-2.5 py-1 text-[0.68rem] font-semibold text-[#2e7d4f]"
              >
                Human
              </span>
              <UButton
                v-if="active.is_ai && !active.ai_handed_over"
                color="secondary"
                size="sm"
                icon="i-lucide-user-round"
                :disabled="busy"
                label="Take over"
                @click="takeover"
              />
              <UButton
                v-else-if="active.ai_handed_over"
                color="neutral"
                variant="soft"
                size="sm"
                icon="i-lucide-bot"
                :disabled="busy"
                label="Return to AI"
                @click="releaseAi"
              />
              <UButton
                size="sm"
                color="neutral"
                variant="ghost"
                :to="profileLink(active)"
                :label="isShop(active) ? 'Shop' : 'Customer'"
              />
              <UButton
                v-if="active.order_id"
                size="sm"
                color="neutral"
                variant="ghost"
                :to="`/orders/${active.order_id}`"
                label="Order"
              />
            </div>
          </header>

          <div ref="threadEl" class="chat-thread min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-4">
            <div
              v-for="m in messages"
              :key="m.id"
              class="flex"
              :class="isMine(m) ? 'justify-end' : 'justify-start'"
            >
              <div
                class="max-w-[min(85%,28rem)] rounded-2xl px-3.5 py-2.5 text-sm shadow-sm"
                :class="isMine(m)
                  ? 'rounded-br-md bg-chocolate text-cream'
                  : isAi(m)
                    ? 'rounded-bl-md bg-[#ffe8ec] text-chocolate ring-1 ring-[#f2a7ad]/35'
                    : 'rounded-bl-md bg-white text-chocolate ring-1 ring-[var(--line)]'"
              >
                <p
                  v-if="!isMine(m)"
                  class="m-0 mb-1 text-[0.62rem] font-semibold uppercase tracking-wide"
                  :class="isAi(m) ? 'text-[#c44d66]' : 'text-[var(--muted)]'"
                >
                  {{ roleLabel(m.sender_role) }}
                </p>
                <a
                  v-if="(m.message_type === 'image' || m.media_url) && mediaSrc(m.media_url)"
                  :href="mediaSrc(m.media_url) || undefined"
                  target="_blank"
                  rel="noopener"
                  class="mb-1.5 block"
                >
                  <img
                    :src="mediaSrc(m.media_url) || undefined"
                    alt="Photo"
                    class="max-h-52 rounded-xl object-cover"
                  >
                </a>
                <p v-if="m.content" class="m-0 whitespace-pre-wrap leading-relaxed">{{ m.content }}</p>
                <p
                  class="m-0 mt-1.5 flex items-center justify-end gap-1.5 text-[0.62rem]"
                  :class="isMine(m) ? 'text-cream/55' : 'text-[var(--muted)]'"
                >
                  <span>{{ msgTime(m.created_at) }}</span>
                  <span v-if="isMine(m) && m.id > 0">
                    {{ m.is_read ? "Read" : m.is_delivered ? "Delivered" : "Sent" }}
                  </span>
                  <span v-else-if="isMine(m)">Sending…</span>
                </p>
              </div>
            </div>

            <div v-if="!messages.length" class="grid h-full min-h-[12rem] place-items-center text-center">
              <div>
                <UIcon name="i-lucide-hand" class="mx-auto size-8 text-[#e8d0c6]" />
                <p class="mt-2 text-sm font-semibold text-chocolate">Say hello</p>
                <p class="mt-1 text-xs text-[var(--muted)]">First reply starts the thread.</p>
              </div>
            </div>

            <div v-if="peerTyping" class="flex justify-start">
              <div class="rounded-2xl rounded-bl-md bg-white px-3 py-2 text-xs text-[var(--muted)] ring-1 ring-[var(--line)]">
                <span class="typing-dots">typing</span>
              </div>
            </div>
          </div>

          <form class="shrink-0 border-t border-[var(--line)] bg-[#fff9f5]/95 p-3 backdrop-blur" @submit.prevent="send">
            <div v-if="attachUrl" class="mb-2 flex items-center gap-2 rounded-xl bg-white p-2 ring-1 ring-[var(--line)]">
              <img :src="mediaSrc(attachUrl) || undefined" alt="" class="size-12 rounded-lg object-cover">
              <p class="m-0 min-w-0 flex-1 truncate text-xs text-[var(--muted)]">Photo ready to send</p>
              <UButton size="xs" color="neutral" variant="ghost" label="Remove" @click="attachUrl = ''" />
            </div>
            <div class="flex items-end gap-2 rounded-2xl bg-white p-2 shadow-sm ring-1 ring-[var(--line)]">
              <button
                type="button"
                class="grid size-10 shrink-0 place-items-center rounded-xl text-chocolate transition hover:bg-[#fff0f2] disabled:opacity-40"
                :disabled="busy || uploading"
                aria-label="Attach photo"
                @click="fileRef?.click()"
              >
                <UIcon :name="uploading ? 'i-lucide-loader-circle' : 'i-lucide-image-plus'" class="size-4" :class="uploading ? 'animate-spin' : ''" />
              </button>
              <input ref="fileRef" type="file" accept="image/*" class="hidden" @change="onPickFile">
              <textarea
                v-model="draft"
                rows="1"
                class="max-h-28 min-h-[2.5rem] flex-1 resize-none border-0 bg-transparent px-2 py-2 text-sm text-chocolate outline-none placeholder:text-[var(--muted)]"
                placeholder="Type a reply…"
                :disabled="busy"
                @focus="scrollThread"
                @input="onDraft"
                @keydown.enter.exact.prevent="send"
              />
              <button
                type="submit"
                class="grid size-10 shrink-0 place-items-center rounded-xl bg-[#e9748e] text-white transition hover:bg-[#d45a78] disabled:opacity-40"
                :disabled="busy || (!draft.trim() && !attachUrl)"
                aria-label="Send"
              >
                <UIcon name="i-lucide-send" class="size-4" />
              </button>
            </div>
          </form>
        </template>

        <div v-else class="grid flex-1 place-items-center bg-[radial-gradient(ellipse_at_center,_#fff0f2_0%,_#fffaf8_55%,_#fff_100%)] px-6 text-center">
          <div>
            <span class="mx-auto grid size-16 place-items-center rounded-2xl bg-white shadow-sm ring-1 ring-[var(--line)]">
              <UIcon name="i-lucide-messages-square" class="size-7 text-[#e9748e]" />
            </span>
            <p class="mt-4 font-display text-xl text-chocolate">Pick a conversation</p>
            <p class="mx-auto mt-1 max-w-[28ch] text-sm text-[var(--muted)]">
              Select a shop or customer on the left to reply in realtime.
            </p>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.chat-page {
  /* topbar + main padding + mobile bottom bar — keep inbox + composer on screen */
  height: calc(100dvh - 9.25rem);
  max-height: calc(100dvh - 9.25rem);
}

@media (min-width: 1024px) {
  .chat-page {
    height: calc(100dvh - 7.5rem);
    max-height: calc(100dvh - 7.5rem);
  }
}

.chat-shell {
  border-radius: 1.25rem;
  border: 1px solid var(--line);
  background: #fff;
  box-shadow: 0 18px 40px -28px rgba(74, 44, 42, 0.35);
  min-height: 0;
}

.chat-thread {
  background:
    radial-gradient(circle at 12% 8%, rgba(233, 116, 142, 0.06), transparent 28%),
    radial-gradient(circle at 88% 92%, rgba(74, 44, 42, 0.04), transparent 32%),
    #fffaf8;
}

.typing-dots::after {
  content: "";
  animation: chat-dots 1.2s steps(4, end) infinite;
}

@keyframes chat-dots {
  0% { content: ""; }
  25% { content: "."; }
  50% { content: ".."; }
  75% { content: "..."; }
}
</style>

<script setup lang="ts">
type Conv = {
  id: number
  category?: string
  participant_name?: string
  participant_role?: string
  participant_online?: boolean
  participant_phone?: string
  last_message?: string
  unread_admin?: number
  is_ai?: boolean
  ai_handed_over?: boolean
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
const { connect, joinChat, emitTyping } = useSocket()
const { refreshChatUnread } = useAdminChatUnread()
const convs = ref<Conv[]>([])
const messages = ref<Msg[]>([])
const activeId = ref<number | null>(null)
const draft = ref("")
const filter = ref<"all" | "retailer" | "customer">("all")
const search = ref("")
const error = ref("")
const busy = ref(false)
const live = ref(false)
const peerTyping = ref(false)
let poll: ReturnType<typeof setInterval> | null = null
let typingTimer: ReturnType<typeof setTimeout> | null = null

const filtered = computed(() => {
  let rows = convs.value
  if (filter.value !== "all") {
    rows = rows.filter((c) => {
      const cat = (c.category || "").toLowerCase()
      const role = (c.participant_role || "").toLowerCase()
      if (filter.value === "retailer") return cat.startsWith("retailer") || role === "retailer"
      return !cat.startsWith("retailer") && role !== "retailer"
    })
  }
  const q = search.value.trim().toLowerCase()
  if (!q) return rows
  return rows.filter(
    (c) =>
      String(c.participant_name || "").toLowerCase().includes(q)
      || String(c.last_message || "").toLowerCase().includes(q)
      || String(c.participant_phone || "").includes(q),
  )
})

const active = computed(() => convs.value.find((c) => c.id === activeId.value) || null)

function mergeMsg(m: Msg) {
  if (!m?.id || m.conversation_id !== activeId.value) return
  if (messages.value.some((x) => x.id === m.id)) return
  messages.value = [...messages.value, m]
}

async function loadConvs() {
  try {
    const data = await api.admin.chats()
    convs.value = Array.isArray(data) ? (data as Conv[]) : []
  } catch (e) {
    error.value = apiError(e)
  }
}

async function openChat(id: number) {
  activeId.value = id
  const row = convs.value.find((c) => c.id === id)
  if (row) row.unread_admin = 0
  busy.value = true
  error.value = ""
  peerTyping.value = false
  try {
    const data = await api.admin.chatMessages(id)
    messages.value = Array.isArray(data) ? (data as Msg[]) : []
    joinChat(id)
    await loadConvs()
    await refreshChatUnread()
  } catch (e) {
    error.value = apiError(e)
  } finally {
    busy.value = false
  }
}

async function send() {
  if (!activeId.value || !draft.value.trim()) return
  busy.value = true
  error.value = ""
  try {
    await api.admin.sendChatMessage(activeId.value, { content: draft.value.trim(), message_type: "text" })
    draft.value = ""
    emitTyping(activeId.value, false)
    await openChat(activeId.value)
  } catch (e) {
    error.value = apiError(e)
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

async function takeover() {
  if (!activeId.value) return
  busy.value = true
  try {
    await api.admin.takeoverChat(activeId.value)
    await openChat(activeId.value)
  } catch (e) {
    error.value = apiError(e)
  } finally {
    busy.value = false
  }
}

onMounted(async () => {
  await loadConvs()
  const s = connect()
  if (s) {
    live.value = s.connected
    s.on("connect", () => {
      live.value = true
      if (activeId.value) joinChat(activeId.value)
    })
    s.on("disconnect", () => { live.value = false })
    s.on("chat_message", async (m: Msg) => {
      mergeMsg(m)
      if (m.conversation_id === activeId.value && m.sender_role !== "admin") {
        try {
          const data = await api.admin.chatMessages(activeId.value)
          messages.value = Array.isArray(data) ? (data as Msg[]) : []
          const row = convs.value.find((c) => c.id === activeId.value)
          if (row) row.unread_admin = 0
        } catch { /* ignore */ }
      }
      await loadConvs()
      await refreshChatUnread()
    })
    s.on("typing", (p: { conversation_id?: number; is_typing?: boolean }) => {
      if (p.conversation_id === activeId.value) peerTyping.value = Boolean(p.is_typing)
    })
    s.on("user_presence", () => { loadConvs() })
  }
  poll = setInterval(async () => {
    await loadConvs()
    if (activeId.value && !live.value) {
      try {
        const data = await api.admin.chatMessages(activeId.value)
        messages.value = Array.isArray(data) ? (data as Msg[]) : []
      } catch { /* ignore */ }
    }
    await refreshChatUnread()
  }, live.value ? 15000 : 4000)
})

onUnmounted(() => {
  if (poll) clearInterval(poll)
  const s = connect()
  s?.off("chat_message")
  s?.off("typing")
  s?.off("user_presence")
})
</script>

<template>
  <div>
    <PageHeader title="Live chat" subtitle="Realtime shop & customer threads — online badge, typing, offline catch-up">
      <template #actions>
        <span class="mr-2 text-xs" :class="live ? 'text-emerald-600' : 'text-[var(--muted)]'">
          {{ live ? "● Live" : "○ Polling" }}
        </span>
        <div class="flex gap-2">
          <UButton color="neutral" variant="outline" v-for="f in (['all', 'retailer', 'customer'] as const)"
            :key="f"
            type="button" class="!py-1.5 text-xs capitalize" 
            :class="filter === f ? '!bg-honey/20 !text-chocolate' : ''"
            @click="filter = f"
          >
            {{ f === "all" ? "All" : f === "retailer" ? "Shops" : "Customers" }}
          </UButton>
        </div>
      </template>
    </PageHeader>

    <p v-if="error" class="mb-3 text-sm text-danger">{{ error }}</p>

    <div class="grid min-h-[62vh] gap-3 lg:grid-cols-[320px_1fr]">
      <div class="sc-card overflow-hidden">
        <div class="border-b border-[var(--line)] p-3">
          <input v-model="search" class="sc-input w-full text-sm" placeholder="Search shop / message…">
        </div>
        <div class="max-h-[70vh] divide-y divide-[var(--line)] overflow-y-auto">
          <button
            v-for="c in filtered"
            :key="c.id"
            type="button"
            class="flex w-full flex-col gap-1 px-3 py-3 text-left text-sm transition hover:bg-honey/10"
            :class="activeId === c.id ? 'bg-honey/15' : ''"
            @click="openChat(c.id)"
          >
            <div class="flex items-center justify-between gap-2">
              <span class="flex items-center gap-2 font-semibold">
                <span
                  class="inline-block size-2 rounded-full"
                  :class="c.participant_online ? 'bg-emerald-500' : 'bg-stone-300'"
                />
                {{ c.participant_name || "User" }}
              </span>
              <span
                v-if="c.unread_admin"
                class="rounded-full bg-honey px-1.5 text-[10px] font-bold text-chocolate"
              >
                {{ c.unread_admin }}
              </span>
            </div>
            <p class="truncate text-xs text-[var(--muted)]">{{ c.last_message || "—" }}</p>
            <p class="text-[10px] uppercase tracking-wide text-[var(--muted)]">
              {{ c.participant_role || c.category }}{{ c.is_ai && !c.ai_handed_over ? " · AI" : "" }}
            </p>
          </button>
          <EmptyState v-if="!filtered.length" class="m-4" title="No chats yet" />
        </div>
      </div>

      <div class="sc-card flex min-h-[62vh] flex-col">
        <template v-if="active">
          <div class="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] px-4 py-3">
            <div>
              <p class="font-semibold">
                <span
                  class="mr-1.5 inline-block size-2 rounded-full"
                  :class="active.participant_online ? 'bg-emerald-500' : 'bg-stone-300'"
                />
                {{ active.participant_name }}
              </p>
              <p class="text-xs text-[var(--muted)]">
                {{ active.participant_online ? "Online now" : "Offline — they see messages when they open the app" }}
                <span v-if="active.participant_phone"> · {{ active.participant_phone }}</span>
                <span v-if="peerTyping" class="ml-2 text-honey">typing…</span>
              </p>
            </div>
            <UButton color="primary" variant="soft" v-if="active.is_ai && !active.ai_handed_over"
              type="button" class="!py-1.5 text-xs" 
              :disabled="busy"
              @click="takeover"
            >
              Take over from AI
            </UButton>
          </div>

          <div class="flex-1 space-y-2 overflow-y-auto px-4 py-3">
            <div
              v-for="m in messages"
              :key="m.id"
              class="max-w-[85%] rounded-2xl px-3 py-2 text-sm"
              :class="
                m.sender_role === 'admin'
                  ? 'ml-auto bg-chocolate text-cream'
                  : m.sender_role === 'ai' || m.sender_role === 'system'
                    ? 'bg-honey/20 text-chocolate'
                    : 'bg-[var(--paper)] text-chocolate'
              "
            >
              <p class="mb-0.5 text-[10px] uppercase opacity-60">{{ m.sender_role }}</p>
              <img
                v-if="m.message_type === 'image' && m.media_url"
                :src="String(m.media_url)"
                alt="Photo"
                class="mb-1 max-h-48 rounded-lg"
              >
              <p v-if="m.content" class="whitespace-pre-wrap">{{ m.content }}</p>
              <p v-if="m.sender_role === 'admin'" class="mt-1 text-[10px] opacity-50">
                {{ m.is_read ? "Read" : m.is_delivered ? "Delivered" : "Sent" }}
              </p>
            </div>
            <EmptyState v-if="!messages.length" title="Say hello" />
          </div>

          <form class="flex gap-2 border-t border-[var(--line)] p-3" @submit.prevent="send">
            <input
              v-model="draft"
              class="sc-input flex-1"
              placeholder="Reply…"
              :disabled="busy"
              @input="onDraft"
            >
            <UButton type="submit" :disabled="busy || !draft.trim()">Send</UButton>
          </form>
        </template>
        <EmptyState v-else class="m-auto" title="Select a conversation" />
      </div>
    </div>
  </div>
</template>

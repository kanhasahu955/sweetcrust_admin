<script setup lang="ts">
import { apiError, relativeAgo, statusLabel } from "~/utils/format"
import { patchListRow, removeListRow, upsertListRow } from "~/utils/list"

const api = useApi()
const toast = useAppToast()
const { confirm } = useConfirm()
const socketLive = useState("adminSocketLive", () => false)
const { connect } = useSocket()

const faqs = ref<Record<string, unknown>[]>([])
const runs = ref<Record<string, unknown>[]>([])
const insights = ref<unknown[]>([])
const previewMatches = ref<Record<string, unknown>[]>([])

const loading = ref(true)
const refreshing = ref(false)
const busy = ref(false)
const insightsBusy = ref(false)
const previewBusy = ref(false)
const error = ref("")
const q = ref("")
const previewQ = ref("")
const flag = ref<"all" | "active" | "inactive" | "en" | "hi" | "or">("all")
const tab = ref<"faqs" | "runs" | "insights">("faqs")
const panelOpen = ref(false)

const stack = ref({
  langsmith: false,
  project: "sweetcrust",
  langchain: true,
  langgraph: true,
  agentic_rag: true,
})

const stats = ref({
  total_ai_conversations: 0,
  transferred_to_admin: 0,
  active_faqs: 0,
  inactive_faqs: 0,
  total_faqs: 0,
})

const form = reactive({
  id: 0,
  question: "",
  answer: "",
  language: "en",
  is_active: true,
})

const languageOptions = [
  { value: "en", label: "English" },
  { value: "hi", label: "Hindi" },
  { value: "or", label: "Odia" },
]

const starters = [
  {
    question: "Do you deliver same day?",
    answer: "Yes — order before the cut-off shown in the app for same-day delivery in our zones.",
    language: "en",
  },
  {
    question: "What payment methods do you accept?",
    answer: "UPI, cards, and approved shop credit (udhaar) where enabled.",
    language: "en",
  },
  {
    question: "Can I order eggless cakes?",
    answer: "Yes — filter Eggless in the catalog, or ask us to customise.",
    language: "en",
  },
]

const filterTabs = [
  { value: "all" as const, label: "All" },
  { value: "active" as const, label: "Active" },
  { value: "inactive" as const, label: "Off" },
  { value: "en" as const, label: "EN" },
  { value: "hi" as const, label: "HI" },
  { value: "or" as const, label: "OR" },
]

const filtered = computed(() => {
  const ql = q.value.trim().toLowerCase()
  return faqs.value.filter((f) => {
    const lang = String(f.language || "en").toLowerCase()
    if (flag.value === "active" && !f.is_active) return false
    if (flag.value === "inactive" && f.is_active) return false
    if (["en", "hi", "or"].includes(flag.value) && lang !== flag.value) return false
    if (!ql) return true
    return (
      String(f.question || "").toLowerCase().includes(ql)
      || String(f.answer || "").toLowerCase().includes(ql)
    )
  })
})

function langLabel(code: unknown) {
  const c = String(code || "en").toLowerCase()
  return languageOptions.find((o) => o.value === c)?.label || c.toUpperCase()
}

function runTone(status: unknown) {
  const s = String(status || "").toLowerCase()
  if (s === "ok") return "bg-[#e8f6ee] text-[#2e7d4f]"
  if (s === "error" || s === "blocked") return "bg-[#fdecea] text-[#c0392b]"
  if (s === "running") return "bg-[#fff0f2] text-[#e9748e]"
  return "bg-[#f8ede6] text-[var(--muted)]"
}

function openCreate(starter?: { question: string, answer: string, language: string }) {
  form.id = 0
  form.question = starter?.question || ""
  form.answer = starter?.answer || ""
  form.language = starter?.language || "en"
  form.is_active = true
  panelOpen.value = true
}

function openEdit(f: Record<string, unknown>) {
  form.id = Number(f.id)
  form.question = String(f.question || "")
  form.answer = String(f.answer || "")
  form.language = String(f.language || "en")
  form.is_active = f.is_active !== false
  panelOpen.value = true
}

function closePanel() {
  panelOpen.value = false
}

async function load(opts: { quiet?: boolean } = {}) {
  if (opts.quiet) refreshing.value = true
  else loading.value = true
  error.value = ""
  try {
    const data = await api.admin.chatbot()
    faqs.value = Array.isArray(data.faqs) ? data.faqs : []
    runs.value = Array.isArray(data.recent_runs) ? data.recent_runs : []
    const st = data.stats || {}
    stats.value = {
      total_ai_conversations: Number(st.total_ai_conversations) || 0,
      transferred_to_admin: Number(st.transferred_to_admin) || 0,
      active_faqs: Number(st.active_faqs) || 0,
      inactive_faqs: Number(st.inactive_faqs) || 0,
      total_faqs: Number(st.total_faqs) || faqs.value.length,
    }
    if (data.stack) {
      stack.value = {
        langsmith: Boolean(data.stack.langsmith),
        project: String(data.stack.project || "sweetcrust"),
        langchain: data.stack.langchain !== false,
        langgraph: data.stack.langgraph !== false,
        agentic_rag: data.stack.agentic_rag !== false,
      }
    }
  } catch (e) {
    error.value = apiError(e)
    if (!opts.quiet) toast.error(error.value)
  } finally {
    loading.value = false
    refreshing.value = false
  }
}

async function save() {
  if (!form.question.trim() || !form.answer.trim()) {
    toast.error("Question and answer required")
    return
  }
  busy.value = true
  try {
    const body = {
      question: form.question.trim(),
      answer: form.answer.trim(),
      language: form.language || "en",
      is_active: form.is_active,
    }
    const saved = form.id
      ? await api.admin.updateFaq(form.id, body)
      : await api.admin.createFaq(body)
    upsertListRow(faqs, saved as Record<string, unknown>)
    toast.success(form.id ? "FAQ updated" : "FAQ added")
    panelOpen.value = false
    void load({ quiet: true })
  } catch (e) {
    toast.error(apiError(e))
  } finally {
    busy.value = false
  }
}

async function toggle(f: Record<string, unknown>) {
  busy.value = true
  try {
    const saved = await api.admin.updateFaq(Number(f.id), { is_active: !f.is_active })
    if (!upsertListRow(faqs, saved as Record<string, unknown>)) {
      patchListRow(faqs, Number(f.id), { is_active: !f.is_active })
    }
    toast.success(f.is_active ? "FAQ disabled" : "FAQ enabled")
    void load({ quiet: true })
  } catch (e) {
    toast.error(apiError(e))
  } finally {
    busy.value = false
  }
}

async function remove(f: Record<string, unknown>) {
  const ok = await confirm({
    title: "Delete FAQ",
    message: "Delete this FAQ? The chatbot will stop using this answer.",
    confirmText: "Delete",
    tone: "danger",
  })
  if (!ok) return
  busy.value = true
  try {
    await api.admin.deleteFaq(Number(f.id))
    removeListRow(faqs, Number(f.id))
    toast.success("FAQ deleted")
    void load({ quiet: true })
  } catch (e) {
    toast.error(apiError(e))
  } finally {
    busy.value = false
  }
}

async function loadInsights(useLlm = false) {
  insightsBusy.value = true
  tab.value = "insights"
  try {
    const res = await api.admin.aiInsights(useLlm)
    const raw = res?.insights
    insights.value = Array.isArray(raw) ? raw : raw ? [raw] : []
    if (!insights.value.length) toast.info("No insights yet — need a bit more order history")
  } catch (e) {
    toast.error(apiError(e))
  } finally {
    insightsBusy.value = false
  }
}

async function runPreview() {
  const query = previewQ.value.trim()
  if (!query) {
    toast.error("Enter a test question")
    return
  }
  previewBusy.value = true
  try {
    const res = await api.admin.chatbotPreview(query)
    previewMatches.value = Array.isArray(res.matches) ? res.matches : []
    if (!previewMatches.value.length) toast.info("No FAQ matched — add one for this topic")
  } catch (e) {
    toast.error(apiError(e))
  } finally {
    previewBusy.value = false
  }
}

let liveSocket: ReturnType<typeof connect> = null
onMounted(async () => {
  await load()
  liveSocket = connect()
  liveSocket?.on("admin_event", (data: Record<string, unknown>) => {
    const kind = String(data?.kind || "")
    if (kind.includes("chat") || kind.includes("ai") || kind.includes("faq")) {
      void load({ quiet: true })
    }
  })
})
onBeforeUnmount(() => {
  liveSocket?.off("admin_event")
})
</script>

<template>
  <div>
    <div class="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="font-display m-0 text-2xl text-chocolate sm:text-3xl">AI bot & FAQs</h1>
        <p class="m-0 mt-1 flex flex-wrap items-center gap-2 text-sm text-[var(--muted)]">
          <span
            class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.65rem] font-semibold"
            :class="socketLive ? 'bg-[#e8f6ee] text-[#2e7d4f]' : 'bg-[#f8ede6] text-[var(--muted)]'"
          >
            <span class="size-1.5 rounded-full" :class="socketLive ? 'animate-pulse bg-success' : 'bg-[#c4a39a]'" />
            {{ socketLive ? "Live" : "Offline" }}
          </span>
          <span>Shop & customer answers · RAG first, then handoff to you</span>
        </p>
      </div>
      <div class="flex flex-wrap gap-2">
        <UButton to="/chats" color="neutral" variant="outline" icon="i-lucide-messages-square" label="Chats" />
        <UButton
          color="primary"
          variant="soft"
          icon="i-lucide-sparkles"
          :loading="insightsBusy"
          label="Insights"
          @click="loadInsights(false)"
        />
        <UButton color="secondary" icon="i-lucide-plus" label="Add FAQ" @click="openCreate()" />
        <UButton
          color="primary"
          variant="soft"
          icon="i-lucide-refresh-cw"
          :loading="loading || refreshing"
          label="Refresh"
          @click="load()"
        />
      </div>
    </div>

    <p v-if="error" class="mb-3 text-sm text-danger">{{ error }}</p>

    <div v-if="loading" class="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <div v-for="n in 4" :key="n" class="sc-skeleton h-24 rounded-2xl" />
    </div>
    <div v-else class="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="AI chats" :value="stats.total_ai_conversations" icon="lucide:bot" />
      <StatCard
        label="Handed to you"
        :value="stats.transferred_to_admin"
        icon="lucide:user-check"
        :tone="stats.transferred_to_admin ? 'warn' : 'ok'"
      />
      <StatCard label="Active FAQs" :value="stats.active_faqs" icon="lucide:help-circle" tone="ok" />
      <StatCard
        label="Stack"
        :value="stack.langsmith ? 'LangSmith on' : 'LangSmith off'"
        icon="lucide:layers"
        :hint="`${stack.project} · LangGraph · RAG`"
      />
    </div>

    <div class="mb-4 grid gap-3 lg:grid-cols-3">
      <div class="rounded-2xl border border-[var(--line)] bg-white p-4 shadow-[0_8px_22px_-18px_rgba(74,44,42,0.35)] lg:col-span-2">
        <div class="mb-2 flex items-center justify-between gap-2">
          <h2 class="font-display m-0 text-lg text-chocolate">Test the bot</h2>
          <span class="text-xs text-[var(--muted)]">Same FAQ scorer as live chat</span>
        </div>
        <div class="flex flex-col gap-2 sm:flex-row">
          <input
            v-model="previewQ"
            class="sc-input w-full !rounded-xl"
            placeholder="e.g. How does shop credit work?"
            @keydown.enter.prevent="runPreview"
          >
          <UButton
            color="secondary"
            class="shrink-0"
            icon="i-lucide-search"
            :loading="previewBusy"
            label="Preview"
            @click="runPreview"
          />
        </div>
        <div v-if="previewMatches.length" class="mt-3 space-y-2">
          <article
            v-for="(m, i) in previewMatches"
            :key="String(m.id)"
            class="cursor-pointer rounded-xl bg-[#fff9f5] px-3 py-2.5 ring-1 ring-[var(--line)] transition hover:ring-[#e9748e]/40"
            @click="openEdit(m)"
          >
            <div class="flex items-start justify-between gap-2">
              <p class="m-0 text-sm font-semibold text-chocolate">
                <span class="mr-1.5 text-[var(--muted)]">#{{ i + 1 }}</span>{{ m.question }}
              </p>
              <span class="shrink-0 rounded-full bg-[#fff0f2] px-2 py-0.5 text-[0.65rem] font-semibold text-[#e9748e]">
                score {{ m.score ?? 0 }}
              </span>
            </div>
            <p class="m-0 mt-1 line-clamp-2 text-xs text-[var(--muted)]">{{ m.answer }}</p>
          </article>
        </div>
      </div>

      <div class="rounded-2xl border border-[var(--line)] bg-white p-4 shadow-[0_8px_22px_-18px_rgba(74,44,42,0.35)]">
        <h2 class="font-display m-0 text-lg text-chocolate">Quick starters</h2>
        <p class="m-0 mt-1 text-xs text-[var(--muted)]">Tap to draft a new FAQ</p>
        <ul class="mt-3 space-y-2">
          <li v-for="s in starters" :key="s.question">
            <button
              type="button"
              class="w-full rounded-xl bg-[#fff9f5] px-3 py-2 text-left text-sm font-medium text-chocolate ring-1 ring-[var(--line)] transition hover:bg-[#fff0f2]"
              @click="openCreate(s)"
            >
              {{ s.question }}
            </button>
          </li>
        </ul>
      </div>
    </div>

    <div class="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <div class="flex flex-wrap gap-1.5">
        <button
          v-for="t in [
            { value: 'faqs' as const, label: 'FAQs', count: stats.total_faqs },
            { value: 'runs' as const, label: 'Agent runs', count: runs.length },
            { value: 'insights' as const, label: 'Insights', count: insights.length },
          ]"
          :key="t.value"
          type="button"
          class="rounded-full px-3 py-1.5 text-xs font-semibold transition"
          :class="tab === t.value ? 'bg-chocolate text-cream' : 'bg-white text-chocolate ring-1 ring-[var(--line)]'"
          @click="tab = t.value"
        >
          {{ t.label }} {{ t.count }}
        </button>
      </div>
      <label v-if="tab === 'faqs'" class="relative block w-full max-w-md">
        <UIcon name="i-lucide-search" class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--muted)]" />
        <input
          v-model="q"
          class="sc-input w-full !rounded-xl !py-2.5 !pl-9"
          placeholder="Search questions & answers…"
        >
      </label>
    </div>

    <div v-if="tab === 'faqs'" class="mb-4 flex flex-wrap gap-1.5">
      <button
        v-for="t in filterTabs"
        :key="t.value"
        type="button"
        class="rounded-full px-3 py-1.5 text-xs font-semibold transition"
        :class="flag === t.value ? 'bg-chocolate text-cream' : 'bg-white text-chocolate ring-1 ring-[var(--line)]'"
        @click="flag = t.value"
      >
        {{ t.label }}
        <span v-if="t.value === 'active'"> {{ stats.active_faqs }}</span>
        <span v-else-if="t.value === 'inactive'"> {{ stats.inactive_faqs }}</span>
      </button>
    </div>

    <!-- FAQs -->
    <template v-if="tab === 'faqs'">
      <div v-if="loading" class="grid gap-3 sm:grid-cols-2">
        <div v-for="n in 4" :key="n" class="sc-skeleton h-36 rounded-2xl" />
      </div>
      <div
        v-else-if="!filtered.length"
        class="rounded-2xl border border-dashed border-[var(--line)] py-16 text-center text-sm text-[var(--muted)]"
      >
        No FAQs match — add one or clear filters
      </div>
      <div v-else class="grid gap-3 sm:grid-cols-2">
        <article
          v-for="f in filtered"
          :key="String(f.id)"
          class="rounded-2xl border border-[var(--line)] bg-white p-3.5 shadow-[0_8px_22px_-18px_rgba(74,44,42,0.35)] transition"
          :class="f.is_active ? 'hover:border-[#e9748e]/35' : 'opacity-70'"
        >
          <div class="flex items-start justify-between gap-2">
            <p class="m-0 font-semibold text-chocolate">{{ f.question }}</p>
            <span
              class="shrink-0 rounded-full px-2 py-0.5 text-[0.65rem] font-semibold"
              :class="f.is_active ? 'bg-[#e8f6ee] text-[#2e7d4f]' : 'bg-[#f8ede6] text-[var(--muted)]'"
            >
              {{ f.is_active ? "Active" : "Off" }}
            </span>
          </div>
          <p class="m-0 mt-1.5 line-clamp-3 text-sm text-[var(--muted)]">{{ f.answer }}</p>
          <div class="mt-2 flex flex-wrap gap-1">
            <span class="rounded-full bg-[#fff9f5] px-2 py-0.5 text-[0.65rem] font-semibold text-chocolate ring-1 ring-[var(--line)]">
              {{ langLabel(f.language) }}
            </span>
            <span v-if="f.created_at" class="rounded-full bg-[#fff9f5] px-2 py-0.5 text-[0.65rem] text-[var(--muted)] ring-1 ring-[var(--line)]">
              {{ relativeAgo(String(f.created_at)) }}
            </span>
          </div>
          <div class="mt-3 flex flex-wrap gap-1.5">
            <UButton size="xs" color="primary" variant="soft" icon="i-lucide-pencil" label="Edit" :disabled="busy" @click="openEdit(f)" />
            <UButton
              size="xs"
              color="neutral"
              variant="outline"
              :icon="f.is_active ? 'i-lucide-eye-off' : 'i-lucide-eye'"
              :label="f.is_active ? 'Disable' : 'Enable'"
              :disabled="busy"
              @click="toggle(f)"
            />
            <UButton size="xs" color="neutral" variant="ghost" class="text-danger" icon="i-lucide-trash-2" label="Delete" :disabled="busy" @click="remove(f)" />
          </div>
        </article>
      </div>
    </template>

    <!-- Runs -->
    <template v-else-if="tab === 'runs'">
      <div
        v-if="!runs.length"
        class="rounded-2xl border border-dashed border-[var(--line)] py-16 text-center text-sm text-[var(--muted)]"
      >
        No agent runs yet — chats will show up here live
      </div>
      <div v-else class="space-y-2">
        <article
          v-for="r in runs"
          :key="String(r.id)"
          class="rounded-2xl border border-[var(--line)] bg-white px-3.5 py-3 shadow-[0_8px_22px_-18px_rgba(74,44,42,0.35)]"
        >
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="flex flex-wrap items-center gap-1.5">
              <span class="rounded-full px-2 py-0.5 text-[0.65rem] font-semibold capitalize" :class="runTone(r.status)">
                {{ statusLabel(String(r.status || "—")) }}
              </span>
              <span class="text-xs font-semibold capitalize text-chocolate">{{ r.audience || "chat" }}</span>
              <span class="text-xs text-[var(--muted)]">{{ r.provider || "—" }}</span>
            </div>
            <span class="text-xs text-[var(--muted)]">
              {{ r.ms != null ? `${r.ms} ms` : "…" }}
              <span v-if="r.started_at"> · {{ relativeAgo(new Date(Number(r.started_at) * 1000).toISOString()) }}</span>
            </span>
          </div>
          <p class="m-0 mt-1.5 text-sm text-chocolate">{{ r.message || "—" }}</p>
          <p v-if="r.reply_preview" class="m-0 mt-1 line-clamp-2 text-xs text-[var(--muted)]">
            → {{ r.reply_preview }}
          </p>
          <p v-if="Array.isArray(r.tools) && r.tools.length" class="m-0 mt-1 text-[0.65rem] text-[var(--muted)]">
            tools: {{ (r.tools as string[]).join(", ") }}
            <span v-if="r.rag_chunks"> · {{ r.rag_chunks }} RAG chunks</span>
          </p>
        </article>
      </div>
    </template>

    <!-- Insights -->
    <template v-else>
      <div class="mb-3 flex flex-wrap gap-2">
        <UButton
          color="secondary"
          icon="i-lucide-sparkles"
          :loading="insightsBusy"
          label="Refresh insights"
          @click="loadInsights(false)"
        />
        <UButton
          color="neutral"
          variant="outline"
          icon="i-lucide-brain"
          :loading="insightsBusy"
          label="With LLM polish"
          @click="loadInsights(true)"
        />
      </div>
      <div
        v-if="!insights.length && !insightsBusy"
        class="rounded-2xl border border-dashed border-[var(--line)] py-16 text-center text-sm text-[var(--muted)]"
      >
        Tap Insights to pull business tips from live orders
      </div>
      <ul v-else class="m-0 grid list-none gap-2 p-0 sm:grid-cols-2">
        <li
          v-for="(tip, i) in insights"
          :key="i"
          class="rounded-2xl border border-[var(--line)] bg-white p-4 text-sm text-chocolate shadow-[0_8px_22px_-18px_rgba(74,44,42,0.35)]"
        >
          <span class="mb-1 block text-[0.65rem] font-semibold uppercase tracking-wide text-[#e9748e]">Tip {{ i + 1 }}</span>
          {{ typeof tip === "string" ? tip : JSON.stringify(tip) }}
        </li>
      </ul>
    </template>

    <USlideover
      v-model:open="panelOpen"
      side="right"
      :title="form.id ? 'Edit FAQ' : 'Add FAQ'"
      description="Used first by the AI bot before product rules"
      :ui="{ content: 'w-full max-w-lg bg-[#fffaf8]' }"
      @update:open="(v: boolean) => { if (!v) closePanel() }"
    >
      <template #body>
        <form class="flex flex-col gap-3 pb-6" @submit.prevent="save">
          <label>
            <span class="sc-label">Question</span>
            <input v-model="form.question" class="sc-input w-full !rounded-xl" placeholder="How does shop credit work?" required>
          </label>
          <label>
            <span class="sc-label">Answer</span>
            <textarea
              v-model="form.answer"
              class="sc-input min-h-[140px] w-full !rounded-xl"
              placeholder="Bot reply customers and shops will see…"
              required
            />
          </label>
          <label>
            <span class="sc-label">Language</span>
            <select v-model="form.language" class="sc-input w-full !rounded-xl">
              <option v-for="o in languageOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
            </select>
          </label>
          <label class="flex items-center gap-2 text-sm text-chocolate">
            <input v-model="form.is_active" type="checkbox" class="size-4 rounded border-[var(--line)]">
            Active (bot can use this answer)
          </label>
          <div class="flex flex-wrap gap-2 pt-1">
            <UButton color="secondary" type="submit" :loading="busy" :label="form.id ? 'Save changes' : 'Add FAQ'" />
            <UButton color="neutral" variant="outline" type="button" label="Cancel" @click="closePanel" />
          </div>
        </form>
      </template>
    </USlideover>
  </div>
</template>

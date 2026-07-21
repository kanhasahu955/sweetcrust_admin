<script setup lang="ts">
import { useAppToast } from "~/composables/useAppToast"
import { patchListRow, removeListRow, upsertListRow } from "~/utils/list"

type Faq = {
  id: number
  question: string
  answer: string
  language?: string
  is_active?: boolean
}

const api = useApi()
const toast = useAppToast()
const { confirm } = useConfirm()
const faqs = ref([] as Faq[])
/** list helpers expect Record rows */
const faqRows = faqs as unknown as { value: Record<string, unknown>[] }
const stats = ref<Record<string, unknown>>({})
const question = ref("")
const answer = ref("")
const language = ref("en")
const error = ref("")
const busy = ref(false)
const editId = ref<number | null>(null)

const insights = ref<unknown[]>([])
const insightsBusy = ref(false)

async function load() {
  try {
    const [f, a] = await Promise.all([api.admin.chatbotFaqs(), api.admin.chatbotAnalytics()])
    faqs.value = Array.isArray(f) ? (f as Faq[]) : []
    stats.value = (a || {}) as Record<string, unknown>
  } catch (e) {
    error.value = apiError(e)
  }
}

async function loadInsights() {
  insightsBusy.value = true
  error.value = ""
  try {
    const res = await api.admin.aiInsights(false)
    const raw = res?.insights
    insights.value = Array.isArray(raw) ? raw : raw ? [raw] : []
  } catch (e) {
    error.value = apiError(e)
  } finally {
    insightsBusy.value = false
  }
}

function startEdit(f: Faq) {
  editId.value = f.id
  question.value = f.question
  answer.value = f.answer
  language.value = f.language || "en"
}

function resetForm() {
  editId.value = null
  question.value = ""
  answer.value = ""
  language.value = "en"
}

async function save() {
  if (!question.value.trim() || !answer.value.trim()) {
    error.value = "Question and answer required"
    return
  }
  busy.value = true
  error.value = ""
  const body = {
    question: question.value.trim(),
    answer: answer.value.trim(),
    language: language.value || "en",
    is_active: true,
  }
  try {
    const saved = editId.value
      ? await api.admin.updateFaq(editId.value, body)
      : await api.admin.createFaq(body)
    upsertListRow(faqRows, saved)
    resetForm()
    void load()
  } catch (e) {
    error.value = apiError(e)
  } finally {
    busy.value = false
  }
}

async function toggle(f: Faq) {
  busy.value = true
  try {
    const saved = await api.admin.updateFaq(f.id, {
      question: f.question,
      answer: f.answer,
      language: f.language || "en",
      is_active: !f.is_active,
    })
    if (!upsertListRow(faqRows, saved)) patchListRow(faqRows, f.id, { is_active: !f.is_active })
    void load()
  } catch (e) {
    error.value = apiError(e)
  } finally {
    busy.value = false
  }
}

async function remove(id: number) {
  const ok = await confirm({
    title: "Delete FAQ",
    message: "Delete this FAQ? The chatbot will stop using this answer.",
    confirmText: "Delete",
    tone: "danger",
  })
  if (!ok) return
  busy.value = true
  try {
    await api.admin.deleteFaq(id)
    removeListRow(faqRows, id)
    if (editId.value === id) resetForm()
    toast.success("FAQ deleted")
    void load()
  } catch (e) {
    error.value = apiError(e)
    toast.error("Delete failed", apiError(e))
  } finally {
    busy.value = false
  }
}

onMounted(load)
</script>

<template>
  <div>
    <PageHeader
      title="AI bot & FAQs"
      subtitle="Answers shop and customer questions from these FAQs first, then product rules. They can ask to talk to you anytime."
    >
      <template #actions>
        <UButton color="primary" variant="soft" :loading="insightsBusy" label="Business insights" @click="loadInsights" />
        <UButton color="neutral" variant="outline" label="Refresh" @click="load" />
      </template>
    </PageHeader>

    <p v-if="error" class="mb-3 text-sm text-danger">{{ error }}</p>

    <div v-if="insights.length" class="sc-card mb-4 p-4">
      <p class="font-semibold text-chocolate">Insights</p>
      <ul class="mt-2 list-disc space-y-1 pl-5 text-sm text-[var(--muted)]">
        <li v-for="(tip, i) in insights" :key="i">{{ typeof tip === "string" ? tip : JSON.stringify(tip) }}</li>
      </ul>
    </div>

    <div class="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div class="sc-card px-4 py-3">
        <p class="text-xs uppercase tracking-wide text-[var(--muted)]">AI chats</p>
        <p class="font-display text-2xl">{{ stats.total_ai_conversations ?? 0 }}</p>
      </div>
      <div class="sc-card px-4 py-3">
        <p class="text-xs uppercase tracking-wide text-[var(--muted)]">Handed to you</p>
        <p class="font-display text-2xl">{{ stats.transferred_to_admin ?? 0 }}</p>
      </div>
      <div class="sc-card px-4 py-3">
        <p class="text-xs uppercase tracking-wide text-[var(--muted)]">Active FAQs</p>
        <p class="font-display text-2xl">{{ stats.active_faqs ?? faqs.filter((f) => f.is_active).length }}</p>
      </div>
      <div class="sc-card px-4 py-3">
        <p class="text-xs uppercase tracking-wide text-[var(--muted)]">Stack</p>
        <p class="mt-1 text-xs leading-relaxed text-[var(--muted)]">
          LangChain · LangGraph · Agentic RAG
          <span v-if="(stats.stack as any)?.langsmith"> · LangSmith on</span>
          <span v-else> · set LANGSMITH_API_KEY to trace</span>
        </p>
      </div>
    </div>

    <div v-if="Array.isArray(stats.recent_runs) && stats.recent_runs.length" class="sc-card mb-4 overflow-hidden">
      <p class="border-b border-[var(--line)] px-4 py-2 text-sm font-semibold">Recent agent runs</p>
      <div class="max-h-56 divide-y divide-[var(--line)] overflow-y-auto text-xs">
        <div v-for="r in (stats.recent_runs as any[])" :key="r.id" class="px-4 py-2">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <span class="font-semibold">{{ r.audience }} · {{ r.status }}</span>
            <span class="text-[var(--muted)]">{{ r.ms != null ? `${r.ms}ms` : "…" }} · {{ r.provider }}</span>
          </div>
          <p class="truncate text-[var(--muted)]">{{ r.message }}</p>
          <p v-if="r.tools?.length" class="text-[var(--muted)]">tools: {{ r.tools.join(", ") }}</p>
        </div>
      </div>
    </div>

    <div class="grid gap-4 lg:grid-cols-2">
      <form class="sc-card space-y-3 p-4" @submit.prevent="save">
        <p class="font-semibold">{{ editId ? "Edit FAQ" : "Add FAQ" }}</p>
        <p class="text-xs text-[var(--muted)]">
          Tip: add credit/udhaar, min order, delivery days, GST — in English or Odia.
        </p>
        <label class="block text-sm">
          Question
          <input v-model="question" class="sc-input mt-1 w-full" placeholder="How does shop credit work?">
        </label>
        <label class="block text-sm">
          Answer
          <textarea v-model="answer" class="sc-input mt-1 min-h-[120px] w-full" placeholder="Bot reply…" />
        </label>
        <label class="block text-sm">
          Language
          <select v-model="language" class="sc-input mt-1 w-full">
            <option value="en">English</option>
            <option value="hi">Hindi</option>
            <option value="or">Odia</option>
          </select>
        </label>
        <div class="flex gap-2">
          <UButton type="submit" :disabled="busy">{{ editId ? "Update" : "Add FAQ" }}</UButton>
          <UButton color="neutral" variant="outline" v-if="editId" type="button"  @click="resetForm">Cancel</UButton>
        </div>
      </form>

      <div class="sc-card divide-y divide-[var(--line)]">
        <div
          v-for="f in faqs"
          :key="f.id"
          class="flex flex-col gap-2 px-4 py-3 text-sm"
          :class="f.is_active ? '' : 'opacity-50'"
        >
          <p class="font-semibold">{{ f.question }}</p>
          <p class="text-[var(--muted)]">{{ f.answer }}</p>
          <div class="flex flex-wrap gap-2">
            <UButton type="button" color="primary" variant="soft" class=" !py-1 text-xs" :disabled="busy" @click="startEdit(f)">
              Edit
            </UButton>
            <UButton type="button" color="neutral" variant="outline" class=" !py-1 text-xs" :disabled="busy" @click="toggle(f)">
              {{ f.is_active ? "Disable" : "Enable" }}
            </UButton>
            <UButton type="button" color="neutral" variant="outline" class=" !py-1 text-xs text-danger" :disabled="busy" @click="remove(f.id)">
              Delete
            </UButton>
          </div>
        </div>
        <EmptyState v-if="!faqs.length" class="m-4" title="No FAQs yet — add a few above" />
      </div>
    </div>
  </div>
</template>

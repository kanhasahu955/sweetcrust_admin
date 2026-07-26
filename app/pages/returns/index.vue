<script setup lang="ts">
import { apiError, displayPhone, money, relativeAgo, statusLabel } from "~/utils/format"
import { patchListRow, upsertListRow } from "~/utils/list"
import { resolveMediaUrl } from "~/utils/mapPins"

const api = useApi()
const toast = useAppToast()
const { confirm } = useConfirm()
const config = useRuntimeConfig()
const socketLive = useState("adminSocketLive", () => false)
const { connect } = useSocket()

const rows = ref<Record<string, unknown>[]>([])
const loading = ref(true)
const refreshing = ref(false)
const busyId = ref<number | null>(null)
const aiBusy = ref(false)
const saving = ref(false)
const error = ref("")
const q = ref("")
const flag = ref<"all" | "pending" | "approved" | "rejected" | "evidence">("all")
const panelOpen = ref(false)
const selected = ref<Record<string, unknown> | null>(null)
const assess = ref<Record<string, unknown> | null>(null)

const form = reactive({
  admin_response: "",
  internal_note: "",
  refund_amount: 0,
})

const stats = ref({
  total: 0,
  pending: 0,
  approved: 0,
  rejected: 0,
  refund_total: 0,
  with_evidence: 0,
})

const filterTabs = [
  { value: "all" as const, label: "All" },
  { value: "pending" as const, label: "Pending" },
  { value: "approved" as const, label: "Approved" },
  { value: "rejected" as const, label: "Rejected" },
  { value: "evidence" as const, label: "With photos" },
]

function isOpen(r: Record<string, unknown>) {
  if (r.is_open != null) return Boolean(r.is_open)
  return ["submitted", "ai_validated", "admin_review"].includes(String(r.status || "").toLowerCase())
}

function statusTone(status: unknown) {
  const s = String(status || "").toLowerCase()
  if (["approved", "completed", "refund_initiated", "replacement_initiated"].includes(s)) {
    return "bg-[#e8f6ee] text-[#2e7d4f]"
  }
  if (s === "rejected") return "bg-[#fdecea] text-[#c0392b]"
  if (["submitted", "ai_validated", "admin_review"].includes(s)) return "bg-[#fff0f2] text-[#e9748e]"
  return "bg-[#f8ede6] text-[var(--muted)]"
}

function issueLabel(issue: unknown) {
  return statusLabel(String(issue || "quality"))
}

function media(url: unknown) {
  return resolveMediaUrl(String(url || ""), String(config.public.apiBase || ""))
}

const filtered = computed(() => {
  const ql = q.value.trim().toLowerCase()
  return rows.value.filter((r) => {
    const st = String(r.status || "").toLowerCase()
    if (flag.value === "pending" && !isOpen(r)) return false
    if (flag.value === "approved" && !["approved", "completed", "refund_initiated", "replacement_initiated"].includes(st)) {
      return false
    }
    if (flag.value === "rejected" && st !== "rejected") return false
    if (flag.value === "evidence" && !(Number(r.evidence_count) > 0 || (Array.isArray(r.evidence_urls) && r.evidence_urls.length))) {
      return false
    }
    if (!ql) return true
    return (
      String(r.id).includes(ql)
      || String(r.order_number || "").toLowerCase().includes(ql)
      || String(r.order_id || "").includes(ql)
      || String(r.customer_name || "").toLowerCase().includes(ql)
      || String(r.customer_phone || "").includes(ql)
      || String(r.issue_type || "").toLowerCase().includes(ql)
      || String(r.description || r.reason || "").toLowerCase().includes(ql)
    )
  })
})

function parseHub(data: unknown) {
  if (Array.isArray(data)) {
    rows.value = data as Record<string, unknown>[]
    stats.value = {
      total: rows.value.length,
      pending: rows.value.filter(isOpen).length,
      approved: rows.value.filter((r) =>
        ["approved", "completed", "refund_initiated"].includes(String(r.status || "").toLowerCase()),
      ).length,
      rejected: rows.value.filter((r) => String(r.status || "").toLowerCase() === "rejected").length,
      refund_total: rows.value.reduce((a, r) => a + (Number(r.refund_amount) || 0), 0),
      with_evidence: rows.value.filter((r) => Number(r.evidence_count) > 0).length,
    }
    return
  }
  const obj = (data || {}) as { items?: unknown[], stats?: Record<string, number> }
  rows.value = Array.isArray(obj.items) ? (obj.items as Record<string, unknown>[]) : []
  if (obj.stats) {
    stats.value = {
      total: Number(obj.stats.total) || rows.value.length,
      pending: Number(obj.stats.pending) || 0,
      approved: Number(obj.stats.approved) || 0,
      rejected: Number(obj.stats.rejected) || 0,
      refund_total: Number(obj.stats.refund_total) || 0,
      with_evidence: Number(obj.stats.with_evidence) || 0,
    }
  }
}

async function load(opts?: { quiet?: boolean }) {
  if (opts?.quiet) refreshing.value = true
  else loading.value = true
  error.value = ""
  try {
    parseHub(await api.admin.returns())
  } catch (e) {
    error.value = apiError(e)
    if (!opts?.quiet) toast.error(error.value)
  } finally {
    loading.value = false
    refreshing.value = false
  }
}

function fillForm(r: Record<string, unknown>) {
  form.admin_response = String(r.admin_response || "")
  form.internal_note = String(r.internal_note || "")
  form.refund_amount = Number(r.refund_amount) || Number(r.order_amount) || 0
  assess.value = (r.ai_assessment as Record<string, unknown>) || null
}

async function openDetail(r: Record<string, unknown>) {
  selected.value = r
  fillForm(r)
  panelOpen.value = true
  const id = Number(r.id)
  if (!id) return
  try {
    const detail = await api.admin.return(id)
    selected.value = detail
    fillForm(detail)
  } catch (e) {
    toast.error(apiError(e))
  }
}

async function saveNotes() {
  if (!selected.value?.id) return
  saving.value = true
  try {
    const saved = await api.admin.updateReturn(Number(selected.value.id), {
      admin_response: form.admin_response.trim() || undefined,
      internal_note: form.internal_note.trim() || undefined,
      refund_amount: form.refund_amount,
    })
    upsertListRow(rows, saved)
    selected.value = saved
    toast.success("Return updated")
    void load({ quiet: true })
  } catch (e) {
    toast.error(apiError(e))
  } finally {
    saving.value = false
  }
}

async function setStatus(id: number, status: string, opts?: { quietConfirm?: boolean }) {
  if (!opts?.quietConfirm) {
    const ok = await confirm({
      title: status === "approved" ? "Approve return" : status === "rejected" ? "Reject return" : "Update status",
      message: `Mark return #${id} as ${statusLabel(status)}?`,
      confirmText: statusLabel(status),
      tone: status === "rejected" ? "danger" : "default",
    })
    if (!ok) return
  }
  busyId.value = id
  try {
    const body: Record<string, unknown> = {
      status,
      admin_response: form.admin_response.trim() || undefined,
      internal_note: form.internal_note.trim() || undefined,
    }
    if (status === "approved" || status === "refund_initiated") {
      body.refund_amount = form.refund_amount
    }
    const saved = await api.admin.updateReturn(id, body)
    if (!upsertListRow(rows, saved)) patchListRow(rows, id, saved)
    if (selected.value && Number(selected.value.id) === id) {
      selected.value = saved
      fillForm(saved)
    }
    toast.success(`Return #${id} → ${statusLabel(status)}`)
    void load({ quiet: true })
  } catch (e) {
    toast.error(apiError(e))
  } finally {
    busyId.value = null
  }
}

async function aiAssess(r: Record<string, unknown>) {
  const id = Number(r.id)
  busyId.value = id
  aiBusy.value = true
  try {
    const res = await api.admin.aiReturnAssess({
      issue_type: String(r.issue_type || "quality"),
      description: String(r.description || r.reason || ""),
      evidence_urls: Array.isArray(r.evidence_urls) ? (r.evidence_urls as string[]) : [],
    })
    assess.value = res
    const body: Record<string, unknown> = { ai_assessment: res }
    if (String(r.status || "submitted").toLowerCase() === "submitted") body.status = "ai_validated"
    const saved = await api.admin.updateReturn(id, body)
    upsertListRow(rows, saved)
    if (selected.value && Number(selected.value.id) === id) selected.value = saved
    toast.success("AI assessment ready", String(res.recommendation || res.decision || ""))
  } catch (e) {
    toast.error(apiError(e))
  } finally {
    busyId.value = null
    aiBusy.value = false
  }
}

async function applyAiRec() {
  if (!selected.value?.id || !assess.value) return
  const rec = String(assess.value.recommendation || "").toLowerCase()
  if (rec.includes("approve") || rec.includes("replacement") || rec.includes("refund")) {
    await setStatus(Number(selected.value.id), rec.includes("replacement") ? "replacement_initiated" : "approved", {
      quietConfirm: false,
    })
  } else if (rec.includes("reject")) {
    await setStatus(Number(selected.value.id), "rejected")
  } else {
    form.admin_response = form.admin_response || "Please share clearer photos of the issue so we can help."
    toast.info("Ask customer for more evidence — notes drafted")
  }
}

let liveSocket: ReturnType<typeof connect> = null
const onAdminEvent = (data: Record<string, unknown>) => {
  const kind = String(data?.kind || "")
  if (kind.includes("return") || kind.includes("order")) void load({ quiet: true })
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
        <h1 class="font-display m-0 text-2xl text-chocolate sm:text-3xl">Returns</h1>
        <p class="m-0 mt-1 flex flex-wrap items-center gap-2 text-sm text-[var(--muted)]">
          <span
            class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.65rem] font-semibold"
            :class="socketLive ? 'bg-[#e8f6ee] text-[#2e7d4f]' : 'bg-[#f8ede6] text-[var(--muted)]'"
          >
            <span class="size-1.5 rounded-full" :class="socketLive ? 'animate-pulse bg-success' : 'bg-[#c4a39a]'" />
            {{ socketLive ? "Live" : "Offline" }}
          </span>
          <span>Approve · reject · AI assess · refund notes</span>
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
        <UButton to="/orders" color="neutral" variant="outline" icon="i-lucide-shopping-bag" label="Orders" />
      </div>
    </div>

    <p v-if="error" class="mb-3 text-sm text-danger">{{ error }}</p>

    <div class="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="Total returns" :value="stats.total" icon="lucide:undo-2" />
      <StatCard label="Pending review" :value="stats.pending" icon="lucide:clock" tone="warn" />
      <StatCard label="Approved" :value="stats.approved" icon="lucide:circle-check" tone="ok" />
      <StatCard label="Refunds booked" :value="money(stats.refund_total)" icon="lucide:indian-rupee" />
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
          <span v-if="t.value === 'pending'"> {{ stats.pending }}</span>
          <span v-else-if="t.value === 'approved'"> {{ stats.approved }}</span>
          <span v-else-if="t.value === 'rejected'"> {{ stats.rejected }}</span>
          <span v-else-if="t.value === 'evidence'"> {{ stats.with_evidence }}</span>
          <span v-else> {{ stats.total }}</span>
        </button>
      </div>
      <label class="relative block w-full max-w-md">
        <UIcon name="i-lucide-search" class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--muted)]" />
        <input
          v-model="q"
          class="sc-input w-full !rounded-xl !py-2.5 !pl-9"
          placeholder="Search order #, customer, issue…"
        >
      </label>
    </div>

    <div v-if="loading" class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <div v-for="n in 6" :key="n" class="sc-skeleton h-40 rounded-2xl" />
    </div>

    <div
      v-else-if="!filtered.length"
      class="rounded-2xl border border-dashed border-[var(--line)] bg-white px-6 py-16 text-center shadow-[0_8px_22px_-18px_rgba(74,44,42,0.35)]"
    >
      <div class="mx-auto mb-3 flex size-12 items-center justify-center rounded-2xl bg-[#fff0f2] text-[#e9748e]">
        <UIcon name="i-lucide-inbox" class="size-6" />
      </div>
      <p class="font-display m-0 text-xl text-chocolate">No returns here</p>
      <p class="m-0 mt-1 text-sm text-[var(--muted)]">
        Customer return requests show up when an order is disputed. Filters clear when new ones arrive.
      </p>
      <div class="mt-4 flex flex-wrap justify-center gap-2">
        <UButton to="/orders" color="secondary" variant="soft" label="Browse orders" />
        <UButton color="neutral" variant="outline" label="Clear filters" :disabled="flag === 'all' && !q" @click="flag = 'all'; q = ''" />
      </div>
    </div>

    <div v-else class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <article
        v-for="r in filtered"
        :key="String(r.id)"
        class="rounded-2xl border border-[var(--line)] bg-white p-3.5 shadow-[0_8px_22px_-18px_rgba(74,44,42,0.35)] transition hover:border-[#e9748e]/40"
      >
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <p class="m-0 font-semibold text-chocolate">
              #{{ r.id }}
              <span class="font-normal text-[var(--muted)]">·</span>
              <NuxtLink
                v-if="r.order_id"
                :to="`/orders/${r.order_id}`"
                class="font-semibold hover:text-[#e9748e]"
              >
                {{ r.order_number || `Order ${r.order_id}` }}
              </NuxtLink>
            </p>
            <p class="m-0 mt-0.5 truncate text-xs text-[var(--muted)]">
              {{ r.customer_name || "Customer" }}
              <span v-if="r.customer_phone"> · {{ displayPhone(String(r.customer_phone)) }}</span>
            </p>
          </div>
          <span class="shrink-0 rounded-full px-2 py-0.5 text-[0.65rem] font-semibold capitalize" :class="statusTone(r.status)">
            {{ statusLabel(String(r.status || "open")) }}
          </span>
        </div>

        <p class="m-0 mt-2 text-sm text-chocolate">
          <span class="font-medium">{{ issueLabel(r.issue_type) }}</span>
          <span class="text-[var(--muted)]"> · {{ statusLabel(String(r.solution || "refund")) }}</span>
        </p>
        <p class="m-0 mt-1 line-clamp-2 text-xs text-[var(--muted)]">
          {{ r.description || r.reason || "No description" }}
        </p>

        <div class="mt-3 grid grid-cols-3 gap-2 rounded-xl bg-[#fff9f5] px-2.5 py-2 text-center">
          <div>
            <p class="m-0 text-[0.6rem] font-semibold uppercase tracking-wide text-[var(--muted)]">Order</p>
            <p class="m-0 text-sm font-bold text-chocolate">{{ money(Number(r.order_amount || 0)) }}</p>
          </div>
          <div>
            <p class="m-0 text-[0.6rem] font-semibold uppercase tracking-wide text-[var(--muted)]">Refund</p>
            <p class="m-0 text-sm font-bold text-chocolate">{{ money(Number(r.refund_amount || 0)) }}</p>
          </div>
          <div>
            <p class="m-0 text-[0.6rem] font-semibold uppercase tracking-wide text-[var(--muted)]">When</p>
            <p class="m-0 truncate text-xs font-semibold text-chocolate">{{ relativeAgo(String(r.created_at || "")) }}</p>
          </div>
        </div>

        <div v-if="Array.isArray(r.evidence_urls) && r.evidence_urls.length" class="mt-2 flex gap-1.5 overflow-x-auto">
          <img
            v-for="(url, i) in (r.evidence_urls as string[]).slice(0, 4)"
            :key="i"
            :src="media(url)"
            alt=""
            class="size-12 shrink-0 rounded-lg object-cover ring-1 ring-[var(--line)]"
          >
        </div>

        <div class="mt-3 flex flex-wrap gap-1.5">
          <UButton size="xs" color="secondary" variant="soft" label="Review" @click="openDetail(r)" />
          <UButton
            size="xs"
            color="primary"
            variant="soft"
            label="AI"
            :loading="busyId === Number(r.id) && aiBusy"
            @click="aiAssess(r)"
          />
          <UButton
            v-if="isOpen(r)"
            size="xs"
            color="secondary"
            label="Approve"
            :loading="busyId === Number(r.id) && !aiBusy"
            @click="fillForm(r); setStatus(Number(r.id), 'approved')"
          />
          <UButton
            v-if="isOpen(r)"
            size="xs"
            color="neutral"
            variant="outline"
            label="Reject"
            :loading="busyId === Number(r.id) && !aiBusy"
            @click="fillForm(r); setStatus(Number(r.id), 'rejected')"
          />
        </div>
      </article>
    </div>

    <USlideover
      v-model:open="panelOpen"
      side="right"
      :title="selected ? `Return #${selected.id}` : 'Return'"
      :description="selected ? String(selected.order_number || selected.customer_name || 'Review request') : ''"
      :ui="{ content: 'w-full max-w-lg bg-[#fffaf8]' }"
    >
      <template #body>
        <div v-if="selected" class="flex flex-col gap-4 pb-6">
          <div class="rounded-2xl border border-[var(--line)] bg-white p-4">
            <div class="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p class="m-0 text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-[#e9748e]">
                  {{ issueLabel(selected.issue_type) }}
                </p>
                <p class="font-display m-0 text-2xl text-chocolate">
                  {{ selected.customer_name || "Customer" }}
                </p>
              </div>
              <span class="rounded-full px-2 py-0.5 text-[0.65rem] font-semibold capitalize" :class="statusTone(selected.status)">
                {{ statusLabel(String(selected.status || "—")) }}
              </span>
            </div>
            <p class="m-0 mt-2 text-sm text-[var(--muted)]">
              <NuxtLink v-if="selected.order_id" :to="`/orders/${selected.order_id}`" class="font-semibold text-chocolate hover:text-[#e9748e]">
                {{ selected.order_number || `Order #${selected.order_id}` }}
              </NuxtLink>
              <span v-if="selected.customer_phone"> · {{ displayPhone(String(selected.customer_phone)) }}</span>
            </p>
            <p class="m-0 mt-2 text-sm text-chocolate">{{ selected.description || selected.reason || "—" }}</p>
            <p class="m-0 mt-1 text-xs text-[var(--muted)]">
              Wanted {{ statusLabel(String(selected.solution || "refund")) }}
              · {{ relativeAgo(String(selected.created_at || "")) }}
            </p>
          </div>

          <div v-if="Array.isArray(selected.evidence_urls) && selected.evidence_urls.length" class="grid grid-cols-3 gap-2">
            <a
              v-for="(url, i) in (selected.evidence_urls as string[])"
              :key="i"
              :href="media(url)"
              target="_blank"
              rel="noopener"
              class="block overflow-hidden rounded-xl ring-1 ring-[var(--line)]"
            >
              <img :src="media(url)" alt="" class="aspect-square w-full object-cover">
            </a>
          </div>

          <div
            v-if="assess"
            class="rounded-2xl border border-[var(--line)] bg-gradient-to-br from-white via-[#fff9f5] to-[#fff0f2] p-4"
          >
            <div class="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p class="m-0 text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-[#e9748e]">AI assessment</p>
                <p class="m-0 mt-1 font-semibold capitalize text-chocolate">
                  {{ statusLabel(String(assess.recommendation || assess.decision || "review")) }}
                </p>
              </div>
              <span class="rounded-full bg-white px-2 py-0.5 text-[0.65rem] text-[var(--muted)] ring-1 ring-[var(--line)]">
                {{ Math.round(Number(assess.confidence || 0) * 100) }}% · {{ assess.provider || "ai" }}
              </span>
            </div>
            <ul class="mt-2 space-y-1 pl-4 text-sm text-chocolate">
              <li v-for="(f, i) in (Array.isArray(assess.findings) ? assess.findings : [])" :key="i">{{ f }}</li>
            </ul>
            <p v-if="assess.note" class="m-0 mt-2 text-xs text-[var(--muted)]">{{ assess.note }}</p>
            <UButton
              class="mt-3"
              size="sm"
              color="secondary"
              variant="soft"
              label="Apply recommendation"
              @click="applyAiRec"
            />
          </div>

          <label>
            <span class="sc-label">Refund amount ₹</span>
            <input v-model.number="form.refund_amount" type="number" min="0" step="0.01" class="sc-input !rounded-xl">
          </label>
          <label>
            <span class="sc-label">Reply to customer</span>
            <textarea v-model="form.admin_response" rows="3" class="sc-input !rounded-xl" placeholder="Visible to customer…" />
          </label>
          <label>
            <span class="sc-label">Internal note</span>
            <textarea v-model="form.internal_note" rows="2" class="sc-input !rounded-xl" placeholder="Staff only…" />
          </label>

          <div class="sticky bottom-0 flex flex-wrap gap-2 bg-[#fffaf8]/95 pt-2 backdrop-blur">
            <UButton
              color="neutral"
              variant="soft"
              class="flex-1"
              label="Save notes"
              :loading="saving"
              @click="saveNotes"
            />
            <UButton
              color="primary"
              variant="soft"
              label="AI assess"
              :loading="aiBusy"
              @click="aiAssess(selected)"
            />
            <UButton
              v-if="isOpen(selected)"
              color="secondary"
              label="Approve"
              :loading="busyId === Number(selected.id)"
              @click="setStatus(Number(selected.id), 'approved')"
            />
            <UButton
              v-if="isOpen(selected)"
              color="neutral"
              variant="outline"
              label="Reject"
              :loading="busyId === Number(selected.id)"
              @click="setStatus(Number(selected.id), 'rejected')"
            />
          </div>
        </div>
      </template>
    </USlideover>
  </div>
</template>

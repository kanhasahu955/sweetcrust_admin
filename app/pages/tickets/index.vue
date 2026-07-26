<script setup lang="ts">
import { apiError, displayPhone, relativeAgo, statusLabel } from "~/utils/format"
import { patchListRow, upsertListRow } from "~/utils/list"

const api = useApi()
const toast = useAppToast()
const { confirm } = useConfirm()
const socketLive = useState("adminSocketLive", () => false)
const { connect } = useSocket()

const rows = ref<Record<string, unknown>[]>([])
const people = ref<{ id: number, label: string, kind: string }[]>([])
const loading = ref(true)
const refreshing = ref(false)
const busyId = ref<number | null>(null)
const saving = ref(false)
const error = ref("")
const q = ref("")
const flag = ref<"all" | "open" | "in_progress" | "resolved" | "closed" | "shop" | "ai">("all")
const panelOpen = ref(false)
const createOpen = ref(false)
const selected = ref<Record<string, unknown> | null>(null)

const stats = ref({
  total: 0,
  open: 0,
  in_progress: 0,
  resolved: 0,
  closed: 0,
  from_ai: 0,
  shops: 0,
  customers: 0,
})

const form = reactive({
  subject: "",
  description: "",
  status: "open",
})

const create = reactive({
  user_id: 0,
  subject: "",
  description: "",
  peopleQ: "",
})

const filterTabs = [
  { value: "all" as const, label: "All" },
  { value: "open" as const, label: "Open" },
  { value: "in_progress" as const, label: "In progress" },
  { value: "resolved" as const, label: "Resolved" },
  { value: "closed" as const, label: "Closed" },
  { value: "shop" as const, label: "Shops" },
  { value: "ai" as const, label: "From AI" },
]

const statusOptions = [
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In progress" },
  { value: "resolved", label: "Resolved" },
  { value: "closed", label: "Closed" },
]

function isOpen(t: Record<string, unknown>) {
  if (t.is_open != null) return Boolean(t.is_open)
  return ["open", "in_progress"].includes(String(t.status || "").toLowerCase())
}

function statusTone(status: unknown) {
  const s = String(status || "").toLowerCase()
  if (s === "resolved" || s === "closed") return "bg-[#e8f6ee] text-[#2e7d4f]"
  if (s === "in_progress") return "bg-[#fff0f2] text-[#e9748e]"
  if (s === "open") return "bg-[#fff6e8] text-[#b8860b]"
  return "bg-[#f8ede6] text-[var(--muted)]"
}

const filtered = computed(() => {
  const ql = q.value.trim().toLowerCase()
  return rows.value.filter((t) => {
    const st = String(t.status || "").toLowerCase()
    if (flag.value === "open" && st !== "open") return false
    if (flag.value === "in_progress" && st !== "in_progress") return false
    if (flag.value === "resolved" && st !== "resolved") return false
    if (flag.value === "closed" && st !== "closed") return false
    if (flag.value === "shop" && t.audience !== "shop") return false
    if (flag.value === "ai" && !t.created_by_ai) return false
    if (!ql) return true
    return (
      String(t.id).includes(ql)
      || String(t.subject || t.title || "").toLowerCase().includes(ql)
      || String(t.description || t.body || "").toLowerCase().includes(ql)
      || String(t.customer_name || "").toLowerCase().includes(ql)
      || String(t.shop_name || "").toLowerCase().includes(ql)
      || String(t.customer_phone || "").includes(ql)
    )
  })
})

const peopleOptions = computed(() => {
  const ql = create.peopleQ.trim().toLowerCase()
  const list = people.value
  if (!ql) return list.slice(0, 40)
  return list
    .filter((p) => p.label.toLowerCase().includes(ql) || String(p.id).includes(ql))
    .slice(0, 40)
})

function parseHub(data: unknown) {
  if (Array.isArray(data)) {
    rows.value = data as Record<string, unknown>[]
    stats.value = {
      total: rows.value.length,
      open: rows.value.filter((t) => String(t.status).toLowerCase() === "open").length,
      in_progress: rows.value.filter((t) => String(t.status).toLowerCase() === "in_progress").length,
      resolved: rows.value.filter((t) => String(t.status).toLowerCase() === "resolved").length,
      closed: rows.value.filter((t) => String(t.status).toLowerCase() === "closed").length,
      from_ai: rows.value.filter((t) => t.created_by_ai).length,
      shops: rows.value.filter((t) => t.audience === "shop").length,
      customers: rows.value.filter((t) => t.audience !== "shop").length,
    }
    // fold open+in_progress for the Open card when raw array
    stats.value.open = stats.value.open + stats.value.in_progress
    return
  }
  const obj = (data || {}) as { items?: unknown[], stats?: Record<string, number> }
  rows.value = Array.isArray(obj.items) ? (obj.items as Record<string, unknown>[]) : []
  if (obj.stats) {
    stats.value = {
      total: Number(obj.stats.total) || rows.value.length,
      open: Number(obj.stats.open) || 0,
      in_progress: Number(obj.stats.in_progress) || 0,
      resolved: Number(obj.stats.resolved) || 0,
      closed: Number(obj.stats.closed) || 0,
      from_ai: Number(obj.stats.from_ai) || 0,
      shops: Number(obj.stats.shops) || 0,
      customers: Number(obj.stats.customers) || 0,
    }
  }
}

async function loadPeople() {
  try {
    const [cust, shops] = await Promise.all([
      api.admin.customers().catch(() => []),
      api.admin.shops().catch(() => []),
    ])
    const out: { id: number, label: string, kind: string }[] = []
    const custItems = Array.isArray(cust)
      ? cust
      : Array.isArray((cust as { items?: unknown[] })?.items)
        ? (cust as { items: unknown[] }).items
        : []
    for (const c of custItems as Record<string, unknown>[]) {
      const id = Number(c.id || c.user_id)
      if (!id) continue
      out.push({
        id,
        kind: "customer",
        label: `${c.name || c.customer_name || "Customer"} · ${displayPhone(String(c.phone || c.customer_phone || "")) || id}`,
      })
    }
    for (const s of (Array.isArray(shops) ? shops : []) as Record<string, unknown>[]) {
      const id = Number(s.user_id || s.id)
      if (!id) continue
      out.push({
        id,
        kind: "shop",
        label: `${s.shop_name || s.name || "Shop"} · shop`,
      })
    }
    people.value = out
  } catch {
    people.value = []
  }
}

async function load(opts?: { quiet?: boolean }) {
  if (opts?.quiet) refreshing.value = true
  else loading.value = true
  error.value = ""
  try {
    parseHub(await api.admin.tickets())
  } catch (e) {
    error.value = apiError(e)
    if (!opts?.quiet) toast.error(error.value)
  } finally {
    loading.value = false
    refreshing.value = false
  }
}

function openCreate() {
  create.user_id = people.value[0]?.id || 0
  create.subject = ""
  create.description = ""
  create.peopleQ = ""
  createOpen.value = true
  if (!people.value.length) void loadPeople()
}

async function openDetail(t: Record<string, unknown>) {
  selected.value = t
  form.subject = String(t.subject || t.title || "")
  form.description = String(t.description || t.body || "")
  form.status = String(t.status || "open")
  panelOpen.value = true
  try {
    const detail = await api.admin.ticket(Number(t.id))
    selected.value = detail
    form.subject = String(detail.subject || "")
    form.description = String(detail.description || "")
    form.status = String(detail.status || "open")
  } catch (e) {
    toast.error(apiError(e))
  }
}

async function submitCreate() {
  if (!create.user_id || !create.subject.trim()) {
    toast.error("Pick a person and enter a subject")
    return
  }
  saving.value = true
  try {
    const saved = await api.admin.createTicket({
      user_id: create.user_id,
      subject: create.subject.trim(),
      description: create.description.trim() || undefined,
    })
    upsertListRow(rows, saved)
    toast.success("Ticket created", String(saved.subject || ""))
    createOpen.value = false
    void load({ quiet: true })
    void openDetail(saved)
  } catch (e) {
    toast.error(apiError(e))
  } finally {
    saving.value = false
  }
}

async function saveTicket() {
  if (!selected.value?.id) return
  if (!form.subject.trim()) {
    toast.error("Subject required")
    return
  }
  saving.value = true
  try {
    const saved = await api.admin.patchTicket(Number(selected.value.id), {
      subject: form.subject.trim(),
      description: form.description.trim() || undefined,
      status: form.status,
    })
    upsertListRow(rows, saved)
    selected.value = saved
    toast.success("Ticket updated")
    void load({ quiet: true })
  } catch (e) {
    toast.error(apiError(e))
  } finally {
    saving.value = false
  }
}

async function setStatus(id: number, status: string) {
  const ok = await confirm({
    title: "Update ticket",
    message: `Mark ticket #${id} as ${statusLabel(status)}?`,
    confirmText: statusLabel(status),
  })
  if (!ok) return
  busyId.value = id
  try {
    const saved = await api.admin.patchTicket(id, { status })
    if (!upsertListRow(rows, saved)) patchListRow(rows, id, saved)
    if (selected.value && Number(selected.value.id) === id) {
      selected.value = saved
      form.status = String(saved.status || status)
    }
    toast.success(`Ticket #${id} → ${statusLabel(status)}`)
    void load({ quiet: true })
  } catch (e) {
    toast.error(apiError(e))
  } finally {
    busyId.value = null
  }
}

function chatLink(t: Record<string, unknown>) {
  if (t.conversation_id) return `/chats?id=${t.conversation_id}`
  return "/chats"
}

let liveSocket: ReturnType<typeof connect> = null
const onAdminEvent = (data: Record<string, unknown>) => {
  const kind = String(data?.kind || "")
  if (kind.includes("ticket") || kind.includes("chat") || kind.includes("conversation")) {
    void load({ quiet: true })
  }
}

onMounted(() => {
  void load()
  void loadPeople()
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
        <h1 class="font-display m-0 text-2xl text-chocolate sm:text-3xl">Support tickets</h1>
        <p class="m-0 mt-1 flex flex-wrap items-center gap-2 text-sm text-[var(--muted)]">
          <span
            class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.65rem] font-semibold"
            :class="socketLive ? 'bg-[#e8f6ee] text-[#2e7d4f]' : 'bg-[#f8ede6] text-[var(--muted)]'"
          >
            <span class="size-1.5 rounded-full" :class="socketLive ? 'animate-pulse bg-success' : 'bg-[#c4a39a]'" />
            {{ socketLive ? "Live" : "Offline" }}
          </span>
          <span>Track issues · resolve · jump to live chat</span>
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
        <UButton to="/chats" color="neutral" variant="outline" icon="i-lucide-messages-square" label="Live chat" />
        <UButton color="secondary" icon="i-lucide-plus" label="New ticket" @click="openCreate" />
      </div>
    </div>

    <p v-if="error" class="mb-3 text-sm text-danger">{{ error }}</p>

    <div class="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="Total tickets" :value="stats.total" icon="lucide:ticket" />
      <StatCard label="Open" :value="stats.open" icon="lucide:inbox" :tone="stats.open ? 'warn' : 'ok'" />
      <StatCard label="Shops" :value="stats.shops" icon="lucide:store" />
      <StatCard label="From AI" :value="stats.from_ai" icon="lucide:sparkles" />
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
          <span v-if="t.value === 'open'"> {{ stats.open }}</span>
          <span v-else-if="t.value === 'in_progress'"> {{ stats.in_progress }}</span>
          <span v-else-if="t.value === 'resolved'"> {{ stats.resolved }}</span>
          <span v-else-if="t.value === 'closed'"> {{ stats.closed }}</span>
          <span v-else-if="t.value === 'shop'"> {{ stats.shops }}</span>
          <span v-else-if="t.value === 'ai'"> {{ stats.from_ai }}</span>
          <span v-else> {{ stats.total }}</span>
        </button>
      </div>
      <label class="relative block w-full max-w-md">
        <UIcon name="i-lucide-search" class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--muted)]" />
        <input
          v-model="q"
          class="sc-input w-full !rounded-xl !py-2.5 !pl-9"
          placeholder="Search subject, shop, customer…"
        >
      </label>
    </div>

    <div v-if="loading" class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <div v-for="n in 6" :key="n" class="sc-skeleton h-36 rounded-2xl" />
    </div>

    <div
      v-else-if="!filtered.length"
      class="rounded-2xl border border-dashed border-[var(--line)] bg-white px-6 py-16 text-center shadow-[0_8px_22px_-18px_rgba(74,44,42,0.35)]"
    >
      <div class="mx-auto mb-3 flex size-12 items-center justify-center rounded-2xl bg-[#fff0f2] text-[#e9748e]">
        <UIcon name="i-lucide-inbox" class="size-6" />
      </div>
      <p class="font-display m-0 text-xl text-chocolate">No tickets here</p>
      <p class="m-0 mt-1 text-sm text-[var(--muted)]">
        Create a ticket for a customer or shop, or handle day-to-day support in Live chat.
      </p>
      <div class="mt-4 flex flex-wrap justify-center gap-2">
        <UButton color="secondary" label="New ticket" @click="openCreate" />
        <UButton to="/chats" color="neutral" variant="outline" label="Open live chat" />
      </div>
    </div>

    <div v-else class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <article
        v-for="t in filtered"
        :key="String(t.id)"
        class="rounded-2xl border border-[var(--line)] bg-white p-3.5 shadow-[0_8px_22px_-18px_rgba(74,44,42,0.35)] transition hover:border-[#e9748e]/40"
      >
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <p class="m-0 truncate font-semibold text-chocolate">{{ t.subject || t.title || `Ticket #${t.id}` }}</p>
            <p class="m-0 mt-0.5 truncate text-xs text-[var(--muted)]">
              #{{ t.id }} · {{ t.shop_name || t.customer_name || "User" }}
              <span v-if="t.customer_phone"> · {{ displayPhone(String(t.customer_phone)) }}</span>
            </p>
          </div>
          <span class="shrink-0 rounded-full px-2 py-0.5 text-[0.65rem] font-semibold capitalize" :class="statusTone(t.status)">
            {{ statusLabel(String(t.status || "open")) }}
          </span>
        </div>

        <p class="m-0 mt-2 line-clamp-2 text-xs text-[var(--muted)]">
          {{ t.description || t.body || t.message || "No description" }}
        </p>

        <div class="mt-3 flex flex-wrap items-center gap-1.5">
          <span
            class="rounded-full px-2 py-0.5 text-[0.65rem] font-semibold"
            :class="t.audience === 'shop' ? 'bg-[#fff0f2] text-[#e9748e]' : 'bg-[#f8ede6] text-chocolate'"
          >
            {{ t.audience === "shop" ? "Shop" : "Customer" }}
          </span>
          <span v-if="t.created_by_ai" class="rounded-full bg-[#e8f0ff] px-2 py-0.5 text-[0.65rem] font-semibold text-[#3b6bb5]">
            AI
          </span>
          <span class="text-[0.65rem] text-[var(--muted)]">{{ relativeAgo(String(t.created_at || "")) }}</span>
        </div>

        <div class="mt-3 flex flex-wrap gap-1.5">
          <UButton size="xs" color="secondary" variant="soft" label="Open" @click="openDetail(t)" />
          <UButton size="xs" color="neutral" variant="soft" label="Chat" :to="chatLink(t)" />
          <UButton
            v-if="isOpen(t)"
            size="xs"
            color="secondary"
            label="Resolve"
            :loading="busyId === Number(t.id)"
            @click="setStatus(Number(t.id), 'resolved')"
          />
          <UButton
            v-if="String(t.status) === 'open'"
            size="xs"
            color="neutral"
            variant="outline"
            label="Start"
            :loading="busyId === Number(t.id)"
            @click="setStatus(Number(t.id), 'in_progress')"
          />
        </div>
      </article>
    </div>

    <!-- Detail -->
    <USlideover
      v-model:open="panelOpen"
      side="right"
      :title="selected ? `Ticket #${selected.id}` : 'Ticket'"
      :description="selected ? String(selected.shop_name || selected.customer_name || '') : ''"
      :ui="{ content: 'w-full max-w-lg bg-[#fffaf8]' }"
    >
      <template #body>
        <div v-if="selected" class="flex flex-col gap-3 pb-6">
          <div class="rounded-2xl border border-[var(--line)] bg-white p-4">
            <div class="flex flex-wrap items-start justify-between gap-2">
              <div class="min-w-0">
                <p class="m-0 text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-[#e9748e]">
                  {{ selected.audience === "shop" ? "Shop ticket" : "Customer ticket" }}
                </p>
                <p class="font-display m-0 truncate text-xl text-chocolate">
                  {{ selected.shop_name || selected.customer_name }}
                </p>
              </div>
              <span class="rounded-full px-2 py-0.5 text-[0.65rem] font-semibold capitalize" :class="statusTone(selected.status)">
                {{ statusLabel(String(selected.status || "—")) }}
              </span>
            </div>
            <p v-if="selected.customer_phone" class="m-0 mt-1 text-sm text-[var(--muted)]">
              {{ displayPhone(String(selected.customer_phone)) }}
            </p>
            <p class="m-0 mt-1 text-xs text-[var(--muted)]">
              {{ relativeAgo(String(selected.created_at || "")) }}
              <span v-if="selected.created_by_ai"> · opened by AI</span>
            </p>
          </div>

          <label>
            <span class="sc-label">Subject</span>
            <input v-model="form.subject" class="sc-input !rounded-xl" required>
          </label>
          <label>
            <span class="sc-label">Description</span>
            <textarea v-model="form.description" rows="4" class="sc-input !rounded-xl" placeholder="What happened…" />
          </label>
          <label>
            <span class="sc-label">Status</span>
            <select v-model="form.status" class="sc-input !rounded-xl">
              <option v-for="s in statusOptions" :key="s.value" :value="s.value">{{ s.label }}</option>
            </select>
          </label>

          <div class="sticky bottom-0 flex flex-wrap gap-2 bg-[#fffaf8]/95 pt-2 backdrop-blur">
            <UButton color="secondary" class="flex-1" label="Save" :loading="saving" @click="saveTicket" />
            <UButton color="neutral" variant="soft" label="Chat" :to="chatLink(selected)" />
            <UButton
              v-if="isOpen(selected)"
              color="neutral"
              variant="outline"
              label="Resolve"
              :loading="busyId === Number(selected.id)"
              @click="setStatus(Number(selected.id), 'resolved')"
            />
          </div>
        </div>
      </template>
    </USlideover>

    <!-- Create -->
    <USlideover
      v-model:open="createOpen"
      side="right"
      title="New ticket"
      description="Log an issue for a customer or shop"
      :ui="{ content: 'w-full max-w-lg bg-[#fffaf8]' }"
    >
      <template #body>
        <form class="flex flex-col gap-3 pb-6" @submit.prevent="submitCreate">
          <label>
            <span class="sc-label">Search person</span>
            <input v-model="create.peopleQ" class="sc-input !rounded-xl" placeholder="Name, phone, shop…">
          </label>
          <label>
            <span class="sc-label">Assign to</span>
            <select v-model.number="create.user_id" class="sc-input !rounded-xl" required>
              <option :value="0" disabled>Select…</option>
              <option v-for="p in peopleOptions" :key="`${p.kind}-${p.id}`" :value="p.id">
                {{ p.label }}
              </option>
            </select>
          </label>
          <label>
            <span class="sc-label">Subject</span>
            <input v-model="create.subject" class="sc-input !rounded-xl" placeholder="Short summary" required>
          </label>
          <label>
            <span class="sc-label">Description</span>
            <textarea v-model="create.description" rows="4" class="sc-input !rounded-xl" placeholder="Details…" />
          </label>
          <div class="sticky bottom-0 flex gap-2 bg-[#fffaf8]/95 pt-2 backdrop-blur">
            <UButton type="submit" color="secondary" class="flex-1" label="Create ticket" :loading="saving" />
            <UButton type="button" color="neutral" variant="soft" label="Cancel" @click="createOpen = false" />
          </div>
        </form>
      </template>
    </USlideover>
  </div>
</template>

<script setup lang="ts">
import { apiError, displayPhone, money, relativeAgo, statusLabel } from "~/utils/format"

const api = useApi()
const toast = useAppToast()
const { confirm } = useConfirm()
const socketLive = useState("adminSocketLive", () => false)
const { connect } = useSocket()

const rows = ref<Record<string, unknown>[]>([])
const owing = ref<Record<string, unknown>[]>([])
const collections = ref<Record<string, unknown>[]>([])
const loading = ref(true)
const refreshing = ref(false)
const error = ref("")
const busyId = ref<number | null>(null)
const busyCollect = ref(false)
const q = ref("")
const tab = ref<"payments" | "udhaar" | "collections">("payments")
const flag = ref<"all" | "paid" | "pending" | "processing" | "refunded" | "failed">("all")
const panelOpen = ref(false)
const refundOpen = ref(false)

const stats = ref({
  payment_count: 0,
  paid_amount: 0,
  pending_amount: 0,
  refunded_amount: 0,
  udhaar_outstanding: 0,
  owing_shops: 0,
  paid: 0,
  pending: 0,
  processing: 0,
  refunded: 0,
})

const collect = reactive({
  user_id: 0,
  shop_name: "",
  outstanding: 0,
  amount: 0,
  method: "upi",
  note: "",
})

const refundForm = reactive({
  id: 0,
  order_label: "",
  max: 0,
  amount: 0,
})

const filterTabs = [
  { value: "all" as const, label: "All" },
  { value: "paid" as const, label: "Paid" },
  { value: "pending" as const, label: "Pending" },
  { value: "processing" as const, label: "Processing" },
  { value: "refunded" as const, label: "Refunded" },
  { value: "failed" as const, label: "Failed" },
]

const methodOptions = [
  { value: "upi", label: "UPI" },
  { value: "cash", label: "Cash" },
  { value: "bank", label: "Bank transfer" },
  { value: "razorpay", label: "Razorpay" },
]

const filteredPayments = computed(() => {
  const ql = q.value.trim().toLowerCase()
  return rows.value.filter((p) => {
    const st = String(p.status || "").toLowerCase()
    if (flag.value === "paid" && !["paid", "partially_paid"].includes(st)) return false
    if (flag.value === "pending" && st !== "pending") return false
    if (flag.value === "processing" && st !== "processing") return false
    if (flag.value === "refunded" && !st.includes("refund")) return false
    if (flag.value === "failed" && st !== "failed") return false
    if (!ql) return true
    return (
      String(p.id).includes(ql)
      || String(p.order_id || "").includes(ql)
      || String(p.order_number || "").toLowerCase().includes(ql)
      || String(p.customer_name || "").toLowerCase().includes(ql)
      || String(p.method || "").toLowerCase().includes(ql)
      || String(p.transaction_id || "").toLowerCase().includes(ql)
    )
  })
})

const filteredOwing = computed(() => {
  const ql = q.value.trim().toLowerCase()
  if (!ql) return owing.value
  return owing.value.filter(
    (s) =>
      String(s.shop_name || "").toLowerCase().includes(ql)
      || String(s.owner_name || "").toLowerCase().includes(ql)
      || String(s.phone || "").includes(ql),
  )
})

function statusTone(status: unknown) {
  const s = String(status || "").toLowerCase()
  if (["paid", "partially_paid"].includes(s)) return "bg-[#e8f6ee] text-[#2e7d4f]"
  if (s.includes("refund")) return "bg-[#fdecea] text-[#c0392b]"
  if (s === "failed") return "bg-[#fdecea] text-[#c0392b]"
  if (s === "processing") return "bg-[#fff0f2] text-[#e9748e]"
  return "bg-[#f8ede6] text-[var(--muted)]"
}

function canRefund(p: Record<string, unknown>) {
  const s = String(p.status || "").toLowerCase()
  return s === "paid" || s === "partially_paid"
}

function parseHub(data: unknown) {
  if (Array.isArray(data)) {
    rows.value = data as Record<string, unknown>[]
    owing.value = []
    collections.value = []
    return
  }
  const obj = (data || {}) as {
    items?: unknown[]
    owing?: unknown[]
    collections?: unknown[]
    stats?: Record<string, number>
  }
  rows.value = Array.isArray(obj.items) ? (obj.items as Record<string, unknown>[]) : []
  owing.value = Array.isArray(obj.owing) ? (obj.owing as Record<string, unknown>[]) : []
  collections.value = Array.isArray(obj.collections) ? (obj.collections as Record<string, unknown>[]) : []
  if (obj.stats) {
    stats.value = {
      payment_count: Number(obj.stats.payment_count) || rows.value.length,
      paid_amount: Number(obj.stats.paid_amount) || 0,
      pending_amount: Number(obj.stats.pending_amount) || 0,
      refunded_amount: Number(obj.stats.refunded_amount) || 0,
      udhaar_outstanding: Number(obj.stats.udhaar_outstanding) || 0,
      owing_shops: Number(obj.stats.owing_shops) || owing.value.length,
      paid: Number(obj.stats.paid) || 0,
      pending: Number(obj.stats.pending) || 0,
      processing: Number(obj.stats.processing) || 0,
      refunded: Number(obj.stats.refunded) || 0,
    }
  }
}

async function load(opts?: { quiet?: boolean }) {
  if (opts?.quiet) refreshing.value = true
  else loading.value = true
  error.value = ""
  try {
    const data = await api.admin.payments()
    parseHub(data)
    if (!stats.value.udhaar_outstanding && owing.value.length) {
      stats.value.udhaar_outstanding = owing.value.reduce(
        (a, s) => a + (Number(s.outstanding_balance) || 0),
        0,
      )
      stats.value.owing_shops = owing.value.length
    }
    if (!stats.value.payment_count) stats.value.payment_count = rows.value.length
  } catch (e) {
    error.value = apiError(e)
  } finally {
    loading.value = false
    refreshing.value = false
  }
}

function openCollect(s: Record<string, unknown>) {
  collect.user_id = Number(s.user_id)
  collect.shop_name = String(s.shop_name || "Shop")
  collect.outstanding = Number(s.outstanding_balance) || 0
  collect.amount = collect.outstanding
  collect.method = "upi"
  collect.note = ""
  panelOpen.value = true
}

function fillCollect(pct: number) {
  collect.amount = Math.round(collect.outstanding * pct * 100) / 100
}

async function submitCollect() {
  if (!collect.user_id || collect.amount <= 0) {
    toast.info("Enter a collection amount")
    return
  }
  if (collect.amount > collect.outstanding + 0.01) {
    toast.error("Amount exceeds outstanding")
    return
  }
  busyCollect.value = true
  try {
    await api.admin.shopCollect(collect.user_id, {
      amount: collect.amount,
      method: collect.method,
      note: collect.note.trim() || undefined,
    })
    toast.success("Udhaar collected", `${collect.shop_name} · ${money(collect.amount)}`)
    panelOpen.value = false
    void load({ quiet: true })
  } catch (e) {
    toast.error(apiError(e))
  } finally {
    busyCollect.value = false
  }
}

function openRefund(p: Record<string, unknown>) {
  const max = Math.max(0, Number(p.amount) - Number(p.refund_amount || 0))
  refundForm.id = Number(p.id)
  refundForm.order_label = String(p.order_number || `#${p.order_id || p.id}`)
  refundForm.max = max
  refundForm.amount = max
  refundOpen.value = true
}

async function submitRefund() {
  if (!refundForm.id || refundForm.amount <= 0) return
  const ok = await confirm({
    title: "Refund payment",
    message: `Refund ${money(refundForm.amount)} for ${refundForm.order_label}?`,
    confirmText: "Refund",
    tone: "danger",
  })
  if (!ok) return
  busyId.value = refundForm.id
  try {
    await api.admin.refundPayment(refundForm.id, { amount: refundForm.amount })
    toast.success("Payment refunded")
    refundOpen.value = false
    void load({ quiet: true })
  } catch (e) {
    toast.error("Refund failed", apiError(e))
  } finally {
    busyId.value = null
  }
}

let liveSocket: ReturnType<typeof connect> = null
const onAdminEvent = (data: Record<string, unknown>) => {
  const kind = String(data?.kind || "")
  if (
    kind.includes("payment")
    || kind.includes("shop_collection")
    || kind.includes("order")
    || kind.includes("refund")
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
        <h1 class="font-display m-0 text-2xl text-chocolate sm:text-3xl">Payments & Credit</h1>
        <p class="m-0 mt-1 flex flex-wrap items-center gap-2 text-sm text-[var(--muted)]">
          <span
            class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.65rem] font-semibold"
            :class="socketLive ? 'bg-[#e8f6ee] text-[#2e7d4f]' : 'bg-[#f8ede6] text-[var(--muted)]'"
          >
            <span class="size-1.5 rounded-full" :class="socketLive ? 'animate-pulse bg-success' : 'bg-[#c4a39a]'" />
            {{ socketLive ? "Live" : "Offline" }}
          </span>
          <span>UPI · COD · Razorpay · shop udhaar</span>
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
        <UButton to="/shops" color="neutral" variant="outline" icon="i-lucide-store" label="Shops" />
        <UButton
          color="secondary"
          icon="i-lucide-wallet"
          label="Collect udhaar"
          :disabled="!owing.length"
          @click="tab = 'udhaar'; if (owing[0]) openCollect(owing[0])"
        />
      </div>
    </div>

    <p v-if="error" class="mb-3 text-sm text-danger">{{ error }}</p>

    <div class="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="Udhaar due" :value="money(stats.udhaar_outstanding)" icon="lucide:wallet" tone="warn" />
      <StatCard label="Collected / paid" :value="money(stats.paid_amount)" icon="lucide:circle-check" tone="ok" />
      <StatCard label="In flight" :value="money(stats.pending_amount)" icon="lucide:hourglass" />
      <StatCard label="Gateway rows" :value="stats.payment_count" icon="lucide:receipt" />
    </div>

    <div class="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <div class="flex flex-wrap gap-1.5">
        <button
          v-for="t in [
            { value: 'payments' as const, label: 'Gateway' },
            { value: 'udhaar' as const, label: 'Shop udhaar' },
            { value: 'collections' as const, label: 'Collections' },
          ]"
          :key="t.value"
          type="button"
          class="rounded-full px-3 py-1.5 text-xs font-semibold transition"
          :class="tab === t.value ? 'bg-chocolate text-cream' : 'bg-white text-chocolate ring-1 ring-[var(--line)]'"
          @click="tab = t.value"
        >
          {{ t.label }}
          <span v-if="t.value === 'udhaar'"> {{ stats.owing_shops }}</span>
          <span v-else-if="t.value === 'collections'"> {{ collections.length }}</span>
          <span v-else> {{ stats.payment_count }}</span>
        </button>
      </div>
      <label class="relative block w-full max-w-md">
        <UIcon name="i-lucide-search" class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--muted)]" />
        <input
          v-model="q"
          class="sc-input w-full !rounded-xl !py-2.5 !pl-9"
          :placeholder="tab === 'udhaar' ? 'Search shop…' : 'Search order, customer, txn…'"
        >
      </label>
    </div>

    <div v-if="tab === 'payments'" class="mb-4 flex flex-wrap gap-1.5">
      <button
        v-for="t in filterTabs"
        :key="t.value"
        type="button"
        class="rounded-full px-3 py-1.5 text-xs font-semibold transition"
        :class="flag === t.value ? 'bg-[#e9748e] text-white' : 'bg-white text-chocolate ring-1 ring-[var(--line)]'"
        @click="flag = t.value"
      >
        {{ t.label }}
        <span v-if="t.value === 'paid'"> {{ stats.paid }}</span>
        <span v-else-if="t.value === 'pending'"> {{ stats.pending }}</span>
        <span v-else-if="t.value === 'processing'"> {{ stats.processing }}</span>
        <span v-else-if="t.value === 'refunded'"> {{ stats.refunded }}</span>
      </button>
    </div>

    <div v-if="loading" class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <div v-for="n in 6" :key="n" class="sc-skeleton h-36 rounded-2xl" />
    </div>

    <!-- Gateway payments -->
    <template v-else-if="tab === 'payments'">
      <div
        v-if="!filteredPayments.length"
        class="rounded-2xl border border-dashed border-[var(--line)] py-16 text-center text-sm text-[var(--muted)]"
      >
        No payments match
      </div>
      <div v-else class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <article
          v-for="p in filteredPayments"
          :key="String(p.id)"
          class="rounded-2xl border border-[var(--line)] bg-white p-3.5 shadow-[0_8px_22px_-18px_rgba(74,44,42,0.35)]"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <p class="m-0 font-semibold text-chocolate">
                <NuxtLink
                  v-if="p.order_id"
                  :to="`/orders/${p.order_id}`"
                  class="hover:text-[#e9748e]"
                >
                  {{ p.order_number || `#${p.order_id}` }}
                </NuxtLink>
                <span v-else>Payment #{{ p.id }}</span>
              </p>
              <p class="m-0 mt-0.5 truncate text-xs text-[var(--muted)]">
                {{ p.customer_name || "Customer" }}
                <span v-if="p.customer_phone"> · {{ displayPhone(String(p.customer_phone)) }}</span>
              </p>
            </div>
            <span class="shrink-0 rounded-full px-2 py-0.5 text-[0.65rem] font-semibold capitalize" :class="statusTone(p.status)">
              {{ statusLabel(String(p.status || "—")) }}
            </span>
          </div>

          <div class="mt-3 grid grid-cols-3 gap-2 rounded-xl bg-[#fff9f5] px-2.5 py-2 text-center">
            <div>
              <p class="m-0 text-[0.6rem] font-semibold uppercase tracking-wide text-[var(--muted)]">Amount</p>
              <p class="m-0 text-sm font-bold text-chocolate">{{ money(Number(p.amount)) }}</p>
            </div>
            <div>
              <p class="m-0 text-[0.6rem] font-semibold uppercase tracking-wide text-[var(--muted)]">Method</p>
              <p class="m-0 truncate text-sm font-bold capitalize text-chocolate">{{ statusLabel(String(p.method || "—")) }}</p>
            </div>
            <div>
              <p class="m-0 text-[0.6rem] font-semibold uppercase tracking-wide text-[var(--muted)]">When</p>
              <p class="m-0 truncate text-xs font-semibold text-chocolate">{{ relativeAgo(String(p.paid_at || p.created_at || "")) }}</p>
            </div>
          </div>

          <p v-if="p.transaction_id" class="m-0 mt-2 truncate text-[0.65rem] text-[var(--muted)]">
            Txn {{ p.transaction_id }}
          </p>
          <p v-if="Number(p.refund_amount) > 0" class="m-0 mt-1 text-xs font-semibold text-[#c0392b]">
            Refunded {{ money(Number(p.refund_amount)) }}
          </p>

          <div class="mt-3 flex flex-wrap gap-1.5">
            <UButton
              v-if="p.order_id"
              size="xs"
              color="neutral"
              variant="soft"
              label="Order"
              :to="`/orders/${p.order_id}`"
            />
            <UButton
              v-if="canRefund(p)"
              size="xs"
              color="secondary"
              variant="soft"
              label="Refund"
              :loading="busyId === Number(p.id)"
              @click="openRefund(p)"
            />
          </div>
        </article>
      </div>
    </template>

    <!-- Shop udhaar -->
    <template v-else-if="tab === 'udhaar'">
      <div
        v-if="!filteredOwing.length"
        class="rounded-2xl border border-dashed border-[var(--line)] py-16 text-center text-sm text-[var(--muted)]"
      >
        No shop udhaar outstanding — all clear
      </div>
      <div v-else class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <article
          v-for="s in filteredOwing"
          :key="String(s.user_id)"
          class="rounded-2xl border border-[var(--line)] bg-white p-3.5 shadow-[0_8px_22px_-18px_rgba(74,44,42,0.35)]"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <p class="m-0 truncate font-semibold text-chocolate">{{ s.shop_name }}</p>
              <p class="m-0 mt-0.5 truncate text-xs text-[var(--muted)]">
                {{ s.owner_name || "—" }}
                <span v-if="s.phone"> · {{ displayPhone(String(s.phone)) }}</span>
              </p>
            </div>
            <span class="shrink-0 rounded-full bg-[#fff0f2] px-2 py-0.5 text-[0.65rem] font-semibold text-[#e9748e]">
              Due
            </span>
          </div>
          <div class="mt-3 grid grid-cols-2 gap-2 rounded-xl bg-[#fff9f5] px-2.5 py-2 text-center">
            <div>
              <p class="m-0 text-[0.6rem] font-semibold uppercase tracking-wide text-[var(--muted)]">Outstanding</p>
              <p class="m-0 text-lg font-bold text-[#e9748e]">{{ money(Number(s.outstanding_balance)) }}</p>
            </div>
            <div>
              <p class="m-0 text-[0.6rem] font-semibold uppercase tracking-wide text-[var(--muted)]">Credit left</p>
              <p class="m-0 text-lg font-bold text-chocolate">{{ money(Number(s.credit_remaining)) }}</p>
            </div>
          </div>
          <div class="mt-3 flex flex-wrap gap-1.5">
            <UButton size="xs" color="secondary" variant="soft" label="Collect" @click="openCollect(s)" />
            <UButton
              size="xs"
              color="neutral"
              variant="ghost"
              label="Shop"
              :to="`/shops?q=${encodeURIComponent(String(s.shop_name || ''))}`"
            />
          </div>
        </article>
      </div>
    </template>

    <!-- Collections history -->
    <template v-else>
      <div
        v-if="!collections.length"
        class="rounded-2xl border border-dashed border-[var(--line)] py-16 text-center text-sm text-[var(--muted)]"
      >
        No collections recorded yet
      </div>
      <ul v-else class="m-0 divide-y divide-[var(--line)] overflow-hidden rounded-2xl border border-[var(--line)] bg-white p-0 shadow-[0_8px_22px_-18px_rgba(74,44,42,0.35)]">
        <li
          v-for="c in collections"
          :key="String(c.id)"
          class="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
        >
          <div class="min-w-0">
            <p class="m-0 font-semibold text-chocolate">{{ c.shop_name || `Shop #${c.retailer_user_id}` }}</p>
            <p class="m-0 truncate text-xs text-[var(--muted)]">
              {{ c.note || "Collection" }} · bal {{ money(Number(c.balance_after)) }}
              · {{ relativeAgo(String(c.created_at || "")) }}
            </p>
          </div>
          <span class="shrink-0 text-sm font-bold text-[#2e7d4f]">+{{ money(Number(c.amount)) }}</span>
        </li>
      </ul>
    </template>

    <!-- Collect slideover -->
    <USlideover
      v-model:open="panelOpen"
      side="right"
      :title="collect.shop_name || 'Collect udhaar'"
      description="Record UPI / cash collection against shop credit"
      :ui="{ content: 'w-full max-w-lg bg-[#fffaf8]' }"
    >
      <template #body>
        <form class="flex flex-col gap-3 pb-6" @submit.prevent="submitCollect">
          <div class="rounded-2xl bg-[#fff9f5] p-3 ring-1 ring-[var(--line)]">
            <p class="m-0 text-[0.65rem] font-semibold uppercase text-[var(--muted)]">Outstanding</p>
            <p class="m-0 text-2xl font-bold text-[#e9748e]">{{ money(collect.outstanding) }}</p>
          </div>
          <label>
            <span class="sc-label">Amount ₹</span>
            <input v-model.number="collect.amount" type="number" min="0" step="0.01" class="sc-input !rounded-xl" required>
          </label>
          <div class="flex flex-wrap gap-1.5">
            <UButton type="button" size="xs" color="neutral" variant="soft" label="25%" @click="fillCollect(0.25)" />
            <UButton type="button" size="xs" color="neutral" variant="soft" label="50%" @click="fillCollect(0.5)" />
            <UButton type="button" size="xs" color="neutral" variant="soft" label="Full" @click="fillCollect(1)" />
          </div>
          <label>
            <span class="sc-label">Method</span>
            <select v-model="collect.method" class="sc-input !rounded-xl">
              <option v-for="m in methodOptions" :key="m.value" :value="m.value">{{ m.label }}</option>
            </select>
          </label>
          <label>
            <span class="sc-label">Note</span>
            <input v-model="collect.note" class="sc-input !rounded-xl" placeholder="Optional reference">
          </label>
          <div class="sticky bottom-0 mt-2 flex gap-2 bg-[#fffaf8]/95 pt-2 backdrop-blur">
            <UButton type="submit" color="secondary" :loading="busyCollect" class="flex-1" label="Collect" />
            <UButton type="button" color="neutral" variant="soft" label="Cancel" @click="panelOpen = false" />
          </div>
        </form>
      </template>
    </USlideover>

    <!-- Refund slideover -->
    <USlideover
      v-model:open="refundOpen"
      side="right"
      title="Refund payment"
      :description="refundForm.order_label"
      :ui="{ content: 'w-full max-w-md bg-[#fffaf8]' }"
    >
      <template #body>
        <form class="flex flex-col gap-3 pb-6" @submit.prevent="submitRefund">
          <p class="m-0 text-sm text-[var(--muted)]">Max refundable {{ money(refundForm.max) }}</p>
          <label>
            <span class="sc-label">Refund amount ₹</span>
            <input
              v-model.number="refundForm.amount"
              type="number"
              min="0.01"
              :max="refundForm.max"
              step="0.01"
              class="sc-input !rounded-xl"
              required
            >
          </label>
          <div class="sticky bottom-0 mt-2 flex gap-2 bg-[#fffaf8]/95 pt-2 backdrop-blur">
            <UButton type="submit" color="secondary" :loading="busyId === refundForm.id" class="flex-1" label="Confirm refund" />
            <UButton type="button" color="neutral" variant="soft" label="Cancel" @click="refundOpen = false" />
          </div>
        </form>
      </template>
    </USlideover>
  </div>
</template>

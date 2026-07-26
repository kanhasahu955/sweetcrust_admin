<script setup lang="ts">
import { apiError, displayPhone, money, money2, relativeAgo, statusLabel } from "~/utils/format"

const api = useApi()
const toast = useAppToast()
const socketLive = useState("adminSocketLive", () => false)
const { connect } = useSocket()

const rows = ref<Record<string, unknown>[]>([])
const needs = ref<Record<string, unknown>[]>([])
const bakery = ref({ bakery_name: "SweetCrust", gstin: "" })
const loading = ref(true)
const refreshing = ref(false)
const error = ref("")
const busyId = ref<number | null>(null)
const q = ref("")
const tab = ref<"issued" | "needs">("issued")
const flag = ref<"all" | "customer_order" | "b2b_wholesale" | "subscription_pack" | "supplier_settlement">("all")
const panelOpen = ref(false)
const selected = ref<Record<string, unknown> | null>(null)

const stats = ref({
  total: 0,
  gst_total: 0,
  billed_total: 0,
  needs_invoice: 0,
  customer_order: 0,
  b2b_wholesale: 0,
  subscription_pack: 0,
  supplier_settlement: 0,
  cgst_total: 0,
  sgst_total: 0,
})

const kindTabs = [
  { value: "all" as const, label: "All" },
  { value: "customer_order" as const, label: "Customer" },
  { value: "b2b_wholesale" as const, label: "B2B" },
  { value: "subscription_pack" as const, label: "Subscription" },
  { value: "supplier_settlement" as const, label: "Supplier" },
]

function kindLabel(kind: unknown) {
  const k = String(kind || "")
  if (k === "customer_order") return "Customer"
  if (k === "b2b_wholesale") return "B2B"
  if (k === "subscription_pack") return "Subscription"
  if (k === "supplier_settlement") return "Supplier"
  return statusLabel(k || "—")
}

function kindTone(kind: unknown) {
  const k = String(kind || "")
  if (k === "b2b_wholesale") return "bg-[#fff0f2] text-[#e9748e]"
  if (k === "subscription_pack") return "bg-[#e8f0ff] text-[#3b6bb5]"
  if (k === "supplier_settlement") return "bg-[#f8ede6] text-chocolate"
  return "bg-[#e8f6ee] text-[#2e7d4f]"
}

function payTone(status: unknown) {
  const s = String(status || "").toLowerCase()
  if (["paid", "partially_paid"].includes(s)) return "bg-[#e8f6ee] text-[#2e7d4f]"
  if (s === "pending") return "bg-[#fff0f2] text-[#e9748e]"
  if (s.includes("partial")) return "bg-[#fff6e8] text-[#b8860b]"
  return "bg-[#f8ede6] text-[var(--muted)]"
}

const filteredIssued = computed(() => {
  const ql = q.value.trim().toLowerCase()
  return rows.value.filter((inv) => {
    if (flag.value !== "all" && String(inv.kind || "") !== flag.value) return false
    if (!ql) return true
    return (
      String(inv.invoice_number || "").toLowerCase().includes(ql)
      || String(inv.order_number || "").toLowerCase().includes(ql)
      || String(inv.customer_name || "").toLowerCase().includes(ql)
      || String(inv.customer_phone || "").includes(ql)
      || String(inv.title || "").toLowerCase().includes(ql)
      || String(inv.transaction_id || "").toLowerCase().includes(ql)
      || String(inv.gstin || "").toLowerCase().includes(ql)
    )
  })
})

const filteredNeeds = computed(() => {
  const ql = q.value.trim().toLowerCase()
  if (!ql) return needs.value
  return needs.value.filter(
    (o) =>
      String(o.order_number || "").toLowerCase().includes(ql)
      || String(o.customer_name || "").toLowerCase().includes(ql)
      || String(o.status || "").toLowerCase().includes(ql)
      || String(o.order_id || "").includes(ql),
  )
})

function parseHub(data: unknown) {
  const obj = (data || {}) as {
    items?: unknown[]
    needs_invoice?: unknown[]
    bakery?: Record<string, string>
    stats?: Record<string, number>
  }
  rows.value = Array.isArray(obj.items) ? (obj.items as Record<string, unknown>[]) : []
  needs.value = Array.isArray(obj.needs_invoice) ? (obj.needs_invoice as Record<string, unknown>[]) : []
  if (obj.bakery) {
    bakery.value = {
      bakery_name: String(obj.bakery.bakery_name || "SweetCrust"),
      gstin: String(obj.bakery.gstin || ""),
    }
  }
  if (obj.stats) {
    stats.value = {
      total: Number(obj.stats.total) || rows.value.length,
      gst_total: Number(obj.stats.gst_total) || 0,
      billed_total: Number(obj.stats.billed_total) || 0,
      needs_invoice: Number(obj.stats.needs_invoice) || needs.value.length,
      customer_order: Number(obj.stats.customer_order) || 0,
      b2b_wholesale: Number(obj.stats.b2b_wholesale) || 0,
      subscription_pack: Number(obj.stats.subscription_pack) || 0,
      supplier_settlement: Number(obj.stats.supplier_settlement) || 0,
      cgst_total: Number(obj.stats.cgst_total) || 0,
      sgst_total: Number(obj.stats.sgst_total) || 0,
    }
  } else {
    stats.value.total = rows.value.length
    stats.value.needs_invoice = needs.value.length
  }
}

async function load(opts?: { quiet?: boolean }) {
  if (opts?.quiet) refreshing.value = true
  else loading.value = true
  error.value = ""
  try {
    parseHub(await api.admin.invoices())
  } catch (e) {
    error.value = apiError(e)
    if (!opts?.quiet) toast.error(error.value)
  } finally {
    loading.value = false
    refreshing.value = false
  }
}

async function openDetail(inv: Record<string, unknown>) {
  selected.value = inv
  panelOpen.value = true
  const id = Number(inv.invoice_id || inv.id)
  if (!id) return
  try {
    selected.value = await api.admin.invoice(id)
  } catch (e) {
    toast.error(apiError(e))
  }
}

async function generateForOrder(orderId: number) {
  busyId.value = orderId
  try {
    const res = await api.admin.createInvoice(orderId)
    toast.success("Invoice ready", String(res.invoice_number || `#${orderId}`))
    selected.value = res
    panelOpen.value = true
    tab.value = "issued"
    void load({ quiet: true })
  } catch (e) {
    toast.error(apiError(e))
  } finally {
    busyId.value = null
  }
}

async function copyText(text: string, label = "Copied") {
  if (!text || !import.meta.client) return
  try {
    await navigator.clipboard.writeText(text)
    toast.success(label)
  } catch {
    toast.info(text)
  }
}

let liveSocket: ReturnType<typeof connect> = null
const onAdminEvent = (data: Record<string, unknown>) => {
  const kind = String(data?.kind || "")
  if (kind.includes("invoice") || kind.includes("order") || kind.includes("payment")) {
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
        <h1 class="font-display m-0 text-2xl text-chocolate sm:text-3xl">Invoices / GST</h1>
        <p class="m-0 mt-1 flex flex-wrap items-center gap-2 text-sm text-[var(--muted)]">
          <span
            class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.65rem] font-semibold"
            :class="socketLive ? 'bg-[#e8f6ee] text-[#2e7d4f]' : 'bg-[#f8ede6] text-[var(--muted)]'"
          >
            <span class="size-1.5 rounded-full" :class="socketLive ? 'animate-pulse bg-success' : 'bg-[#c4a39a]'" />
            {{ socketLive ? "Live" : "Offline" }}
          </span>
          <span>Tax docs · CGST / SGST · generate & print</span>
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
        <UButton to="/settings" color="neutral" variant="outline" icon="i-lucide-building-2" label="GSTIN" />
        <UButton
          color="secondary"
          icon="i-lucide-file-plus"
          label="Needs invoice"
          :disabled="!needs.length"
          @click="tab = 'needs'"
        />
      </div>
    </div>

    <p v-if="error" class="mb-3 text-sm text-danger">{{ error }}</p>

    <div
      v-if="bakery.gstin || bakery.bakery_name"
      class="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[var(--line)] bg-white px-4 py-3 shadow-[0_8px_22px_-18px_rgba(74,44,42,0.35)]"
    >
      <div class="min-w-0">
        <p class="m-0 text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--muted)]">Seller on invoices</p>
        <p class="m-0 truncate font-semibold text-chocolate">{{ bakery.bakery_name }}</p>
      </div>
      <button
        v-if="bakery.gstin"
        type="button"
        class="rounded-full bg-[#fff9f5] px-3 py-1.5 font-mono text-xs font-semibold text-chocolate ring-1 ring-[var(--line)] transition hover:bg-[#fff0f2]"
        @click="copyText(bakery.gstin, 'GSTIN copied')"
      >
        GSTIN {{ bakery.gstin }}
      </button>
      <NuxtLink v-else to="/settings" class="text-xs font-semibold text-[#e9748e] hover:underline">
        Add GSTIN in Settings
      </NuxtLink>
    </div>

    <div class="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="Issued" :value="stats.total" icon="lucide:file-text" />
      <StatCard label="GST collected" :value="money(stats.gst_total)" icon="lucide:percent" tone="ok" />
      <StatCard label="Billed total" :value="money(stats.billed_total)" icon="lucide:indian-rupee" />
      <StatCard
        label="Needs invoice"
        :value="stats.needs_invoice"
        icon="lucide:file-warning"
        :tone="stats.needs_invoice ? 'warn' : undefined"
        hint="Recent orders without a tax doc"
      />
    </div>

    <div class="mb-3 grid gap-2 sm:grid-cols-2">
      <div class="rounded-2xl bg-[#fff9f5] px-3.5 py-2.5 ring-1 ring-[var(--line)]">
        <p class="m-0 text-[0.65rem] font-semibold uppercase text-[var(--muted)]">CGST (period list)</p>
        <p class="m-0 text-lg font-bold text-chocolate">{{ money(stats.cgst_total) }}</p>
      </div>
      <div class="rounded-2xl bg-[#fff9f5] px-3.5 py-2.5 ring-1 ring-[var(--line)]">
        <p class="m-0 text-[0.65rem] font-semibold uppercase text-[var(--muted)]">SGST (period list)</p>
        <p class="m-0 text-lg font-bold text-chocolate">{{ money(stats.sgst_total) }}</p>
      </div>
    </div>

    <div class="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <div class="flex flex-wrap gap-1.5">
        <button
          v-for="t in [
            { value: 'issued' as const, label: 'Issued' },
            { value: 'needs' as const, label: 'Needs invoice' },
          ]"
          :key="t.value"
          type="button"
          class="rounded-full px-3 py-1.5 text-xs font-semibold transition"
          :class="tab === t.value ? 'bg-chocolate text-cream' : 'bg-white text-chocolate ring-1 ring-[var(--line)]'"
          @click="tab = t.value"
        >
          {{ t.label }}
          <span v-if="t.value === 'issued'"> {{ stats.total }}</span>
          <span v-else> {{ stats.needs_invoice }}</span>
        </button>
      </div>
      <label class="relative block w-full max-w-md">
        <UIcon name="i-lucide-search" class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--muted)]" />
        <input
          v-model="q"
          class="sc-input w-full !rounded-xl !py-2.5 !pl-9"
          :placeholder="tab === 'needs' ? 'Search order #…' : 'Search invoice, customer, order…'"
        >
      </label>
    </div>

    <div v-if="tab === 'issued'" class="mb-4 flex flex-wrap gap-1.5">
      <button
        v-for="t in kindTabs"
        :key="t.value"
        type="button"
        class="rounded-full px-3 py-1.5 text-xs font-semibold transition"
        :class="flag === t.value ? 'bg-[#e9748e] text-white' : 'bg-white text-chocolate ring-1 ring-[var(--line)]'"
        @click="flag = t.value"
      >
        {{ t.label }}
        <span v-if="t.value === 'customer_order'"> {{ stats.customer_order }}</span>
        <span v-else-if="t.value === 'b2b_wholesale'"> {{ stats.b2b_wholesale }}</span>
        <span v-else-if="t.value === 'subscription_pack'"> {{ stats.subscription_pack }}</span>
        <span v-else-if="t.value === 'supplier_settlement'"> {{ stats.supplier_settlement }}</span>
      </button>
    </div>

    <div v-if="loading" class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <div v-for="n in 6" :key="n" class="sc-skeleton h-40 rounded-2xl" />
    </div>

    <template v-else-if="tab === 'issued'">
      <div
        v-if="!filteredIssued.length"
        class="rounded-2xl border border-dashed border-[var(--line)] py-16 text-center text-sm text-[var(--muted)]"
      >
        No invoices match — generate from Needs invoice or an order
      </div>
      <div v-else class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <article
          v-for="inv in filteredIssued"
          :key="String(inv.invoice_id || inv.id)"
          class="rounded-2xl border border-[var(--line)] bg-white p-3.5 shadow-[0_8px_22px_-18px_rgba(74,44,42,0.35)] transition hover:border-[#e9748e]/40"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <p class="m-0 font-mono text-sm font-bold text-chocolate">{{ inv.invoice_number }}</p>
              <p class="m-0 mt-0.5 truncate text-xs text-[var(--muted)]">
                {{ inv.customer_name || "Customer" }}
                <span v-if="inv.customer_phone"> · {{ displayPhone(String(inv.customer_phone)) }}</span>
              </p>
            </div>
            <span class="shrink-0 rounded-full px-2 py-0.5 text-[0.65rem] font-semibold" :class="kindTone(inv.kind)">
              {{ kindLabel(inv.kind) }}
            </span>
          </div>

          <p v-if="inv.title" class="m-0 mt-2 truncate text-xs text-[var(--muted)]">{{ inv.title }}</p>

          <div class="mt-3 grid grid-cols-3 gap-2 rounded-xl bg-[#fff9f5] px-2.5 py-2 text-center">
            <div>
              <p class="m-0 text-[0.6rem] font-semibold uppercase tracking-wide text-[var(--muted)]">Total</p>
              <p class="m-0 text-sm font-bold text-chocolate">{{ money(Number(inv.final_amount)) }}</p>
            </div>
            <div>
              <p class="m-0 text-[0.6rem] font-semibold uppercase tracking-wide text-[var(--muted)]">GST</p>
              <p class="m-0 text-sm font-bold text-[#2e7d4f]">{{ money(Number(inv.gst_amount)) }}</p>
            </div>
            <div>
              <p class="m-0 text-[0.6rem] font-semibold uppercase tracking-wide text-[var(--muted)]">When</p>
              <p class="m-0 truncate text-xs font-semibold text-chocolate">{{ relativeAgo(String(inv.created_at || "")) }}</p>
            </div>
          </div>

          <div class="mt-2 flex flex-wrap items-center gap-1.5">
            <span
              class="rounded-full px-2 py-0.5 text-[0.65rem] font-semibold capitalize"
              :class="payTone(inv.payment_status)"
            >
              {{ statusLabel(String(inv.payment_status || "—")) }}
            </span>
            <span v-if="inv.order_number" class="truncate text-[0.65rem] text-[var(--muted)]">
              {{ inv.order_number }}
            </span>
          </div>

          <div class="mt-3 flex flex-wrap gap-1.5">
            <UButton size="xs" color="secondary" variant="soft" label="Open" @click="openDetail(inv)" />
            <UButton
              v-if="inv.order_id"
              size="xs"
              color="neutral"
              variant="soft"
              label="Print"
              :to="`/orders/${inv.order_id}`"
            />
            <UButton
              size="xs"
              color="neutral"
              variant="ghost"
              label="Copy #"
              @click="copyText(String(inv.invoice_number || ''), 'Invoice # copied')"
            />
          </div>
        </article>
      </div>
    </template>

    <template v-else>
      <div
        v-if="!filteredNeeds.length"
        class="rounded-2xl border border-dashed border-[var(--line)] py-16 text-center text-sm text-[var(--muted)]"
      >
        All recent orders already have invoices
      </div>
      <div v-else class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <article
          v-for="o in filteredNeeds"
          :key="String(o.order_id)"
          class="rounded-2xl border border-dashed border-[var(--line)] bg-white p-3.5 shadow-[0_8px_22px_-18px_rgba(74,44,42,0.35)]"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <p class="m-0 font-semibold text-chocolate">{{ o.order_number || `#${o.order_id}` }}</p>
              <p class="m-0 mt-0.5 truncate text-xs text-[var(--muted)]">
                {{ o.customer_name || "Customer" }} · {{ statusLabel(String(o.order_type || "order")) }}
              </p>
            </div>
            <StatusBadge :status="String(o.status || '—')" />
          </div>
          <div class="mt-3 grid grid-cols-3 gap-2 rounded-xl bg-[#fff9f5] px-2.5 py-2 text-center">
            <div>
              <p class="m-0 text-[0.6rem] font-semibold uppercase tracking-wide text-[var(--muted)]">Amount</p>
              <p class="m-0 text-sm font-bold text-chocolate">{{ money(Number(o.final_amount)) }}</p>
            </div>
            <div>
              <p class="m-0 text-[0.6rem] font-semibold uppercase tracking-wide text-[var(--muted)]">GST</p>
              <p class="m-0 text-sm font-bold text-chocolate">{{ money(Number(o.gst_amount)) }}</p>
            </div>
            <div>
              <p class="m-0 text-[0.6rem] font-semibold uppercase tracking-wide text-[var(--muted)]">Pay</p>
              <p class="m-0 truncate text-xs font-semibold capitalize text-chocolate">
                {{ statusLabel(String(o.payment_status || "—")) }}
              </p>
            </div>
          </div>
          <div class="mt-3 flex flex-wrap gap-1.5">
            <UButton
              size="xs"
              color="secondary"
              label="Generate"
              :loading="busyId === Number(o.order_id)"
              @click="generateForOrder(Number(o.order_id))"
            />
            <UButton size="xs" color="neutral" variant="soft" label="Order" :to="`/orders/${o.order_id}`" />
          </div>
        </article>
      </div>
    </template>

    <USlideover
      v-model:open="panelOpen"
      side="right"
      :title="String(selected?.invoice_number || 'Invoice')"
      :description="String(selected?.title || 'Tax invoice detail')"
      :ui="{ content: 'w-full max-w-lg bg-[#fffaf8]' }"
    >
      <template #body>
        <div v-if="selected" class="flex flex-col gap-4 pb-6">
          <div class="rounded-2xl border border-[var(--line)] bg-white p-4">
            <div class="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p class="m-0 text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-[#e9748e]">Tax invoice</p>
                <p class="font-display m-0 text-2xl text-chocolate">{{ selected.invoice_number }}</p>
              </div>
              <span class="rounded-full px-2 py-0.5 text-[0.65rem] font-semibold" :class="kindTone(selected.kind)">
                {{ kindLabel(selected.kind) }}
              </span>
            </div>
            <p class="m-0 mt-2 text-sm text-[var(--muted)]">
              {{ selected.bakery_name || bakery.bakery_name }}
              <span v-if="selected.gstin || bakery.gstin">
                · GSTIN {{ selected.gstin || bakery.gstin }}
              </span>
            </p>
            <p class="m-0 mt-1 text-sm font-semibold text-chocolate">
              {{ selected.customer_name }}
              <span v-if="selected.customer_phone" class="font-normal text-[var(--muted)]">
                · {{ displayPhone(String(selected.customer_phone)) }}
              </span>
            </p>
            <p v-if="selected.customer_address" class="m-0 mt-1 text-xs text-[var(--muted)]">
              {{ selected.customer_address }}
            </p>
          </div>

          <div class="overflow-hidden rounded-2xl border border-[var(--line)] bg-white">
            <div
              v-for="(line, idx) in (selected.lines as Record<string, unknown>[] | undefined) || []"
              :key="idx"
              class="flex items-start justify-between gap-3 border-b border-[var(--line)] px-3.5 py-2.5 last:border-0"
            >
              <div class="min-w-0">
                <p class="m-0 text-sm font-medium text-chocolate">{{ line.product_name || "Item" }}</p>
                <p class="m-0 text-xs text-[var(--muted)]">
                  {{ line.qty }} × {{ money2(Number(line.unit_price)) }}
                </p>
              </div>
              <p class="m-0 shrink-0 tabular-nums text-sm font-semibold text-chocolate">
                {{ money2(Number(line.line_total)) }}
              </p>
            </div>
            <p
              v-if="!((selected.lines as unknown[]) || []).length"
              class="m-0 px-3.5 py-6 text-center text-sm text-[var(--muted)]"
            >
              No line items stored
            </p>
          </div>

          <dl class="m-0 space-y-1.5 rounded-2xl bg-[#fff9f5] px-3.5 py-3 text-sm ring-1 ring-[var(--line)]">
            <div class="flex justify-between gap-3">
              <dt class="text-[var(--muted)]">Subtotal</dt>
              <dd class="m-0 tabular-nums">{{ money2(Number(selected.subtotal)) }}</dd>
            </div>
            <div v-if="Number(selected.discount)" class="flex justify-between gap-3">
              <dt class="text-[var(--muted)]">Discount</dt>
              <dd class="m-0 tabular-nums">−{{ money2(Number(selected.discount)) }}</dd>
            </div>
            <div class="flex justify-between gap-3">
              <dt class="text-[var(--muted)]">CGST 2.5%</dt>
              <dd class="m-0 tabular-nums">{{ money2(Number(selected.cgst)) }}</dd>
            </div>
            <div class="flex justify-between gap-3">
              <dt class="text-[var(--muted)]">SGST 2.5%</dt>
              <dd class="m-0 tabular-nums">{{ money2(Number(selected.sgst)) }}</dd>
            </div>
            <div v-if="Number(selected.delivery_fee)" class="flex justify-between gap-3">
              <dt class="text-[var(--muted)]">Delivery</dt>
              <dd class="m-0 tabular-nums">{{ money2(Number(selected.delivery_fee)) }}</dd>
            </div>
            <div class="flex justify-between gap-3 border-t border-[var(--line)] pt-2 font-bold text-chocolate">
              <dt>Grand total</dt>
              <dd class="m-0 tabular-nums">{{ money2(Number(selected.final_amount)) }}</dd>
            </div>
          </dl>

          <div class="flex flex-wrap gap-2 text-xs text-[var(--muted)]">
            <span
              class="rounded-full px-2 py-0.5 font-semibold capitalize"
              :class="payTone(selected.payment_status)"
            >
              {{ statusLabel(String(selected.payment_status || "—")) }}
            </span>
            <span v-if="selected.payment_method" class="capitalize">
              {{ statusLabel(String(selected.payment_method)) }}
            </span>
            <span v-if="selected.created_at">{{ relativeAgo(String(selected.created_at)) }}</span>
          </div>
          <p v-if="selected.transaction_id" class="m-0 truncate text-xs text-[var(--muted)]">
            Txn {{ selected.transaction_id }}
          </p>
          <p v-if="selected.notes" class="m-0 text-xs text-[var(--muted)]">{{ selected.notes }}</p>

          <div class="sticky bottom-0 flex flex-wrap gap-2 bg-[#fffaf8]/95 pt-2 backdrop-blur">
            <UButton
              v-if="selected.order_id"
              color="secondary"
              class="flex-1"
              label="Branded print"
              :to="`/orders/${selected.order_id}`"
            />
            <UButton
              color="neutral"
              variant="soft"
              label="Copy #"
              @click="copyText(String(selected.invoice_number || ''), 'Invoice # copied')"
            />
            <UButton type="button" color="neutral" variant="ghost" label="Close" @click="panelOpen = false" />
          </div>
        </div>
      </template>
    </USlideover>
  </div>
</template>

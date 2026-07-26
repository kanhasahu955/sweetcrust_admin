<script setup lang="ts">
import { apiError, relativeAgo } from "~/utils/format"

type Svc = {
  name: string
  port: number
  group?: string
  admin_use?: string
  docs?: string
  health?: string
  openapi?: string
  upstream?: string
  gateway_prefixes: string[]
  ok?: boolean | null
  detail?: string
  ms?: number | null
}

const api = useApi()
const toast = useAppToast()
const config = useRuntimeConfig()
const socketLive = useState("adminSocketLive", () => false)
const { connect } = useSocket()

const error = ref("")
const loading = ref(true)
const refreshing = ref(false)
const probeBusy = ref<string | null>(null)
const gatewayOk = ref<boolean | null>(null)
const gatewayUrl = ref(String(config.public.apiBase || "").replace(/\/$/, ""))
const socketUrl = ref(String(config.public.socketBase || "").replace(/\/$/, ""))
const note = ref("")
const probedAt = ref("")
const autoRefresh = ref(false)
const q = ref("")
const flag = ref<"all" | "up" | "down" | "admin" | "customer">("all")
const panelOpen = ref(false)
const selected = ref<Svc | null>(null)

const rows = ref<Svc[]>([])
const stats = ref({
  total: 0,
  up: 0,
  down: 0,
  avg_ms: null as number | null,
  admin: 0,
  customer: 0,
})

const filterTabs = [
  { value: "all" as const, label: "All" },
  { value: "up" as const, label: "Up" },
  { value: "down" as const, label: "Down" },
  { value: "admin" as const, label: "Admin" },
  { value: "customer" as const, label: "Customer" },
]

async function ping(url: string): Promise<{ ok: boolean, detail: string, ms: number }> {
  const started = Date.now()
  try {
    const r = await $fetch<{ ok?: boolean, status?: string, service?: string }>(url, {
      timeout: 2500,
    })
    const ok = r?.ok !== false && (r?.status == null || r.status === "running" || r.status === "ok")
    return { ok, detail: r?.service ? String(r.service) : "up", ms: Date.now() - started }
  } catch (e) {
    return { ok: false, detail: apiError(e) || "unreachable", ms: Date.now() - started }
  }
}

const filtered = computed(() => {
  const ql = q.value.trim().toLowerCase()
  return rows.value.filter((s) => {
    if (flag.value === "up" && !s.ok) return false
    if (flag.value === "down" && s.ok !== false) return false
    if (flag.value === "admin" && s.group !== "admin") return false
    if (flag.value === "customer" && s.group === "admin") return false
    if (!ql) return true
    return (
      s.name.toLowerCase().includes(ql)
      || String(s.admin_use || "").toLowerCase().includes(ql)
      || String(s.port).includes(ql)
      || (s.gateway_prefixes || []).some((p) => p.toLowerCase().includes(ql))
    )
  })
})

const slowest = computed(() => {
  const up = rows.value.filter((s) => s.ok && s.ms != null)
  if (!up.length) return null
  return [...up].sort((a, b) => Number(b.ms) - Number(a.ms))[0] || null
})

async function load(opts?: { quiet?: boolean }) {
  if (opts?.quiet) refreshing.value = true
  else loading.value = true
  error.value = ""
  try {
    const [reg, gw] = await Promise.all([
      api.services(),
      api.gatewayHealth().catch(() => ping(`${gatewayUrl.value}/gateway/health`)),
    ])
    gatewayOk.value = gw?.ok !== false
    gatewayUrl.value = reg.gateway || gatewayUrl.value
    if (reg.socket) socketUrl.value = reg.socket
    note.value = String(reg.note || "")
    probedAt.value = String(reg.probed_at || new Date().toISOString())

    const list = (reg.services || []) as Svc[]
    const healths = await Promise.all(
      list.map(async (s) => {
        if (typeof s.ok === "boolean") {
          return { ok: s.ok, detail: s.detail || (s.ok ? "up" : "down"), ms: s.ms ?? null }
        }
        const url = s.health || `http://127.0.0.1:${s.port}/health`
        return ping(url)
      }),
    )

    rows.value = list.map((s, i) => ({
      ...s,
      docs: s.docs || `${gatewayUrl.value}/docs`,
      ok: healths[i]?.ok ?? false,
      detail: healths[i]?.detail ?? "",
      ms: healths[i]?.ms ?? null,
    }))

    if (reg.stats) {
      stats.value = {
        total: Number(reg.stats.total) || rows.value.length,
        up: Number(reg.stats.up) || 0,
        down: Number(reg.stats.down) || 0,
        avg_ms: reg.stats.avg_ms == null ? null : Number(reg.stats.avg_ms),
        admin: Number(reg.stats.admin) || 0,
        customer: Number(reg.stats.customer) || 0,
      }
    } else {
      const up = rows.value.filter((r) => r.ok).length
      const latencies = rows.value.filter((r) => r.ok && r.ms != null).map((r) => Number(r.ms))
      stats.value = {
        total: rows.value.length,
        up,
        down: rows.value.length - up,
        avg_ms: latencies.length
          ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
          : null,
        admin: rows.value.filter((r) => r.group === "admin").length,
        customer: rows.value.filter((r) => r.group !== "admin").length,
      }
    }
  } catch (e) {
    error.value = apiError(e)
    gatewayOk.value = false
    if (!opts?.quiet) toast.error(error.value)
  } finally {
    loading.value = false
    refreshing.value = false
  }
}

async function probeOne(name: string) {
  probeBusy.value = name
  try {
    const s = await api.serviceProbe(name)
    const idx = rows.value.findIndex((r) => r.name === name)
    if (idx >= 0) {
      rows.value[idx] = { ...rows.value[idx], ...s }
    }
    if (selected.value?.name === name) selected.value = { ...selected.value, ...s }
    const up = rows.value.filter((r) => r.ok).length
    stats.value.up = up
    stats.value.down = rows.value.length - up
    toast.success(
      s.ok ? `${name} is up` : `${name} is down`,
      s.ms != null ? `${s.ms} ms · ${s.detail || ""}` : String(s.detail || ""),
    )
  } catch (e) {
    toast.error(apiError(e))
  } finally {
    probeBusy.value = null
  }
}

function openDetail(s: Svc) {
  selected.value = s
  panelOpen.value = true
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

function msTone(ms: unknown) {
  const n = Number(ms)
  if (!Number.isFinite(n)) return "text-[var(--muted)]"
  if (n < 80) return "text-[#2e7d4f]"
  if (n < 250) return "text-[#b8860b]"
  return "text-[#c0392b]"
}

let autoTimer: ReturnType<typeof setInterval> | null = null
watch(autoRefresh, (on) => {
  if (autoTimer) {
    clearInterval(autoTimer)
    autoTimer = null
  }
  if (on) {
    autoTimer = setInterval(() => void load({ quiet: true }), 15000)
  }
})

let liveSocket: ReturnType<typeof connect> = null
onMounted(() => {
  void load()
  liveSocket = connect()
})
onBeforeUnmount(() => {
  if (autoTimer) clearInterval(autoTimer)
  liveSocket = null
})
</script>

<template>
  <div>
    <div class="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="font-display m-0 text-2xl text-chocolate sm:text-3xl">Microservices</h1>
        <p class="m-0 mt-1 flex flex-wrap items-center gap-2 text-sm text-[var(--muted)]">
          <span
            class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.65rem] font-semibold"
            :class="socketLive ? 'bg-[#e8f6ee] text-[#2e7d4f]' : 'bg-[#f8ede6] text-[var(--muted)]'"
          >
            <span class="size-1.5 rounded-full" :class="socketLive ? 'animate-pulse bg-success' : 'bg-[#c4a39a]'" />
            {{ socketLive ? "Live" : "Offline" }}
          </span>
          <span>Gateway routes each /api/v1 path to a FastAPI service</span>
          <span v-if="probedAt">· {{ relativeAgo(probedAt) }}</span>
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
          :color="autoRefresh ? 'secondary' : 'neutral'"
          :variant="autoRefresh ? 'soft' : 'outline'"
          icon="i-lucide-timer"
          :label="autoRefresh ? 'Auto 15s' : 'Auto off'"
          @click="autoRefresh = !autoRefresh"
        />
        <UButton
          :to="`${gatewayUrl}/docs`"
          target="_blank"
          external
          color="neutral"
          variant="outline"
          icon="i-lucide-book-open"
          label="Gateway docs"
        />
      </div>
    </div>

    <p v-if="error" class="mb-3 text-sm text-danger">{{ error }}</p>
    <p v-if="note" class="mb-4 text-xs text-[var(--muted)]">{{ note }}</p>

    <div class="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard
        label="Gateway"
        :value="gatewayOk == null ? '…' : gatewayOk ? 'Up' : 'Down'"
        icon="lucide:server"
        :tone="gatewayOk ? 'ok' : gatewayOk === false ? 'warn' : undefined"
        :hint="gatewayUrl"
      />
      <StatCard
        label="Services up"
        :value="`${stats.up} / ${stats.total}`"
        icon="lucide:boxes"
        :tone="stats.down ? 'warn' : 'ok'"
        :hint="stats.down ? `${stats.down} down` : 'All healthy'"
      />
      <StatCard
        label="Avg latency"
        :value="stats.avg_ms == null ? '—' : `${stats.avg_ms} ms`"
        icon="lucide:gauge"
        :hint="slowest ? `Slowest ${slowest.name} · ${slowest.ms} ms` : 'Probe round-trip'"
      />
      <StatCard
        label="Realtime"
        :value="socketLive ? 'Connected' : 'Offline'"
        icon="lucide:radio"
        :tone="socketLive ? 'ok' : 'warn'"
        :hint="socketUrl || 'Socket.IO — not proxied by gateway'"
      />
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
          <span v-if="t.value === 'up'"> {{ stats.up }}</span>
          <span v-else-if="t.value === 'down'"> {{ stats.down }}</span>
          <span v-else-if="t.value === 'admin'"> {{ stats.admin }}</span>
          <span v-else-if="t.value === 'customer'"> {{ stats.customer }}</span>
          <span v-else> {{ stats.total }}</span>
        </button>
      </div>
      <label class="relative block w-full max-w-md">
        <UIcon name="i-lucide-search" class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--muted)]" />
        <input
          v-model="q"
          class="sc-input w-full !rounded-xl !py-2.5 !pl-9"
          placeholder="Search service, port, prefix…"
        >
      </label>
    </div>

    <div v-if="loading" class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <div v-for="n in 9" :key="n" class="sc-skeleton h-36 rounded-2xl" />
    </div>

    <div
      v-else-if="!filtered.length"
      class="rounded-2xl border border-dashed border-[var(--line)] bg-white px-6 py-16 text-center shadow-[0_8px_22px_-18px_rgba(74,44,42,0.35)]"
    >
      <p class="font-display m-0 text-xl text-chocolate">No services match</p>
      <p class="m-0 mt-1 text-sm text-[var(--muted)]">Is the gateway running on :8080?</p>
      <UButton class="mt-4" color="secondary" variant="soft" label="Refresh" @click="load()" />
    </div>

    <div v-else class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <article
        v-for="s in filtered"
        :key="s.name"
        class="rounded-2xl border border-[var(--line)] bg-white p-3.5 shadow-[0_8px_22px_-18px_rgba(74,44,42,0.35)] transition hover:border-[#e9748e]/40"
      >
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <p class="m-0 font-semibold text-chocolate">{{ s.name }}</p>
            <p class="m-0 mt-0.5 text-xs text-[var(--muted)]">
              :{{ s.port }}
              <span v-if="s.group"> · {{ s.group }}</span>
            </p>
          </div>
          <span
            class="shrink-0 rounded-full px-2 py-0.5 text-[0.65rem] font-semibold"
            :class="s.ok ? 'bg-[#e8f6ee] text-[#2e7d4f]' : 'bg-[#fdecea] text-[#c0392b]'"
          >
            {{ s.ok ? "Up" : "Down" }}
          </span>
        </div>

        <p class="m-0 mt-2 line-clamp-2 text-xs text-[var(--muted)]">
          {{ s.admin_use || "Customer / other (via gateway)" }}
        </p>

        <div class="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <span class="font-semibold tabular-nums" :class="msTone(s.ms)">
            {{ s.ms == null ? "—" : `${s.ms} ms` }}
          </span>
          <span class="truncate text-[var(--muted)]" :title="s.detail">{{ s.detail || "—" }}</span>
        </div>

        <div class="mt-2 flex flex-wrap gap-1">
          <span
            v-for="p in (s.gateway_prefixes || []).slice(0, 2)"
            :key="p"
            class="max-w-full truncate rounded-md bg-[#fff9f5] px-1.5 py-0.5 font-mono text-[0.65rem] text-chocolate ring-1 ring-[var(--line)]"
          >
            {{ p }}
          </span>
          <span
            v-if="(s.gateway_prefixes || []).length > 2"
            class="rounded-md bg-[#f8ede6] px-1.5 py-0.5 text-[0.65rem] text-[var(--muted)]"
          >
            +{{ s.gateway_prefixes.length - 2 }}
          </span>
        </div>

        <div class="mt-3 flex flex-wrap gap-1.5">
          <UButton size="xs" color="secondary" variant="soft" label="Detail" @click="openDetail(s)" />
          <UButton
            size="xs"
            color="neutral"
            variant="soft"
            label="Probe"
            :loading="probeBusy === s.name"
            @click="probeOne(s.name)"
          />
          <UButton
            size="xs"
            color="neutral"
            variant="ghost"
            label="Docs"
            :to="s.docs || `${gatewayUrl}/docs`"
            target="_blank"
            external
          />
        </div>
      </article>
    </div>

    <USlideover
      v-model:open="panelOpen"
      side="right"
      :title="selected ? selected.name : 'Service'"
      :description="selected ? `:${selected.port} · ${selected.group || 'service'}` : ''"
      :ui="{ content: 'w-full max-w-lg bg-[#fffaf8]' }"
    >
      <template #body>
        <div v-if="selected" class="flex flex-col gap-4 pb-6">
          <div class="rounded-2xl border border-[var(--line)] bg-white p-4">
            <div class="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p class="m-0 text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-[#e9748e]">
                  Health
                </p>
                <p class="font-display m-0 text-2xl text-chocolate">
                  {{ selected.ok ? "Up" : "Down" }}
                </p>
              </div>
              <span class="font-semibold tabular-nums" :class="msTone(selected.ms)">
                {{ selected.ms == null ? "—" : `${selected.ms} ms` }}
              </span>
            </div>
            <p class="m-0 mt-2 text-sm text-[var(--muted)]">{{ selected.detail || "—" }}</p>
            <p class="m-0 mt-1 text-sm text-chocolate">
              {{ selected.admin_use || "Customer / other (via gateway)" }}
            </p>
          </div>

          <div class="space-y-2">
            <p class="sc-label m-0">Gateway prefixes</p>
            <button
              v-for="p in selected.gateway_prefixes || []"
              :key="p"
              type="button"
              class="flex w-full items-center justify-between gap-2 rounded-xl bg-white px-3 py-2 text-left font-mono text-xs text-chocolate ring-1 ring-[var(--line)] transition hover:bg-[#fff9f5]"
              @click="copyText(p, 'Prefix copied')"
            >
              <span class="truncate">{{ p }}</span>
              <UIcon name="i-lucide-copy" class="size-3.5 shrink-0 text-[var(--muted)]" />
            </button>
          </div>

          <dl class="m-0 space-y-1.5 rounded-2xl bg-[#fff9f5] px-3.5 py-3 text-sm ring-1 ring-[var(--line)]">
            <div class="flex justify-between gap-3">
              <dt class="text-[var(--muted)]">Port</dt>
              <dd class="m-0 font-mono">:{{ selected.port }}</dd>
            </div>
            <div class="flex justify-between gap-3">
              <dt class="text-[var(--muted)]">Upstream</dt>
              <dd class="m-0 truncate font-mono text-xs">{{ selected.upstream || "—" }}</dd>
            </div>
            <div class="flex justify-between gap-3">
              <dt class="text-[var(--muted)]">Health URL</dt>
              <dd class="m-0 truncate font-mono text-xs">{{ selected.health || "—" }}</dd>
            </div>
          </dl>

          <div class="sticky bottom-0 flex flex-wrap gap-2 bg-[#fffaf8]/95 pt-2 backdrop-blur">
            <UButton
              color="secondary"
              class="flex-1"
              label="Probe again"
              :loading="probeBusy === selected.name"
              @click="probeOne(selected.name)"
            />
            <UButton
              color="neutral"
              variant="soft"
              label="Copy health"
              @click="copyText(String(selected.health || ''), 'Health URL copied')"
            />
            <UButton
              color="neutral"
              variant="outline"
              label="Docs"
              :to="selected.docs || `${gatewayUrl}/docs`"
              target="_blank"
              external
            />
          </div>
        </div>
      </template>
    </USlideover>
  </div>
</template>

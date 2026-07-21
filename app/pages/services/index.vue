<script setup lang="ts">
type Svc = {
  name: string
  port: number
  docs: string
  health: string
  openapi: string
  gateway_prefixes: string[]
  ok?: boolean | null
  detail?: string
}

const ADMIN_WIRED: Record<string, string> = {
  auth: "Login / register",
  user: "Auth /me",
  "store-ops": "Orders, shops, products, chats, …",
  analytics: "Dashboard & reports",
  inventory: "Inventory",
  promotion: "Coupons / offers",
  dispatch: "Live delivery map",
  ai: "AI bot & FAQs",
  assortment: "Assortment flags UI",
  pricing: "Pricing editor UI",
  picking: "Picking queue UI",
  routing: "Routing / ETA UI",
  forecast: "Forecast UI",
  payment: "Payments (via store-ops refunds)",
  rider: "Riders (via store-ops + delivery)",
}

const api = useApi()
const config = useRuntimeConfig()
const error = ref("")
const loading = ref(false)
const gatewayOk = ref<boolean | null>(null)
const gatewayUrl = ref(String(config.public.apiBase).replace(/\/$/, ""))
const socketUrl = ref(String(config.public.socketBase || "").replace(/\/$/, ""))
const rows = ref<Svc[]>([])

async function ping(url: string): Promise<{ ok: boolean; detail: string }> {
  try {
    const r = await $fetch<{ ok?: boolean; status?: string; service?: string }>(url, {
      timeout: 2500,
    })
    const ok = r?.ok !== false && (r?.status == null || r.status === "running" || r.status === "ok")
    return { ok, detail: r?.service ? String(r.service) : "up" }
  } catch (e) {
    return { ok: false, detail: apiError(e) || "unreachable" }
  }
}

async function load() {
  loading.value = true
  error.value = ""
  try {
    const [reg, gw] = await Promise.all([
      api.services(),
      ping(`${gatewayUrl.value}/gateway/health`),
    ])
    gatewayOk.value = gw.ok
    gatewayUrl.value = reg.gateway || gatewayUrl.value
    const list = reg.services || []
    const healths = await Promise.all(list.map((s) => ping(s.health)))
    rows.value = list.map((s, i) => ({
      ...s,
      ok: healths[i].ok,
      detail: healths[i].detail,
    }))
  } catch (e) {
    error.value = apiError(e)
    gatewayOk.value = false
  } finally {
    loading.value = false
  }
}

const upCount = computed(() => rows.value.filter((r) => r.ok).length)
const downCount = computed(() => rows.value.filter((r) => r.ok === false).length)

onMounted(load)
</script>

<template>
  <div>
    <PageHeader
      title="Microservices"
      subtitle="Admin talks to the gateway; gateway routes each /api/v1 path to a FastAPI service."
    >
      <template #actions>
        <UButton
          icon="i-lucide-refresh-cw"
          :loading="loading"
          :disabled="loading"
          label="Refresh"
          @click="load"
        />
      </template>
    </PageHeader>

    <UAlert v-if="error" color="error" variant="subtle" class="mb-3" :description="error" />

    <div class="mb-4 grid gap-3 sm:grid-cols-3">
      <UCard>
        <p class="text-xs uppercase tracking-wide text-muted">Gateway</p>
        <p class="mt-1 font-display text-lg">
          {{ gatewayOk == null ? "…" : gatewayOk ? "Up" : "Down" }}
        </p>
        <p class="mt-1 truncate text-xs text-muted">{{ gatewayUrl }}</p>
      </UCard>
      <UCard>
        <p class="text-xs uppercase tracking-wide text-muted">Realtime (socket)</p>
        <p class="mt-1 font-display text-lg truncate">{{ socketUrl || "—" }}</p>
        <p class="mt-1 text-xs text-muted">Socket.IO — not proxied by gateway</p>
      </UCard>
      <UCard>
        <p class="text-xs uppercase tracking-wide text-muted">Services</p>
        <p class="mt-1 font-display text-lg">
          <span class="text-success">{{ upCount }} up</span>
          <span v-if="downCount" class="text-error"> · {{ downCount }} down</span>
        </p>
        <p class="mt-1 text-xs text-muted">{{ rows.length }} registered</p>
      </UCard>
    </div>

    <UCard :ui="{ body: 'p-0 sm:p-0' }">
      <div class="overflow-x-auto">
        <table class="w-full min-w-[640px] text-left text-sm">
          <thead class="border-b border-default bg-muted/40 text-xs uppercase tracking-wide text-muted">
            <tr>
              <th class="px-4 py-3 font-medium">Status</th>
              <th class="px-4 py-3 font-medium">Service</th>
              <th class="px-4 py-3 font-medium">Port</th>
              <th class="px-4 py-3 font-medium">Admin use</th>
              <th class="px-4 py-3 font-medium">Gateway prefixes</th>
              <th class="px-4 py-3 font-medium">Docs</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-default">
            <tr v-for="s in rows" :key="s.name">
              <td class="px-4 py-3">
                <UBadge :color="s.ok ? 'success' : 'error'" variant="subtle">
                  {{ s.ok == null ? "…" : s.ok ? "up" : "down" }}
                </UBadge>
              </td>
              <td class="px-4 py-3 font-semibold">{{ s.name }}</td>
              <td class="px-4 py-3 text-muted">:{{ s.port }}</td>
              <td class="px-4 py-3 text-muted">
                {{ ADMIN_WIRED[s.name] || "Customer / other (via gateway)" }}
              </td>
              <td class="px-4 py-3">
                <UBadge
                  v-for="p in s.gateway_prefixes"
                  :key="p"
                  color="neutral"
                  variant="subtle"
                  class="mr-1 mb-1"
                  size="sm"
                >
                  {{ p }}
                </UBadge>
              </td>
              <td class="px-4 py-3">
                <UButton
                  :to="s.docs"
                  target="_blank"
                  variant="link"
                  color="primary"
                  size="sm"
                  label="OpenAPI"
                  trailing-icon="i-lucide-external-link"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <EmptyState
        v-if="!loading && !rows.length"
        class="m-4"
        title="No services"
        body="Is the gateway running on :8080?"
      />
    </UCard>
  </div>
</template>

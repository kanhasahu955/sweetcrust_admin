<script setup lang="ts">
const api = useApi()
const loading = ref(true)
const error = ref("")
const info = ref("")
const stops = ref<Record<string, unknown>[]>([])
const live = ref<unknown[]>([])
const route = ref<Record<string, unknown>[]>([])
const totalKm = ref(0)
const riders = ref<Record<string, unknown>[]>([])
const assignForm = reactive({ order_id: 0, delivery_person_id: 0 })
const etaResult = ref<Record<string, unknown> | null>(null)
const busy = ref(false)

async function load() {
  loading.value = true
  error.value = ""
  try {
    const [s, l, r] = await Promise.all([
      api.admin.routingStops(),
      api.admin.routingLive(),
      api.admin.deliveryPersons(),
    ])
    stops.value = Array.isArray(s) ? s : []
    live.value = Array.isArray(l) ? l : []
    riders.value = Array.isArray(r) ? (r as Record<string, unknown>[]) : []
  } catch (e) {
    error.value = apiError(e)
  } finally {
    loading.value = false
  }
}

async function optimize() {
  busy.value = true
  error.value = ""
  try {
    const res = await api.admin.routingOptimize()
    route.value = Array.isArray(res.route) ? res.route : []
    totalKm.value = Number(res.total_km) || 0
    info.value = `Optimized ${res.stops || 0} stops · ${totalKm.value} km`
  } catch (e) {
    error.value = apiError(e)
  } finally {
    busy.value = false
  }
}

async function checkEta(orderId: number) {
  try {
    etaResult.value = await api.admin.routingEta(orderId)
  } catch (e) {
    error.value = apiError(e)
  }
}

async function assign() {
  if (!assignForm.order_id || !assignForm.delivery_person_id) return
  busy.value = true
  error.value = ""
  try {
    await api.admin.routingAssign(assignForm.order_id, assignForm.delivery_person_id)
    info.value = `Assigned order #${assignForm.order_id}`
    await load()
  } catch (e) {
    error.value = apiError(e)
  } finally {
    busy.value = false
  }
}

onMounted(load)
</script>

<template>
  <div>
    <PageHeader title="Routing" subtitle="Open stops, greedy optimize, ETA, and rider assign">
      <template #actions>
        <UButton color="primary" variant="soft" label="Refresh" @click="load" />
        <UButton :loading="busy" label="Optimize route" @click="optimize" />
        <UButton to="/delivery" label="Riders" />
      </template>
    </PageHeader>

    <p v-if="error" class="mb-3 text-sm text-danger">{{ error }}</p>
    <p v-if="info" class="mb-3 rounded-xl bg-blush/50 px-3 py-2 text-sm text-cocoa">{{ info }}</p>

    <div class="mb-4 grid gap-3 sm:grid-cols-3">
      <div class="sc-card p-4">
        <p class="sc-label">Open stops</p>
        <p class="font-display text-2xl text-chocolate">{{ stops.length }}</p>
      </div>
      <div class="sc-card p-4">
        <p class="sc-label">Live tracks</p>
        <p class="font-display text-2xl text-honey">{{ live.length }}</p>
      </div>
      <div class="sc-card p-4">
        <p class="sc-label">Optimized km</p>
        <p class="font-display text-2xl text-cocoa">{{ totalKm || "—" }}</p>
      </div>
    </div>

    <div class="sc-card mb-4 grid gap-3 p-4 sm:grid-cols-3">
      <label>
        <span class="sc-label">Order ID</span>
        <input v-model.number="assignForm.order_id" type="number" class="sc-input">
      </label>
      <label>
        <span class="sc-label">Rider</span>
        <select v-model.number="assignForm.delivery_person_id" class="sc-input">
          <option :value="0">Select…</option>
          <option v-for="r in riders" :key="String(r.id)" :value="Number(r.id)">
            {{ r.name || r.phone || `#${r.id}` }}
          </option>
        </select>
      </label>
      <div class="flex items-end gap-2">
        <UButton :loading="busy" label="Assign" @click="assign" />
        <UButton
          color="neutral"
          variant="outline"
          label="ETA"
          :disabled="!assignForm.order_id"
          @click="checkEta(assignForm.order_id)"
        />
      </div>
      <p v-if="etaResult" class="sm:col-span-3 text-sm text-[var(--muted)]">
        ETA order #{{ etaResult.order_id }}: {{ etaResult.eta_minutes }} min ({{ etaResult.source }})
      </p>
    </div>

    <div class="mb-4 grid gap-4 lg:grid-cols-2">
      <div class="sc-card overflow-x-auto">
        <p class="border-b border-[var(--line)] px-4 py-2 font-semibold">Open stops</p>
        <table class="w-full text-sm">
          <thead>
            <tr class="text-left text-[0.68rem] uppercase text-[var(--muted)]">
              <th class="px-4 py-2">Order</th>
              <th class="px-4 py-2">Status</th>
              <th class="px-4 py-2">km</th>
              <th class="px-4 py-2">Rider</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in stops" :key="String(s.order_id)" class="border-t border-[var(--line)]">
              <td class="px-4 py-2 font-semibold">#{{ s.order_id }}</td>
              <td class="px-4 py-2 capitalize">{{ String(s.status || "—").replace(/_/g, " ") }}</td>
              <td class="px-4 py-2">{{ s.distance_km ?? "—" }}</td>
              <td class="px-4 py-2">{{ s.delivery_person_id || "—" }}</td>
            </tr>
          </tbody>
        </table>
        <EmptyState v-if="!loading && !stops.length" class="m-4" title="No open stops" />
      </div>

      <div class="sc-card overflow-x-auto">
        <p class="border-b border-[var(--line)] px-4 py-2 font-semibold">Optimized route</p>
        <ol class="divide-y divide-[var(--line)] text-sm">
          <li v-for="(s, i) in route" :key="String(s.order_id)" class="flex justify-between px-4 py-2">
            <span>{{ i + 1 }}. Order #{{ s.order_id }}</span>
            <span class="text-[var(--muted)]">+{{ s.leg_km }} km</span>
          </li>
        </ol>
        <EmptyState v-if="!route.length" class="m-4" title="Run Optimize" body="Nearest-neighbor from bakery." />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { money } from "~/utils/format"
import { patchListRow, upsertListRow } from "~/utils/list"

const api = useApi()
const riders = ref<Record<string, unknown>[]>([])
const liveRows = ref<Record<string, unknown>[]>([])
const error = ref("")
const info = ref("")
const form = reactive({ name: "", phone: "", password: "rider123", vehicle_number: "OD-00-0000", default_trip_cost: 40 })
const editCost = reactive<Record<number, number>>({})

async function load() {
  try {
    error.value = ""
    const [r, l] = await Promise.all([api.admin.deliveryPersons(), api.admin.liveDelivery().catch(() => null)])
    riders.value = Array.isArray(r) ? (r as Record<string, unknown>[]) : []
    for (const rider of riders.value) {
      editCost[Number(rider.id)] = Number(rider.default_trip_cost ?? 40)
    }
    const live = (l || {}) as Record<string, unknown>
    liveRows.value = Array.isArray(live.active) ? (live.active as Record<string, unknown>[]) : []
  } catch (e) {
    error.value = apiError(e)
  }
}

async function add() {
  try {
    error.value = ""
    info.value = ""
    if (!form.phone.trim() || !form.password.trim()) {
      error.value = "Phone and password are required"
      return
    }
    if (form.password.trim().length < 6) {
      error.value = "Password must be at least 6 characters"
      return
    }
    const created = await api.admin.addRider({ ...form })
    upsertListRow(riders, created)
    info.value = `Rider can login: ${form.phone} / ${form.password}`
    form.name = ""
    form.phone = ""
    void load()
  } catch (e) {
    error.value = apiError(e)
  }
}

async function saveRider(r: Record<string, unknown>) {
  const id = Number(r.id)
  try {
    error.value = ""
    const saved = await api.admin.patchRider(id, {
      default_trip_cost: editCost[id],
      is_available: r.is_available !== false,
    })
    if (!upsertListRow(riders, saved)) {
      patchListRow(riders, id, { default_trip_cost: editCost[id], is_available: r.is_available !== false })
    }
    info.value = `Rider #${id} updated`
    void load()
  } catch (e) {
    error.value = apiError(e)
  }
}

/** Create / reset delivery login for an existing rider row (phone + password). */
async function enableLogin(r: Record<string, unknown>, password = "password") {
  const id = Number(r.id)
  const phone = String(r.phone || "")
  try {
    error.value = ""
    info.value = ""
    await api.admin.patchRider(id, { password, phone, name: r.name })
    info.value = `Rider can login: ${phone.replace(/^\+91/, "")} / ${password}`
    void load()
  } catch (e) {
    error.value = apiError(e)
  }
}

async function toggleAvailable(r: Record<string, unknown>) {
  const id = Number(r.id)
  const next = r.is_available === false
  try {
    const saved = await api.admin.patchRider(id, { is_available: next })
    if (!upsertListRow(riders, saved)) patchListRow(riders, id, { is_available: next })
    void load()
  } catch (e) {
    error.value = apiError(e)
  }
}

function riderName(id: unknown) {
  const r = riders.value.find((x) => Number(x.id) === Number(id))
  return r ? String(r.name || r.phone) : `#${id}`
}

onMounted(load)
</script>

<template>
  <div>
    <PageHeader title="Riders" subtitle="Login accounts, trip cost, live deliveries">
      <template #actions>
        <UButton type="button" color="primary" variant="soft" @click="load">Refresh</UButton>
      </template>
    </PageHeader>
    <p v-if="error" class="mb-3 text-sm text-danger">{{ error }}</p>
    <p v-if="info" class="mb-3 rounded-xl bg-blush/50 px-3 py-2 text-sm text-cocoa">{{ info }}</p>
    <div class="mb-4 grid gap-4 lg:grid-cols-2">
      <div class="sc-card grid gap-2 p-4">
        <h3 class="font-display m-0 text-lg">Add rider</h3>
        <input v-model="form.name" class="sc-input" placeholder="Name">
        <input v-model="form.phone" class="sc-input" placeholder="Phone +91…">
        <input v-model="form.password" class="sc-input" placeholder="Login password">
        <input v-model="form.vehicle_number" class="sc-input" placeholder="Vehicle">
        <input v-model.number="form.default_trip_cost" type="number" min="0" class="sc-input" placeholder="Trip cost ₹">
        <UButton type="button" @click="add">Save rider</UButton>
      </div>
      <div class="sc-card overflow-hidden">
        <div class="flex items-center justify-between border-b border-[var(--line)] px-4 py-3">
          <h3 class="font-display m-0 text-lg">Live deliveries</h3>
          <span class="sc-badge bg-blush/70 text-cocoa">{{ liveRows.length }} active</span>
        </div>
        <div class="max-h-72 divide-y divide-[var(--line)] overflow-y-auto text-sm">
          <div v-for="t in liveRows" :key="String(t.id || t.order_id)" class="px-4 py-3">
            <div class="flex justify-between gap-2">
              <NuxtLink :to="`/orders/${t.order_id}`" class="font-semibold text-cocoa hover:text-honey">
                Order #{{ t.order_id }}
              </NuxtLink>
              <span class="text-[var(--muted)]">{{ riderName(t.delivery_person_id) }}</span>
            </div>
            <p class="mt-1 text-xs text-[var(--muted)]">
              ETA {{ t.eta_minutes != null ? `${t.eta_minutes} min` : "—" }}
              · {{ t.distance_km != null ? `${t.distance_km} km` : "—" }}
              <span v-if="t.rider_lat != null"> · lat {{ Number(t.rider_lat).toFixed(4) }}, lng {{ Number(t.rider_lng).toFixed(4) }}</span>
            </p>
          </div>
          <EmptyState v-if="!liveRows.length" class="m-4" title="No active tracking" body="Assign a rider on an order to see live rows." />
        </div>
      </div>
    </div>
    <div class="sc-card divide-y divide-[var(--line)]">
      <div v-for="r in riders" :key="String(r.id)" class="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
        <div>
          <p class="font-semibold">{{ r.name || r.user_name }}</p>
          <p class="text-[var(--muted)]">{{ r.phone }} · {{ r.vehicle_number }}</p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <label class="flex items-center gap-1 text-xs">
            Trip ₹
            <input v-model.number="editCost[Number(r.id)]" type="number" class="sc-input !w-20 !py-1">
          </label>
          <UButton type="button" color="primary" variant="soft" class=" !py-1 text-xs" @click="saveRider(r)">Save</UButton>
          <UButton type="button" color="neutral" variant="soft" class=" !py-1 text-xs" @click="enableLogin(r)">Enable login</UButton>
          <button type="button" class="sc-badge" :class="r.is_available === false ? 'bg-cream text-[var(--muted)]' : 'bg-blush/70 text-cocoa'" @click="toggleAvailable(r)">
            {{ r.is_available === false ? "Busy" : "Available" }} · {{ money(Number(r.default_trip_cost ?? 40)) }}/trip
          </button>
        </div>
      </div>
      <EmptyState v-if="!riders.length" class="m-4" title="No riders yet" />
    </div>
  </div>
</template>

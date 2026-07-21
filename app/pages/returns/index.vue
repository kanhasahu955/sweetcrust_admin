<script setup lang="ts">
import { statusLabel } from "~/utils/format"
import { patchListRow, upsertListRow } from "~/utils/list"

const api = useApi()
const rows = ref<Record<string, unknown>[]>([])
const error = ref("")
const info = ref("")
const busyId = ref<number | null>(null)
const assess = ref<Record<string, unknown> | null>(null)

async function load() {
  try {
    const data = await api.admin.returns()
    rows.value = Array.isArray(data) ? (data as Record<string, unknown>[]) : []
  } catch (e) {
    error.value = apiError(e)
  }
}

async function setStatus(id: number, status: string) {
  busyId.value = id
  error.value = ""
  try {
    const saved = await api.admin.updateReturn(id, { status })
    if (!upsertListRow(rows, saved)) patchListRow(rows, id, { status })
    info.value = `Return #${id} → ${status}`
    void load()
  } catch (e) {
    error.value = apiError(e)
  } finally {
    busyId.value = null
  }
}

async function aiAssess(r: Record<string, unknown>) {
  busyId.value = Number(r.id)
  error.value = ""
  try {
    assess.value = await api.admin.aiReturnAssess({
      issue_type: String(r.issue_type || r.reason || "quality"),
      description: String(r.reason || r.note || r.description || ""),
      evidence_urls: Array.isArray(r.evidence_urls) ? (r.evidence_urls as string[]) : [],
    })
    info.value = `AI assess #${r.id}: ${assess.value?.recommendation || assess.value?.decision || "done"}`
  } catch (e) {
    error.value = apiError(e)
  } finally {
    busyId.value = null
  }
}

onMounted(load)
</script>

<template>
  <div>
    <PageHeader title="Returns" subtitle="Approve or reject return requests" />
    <p v-if="error" class="mb-3 text-sm text-danger">{{ error }}</p>
    <p v-if="info" class="mb-3 rounded-xl bg-blush/50 px-3 py-2 text-sm text-cocoa">{{ info }}</p>
    <div v-if="assess" class="sc-card mb-4 p-4 text-sm">
      <p class="font-semibold text-chocolate">AI assessment</p>
      <pre class="mt-2 overflow-x-auto whitespace-pre-wrap text-xs text-[var(--muted)]">{{ JSON.stringify(assess, null, 2) }}</pre>
    </div>
    <div class="sc-card divide-y divide-[var(--line)]">
      <div v-for="r in rows" :key="String(r.id)" class="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
        <div>
          <p class="font-semibold">#{{ r.id }} · {{ statusLabel(String(r.status || "open")) }}</p>
          <p class="text-[var(--muted)]">{{ r.reason || r.note || "—" }}</p>
        </div>
        <div class="flex flex-wrap gap-2">
          <UButton type="button" color="primary" variant="soft" class=" !py-1.5 text-xs" :disabled="busyId === Number(r.id)" @click="aiAssess(r)">
            AI assess
          </UButton>
          <UButton type="button" color="primary" variant="soft" class=" !py-1.5 text-xs" :disabled="busyId === Number(r.id)" @click="setStatus(Number(r.id), 'approved')">
            Approve
          </UButton>
          <UButton type="button" color="neutral" variant="outline" class=" !py-1.5 text-xs" :disabled="busyId === Number(r.id)" @click="setStatus(Number(r.id), 'rejected')">
            Reject
          </UButton>
        </div>
      </div>
      <EmptyState v-if="!rows.length" class="m-4" title="No returns" />
    </div>
  </div>
</template>

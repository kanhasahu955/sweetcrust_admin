<script setup lang="ts">
import { upsertListRow } from "~/utils/list"

const api = useApi()
const rows = ref<Record<string, unknown>[]>([])
const error = ref("")
const info = ref("")
const busy = ref(false)
const show = ref(false)
const form = reactive({
  code: "",
  title: "",
  description: "",
  coupon_type: "percentage",
  value: 10,
  min_order_amount: 0,
  is_active: true,
})

async function load() {
  try {
    const data = await api.admin.coupons()
    rows.value = Array.isArray(data) ? (data as Record<string, unknown>[]) : []
  } catch (e) {
    error.value = apiError(e)
  }
}

async function create() {
  busy.value = true
  error.value = ""
  try {
    const code = form.code.trim().toUpperCase()
    const created = await api.admin.createCoupon({
      code,
      title: form.title.trim() || code,
      description: form.description || undefined,
      coupon_type: form.coupon_type,
      value: form.value,
      min_order_amount: form.min_order_amount || 0,
      is_active: form.is_active,
    })
    upsertListRow(rows, created)
    info.value = "Offer created"
    show.value = false
    form.code = ""
    form.title = ""
    form.description = ""
    void load()
  } catch (e) {
    error.value = apiError(e)
  } finally {
    busy.value = false
  }
}

async function aiSuggest() {
  busy.value = true
  error.value = ""
  try {
    const s = await api.admin.aiCouponSuggest()
    show.value = true
    form.title = String(s.title || "")
    form.description = String(s.description || "")
    form.coupon_type = String(s.coupon_type || "percentage")
    form.value = Number(s.discount_amount) || 10
    form.code = String(s.title || "OFFER").replace(/\W+/g, "").slice(0, 10).toUpperCase() || "OFFER"
    info.value = String(s.expected_impact || s.note || "AI suggestion filled — edit & create")
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
    <PageHeader title="Offers & Schemes" subtitle="Festival discounts and shop coupons">
      <template #actions>
        <UButton color="primary" variant="soft" :loading="busy" label="AI suggest" @click="aiSuggest" />
        <UButton type="button" @click="show = !show">{{ show ? "Close" : "New offer" }}</UButton>
      </template>
    </PageHeader>
    <p v-if="error" class="mb-3 text-sm text-danger">{{ error }}</p>
    <p v-if="info" class="mb-3 rounded-xl bg-blush/50 px-3 py-2 text-sm text-cocoa">{{ info }}</p>

    <div v-if="show" class="sc-card mb-4 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
      <label><span class="sc-label">Code</span><input v-model="form.code" class="sc-input" placeholder="HOLI10"></label>
      <label><span class="sc-label">Title</span><input v-model="form.title" class="sc-input" placeholder="Holi special"></label>
      <label><span class="sc-label">Type</span>
        <select v-model="form.coupon_type" class="sc-input">
          <option value="percentage">Percent</option>
          <option value="flat">Flat ₹</option>
        </select>
      </label>
      <label><span class="sc-label">Value</span><input v-model.number="form.value" type="number" class="sc-input"></label>
      <label class="sm:col-span-2"><span class="sc-label">Description</span><input v-model="form.description" class="sc-input"></label>
      <div class="flex items-end"><UButton type="button" :disabled="busy || !form.code" @click="create">Create</UButton></div>
    </div>

    <div class="sc-card divide-y divide-[var(--line)]">
      <div v-for="c in rows" :key="String(c.id)" class="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
        <div>
          <p class="font-semibold">{{ c.code || c.name }}</p>
          <p class="text-[var(--muted)]">{{ c.description || c.discount_type }} · {{ c.discount_value }}</p>
        </div>
        <span class="sc-badge" :class="c.is_active === false ? 'bg-cream text-[var(--muted)]' : 'bg-blush/70 text-cocoa'">
          {{ c.is_active === false ? "off" : "active" }}
        </span>
      </div>
      <EmptyState v-if="!rows.length" class="m-4" title="No offers yet" body="Create a festival code above." />
    </div>
  </div>
</template>

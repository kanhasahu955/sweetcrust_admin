<script setup lang="ts">
const api = useApi()
const error = ref("")
const info = ref("")
const busy = ref(false)
const checking = ref(false)
const integrations = ref<Record<string, unknown> | null>(null)
const liveCheck = ref<{ razorpay?: Record<string, unknown>; imagekit?: Record<string, unknown> } | null>(null)
const form = reactive({
  bakery_name: "",
  owner_name: "",
  phone: "",
  email: "",
  address: "",
  gstin: "",
  upi_id: "",
  delivery_charge: 40,
  free_delivery_min: 499,
  min_order_value: 149,
  cod_enabled: true,
  chatbot_tone: "warm",
  cancellation_policy: "",
  return_policy: "",
  refund_policy: "",
})

onMounted(async () => {
  try {
    const s = (await api.admin.settings()) as Record<string, unknown>
    integrations.value = (s.integrations as Record<string, unknown>) || null
    Object.assign(form, {
      bakery_name: String(s.bakery_name || ""),
      owner_name: String(s.owner_name || ""),
      phone: String(s.phone || ""),
      email: String(s.email || ""),
      address: String(s.address || ""),
      gstin: String(s.gstin || ""),
      upi_id: String(s.upi_id || ""),
      delivery_charge: Number(s.delivery_charge ?? 40),
      free_delivery_min: Number(s.free_delivery_min ?? 499),
      min_order_value: Number(s.min_order_value ?? 149),
      cod_enabled: s.cod_enabled !== false,
      chatbot_tone: String(s.chatbot_tone || "warm"),
      cancellation_policy: String(s.cancellation_policy || ""),
      return_policy: String(s.return_policy || ""),
      refund_policy: String(s.refund_policy || ""),
    })
  } catch (e) {
    error.value = apiError(e)
  }
})

async function save() {
  busy.value = true
  error.value = ""
  info.value = ""
  try {
    await api.admin.updateSettings({ ...form })
    info.value = "Settings saved"
  } catch (e) {
    error.value = apiError(e)
  } finally {
    busy.value = false
  }
}

async function checkCredentials() {
  checking.value = true
  error.value = ""
  try {
    liveCheck.value = await api.admin.integrationsCheck()
  } catch (e) {
    error.value = apiError(e)
  } finally {
    checking.value = false
  }
}

function flag(ok: unknown) {
  return ok ? "OK" : "Missing"
}
</script>

<template>
  <div>
    <PageHeader title="Settings" subtitle="Bakery identity, UPI, Razorpay, ImageKit, delivery rules" />
    <p v-if="error" class="mb-3 text-sm text-danger">{{ error }}</p>
    <p v-if="info" class="mb-3 text-sm text-success">{{ info }}</p>

    <div class="sc-card mb-4 grid gap-3 p-5">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h3 class="font-display m-0 text-lg">Integrations</h3>
        <UButton type="button" color="neutral" variant="outline" :disabled="checking" @click="checkCredentials">
          {{ checking ? "Checking…" : "Check credentials" }}
        </UButton>
      </div>
      <div class="grid gap-3 sm:grid-cols-2">
        <div class="rounded-lg border border-[var(--line)] p-3">
          <div class="text-sm font-semibold">Razorpay</div>
          <p class="m-0 mt-1 text-sm text-[var(--muted)]">
            Env: {{ flag(integrations?.razorpay) }}
            <span v-if="integrations?.razorpay_key_id_prefix"> · {{ integrations.razorpay_key_id_prefix }}</span>
          </p>
          <p v-if="liveCheck?.razorpay" class="m-0 mt-1 text-sm" :class="liveCheck.razorpay.ok ? 'text-success' : 'text-danger'">
            Live: {{ liveCheck.razorpay.ok ? `valid (${liveCheck.razorpay.mode || "ok"})` : (liveCheck.razorpay.detail || "failed") }}
          </p>
        </div>
        <div class="rounded-lg border border-[var(--line)] p-3">
          <div class="text-sm font-semibold">ImageKit</div>
          <p class="m-0 mt-1 text-sm text-[var(--muted)]">Env: {{ flag(integrations?.imagekit) }} · uploads / photos</p>
          <p v-if="liveCheck?.imagekit" class="m-0 mt-1 text-sm" :class="liveCheck.imagekit.ok ? 'text-success' : 'text-danger'">
            Live: {{ liveCheck.imagekit.ok ? `valid (${liveCheck.imagekit.provider})` : (liveCheck.imagekit.detail || "failed") }}
          </p>
        </div>
      </div>
      <p class="m-0 text-xs text-[var(--muted)]">
        Set <code>RAZORPAY_KEY_ID</code>, <code>RAZORPAY_KEY_SECRET</code>, and ImageKit keys in backend <code>.env</code>. Secrets never leave the server.
      </p>
    </div>

    <div class="grid gap-4 lg:grid-cols-2">
      <div class="sc-card grid gap-3 p-5">
        <h3 class="font-display m-0 text-lg">Bakery</h3>
        <label><span class="sc-label">Bakery name</span><input v-model="form.bakery_name" class="sc-input"></label>
        <label><span class="sc-label">Owner name</span><input v-model="form.owner_name" class="sc-input"></label>
        <label><span class="sc-label">Phone</span><input v-model="form.phone" class="sc-input"></label>
        <label><span class="sc-label">Email</span><input v-model="form.email" class="sc-input"></label>
        <label><span class="sc-label">Address</span><textarea v-model="form.address" class="sc-input min-h-[80px]" /></label>
        <label><span class="sc-label">GSTIN</span><input v-model="form.gstin" class="sc-input"></label>
        <label><span class="sc-label">UPI ID</span><input v-model="form.upi_id" class="sc-input" placeholder="sweetcrust@upi"></label>
      </div>

      <div class="sc-card grid gap-3 p-5">
        <h3 class="font-display m-0 text-lg">Orders & delivery</h3>
        <label><span class="sc-label">Delivery charge ₹</span><input v-model.number="form.delivery_charge" type="number" class="sc-input"></label>
        <label><span class="sc-label">Free delivery above ₹</span><input v-model.number="form.free_delivery_min" type="number" class="sc-input"></label>
        <label><span class="sc-label">Min order value ₹</span><input v-model.number="form.min_order_value" type="number" class="sc-input"></label>
        <label class="flex items-center gap-2">
          <input v-model="form.cod_enabled" type="checkbox" class="size-4">
          <span class="text-sm font-semibold">COD enabled</span>
        </label>
        <label><span class="sc-label">Chatbot tone</span><input v-model="form.chatbot_tone" class="sc-input"></label>
        <label><span class="sc-label">Cancellation policy</span><textarea v-model="form.cancellation_policy" class="sc-input min-h-[60px]" /></label>
        <label><span class="sc-label">Return policy</span><textarea v-model="form.return_policy" class="sc-input min-h-[60px]" /></label>
        <label><span class="sc-label">Refund policy</span><textarea v-model="form.refund_policy" class="sc-input min-h-[60px]" /></label>
        <UButton type="button" :disabled="busy" @click="save">Save settings</UButton>
      </div>
    </div>
  </div>
</template>

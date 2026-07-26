<script setup lang="ts">
definePageMeta({ layout: "auth" })

type Mode = "login" | "register" | "confirm"

const api = useApi()
const auth = useAuthStore()
const mode = ref<Mode>("login")
const registrationOpen = ref(false)
const busy = ref(false)
const error = ref("")
const info = ref("")

const form = reactive({
  name: "",
  phone: "",
  email: "",
  password: "",
  code: "",
  loginId: "",
})

onMounted(async () => {
  auth.hydrate()
  if (auth.isLoggedIn) {
    navigateTo("/dashboard")
    return
  }
  try {
    const s = await api.auth.registrationStatus()
    registrationOpen.value = s.registration_open
    if (s.registration_open) mode.value = "register"
    else if (s.admin_exists && !s.email_verified && s.email) {
      form.email = s.email
      mode.value = "confirm"
      info.value = "Confirm the code sent to your email, then sign in."
    }
  } catch {
    mode.value = "login"
  }
})

async function submit() {
  busy.value = true
  error.value = ""
  info.value = ""
  try {
    if (mode.value === "register") {
      const res = await api.auth.register({
        name: form.name,
        phone: form.phone,
        email: form.email,
        password: form.password,
      })
      info.value = res.email_sent
        ? `Code sent to ${res.email}${res.dev_code ? ` — use code ${res.dev_code}` : ""}`
        : `Email not sent${res.dev_code ? ` — use code ${res.dev_code}` : ""}`
      if (res.dev_code) form.code = res.dev_code
      mode.value = "confirm"
      registrationOpen.value = false
    } else if (mode.value === "confirm") {
      const res = await api.auth.confirmEmail(form.email, form.code)
      info.value = res.message
      mode.value = "login"
    } else {
      const tokens = await api.auth.login(form.loginId, form.password)
      auth.setTokens(tokens.access_token, tokens.refresh_token, tokens.user || null)
      await navigateTo("/dashboard")
    }
  } catch (e) {
    error.value = apiError(e)
    const msg = error.value.toLowerCase()
    if (msg.includes("confirm")) mode.value = "confirm"
    else if (mode.value === "login" && registrationOpen.value) {
      error.value = "No admin account yet — use Register first."
      mode.value = "register"
    }
  } finally {
    busy.value = false
  }
}

async function resend() {
  busy.value = true
  error.value = ""
  try {
    const res = await api.auth.resendConfirmation(form.email)
    info.value = res.email_sent
      ? `Code resent${res.dev_code ? ` — ${res.dev_code}` : ""}`
      : `Resend issue${res.dev_code ? ` — ${res.dev_code}` : ""}`
    if (res.dev_code) form.code = res.dev_code
  } catch (e) {
    error.value = apiError(e)
  } finally {
    busy.value = false
  }
}

const titles: Record<Mode, { h: string; p: string }> = {
  login: { h: "Welcome back", p: "Sign in to your bakery ops desk." },
  register: { h: "Create owner account", p: "One admin only — confirm by email next." },
  confirm: { h: "Confirm your email", p: "Enter the 6-digit code we sent you." },
}

const modeItems = computed(() => {
  const items = []
  if (registrationOpen.value) items.push({ label: "Register", value: "register" as Mode })
  items.push({ label: "Confirm", value: "confirm" as Mode })
  items.push({ label: "Sign in", value: "login" as Mode })
  return items
})
</script>

<template>
  <main class="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
    <section
      class="relative flex min-h-[36vh] flex-col justify-end overflow-hidden bg-gradient-to-br from-[#3a1e1a] via-[#2a1614] to-[#140a08] p-8 text-cream lg:min-h-screen lg:p-14"
    >
      <div class="pointer-events-none absolute -right-20 -top-24 size-[440px] rounded-full bg-[#e9748e]/25 blur-3xl" />
      <div class="pointer-events-none absolute -bottom-24 left-10 size-[320px] rounded-full bg-[#f2a7ad]/15 blur-3xl" />
      <div class="relative z-10 max-w-md">
        <BrandLogo size="xl" class="mb-6" />
        <span class="mb-3 inline-flex rounded-full bg-white/10 px-3 py-1 text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-[#f2a7ad]">
          Bakery ops
        </span>
        <h1 class="font-display text-4xl font-semibold leading-none lg:text-5xl">Ops console</h1>
        <p class="mt-4 max-w-[38ch] text-base leading-relaxed text-cream/70">
          Control for stock, shops, orders, riders, and collections — live and production-ready.
        </p>
        <ul class="mt-8 space-y-2 text-sm text-cream/55">
          <li class="flex items-center gap-2"><UIcon name="i-lucide-radio" class="size-4 text-[#e9748e]" /> Realtime order & chat signals</li>
          <li class="flex items-center gap-2"><UIcon name="i-lucide-store" class="size-4 text-[#e9748e]" /> B2B shop credit & approvals</li>
          <li class="flex items-center gap-2"><UIcon name="i-lucide-bike" class="size-4 text-[#e9748e]" /> Picking · routing · delivery</li>
        </ul>
      </div>
    </section>

    <section class="grid place-items-center bg-[var(--bg)] p-5 sm:p-8 lg:p-12">
      <div class="sc-card-smoke w-full max-w-[420px] p-6 sm:p-8">
        <BrandLogo size="md" class="mb-5 lg:hidden" />
        <div class="mb-5">
          <h2 class="font-display m-0 text-2xl text-chocolate">{{ titles[mode].h }}</h2>
          <p class="mt-1 text-sm text-[var(--muted)]">{{ titles[mode].p }}</p>
        </div>

        <form class="space-y-3" @submit.prevent="submit">
          <UTabs
            v-if="registrationOpen || mode !== 'login'"
            :model-value="mode"
            :items="modeItems"
            :content="false"
            class="w-full"
            @update:model-value="(v: string | number) => (mode = String(v) as Mode)"
          />

          <template v-if="mode === 'register'">
            <UFormField label="Name">
              <UInput v-model="form.name" required class="w-full" />
            </UFormField>
            <UFormField label="Phone">
              <UInput v-model="form.phone" required placeholder="+91…" class="w-full" />
            </UFormField>
            <UFormField label="Email">
              <UInput v-model="form.email" type="email" required class="w-full" />
            </UFormField>
            <UFormField label="Password">
              <UInput v-model="form.password" type="password" required :minlength="6" class="w-full" />
            </UFormField>
          </template>

          <template v-else-if="mode === 'confirm'">
            <UFormField label="Email">
              <UInput v-model="form.email" type="email" required class="w-full" />
            </UFormField>
            <UFormField label="Code">
              <UInput v-model="form.code" required maxlength="6" placeholder="••••••" class="w-full tracking-[0.3em]" />
            </UFormField>
          </template>

          <template v-else>
            <UFormField label="Phone or email">
              <UInput v-model="form.loginId" required autocomplete="username" class="w-full" />
            </UFormField>
            <UFormField label="Password">
              <UInput v-model="form.password" type="password" required autocomplete="current-password" class="w-full" />
            </UFormField>
          </template>

          <UAlert v-if="info" color="warning" variant="subtle" :description="info" />
          <UAlert v-if="error" color="error" variant="subtle" :description="error" />

          <UButton type="submit" block color="secondary" :loading="busy" :disabled="busy">
            {{ mode === "register" ? "Create admin" : mode === "confirm" ? "Confirm email" : "Sign in" }}
          </UButton>

          <div class="flex justify-between text-sm">
            <UButton
              v-if="mode === 'confirm'"
              variant="link"
              color="primary"
              :disabled="busy"
              label="Resend code"
              @click="resend"
            />
            <span v-else />
            <UButton
              v-if="!registrationOpen && mode === 'login'"
              variant="link"
              color="primary"
              label="Enter email code"
              @click="mode = 'confirm'"
            />
          </div>
        </form>
      </div>
    </section>
  </main>
</template>

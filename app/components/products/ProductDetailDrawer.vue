<script setup lang="ts">
import { apiError, formatDateTime12, money, relativeAgo } from "~/utils/format"
import { resolveMediaUrl } from "~/utils/mapPins"

const props = defineProps<{
  open: boolean
  productId: number | null
}>()

const emit = defineEmits<{
  "update:open": [boolean]
  edit: [product: Record<string, unknown>]
}>()

const api = useApi()
const config = useRuntimeConfig()
const loading = ref(false)
const error = ref("")
const detail = ref<Record<string, unknown> | null>(null)

const cover = computed(() =>
  resolveMediaUrl(String(detail.value?.cover_image_url || ""), String(config.public.apiBase || "")),
)

const reviews = computed(() => {
  const rows = detail.value?.reviews
  return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : []
})

const rating = computed(() => Number(detail.value?.rating) || 0)
const reviewCount = computed(() => Number(detail.value?.review_count) || 0)
const favCount = computed(() => Number(detail.value?.favorite_count) || 0)
const commentCount = computed(() => Number(detail.value?.comment_count) || reviews.value.filter((r) => r.comment).length)

function stars(n: number) {
  const full = Math.round(Math.max(0, Math.min(5, n)))
  return "★".repeat(full) + "☆".repeat(5 - full)
}

async function load() {
  if (!props.productId) return
  loading.value = true
  error.value = ""
  try {
    detail.value = await api.admin.product(props.productId)
  } catch (e) {
    error.value = apiError(e)
    detail.value = null
  } finally {
    loading.value = false
  }
}

watch(
  () => [props.open, props.productId] as const,
  ([open, id]) => {
    if (open && id) void load()
    if (!open) detail.value = null
  },
)

function close() {
  emit("update:open", false)
}

function onEdit() {
  if (detail.value) emit("edit", detail.value)
}
</script>

<template>
  <USlideover
    :open="open"
    side="right"
    title="Product detail"
    description="Ratings, reviews, shop & stock"
    :ui="{ content: 'w-full max-w-xl sm:max-w-2xl bg-[#fffaf8]' }"
    @update:open="emit('update:open', $event)"
  >
    <template #body>
      <div v-if="loading" class="space-y-3">
        <div class="sc-skeleton h-40 rounded-2xl" />
        <div class="sc-skeleton h-24 rounded-2xl" />
      </div>
      <p v-else-if="error" class="text-sm text-danger">{{ error }}</p>
      <div v-else-if="detail" class="space-y-4 pb-6">
        <div class="overflow-hidden rounded-2xl bg-[#fff5f7] ring-1 ring-[var(--line)]">
          <img v-if="cover" :src="cover" alt="" class="h-44 w-full object-cover">
          <div v-else class="grid h-44 place-items-center text-4xl font-bold text-[#e9748e]">
            {{ String(detail.name || '?').slice(0, 1) }}
          </div>
        </div>

        <div>
          <h2 class="font-display m-0 text-2xl text-chocolate">{{ detail.name }}</h2>
          <p class="m-0 mt-1 text-sm text-[var(--muted)]">{{ detail.short_description || detail.description || '—' }}</p>
        </div>

        <div class="flex flex-wrap gap-2">
          <span
            v-if="detail.shop_name || detail.supplier_user_id"
            class="inline-flex items-center gap-1.5 rounded-full bg-chocolate px-3 py-1 text-xs font-semibold text-cream"
          >
            <UIcon name="i-lucide-store" class="size-3.5" />
            {{ detail.shop_name || 'Shop' }}
          </span>
          <span
            v-if="detail.category_name"
            class="inline-flex items-center gap-1.5 rounded-full bg-[#fff0f2] px-3 py-1 text-xs font-semibold text-[#e9748e]"
          >
            <UIcon name="i-lucide-tag" class="size-3.5" />
            {{ detail.category_name }}
          </span>
          <span
            v-if="detail.brand_name"
            class="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-xs font-semibold text-chocolate ring-1 ring-[var(--line)]"
          >
            {{ detail.brand_name }}
          </span>
          <StatusBadge v-if="detail.stock_status" :status="String(detail.stock_status)" />
        </div>

        <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div class="rounded-2xl bg-white p-3 ring-1 ring-[var(--line)]">
            <p class="m-0 text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--muted)]">Rating</p>
            <p class="m-0 text-lg font-bold text-chocolate">{{ rating.toFixed(1) }}</p>
            <p class="m-0 text-xs text-[#e9748e]">{{ stars(rating) }}</p>
          </div>
          <div class="rounded-2xl bg-white p-3 ring-1 ring-[var(--line)]">
            <p class="m-0 text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--muted)]">Reviews</p>
            <p class="m-0 text-lg font-bold text-chocolate">{{ reviewCount }}</p>
          </div>
          <div class="rounded-2xl bg-white p-3 ring-1 ring-[var(--line)]">
            <p class="m-0 text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--muted)]">Comments</p>
            <p class="m-0 text-lg font-bold text-chocolate">{{ commentCount }}</p>
          </div>
          <div class="rounded-2xl bg-white p-3 ring-1 ring-[var(--line)]">
            <p class="m-0 text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--muted)]">Favorites</p>
            <p class="m-0 text-lg font-bold text-[#e9748e]">♥ {{ favCount }}</p>
          </div>
        </div>

        <div class="grid grid-cols-4 gap-2 rounded-2xl bg-[#fff9f5] px-3 py-2.5 text-center ring-1 ring-[var(--line)]">
          <div>
            <p class="m-0 text-[0.6rem] font-semibold uppercase text-[var(--muted)]">Wholesale</p>
            <p class="m-0 font-bold text-chocolate">{{ money(Number(detail.shop_price)) }}</p>
          </div>
          <div>
            <p class="m-0 text-[0.6rem] font-semibold uppercase text-[var(--muted)]">Customer</p>
            <p class="m-0 font-bold text-chocolate">{{ money(Number(detail.customer_price ?? detail.selling_price)) }}</p>
          </div>
          <div>
            <p class="m-0 text-[0.6rem] font-semibold uppercase text-[var(--muted)]">Cost</p>
            <p class="m-0 font-bold text-chocolate">{{ money(Number(detail.purchase_cost)) }}</p>
          </div>
          <div>
            <p class="m-0 text-[0.6rem] font-semibold uppercase text-[var(--muted)]">Stock</p>
            <p class="m-0 font-bold text-chocolate">{{ Number(detail.stock_qty) || 0 }} {{ detail.unit_label || 'pcs' }}</p>
          </div>
        </div>

        <div>
          <div class="mb-2 flex items-center justify-between">
            <p class="m-0 text-sm font-semibold text-chocolate">Reviews & comments</p>
            <span class="text-xs text-[var(--muted)]">{{ reviews.length }} shown</span>
          </div>
          <div v-if="!reviews.length" class="rounded-2xl border border-dashed border-[var(--line)] py-8 text-center text-sm text-[var(--muted)]">
            No reviews yet
          </div>
          <ul v-else class="m-0 list-none space-y-2 p-0">
            <li
              v-for="r in reviews"
              :key="String(r.id)"
              class="rounded-2xl bg-white p-3 ring-1 ring-[var(--line)]"
            >
              <div class="flex items-start justify-between gap-2">
                <div>
                  <p class="m-0 text-sm font-semibold text-chocolate">{{ r.user_name || `User #${r.user_id}` }}</p>
                  <p class="m-0 text-xs text-[#e9748e]">{{ stars(Number(r.rating) || 0) }} · {{ r.rating }}/5</p>
                </div>
                <p class="m-0 shrink-0 text-[0.65rem] text-[var(--muted)]" :title="formatDateTime12(String(r.created_at || ''))">
                  {{ relativeAgo(String(r.created_at || '')) }}
                </p>
              </div>
              <p v-if="r.comment" class="m-0 mt-2 text-sm text-chocolate/90">{{ r.comment }}</p>
              <p v-else class="m-0 mt-2 text-xs italic text-[var(--muted)]">No comment</p>
            </li>
          </ul>
        </div>

        <div class="sticky bottom-0 flex gap-2 bg-[#fffaf8]/95 pt-2 backdrop-blur">
          <UButton color="secondary" label="Edit product" class="flex-1" @click="onEdit" />
          <UButton color="neutral" variant="soft" label="Close" @click="close" />
        </div>
      </div>
    </template>
  </USlideover>
</template>

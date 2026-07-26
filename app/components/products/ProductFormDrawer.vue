<script setup lang="ts">
import { apiError, money } from "~/utils/format"
import { resolveMediaUrl } from "~/utils/mapPins"

const props = defineProps<{
  open: boolean
  editId?: number | null
  product?: Record<string, unknown> | null
  categories: Record<string, unknown>[]
  units: { code: string; label: string }[]
  wholesalers: Record<string, unknown>[]
  defaultCategoryId?: number | null
  defaultSupplierUserId?: number | null
}>()

const emit = defineEmits<{
  "update:open": [boolean]
  saved: [product: Record<string, unknown>]
}>()

const api = useApi()
const toast = useAppToast()
const config = useRuntimeConfig()

const busy = ref(false)
const uploading = ref(false)
const tab = ref<"basics" | "pricing" | "stock" | "more">("basics")
const fileInput = ref<HTMLInputElement | null>(null)

const form = reactive({
  name: "",
  category_id: 0,
  brand_name: "",
  supplier_user_id: 0,
  selling_price: 0,
  shop_price: 0,
  customer_price: 0,
  purchase_cost: 0,
  original_price: 0,
  gst_rate: 5,
  stock_qty: 0,
  min_order_qty: 1,
  low_stock_threshold: 5,
  unit_label: "pcs",
  short_description: "",
  description: "",
  ingredients: "",
  allergens: "",
  flavor: "",
  weight: "",
  cover_image_url: "",
  tags_text: "",
  fulfillment_type: "both",
  preparation_minutes: 60,
  shelf_life_hours: 24,
  storage_instructions: "",
  is_eggless: false,
  is_sugar_free: false,
  is_vegan: false,
  is_active: true,
  is_draft: false,
})

const tabs = [
  { key: "basics" as const, label: "Basics" },
  { key: "pricing" as const, label: "Pricing" },
  { key: "stock" as const, label: "Stock" },
  { key: "more" as const, label: "Details" },
]

const coverPreview = computed(() =>
  resolveMediaUrl(form.cover_image_url, String(config.public.apiBase || "")),
)

const marginCustomer = computed(() => {
  const c = Number(form.customer_price) || Number(form.selling_price) || 0
  const cost = Number(form.purchase_cost) || 0
  return Math.round((c - cost) * 100) / 100
})

const marginWholesale = computed(() => {
  const w = Number(form.shop_price) || 0
  const cost = Number(form.purchase_cost) || 0
  return Math.round((w - cost) * 100) / 100
})

const stockHint = computed(() => {
  const qty = Number(form.stock_qty) || 0
  const thr = Math.max(0, Number(form.low_stock_threshold) || 5)
  if (qty <= 0) return { label: "Out of stock", cls: "bg-[#fdecea] text-[#c0392b]" }
  if (qty <= thr) return { label: `Low · alert at ${thr}`, cls: "bg-[#fff0f2] text-[#e9748e]" }
  return { label: "In stock", cls: "bg-[#e8f6ee] text-[#2e7d4f]" }
})

function blankForm() {
  Object.assign(form, {
    name: "",
    brand_name: "",
    supplier_user_id: props.defaultSupplierUserId || 0,
    shop_price: 0,
    customer_price: 0,
    purchase_cost: 0,
    selling_price: 0,
    original_price: 0,
    gst_rate: 5,
    stock_qty: 0,
    min_order_qty: 1,
    low_stock_threshold: 5,
    unit_label: props.units[0]?.code || "pcs",
    short_description: "",
    description: "",
    ingredients: "",
    allergens: "",
    flavor: "",
    weight: "",
    cover_image_url: "",
    tags_text: "",
    fulfillment_type: "both",
    preparation_minutes: 60,
    shelf_life_hours: 24,
    storage_instructions: "",
    is_eggless: false,
    is_sugar_free: false,
    is_vegan: false,
    is_active: true,
    is_draft: false,
  })
  form.category_id = props.defaultCategoryId || Number(props.categories[0]?.id || 0)
  tab.value = "basics"
}

function fillFromProduct(p: Record<string, unknown>) {
  const tags = Array.isArray(p.tags) ? p.tags.map((t) => String(t)).join(", ") : ""
  Object.assign(form, {
    name: String(p.name || ""),
    category_id: Number(p.category_id) || 0,
    brand_name: String(p.brand_name || ""),
    supplier_user_id: Number(p.supplier_user_id) || 0,
    selling_price: Number(p.selling_price) || 0,
    shop_price: Number(p.shop_price) || 0,
    customer_price: Number(p.customer_price) || 0,
    purchase_cost: Number(p.purchase_cost) || 0,
    original_price: Number(p.original_price) || 0,
    gst_rate: Number(p.gst_rate) || 5,
    stock_qty: Number(p.stock_qty) || 0,
    min_order_qty: Number(p.min_order_qty) || 1,
    low_stock_threshold: Number(p.low_stock_threshold) || 5,
    unit_label: String(p.unit_label || "pcs"),
    short_description: String(p.short_description || ""),
    description: String(p.description || ""),
    ingredients: String(p.ingredients || ""),
    allergens: String(p.allergens || ""),
    flavor: String(p.flavor || ""),
    weight: String(p.weight || ""),
    cover_image_url: String(p.cover_image_url || ""),
    tags_text: tags,
    fulfillment_type: String(p.fulfillment_type || "both"),
    preparation_minutes: Number(p.preparation_minutes) || 60,
    shelf_life_hours: Number(p.shelf_life_hours) || 24,
    storage_instructions: String(p.storage_instructions || ""),
    is_eggless: p.is_eggless === true,
    is_sugar_free: p.is_sugar_free === true,
    is_vegan: p.is_vegan === true,
    is_active: p.is_active !== false,
    is_draft: p.is_draft === true,
  })
  tab.value = "basics"
}

watch(
  () => props.open,
  (v) => {
    if (!v) return
    if (props.editId && props.product) fillFromProduct(props.product)
    else blankForm()
  },
)

function close() {
  emit("update:open", false)
}

function onSupplier() {
  const shop = props.wholesalers.find((s) => Number(s.user_id) === Number(form.supplier_user_id))
  if (shop && !form.brand_name.trim()) form.brand_name = String(shop.shop_name || "")
}

function syncSellingFromCustomer() {
  if (!form.selling_price && form.customer_price) form.selling_price = Number(form.customer_price)
}

function matchWholesaleToCost() {
  if (form.purchase_cost) form.shop_price = Number(form.purchase_cost)
}

function parseTags() {
  return form.tags_text
    .split(/[,#]/)
    .map((t) => t.trim())
    .filter(Boolean)
}

async function onPickFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ""
  if (!file) return
  if (!file.type.startsWith("image/")) {
    toast.error("Pick an image file")
    return
  }
  uploading.value = true
  try {
    const res = await api.uploadFile(file, "product")
    const url = String(res?.url || "")
    if (!url) throw new Error("Upload failed")
    form.cover_image_url = url
    toast.success("Image uploaded")
  } catch (err) {
    toast.error(apiError(err))
  } finally {
    uploading.value = false
  }
}

async function save(asDraft?: boolean) {
  if (!form.name.trim() || !form.category_id) {
    toast.error("Name & category required")
    tab.value = "basics"
    return
  }
  if (asDraft != null) form.is_draft = asDraft
  busy.value = true
  try {
    const customer = Number(form.customer_price) || Number(form.selling_price) || 0
    const selling = Number(form.selling_price) || customer
    const tags = parseTags()
    const body: Record<string, unknown> = {
      name: form.name.trim(),
      category_id: form.category_id,
      brand_name: form.brand_name.trim() || undefined,
      supplier_user_id: form.supplier_user_id || undefined,
      selling_price: selling,
      shop_price: Number(form.shop_price) || 0,
      customer_price: customer,
      purchase_cost: Number(form.purchase_cost) || 0,
      original_price: Number(form.original_price) || undefined,
      gst_rate: Number(form.gst_rate) || 5,
      stock_qty: Number(form.stock_qty) || 0,
      min_order_qty: Math.max(1, Number(form.min_order_qty) || 1),
      low_stock_threshold: Math.max(0, Number(form.low_stock_threshold) || 5),
      unit_label: form.unit_label || "pcs",
      short_description: form.short_description.trim() || undefined,
      description: form.description.trim() || undefined,
      ingredients: form.ingredients.trim() || undefined,
      allergens: form.allergens.trim() || undefined,
      flavor: form.flavor.trim() || undefined,
      weight: form.weight.trim() || undefined,
      cover_image_url: form.cover_image_url.trim() || undefined,
      fulfillment_type: form.fulfillment_type || "both",
      preparation_minutes: Math.max(0, Number(form.preparation_minutes) || 0),
      shelf_life_hours: Number(form.shelf_life_hours) || undefined,
      storage_instructions: form.storage_instructions.trim() || undefined,
      is_eggless: form.is_eggless,
      is_sugar_free: form.is_sugar_free,
      is_vegan: form.is_vegan,
      is_active: form.is_active,
      is_draft: form.is_draft,
      tags: tags.length ? tags : undefined,
    }
    const saved = props.editId
      ? ((await api.admin.updateProduct(props.editId, body)) as Record<string, unknown>)
      : ((await api.admin.createProduct(body)) as Record<string, unknown>)
    toast.success(props.editId ? "Updated" : form.is_draft ? "Draft saved" : "Product created")
    emit("saved", saved)
    emit("update:open", false)
  } catch (e) {
    toast.error(apiError(e))
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <USlideover
    :open="open"
    side="right"
    :title="editId ? 'Edit product' : 'New product'"
    :description="editId ? 'Update SKU, pricing, stock & details' : 'One SKU per shop brand — wholesale then resell'"
    :ui="{ content: 'w-full max-w-xl sm:max-w-2xl bg-[#fffaf8]' }"
    @update:open="emit('update:open', $event)"
  >
    <template #body>
      <form class="flex min-h-0 flex-1 flex-col gap-0" @submit.prevent="save()">
        <!-- Cover -->
        <div class="relative mb-3 overflow-hidden rounded-2xl bg-[#fff5f7] ring-1 ring-[var(--line)]">
          <img
            v-if="coverPreview"
            :src="coverPreview"
            alt=""
            class="h-40 w-full object-cover"
          >
          <div v-else class="grid h-40 place-items-center text-sm text-[var(--muted)]">
            <div class="text-center">
              <UIcon name="i-lucide-image-plus" class="mx-auto mb-1 size-8 text-[#e9748e]/70" />
              <p class="m-0">Cover photo</p>
            </div>
          </div>
          <div class="absolute inset-x-0 bottom-0 flex flex-wrap gap-2 bg-gradient-to-t from-chocolate/70 to-transparent p-3">
            <UButton
              type="button"
              size="xs"
              color="secondary"
              :loading="uploading"
              icon="i-lucide-upload"
              label="Upload"
              @click="fileInput?.click()"
            />
            <UButton
              v-if="form.cover_image_url"
              type="button"
              size="xs"
              color="neutral"
              variant="soft"
              label="Clear"
              @click="form.cover_image_url = ''"
            />
          </div>
          <input ref="fileInput" type="file" accept="image/*" class="hidden" @change="onPickFile">
        </div>

        <label class="mb-3 block">
          <span class="sc-label">Or paste image URL</span>
          <input v-model="form.cover_image_url" class="sc-input !rounded-xl" placeholder="https://… or /uploads/…">
        </label>

        <!-- Tabs -->
        <div class="mb-3 flex flex-wrap gap-1 rounded-xl bg-[#f8ede6] p-1">
          <button
            v-for="t in tabs"
            :key="t.key"
            type="button"
            class="flex-1 rounded-lg px-2 py-2 text-xs font-semibold transition sm:px-3"
            :class="tab === t.key ? 'bg-chocolate text-cream shadow-sm' : 'text-chocolate/70 hover:bg-white/70'"
            @click="tab = t.key"
          >
            {{ t.label }}
          </button>
        </div>

        <div class="flex flex-col gap-3 pb-4">
          <!-- BASICS -->
          <template v-if="tab === 'basics'">
            <label>
              <span class="sc-label">Name *</span>
              <input v-model="form.name" class="sc-input !rounded-xl" required placeholder="e.g. Till Laddu">
            </label>
            <div class="grid grid-cols-2 gap-3">
              <label>
                <span class="sc-label">Category *</span>
                <select v-model.number="form.category_id" class="sc-input !rounded-xl" required>
                  <option v-for="c in categories" :key="String(c.id)" :value="Number(c.id)">{{ c.name }}</option>
                </select>
              </label>
              <label>
                <span class="sc-label">Unit</span>
                <select v-model="form.unit_label" class="sc-input !rounded-xl">
                  <option v-for="u in units" :key="u.code" :value="u.code">{{ u.label || u.code }}</option>
                  <option v-if="!units.length" value="pcs">pcs</option>
                </select>
              </label>
            </div>
            <label>
              <span class="sc-label">Shop (wholesaler)</span>
              <select v-model.number="form.supplier_user_id" class="sc-input !rounded-xl" @change="onSupplier">
                <option :value="0">—</option>
                <option v-for="s in wholesalers" :key="String(s.user_id)" :value="Number(s.user_id)">
                  {{ s.shop_name }}
                </option>
              </select>
            </label>
            <label>
              <span class="sc-label">Brand</span>
              <input v-model="form.brand_name" class="sc-input !rounded-xl" placeholder="Auto-fills from shop">
            </label>
            <label>
              <span class="sc-label">Short description</span>
              <input v-model="form.short_description" class="sc-input !rounded-xl" maxlength="500" placeholder="One line for cards">
            </label>
            <label>
              <span class="sc-label">Description</span>
              <textarea v-model="form.description" rows="3" class="sc-input !rounded-xl" placeholder="Full product story" />
            </label>
            <div class="grid grid-cols-2 gap-3">
              <label>
                <span class="sc-label">Flavor</span>
                <input v-model="form.flavor" class="sc-input !rounded-xl" placeholder="e.g. Sesame">
              </label>
              <label>
                <span class="sc-label">Weight / pack</span>
                <input v-model="form.weight" class="sc-input !rounded-xl" placeholder="e.g. 250g">
              </label>
            </div>
          </template>

          <!-- PRICING -->
          <template v-else-if="tab === 'pricing'">
            <div class="grid grid-cols-2 gap-2 rounded-2xl bg-[#fff9f5] p-3 ring-1 ring-[var(--line)]">
              <div>
                <p class="m-0 text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--muted)]">Customer margin</p>
                <p class="m-0 text-lg font-bold" :class="marginCustomer >= 0 ? 'text-[#2e7d4f]' : 'text-[#c0392b]'">
                  {{ money(marginCustomer) }}
                </p>
              </div>
              <div>
                <p class="m-0 text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--muted)]">Wholesale margin</p>
                <p class="m-0 text-lg font-bold" :class="marginWholesale >= 0 ? 'text-chocolate' : 'text-[#c0392b]'">
                  {{ money(marginWholesale) }}
                </p>
              </div>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <label>
                <span class="sc-label">Cost ₹</span>
                <input v-model.number="form.purchase_cost" type="number" min="0" step="0.01" class="sc-input !rounded-xl">
              </label>
              <label>
                <span class="sc-label">Wholesale ₹</span>
                <input v-model.number="form.shop_price" type="number" min="0" step="0.01" class="sc-input !rounded-xl">
              </label>
              <label>
                <span class="sc-label">Customer ₹</span>
                <input
                  v-model.number="form.customer_price"
                  type="number"
                  min="0"
                  step="0.01"
                  class="sc-input !rounded-xl"
                  @blur="syncSellingFromCustomer"
                >
              </label>
              <label>
                <span class="sc-label">Selling ₹</span>
                <input v-model.number="form.selling_price" type="number" min="0" step="0.01" class="sc-input !rounded-xl">
              </label>
              <label>
                <span class="sc-label">MRP ₹</span>
                <input v-model.number="form.original_price" type="number" min="0" step="0.01" class="sc-input !rounded-xl">
              </label>
              <label>
                <span class="sc-label">GST %</span>
                <input v-model.number="form.gst_rate" type="number" min="0" step="0.1" class="sc-input !rounded-xl">
              </label>
            </div>
            <UButton
              type="button"
              size="xs"
              color="neutral"
              variant="soft"
              label="Match wholesale = cost"
              @click="matchWholesaleToCost"
            />
          </template>

          <!-- STOCK -->
          <template v-else-if="tab === 'stock'">
            <div class="flex items-center justify-between rounded-2xl bg-[#fff9f5] px-3 py-2.5 ring-1 ring-[var(--line)]">
              <div>
                <p class="m-0 text-sm font-semibold text-chocolate">Stock status</p>
                <p class="m-0 text-xs text-[var(--muted)]">Alert fires when qty crosses “Low alert at”</p>
              </div>
              <span class="rounded-full px-2.5 py-1 text-[0.7rem] font-semibold" :class="stockHint.cls">
                {{ stockHint.label }}
              </span>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <label>
                <span class="sc-label">Stock qty</span>
                <input v-model.number="form.stock_qty" type="number" min="0" class="sc-input !rounded-xl">
              </label>
              <label>
                <span class="sc-label">Low alert at</span>
                <input v-model.number="form.low_stock_threshold" type="number" min="0" class="sc-input !rounded-xl">
              </label>
              <label>
                <span class="sc-label">Min order</span>
                <input v-model.number="form.min_order_qty" type="number" min="1" class="sc-input !rounded-xl">
              </label>
              <label>
                <span class="sc-label">Fulfillment</span>
                <select v-model="form.fulfillment_type" class="sc-input !rounded-xl">
                  <option value="both">Both</option>
                  <option value="b2b">B2B / shops</option>
                  <option value="b2c">B2C / customer</option>
                </select>
              </label>
            </div>
          </template>

          <!-- MORE -->
          <template v-else>
            <label>
              <span class="sc-label">Ingredients</span>
              <textarea v-model="form.ingredients" rows="2" class="sc-input !rounded-xl" />
            </label>
            <label>
              <span class="sc-label">Allergens</span>
              <input v-model="form.allergens" class="sc-input !rounded-xl" placeholder="nuts, dairy…">
            </label>
            <label>
              <span class="sc-label">Tags</span>
              <input v-model="form.tags_text" class="sc-input !rounded-xl" placeholder="festival, gift, bestseller">
            </label>
            <div class="grid grid-cols-2 gap-3">
              <label>
                <span class="sc-label">Prep minutes</span>
                <input v-model.number="form.preparation_minutes" type="number" min="0" class="sc-input !rounded-xl">
              </label>
              <label>
                <span class="sc-label">Shelf life (hrs)</span>
                <input v-model.number="form.shelf_life_hours" type="number" min="0" class="sc-input !rounded-xl">
              </label>
            </div>
            <label>
              <span class="sc-label">Storage</span>
              <input v-model="form.storage_instructions" class="sc-input !rounded-xl" placeholder="Keep cool & dry">
            </label>
            <div class="flex flex-wrap gap-3">
              <label class="inline-flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-sm text-chocolate ring-1 ring-[var(--line)]">
                <input v-model="form.is_eggless" type="checkbox" class="size-4 accent-[#e9748e]"> Eggless
              </label>
              <label class="inline-flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-sm text-chocolate ring-1 ring-[var(--line)]">
                <input v-model="form.is_sugar_free" type="checkbox" class="size-4 accent-[#e9748e]"> Sugar-free
              </label>
              <label class="inline-flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-sm text-chocolate ring-1 ring-[var(--line)]">
                <input v-model="form.is_vegan" type="checkbox" class="size-4 accent-[#e9748e]"> Vegan
              </label>
            </div>
          </template>

          <!-- Status (all tabs) -->
          <div class="mt-1 flex flex-wrap gap-3 border-t border-[var(--line)] pt-3">
            <label class="inline-flex items-center gap-2 text-sm text-chocolate">
              <input v-model="form.is_active" type="checkbox" class="size-4 accent-[#e9748e]"> Active
            </label>
            <label class="inline-flex items-center gap-2 text-sm text-chocolate">
              <input v-model="form.is_draft" type="checkbox" class="size-4 accent-[#e9748e]"> Draft
            </label>
          </div>
        </div>

        <div class="sticky bottom-0 -mx-1 mt-auto flex flex-col gap-2 bg-[#fffaf8]/95 pt-2 backdrop-blur sm:flex-row">
          <UButton
            type="submit"
            color="secondary"
            :loading="busy"
            :label="editId ? 'Save changes' : 'Create product'"
            class="sm:flex-1"
          />
          <UButton
            v-if="!editId"
            type="button"
            color="neutral"
            variant="soft"
            :loading="busy"
            label="Save draft"
            @click="save(true)"
          />
          <UButton type="button" color="neutral" variant="ghost" label="Cancel" @click="close" />
        </div>
      </form>
    </template>
  </USlideover>
</template>

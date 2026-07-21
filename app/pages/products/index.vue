<script setup lang="ts">
import { useAppToast } from "~/composables/useAppToast"
import { money } from "~/utils/format"
import { patchListRow, removeListRow, upsertListRow } from "~/utils/list"

const api = useApi()
const route = useRoute()
const router = useRouter()
const toast = useAppToast()
const { confirm } = useConfirm()
const q = ref("")
const loading = ref(true)
const error = ref("")
const products = ref<Record<string, unknown>[]>([])
const categories = ref<Record<string, unknown>[]>([])
const wholesalers = ref<Record<string, unknown>[]>([])
const showForm = ref(false)
const editId = ref<number | null>(null)

const filterCategoryId = computed(() => {
  const raw = route.query.category_id
  const n = Number(Array.isArray(raw) ? raw[0] : raw)
  return Number.isFinite(n) && n > 0 ? n : null
})

const filterCategoryName = computed(() => {
  if (!filterCategoryId.value) return ""
  const cat = categories.value.find((c) => Number(c.id) === filterCategoryId.value)
  return cat ? String(cat.name || "") : `Category #${filterCategoryId.value}`
})

const form = reactive({
  name: "",
  category_id: 0,
  brand_name: "",
  supplier_user_id: 0,
  selling_price: 0,
  shop_price: 0,
  customer_price: 0,
  purchase_cost: 0,
  stock_qty: 0,
  min_order_qty: 1,
  unit_label: "pkt",
  short_description: "",
  fulfillment_type: "both",
  is_active: true,
})

function resetForm() {
  Object.assign(form, {
    name: "",
    brand_name: "",
    supplier_user_id: 0,
    shop_price: 0,
    customer_price: 0,
    purchase_cost: 0,
    stock_qty: 0,
    selling_price: 0,
    min_order_qty: 1,
    unit_label: "pkt",
    short_description: "",
    fulfillment_type: "both",
    is_active: true,
  })
  if (filterCategoryId.value) form.category_id = filterCategoryId.value
  else if (categories.value[0]) form.category_id = Number(categories.value[0].id)
  editId.value = null
}

function onSupplier() {
  const shop = wholesalers.value.find((s) => Number(s.user_id) === Number(form.supplier_user_id))
  if (shop && !form.brand_name) form.brand_name = String(shop.shop_name || "")
}

function toggleForm() {
  if (showForm.value) {
    showForm.value = false
    resetForm()
    return
  }
  resetForm()
  showForm.value = true
}

async function load(quiet = false) {
  if (!quiet) loading.value = true
  error.value = ""
  try {
    const [data, cats, shops] = await Promise.all([
      api.admin.products(q.value || undefined, 1, filterCategoryId.value || undefined),
      api.admin.categories().catch(() => []),
      api.admin.shops().catch(() => []),
    ])
    const list = Array.isArray(data)
      ? data
      : (data as { items?: unknown[] })?.items || (data as { products?: unknown[] })?.products || []
    products.value = list as Record<string, unknown>[]
    categories.value = Array.isArray(cats) ? (cats as Record<string, unknown>[]) : []
    const shopList = Array.isArray(shops) ? (shops as Record<string, unknown>[]) : []
    wholesalers.value = shopList.filter(
      (s) => s.is_wholesaler !== false && String(s.approval_status || "approved") === "approved",
    )
    if (filterCategoryId.value) form.category_id = filterCategoryId.value
    else if (!form.category_id && categories.value[0]) form.category_id = Number(categories.value[0].id)
  } catch (e) {
    error.value = apiError(e)
  } finally {
    if (!quiet) loading.value = false
  }
}

function clearCategoryFilter() {
  const next = { ...route.query }
  delete next.category_id
  void router.replace({ query: next })
}

watch(filterCategoryId, () => {
  void load()
})

function startEdit(p: Record<string, unknown>) {
  editId.value = Number(p.id)
  showForm.value = true
  Object.assign(form, {
    name: String(p.name || ""),
    category_id: Number(p.category_id) || form.category_id,
    brand_name: String(p.brand_name || ""),
    supplier_user_id: p.supplier_user_id ? Number(p.supplier_user_id) : 0,
    selling_price: Number(p.selling_price ?? p.customer_price) || 0,
    shop_price: Number(p.shop_price ?? p.price) || 0,
    customer_price: Number(p.customer_price ?? p.selling_price) || 0,
    purchase_cost: Number(p.purchase_cost) || 0,
    stock_qty: Number(p.stock_qty) || 0,
    min_order_qty: Number(p.min_order_qty) || 1,
    unit_label: String(p.unit_label || "pkt"),
    short_description: String(p.short_description || ""),
    fulfillment_type: String(p.fulfillment_type || "both"),
    is_active: p.is_active !== false,
  })
}

async function save() {
  error.value = ""
  if (!form.category_id) {
    error.value = "Create a category first (Categories page)"
    return
  }
  if (!form.name || !form.selling_price) {
    error.value = "Name and selling price required"
    return
  }
  try {
    const selling = form.selling_price || form.customer_price || form.shop_price
    const body = {
      ...form,
      supplier_user_id: form.supplier_user_id || null,
      brand_name: (form.brand_name || "").trim() || null,
      selling_price: selling,
      shop_price: form.shop_price || selling,
      customer_price: form.customer_price || selling,
    }
    const saved = editId.value
      ? await api.admin.updateProduct(editId.value, body)
      : await api.admin.createProduct(body)
    upsertListRow(products, saved)
    showForm.value = false
    resetForm()
    void load(true)
  } catch (e) {
    error.value = apiError(e)
  }
}

async function remove(id: number) {
  const ok = await confirm({
    title: "Delete product",
    message: "Delete this product? This cannot be undone from the console.",
    confirmText: "Delete",
    tone: "danger",
  })
  if (!ok) return
  error.value = ""
  try {
    await api.admin.deleteProduct(id)
    removeListRow(products, id)
    toast.success("Product deleted")
    void load(true)
  } catch (e) {
    error.value = apiError(e)
    toast.error("Delete failed", apiError(e))
  }
}

async function duplicate(id: number) {
  error.value = ""
  try {
    const copy = await api.admin.duplicateProduct(id)
    upsertListRow(products, copy)
    void load(true)
  } catch (e) {
    error.value = apiError(e)
  }
}

async function publishDraft(id: number) {
  error.value = ""
  try {
    const saved = await api.admin.updateProduct(id, { is_draft: false, is_active: true })
    if (!upsertListRow(products, saved)) patchListRow(products, id, { is_draft: false, is_active: true })
    void load(true)
  } catch (e) {
    error.value = apiError(e)
  }
}

onMounted(() => load())
</script>

<template>
  <div>
    <PageHeader
      :title="filterCategoryId ? `Products in ${filterCategoryName}` : 'Products'"
      :subtitle="filterCategoryId ? 'Filtered by category — clear filter to see the full catalog.' : 'One SKU per shop brand — buy from that wholesaler, then resell'"
    >
      <template #actions>
        <UButton
          v-if="filterCategoryId"
          type="button"
          color="neutral"
          variant="outline"
          label="Clear filter"
          @click="clearCategoryFilter"
        />
        <UButton to="/categories" color="neutral" variant="outline">Categories</UButton>
        <UButton to="/inventory" color="primary" variant="soft">Inventory</UButton>
        <UButton type="button" @click="toggleForm">
          {{ showForm ? "Close" : "Add product" }}
        </UButton>
      </template>
    </PageHeader>

    <div class="mb-4 flex gap-2">
      <input v-model="q" class="sc-input max-w-sm" placeholder="Search products…" @keyup.enter="load">
      <UButton type="button" color="primary" variant="soft" @click="load">Search</UButton>
    </div>

    <div v-if="showForm" class="sc-card mb-4 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
      <p class="sm:col-span-2 lg:col-span-3 font-semibold text-chocolate">
        {{ editId ? `Edit product #${editId}` : "New product" }}
      </p>
      <label class="sm:col-span-2 lg:col-span-3">
        <span class="sc-label">Category</span>
        <select v-model.number="form.category_id" class="sc-input">
          <option v-for="c in categories" :key="String(c.id)" :value="Number(c.id)">{{ c.name }}</option>
        </select>
      </label>
      <label class="sm:col-span-2"><span class="sc-label">Name</span><input v-model="form.name" class="sc-input" required placeholder="e.g. Mango Pickle 500g — Sahu"></label>
      <label><span class="sc-label">Unit</span><input v-model="form.unit_label" class="sc-input"></label>
      <label>
        <span class="sc-label">Supplier shop (wholesaler)</span>
        <select v-model.number="form.supplier_user_id" class="sc-input" @change="onSupplier">
          <option :value="0">— none —</option>
          <option v-for="s in wholesalers" :key="String(s.user_id)" :value="Number(s.user_id)">
            {{ s.shop_name }}
          </option>
        </select>
      </label>
      <label>
        <span class="sc-label">Brand name</span>
        <input v-model="form.brand_name" class="sc-input" placeholder="Defaults to shop name">
      </label>
      <label class="sm:col-span-2 lg:col-span-3">
        <span class="sc-label">Short description</span>
        <input v-model="form.short_description" class="sc-input" placeholder="One line for catalog">
      </label>
      <label><span class="sc-label">Selling / MRP</span><input v-model.number="form.selling_price" type="number" class="sc-input"></label>
      <label><span class="sc-label">Shop price (B2B)</span><input v-model.number="form.shop_price" type="number" class="sc-input"></label>
      <label><span class="sc-label">Customer price</span><input v-model.number="form.customer_price" type="number" class="sc-input"></label>
      <label><span class="sc-label">Purchase cost</span><input v-model.number="form.purchase_cost" type="number" class="sc-input"></label>
      <label><span class="sc-label">Stock</span><input v-model.number="form.stock_qty" type="number" class="sc-input"></label>
      <label><span class="sc-label">Min order qty</span><input v-model.number="form.min_order_qty" type="number" class="sc-input"></label>
      <label class="flex items-center gap-2 pt-6">
        <input v-model="form.is_active" type="checkbox" class="size-4">
        <span class="text-sm font-semibold">Active in catalog</span>
      </label>
      <div class="sm:col-span-2 lg:col-span-3 flex gap-2">
        <UButton type="button" @click="save">{{ editId ? "Save changes" : "Save product" }}</UButton>
        <UButton color="neutral" variant="outline" v-if="editId" type="button"  @click="resetForm(); showForm = false">Cancel</UButton>
      </div>
    </div>

    <p v-if="error" class="mb-3 text-sm text-danger">{{ error }}</p>
    <div class="sc-card overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="bg-cream/80 text-left text-[0.68rem] uppercase tracking-wider text-[var(--muted)]">
            <th class="px-4 py-3">Name</th>
            <th class="px-4 py-3">Brand</th>
            <th class="px-4 py-3">Shop</th>
            <th class="px-4 py-3">Customer</th>
            <th class="px-4 py-3">Cost</th>
            <th class="px-4 py-3">Stock</th>
            <th class="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in products" :key="String(p.id)" class="border-t border-[var(--line)]">
            <td class="px-4 py-3">
              <p class="font-semibold">{{ p.name }}</p>
              <p v-if="p.is_draft" class="text-xs text-honey">Draft — shop request / unpublished</p>
              <p v-else-if="p.short_description" class="text-xs text-[var(--muted)] line-clamp-1">{{ p.short_description }}</p>
            </td>
            <td class="px-4 py-3 text-xs">{{ p.brand_name || "—" }}</td>
            <td class="px-4 py-3">{{ money(Number(p.shop_price ?? p.price)) }}</td>
            <td class="px-4 py-3">{{ money(Number(p.customer_price ?? p.selling_price)) }}</td>
            <td class="px-4 py-3">{{ money(Number(p.purchase_cost)) }}</td>
            <td class="px-4 py-3">{{ p.stock_qty }}</td>
            <td class="px-4 py-3 text-right whitespace-nowrap">
              <UButton v-if="p.is_draft"
                type="button" class="!py-1 text-xs" 
                @click="publishDraft(Number(p.id))"
              >
                Publish
              </UButton>
              <UButton type="button" color="primary" variant="soft" class=" !py-1 text-xs ml-1" @click="startEdit(p)">Edit</UButton>
              <UButton type="button" color="primary" variant="soft" class=" !py-1 text-xs ml-1" @click="duplicate(Number(p.id))">Dup</UButton>
              <UButton type="button" color="neutral" variant="outline" class=" !py-1 text-xs ml-1" @click="remove(Number(p.id))">Del</UButton>
            </td>
          </tr>
        </tbody>
      </table>
      <EmptyState
        v-if="!loading && !products.length"
        class="m-4"
        :title="filterCategoryId ? 'No products in this category' : 'No products'"
        :body="filterCategoryId ? 'Add a product with this category selected, or clear the filter.' : 'Add a category, then add products here.'"
      />
    </div>
  </div>
</template>

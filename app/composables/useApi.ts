import { useAuthStore } from "../stores/auth";

type TokenPair = {
  access_token: string
  refresh_token: string
  user?: { id: number; phone: string; name?: string | null; email?: string | null; role: string }
}

function qs(params?: Record<string, string | number | undefined | null>) {
  if (!params) return ""
  const sp = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") sp.set(k, String(v))
  })
  const s = sp.toString()
  return s ? `?${s}` : ""
}

/** Many microservice handlers wrap payloads in `{ success, data }`. */
function unwrap<T>(res: unknown): T {
  if (
    res
    && typeof res === "object"
    && (res as { success?: unknown }).success === true
    && "data" in res
  ) {
    return (res as { data: T }).data
  }
  return res as T
}

export function useApi() {
  const config = useRuntimeConfig()
  const auth = useAuthStore()
  const base = String(config.public.apiBase).replace(/\/$/, "")

  async function request<T>(
    path: string,
    opts: { method?: "GET" | "POST" | "PATCH" | "DELETE"; body?: unknown; auth?: boolean } = {},
  ): Promise<T> {
    const headers: Record<string, string> = { "Content-Type": "application/json" }
    if (opts.auth !== false && auth.accessToken) headers.Authorization = `Bearer ${auth.accessToken}`

    // Admin lists must never reuse a cached GET after create/update/delete.
    // Keep headers CORS-simple (no Cache-Control/Pragma) so browsers skip brittle preflights.
    const fetchOpts = {
      method: opts.method || "GET",
      body: opts.body as Record<string, unknown> | undefined,
      headers,
      cache: "no-store" as RequestCache,
    }

    try {
      const res = await $fetch<T>(`${base}${path}`, fetchOpts)
      // store-ops + domain services wrap with { success, data }
      return unwrap<T>(res)
    } catch (err: unknown) {
      const status = (err as { statusCode?: number; status?: number })?.statusCode
        || (err as { status?: number })?.status
      if (status === 401 && opts.auth !== false && auth.refreshToken && !path.includes("/auth/")) {
        try {
          const refreshed = await $fetch<TokenPair>(`${base}/api/v1/auth/refresh`, {
            method: "POST",
            body: { refresh_token: auth.refreshToken },
          })
          auth.setTokens(refreshed.access_token, refreshed.refresh_token, refreshed.user)
          const res = await $fetch<T>(`${base}${path}`, {
            ...fetchOpts,
            headers: { ...fetchOpts.headers, Authorization: `Bearer ${refreshed.access_token}` },
          })
          return unwrap<T>(res)
        } catch {
          auth.clear()
        }
      }
      throw err
    }
  }

  const get = <T,>(path: string) => request<T>(path)
  const post = <T,>(path: string, body?: unknown) => request<T>(path, { method: "POST", body })
  const patch = <T,>(path: string, body?: unknown) => request<T>(path, { method: "PATCH", body })
  const del = <T,>(path: string) => request<T>(path, { method: "DELETE" })

  return {
    /** Gateway service registry (backend_v2) — no auth required. */
    services: () =>
      $fetch<{
        gateway: string
        note: string
        services: {
          name: string
          port: number
          docs: string
          health: string
          openapi: string
          gateway_prefixes: string[]
        }[]
      }>(`${base}/services`),
    gatewayHealth: () => $fetch<{ ok?: boolean; status?: string }>(`${base}/gateway/health`),
    auth: {
      registrationStatus: () =>
        get<{ admin_exists: boolean; registration_open: boolean; email_verified: boolean; email?: string | null }>(
          "/api/v1/auth/admin/registration-status",
        ),
      register: (body: { name: string; phone: string; email: string; password: string }) =>
        post<{ message: string; email: string; email_sent: boolean; dev_code?: string | null }>(
          "/api/v1/auth/admin/register",
          body,
        ),
      confirmEmail: (email: string, code: string) =>
        post<{ message: string }>("/api/v1/auth/admin/confirm-email", { email, code }),
      resendConfirmation: (email: string) =>
        post<{ message: string; email_sent: boolean; dev_code?: string | null }>(
          "/api/v1/auth/admin/resend-confirmation",
          { email },
        ),
      login: (phoneOrEmail: string, password: string) => {
        const isEmail = phoneOrEmail.includes("@")
        return post<TokenPair>("/api/v1/auth/admin/login", {
          password,
          ...(isEmail ? { email: phoneOrEmail } : { phone: phoneOrEmail }),
        })
      },
      logout: (refresh_token?: string) => post("/api/v1/auth/logout", { refresh_token }),
      me: () => get("/api/v1/auth/me"),
    },
    admin: {
      dashboard: () => get<Record<string, unknown>>("/api/v1/admin/dashboard"),
      orders: (status?: string) => get<unknown[]>(`/api/v1/admin/orders${qs({ status })}`),
      order: (id: number) => get<Record<string, unknown>>(`/api/v1/admin/orders/${id}`),
      updateOrderStatus: (id: number, body: { status: string; note?: string; delivery_person_id?: number }) =>
        patch(`/api/v1/admin/orders/${id}/status`, body),
      assignDelivery: (id: number, delivery_person_id: number) =>
        post(`/api/v1/admin/orders/${id}/assign-delivery`, { delivery_person_id }),
      offerDelivery: (id: number, delivery_person_id: number) =>
        post(`/api/v1/admin/orders/${id}/offer-delivery`, { delivery_person_id }),
      createInvoice: (id: number) => post<Record<string, unknown>>(`/api/v1/admin/orders/${id}/invoice`, {}),
      paymentLink: (id: number) => post<Record<string, unknown>>(`/api/v1/admin/orders/${id}/payment-link`, {}),
      products: (q?: string, page = 1, category_id?: number, supplier_user_id?: number) =>
        get<unknown>(`/api/v1/admin/products${qs({ q, page, category_id, supplier_user_id })}`),
      createProduct: (body: Record<string, unknown>) => post("/api/v1/admin/products", body),
      updateProduct: (id: number, body: Record<string, unknown>) => patch(`/api/v1/admin/products/${id}`, body),
      deleteProduct: (id: number) => del(`/api/v1/admin/products/${id}`),
      duplicateProduct: (id: number) => post(`/api/v1/admin/products/${id}/duplicate`, {}),
      updateStock: (id: number, body: { stock_qty: number; reason?: string }) =>
        patch(`/api/v1/admin/products/${id}/stock`, body),
      units: () => get<{ code: string; label: string }[]>("/api/v1/admin/units"),
      categories: () => get<unknown[]>("/api/v1/admin/categories"),
      createCategory: (body: Record<string, unknown>) => post("/api/v1/admin/categories", body),
      updateCategory: (id: number, body: Record<string, unknown>) => patch(`/api/v1/admin/categories/${id}`, body),
      deleteCategory: (id: number) => del(`/api/v1/admin/categories/${id}`),
      inventory: () => get<unknown>("/api/v1/admin/inventory"),
      deliveryPersons: () => get<unknown[]>("/api/v1/admin/delivery/persons"),
      addRider: (body: Record<string, unknown>) => post("/api/v1/admin/delivery/persons", body),
      patchRider: (id: number, body: Record<string, unknown>) =>
        patch(`/api/v1/admin/delivery/persons/${id}`, body),
      liveDelivery: () => get<unknown>("/api/v1/admin/delivery/live"),
      payments: () => get<unknown[]>("/api/v1/admin/payments"),
      refundPayment: (id: number, body: Record<string, unknown> = {}) =>
        post(`/api/v1/admin/payments/${id}/refund`, body),
      shops: () => get<unknown[]>("/api/v1/admin/shops"),
      createShop: (body: Record<string, unknown>) => post("/api/v1/admin/shops", body),
      patchShop: (id: number, body: Record<string, unknown>) => patch(`/api/v1/admin/shops/${id}`, body),
      approveShop: (id: number, body: Record<string, unknown> = {}) =>
        post(`/api/v1/admin/shops/${id}/approve`, body),
      rejectShop: (id: number) => post(`/api/v1/admin/shops/${id}/reject`, {}),
      setSellSubscription: (id: number, status: string) =>
        post(`/api/v1/admin/shops/${id}/sell-subscription`, { status }),
      shopLedger: (id: number) => get<unknown[]>(`/api/v1/admin/shops/${id}/ledger`),
      shopAccount: (id: number) => get<Record<string, unknown>>(`/api/v1/admin/shops/${id}/account`),
      shopCatalog: (id: number) =>
        get<{
          products?: Record<string, unknown>[]
          banners?: Record<string, unknown>[]
          coupons?: Record<string, unknown>[]
          sales?: Record<string, unknown>[]
          counts?: Record<string, number>
          shop_name?: string
        }>(`/api/v1/admin/shops/${id}/catalog`),
      shopBannerActive: (shopId: number, bannerId: number, is_active: boolean) =>
        patch(`/api/v1/admin/shops/${shopId}/banners/${bannerId}`, { is_active }),
      shopCouponActive: (shopId: number, couponId: number, is_active: boolean) =>
        patch(`/api/v1/admin/shops/${shopId}/coupons/${couponId}`, { is_active }),
      shopCollect: (id: number, body: { amount: number; note?: string; method?: string }) =>
        post(`/api/v1/admin/shops/${id}/collect`, body),
      purchases: (supplier_user_id?: number) =>
        get<unknown[]>(`/api/v1/admin/purchases${qs({ supplier_user_id })}`),
      createPurchase: (body: Record<string, unknown>) => post("/api/v1/admin/purchases", body),
      payPurchase: (id: number, body: Record<string, unknown> = {}) =>
        post(`/api/v1/admin/purchases/${id}/pay`, body),
      createPurchaseRazorpay: (id: number, body: { amount?: number } = {}) =>
        post<Record<string, unknown>>(`/api/v1/admin/purchases/${id}/razorpay/create`, body),
      verifyPurchaseRazorpay: (
        id: number,
        body: {
          razorpay_order_id: string
          razorpay_payment_id: string
          razorpay_signature: string
          amount?: number
        },
      ) => post<Record<string, unknown>>(`/api/v1/admin/purchases/${id}/razorpay/verify`, body),
      customers: () => get<unknown[]>("/api/v1/admin/customers"),
      reports: (period = "weekly") => get<unknown>(`/api/v1/admin/reports${qs({ period })}`),
      settings: () => get<Record<string, unknown>>("/api/v1/admin/settings"),
      updateSettings: (body: Record<string, unknown>) => patch("/api/v1/admin/settings", body),
      integrationsCheck: () =>
        get<{ razorpay: Record<string, unknown>; imagekit: Record<string, unknown> }>(
          "/api/v1/admin/integrations/check"
        ),
      coupons: () => get<unknown[]>("/api/v1/admin/coupons"),
      createCoupon: (body: Record<string, unknown>) => post("/api/v1/admin/coupons", body),
      notifications: () => get<unknown[]>("/api/v1/admin/notifications"),
      markNotificationRead: (id?: number) =>
        post(`/api/v1/admin/notifications/read${id != null ? qs({ notification_id: id }) : ""}`, {}),
      returns: () => get<unknown[]>("/api/v1/admin/returns"),
      updateReturn: (id: number, body: Record<string, unknown>) => patch(`/api/v1/admin/returns/${id}`, body),
      tickets: () => get<unknown[]>("/api/v1/admin/tickets"),
      banners: () => get<unknown[]>("/api/v1/admin/banners"),
      createBanner: (body: Record<string, unknown>) => post("/api/v1/admin/banners", body),
      chats: () => get<unknown[]>("/api/v1/admin/chats"),
      chatMessages: (id: number) => get<unknown[]>(`/api/v1/admin/chats/${id}/messages`),
      sendChatMessage: (id: number, body: Record<string, unknown>) =>
        post(`/api/v1/admin/chats/${id}/messages`, body),
      takeoverChat: (id: number) => post(`/api/v1/admin/chats/${id}/takeover`, {}),
      chatbotFaqs: () => get<unknown[]>("/api/v1/admin/chatbot/faqs"),
      createFaq: (body: Record<string, unknown>) => post("/api/v1/admin/chatbot/faqs", body),
      updateFaq: (id: number, body: Record<string, unknown>) =>
        patch(`/api/v1/admin/chatbot/faqs/${id}`, body),
      deleteFaq: (id: number) => del(`/api/v1/admin/chatbot/faqs/${id}`),
      chatbotAnalytics: () => get<Record<string, unknown>>("/api/v1/admin/chatbot/analytics"),
      chatbotRuns: (limit = 40) => get<unknown[]>(`/api/v1/admin/chatbot/runs${qs({ limit })}`),

      // Assortment (ok-wrapped; request() unwraps)
      assortmentProducts: (params?: { q?: string; active?: boolean; draft?: boolean; page?: number }) =>
        get<{ items: Record<string, unknown>[]; total: number; page: number }>(
          `/api/v1/admin/assortment/products${qs({
            q: params?.q,
            active: params?.active == null ? undefined : String(params.active),
            draft: params?.draft == null ? undefined : String(params.draft),
            page: params?.page ?? 1,
          })}`,
        ),
      assortmentAvailable: () => get<Record<string, unknown>[]>("/api/v1/admin/assortment/available"),
      patchAssortment: (id: number, body: Record<string, unknown>) =>
        patch(`/api/v1/admin/assortment/products/${id}`, body),

      // Pricing
      pricingProducts: (page = 1, page_size = 50) =>
        get<{ items: Record<string, unknown>[]; total: number; page: number }>(
          `/api/v1/admin/pricing/products${qs({ page, page_size })}`,
        ),
      pricingProduct: (id: number) => get<Record<string, unknown>>(`/api/v1/admin/pricing/products/${id}`),
      patchPricing: (id: number, body: Record<string, unknown>) =>
        patch(`/api/v1/admin/pricing/products/${id}`, body),

      // Picking
      pickingQueue: (status?: string) =>
        get<{ items: Record<string, unknown>[]; total: number }>(
          `/api/v1/admin/picking/queue${qs({ status })}`,
        ),
      pickingOrder: (id: number) => get<Record<string, unknown>>(`/api/v1/admin/picking/orders/${id}`),
      pickingStart: (id: number) => post(`/api/v1/admin/picking/orders/${id}/start`, {}),
      pickingPack: (id: number) => post(`/api/v1/admin/picking/orders/${id}/pack`, {}),
      pickingStats: () => get<Record<string, number>>("/api/v1/admin/picking/stats"),

      // Routing
      routingLive: () => get<unknown[]>("/api/v1/admin/routing/live"),
      routingStops: () => get<Record<string, unknown>[]>("/api/v1/admin/routing/stops"),
      routingOptimize: (order_ids?: number[]) =>
        post<{ route: Record<string, unknown>[]; total_km: number; stops: number }>(
          "/api/v1/admin/routing/optimize",
          { order_ids: order_ids ?? null },
        ),
      routingEta: (order_id: number) =>
        get<Record<string, unknown>>(`/api/v1/admin/routing/orders/${order_id}/eta`),
      routingAssign: (order_id: number, delivery_person_id: number) =>
        post("/api/v1/admin/routing/assign", { order_id, delivery_person_id }),

      // Forecast
      forecastDemand: (period = "weekly") =>
        get<Record<string, unknown>>(`/api/v1/admin/forecast/demand${qs({ period })}`),
      forecastStockout: (period = "weekly") =>
        get<Record<string, unknown>>(`/api/v1/admin/forecast/stockout${qs({ period })}`),
      forecastRevenue: (period = "weekly") =>
        get<Record<string, unknown>>(`/api/v1/admin/forecast/revenue${qs({ period })}`),
      forecastSku: (product_id: number, period = "weekly") =>
        get<Record<string, unknown>>(`/api/v1/admin/forecast/sku/${product_id}${qs({ period })}`),

      // AI extras
      aiInsights: async (use_llm = false) =>
        get<{ insights: unknown }>(`/api/v1/admin/insights${qs({ use_llm: use_llm ? 1 : 0 })}`),
      aiCouponSuggest: () => get<Record<string, unknown>>("/api/v1/admin/coupons/ai-suggest"),
      aiReturnAssess: (body: {
        issue_type: string
        evidence_urls?: string[]
        description?: string
      }) => post<Record<string, unknown>>("/api/v1/admin/returns/ai-assess", body),
      aiCategoryImage: (name: string) =>
        post<Record<string, unknown>>("/api/v1/admin/categories/ai-image", { name }),
      aiProductUpload: (body: { image_urls: string[]; notes?: string }) =>
        post<Record<string, unknown>>("/api/v1/admin/products/ai-upload", body),
      aiOutboundCall: (body: { user_id?: number; phone?: string; purpose?: string }) =>
        post<Record<string, unknown>>("/api/v1/admin/calls/ai-outbound", body),
    },
  }
}

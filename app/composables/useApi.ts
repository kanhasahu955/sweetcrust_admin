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

/** One refresh at a time — parallel 401s were rotating the refresh token and wiping the session. */
let refreshInFlight: Promise<string | null> | null = null

export function useApi() {
  const config = useRuntimeConfig()
  const auth = useAuthStore()
  const base = String(config.public.apiBase).replace(/\/$/, "")

  async function refreshAccess(): Promise<string | null> {
    if (!auth.refreshToken) return null
    if (!refreshInFlight) {
      const usedRefresh = auth.refreshToken
      refreshInFlight = (async () => {
        try {
          const raw = await $fetch<unknown>(`${base}/api/v1/auth/refresh`, {
            method: "POST",
            body: { refresh_token: usedRefresh },
          })
          const pair = unwrap<TokenPair>(raw)
          if (!pair?.access_token || !pair?.refresh_token) return null
          auth.setTokens(pair.access_token, pair.refresh_token, pair.user)
          return pair.access_token
        } catch {
          return null
        } finally {
          refreshInFlight = null
        }
      })()
    }
    return refreshInFlight
  }

  async function request<T>(
    path: string,
    opts: { method?: "GET" | "POST" | "PATCH" | "DELETE"; body?: unknown; auth?: boolean } = {},
  ): Promise<T> {
    const headers: Record<string, string> = { "Content-Type": "application/json" }
    if (opts.auth !== false && auth.accessToken) headers.Authorization = `Bearer ${auth.accessToken}`

    // Admin lists must never reuse a cached GET after create/update/delete.
    // Keep headers CORS-simple (no Cache-Control/Pragma) so browsers skip brittle preflights.
    // Hard timeout so a hung microservice can't freeze every page for 60s+.
    const fetchOpts = {
      method: opts.method || "GET",
      body: opts.body as Record<string, unknown> | undefined,
      headers,
      cache: "no-store" as RequestCache,
      timeout: 12_000,
    }

    try {
      const res = await $fetch<T>(`${base}${path}`, fetchOpts)
      // store-ops + domain services wrap with { success, data }
      return unwrap<T>(res)
    } catch (err: unknown) {
      const status = (err as { statusCode?: number; status?: number })?.statusCode
        || (err as { status?: number })?.status
      if (status === 401 && opts.auth !== false && auth.refreshToken && !path.includes("/auth/")) {
        const access = await refreshAccess()
        if (access) {
          const res = await $fetch<T>(`${base}${path}`, {
            ...fetchOpts,
            headers: { ...fetchOpts.headers, Authorization: `Bearer ${access}` },
          })
          return unwrap<T>(res)
        }
        auth.clear()
        if (import.meta.client) void navigateTo("/login")
      }
      throw err
    }
  }

  const get = <T,>(path: string) => request<T>(path)
  const post = <T,>(path: string, body?: unknown) => request<T>(path, { method: "POST", body })
  const patch = <T,>(path: string, body?: unknown) => request<T>(path, { method: "PATCH", body })
  const del = <T,>(path: string) => request<T>(path, { method: "DELETE" })

  async function uploadFile(file: File, purpose = "product", folder = "sweetcrust") {
    const fd = new FormData()
    fd.append("file", file)
    fd.append("folder", folder)
    fd.append("purpose", purpose)
    const headers: Record<string, string> = {}
    if (auth.accessToken) headers.Authorization = `Bearer ${auth.accessToken}`
    const res = await $fetch<unknown>(`${base}/api/v1/uploads`, {
      method: "POST",
      body: fd,
      headers,
    })
    return unwrap<{ url?: string; provider?: string }>(res)
  }

  return {
    /** Gateway service registry (backend_v2) — no auth required. */
    services: () =>
      $fetch<{
        gateway: string
        socket?: string | null
        note: string
        probed_at?: string
        stats?: {
          total: number
          up: number
          down: number
          avg_ms: number | null
          admin?: number
          customer?: number
        }
        services: {
          name: string
          port: number
          group?: string
          admin_use?: string
          docs?: string
          health?: string
          openapi?: string
          upstream?: string
          gateway_prefixes: string[]
          ok?: boolean
          detail?: string
          ms?: number
        }[]
      }>(`${base}/services`),
    serviceProbe: (name: string) =>
      $fetch<{
        name: string
        port: number
        ok?: boolean
        detail?: string
        ms?: number
        health?: string
        gateway_prefixes: string[]
        admin_use?: string
        group?: string
      }>(`${base}/services/${encodeURIComponent(name)}`),
    gatewayHealth: () => $fetch<{ ok?: boolean; status?: string }>(`${base}/gateway/health`),
    uploadFile,
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
        return request<TokenPair>("/api/v1/auth/admin/login", {
          method: "POST",
          auth: false,
          body: {
            password,
            ...(isEmail ? { email: phoneOrEmail } : { phone: phoneOrEmail }),
          },
        })
      },
      logout: (refresh_token?: string) =>
        request("/api/v1/auth/logout", { method: "POST", body: { refresh_token } }),
      me: () =>
        get<{
          id: number
          phone: string
          name?: string | null
          email?: string | null
          role: string
          language?: string | null
          avatar_url?: string | null
          email_verified?: boolean
        }>("/api/v1/auth/me"),
      updateMe: (body: { name?: string; email?: string; language?: string; avatar_url?: string }) =>
        patch<{
          id: number
          phone: string
          name?: string | null
          email?: string | null
          role: string
          language?: string | null
          avatar_url?: string | null
        }>("/api/v1/auth/me", body),
      changePassword: (body: { current_password: string; new_password: string }) =>
        post<{ message?: string }>("/api/v1/auth/change-password", body),
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
      invoices: () =>
        get<{
          items?: unknown[]
          needs_invoice?: unknown[]
          bakery?: Record<string, string>
          stats?: Record<string, number>
        }>("/api/v1/admin/invoices"),
      invoice: (id: number) => get<Record<string, unknown>>(`/api/v1/admin/invoices/${id}`),
      paymentLink: (id: number) => post<Record<string, unknown>>(`/api/v1/admin/orders/${id}/payment-link`, {}),
      products: (
        q?: string,
        page = 1,
        category_id?: number,
        supplier_user_id?: number,
        page_size = 50,
      ) =>
        get<{ items?: unknown[]; total?: number; page?: number } | unknown[]>(
          `/api/v1/admin/products${qs({ q, page, category_id, supplier_user_id, page_size })}`,
        ),
      createProduct: (body: Record<string, unknown>) => post("/api/v1/admin/products", body),
      product: (id: number) => get<Record<string, unknown>>(`/api/v1/admin/products/${id}`),
      updateProduct: (id: number, body: Record<string, unknown>) => patch(`/api/v1/admin/products/${id}`, body),
      deleteProduct: (id: number) => del(`/api/v1/admin/products/${id}`),
      duplicateProduct: (id: number) => post(`/api/v1/admin/products/${id}/duplicate`, {}),
      updateStock: (id: number, body: { stock_qty: number; reason?: string; note?: string }) =>
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
      payments: () =>
        get<
          | unknown[]
          | {
              items?: unknown[]
              owing?: unknown[]
              collections?: unknown[]
              stats?: Record<string, number>
            }
        >("/api/v1/admin/payments"),
      refundPayment: (id: number, body: { amount?: number } = {}) =>
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
      purchase: (id: number) => get<Record<string, unknown>>(`/api/v1/admin/purchases/${id}`),
      createPurchase: (body: Record<string, unknown>) => post("/api/v1/admin/purchases", body),
      receivePurchase: (id: number) => post(`/api/v1/admin/purchases/${id}/receive`, {}),
      rejectPurchase: (id: number, body: { note?: string } = {}) =>
        post(`/api/v1/admin/purchases/${id}/reject`, body),
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
      customers: () =>
        get<
          | unknown[]
          | {
              items?: unknown[]
              stats?: Record<string, number>
            }
        >("/api/v1/admin/customers"),
      customer: (id: number) => get<Record<string, unknown>>(`/api/v1/admin/customers/${id}`),
      patchCustomer: (id: number, body: Record<string, unknown>) =>
        patch(`/api/v1/admin/customers/${id}`, body),
      reports: (period = "weekly") =>
        get<{
          period?: string
          days?: number
          series?: unknown[]
          stack?: unknown[]
          product_sales?: unknown[]
          by_rider?: unknown[]
          by_retailer?: unknown[]
          by_customer?: unknown[]
          stats?: Record<string, number>
          [key: string]: unknown
        }>(`/api/v1/admin/reports${qs({ period })}`),
      aiProfitSuggest: (period = "weekly") =>
        post<Record<string, unknown>>(`/api/v1/admin/reports/ai-suggest${qs({ period })}`, {}),
      settings: () => get<Record<string, unknown>>("/api/v1/admin/settings"),
      updateSettings: (body: Record<string, unknown>) => patch("/api/v1/admin/settings", body),
      integrationsCheck: () =>
        get<{ razorpay: Record<string, unknown>; imagekit: Record<string, unknown> }>(
          "/api/v1/admin/integrations/check"
        ),
      coupons: () =>
        get<
          | unknown[]
          | {
              items?: unknown[]
              stats?: Record<string, number>
            }
        >("/api/v1/admin/coupons"),
      createCoupon: (body: Record<string, unknown>) =>
        post<Record<string, unknown>>("/api/v1/admin/coupons", body),
      patchCoupon: (id: number, body: Record<string, unknown>) =>
        patch<Record<string, unknown>>(`/api/v1/admin/coupons/${id}`, body),
      deleteCoupon: (id: number) => del(`/api/v1/admin/coupons/${id}`),
      notifications: () =>
        get<
          | unknown[]
          | {
              items?: unknown[]
              stats?: Record<string, number>
            }
        >("/api/v1/admin/notifications"),
      markNotificationRead: (id?: number) =>
        post<{ ok?: boolean, count?: number }>(
          `/api/v1/admin/notifications/read${id != null ? qs({ notification_id: id }) : ""}`,
          {},
        ),
      deleteNotification: (id: number) => del<{ ok?: boolean }>(`/api/v1/admin/notifications/${id}`),
      returns: () =>
        get<
          | unknown[]
          | {
              items?: unknown[]
              stats?: Record<string, number>
            }
        >("/api/v1/admin/returns"),
      return: (id: number) => get<Record<string, unknown>>(`/api/v1/admin/returns/${id}`),
      updateReturn: (id: number, body: Record<string, unknown>) =>
        patch<Record<string, unknown>>(`/api/v1/admin/returns/${id}`, body),
      tickets: () =>
        get<
          | unknown[]
          | {
              items?: unknown[]
              stats?: Record<string, number>
            }
        >("/api/v1/admin/tickets"),
      ticket: (id: number) => get<Record<string, unknown>>(`/api/v1/admin/tickets/${id}`),
      createTicket: (body: Record<string, unknown>) =>
        post<Record<string, unknown>>("/api/v1/admin/tickets", body),
      patchTicket: (id: number, body: Record<string, unknown>) =>
        patch<Record<string, unknown>>(`/api/v1/admin/tickets/${id}`, body),
      banners: () =>
        get<
          | unknown[]
          | {
              items?: unknown[]
              stats?: Record<string, number>
            }
        >("/api/v1/admin/banners"),
      createBanner: (body: Record<string, unknown>) =>
        post<Record<string, unknown>>("/api/v1/admin/banners", body),
      patchBanner: (id: number, body: Record<string, unknown>) =>
        patch<Record<string, unknown>>(`/api/v1/admin/banners/${id}`, body),
      deleteBanner: (id: number) => del(`/api/v1/admin/banners/${id}`),
      aiBannerSuggest: () => post<Record<string, unknown>>("/api/v1/admin/banners/ai-suggest", {}),
      chats: () => get<unknown[]>("/api/v1/admin/chats"),
      chatMessages: (id: number) => get<unknown[]>(`/api/v1/admin/chats/${id}/messages`),
      sendChatMessage: (id: number, body: Record<string, unknown>) =>
        post(`/api/v1/admin/chats/${id}/messages`, body),
      takeoverChat: (id: number) => post(`/api/v1/admin/chats/${id}/takeover`, {}),
      releaseChatToAi: (id: number) => post(`/api/v1/admin/chats/${id}/release-ai`, {}),
      chatbot: () =>
        get<{
          faqs?: Record<string, unknown>[]
          stats?: Record<string, number | Record<string, number>>
          stack?: Record<string, unknown>
          monitor?: Record<string, unknown>
          recent_runs?: Record<string, unknown>[]
        }>("/api/v1/admin/chatbot"),
      chatbotFaqs: () => get<unknown[]>("/api/v1/admin/chatbot/faqs"),
      createFaq: (body: Record<string, unknown>) =>
        post<Record<string, unknown>>("/api/v1/admin/chatbot/faqs", body),
      updateFaq: (id: number, body: Record<string, unknown>) =>
        patch<Record<string, unknown>>(`/api/v1/admin/chatbot/faqs/${id}`, body),
      deleteFaq: (id: number) => del(`/api/v1/admin/chatbot/faqs/${id}`),
      chatbotPreview: (query: string) =>
        post<{ query?: string; matches?: Record<string, unknown>[] }>("/api/v1/admin/chatbot/preview", {
          query,
        }),
      chatbotAnalytics: () => get<Record<string, unknown>>("/api/v1/admin/chatbot/analytics"),
      chatbotRuns: (limit = 40) => get<unknown[]>(`/api/v1/admin/chatbot/runs${qs({ limit })}`),

      // Assortment (ok-wrapped; request() unwraps)
      assortmentProducts: (params?: {
        q?: string
        active?: boolean
        draft?: boolean
        flag?: string
        page?: number
        page_size?: number
      }) =>
        get<{
          items: Record<string, unknown>[]
          total: number
          page: number
          stats?: Record<string, number>
        }>(
          `/api/v1/admin/assortment/products${qs({
            q: params?.q,
            active: params?.active == null ? undefined : String(params.active),
            draft: params?.draft == null ? undefined : String(params.draft),
            flag: params?.flag,
            page: params?.page ?? 1,
            page_size: params?.page_size ?? 48,
          })}`,
        ),
      assortmentAvailable: () => get<Record<string, unknown>[]>("/api/v1/admin/assortment/available"),
      patchAssortment: (id: number, body: Record<string, unknown>) =>
        patch(`/api/v1/admin/assortment/products/${id}`, body),

      // Pricing
      pricingProducts: (params?: {
        page?: number
        page_size?: number
        q?: string
        supplier_user_id?: number
        flag?: string
      }) =>
        get<{
          items: Record<string, unknown>[]
          total: number
          page: number
          stats?: Record<string, number>
        }>(
          `/api/v1/admin/pricing/products${qs({
            page: params?.page ?? 1,
            page_size: params?.page_size ?? 48,
            q: params?.q,
            supplier_user_id: params?.supplier_user_id,
            flag: params?.flag,
          })}`,
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
      forecast: (period = "weekly") =>
        get<{
          period?: string
          days?: number
          stats?: Record<string, number | string | null>
          series?: Record<string, unknown>[]
          top_skus?: Record<string, unknown>[]
          at_risk?: Record<string, unknown>[]
          catalog?: Record<string, unknown>[]
          note?: string
        }>(`/api/v1/admin/forecast${qs({ period })}`),
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
      aiCouponSuggest: () => post<Record<string, unknown>>("/api/v1/admin/coupons/ai-suggest", {}),
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
    geo: {
      suggest: (q: string, limit = 6, session_token?: string) =>
        get<Record<string, unknown>[]>(`/api/v1/geo/suggest${qs({ q, limit, session_token })}`),
      place: (place_id: string, session_token?: string) =>
        get<Record<string, unknown>>(`/api/v1/geo/place/${encodeURIComponent(place_id)}${qs({ session_token })}`),
      reverse: (lat: number, lng: number) =>
        get<Record<string, unknown>>(`/api/v1/geo/reverse${qs({ lat, lng })}`),
      nearby: (lat: number, lng: number, radius_m = 30000, limit = 60) =>
        get<Record<string, unknown>[]>(`/api/v1/geo/nearby${qs({ lat, lng, radius_m, limit })}`),
      pincode: (pin: string) => get<Record<string, unknown>>(`/api/v1/geo/pincode/${encodeURIComponent(pin)}`),
    },
  }
}

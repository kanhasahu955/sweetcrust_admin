/**
 * Keep admin console live: Redis → realtime → socket events.
 * Global toast + pending bump + chat unread + dashboard invalidation + activity feed.
 */
import { useAppToast } from "~/composables/useAppToast"
import { useAdminChatUnread } from "~/composables/useAdminChatUnread"
import type { AdminNotifyPrefs } from "~/composables/useAdminNotifyPrefs"

export type AdminActivityItem = {
  id: string
  kind: string
  title: string
  body: string
  at: number
}

const ACTIVITY_LABELS: Record<string, string> = {
  shop_submitted: "Shop KYC submitted",
  shop_approved: "Shop approved",
  shop_rejected: "Shop rejected",
  po_created: "Purchase order created",
  po_paid: "Supplier payment recorded",
  order_paid: "Order payment received",
  shop_collection: "Udhaar collection",
  chat_unread: "Unread chat",
  delivery_accepted: "Delivery accepted",
  delivery_started: "Out for delivery",
  delivery_completed: "Delivery completed",
  order_status: "Order status",
  delivery_location: "Rider location",
  low_stock: "Low stock alert",
}

function titleFor(kind: string) {
  if (ACTIVITY_LABELS[kind]) return ACTIVITY_LABELS[kind]
  return kind.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

export default defineNuxtPlugin(() => {
  const auth = useAuthStore()
  const toast = useAppToast()
  const api = useApi()
  const { allows, setPrefs } = useAdminNotifyPrefs()
  const { refresh: refreshNotifs } = useAdminNotifications()
  const pendingBump = useState("adminShopPendingBump", () => 0)
  const lastPoBump = useState("adminPoBump", () => 0)
  const dashboardBump = useState("adminDashboardBump", () => 0)
  const socketLive = useState("adminSocketLive", () => false)
  const activityFeed = useState<AdminActivityItem[]>("adminActivityFeed", () => [])
  const { total: chatUnread, refreshChatUnread } = useAdminChatUnread()
  const { connect } = useSocket()

  async function hydrateNotifyPrefs() {
    try {
      const s = (await api.admin.settings()) as { notification_prefs?: Record<string, unknown> }
      if (s?.notification_prefs) setPrefs(s.notification_prefs as Partial<AdminNotifyPrefs>)
    } catch {
      /* keep defaults */
    }
  }

  function pushActivity(kind: string, title: string, body: string) {
    activityFeed.value = [
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        kind,
        title,
        body,
        at: Date.now(),
      },
      ...activityFeed.value,
    ].slice(0, 50)
  }

  function bumpDashboard() {
    dashboardBump.value += 1
  }

  function bind() {
    auth.hydrate()
    if (!auth.accessToken) return
    void refreshChatUnread()
    void hydrateNotifyPrefs()
    const s = connect()
    if (!s) return

    socketLive.value = s.connected

    if ((s as { __adminEventsBound?: boolean }).__adminEventsBound) return
    ;(s as { __adminEventsBound?: boolean }).__adminEventsBound = true

    s.on("connect", () => {
      socketLive.value = true
      void refreshChatUnread()
      bumpDashboard()
    })

    s.on("disconnect", () => {
      socketLive.value = false
    })

    s.on("admin_event", (data: Record<string, unknown>) => {
      const kind = String(data?.kind || "")
      bumpDashboard()
      if (
        kind.includes("notification")
        || kind.includes("order")
        || kind.includes("chat")
        || kind.includes("payment")
        || kind.includes("return")
        || kind.includes("ticket")
        || kind === "low_stock"
      ) {
        void refreshNotifs({ quiet: true })
      }

      if (kind === "shop_submitted") {
        pendingBump.value += 1
        const name = String(data.shop_name || "Shop")
        if (allows("orders")) toast.info("Approval request", `${name} — open Shops`)
        pushActivity(kind, titleFor(kind), name)
      } else if (kind === "shop_approved" || kind === "shop_rejected") {
        pendingBump.value += 1
        pushActivity(kind, titleFor(kind), String(data.shop_name || "Shop"))
      } else if (kind === "po_created") {
        lastPoBump.value += 1
        pushActivity(kind, titleFor(kind), `PO #${data.purchase_id || "—"}`)
      } else if (kind === "po_paid") {
        lastPoBump.value += 1
        if (allows("payments")) toast.success("Supplier paid", `PO #${data.purchase_id || "—"}`)
        pushActivity(kind, titleFor(kind), `PO #${data.purchase_id || "—"} · ${data.method || "pay"}`)
      } else if (kind === "order_paid") {
        const label = String(data.order_number || `Order #${data.order_id || "—"}`)
        if (allows("payments")) toast.success("Payment received", label)
        pushActivity(kind, titleFor(kind), label)
      } else if (kind === "low_stock") {
        const name = String(data.name || "Product")
        const qty = data.stock_qty ?? "—"
        const thr = data.low_stock_threshold ?? "—"
        const out = String(data.stock_status || "") === "out_of_stock"
        const body = `${name} · ${qty} left (alert ≤ ${thr})`
        if (allows("orders")) {
          if (out) toast.error("Out of stock", body)
          else toast.info("Low stock", body)
        }
        pushActivity(kind, out ? "Out of stock" : titleFor(kind), body)
      } else if (kind === "shop_collection") {
        if (allows("payments")) toast.success("Collection recorded", "Receivable updated")
        pushActivity(kind, titleFor(kind), "Shop receivable updated")
      } else if (kind === "chat_unread") {
        if (typeof data.total_unread === "number") {
          chatUnread.value = Math.max(0, Number(data.total_unread) || 0)
        } else {
          void refreshChatUnread()
        }
        pushActivity(kind, titleFor(kind), `${data.total_unread ?? "—"} unread`)
      } else if (kind === "ticket_created" || kind === "ticket_updated") {
        if (allows("tickets")) toast.info(titleFor(kind), String(data.subject || data.ticket_id || "Ticket"))
        pushActivity(kind, titleFor(kind), String(data.subject || data.ticket_id || "Ticket"))
      } else if (kind === "return_created" || kind === "return_updated") {
        if (allows("returns")) toast.info(titleFor(kind), String(data.order_id || data.return_id || "Return"))
        pushActivity(kind, titleFor(kind), String(data.order_id || data.return_id || "Return"))
      } else if (kind) {
        const orderRef = data.order_id != null ? `Order #${data.order_id}` : ""
        const shopRef = data.shop_name ? String(data.shop_name) : ""
        pushActivity(kind, titleFor(kind), [orderRef, shopRef].filter(Boolean).join(" · ") || "Update")
      }
    })

    s.on("order_status", (data: Record<string, unknown>) => {
      bumpDashboard()
      const id = data.order_id ?? data.id
      const status = String(data.status || data.order_status || "updated")
      pushActivity(
        "order_status",
        titleFor("order_status"),
        id != null ? `#${id} → ${status.replace(/_/g, " ")}` : status.replace(/_/g, " "),
      )
    })

    // GPS pings are frequent — refresh KPIs, skip activity spam
    let locTimer: ReturnType<typeof setTimeout> | null = null
    s.on("delivery_location", () => {
      if (locTimer) return
      locTimer = setTimeout(() => {
        locTimer = null
        bumpDashboard()
      }, 4000)
    })

    s.on("chat_message", () => {
      void refreshChatUnread()
      bumpDashboard()
    })
  }

  watch(
    () => auth.accessToken,
    (token) => {
      if (token) bind()
      else socketLive.value = false
    },
    { immediate: true },
  )

  if (import.meta.client) {
    let focusTimer: ReturnType<typeof setTimeout> | null = null
    window.addEventListener("focus", () => {
      if (!auth.accessToken) return
      // Avoid refetch storms when alt-tabbing / DevTools focus.
      if (focusTimer) return
      focusTimer = setTimeout(() => {
        focusTimer = null
        void refreshChatUnread()
        bumpDashboard()
      }, 1500)
    })
  }
})

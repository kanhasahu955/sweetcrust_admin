/**
 * Keep admin console live: Redis → realtime → socket `admin_event`.
 * Pages can also listen; this handles global toast + shared pending bump + chat unread.
 */
import { useAppToast } from "~/composables/useAppToast"
import { useAdminChatUnread } from "~/composables/useAdminChatUnread"

export default defineNuxtPlugin(() => {
  const auth = useAuthStore()
  const toast = useAppToast()
  const pendingBump = useState("adminShopPendingBump", () => 0)
  const lastPoBump = useState("adminPoBump", () => 0)
  const { total: chatUnread, refreshChatUnread } = useAdminChatUnread()
  const { connect } = useSocket()

  function bind() {
    auth.hydrate()
    if (!auth.accessToken) return
    void refreshChatUnread()
    const s = connect()
    if (!s || (s as { __adminEventsBound?: boolean }).__adminEventsBound) return
    ;(s as { __adminEventsBound?: boolean }).__adminEventsBound = true

    s.on("admin_event", (data: Record<string, unknown>) => {
      const kind = String(data?.kind || "")
      if (kind === "shop_submitted") {
        pendingBump.value += 1
        const name = String(data.shop_name || "Shop")
        toast.info("Approval request", `${name} is waiting — open Shops`)
      } else if (kind === "shop_approved" || kind === "shop_rejected") {
        pendingBump.value += 1
      } else if (kind === "po_created") {
        lastPoBump.value += 1
      } else if (kind === "po_paid") {
        lastPoBump.value += 1
        toast.success("Supplier paid", `PO #${data.purchase_id || ""} · ${data.method || "pay"}`)
      } else if (kind === "order_paid") {
        toast.success("Order paid (Razorpay)", String(data.order_number || `Order #${data.order_id || ""}`))
      } else if (kind === "shop_collection") {
        toast.success("Collection recorded", `Receivable updated`)
      } else if (kind === "chat_unread") {
        if (typeof data.total_unread === "number") {
          chatUnread.value = Math.max(0, Number(data.total_unread) || 0)
        } else {
          void refreshChatUnread()
        }
      }
    })

    s.on("chat_message", () => {
      void refreshChatUnread()
    })

    s.on("connect", () => {
      void refreshChatUnread()
    })
  }

  watch(
    () => auth.accessToken,
    (token) => {
      if (token) bind()
    },
    { immediate: true },
  )

  if (import.meta.client) {
    window.addEventListener("focus", () => {
      if (auth.accessToken) void refreshChatUnread()
    })
  }
})

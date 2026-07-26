import { apiError, relativeAgo } from "~/utils/format"

export type AdminNotification = {
  id: number
  type?: string
  title?: string
  body?: string
  message?: string
  is_read?: boolean
  created_at?: string | null
  link?: string | null
  order_id?: number | null
  order_number?: string | null
  conversation_id?: number | null
}

function parseHub(data: unknown): { items: AdminNotification[]; unread: number } {
  if (Array.isArray(data)) {
    const items = data as AdminNotification[]
    return { items, unread: items.filter((n) => !n.is_read).length }
  }
  const obj = (data || {}) as { items?: AdminNotification[]; stats?: { unread?: number } }
  const items = Array.isArray(obj.items) ? obj.items : []
  const unread = Number(obj.stats?.unread)
  return {
    items,
    unread: Number.isFinite(unread) ? unread : items.filter((n) => !n.is_read).length,
  }
}

export function useAdminNotifications() {
  const api = useApi()
  const toast = useAppToast()
  const items = useState<AdminNotification[]>("adminNotifItems", () => [])
  const unread = useState("adminNotifUnread", () => 0)
  const loaded = useState("adminNotifLoaded", () => false)
  const loading = useState("adminNotifLoading", () => false)
  const busyAll = useState("adminNotifBusyAll", () => false)

  async function refresh(opts?: { quiet?: boolean }) {
    if (!opts?.quiet) loading.value = true
    try {
      const hub = parseHub(await api.admin.notifications())
      items.value = hub.items.slice(0, 40)
      unread.value = hub.unread
      loaded.value = true
    } catch (e) {
      if (!opts?.quiet) toast.error(apiError(e))
    } finally {
      loading.value = false
    }
  }

  async function markOne(id: number) {
    try {
      await api.admin.markNotificationRead(id)
      items.value = items.value.map((n) => (n.id === id ? { ...n, is_read: true } : n))
      unread.value = items.value.filter((n) => !n.is_read).length
    } catch (e) {
      toast.error(apiError(e))
    }
  }

  async function markAll() {
    if (!unread.value) {
      toast.info("Nothing unread")
      return
    }
    busyAll.value = true
    try {
      const res = await api.admin.markNotificationRead()
      items.value = items.value.map((n) => ({ ...n, is_read: true }))
      unread.value = 0
      toast.success("All caught up", `${res.count ?? ""} marked read`)
    } catch (e) {
      toast.error(apiError(e))
    } finally {
      busyAll.value = false
    }
  }

  async function openOne(n: AdminNotification) {
    if (!n.is_read) await markOne(n.id)
    const link = String(n.link || "").trim()
    if (link) await navigateTo(link)
    else await navigateTo("/notifications")
  }

  function whenLabel(raw?: string | null) {
    return relativeAgo(raw || "")
  }

  return {
    items,
    unread,
    loaded,
    loading,
    busyAll,
    refresh,
    markOne,
    markAll,
    openOne,
    whenLabel,
  }
}

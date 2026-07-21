/** Shared topbar chat unread total — refreshed from GET /admin/chats. */
export function useAdminChatUnread() {
  const total = useState("adminChatUnreadTotal", () => 0)
  const api = useApi()

  async function refreshChatUnread() {
    try {
      const data = await api.admin.chats()
      const rows = Array.isArray(data) ? data : []
      total.value = rows.reduce((n, c) => n + (Number((c as { unread_admin?: number }).unread_admin) || 0), 0)
    } catch {
      /* ignore — keep last known */
    }
  }

  return { total, refreshChatUnread }
}

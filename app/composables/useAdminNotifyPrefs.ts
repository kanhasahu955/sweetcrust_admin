export type AdminNotifyPrefs = {
  orders: boolean
  chat: boolean
  tickets: boolean
  payments: boolean
  returns: boolean
  sound: boolean
}

const DEFAULTS: AdminNotifyPrefs = {
  orders: true,
  chat: true,
  tickets: true,
  payments: true,
  returns: true,
  sound: true,
}

export function useAdminNotifyPrefs() {
  const prefs = useState<AdminNotifyPrefs>("adminNotifyPrefs", () => ({ ...DEFAULTS }))

  function setPrefs(next: Partial<AdminNotifyPrefs>) {
    prefs.value = { ...DEFAULTS, ...prefs.value, ...next }
  }

  function allows(channel: keyof AdminNotifyPrefs) {
    return prefs.value[channel] !== false
  }

  return { prefs, setPrefs, allows, DEFAULTS }
}

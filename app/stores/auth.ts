import { defineStore } from "pinia"

type User = {
  id: number
  phone: string
  name?: string | null
  email?: string | null
  role: string
}

export const useAuthStore = defineStore("auth", {
  state: () => ({
    accessToken: "" as string,
    refreshToken: "" as string,
    user: null as User | null,
    hydrated: false,
  }),
  getters: {
    isLoggedIn: (s) => Boolean(s.accessToken),
  },
  actions: {
    hydrate() {
      if (!import.meta.client || this.hydrated) return
      this.accessToken = localStorage.getItem("sc_admin_access") || ""
      this.refreshToken = localStorage.getItem("sc_admin_refresh") || ""
      const raw = localStorage.getItem("sc_admin_user")
      this.user = raw ? (JSON.parse(raw) as User) : null
      this.hydrated = true
    },
    setTokens(access: string, refresh: string, user?: User | null) {
      this.accessToken = access
      this.refreshToken = refresh
      if (user) this.user = user
      if (import.meta.client) {
        localStorage.setItem("sc_admin_access", access)
        localStorage.setItem("sc_admin_refresh", refresh)
        if (user) localStorage.setItem("sc_admin_user", JSON.stringify(user))
      }
    },
    clear() {
      this.accessToken = ""
      this.refreshToken = ""
      this.user = null
      if (import.meta.client) {
        localStorage.removeItem("sc_admin_access")
        localStorage.removeItem("sc_admin_refresh")
        localStorage.removeItem("sc_admin_user")
      }
    },
  },
})

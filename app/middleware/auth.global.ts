export default defineNuxtRouteMiddleware((to) => {
  const auth = useAuthStore()
  if (import.meta.client) auth.hydrate()

  const publicPaths = ["/login"]
  const isPublic = publicPaths.includes(to.path)

  if (!auth.isLoggedIn && !isPublic) {
    return navigateTo("/login")
  }
  if (auth.isLoggedIn && to.path === "/login") {
    return navigateTo("/dashboard")
  }
})

/**
 * Toast helpers on top of Nuxt UI (`UApp` toaster).
 * Nuxt UI auto-imports `useToast` with only `.add()` — pages should use this instead.
 */
export function useAppToast() {
  // Nuxt UI's useToast (auto-imported) — not vue-sonner
  const ui = useToast()
  return {
    success: (title: string, description?: string) => {
      ui.add({ title, description, color: "success" })
    },
    error: (title: string, description?: string) => {
      ui.add({ title, description, color: "error" })
    },
    info: (title: string, description?: string) => {
      ui.add({ title, description, color: "info" })
    },
    message: (title: string) => {
      ui.add({ title })
    },
  }
}

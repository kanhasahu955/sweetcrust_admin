type ConfirmOpts = {
  title?: string
  message: string
  confirmText?: string
  cancelText?: string
  tone?: "danger" | "default"
}

type ConfirmState = ConfirmOpts & {
  open: boolean
  resolve: ((ok: boolean) => void) | null
}

const state = reactive<ConfirmState>({
  open: false,
  title: "Confirm",
  message: "",
  confirmText: "Confirm",
  cancelText: "Cancel",
  tone: "default",
  resolve: null,
})

/** Promise-based confirm — replaces window.confirm with Headless UI modal. */
export function useConfirm() {
  function confirm(opts: ConfirmOpts | string) {
    const o = typeof opts === "string" ? { message: opts } : opts
    return new Promise<boolean>((resolve) => {
      state.open = true
      state.title = o.title || "Confirm"
      state.message = o.message
      state.confirmText = o.confirmText || "Confirm"
      state.cancelText = o.cancelText || "Cancel"
      state.tone = o.tone || "default"
      state.resolve = resolve
    })
  }

  function answer(ok: boolean) {
    state.open = false
    state.resolve?.(ok)
    state.resolve = null
  }

  return { confirm, answer, state }
}

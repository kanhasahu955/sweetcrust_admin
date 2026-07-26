/** Load Razorpay Checkout.js and open a payment modal (SweetCrust theme). */

const BRAND = {
  color: "#e9748e",
  backdrop: "#FFF9F5",
  name: "SweetCrust",
  logoPath: "/brand/sweetcrust-logo.png",
} as const

type RazorpaySuccess = {
  razorpay_order_id: string
  razorpay_payment_id: string
  razorpay_signature: string
}

type RazorpayOptions = {
  key: string
  amount: number
  currency?: string
  name?: string
  description?: string
  image?: string
  order_id: string
  prefill?: { name?: string; contact?: string; email?: string }
  theme?: { color?: string; backdrop_color?: string; hide_topbar?: boolean }
  handler: (response: RazorpaySuccess) => void
  modal?: {
    ondismiss?: () => void
    backdropclose?: boolean
    escape?: boolean
    confirm_close?: boolean
  }
}

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => { open: () => void }
  }
}

let loading: Promise<void> | null = null

function loadScript(): Promise<void> {
  if (import.meta.server) return Promise.reject(new Error("Razorpay is client-only"))
  if (window.Razorpay) return Promise.resolve()
  if (loading) return loading
  loading = new Promise((resolve, reject) => {
    const el = document.createElement("script")
    el.src = "https://checkout.razorpay.com/v1/checkout.js"
    el.async = true
    el.onload = () => resolve()
    el.onerror = () => {
      loading = null
      reject(new Error("Failed to load Razorpay Checkout"))
    }
    document.head.appendChild(el)
  })
  return loading
}

function brandLogoUrl() {
  if (import.meta.server || typeof window === "undefined") return BRAND.logoPath
  return `${window.location.origin}${BRAND.logoPath}`
}

export function useRazorpayCheckout() {
  async function openCheckout(opts: {
    key_id: string
    razorpay_order_id: string
    amount_paise: number
    name?: string
    description?: string
    prefill?: { name?: string; contact?: string; email?: string }
  }): Promise<RazorpaySuccess> {
    await loadScript()
    if (!window.Razorpay) throw new Error("Razorpay unavailable")
    return new Promise((resolve, reject) => {
      const rzp = new window.Razorpay!({
        key: opts.key_id,
        amount: opts.amount_paise,
        currency: "INR",
        name: opts.name || BRAND.name,
        description: opts.description || "Payment",
        image: brandLogoUrl(),
        order_id: opts.razorpay_order_id,
        prefill: opts.prefill,
        theme: {
          color: BRAND.color,
          backdrop_color: BRAND.backdrop,
        },
        handler: (response) => resolve(response),
        modal: {
          ondismiss: () => reject(new Error("Payment cancelled")),
          backdropclose: false,
        },
      })
      rzp.open()
    })
  }

  return { openCheckout }
}

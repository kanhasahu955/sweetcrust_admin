/** Load Razorpay Checkout.js and open a payment modal. */

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
  order_id: string
  prefill?: { name?: string; contact?: string }
  handler: (response: RazorpaySuccess) => void
  modal?: { ondismiss?: () => void }
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

export function useRazorpayCheckout() {
  async function openCheckout(opts: {
    key_id: string
    razorpay_order_id: string
    amount_paise: number
    name?: string
    description?: string
  }): Promise<RazorpaySuccess> {
    await loadScript()
    if (!window.Razorpay) throw new Error("Razorpay unavailable")
    return new Promise((resolve, reject) => {
      const rzp = new window.Razorpay!({
        key: opts.key_id,
        amount: opts.amount_paise,
        currency: "INR",
        name: opts.name || "SweetCrust",
        description: opts.description || "Payment",
        order_id: opts.razorpay_order_id,
        handler: (response) => resolve(response),
        modal: {
          ondismiss: () => reject(new Error("Payment cancelled")),
        },
      })
      rzp.open()
    })
  }

  return { openCheckout }
}

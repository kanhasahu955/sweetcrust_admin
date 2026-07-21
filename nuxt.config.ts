import { defineNuxtConfig } from "nuxt/config"

export default defineNuxtConfig({
  compatibilityDate: "2025-07-15",
  // Never ship DevTools to production — can trigger "Not Secure" (ws:// mixed content).
  devtools: { enabled: process.env.NODE_ENV !== "production" },
  modules: ["@pinia/nuxt", "@nuxt/ui"],
  css: ["~/assets/css/main.css"],
  pinia: {
    storesDirs: ["./stores/**"],
  },
  runtimeConfig: {
    public: {
      apiBase: process.env.NUXT_PUBLIC_API_BASE || "http://127.0.0.1:8080",
      socketBase: process.env.NUXT_PUBLIC_SOCKET_BASE || "http://127.0.0.1:8081",
    },
  },
  colorMode: {
    preference: "light",
    fallback: "light",
    classSuffix: "",
  },
  fonts: {
    families: [
      { name: "DM Sans", provider: "google", weights: [400, 500, 600, 700], global: true },
      { name: "Fraunces", provider: "google", weights: [500, 600, 700] },
    ],
  },
  icon: {
    serverBundle: "local",
  },
  app: {
    head: {
      title: "SweetCrust Admin",
      meta: [{ name: "description", content: "Village shop supply — owner console" }],
      link: [
        {
          rel: "stylesheet",
          href: "https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&display=swap",
        },
      ],
    },
  },
  routeRules: {
    "/**": {
      headers: {
        "Content-Security-Policy": "upgrade-insecure-requests",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "strict-origin-when-cross-origin",
      },
    },
  },
  nitro: {
    // Behind nginx TLS termination
    experimental: {
      openAPI: false,
    },
  },
  devServer: { port: 3002 },
})

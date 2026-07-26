/** Load Google Maps JavaScript API once (Maps + Places). */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GMaps = { maps: any }

type GoogleMapsWindow = Window & {
  google?: GMaps
  __scGmapsReady?: Promise<GMaps>
  __scGmapsCb?: () => void
}

export function useGoogleMaps() {
  const config = useRuntimeConfig()
  const key = computed(() => String(config.public.googleMapsApiKey || "").trim())

  async function loadGoogleMaps(): Promise<GMaps> {
    if (import.meta.server) throw new Error("Google Maps is client-only")
    const w = window as GoogleMapsWindow
    if (w.google?.maps) return w.google
    if (!key.value) throw new Error("Missing NUXT_PUBLIC_GOOGLE_MAPS_API_KEY")
    if (!w.__scGmapsReady) {
      w.__scGmapsReady = new Promise((resolve, reject) => {
        const prev = w.__scGmapsCb
        w.__scGmapsCb = () => {
          try {
            prev?.()
          } catch {
            /* ignore */
          }
          if (w.google?.maps) resolve(w.google)
          else reject(new Error("Google Maps failed to load"))
        }
        const el = document.createElement("script")
        el.async = true
        el.defer = true
        el.src =
          `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key.value)}` +
          "&libraries=places&callback=__scGmapsCb&v=weekly"
        el.onerror = () => {
          w.__scGmapsReady = undefined
          reject(new Error("Failed to load Google Maps"))
        }
        document.head.appendChild(el)
      })
    }
    return w.__scGmapsReady
  }

  return { key, loadGoogleMaps }
}

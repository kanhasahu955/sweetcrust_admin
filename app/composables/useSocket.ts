import { io, type Socket } from "socket.io-client"
import { useAuthStore } from "../stores/auth"

let socket: Socket | null = null

export function useSocket() {
  const config = useRuntimeConfig()
  const auth = useAuthStore()
  const base = String(config.public.socketBase || config.public.apiBase).replace(/\/$/, "")

  function connect(): Socket | null {
    if (!import.meta.client) return null
    auth.hydrate()
    if (!auth.accessToken) return null
    if (socket?.connected) return socket
    if (socket) {
      socket.auth = { token: auth.accessToken }
      socket.connect()
      return socket
    }
    socket = io(base, {
      auth: { token: auth.accessToken },
      transports: ["websocket", "polling"],
      reconnection: true,
    })
    return socket
  }

  function joinChat(conversationId: number) {
    const s = connect()
    s?.emit("join_chat", { conversation_id: conversationId })
  }

  function joinOrder(orderId: number) {
    const s = connect()
    s?.emit("join_order", { order_id: orderId })
  }

  function emitTyping(conversationId: number, isTyping: boolean) {
    socket?.emit("typing", { conversation_id: conversationId, is_typing: isTyping })
  }

  function disconnect() {
    socket?.disconnect()
    socket = null
  }

  return { connect, joinChat, joinOrder, emitTyping, disconnect, get socket() { return socket } }
}

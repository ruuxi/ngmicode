import { Log } from "../util/log"
import { Storage } from "../storage/storage"
import { MessageV2 } from "./message-v2"

export namespace PartStore {
  const log = Log.create({ service: "part-store" })

  const DEBOUNCE_MS = 100

  interface MessageWithParts {
    info: MessageV2.Info
    parts: MessageV2.Part[]
  }

  // In-memory cache of parts by messageID
  const partsCache = new Map<string, MessageV2.Part[]>()

  // Pending flush timers by messageID
  const pendingFlush = new Map<string, Timer>()

  // Track dirty messages that need to be written
  const dirtyMessages = new Set<string>()

  // Message info cache for writes
  const messageInfoCache = new Map<string, MessageV2.Info>()

  function getCacheKey(sessionID: string, messageID: string) {
    return `${sessionID}:${messageID}`
  }

  export function cacheMessageInfo(info: MessageV2.Info) {
    const key = getCacheKey(info.sessionID, info.id)
    messageInfoCache.set(key, info)
  }

  export async function getParts(sessionID: string, messageID: string): Promise<MessageV2.Part[]> {
    const key = getCacheKey(sessionID, messageID)

    // Check cache first
    const cached = partsCache.get(key)
    if (cached) return cached

    // Read from storage (inline parts format)
    const message = await Storage.read<MessageWithParts>(["message", sessionID, messageID]).catch(() => null)
    if (message?.parts) {
      const parts = message.parts.slice().sort((a, b) => (a.id > b.id ? 1 : -1))
      partsCache.set(key, parts)
      messageInfoCache.set(key, message.info)
      return parts
    }

    // No parts found - return empty array and cache it
    partsCache.set(key, [])
    return []
  }

  export async function updatePart(part: MessageV2.Part): Promise<void> {
    const key = getCacheKey(part.sessionID, part.messageID)

    // Get or initialize cache
    let parts = partsCache.get(key)
    if (!parts) {
      parts = await getParts(part.sessionID, part.messageID)
    }

    // Update part in cache
    const idx = parts.findIndex((p) => p.id === part.id)
    if (idx >= 0) {
      parts[idx] = part
    } else {
      parts.push(part)
      parts.sort((a, b) => (a.id > b.id ? 1 : -1))
    }
    partsCache.set(key, parts)
    dirtyMessages.add(key)

    // Debounce the disk write
    scheduleFlush(part.sessionID, part.messageID)
  }

  export async function removePart(sessionID: string, messageID: string, partID: string): Promise<void> {
    const key = getCacheKey(sessionID, messageID)

    // Get cache
    let parts = partsCache.get(key)
    if (!parts) {
      parts = await getParts(sessionID, messageID)
    }

    // Remove from cache
    const idx = parts.findIndex((p) => p.id === partID)
    if (idx >= 0) {
      parts.splice(idx, 1)
      partsCache.set(key, parts)
      dirtyMessages.add(key)
      scheduleFlush(sessionID, messageID)
    }
  }

  function scheduleFlush(sessionID: string, messageID: string) {
    const key = getCacheKey(sessionID, messageID)

    // Clear existing timer
    const existing = pendingFlush.get(key)
    if (existing) clearTimeout(existing)

    // Schedule new flush
    const timer = setTimeout(() => {
      flushMessage(sessionID, messageID).catch((e) => {
        log.error("failed to flush message", { sessionID, messageID, error: e })
      })
    }, DEBOUNCE_MS)

    pendingFlush.set(key, timer)
  }

  async function flushMessage(sessionID: string, messageID: string): Promise<void> {
    const key = getCacheKey(sessionID, messageID)
    pendingFlush.delete(key)

    if (!dirtyMessages.has(key)) return
    dirtyMessages.delete(key)

    const parts = partsCache.get(key)
    if (!parts) return

    // Get message info from cache or storage
    let info: MessageV2.Info | undefined = messageInfoCache.get(key)
    if (!info) {
      const message = await Storage.read<MessageWithParts>(["message", sessionID, messageID]).catch(() => null)
      if (message?.info) {
        info = message.info
      }
    }

    if (!info) {
      log.warn("cannot flush parts - message info not found", { sessionID, messageID })
      return
    }

    // Write message with inline parts
    await Storage.write(["message", sessionID, messageID], {
      info,
      parts: parts.slice().sort((a, b) => (a.id > b.id ? 1 : -1)),
    })
  }

  export async function flush(sessionID: string, messageID: string): Promise<void> {
    const key = getCacheKey(sessionID, messageID)

    // Clear pending timer
    const timer = pendingFlush.get(key)
    if (timer) {
      clearTimeout(timer)
      pendingFlush.delete(key)
    }

    // Force flush if dirty
    if (dirtyMessages.has(key)) {
      await flushMessage(sessionID, messageID)
    }
  }

  export async function flushAll(): Promise<void> {
    const promises: Promise<void>[] = []
    for (const key of dirtyMessages) {
      const [sessionID, messageID] = key.split(":")
      promises.push(flush(sessionID, messageID))
    }
    await Promise.all(promises)
  }

  export function clearCache(sessionID: string, messageID: string): void {
    const key = getCacheKey(sessionID, messageID)
    partsCache.delete(key)
    messageInfoCache.delete(key)
    dirtyMessages.delete(key)
    const timer = pendingFlush.get(key)
    if (timer) {
      clearTimeout(timer)
      pendingFlush.delete(key)
    }
  }

  export function clearAllCache(): void {
    partsCache.clear()
    messageInfoCache.clear()
    dirtyMessages.clear()
    for (const timer of pendingFlush.values()) {
      clearTimeout(timer)
    }
    pendingFlush.clear()
  }
}

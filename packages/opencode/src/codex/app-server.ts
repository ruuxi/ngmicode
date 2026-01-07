import { Instance } from "../project/instance"
import { Log } from "../util/log"
import { Installation } from "../installation"
import { spawn, type ChildProcessWithoutNullStreams } from "child_process"
import fs from "fs/promises"
import path from "path"
import os from "os"
import { Global } from "../global"
import { Shell } from "../shell/shell"

type JsonValue = Record<string, unknown>

type Pending = {
  resolve(value: JsonValue): void
  reject(error: Error): void
}

type Notification = {
  method: string
  params?: JsonValue
}

export type Request = {
  id: number
  method: string
  params?: JsonValue
}

type Response = {
  id: number
  result?: JsonValue
  error?: { message?: string }
}

type LoginState = {
  resolve(value: { success: boolean; error?: string | null }): void
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null
}

async function parseJson(input: string): Promise<JsonValue | undefined> {
  return Promise.resolve()
    .then(() => JSON.parse(input) as JsonValue)
    .catch(() => undefined)
}

function createDeferred<T>() {
  const holder: { resolve?: (value: T) => void } = {}
  const promise = new Promise<T>((resolve) => {
    holder.resolve = resolve
  })
  return { promise, resolve: holder.resolve! }
}

export namespace CodexAppServer {
  const log = Log.create({ service: "codex-app-server" })
  const state = Instance.state(async () => {
    return {
      proc: undefined as ChildProcessWithoutNullStreams | undefined,
      buffer: "",
      nextID: 0,
      pending: new Map<number, Pending>(),
      listeners: new Set<(message: Notification) => void>(),
      requests: new Set<(message: Request) => Promise<boolean>>(),
      exits: new Set<(error: Error) => void>(),
      ready: undefined as Promise<void> | undefined,
      readyResolve: undefined as (() => void) | undefined,
      login: new Map<string, LoginState>(),
    }
  }, async (current) => {
    const proc = current.proc
    if (!proc) return
    current.proc = undefined
    await Shell.killTree(proc).catch(() => {})
  })

  async function findExecutable(): Promise<string | undefined> {
    const fromEnv = process.env.CODEX_BIN || process.env.CODEX_PATH
    if (fromEnv && (await Bun.file(fromEnv).exists())) return fromEnv

    const home = os.homedir()
    const paths = process.platform === "win32"
      ? [
          path.join(home, ".local", "bin", "codex.exe"),
          path.join(home, "AppData", "Roaming", "npm", "codex.cmd"),
          path.join(home, "AppData", "Roaming", "npm", "codex.exe"),
          path.join(home, "AppData", "Roaming", "npm", "codex"),
          path.join(home, "AppData", "Local", "pnpm", "codex.cmd"),
          path.join(home, "AppData", "Local", "pnpm", "codex.exe"),
          path.join(home, "AppData", "Local", "Yarn", "bin", "codex.cmd"),
          path.join(home, "AppData", "Local", "Yarn", "bin", "codex.exe"),
          path.join(home, "scoop", "shims", "codex.exe"),
          "C:\\ProgramData\\chocolatey\\bin\\codex.exe",
        ]
      : [
          path.join(home, ".local", "bin", "codex"),
          "/usr/local/bin/codex",
          "/usr/bin/codex",
          "/opt/homebrew/bin/codex",
          path.join(home, ".npm-global", "bin", "codex"),
          path.join(home, ".nvm", "versions", "node", "**", "bin", "codex"),
          path.join(home, ".local", "share", "pnpm", "codex"),
          path.join(home, "Library", "pnpm", "codex"),
          path.join(home, ".yarn", "bin", "codex"),
          path.join(home, ".config", "yarn", "global", "node_modules", ".bin", "codex"),
          path.join(home, ".bun", "bin", "codex"),
          path.join(home, ".volta", "bin", "codex"),
          path.join(home, ".asdf", "shims", "codex"),
          path.join(home, ".fnm", "current", "bin", "codex"),
          "/usr/local/n/versions/node/*/bin/codex",
        ]

    for (const candidate of paths) {
      if (candidate.includes("*")) continue
      if (await Bun.file(candidate).exists()) {
        log.info("found codex executable", { path: candidate })
        return candidate
      }
    }

    const fallback = await Bun.$`${process.platform === "win32" ? "where" : "which"} codex`
      .quiet()
      .nothrow()
      .text()
    const found = fallback
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean)
    if (found) {
      log.info("found codex via which/where", { path: found })
      return found
    }

    return undefined
  }

  function encode(message: Record<string, unknown>): string {
    return JSON.stringify(message) + "\n"
  }

  function nextID(current: Awaited<ReturnType<typeof state>>) {
    current.nextID += 1
    return current.nextID
  }

  async function requestRaw(
    current: Awaited<ReturnType<typeof state>>,
    method: string,
    params?: Record<string, unknown>,
  ) {
    const id = nextID(current)
    const promise = new Promise<JsonValue>((resolve, reject) => {
      current.pending.set(id, { resolve, reject })
    })
    await write(current, params ? { id, method, params } : { id, method })
    return promise
  }

  async function notifyRaw(
    current: Awaited<ReturnType<typeof state>>,
    method: string,
    params?: Record<string, unknown>,
  ) {
    await write(current, params ? { method, params } : { method })
  }

  async function write(current: Awaited<ReturnType<typeof state>>, message: Record<string, unknown>) {
    const proc = current.proc
    if (!proc) throw new Error("codex app-server not running")
    const payload = encode(message)
    proc.stdin.write(payload)
  }

  async function handleResponse(current: Awaited<ReturnType<typeof state>>, msg: Response) {
    const pending = current.pending.get(msg.id)
    if (!pending) return
    current.pending.delete(msg.id)
    if (msg.error) {
      const message = msg.error.message || "codex app-server error"
      pending.reject(new Error(message))
      return
    }
    pending.resolve((msg.result ?? {}) as JsonValue)
  }

  async function handleRequest(current: Awaited<ReturnType<typeof state>>, msg: Request) {
    const handlers = Array.from(current.requests)
    const results = handlers.map((handler) => handler(msg))
    const handled = await Promise.all(results).then((items) => items.some(Boolean))
    if (!handled) {
      await write(current, { id: msg.id, result: { decision: "cancel" } })
    }
  }

  function handleNotification(current: Awaited<ReturnType<typeof state>>, msg: Notification) {
    for (const handler of current.listeners) {
      handler(msg)
    }
    if (msg.method === "account/login/completed" && isRecord(msg.params)) {
      const loginId = msg.params.loginId
      const success = msg.params.success
      const error = msg.params.error
      if (typeof loginId === "string" && typeof success === "boolean") {
        const match = current.login.get(loginId)
        if (match) {
          current.login.delete(loginId)
          match.resolve({ success, error: typeof error === "string" ? error : null })
        }
      }
    }
  }

  function notifyExit(current: Awaited<ReturnType<typeof state>>, error: Error) {
    for (const handler of current.exits) {
      handler(error)
    }
  }

  async function startProcess(current: Awaited<ReturnType<typeof state>>) {
    if (current.proc) return
    const bin = await findExecutable()
    if (!bin) throw new Error("Codex CLI not found. Install it from https://github.com/openai/codex.")

    const codexHome = path.join(Global.Path.data, "codex")
    await fs.mkdir(codexHome, { recursive: true })

    const proc = spawn(bin, ["app-server"], {
      cwd: Instance.directory,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        CODEX_HOME: codexHome,
      },
    })

    current.proc = proc
    current.buffer = ""
    current.pending.clear()

    proc.stdout.on("data", (chunk) => {
      const text = current.buffer + chunk.toString()
      const parts = text.split(/\r?\n/)
      const last = parts.pop()
      current.buffer = last ?? ""
      void Promise.all(
        parts.filter(Boolean).map(async (line) => {
          const parsed = await parseJson(line)
          if (!parsed) return
          if (!isRecord(parsed)) return
          const id = parsed.id
          const method = parsed.method
          if (typeof id === "number" && !method) {
            await handleResponse(current, parsed as Response)
            return
          }
          if (typeof method === "string" && typeof id === "number") {
            await handleRequest(current, parsed as Request)
            return
          }
          if (typeof method === "string") {
            handleNotification(current, parsed as Notification)
          }
        }),
      )
    })

    proc.stderr.on("data", (chunk) => {
      log.warn("codex app-server stderr", { output: chunk.toString() })
    })

    proc.on("exit", (code, signal) => {
      const details = [
        typeof code === "number" ? `code ${code}` : "",
        signal ? `signal ${signal}` : "",
      ]
        .filter(Boolean)
        .join(", ")
      const message = details ? `Codex app-server exited (${details})` : "Codex app-server exited"
      const error = new Error(message)
      current.proc = undefined
      for (const [id, pending] of current.pending.entries()) {
        current.pending.delete(id)
        pending.reject(error)
      }
      notifyExit(current, error)
    })

    proc.on("error", (err) => {
      const message = err instanceof Error ? err.message : "Codex app-server error"
      const error = new Error(message)
      current.proc = undefined
      for (const [id, pending] of current.pending.entries()) {
        current.pending.delete(id)
        pending.reject(error)
      }
      notifyExit(current, error)
    })

    const deferred = createDeferred<void>()
    current.ready = deferred.promise
    current.readyResolve = deferred.resolve

    await requestRaw(current, "initialize", {
      clientInfo: {
        name: "opencode",
        title: "OpenCode",
        version: Installation.VERSION,
      },
    })
    await notifyRaw(current, "initialized")
    current.readyResolve?.()
  }

  async function ensure() {
    const current = await state()
    if (!current.proc) await startProcess(current)
    if (current.ready) await current.ready
    return current
  }

  export async function request(method: string, params?: Record<string, unknown>) {
    const run = async () => {
      const current = await ensure()
      const id = nextID(current)
      const promise = new Promise<JsonValue>((resolve, reject) => {
        current.pending.set(id, { resolve, reject })
      })
      await write(current, params ? { id, method, params } : { id, method })
      return promise
    }
    return run().catch((error) => {
      if (!(error instanceof Error)) throw error
      if (!error.message.includes("Codex app-server exited")) throw error
      return run()
    })
  }

  export async function notify(method: string, params?: Record<string, unknown>) {
    const current = await ensure()
    await write(current, params ? { method, params } : { method })
  }

  export async function respond(id: number, result: Record<string, unknown>) {
    const current = await ensure()
    await write(current, { id, result })
  }

  export function onNotification(handler: (message: Notification) => void) {
    void state().then((current) => current.listeners.add(handler))
    return () => void state().then((current) => current.listeners.delete(handler))
  }

  export function onRequest(handler: (message: Request) => Promise<boolean>) {
    void state().then((current) => current.requests.add(handler))
    return () => void state().then((current) => current.requests.delete(handler))
  }

  export function onExit(handler: (error: Error) => void) {
    void state().then((current) => current.exits.add(handler))
    return () => void state().then((current) => current.exits.delete(handler))
  }

  export async function modelList() {
    const items: JsonValue[] = []
    const load = async (cursor?: string): Promise<void> => {
      const result = await request("model/list", {
        cursor: cursor ?? null,
        limit: null,
      })
      const data = (result.data as JsonValue[]) ?? []
      items.push(...data)
      const nextCursor = result.nextCursor
      if (typeof nextCursor === "string" && nextCursor.length > 0) return load(nextCursor)
      return
    }
    await load()
    return items
  }

  export async function account() {
    return request("account/read", { refreshToken: false })
  }

  export async function loginApiKey(apiKey: string) {
    return request("account/login/start", { type: "apiKey", apiKey })
  }

  export async function loginChatGpt() {
    return request("account/login/start", { type: "chatgpt" })
  }

  export async function waitForLogin(loginId: string) {
    const current = await ensure()
    const snapshot = await account().catch(() => undefined)
    if (snapshot && isRecord(snapshot.account)) {
      return { success: true, error: null }
    }
    const deferred = createDeferred<{ success: boolean; error?: string | null }>()
    current.login.set(loginId, { resolve: deferred.resolve })
    const poll = async (delayMs: number): Promise<void> => {
      if (!current.login.has(loginId)) return
      await Bun.sleep(delayMs)
      if (!current.login.has(loginId)) return
      const latest = await account().catch(() => undefined)
      if (latest && isRecord(latest.account)) {
        current.login.delete(loginId)
        deferred.resolve({ success: true, error: null })
        return
      }
      return poll(Math.min(delayMs * 2, 2000))
    }
    void poll(500)
    return deferred.promise
  }

  export async function cancelLogin(loginId: string) {
    return request("account/login/cancel", { loginId })
  }

  export async function logout() {
    return request("account/logout")
  }

  export async function threadStart(params: Record<string, unknown>) {
    return request("thread/start", params)
  }

  export async function threadResume(threadId: string) {
    return request("thread/resume", { threadId })
  }

  export async function turnStart(params: Record<string, unknown>) {
    return request("turn/start", params)
  }

  export async function turnInterrupt(params: Record<string, unknown>) {
    return request("turn/interrupt", params)
  }
}

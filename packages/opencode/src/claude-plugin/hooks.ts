import { spawn } from "child_process"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import { ClaudePluginLoader } from "./loader"
import { ClaudePluginSchema } from "./schema"

export namespace ClaudePluginHooks {
  const log = Log.create({ service: "claude-plugin.hooks" })

  // Registry of hooks by event type
  type HookRegistry = Map<ClaudePluginSchema.HookEvent, ClaudePluginLoader.LoadedHook[]>

  let registry: HookRegistry = new Map()

  /**
   * Register hooks from a loaded plugin
   */
  export function register(hooks: ClaudePluginLoader.LoadedHook[]): void {
    for (const hook of hooks) {
      const existing = registry.get(hook.event) ?? []
      existing.push(hook)
      registry.set(hook.event, existing)
    }
    log.info("registered hooks", { count: hooks.length })
  }

  /**
   * Clear all registered hooks
   */
  export function clear(): void {
    registry.clear()
    log.info("cleared all hooks")
  }

  /**
   * Get all hooks for an event
   */
  export function getHooks(event: ClaudePluginSchema.HookEvent): ClaudePluginLoader.LoadedHook[] {
    return registry.get(event) ?? []
  }

  /**
   * Context passed to hooks during execution
   */
  export interface HookContext {
    sessionID?: string
    messageID?: string
    toolName?: string
    toolArgs?: Record<string, unknown>
    toolResult?: unknown
    error?: Error
    [key: string]: unknown
  }

  /**
   * Result of hook execution
   */
  export interface HookResult {
    success: boolean
    output?: string
    error?: string
    duration: number
  }

  /**
   * Trigger all hooks for an event
   */
  export async function trigger(
    event: ClaudePluginSchema.HookEvent,
    context: HookContext,
  ): Promise<HookResult[]> {
    const hooks = getHooks(event)
    if (hooks.length === 0) return []

    log.info("triggering hooks", { event, count: hooks.length })

    const results: HookResult[] = []
    for (const hook of hooks) {
      // Check if matcher applies
      if (hook.matcher && context.toolName) {
        const regex = new RegExp(hook.matcher, "i")
        if (!regex.test(context.toolName)) {
          continue
        }
      }

      const result = await executeHook(hook, context)
      results.push(result)

      if (!result.success) {
        log.warn("hook execution failed", {
          event,
          pluginId: hook.pluginId,
          error: result.error,
        })
      }
    }

    return results
  }

  /**
   * Execute a single hook
   */
  async function executeHook(
    hook: ClaudePluginLoader.LoadedHook,
    context: HookContext,
  ): Promise<HookResult> {
    const startTime = Date.now()

    try {
      switch (hook.type) {
        case "command":
          return await executeCommandHook(hook, context)
        case "prompt":
          // Prompt hooks would use the LLM - for now just log
          log.info("prompt hook not yet implemented", { pluginId: hook.pluginId })
          return {
            success: true,
            duration: Date.now() - startTime,
          }
        case "agent":
          // Agent hooks would spawn an agent - for now just log
          log.info("agent hook not yet implemented", { pluginId: hook.pluginId })
          return {
            success: true,
            duration: Date.now() - startTime,
          }
        default:
          return {
            success: false,
            error: `Unknown hook type: ${hook.type}`,
            duration: Date.now() - startTime,
          }
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
      }
    }
  }

  /**
   * Execute a command hook (shell command)
   */
  async function executeCommandHook(
    hook: ClaudePluginLoader.LoadedHook,
    context: HookContext,
  ): Promise<HookResult> {
    const startTime = Date.now()

    if (!hook.command) {
      return {
        success: false,
        error: "No command specified",
        duration: Date.now() - startTime,
      }
    }

    // Parse the command (could be a single string or space-separated)
    const parts = hook.command.split(" ")
    const cmd = parts[0]
    const args = parts.slice(1)

    return new Promise((resolve) => {
      const timeout = hook.timeout ?? 30000

      const proc = spawn(cmd, args, {
        cwd: Instance.directory,
        shell: true,
        env: {
          ...process.env,
          OPENCODE_HOOK_EVENT: hook.event,
          OPENCODE_HOOK_CONTEXT: JSON.stringify(context),
          OPENCODE_SESSION_ID: context.sessionID ?? "",
          OPENCODE_TOOL_NAME: context.toolName ?? "",
        },
        timeout,
      })

      let stdout = ""
      let stderr = ""

      proc.stdout?.on("data", (data) => {
        stdout += data.toString()
      })

      proc.stderr?.on("data", (data) => {
        stderr += data.toString()
      })

      proc.on("close", (code) => {
        const duration = Date.now() - startTime

        if (code === 0) {
          resolve({
            success: true,
            output: stdout.trim(),
            duration,
          })
        } else {
          resolve({
            success: false,
            output: stdout.trim(),
            error: stderr.trim() || `Process exited with code ${code}`,
            duration,
          })
        }
      })

      proc.on("error", (error) => {
        resolve({
          success: false,
          error: error.message,
          duration: Date.now() - startTime,
        })
      })
    })
  }

  /**
   * Initialize hook subscriptions to the event bus
   * This maps internal OpenCode events to Claude Code hook events
   */
  export function init(): void {
    // Hook initialization is handled by the main module
    // This is a placeholder for future Bus subscriptions
    log.info("hooks initialized")
  }
}

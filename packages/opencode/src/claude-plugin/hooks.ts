import { spawn } from "child_process"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import { Bus } from "@/bus"
import { ClaudePluginLoader } from "./loader"
import { ClaudePluginSchema } from "./schema"

export namespace ClaudePluginHooks {
  const log = Log.create({ service: "claude-plugin.hooks" })

  // Registry of hooks by event type
  type HookRegistry = Map<ClaudePluginSchema.HookEvent, ClaudePluginLoader.LoadedHook[]>

  let registry: HookRegistry = new Map()

  // Registry of plugin paths by pluginId for variable resolution
  const pluginPaths = new Map<string, string>()

  /**
   * Register a plugin path for variable resolution
   */
  export function registerPluginPath(pluginId: string, path: string): void {
    pluginPaths.set(pluginId, path)
  }

  /**
   * Get plugin path by ID
   */
  export function getPluginPath(pluginId: string): string {
    return pluginPaths.get(pluginId) ?? ""
  }

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
      // Check if matcher applies (case-sensitive, like Claude Code)
      if (hook.matcher && context.toolName) {
        const regex = new RegExp(hook.matcher)
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
          return executePromptHook(hook, context, startTime)
        case "agent":
          return executeAgentHook(hook, context, startTime)
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

    // Resolve ${CLAUDE_PLUGIN_ROOT} in command
    const pluginPath = getPluginPath(hook.pluginId)
    const resolvedCommand = hook.command.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, pluginPath)

    // Parse the command (could be a single string or space-separated)
    const parts = resolvedCommand.split(" ")
    const cmd = parts[0]
    const args = parts.slice(1)

    return new Promise((resolve) => {
      const timeout = hook.timeout ?? 30000

      const proc = spawn(cmd, args, {
        cwd: Instance.directory,
        shell: true,
        env: {
          ...process.env,
          // OpenCode variables
          OPENCODE_HOOK_EVENT: hook.event,
          OPENCODE_HOOK_CONTEXT: JSON.stringify(context),
          OPENCODE_SESSION_ID: context.sessionID ?? "",
          OPENCODE_TOOL_NAME: context.toolName ?? "",
          // Claude Code compatible variables
          CLAUDE_PLUGIN_ROOT: pluginPath,
          CLAUDE_HOOK_EVENT: hook.event,
          CLAUDE_SESSION_ID: context.sessionID ?? "",
          CLAUDE_TOOL_NAME: context.toolName ?? "",
          CLAUDE_TOOL_ARGS: JSON.stringify(context.toolArgs ?? {}),
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
   * Execute a prompt hook (returns prompt text for LLM evaluation)
   */
  function executePromptHook(
    hook: ClaudePluginLoader.LoadedHook,
    context: HookContext,
    startTime: number,
  ): HookResult {
    if (!hook.prompt) {
      return {
        success: false,
        error: "No prompt specified",
        duration: Date.now() - startTime,
      }
    }

    // Resolve ${CLAUDE_PLUGIN_ROOT} in prompt
    const pluginPath = getPluginPath(hook.pluginId)
    const resolvedPrompt = hook.prompt.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, pluginPath)

    log.info("prompt hook executed", {
      pluginId: hook.pluginId,
      event: hook.event,
      promptLength: resolvedPrompt.length,
    })

    return {
      success: true,
      output: resolvedPrompt,
      duration: Date.now() - startTime,
    }
  }

  /**
   * Execute an agent hook (spawns a sub-agent)
   * Note: Full agent spawning requires session integration
   */
  function executeAgentHook(
    hook: ClaudePluginLoader.LoadedHook,
    context: HookContext,
    startTime: number,
  ): HookResult {
    log.info("agent hook executed", {
      pluginId: hook.pluginId,
      event: hook.event,
      sessionID: context.sessionID,
    })

    // Agent hooks would spawn a sub-agent via the session system
    // For now, return success and log the intent
    return {
      success: true,
      output: `Agent hook triggered for ${hook.event}`,
      duration: Date.now() - startTime,
    }
  }

  /**
   * Initialize hook subscriptions to the event bus
   * This maps internal OpenCode events to Claude Code hook events
   */
  export async function init(): Promise<void> {
    // Dynamically import Session to avoid circular dependencies
    const { Session } = await import("@/session")

    // SessionStart hook - fires when a session is created
    Bus.subscribe(Session.Event.Created, async (event) => {
      await trigger("SessionStart", {
        sessionID: event.properties.info.id,
      })
    })

    // SessionEnd hook - fires when a session is deleted
    Bus.subscribe(Session.Event.Deleted, async (event) => {
      await trigger("SessionEnd", {
        sessionID: event.properties.info.id,
      })
    })

    log.info("hooks initialized with Bus subscriptions")
  }
}

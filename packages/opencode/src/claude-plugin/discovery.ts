import path from "path"
import { exists } from "fs/promises"
import { Global } from "@/global"
import { Instance } from "@/project/instance"
import { Filesystem } from "@/util/filesystem"
import { Log } from "@/util/log"
import { ClaudePluginSchema } from "./schema"

export namespace ClaudePluginDiscovery {
  const log = Log.create({ service: "claude-plugin.discovery" })

  export interface DiscoveredPlugin {
    id: string
    path: string
    manifest: ClaudePluginSchema.Manifest
    hasCommands: boolean
    hasAgents: boolean
    hasSkills: boolean
    hasHooks: boolean
    hasMcp: boolean
    hasLsp: boolean
  }

  const PLUGIN_MANIFEST_GLOB = new Bun.Glob("*/.claude-plugin/plugin.json")

  /**
   * Discover all Claude Code plugins from .claude directories
   */
  export async function discoverLocal(): Promise<DiscoveredPlugin[]> {
    const plugins: DiscoveredPlugin[] = []
    const seen = new Set<string>()

    // Scan project-level .claude directories
    const claudeDirs = await Array.fromAsync(
      Filesystem.up({
        targets: [".claude"],
        start: Instance.directory,
        stop: Instance.worktree,
      }),
    )

    // Also include global ~/.claude directory
    const globalClaude = path.join(Global.Path.home, ".claude")
    if (await exists(globalClaude)) {
      claudeDirs.push(globalClaude)
    }

    for (const claudeDir of claudeDirs) {
      // Look for plugins in subdirectories with .claude-plugin/plugin.json
      for await (const match of PLUGIN_MANIFEST_GLOB.scan({
        cwd: claudeDir,
        absolute: true,
        onlyFiles: true,
        followSymlinks: true,
        dot: true,
      })) {
        const pluginDir = path.dirname(path.dirname(match))
        const plugin = await parsePlugin(pluginDir)
        if (plugin && !seen.has(plugin.id)) {
          seen.add(plugin.id)
          plugins.push(plugin)
        }
      }

      // Also check if the .claude directory itself is a plugin
      const directManifest = path.join(claudeDir, ".claude-plugin", "plugin.json")
      if (await exists(directManifest)) {
        const plugin = await parsePlugin(claudeDir)
        if (plugin && !seen.has(plugin.id)) {
          seen.add(plugin.id)
          plugins.push(plugin)
        }
      }
    }

    log.info("discovered plugins", { count: plugins.length })
    return plugins
  }

  /**
   * Parse a plugin from a directory
   */
  export async function parsePlugin(dir: string): Promise<DiscoveredPlugin | undefined> {
    const manifestPath = path.join(dir, ".claude-plugin", "plugin.json")

    const manifestText = await Bun.file(manifestPath)
      .text()
      .catch(() => undefined)
    if (!manifestText) {
      log.warn("could not read plugin manifest", { path: manifestPath })
      return undefined
    }

    let manifestJson: unknown
    try {
      manifestJson = JSON.parse(manifestText)
    } catch {
      log.warn("invalid plugin manifest json", { path: manifestPath })
      return undefined
    }

    const parsed = ClaudePluginSchema.Manifest.safeParse(manifestJson)
    if (!parsed.success) {
      log.warn("invalid plugin manifest", { path: manifestPath, issues: parsed.error.issues })
      return undefined
    }

    const manifest = parsed.data
    const id = `${manifest.name}@${manifest.version}`

    // Check which components exist
    const [hasCommands, hasAgents, hasSkills, hasHooks, hasMcp, hasLsp] = await Promise.all([
      exists(path.join(dir, "commands")),
      exists(path.join(dir, "agents")),
      exists(path.join(dir, "skills")),
      exists(path.join(dir, "hooks", "hooks.json")),
      exists(path.join(dir, ".mcp.json")),
      exists(path.join(dir, ".lsp.json")),
    ])

    log.info("parsed plugin", {
      id,
      path: dir,
      hasCommands,
      hasAgents,
      hasSkills,
      hasHooks,
      hasMcp,
      hasLsp,
    })

    return {
      id,
      path: dir,
      manifest,
      hasCommands,
      hasAgents,
      hasSkills,
      hasHooks,
      hasMcp,
      hasLsp,
    }
  }
}

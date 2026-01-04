import path from "path"
import { mkdir } from "fs/promises"
import { Config } from "@/config/config"
import { Global } from "@/global"
import { Log } from "@/util/log"
import { ClaudePluginSchema } from "./schema"

export namespace ClaudePluginMarketplace {
  const log = Log.create({ service: "claude-plugin.marketplace" })

  // Default Claude Code marketplace URLs
  const DEFAULT_MARKETPLACES = [
    "https://raw.githubusercontent.com/anthropics/claude-code-plugins/main/marketplace.json",
  ]

  // Cache for marketplace entries with TTL
  interface MarketplaceCache {
    entries: ClaudePluginSchema.MarketplaceEntry[]
    fetchedAt: number
  }

  const CACHE_TTL_MS = 15 * 60 * 1000 // 15 minutes
  let cache: MarketplaceCache | undefined

  /**
   * Get all marketplace URLs (default + configured)
   */
  async function getMarketplaceUrls(): Promise<string[]> {
    const config = await Config.get()
    const extra = (config as { extraKnownMarketplaces?: string[] }).extraKnownMarketplaces ?? []
    return [...DEFAULT_MARKETPLACES, ...extra]
  }

  /**
   * Fetch available plugins from all marketplaces
   */
  export async function list(forceRefresh = false): Promise<ClaudePluginSchema.MarketplaceEntry[]> {
    // Check cache
    if (!forceRefresh && cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
      return cache.entries
    }

    const urls = await getMarketplaceUrls()
    const allEntries: ClaudePluginSchema.MarketplaceEntry[] = []
    const seen = new Set<string>()

    for (const url of urls) {
      const entries = await fetchMarketplace(url)
      for (const entry of entries) {
        if (!seen.has(entry.id)) {
          seen.add(entry.id)
          allEntries.push(entry)
        }
      }
    }

    // Update cache
    cache = {
      entries: allEntries,
      fetchedAt: Date.now(),
    }

    log.info("fetched marketplace entries", { count: allEntries.length })
    return allEntries
  }

  /**
   * Fetch a single marketplace URL
   */
  async function fetchMarketplace(url: string): Promise<ClaudePluginSchema.MarketplaceEntry[]> {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": "OpenCode/1.0",
        },
      })

      if (!response.ok) {
        log.warn("failed to fetch marketplace", { url, status: response.status })
        return []
      }

      const data = await response.json()

      // Handle both array format and { plugins: [] } format
      const pluginsArray = Array.isArray(data) ? data : data.plugins
      if (!Array.isArray(pluginsArray)) {
        log.warn("invalid marketplace format", { url })
        return []
      }

      const entries: ClaudePluginSchema.MarketplaceEntry[] = []
      for (const item of pluginsArray) {
        const parsed = ClaudePluginSchema.MarketplaceEntry.safeParse(item)
        if (parsed.success) {
          entries.push(parsed.data)
        } else {
          log.warn("invalid marketplace entry", { url, issues: parsed.error.issues })
        }
      }

      return entries
    } catch (error) {
      log.warn("failed to fetch marketplace", {
        url,
        error: error instanceof Error ? error.message : String(error),
      })
      return []
    }
  }

  /**
   * Get a specific plugin from the marketplace
   */
  export async function get(id: string): Promise<ClaudePluginSchema.MarketplaceEntry | undefined> {
    const entries = await list()
    return entries.find((e) => e.id === id || e.name === id)
  }

  /**
   * Search plugins by query
   */
  export async function search(query: string): Promise<ClaudePluginSchema.MarketplaceEntry[]> {
    const entries = await list()
    const lower = query.toLowerCase()

    return entries.filter(
      (e) =>
        e.name.toLowerCase().includes(lower) ||
        e.description?.toLowerCase().includes(lower) ||
        e.tags?.some((t) => t.toLowerCase().includes(lower)),
    )
  }

  /**
   * Download and install a plugin from the marketplace
   */
  export async function download(
    entry: ClaudePluginSchema.MarketplaceEntry,
    targetDir?: string,
  ): Promise<string> {
    const pluginDir =
      targetDir ?? path.join(Global.Path.data, "claude-plugins", entry.name)

    // Ensure the directory exists
    await mkdir(pluginDir, { recursive: true })

    log.info("downloading plugin", { id: entry.id, source: entry.source, target: pluginDir })

    // Handle different source types
    if (entry.source.startsWith("git://") || entry.source.includes("github.com")) {
      // Git clone
      await cloneGitRepo(entry.source, pluginDir)
    } else if (entry.source.startsWith("http://") || entry.source.startsWith("https://")) {
      // Download archive (tar.gz or zip)
      await downloadArchive(entry.source, pluginDir)
    } else {
      throw new Error(`Unsupported source type: ${entry.source}`)
    }

    return pluginDir
  }

  async function cloneGitRepo(source: string, targetDir: string): Promise<void> {
    // Convert github.com URLs to git:// format if needed
    let gitUrl = source
    if (source.includes("github.com") && !source.startsWith("git://")) {
      gitUrl = source
        .replace("https://github.com/", "https://github.com/")
        .replace(/\/?$/, ".git")
    }

    const proc = Bun.spawn(["git", "clone", "--depth", "1", gitUrl, targetDir], {
      stdout: "pipe",
      stderr: "pipe",
    })

    const exitCode = await proc.exited
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text()
      throw new Error(`Git clone failed: ${stderr}`)
    }
  }

  async function downloadArchive(url: string, targetDir: string): Promise<void> {
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Failed to download: ${response.statusText}`)
    }

    const archivePath = path.join(Global.Path.cache, "plugin-download.tar.gz")
    await Bun.write(archivePath, response)

    // Extract the archive
    const proc = Bun.spawn(["tar", "-xzf", archivePath, "-C", targetDir, "--strip-components=1"], {
      stdout: "pipe",
      stderr: "pipe",
    })

    const exitCode = await proc.exited
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text()
      throw new Error(`Failed to extract archive: ${stderr}`)
    }
  }

  /**
   * Clear the marketplace cache
   */
  export function clearCache(): void {
    cache = undefined
  }
}

import z from "zod"

export namespace ClaudePluginSchema {
  // Plugin manifest (.claude-plugin/plugin.json)
  export const Manifest = z
    .object({
      name: z.string(),
      version: z.string(),
      description: z.string().optional(),
      author: z
        .object({
          name: z.string(),
          email: z.string().optional(),
          url: z.string().optional(),
        })
        .or(z.string())
        .optional(),
      homepage: z.string().optional(),
      repository: z.string().optional(),
      license: z.string().optional(),
      keywords: z.array(z.string()).optional(),
      commands: z.array(z.string()).optional(),
      agents: z.string().optional(),
      skills: z.string().optional(),
      hooks: z.string().optional(),
      mcpServers: z.record(z.string(), z.any()).optional(),
      lspServers: z.string().optional(),
    })
    .meta({ ref: "ClaudePluginManifest" })

  export type Manifest = z.infer<typeof Manifest>

  // Hook event types
  export const HookEvent = z.enum([
    "PreToolUse",
    "PostToolUse",
    "PostToolUseFailure",
    "PermissionRequest",
    "UserPromptSubmit",
    "Notification",
    "Stop",
    "SubagentStop",
    "PreCompact",
    "SessionStart",
    "SessionEnd",
  ])

  export type HookEvent = z.infer<typeof HookEvent>

  // Hook types
  export const HookType = z.enum(["command", "prompt", "agent"])

  // Single hook definition
  export const HookDefinition = z.object({
    type: HookType,
    command: z.string().optional(),
    prompt: z.string().optional(),
    timeout: z.number().int().positive().optional(),
  })

  // Hook matcher for filtering which tools trigger hooks
  export const HookMatcher = z.object({
    matcher: z.string().optional(),
    hooks: z.array(HookDefinition),
  })

  // Hooks file structure (hooks/hooks.json)
  export const HooksFile = z
    .object({
      hooks: z.record(HookEvent, z.array(HookMatcher)),
    })
    .meta({ ref: "ClaudePluginHooksFile" })

  export type HooksFile = z.infer<typeof HooksFile>

  // MCP server config
  export const McpServerConfig = z.object({
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    url: z.string().optional(),
    type: z.enum(["stdio", "sse"]).optional(),
  })

  export const McpConfig = z
    .record(z.string(), McpServerConfig)
    .meta({ ref: "ClaudePluginMcpConfig" })

  export type McpConfig = z.infer<typeof McpConfig>

  // LSP server config
  export const LspServerConfig = z.object({
    command: z.string(),
    args: z.array(z.string()).optional(),
    extensionToLanguage: z.record(z.string(), z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
  })

  export const LspConfig = z
    .record(z.string(), LspServerConfig)
    .meta({ ref: "ClaudePluginLspConfig" })

  export type LspConfig = z.infer<typeof LspConfig>

  // Command frontmatter
  export const CommandFrontmatter = z.object({
    description: z.string().optional(),
    agent: z.string().optional(),
    model: z.string().optional(),
  })

  export type CommandFrontmatter = z.infer<typeof CommandFrontmatter>

  // Agent frontmatter
  export const AgentFrontmatter = z.object({
    name: z.string().optional(),
    description: z.string().optional(),
    model: z.string().optional(),
    tools: z.record(z.string(), z.boolean()).optional(),
    "allowed-tools": z.string().optional(),
  })

  export type AgentFrontmatter = z.infer<typeof AgentFrontmatter>

  // Skill frontmatter (skills/*/SKILL.md)
  export const SkillFrontmatter = z.object({
    name: z.string(),
    description: z.string(),
    "allowed-tools": z.string().optional(),
    model: z.string().optional(),
  })

  export type SkillFrontmatter = z.infer<typeof SkillFrontmatter>

  // Plugin source
  export const PluginSource = z.enum(["local", "marketplace"])

  export type PluginSource = z.infer<typeof PluginSource>

  // Installed plugin info
  export const InstalledPlugin = z
    .object({
      id: z.string(),
      source: PluginSource,
      path: z.string(),
      enabled: z.boolean(),
      manifest: Manifest,
      installedAt: z.number(),
      updatedAt: z.number().optional(),
    })
    .meta({ ref: "ClaudePluginInstalled" })

  export type InstalledPlugin = z.infer<typeof InstalledPlugin>

  // Marketplace plugin entry
  export const MarketplaceEntry = z
    .object({
      id: z.string(),
      name: z.string(),
      version: z.string(),
      description: z.string().optional(),
      author: z.string().optional(),
      source: z.string(),
      homepage: z.string().optional(),
      downloads: z.number().optional(),
      rating: z.number().optional(),
      tags: z.array(z.string()).optional(),
    })
    .meta({ ref: "ClaudePluginMarketplaceEntry" })

  export type MarketplaceEntry = z.infer<typeof MarketplaceEntry>

  // Marketplace registry format
  export const MarketplaceRegistry = z
    .object({
      version: z.string().optional(),
      plugins: z.array(MarketplaceEntry),
    })
    .meta({ ref: "ClaudePluginMarketplaceRegistry" })

  export type MarketplaceRegistry = z.infer<typeof MarketplaceRegistry>
}

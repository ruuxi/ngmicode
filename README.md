# OpenCode - Claude Code Edition

A fork of [OpenCode](https://github.com/anomalyco/opencode) optimized for Claude-focused desktop workflows.

## Key Differences from Upstream

### Added in This Fork

| Feature | Description |
|---------|-------------|
| **Multi-Pane Layout** | Up to 48 concurrent sessions across 4 pages with resizable grid |
| **Voice Input** | Local speech-to-text using Parakeet TDT ONNX model (desktop only) |
| **Mode System** | Switch between Claude Code, OpenCode, and Oh My OpenCode modes |
| **Claude Agent Provider** | Direct integration with Anthropic Agent SDK for subscription/API use |
| **Plugin Marketplace** | Browse and install plugins with one click |
| **Worktree Isolation** | Per-session git worktree management |

### Removed from Upstream

| Feature | Reason |
|---------|--------|
| **TUI** | Desktop-focused; removed terminal UI and 20+ themes |
| **CLI Commands** | Kept only `serve` and `generate`; removed 15+ commands (unused)|
| **Cloud Infrastructure** | No SST, Cloudflare Workers, PlanetScale, or Stripe |
| **Console/Enterprise** | Removed dashboard, billing, workspaces, teams packages |
| **Slack Integration** | Removed |

### Unchanged

- All AI providers (Anthropic, OpenAI, Google, AWS Bedrock, OpenRouter, Azure, etc.)
- Core agent system (build, plan, explore, general)
- Tool system (bash, read, edit, grep, glob, etc.)
- MCP integration
- LSP support

## Development

```bash
bun install
bun run tauri dev
```

## Syncing with Upstream

```bash
git fetch origin dev
git merge origin/dev
```

---

*Based on [OpenCode](https://opencode.ai) by Anomaly*

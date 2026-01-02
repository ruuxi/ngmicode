# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
# Install dependencies
bun install

# Run development server (runs in packages/opencode by default)
bun dev
bun dev <directory>  # Run against a specific directory
bun dev .            # Run in repo root

# Type checking
bun turbo typecheck

# Tests (run from packages/opencode, not root)
cd packages/opencode && bun test
bun test <file>      # Single test file

# Build standalone executable
./packages/opencode/script/build.ts --single

# Regenerate SDK after API changes
./packages/sdk/js/script/build.ts
# Or from repo root:
./script/generate.ts
```

## Architecture Overview

OpenCode is an AI coding agent with a **client-server architecture**:

- **Server**: Hono HTTP server exposing REST API + SSE for real-time events (`packages/opencode/src/server/`)
- **TUI**: SolidJS terminal UI using OpenTUI framework (`packages/opencode/src/cli/cmd/tui/`)
- **SDK**: Auto-generated TypeScript client (`packages/sdk/js/`)
- **Event Bus**: Pub-sub system for component communication (`packages/opencode/src/bus/`)

### Core Packages

| Package | Purpose |
|---------|---------|
| `packages/opencode` | Core CLI, server, and business logic |
| `packages/plugin` | `@opencode-ai/plugin` for custom tools |
| `packages/sdk/js` | Generated TypeScript SDK |
| `packages/desktop` | Tauri desktop app |
| `packages/console` | Web console |

### Key Source Directories (`packages/opencode/src/`)

| Directory | Purpose |
|-----------|---------|
| `agent/` | Agent definitions with prompts (build, plan, explore) |
| `provider/` | AI provider abstraction (Anthropic, OpenAI, Google, etc.) |
| `tool/` | Built-in tools (bash, read, edit, grep, glob, etc.) |
| `session/` | Session/message management, agentic loop, compaction |
| `permission/` | Permission system for tool execution |
| `mcp/` | Model Context Protocol client integration |
| `lsp/` | Language Server Protocol integration |
| `config/` | Configuration loading (opencode.json) |

### Tool System

Tools are defined with Zod schemas and execute with permission checking:

```typescript
export const MyTool = Tool.define("my-tool", async () => ({
  description: "...",
  parameters: z.object({ ... }),
  async execute(args, ctx) {
    // ctx.ask() for permissions, ctx.metadata() for UI updates
    return { title, output, metadata }
  }
}))
```

Custom tools: `.opencode/tool/` directories or via plugins.

### Agent System

Built-in agents: `build` (full access), `plan` (read-only), `explore` (fast search), `general` (parallel tasks).

Custom agents: `.opencode/agent/*.md` files or `opencode.json` config.

## Code Style

- Keep logic in single functions unless reusable
- Avoid `else` statements, `try/catch`, `let`, and `any`
- Prefer single-word variable names when descriptive
- Use Bun APIs (`Bun.file()`, `Bun.$`, etc.)
- No unnecessary destructuring

## Conventions

- **Namespace modules**: Major components use `export namespace Foo { ... }`
- **Zod schemas**: All data types use Zod for validation and SDK generation
- **Path aliases**: `@/` maps to `src/`
- **Prompts**: Stored as `.txt` files imported as strings
- **Lazy init**: `lazy()` utility for deferred expensive operations

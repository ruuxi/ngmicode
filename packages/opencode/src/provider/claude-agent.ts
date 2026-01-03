import { Env } from "@/env"
import { Storage } from "@/storage/storage"
import { Auth } from "@/auth"
import type { Provider } from "./provider"

export namespace ClaudeAgent {
  const PROVIDER_ID = "claude-agent"

  // Static model definition for Claude Code
  export const MODEL: Provider.Model = {
    id: "claude-agent",
    providerID: PROVIDER_ID,
    name: "Claude Code",
    family: "claude-agent",
    api: {
      id: "claude-agent",
      url: "",
      npm: "",
    },
    capabilities: {
      temperature: false,
      reasoning: true,
      attachment: true,
      toolcall: true,
      input: {
        text: true,
        audio: false,
        image: true,
        video: false,
        pdf: true,
      },
      output: {
        text: true,
        audio: false,
        image: false,
        video: false,
        pdf: false,
      },
      interleaved: true,
    },
    cost: {
      input: 0,
      output: 0,
      cache: {
        read: 0,
        write: 0,
      },
    },
    limit: {
      context: 200000,
      output: 16000,
    },
    status: "active",
    options: {},
    headers: {},
    release_date: "2025-12-01",
    variants: {},
  }

  // Static provider definition
  export const PROVIDER: Provider.Info = {
    id: PROVIDER_ID,
    name: "Claude Code",
    source: "custom",
    env: ["ANTHROPIC_API_KEY"],
    options: {
      __isClaudeAgent: true,
    },
    models: {
      "claude-agent": MODEL,
    },
  }

  /**
   * Check if Claude Code provider is available
   * Requires ANTHROPIC_API_KEY or Claude Code CLI to be authenticated
   * Note: OAuth tokens from OpenCode login do NOT work - the SDK needs an actual API key
   */
  export async function isAvailable(): Promise<boolean> {
    // Check for API key
    if (Env.get("ANTHROPIC_API_KEY")) return true

    // Check for API key stored via auth (not OAuth)
    const auth = await Auth.get("anthropic")
    if (auth?.type === "api" && auth.key) return true

    // If no API key, the SDK might still work if Claude Code CLI is authenticated
    // We return true here and let the SDK handle auth errors if CLI isn't authenticated
    return true
  }

  /**
   * Synchronous check for API key only (used in provider loading)
   */
  export function hasApiKey(): boolean {
    return !!Env.get("ANTHROPIC_API_KEY")
  }

  /**
   * Get the access token for authentication
   * Returns API key or OAuth access token
   */
  export async function getAccessToken(): Promise<string | undefined> {
    // Prefer API key
    const apiKey = Env.get("ANTHROPIC_API_KEY")
    if (apiKey) return apiKey

    // Fall back to OAuth
    const auth = await Auth.get("anthropic")
    if (auth?.type === "oauth") {
      // Check if token is expired
      if (auth.expires && auth.expires < Date.now()) {
        // Token expired - need refresh
        return undefined
      }
      return auth.access
    }
    if (auth?.type === "api") return auth.key

    return undefined
  }

  /**
   * Get the Claude Agent session ID for an OpenCode session
   */
  export async function getAgentSessionID(sessionID: string): Promise<string | undefined> {
    return Storage.read<string>(["claude-agent-session", sessionID]).catch((e) => {
      if (Storage.NotFoundError.isInstance(e)) {
        return undefined
      }
      throw e
    })
  }

  /**
   * Store the Claude Agent session ID for an OpenCode session
   */
  export async function setAgentSessionID(sessionID: string, agentSessionID: string): Promise<void> {
    await Storage.write(["claude-agent-session", sessionID], agentSessionID)
  }

  /**
   * Check if a model belongs to Claude Agent provider
   */
  export function isClaudeAgentModel(providerID: string): boolean {
    return providerID === PROVIDER_ID
  }
}

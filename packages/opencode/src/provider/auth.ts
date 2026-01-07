import { Instance } from "@/project/instance"
import { Plugin } from "../plugin"
import { map, filter, pipe, fromEntries, mapValues } from "remeda"
import z from "zod"
import { fn } from "@/util/fn"
import type { AuthOuathResult, Hooks } from "@opencode-ai/plugin"
import { NamedError } from "@opencode-ai/util/error"
import { Auth } from "@/auth"
import { CodexAppServer } from "../codex/app-server"

export namespace ProviderAuth {
  function isRecord(input: unknown): input is Record<string, unknown> {
    return typeof input === "object" && input !== null
  }

  function readString(input: unknown): string | undefined {
    return typeof input === "string" ? input : undefined
  }

  function createCodexAuth(): Hooks["auth"] {
    return {
      provider: "codex",
      methods: [
        {
          type: "oauth",
          label: "ChatGPT",
          async authorize() {
            const response = await CodexAppServer.loginChatGpt()
            const loginId = isRecord(response) ? readString(response.loginId) : undefined
            const authUrl = isRecord(response) ? readString(response.authUrl) : undefined
            if (!loginId || !authUrl) {
              throw new Error("Codex login did not return an auth URL.")
            }
            return {
              method: "auto",
              url: authUrl,
              instructions: "Complete sign-in in the browser to finish connecting.",
              async callback() {
                const result = await CodexAppServer.waitForLogin(loginId)
                if (!result.success) return { type: "failed" }
                return { type: "success", key: "codex" }
              },
            }
          },
        },
        {
          type: "api",
          label: "API key",
        },
      ],
    }
  }

  const state = Instance.state(async () => {
    const methods = pipe(
      await Plugin.list(),
      filter((x) => x.auth?.provider !== undefined),
      map((x) => [x.auth!.provider, x.auth!] as const),
      fromEntries(),
    )
    const codexAuth = createCodexAuth()
    methods[codexAuth.provider] = codexAuth
    return { methods, pending: {} as Record<string, AuthOuathResult> }
  })

  export const Method = z
    .object({
      type: z.union([z.literal("oauth"), z.literal("api")]),
      label: z.string(),
    })
    .meta({
      ref: "ProviderAuthMethod",
    })
  export type Method = z.infer<typeof Method>

  export async function methods() {
    const s = await state().then((x) => x.methods)
    const result = mapValues(s, (x) =>
      x.methods.map(
        (y): Method => ({
          type: y.type,
          label: y.label,
        }),
      ),
    )

    // Claude Code uses the same auth as Anthropic
    if (result["anthropic"]) {
      result["claude-agent"] = result["anthropic"]
    }

    return result
  }

  export const Authorization = z
    .object({
      url: z.string(),
      method: z.union([z.literal("auto"), z.literal("code")]),
      instructions: z.string(),
    })
    .meta({
      ref: "ProviderAuthAuthorization",
    })
  export type Authorization = z.infer<typeof Authorization>

  export const authorize = fn(
    z.object({
      providerID: z.string(),
      method: z.number(),
    }),
    async (input): Promise<Authorization | undefined> => {
      // Claude Code uses Anthropic's auth
      const actualProviderID = input.providerID === "claude-agent" ? "anthropic" : input.providerID
      const auth = await state().then((s) => s.methods[actualProviderID])
      if (!auth) return undefined
      const method = auth.methods[input.method]
      if (method.type === "oauth") {
        const result = await method.authorize()
        // Store pending auth under both the actual provider and the requested provider
        await state().then((s) => {
          s.pending[actualProviderID] = result
          if (input.providerID !== actualProviderID) {
            s.pending[input.providerID] = result
          }
        })
        return {
          url: result.url,
          method: result.method,
          instructions: result.instructions,
        }
      }
    },
  )

  export const callback = fn(
    z.object({
      providerID: z.string(),
      method: z.number(),
      code: z.string().optional(),
    }),
    async (input) => {
      // Claude Code uses Anthropic's auth
      const actualProviderID = input.providerID === "claude-agent" ? "anthropic" : input.providerID
      const match = await state().then((s) => s.pending[input.providerID] || s.pending[actualProviderID])
      if (!match) throw new OauthMissing({ providerID: input.providerID })
      let result

      if (match.method === "code") {
        if (!input.code) throw new OauthCodeMissing({ providerID: input.providerID })
        result = await match.callback(input.code)
      }

      if (match.method === "auto") {
        result = await match.callback()
      }

      if (result?.type === "success") {
        if (actualProviderID === "codex") return
        if ("key" in result) {
          // Store under the actual provider (anthropic) so both can use it
          await Auth.set(actualProviderID, {
            type: "api",
            key: result.key,
          })
        }
        if ("refresh" in result) {
          // Store under the actual provider (anthropic) so both can use it
          await Auth.set(actualProviderID, {
            type: "oauth",
            access: result.access,
            refresh: result.refresh,
            expires: result.expires,
          })
        }
        return
      }

      throw new OauthCallbackFailed({})
    },
  )

  export const api = fn(
    z.object({
      providerID: z.string(),
      key: z.string(),
    }),
    async (input) => {
      await Auth.set(input.providerID, {
        type: "api",
        key: input.key,
      })
    },
  )

  export const OauthMissing = NamedError.create(
    "ProviderAuthOauthMissing",
    z.object({
      providerID: z.string(),
    }),
  )
  export const OauthCodeMissing = NamedError.create(
    "ProviderAuthOauthCodeMissing",
    z.object({
      providerID: z.string(),
    }),
  )

  export const OauthCallbackFailed = NamedError.create("ProviderAuthOauthCallbackFailed", z.object({}))
}

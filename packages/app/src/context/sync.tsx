import { batch, createMemo } from "solid-js"
import { produce, reconcile } from "solid-js/store"
import { Binary } from "@opencode-ai/util/binary"
import { retry } from "@opencode-ai/util/retry"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { useGlobalSync } from "./global-sync"
import { useSDK } from "./sdk"
import type { Message, Part } from "@opencode-ai/sdk/v2/client"

export const { use: useSync, provider: SyncProvider } = createSimpleContext({
  name: "Sync",
  init: () => {
    const globalSync = useGlobalSync()
    const sdk = useSDK()
    const child = createMemo(() => globalSync.child(sdk.directory))
    const store = createMemo(() => child()[0])
    const setStore = (...args: [any, ...any[]]) => (child()[1] as (...args: any[]) => void)(...args)
    const absolute = (path: string) => (store().path.directory + "/" + path).replace("//", "/")

    return {
      get data() {
        return store()
      },
      set: setStore,
      get status() {
        return store().status
      },
      get ready() {
        return store().status !== "loading"
      },
      get project() {
        const current = store()
        const match = Binary.search(globalSync.data.project, current.project, (p) => p.id)
        if (match.found) return globalSync.data.project[match.index]
        return undefined
      },
      session: {
        get(sessionID: string) {
          const current = store()
          const match = Binary.search(current.session, sessionID, (s) => s.id)
          if (match.found) return current.session[match.index]
          return undefined
        },
        addOptimisticMessage(input: {
          sessionID: string
          messageID: string
          parts: Part[]
          agent: string
          model: { providerID: string; modelID: string }
        }) {
          const message: Message = {
            id: input.messageID,
            sessionID: input.sessionID,
            role: "user",
            time: { created: Date.now() },
            agent: input.agent,
            model: input.model,
          }
          const [, localSetStore] = child()
          localSetStore(
            produce((draft) => {
              const messages = draft.message[input.sessionID]
              if (!messages) {
                draft.message[input.sessionID] = [message]
              } else {
                const result = Binary.search(messages, input.messageID, (m) => m.id)
                messages.splice(result.index, 0, message)
              }
              draft.part[input.messageID] = input.parts
                .filter((p) => !!p?.id)
                .slice()
                .sort((a, b) => a.id.localeCompare(b.id))
            }),
          )
        },
        async sync(sessionID: string, _isRetry = false) {
          const [localStore, localSetStore] = child()
          const client = sdk.client
          const [session, messages, todo, diff] = await Promise.all([
            retry(() => client.session.get({ sessionID })),
            retry(() => client.session.messages({ sessionID, limit: 1000 })),
            retry(() => client.session.todo({ sessionID })).catch(() => ({ data: [] })),
            retry(() => client.session.diff({ sessionID })).catch(() => ({ data: [] })),
          ])

          batch(() => {
            localSetStore(
              "session",
              produce((draft) => {
                const match = Binary.search(draft, sessionID, (s) => s.id)
                if (match.found) {
                  draft[match.index] = session.data!
                  return
                }
                draft.splice(match.index, 0, session.data!)
              }),
            )

            localSetStore("todo", sessionID, reconcile(todo.data ?? [], { key: "id" }))
            const serverMessages = (messages.data ?? [])
              .map((x) => x.info)
              .filter((m) => !!m?.id)
              .slice()
              .sort((a, b) => a.id.localeCompare(b.id))

            localSetStore("message", sessionID, reconcile(serverMessages, { key: "id" }))

            for (const message of messages.data ?? []) {
              if (!message?.info?.id) continue
              localSetStore(
                "part",
                message.info.id,
                reconcile(
                  message.parts
                    .filter((p) => !!p?.id)
                    .slice()
                    .sort((a, b) => a.id.localeCompare(b.id)),
                  { key: "id" },
                ),
              )
            }

            localSetStore("session_diff", sessionID, reconcile(diff.data ?? [], { key: "file" }))
          })
        },
        fetch: async (count = 10) => {
          const [localStore, localSetStore] = child()
          const client = sdk.client
          localSetStore("limit", (x) => x + count)
          await client.session.list().then((x) => {
            const sessions = (x.data ?? [])
              .filter((s) => !!s?.id)
              .slice()
              .sort((a, b) => a.id.localeCompare(b.id))
              .slice(0, localStore.limit)
            localSetStore("session", reconcile(sessions, { key: "id" }))
          })
        },
        more: createMemo(() => store().session.length >= store().limit),
        archive: async (sessionID: string) => {
          const [, localSetStore] = child()
          const client = sdk.client
          await client.session.update({ sessionID, time: { archived: Date.now() } })
          localSetStore(
            produce((draft) => {
              const match = Binary.search(draft.session, sessionID, (s) => s.id)
              if (match.found) draft.session.splice(match.index, 1)
            }),
          )
        },
      },
      absolute,
      get directory() {
        return store().path.directory
      },
    }
  },
})

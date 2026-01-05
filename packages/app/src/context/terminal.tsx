import { createStore } from "solid-js/store"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { batch, createMemo } from "solid-js"
import { useParams } from "@solidjs/router"
import { useSDK } from "./sdk"
import { persisted } from "@/utils/persist"

export type LocalPTY = {
  id: string
  title: string
  rows?: number
  cols?: number
  buffer?: string
  scrollY?: number
}

export const { use: useTerminal, provider: TerminalProvider } = createSimpleContext<
  ReturnType<typeof createTerminalContext>,
  { paneId?: string }
>({
  name: "Terminal",
  init: (props) => createTerminalContext(props?.paneId),
})

type TerminalEntry = {
  active?: string
  all: LocalPTY[]
}

type TerminalStore = {
  entries: Record<string, TerminalEntry>
}

function createDefaultEntry(): TerminalEntry {
  return { all: [] }
}

function createTerminalContext(paneId?: string) {
  const sdk = useSDK()
  const params = useParams()

  // For pane-based terminals, don't persist (paneIds are random and would cause orphaned entries)
  // For single session view, persist by directory/session
  if (paneId) {
    return createNonPersistedTerminalContext(sdk)
  }

  const key = createMemo(() => `${params.dir}/terminal${params.id ? "/" + params.id : ""}.v1`)
  const [store, setStore, _, ready] = persisted(
    "terminal.v2",
    createStore<TerminalStore>({
      entries: {},
    }),
  )

  const currentEntry = createMemo(() => store.entries[key()] ?? createDefaultEntry())
  const updateEntry = (updater: (entry: TerminalEntry) => TerminalEntry, targetKey?: string) => {
    const keyToUse = targetKey ?? key()
    const base = store.entries[keyToUse] ?? createDefaultEntry()
    setStore("entries", keyToUse, updater(base))
  }

  return createTerminalMethods(sdk, () => currentEntry(), updateEntry, ready, () => key())
}

function createNonPersistedTerminalContext(sdk: ReturnType<typeof useSDK>) {
  const [store, setStore] = createStore<TerminalEntry>(createDefaultEntry())
  const updateEntry = (updater: (entry: TerminalEntry) => TerminalEntry) => {
    setStore(updater(store))
  }
  return createTerminalMethods(sdk, () => store, updateEntry, () => true, () => "")
}

function createTerminalMethods(
  sdk: ReturnType<typeof useSDK>,
  getEntry: () => TerminalEntry,
  updateEntry: (updater: (entry: TerminalEntry) => TerminalEntry, targetKey?: string) => void,
  ready: () => boolean,
  getKey: () => string,
) {
  return {
    ready,
    all: createMemo(() => getEntry().all),
    active: createMemo(() => getEntry().active),
    new() {
      const targetKey = getKey()
      sdk.client.pty
        .create({ title: `Terminal ${getEntry().all.length + 1}` })
        .then((pty) => {
          const id = pty.data?.id
          if (!id) return
          updateEntry(
            (entry) => ({
              ...entry,
              all: [
                ...entry.all,
                {
                  id,
                  title: pty.data?.title ?? "Terminal",
                },
              ],
              active: id,
            }),
            targetKey,
          )
        })
        .catch((e) => {
          console.error("Failed to create terminal", e)
        })
    },
    update(pty: Partial<LocalPTY> & { id: string }) {
      updateEntry((entry) => ({
        ...entry,
        all: entry.all.map((x) => (x.id === pty.id ? { ...x, ...pty } : x)),
      }))
      sdk.client.pty
        .update({
          ptyID: pty.id,
          title: pty.title,
          size: pty.cols && pty.rows ? { rows: pty.rows, cols: pty.cols } : undefined,
        })
        .catch((e) => {
          console.error("Failed to update terminal", e)
        })
    },
    async clone(id: string) {
      const targetKey = getKey()
      const entry = getEntry()
      const index = entry.all.findIndex((x) => x.id === id)
      const pty = entry.all[index]
      if (!pty) return
      const clone = await sdk.client.pty
        .create({
          title: pty.title,
        })
        .catch((e) => {
          console.error("Failed to clone terminal", e)
          return undefined
        })
      if (!clone?.data) return
      updateEntry(
        (entry) => {
          const nextAll = entry.all.slice()
          nextAll[index] = {
            ...pty,
            ...clone.data,
          }
          return {
            ...entry,
            all: nextAll,
            active: entry.active === pty.id ? clone.data.id : entry.active,
          }
        },
        targetKey,
      )
    },
    open(id: string) {
      updateEntry((entry) => ({ ...entry, active: id }))
    },
    async close(id: string) {
      batch(() => {
        updateEntry((entry) => {
          const nextAll = entry.all.filter((x) => x.id !== id)
          let nextActive = entry.active
          if (entry.active === id) {
            const index = entry.all.findIndex((f) => f.id === id)
            const previous = entry.all[Math.max(0, index - 1)]
            nextActive = previous?.id
          }
          return {
            ...entry,
            all: nextAll,
            active: nextActive,
          }
        })
      })
      await sdk.client.pty.remove({ ptyID: id }).catch((e) => {
        console.error("Failed to close terminal", e)
      })
    },
    move(id: string, to: number) {
      updateEntry((entry) => {
        const index = entry.all.findIndex((f) => f.id === id)
        if (index === -1) return entry
        const clamped = Math.max(0, Math.min(to, entry.all.length - 1))
        if (clamped === index) return entry
        const nextAll = entry.all.slice()
        nextAll.splice(clamped, 0, nextAll.splice(index, 1)[0])
        return {
          ...entry,
          all: nextAll,
        }
      })
    },
  }
}

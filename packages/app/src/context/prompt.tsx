import { createStore } from "solid-js/store"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { batch, createMemo, type Accessor } from "solid-js"
import { useParams } from "@solidjs/router"
import { TextSelection } from "./local"
import { persisted } from "@/utils/persist"

interface PartBase {
  content: string
  start: number
  end: number
}

export interface TextPart extends PartBase {
  type: "text"
}

export interface FileAttachmentPart extends PartBase {
  type: "file"
  path: string
  selection?: TextSelection
}

export interface AgentPart extends PartBase {
  type: "agent"
  name: string
}

export interface ImageAttachmentPart {
  type: "image"
  id: string
  filename: string
  mime: string
  dataUrl: string
}

export type ContentPart = TextPart | FileAttachmentPart | AgentPart | ImageAttachmentPart
export type Prompt = ContentPart[]

export const DEFAULT_PROMPT: Prompt = [{ type: "text", content: "", start: 0, end: 0 }]

export function isPromptEqual(promptA: Prompt, promptB: Prompt): boolean {
  if (promptA.length !== promptB.length) return false
  for (let i = 0; i < promptA.length; i++) {
    const partA = promptA[i]
    const partB = promptB[i]
    if (partA.type !== partB.type) return false
    if (partA.type === "text" && partA.content !== (partB as TextPart).content) {
      return false
    }
    if (partA.type === "file" && partA.path !== (partB as FileAttachmentPart).path) {
      return false
    }
    if (partA.type === "agent" && partA.name !== (partB as AgentPart).name) {
      return false
    }
    if (partA.type === "image" && partA.id !== (partB as ImageAttachmentPart).id) {
      return false
    }
  }
  return true
}

function cloneSelection(selection?: TextSelection) {
  if (!selection) return undefined
  return { ...selection }
}

function clonePart(part: ContentPart): ContentPart {
  if (part.type === "text") return { ...part }
  if (part.type === "image") return { ...part }
  if (part.type === "agent") return { ...part }
  return {
    ...part,
    selection: cloneSelection(part.selection),
  }
}

function clonePrompt(prompt: Prompt): Prompt {
  return prompt.map(clonePart)
}

export const { use: usePrompt, provider: PromptProvider } = createSimpleContext<
  ReturnType<typeof createPromptContext>,
  { paneId?: string }
>({
  name: "Prompt",
  init: (props) => createPromptContext(() => props?.paneId),
})

type PromptEntry = {
  prompt: Prompt
  cursor?: number
}

type PromptStore = {
  entries: Record<string, PromptEntry>
}

function createDefaultEntry(): PromptEntry {
  return {
    prompt: clonePrompt(DEFAULT_PROMPT),
    cursor: undefined,
  }
}

function createPromptContext(paneId?: string | Accessor<string | undefined>) {
  const params = useParams()
  const getPaneId = typeof paneId === "function" ? paneId : () => paneId

  const [paneStore, setPaneStore] = createStore<PromptStore>({
    entries: {},
  })

  const key = createMemo(() => `${params.dir}/prompt${params.id ? "/" + params.id : ""}.v1`)
  const [store, setStore, _, ready] = persisted(
    "prompt.v2",
    createStore<PromptStore>({
      entries: {},
    }),
  )

  const currentEntry = createMemo(() => {
    const pane = getPaneId()
    if (pane) {
      return paneStore.entries[pane] ?? createDefaultEntry()
    }
    return store.entries[key()] ?? createDefaultEntry()
  })

  const updateEntry = (updater: (entry: PromptEntry) => PromptEntry) => {
    const pane = getPaneId()
    if (pane) {
      const base = paneStore.entries[pane] ?? createDefaultEntry()
      setPaneStore("entries", pane, updater(base))
      return
    }
    const next = updater(currentEntry())
    setStore("entries", key(), next)
  }

  const isReady = () => {
    if (getPaneId()) return true
    return ready()
  }

  return createPromptMethods(() => currentEntry(), updateEntry, isReady)
}

function createPromptMethods(
  getEntry: () => PromptEntry,
  updateEntry: (updater: (entry: PromptEntry) => PromptEntry) => void,
  ready: () => boolean,
) {
  const currentEntry = createMemo(() => getEntry())
  const currentPrompt = createMemo(() => currentEntry().prompt)
  return {
    ready,
    current: createMemo(() => currentPrompt()),
    cursor: createMemo(() => currentEntry().cursor),
    dirty: createMemo(() => !isPromptEqual(currentPrompt(), DEFAULT_PROMPT)),
    set(prompt: Prompt, cursorPosition?: number) {
      const next = clonePrompt(prompt)
      batch(() => {
        updateEntry((entry) => ({
          prompt: next,
          cursor: cursorPosition !== undefined ? cursorPosition : entry.cursor,
        }))
      })
    },
    reset() {
      batch(() => {
        updateEntry(() => ({
          prompt: clonePrompt(DEFAULT_PROMPT),
          cursor: 0,
        }))
      })
    },
  }
}

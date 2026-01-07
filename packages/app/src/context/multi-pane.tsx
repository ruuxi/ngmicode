import { createStore, produce } from "solid-js/store"
import { batch, createMemo } from "solid-js"
import { createSimpleContext } from "@opencode-ai/ui/context"

export type PaneConfig = {
  id: string
  directory?: string
  sessionId?: string
}

export type PaneLayout = {
  columns: number
  rows: number
}

type MultiPaneState = {
  panes: PaneConfig[]
  currentPage: number
  focusedPaneId?: string
  maximizedPaneId?: string
}

const MAX_PANES_PER_PAGE = 12
const MAX_TOTAL_PANES = 48 // 4 pages worth

function generatePaneId() {
  return Math.random().toString(36).slice(2, 10)
}

function calculateLayout(paneCount: number): PaneLayout {
  if (paneCount <= 1) return { columns: 1, rows: 1 }
  if (paneCount === 2) return { columns: 2, rows: 1 }
  if (paneCount <= 4) return { columns: 2, rows: 2 }
  if (paneCount <= 6) return { columns: 3, rows: 2 }
  if (paneCount <= 8) return { columns: 4, rows: 2 }
  if (paneCount <= 9) return { columns: 3, rows: 3 }
  return { columns: 4, rows: 3 }
}

export const { use: useMultiPane, provider: MultiPaneProvider } = createSimpleContext({
  name: "MultiPane",
  init: () => {
    const [store, setStore] = createStore<MultiPaneState>({
      panes: [],
      currentPage: 0,
      focusedPaneId: undefined,
      maximizedPaneId: undefined,
    })

    const totalPages = createMemo(() => Math.max(1, Math.ceil(store.panes.length / MAX_PANES_PER_PAGE)))

    const visiblePanes = createMemo(() => {
      const start = store.currentPage * MAX_PANES_PER_PAGE
      const end = start + MAX_PANES_PER_PAGE
      return store.panes.slice(start, end)
    })

    const layout = createMemo(() => calculateLayout(visiblePanes().length))

    const focusedPane = createMemo(() => {
      if (!store.focusedPaneId) return visiblePanes()[0]
      return store.panes.find((p) => p.id === store.focusedPaneId)
    })

    return {
      panes: createMemo(() => store.panes),
      visiblePanes,
      currentPage: createMemo(() => store.currentPage),
      totalPages,
      layout,
      focusedPaneId: createMemo(() => store.focusedPaneId),
      focusedPane,
      maximizedPaneId: createMemo(() => store.maximizedPaneId),

      addPane(directory?: string, sessionId?: string, options?: { focus?: boolean }) {
        if (store.panes.length >= MAX_TOTAL_PANES) {
          return undefined
        }
        const id = generatePaneId()
        const pane: PaneConfig = { id, directory, sessionId }
        setStore("panes", [...store.panes, pane])
        const shouldFocus = options?.focus ?? true
        if (shouldFocus) {
          setStore("focusedPaneId", id)
        }
        // Use length-1 because pages are 0-indexed (12 panes with perPage=12 should be page 0)
        const newPage = Math.floor((store.panes.length - 1) / MAX_PANES_PER_PAGE)
        if (newPage !== store.currentPage) {
          setStore("currentPage", newPage)
        }
        return id
      },

      removePane(id: string) {
        const index = store.panes.findIndex((p) => p.id === id)
        if (index === -1) return

        const remaining = store.panes.filter((p) => p.id !== id)
        const isMaximized = store.maximizedPaneId === id

        batch(() => {
          setStore("panes", remaining)

          if (store.focusedPaneId === id) {
            const newFocus = remaining[Math.min(index, remaining.length - 1)]
            setStore("focusedPaneId", newFocus?.id)
          }

          if (isMaximized) {
            setStore("maximizedPaneId", undefined)
          }

          const newTotalPages = Math.max(1, Math.ceil(remaining.length / MAX_PANES_PER_PAGE))
          if (store.currentPage >= newTotalPages) {
            setStore("currentPage", newTotalPages - 1)
          }
        })
      },

      updatePane(id: string, updates: Partial<Omit<PaneConfig, "id">>) {
        const index = store.panes.findIndex((p) => p.id === id)
        if (index === -1) return
        setStore("panes", index, (pane) => ({ ...pane, ...updates }))
      },

      setFocused(id: string) {
        if (store.panes.find((p) => p.id === id)) {
          setStore("focusedPaneId", id)
        }
      },

      nextPage() {
        if (store.currentPage < totalPages() - 1) {
          setStore("currentPage", store.currentPage + 1)
        }
      },

      prevPage() {
        if (store.currentPage > 0) {
          setStore("currentPage", store.currentPage - 1)
        }
      },

      goToPage(page: number) {
        if (page >= 0 && page < totalPages()) {
          setStore("currentPage", page)
        }
      },

      movePane(id: string, toIndex: number) {
        const index = store.panes.findIndex((p) => p.id === id)
        if (index === -1) return

        const clampedIndex = Math.max(0, Math.min(toIndex, store.panes.length - 1))
        if (clampedIndex === index) return

        setStore(
          "panes",
          produce((panes) => {
            panes.splice(clampedIndex, 0, panes.splice(index, 1)[0])
          }),
        )
      },

      focusPaneByIndex(index: number) {
        const pane = visiblePanes()[index]
        if (pane) {
          setStore("focusedPaneId", pane.id)
        }
      },

      clear() {
        batch(() => {
          setStore("panes", [])
          setStore("currentPage", 0)
          setStore("focusedPaneId", undefined)
          setStore("maximizedPaneId", undefined)
        })
      },

      clonePane(id: string) {
        const pane = store.panes.find((p) => p.id === id)
        if (!pane || store.panes.length >= MAX_TOTAL_PANES) return undefined

        const newId = generatePaneId()
        const clonedPane: PaneConfig = {
          id: newId,
          directory: pane.directory,
          sessionId: pane.sessionId,
        }

        const index = store.panes.findIndex((p) => p.id === id)
        const newPanes = [...store.panes]
        newPanes.splice(index + 1, 0, clonedPane)

        batch(() => {
          setStore("panes", newPanes)
          setStore("focusedPaneId", newId)
        })

        const newPage = Math.floor(index / MAX_PANES_PER_PAGE)
        if (newPage !== store.currentPage) {
          setStore("currentPage", newPage)
        }

        return newId
      },

      toggleMaximize(id: string) {
        if (store.maximizedPaneId === id) {
          setStore("maximizedPaneId", undefined)
        } else {
          batch(() => {
            setStore("maximizedPaneId", id)
            setStore("focusedPaneId", id)
          })
        }
      },
    }
  },
})

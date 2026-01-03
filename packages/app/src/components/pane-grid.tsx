import { For, Show, createMemo, onCleanup, type ParentProps } from "solid-js"
import { useMultiPane, type PaneConfig } from "@/context/multi-pane"

const MIN_PANE_WIDTH_PERCENT = 15
const MIN_PANE_HEIGHT_PX = 80
const MAX_PANE_HEIGHT_RATIO = 0.8

type PaneGridProps = ParentProps<{
  panes: PaneConfig[]
  renderPane: (pane: PaneConfig) => any
}>

export function PaneGrid(props: PaneGridProps) {
  const multiPane = useMultiPane()
  let containerRef: HTMLDivElement | undefined
  let activeResizeCleanup: (() => void) | null = null

  onCleanup(() => activeResizeCleanup?.())

  const layout = createMemo(() => multiPane.layout())
  const customWidths = createMemo(() => multiPane.customWidths())
  const customHeights = createMemo(() => multiPane.customHeights())

  const rows = createMemo(() => {
    const panes = props.panes
    const cols = layout().columns
    const result: PaneConfig[][] = []

    for (let i = 0; i < panes.length; i += cols) {
      result.push(panes.slice(i, i + cols))
    }

    return result
  })

  const defaultColumnWidth = createMemo(() => {
    const cols = layout().columns
    return 100 / cols
  })

  const getRowHeight = (rowIndex: number, rowCount: number) => {
    const custom = customHeights()[rowIndex]
    if (custom) return `${custom}px`
    return `${100 / rowCount}%`
  }

  function handleColumnResize(rowIndex: number, colIndex: number, newWidthPercent: number) {
    const row = rows()[rowIndex]
    if (!row || colIndex >= row.length - 1) return

    const currentPane = row[colIndex]
    const nextPane = row[colIndex + 1]

    const currentWidth = customWidths()[currentPane.id] ?? defaultColumnWidth()
    const nextWidth = customWidths()[nextPane.id] ?? defaultColumnWidth()
    const totalWidth = currentWidth + nextWidth

    const clampedWidth = Math.max(MIN_PANE_WIDTH_PERCENT, Math.min(newWidthPercent, totalWidth - MIN_PANE_WIDTH_PERCENT))
    const newNextWidth = totalWidth - clampedWidth

    multiPane.setPaneWidth(currentPane.id, clampedWidth)
    multiPane.setPaneWidth(nextPane.id, newNextWidth)
  }

  function handleRowResize(rowIndex: number, newHeight: number) {
    multiPane.setRowHeight(rowIndex, newHeight)
  }

  function createColumnResizeHandler(rowIndex: number, colIndex: number, paneId: string) {
    return (e: MouseEvent) => {
      e.preventDefault()
      const startX = e.clientX
      const containerWidth = containerRef?.clientWidth ?? window.innerWidth
      const startWidth = customWidths()[paneId] ?? defaultColumnWidth()

      document.body.style.userSelect = "none"
      document.body.style.cursor = "col-resize"

      const onMouseMove = (moveEvent: MouseEvent) => {
        const deltaX = moveEvent.clientX - startX
        const deltaPercent = (deltaX / containerWidth) * 100
        const newWidth = startWidth + deltaPercent
        handleColumnResize(rowIndex, colIndex, newWidth)
      }

      const cleanup = () => {
        document.body.style.userSelect = ""
        document.body.style.cursor = ""
        document.removeEventListener("mousemove", onMouseMove)
        document.removeEventListener("mouseup", onMouseUp)
        activeResizeCleanup = null
      }

      const onMouseUp = () => cleanup()

      activeResizeCleanup = cleanup
      document.addEventListener("mousemove", onMouseMove)
      document.addEventListener("mouseup", onMouseUp)
    }
  }

  function createRowResizeHandler(rowIndex: number) {
    return (e: MouseEvent) => {
      e.preventDefault()
      const startY = e.clientY
      const containerHeight = containerRef?.clientHeight ?? window.innerHeight
      const startHeight = customHeights()[rowIndex] ?? containerHeight / rows().length

      document.body.style.userSelect = "none"
      document.body.style.cursor = "row-resize"

      const onMouseMove = (moveEvent: MouseEvent) => {
        const deltaY = moveEvent.clientY - startY
        const newHeight = Math.max(MIN_PANE_HEIGHT_PX, Math.min(startHeight + deltaY, containerHeight * MAX_PANE_HEIGHT_RATIO))
        handleRowResize(rowIndex, newHeight)
      }

      const cleanup = () => {
        document.body.style.userSelect = ""
        document.body.style.cursor = ""
        document.removeEventListener("mousemove", onMouseMove)
        document.removeEventListener("mouseup", onMouseUp)
        activeResizeCleanup = null
      }

      const onMouseUp = () => cleanup()

      activeResizeCleanup = cleanup
      document.addEventListener("mousemove", onMouseMove)
      document.addEventListener("mouseup", onMouseUp)
    }
  }

  return (
    <div ref={containerRef} class="flex-1 min-h-0 flex flex-col">
      <For each={rows()}>
        {(row, rowIndex) => (
          <>
            <div
              class="flex min-h-0"
              style={{ height: getRowHeight(rowIndex(), rows().length) }}
            >
              <For each={row}>
                {(pane, colIndex) => {
                  const isLastInRow = createMemo(() => colIndex() === row.length - 1)
                  const paneWidth = createMemo(() => {
                    const custom = customWidths()[pane.id]
                    return custom ?? defaultColumnWidth()
                  })

                  return (
                    <>
                      <div
                        class="relative min-w-0 min-h-0"
                        style={{ width: `${paneWidth()}%` }}
                      >
                        {props.renderPane(pane)}
                      </div>
                      <Show when={!isLastInRow()}>
                        <div
                          class="w-1 shrink-0 cursor-col-resize hover:bg-border-accent-base active:bg-border-accent-base transition-colors"
                          onMouseDown={createColumnResizeHandler(rowIndex(), colIndex(), pane.id)}
                        />
                      </Show>
                    </>
                  )
                }}
              </For>
            </div>
            <Show when={rowIndex() < rows().length - 1}>
              <div
                class="h-1 shrink-0 cursor-row-resize hover:bg-border-accent-base active:bg-border-accent-base transition-colors"
                onMouseDown={createRowResizeHandler(rowIndex())}
              />
            </Show>
          </>
        )}
      </For>
    </div>
  )
}

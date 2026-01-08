import { For, Show, createMemo, createSignal, createEffect, untrack, onCleanup, type ParentProps } from "solid-js"
import { Portal } from "solid-js/web"
import { useMultiPane, type PaneConfig } from "@/context/multi-pane"
import { useRadialDial } from "@/hooks/use-radial-dial"
import { RadialDialMenu } from "@opencode-ai/ui/radial-dial-menu"

const FLIP_DURATION = 200
const GRID_GAP = 6
const CORNER_HIT_SIZE = 10
const MIN_PANE_WIDTH = 240
const MIN_PANE_HEIGHT = 180
const MIN_TRACK_SLACK = 0.1

type PaneGridProps = ParentProps<{
  panes: PaneConfig[]
  renderPane: (pane: PaneConfig) => any
}>

export function PaneGrid(props: PaneGridProps) {
  const multiPane = useMultiPane()
  let containerRef: HTMLDivElement | undefined
  const paneRefs = new Map<string, HTMLDivElement>()
  const paneContentRefs = new Map<string, HTMLDivElement>()
  let previousRects = new Map<string, DOMRect>()
  let disposed = false
  let resizeCleanup: (() => void) | null = null

  const layout = createMemo(() => multiPane.layout())
  const maximizedPaneId = createMemo(() => multiPane.maximizedPaneId())
  const [paneIds, setPaneIds] = createSignal<string[]>([])
  const [lastPage, setLastPage] = createSignal(multiPane.currentPage())

  // Radial dial for the entire grid area
  const radialDial = useRadialDial({
    onAction: (action) => {
      const focusedId = multiPane.focusedPaneId()
      const focusedPane = multiPane.focusedPane()
      switch (action) {
        case "new":
          multiPane.addPane(focusedPane?.directory)
          break
        case "close":
          if (focusedId) multiPane.removePane(focusedId)
          break
        case "clone":
          if (focusedId) {
            multiPane.clonePane(focusedId)
          }
          break
        case "focus":
          if (focusedId) {
            multiPane.toggleMaximize(focusedId)
          }
          break
      }
    },
  })

  onCleanup(() => {
    disposed = true
    resizeCleanup?.()
    paneRefs.clear()
    paneContentRefs.clear()
    previousRects.clear()
  })

  // Capture current positions of all panes
  function capturePositions(): Map<string, DOMRect> {
    const rects = new Map<string, DOMRect>()
    for (const [id, el] of paneRefs) {
      rects.set(id, el.getBoundingClientRect())
    }
    return rects
  }

  // Watch for pane changes and animate
  createEffect(() => {
    maximizedPaneId()
    const currentIds = props.panes.map((p) => p.id)
    const prevIds = untrack(() => paneIds())
    const currentPage = multiPane.currentPage()
    const prevPage = untrack(() => lastPage())

    // Update tracked state (untracked to prevent re-triggering)
    untrack(() => {
      setPaneIds(currentIds)
      setLastPage(currentPage)
    })

    // Skip initial mount
    if (prevIds.length === 0) {
      requestAnimationFrame(() => {
        if (disposed) return
        previousRects = capturePositions()
      })
      return
    }

    // Skip animation on page switch (just capture new positions)
    if (currentPage !== prevPage) {
      requestAnimationFrame(() => {
        if (disposed) return
        previousRects = capturePositions()
      })
      return
    }

    // Clean up refs for removed panes
    const currentIdSet = new Set(currentIds)
    for (const id of prevIds) {
      if (!currentIdSet.has(id)) {
        paneRefs.delete(id)
        paneContentRefs.delete(id)
      }
    }

    // Wait for DOM to update with new panes
    requestAnimationFrame(() => {
      if (disposed) return
      const prevIdSet = new Set(prevIds)

      for (const [id, el] of paneRefs) {
        const content = paneContentRefs.get(id)
        const isNew = !prevIdSet.has(id)
        const prevRect = previousRects.get(id)

        if (isNew || !prevRect) {
          const scale = 0.95
          // New pane - fade in using Web Animations API
          el.animate(
            [
              { opacity: 0, transform: `scale(${scale})`, transformOrigin: "center" },
              { opacity: 1, transform: "scale(1)", transformOrigin: "center" },
            ],
            { duration: FLIP_DURATION, easing: "ease-out" },
          )
          content?.animate(
            [
              { transform: `scale(${1 / scale})`, transformOrigin: "center" },
              { transform: "none", transformOrigin: "center" },
            ],
            { duration: FLIP_DURATION, easing: "ease-out" },
          )
          continue
        }

        const currentRect = el.getBoundingClientRect()
        const deltaX = prevRect.left - currentRect.left
        const deltaY = prevRect.top - currentRect.top
        const scaleX = prevRect.width / currentRect.width
        const scaleY = prevRect.height / currentRect.height

        // Skip if no significant change
        if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1 && Math.abs(scaleX - 1) < 0.01 && Math.abs(scaleY - 1) < 0.01) {
          continue
        }

        // FLIP animation using Web Animations API
        el.animate(
          [
            { transform: `translate(${deltaX}px, ${deltaY}px) scale(${scaleX}, ${scaleY})`, transformOrigin: "top left" },
            { transform: "none", transformOrigin: "top left" },
          ],
          { duration: FLIP_DURATION, easing: "ease-out" },
        )

        content?.animate(
          [
            { transform: `scale(${1 / scaleX}, ${1 / scaleY})`, transformOrigin: "top left" },
            { transform: "none", transformOrigin: "top left" },
          ],
          { duration: FLIP_DURATION, easing: "ease-out" },
        )
      }

      // Capture new positions after animation
      setTimeout(() => {
        if (disposed) return
        previousRects = capturePositions()
      }, FLIP_DURATION)
    })
  })

  const [colSizes, setColSizes] = createSignal<number[] | null>(null)
  const [rowSizes, setRowSizes] = createSignal<number[] | null>(null)

  createEffect(() => {
    const page = multiPane.currentPage()
    const nextLayout = layout()
    const saved = untrack(() => multiPane.grid.get(page, nextLayout))
    setColSizes(saved.colSizes ?? null)
    setRowSizes(saved.rowSizes ?? null)
  })

  function sum(values: number[]) {
    return values.reduce((a, b) => a + b, 0)
  }

  function minTrackPx(count: number, containerSize: number, baseMin: number) {
    const safeCount = Math.max(count, 1)
    const totalGapSpace = (safeCount - 1) * GRID_GAP
    const availableSpace = Math.max(containerSize - totalGapSpace, 1)
    const usableSpace = Math.max(availableSpace * (1 - MIN_TRACK_SLACK), 1)
    return Math.min(baseMin, usableSpace / safeCount)
  }

  function handleCenterPx(count: number, sizes: number[], index: number, containerSize: number) {
    const totalGapSpace = (count - 1) * GRID_GAP
    const availableSpace = Math.max(containerSize - totalGapSpace, 1)
    const totalFr = sum(sizes)
    const beforeFr = sum(sizes.slice(0, index + 1))
    const fraction = beforeFr / totalFr
    return availableSpace * fraction + index * GRID_GAP + GRID_GAP / 2
  }

  function resizeAdjacent(
    count: number,
    startSizes: number[],
    index: number,
    handlePos: number,
    containerSize: number,
    minPx: number,
  ) {
    const totalGapSpace = (count - 1) * GRID_GAP
    const availableSpace = Math.max(containerSize - totalGapSpace, 1)
    const totalFr = sum(startSizes)
    const startPx = startSizes.map((s) => (s / totalFr) * availableSpace)
    const beforePx = sum(startPx.slice(0, index))
    const afterPx = sum(startPx.slice(index + 2))
    const pairSpace = availableSpace - beforePx - afterPx
    if (pairSpace <= 1) return startSizes

    const contentPosBefore = handlePos - index * GRID_GAP - GRID_GAP / 2
    const desiredLeft = contentPosBefore - beforePx
    const minPairPx = Math.min(minPx, pairSpace / 2)
    const leftPx = Math.min(Math.max(desiredLeft, minPairPx), pairSpace - minPairPx)
    const rightPx = pairSpace - leftPx
    const nextSizes = [...startSizes]
    nextSizes[index] = (leftPx / availableSpace) * totalFr
    nextSizes[index + 1] = (rightPx / availableSpace) * totalFr
    return nextSizes
  }

  // Use fr units for proper gap handling
  const actualGridCols = createMemo(() => {
    const cols = layout().columns
    const sizes = colSizes()
    if (sizes && sizes.length === cols) {
      return sizes.map((s) => `${s}fr`).join(" ")
    }
    return `repeat(${cols}, 1fr)`
  })

  const actualGridRows = createMemo(() => {
    const rows = layout().rows
    const sizes = rowSizes()
    if (sizes && sizes.length === rows) {
      return sizes.map((s) => `${s}fr`).join(" ")
    }
    return `repeat(${rows}, 1fr)`
  })

  function handleResizeStart(type: "col" | "row", index: number, e: MouseEvent) {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const count = type === "col" ? layout().columns : layout().rows

    // Initialize sizes if not set
    const currentSizes = type === "col" ? colSizes() : rowSizes()
    const startSizes = currentSizes && currentSizes.length === count ? currentSizes : Array(count).fill(1)

    const startRect = containerRef?.getBoundingClientRect()
    if (!startRect) return
    const startContainerSize = type === "col" ? startRect.width : startRect.height
    const startCursorPos = type === "col" ? e.clientX - startRect.left : e.clientY - startRect.top
    const startHandlePos = handleCenterPx(count, startSizes, index, startContainerSize)
    const cursorOffset = startCursorPos - startHandlePos

    document.body.style.userSelect = "none"
    document.body.style.cursor = type === "col" ? "col-resize" : "row-resize"

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!containerRef) return

      const rect = containerRef.getBoundingClientRect()
      const containerSize = type === "col" ? rect.width : rect.height
      const cursorPos = type === "col" ? moveEvent.clientX - rect.left : moveEvent.clientY - rect.top
      const handlePos = cursorPos - cursorOffset
      const minPx = type === "col" ? minTrackPx(count, containerSize, MIN_PANE_WIDTH) : minTrackPx(count, containerSize, MIN_PANE_HEIGHT)
      const newSizes = resizeAdjacent(count, startSizes, index, handlePos, containerSize, minPx)

      if (type === "col") {
        setColSizes(newSizes)
        return
      }
      setRowSizes(newSizes)
    }

    const cleanup = () => {
      document.body.style.userSelect = ""
      document.body.style.cursor = ""
      document.removeEventListener("mousemove", onMouseMove)
      document.removeEventListener("mouseup", onMouseUp)
      const page = multiPane.currentPage()
      const nextLayout = layout()
      if (type === "col") {
        const sizes = colSizes()
        if (sizes && sizes.length === nextLayout.columns) multiPane.grid.set(page, nextLayout, { colSizes: sizes })
        resizeCleanup = null
        return
      }
      const sizes = rowSizes()
      if (sizes && sizes.length === nextLayout.rows) multiPane.grid.set(page, nextLayout, { rowSizes: sizes })
      resizeCleanup = null
    }

    const onMouseUp = () => cleanup()

    resizeCleanup = cleanup
    document.addEventListener("mousemove", onMouseMove)
    document.addEventListener("mouseup", onMouseUp)
  }

  function handleCornerResizeStart(colIndex: number, rowIndex: number, e: MouseEvent) {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const cols = layout().columns
    const rows = layout().rows
    const currentCols = colSizes()
    const currentRows = rowSizes()
    const startCols = currentCols && currentCols.length === cols ? currentCols : Array(cols).fill(1)
    const startRows = currentRows && currentRows.length === rows ? currentRows : Array(rows).fill(1)

    const startRect = containerRef?.getBoundingClientRect()
    if (!startRect) return
    const startColPos = e.clientX - startRect.left
    const startRowPos = e.clientY - startRect.top
    const startHandleX = handleCenterPx(cols, startCols, colIndex, startRect.width)
    const startHandleY = handleCenterPx(rows, startRows, rowIndex, startRect.height)
    const cursorOffsetX = startColPos - startHandleX
    const cursorOffsetY = startRowPos - startHandleY

    document.body.style.userSelect = "none"
    document.body.style.cursor = "nwse-resize"

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!containerRef) return

      const rect = containerRef.getBoundingClientRect()
      const colPos = moveEvent.clientX - rect.left
      const rowPos = moveEvent.clientY - rect.top
      const handleX = colPos - cursorOffsetX
      const handleY = rowPos - cursorOffsetY
      const minColPx = minTrackPx(cols, rect.width, MIN_PANE_WIDTH)
      const minRowPx = minTrackPx(rows, rect.height, MIN_PANE_HEIGHT)
      const newCols = resizeAdjacent(cols, startCols, colIndex, handleX, rect.width, minColPx)
      const newRows = resizeAdjacent(rows, startRows, rowIndex, handleY, rect.height, minRowPx)

      setColSizes(newCols)
      setRowSizes(newRows)
    }

    const cleanup = () => {
      document.body.style.userSelect = ""
      document.body.style.cursor = ""
      document.removeEventListener("mousemove", onMouseMove)
      document.removeEventListener("mouseup", onMouseUp)
      const page = multiPane.currentPage()
      const nextLayout = layout()
      const nextCols = colSizes()
      const nextRows = rowSizes()
      if (nextCols && nextCols.length === cols && nextRows && nextRows.length === rows && nextLayout.columns === cols && nextLayout.rows === rows) {
        multiPane.grid.set(page, nextLayout, { colSizes: nextCols, rowSizes: nextRows })
      }
      resizeCleanup = null
    }

    const onMouseUp = () => cleanup()

    resizeCleanup = cleanup
    document.addEventListener("mousemove", onMouseMove)
    document.addEventListener("mouseup", onMouseUp)
  }

  const colPositions = createMemo(() => {
    const cols = layout().columns
    const sizes = colSizes() ?? Array(cols).fill(1)
    const total = sizes.reduce((a, b) => a + b, 0)
    const totalGaps = (cols - 1) * GRID_GAP
    return Array.from({ length: cols - 1 }, (_, index) => {
      const before = sizes.slice(0, index + 1).reduce((a, b) => a + b, 0)
      const fraction = before / total
      const pxOffset = -fraction * totalGaps + index * GRID_GAP + GRID_GAP / 2
      return `calc(${fraction * 100}% + ${pxOffset}px)`
    })
  })

  const rowPositions = createMemo(() => {
    const rows = layout().rows
    const sizes = rowSizes() ?? Array(rows).fill(1)
    const total = sizes.reduce((a, b) => a + b, 0)
    const totalGaps = (rows - 1) * GRID_GAP
    return Array.from({ length: rows - 1 }, (_, index) => {
      const before = sizes.slice(0, index + 1).reduce((a, b) => a + b, 0)
      const fraction = before / total
      const pxOffset = -fraction * totalGaps + index * GRID_GAP + GRID_GAP / 2
      return `calc(${fraction * 100}% + ${pxOffset}px)`
    })
  })

  const cornerPositions = createMemo(() => {
    const cols = colPositions()
    const rows = rowPositions()
    return cols.flatMap((left, colIndex) =>
      rows.map((top, rowIndex) => ({
        left,
        top,
        col: colIndex,
        row: rowIndex,
      })),
    )
  })

  function paneStyle(index: number) {
    const cols = layout().columns
    const rows = layout().rows
    const count = props.panes.length
    if (rows < 2) return undefined
    const remainder = count % cols
    if (remainder === 0) return undefined
    const rowAbove = rows - 1
    const rowAboveStart = (rows - 2) * cols
    const rowAboveEnd = rowAboveStart + cols - 1
    if (index < rowAboveStart || index > rowAboveEnd) return undefined
    const colIndex = index - rowAboveStart
    if (colIndex < remainder) return undefined
    const startCol = colIndex + 1
    return {
      "grid-column": `${startCol} / span 1`,
      "grid-row": `${rowAbove} / span 2`,
    }
  }

  function paneWrapperStyle(id: string, index: number) {
    const base = paneStyle(index)
    const max = maximizedPaneId()
    if (!max) return base
    if (id !== max) return base
    return {
      position: "absolute",
      inset: "0",
      "z-index": "20",
    }
  }

  return (
    <div
      ref={containerRef}
      class="flex-1 min-h-0 relative"
      onMouseDown={radialDial.handlers.onMouseDown}
      onMouseMove={radialDial.handlers.onMouseMove}
      onMouseUp={radialDial.handlers.onMouseUp}
      onContextMenu={radialDial.handlers.onContextMenu}
    >
      {/* Main grid */}
      <div
        class="size-full grid"
        style={{
          "grid-template-columns": actualGridCols(),
          "grid-template-rows": actualGridRows(),
          gap: `${GRID_GAP}px`,
        }}
      >
        <For each={props.panes}>
          {(pane, index) => {
            const hidden = createMemo(() => {
              const max = maximizedPaneId()
              if (!max) return false
              return pane.id !== max
            })

            return (
              <div
                ref={(el) => paneRefs.set(pane.id, el)}
                class="relative min-w-0 min-h-0 overflow-hidden"
                classList={{ "pointer-events-none": hidden() }}
                style={paneWrapperStyle(pane.id, index())}
              >
                <div
                  class="size-full transition-[opacity,transform] duration-200 ease-out"
                  style={{
                    opacity: hidden() ? 0 : 1,
                    transform: hidden() ? "scale(0.98)" : "scale(1)",
                  }}
                >
                  <div ref={(el) => paneContentRefs.set(pane.id, el)} class="size-full">
                    {props.renderPane(pane)}
                  </div>
                </div>
              </div>
            )
          }}
        </For>
      </div>

      <Show when={!maximizedPaneId()}>
        {/* Corner resize handles */}
        <For each={cornerPositions()}>
          {(corner) => (
            <div
              class="absolute -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize z-20"
              style={{
                left: corner.left,
                top: corner.top,
                width: `${CORNER_HIT_SIZE}px`,
                height: `${CORNER_HIT_SIZE}px`,
              }}
              onMouseDown={(e) => handleCornerResizeStart(corner.col, corner.row, e)}
            />
          )}
        </For>

        {/* Column resize handles */}
        <For each={colPositions()}>
          {(handlePos, index) => {
            return (
              <div
                class="absolute top-0 bottom-0 w-3 -translate-x-1/2 cursor-col-resize z-10 group"
                style={{ left: handlePos }}
                onMouseDown={(e) => handleResizeStart("col", index(), e)}
              >
                <div class="absolute inset-y-0 left-1/2 -translate-x-1/2 w-0.5 group-hover:bg-border-accent-base group-active:bg-border-accent-base transition-colors duration-75" />
              </div>
            )
          }}
        </For>

        {/* Row resize handles */}
        <For each={rowPositions()}>
          {(handlePos, index) => {
            return (
              <div
                class="absolute left-0 right-0 h-3 -translate-y-1/2 cursor-row-resize z-10 group"
                style={{ top: handlePos }}
                onMouseDown={(e) => handleResizeStart("row", index(), e)}
              >
                <div class="absolute inset-x-0 top-1/2 -translate-y-1/2 h-0.5 group-hover:bg-border-accent-base group-active:bg-border-accent-base transition-colors duration-75" />
              </div>
            )
          }}
        </For>
      </Show>

      {/* Radial dial menu */}
      <Show when={radialDial.isOpen()}>
        <Portal>
          <RadialDialMenu
            centerX={radialDial.centerX()}
            centerY={radialDial.centerY()}
            highlightedAction={radialDial.highlightedAction()}
          />
        </Portal>
      </Show>
    </div>
  )
}

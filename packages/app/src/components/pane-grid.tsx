import { For, Show, createMemo, createSignal, createEffect, untrack, onCleanup, type ParentProps } from "solid-js"
import { Portal } from "solid-js/web"
import { useMultiPane, type PaneConfig } from "@/context/multi-pane"
import { useRadialDial } from "@/hooks/use-radial-dial"
import { RadialDialMenu } from "@opencode-ai/ui/radial-dial-menu"

const MAX_GRID_COLS = 4
const MAX_GRID_ROWS = 3
const MIN_COL_FRACTION = 1 / MAX_GRID_COLS
const MIN_ROW_FRACTION = 1 / MAX_GRID_ROWS
const FLIP_DURATION = 200
const GRID_GAP = 6
const CORNER_HIT_SIZE = 10

type PaneGridProps = ParentProps<{
  panes: PaneConfig[]
  renderPane: (pane: PaneConfig) => any
}>

export function PaneGrid(props: PaneGridProps) {
  const multiPane = useMultiPane()
  let containerRef: HTMLDivElement | undefined
  const paneRefs = new Map<string, HTMLDivElement>()
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
          if (focusedId && multiPane.panes().length > 1) {
            multiPane.removePane(focusedId)
          }
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
      }
    }

    // Wait for DOM to update with new panes
    requestAnimationFrame(() => {
      if (disposed) return
      const prevIdSet = new Set(prevIds)

      for (const [id, el] of paneRefs) {
        const isNew = !prevIdSet.has(id)
        const prevRect = previousRects.get(id)

        if (isNew || !prevRect) {
          // New pane - fade in using Web Animations API
          el.animate(
            [
              { opacity: 0, transform: "scale(0.95)" },
              { opacity: 1, transform: "scale(1)" },
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

  function buildSizes(
    count: number,
    startSizes: number[],
    index: number,
    cursorPos: number,
    containerSize: number,
    minFraction: number,
  ) {
    const totalGapSpace = (count - 1) * GRID_GAP
    const availableSpace = containerSize - totalGapSpace
    const safeSpace = Math.max(availableSpace, 1)
    const gapsBefore = index * GRID_GAP
    const contentPosBefore = cursorPos - gapsBefore - GRID_GAP / 2
    const totalFr = startSizes.reduce((a, b) => a + b, 0)
    const minFr = minFraction * totalFr
    const unclampedBefore = (contentPosBefore / safeSpace) * totalFr
    const beforeFr = Math.min(Math.max(unclampedBefore, minFr), totalFr - minFr)
    const afterFr = totalFr - beforeFr
    const newSizes = [...startSizes]
    const sumBefore = startSizes.slice(0, index + 1).reduce((a, b) => a + b, 0)
    const sumAfter = startSizes.slice(index + 1).reduce((a, b) => a + b, 0)

    Array.from({ length: index + 1 }, (_, i) => i).forEach((i) => {
      newSizes[i] = (startSizes[i] / sumBefore) * beforeFr
    })
    Array.from({ length: count - index - 1 }, (_, offset) => offset + index + 1).forEach((i) => {
      newSizes[i] = (startSizes[i] / sumAfter) * afterFr
    })

    return newSizes
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
    e.preventDefault()
    const count = type === "col" ? layout().columns : layout().rows

    // Initialize sizes if not set
    const currentSizes = type === "col" ? colSizes() : rowSizes()
    const startSizes = currentSizes ?? Array(count).fill(1)

    document.body.style.userSelect = "none"
    document.body.style.cursor = type === "col" ? "col-resize" : "row-resize"

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!containerRef) return

      const rect = containerRef.getBoundingClientRect()
      const containerSize = type === "col" ? rect.width : rect.height
      const cursorPos = type === "col" ? moveEvent.clientX - rect.left : moveEvent.clientY - rect.top
      const minFraction = type === "col" ? MIN_COL_FRACTION : MIN_ROW_FRACTION
      const newSizes = buildSizes(count, startSizes, index, cursorPos, containerSize, minFraction)

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
    const cols = layout().columns
    const rows = layout().rows
    const startCols = colSizes() ?? Array(cols).fill(1)
    const startRows = rowSizes() ?? Array(rows).fill(1)

    document.body.style.userSelect = "none"
    document.body.style.cursor = "nwse-resize"

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!containerRef) return

      const rect = containerRef.getBoundingClientRect()
      const colPos = moveEvent.clientX - rect.left
      const rowPos = moveEvent.clientY - rect.top
      const newCols = buildSizes(cols, startCols, colIndex, colPos, rect.width, MIN_COL_FRACTION)
      const newRows = buildSizes(rows, startRows, rowIndex, rowPos, rect.height, MIN_ROW_FRACTION)

      setColSizes(newCols)
      setRowSizes(newRows)
    }

    const cleanup = () => {
      document.body.style.userSelect = ""
      document.body.style.cursor = ""
      document.removeEventListener("mousemove", onMouseMove)
      document.removeEventListener("mouseup", onMouseUp)
      resizeCleanup = null
    }

    const onMouseUp = () => cleanup()

    resizeCleanup = cleanup
    document.addEventListener("mousemove", onMouseMove)
    document.addEventListener("mouseup", onMouseUp)
  }

  // Reset custom sizes when layout changes
  let prevCols = layout().columns
  let prevRows = layout().rows
  createEffect(() => {
    const cols = layout().columns
    const rows = layout().rows
    if (cols !== prevCols) {
      setColSizes(null)
      prevCols = cols
    }
    if (rows !== prevRows) {
      setRowSizes(null)
      prevRows = rows
    }
  })

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

  const maximizedPane = createMemo(() => {
    const id = maximizedPaneId()
    return id ? props.panes.find((p) => p.id === id) : undefined
  })

  return (
    <div
      ref={containerRef}
      class="flex-1 min-h-0 relative"
      onMouseDown={radialDial.handlers.onMouseDown}
      onMouseMove={radialDial.handlers.onMouseMove}
      onMouseUp={radialDial.handlers.onMouseUp}
      onContextMenu={radialDial.handlers.onContextMenu}
    >
      <Show
        when={!maximizedPaneId()}
        fallback={
          <Show when={maximizedPane()}>
            {(pane) => (
              <div class="size-full">
                {props.renderPane(pane())}
              </div>
            )}
          </Show>
        }
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
            {(pane) => (
              <div
                ref={(el) => paneRefs.set(pane.id, el)}
                class="relative min-w-0 min-h-0 overflow-hidden"
              >
                {props.renderPane(pane)}
              </div>
            )}
          </For>
        </div>

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

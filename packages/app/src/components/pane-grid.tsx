import { For, createMemo, createSignal, createEffect, untrack, onCleanup, type ParentProps } from "solid-js"
import { useMultiPane, type PaneConfig } from "@/context/multi-pane"

const MIN_PANE_SIZE_PERCENT = 15
const FLIP_DURATION = 200
const GRID_GAP = 6

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
  const [paneIds, setPaneIds] = createSignal<string[]>([])
  const [lastPage, setLastPage] = createSignal(multiPane.currentPage())

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
    const gap = GRID_GAP

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

      // Account for gaps: total gap space = (count - 1) * gap
      const totalGapSpace = (count - 1) * gap
      const availableSpace = containerSize - totalGapSpace

      // Calculate cumulative gap space before this handle
      const gapsBefore = index * gap

      // The cursor position relative to available content space
      // Subtract the gaps that come before the handle position
      const contentPosBefore = cursorPos - gapsBefore - gap / 2
      const contentPosAfter = availableSpace - contentPosBefore

      // Convert to proportions
      const totalFr = startSizes.reduce((a, b) => a + b, 0)
      const minFr = (MIN_PANE_SIZE_PERCENT / 100) * totalFr

      // Calculate fr values based on cursor position
      let beforeFr = (contentPosBefore / availableSpace) * totalFr
      let afterFr = (contentPosAfter / availableSpace) * totalFr

      // Clamp to min size
      if (beforeFr < minFr) {
        beforeFr = minFr
        afterFr = totalFr - beforeFr
      } else if (afterFr < minFr) {
        afterFr = minFr
        beforeFr = totalFr - afterFr
      }

      // Distribute the fr values to the cells
      const newSizes = [...startSizes]

      // Sum of fr values before and after the handle
      const sumBefore = startSizes.slice(0, index + 1).reduce((a, b) => a + b, 0)
      const sumAfter = startSizes.slice(index + 1).reduce((a, b) => a + b, 0)

      // Scale each side proportionally
      for (let i = 0; i <= index; i++) {
        newSizes[i] = (startSizes[i] / sumBefore) * beforeFr
      }
      for (let i = index + 1; i < count; i++) {
        newSizes[i] = (startSizes[i] / sumAfter) * afterFr
      }

      if (type === "col") {
        setColSizes(newSizes)
      } else {
        setRowSizes(newSizes)
      }
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

  // Build resize handles
  const colHandles = createMemo(() => {
    const cols = layout().columns
    return Array.from({ length: cols - 1 }, (_, i) => i)
  })

  const rowHandles = createMemo(() => {
    const rows = layout().rows
    return Array.from({ length: rows - 1 }, (_, i) => i)
  })

  return (
    <div ref={containerRef} class="flex-1 min-h-0 relative">
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

      {/* Column resize handles */}
      <For each={colHandles()}>
        {(index) => {
          const handlePos = createMemo(() => {
            const cols = layout().columns
            const sizes = colSizes() ?? Array(cols).fill(1)
            const total = sizes.reduce((a, b) => a + b, 0)
            const before = sizes.slice(0, index + 1).reduce((a, b) => a + b, 0)
            const fraction = before / total
            const totalGaps = (cols - 1) * GRID_GAP
            // fraction% of container - fraction of gap space + gaps before handle + half gap
            const pxOffset = -fraction * totalGaps + index * GRID_GAP + GRID_GAP / 2
            return `calc(${fraction * 100}% + ${pxOffset}px)`
          })

          return (
            <div
              class="absolute top-0 bottom-0 w-3 -translate-x-1/2 cursor-col-resize z-10 group"
              style={{ left: handlePos() }}
              onMouseDown={(e) => handleResizeStart("col", index, e)}
            >
              <div class="absolute inset-y-0 left-1/2 -translate-x-1/2 w-0.5 group-hover:bg-border-accent-base group-active:bg-border-accent-base transition-colors duration-75" />
            </div>
          )
        }}
      </For>

      {/* Row resize handles */}
      <For each={rowHandles()}>
        {(index) => {
          const handlePos = createMemo(() => {
            const rows = layout().rows
            const sizes = rowSizes() ?? Array(rows).fill(1)
            const total = sizes.reduce((a, b) => a + b, 0)
            const before = sizes.slice(0, index + 1).reduce((a, b) => a + b, 0)
            const fraction = before / total
            const totalGaps = (rows - 1) * GRID_GAP
            const pxOffset = -fraction * totalGaps + index * GRID_GAP + GRID_GAP / 2
            return `calc(${fraction * 100}% + ${pxOffset}px)`
          })

          return (
            <div
              class="absolute left-0 right-0 h-3 -translate-y-1/2 cursor-row-resize z-10 group"
              style={{ top: handlePos() }}
              onMouseDown={(e) => handleResizeStart("row", index, e)}
            >
              <div class="absolute inset-x-0 top-1/2 -translate-y-1/2 h-0.5 group-hover:bg-border-accent-base group-active:bg-border-accent-base transition-colors duration-75" />
            </div>
          )
        }}
      </For>
    </div>
  )
}

import { Show, createMemo, onMount, createEffect, on } from "solid-js"
import { useSearchParams } from "@solidjs/router"
import { MultiPaneProvider, useMultiPane } from "@/context/multi-pane"
import { PaneToolbar } from "@/components/pane-toolbar"
import { PaneGrid } from "@/components/pane-grid"
import { SessionPane } from "@/components/session-pane"
import { useLayout } from "@/context/layout"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"

function MultiPaneContent() {
  const multiPane = useMultiPane()
  const layout = useLayout()
  const [searchParams, setSearchParams] = useSearchParams()

  const visiblePanes = createMemo(() => multiPane.visiblePanes())
  const hasPanes = createMemo(() => multiPane.panes().length > 0)

  const getLastProject = () => layout.projects.list()[0]?.worktree

  onMount(() => {
    const rawDir = searchParams.dir
    const rawSession = searchParams.session
    const rawNewTab = searchParams.newTab
    const dirFromUrl = typeof rawDir === "string" ? decodeURIComponent(rawDir) : undefined
    const sessionFromUrl = typeof rawSession === "string" ? rawSession : undefined
    const wantsNewTab = rawNewTab === "true"

    if (multiPane.panes().length === 0) {
      if (dirFromUrl) {
        layout.projects.open(dirFromUrl)
        // Add pane with session (if any) and a new tab with same/last project
        multiPane.addPane(dirFromUrl, sessionFromUrl)
        if (wantsNewTab) {
          multiPane.addPane(dirFromUrl)
        }
        setSearchParams({ dir: undefined, session: undefined, newTab: undefined })
      } else {
        // No URL params, use most recent project
        multiPane.addPane(getLastProject())
      }
    } else if (dirFromUrl && wantsNewTab) {
      // Already have panes, but coming from single session "New Tab" button
      layout.projects.open(dirFromUrl)
      multiPane.addPane(dirFromUrl, sessionFromUrl)
      multiPane.addPane(dirFromUrl)
      setSearchParams({ dir: undefined, session: undefined, newTab: undefined })
    }
  })

  createEffect(
    on(
      () => ({ session: searchParams.session, dir: searchParams.dir, newTab: searchParams.newTab }),
      (params) => {
        // Skip if newTab param is present (handled by onMount)
        if (params.newTab === "true") return
        // Only handle if we already have panes (not initial load)
        if (multiPane.panes().length === 0) return

        if (typeof params.session === "string" && typeof params.dir === "string") {
          const directory = decodeURIComponent(params.dir)
          const sessionId = params.session
          const focusedPane = multiPane.focusedPane()
          if (focusedPane) {
            layout.projects.open(directory)
            multiPane.updatePane(focusedPane.id, { directory, sessionId })
          }
          setSearchParams({ session: undefined, dir: undefined })
        }
      },
    ),
  )

  function handleAddFirstPane() {
    multiPane.addPane(getLastProject())
  }

  return (
    <div class="size-full flex flex-col bg-background-base">
      <PaneToolbar />
      <Show
        when={hasPanes()}
        fallback={
          <div class="flex-1 flex items-center justify-center">
            <div class="text-center">
              <Icon name="dot-grid" size="large" class="mx-auto mb-4 text-icon-weak" />
              <div class="text-16-medium text-text-strong mb-2">No tabs yet</div>
              <div class="text-14-regular text-text-weak mb-6">Add a tab to start working with multiple sessions</div>
              <Button size="large" onClick={handleAddFirstPane}>
                <Icon name="plus" size="small" />
                New Tab
              </Button>
            </div>
          </div>
        }
      >
        <PaneGrid
          panes={visiblePanes()}
          renderPane={(pane) => (
            <SessionPane paneId={pane.id} directory={pane.directory} sessionId={pane.sessionId} />
          )}
        />
      </Show>
    </div>
  )
}

export default function MultiPanePage() {
  return (
    <MultiPaneProvider>
      <MultiPaneContent />
    </MultiPaneProvider>
  )
}

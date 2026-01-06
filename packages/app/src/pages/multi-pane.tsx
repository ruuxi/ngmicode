import { Show, createMemo, onMount, createEffect, on, For, onCleanup, createSignal } from "solid-js"
import { useSearchParams, useNavigate } from "@solidjs/router"
import { MultiPaneProvider, useMultiPane } from "@/context/multi-pane"
import { PaneGrid } from "@/components/pane-grid"
import { SessionPane } from "@/components/session-pane"
import { useLayout } from "@/context/layout"
import { useGlobalSync } from "@/context/global-sync"
import { HomeContent } from "@/components/home-content"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { SDKProvider, useSDK } from "@/context/sdk"
import { SyncProvider, useSync } from "@/context/sync"
import { LocalProvider, useLocal } from "@/context/local"
import { DataProvider } from "@opencode-ai/ui/context"
import { TerminalProvider, useTerminal, type LocalPTY } from "@/context/terminal"
import { PromptProvider, usePrompt, type Prompt } from "@/context/prompt"
import { PromptInput } from "@/components/prompt-input"
import { Terminal } from "@/components/terminal"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { Tabs } from "@opencode-ai/ui/tabs"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { base64Encode } from "@opencode-ai/util/encode"

const MAX_TERMINAL_HEIGHT = 200

// Cache to preserve prompt content and settings when switching between panes
export type PaneCache = {
  prompt?: Prompt
  agent?: string
  model?: { providerID: string; modelID: string }
  variant?: string
}
export const paneCache = new Map<string, PaneCache>()

// Provider wrapper for each pane (provides Local/Terminal context needed by SessionPane)
function PaneSyncedProviders(props: { paneId: string; directory: string; children: any }) {
  const sync = useSync()
  const sdk = useSDK()
  const respond = (input: { sessionID: string; permissionID: string; response: "once" | "always" | "reject" }) =>
    sdk.client.permission.respond(input)

  return (
    <DataProvider data={sync.data} directory={props.directory} onPermissionRespond={respond}>
      <LocalProvider>
        <TerminalProvider paneId={props.paneId}>
          <PromptProvider paneId={props.paneId}>
            {props.children}
          </PromptProvider>
        </TerminalProvider>
      </LocalProvider>
    </DataProvider>
  )
}

// Empty pane content when no directory is selected
function EmptyPaneContent(props: { paneId: string; isFocused: () => boolean }) {
  const multiPane = useMultiPane()
  const layout = useLayout()
  const globalSync = useGlobalSync()

  const mostRecentProject = createMemo(() => {
    const sorted = globalSync.data.project.toSorted(
      (a, b) => (b.time.updated ?? b.time.created) - (a.time.updated ?? a.time.created),
    )
    return sorted[0]?.worktree
  })

  const [selectedProject, setSelectedProject] = createSignal<string | undefined>(undefined)
  const effectiveProject = createMemo(
    () => selectedProject() ?? layout.projects.list()[0]?.worktree ?? mostRecentProject(),
  )

  function handleSelectProject(directory: string) {
    setSelectedProject(directory)
    layout.projects.open(directory)
    multiPane.updatePane(props.paneId, { directory, sessionId: undefined })
    multiPane.setFocused(props.paneId)
  }

  function handleClose() {
    multiPane.removePane(props.paneId)
  }

  return (
    <div
      class="relative size-full flex flex-col overflow-hidden bg-background-base transition-opacity duration-150"
      classList={{
        "ring-1 ring-border-accent-base": props.isFocused(),
        "opacity-60": !props.isFocused(),
      }}
      onMouseDown={() => multiPane.setFocused(props.paneId)}
    >
      <header
        class="h-8 shrink-0 bg-background-base border-b flex items-center px-2 gap-1 justify-between"
        classList={{
          "border-border-accent-base": props.isFocused(),
          "border-border-weak-base": !props.isFocused(),
        }}
      >
        <div class="text-12-regular text-text-weak">New Tab</div>
        <div class="flex items-center">
          <IconButton icon="plus" variant="ghost" onClick={() => multiPane.addPane()} />
          <Show when={multiPane.panes().length > 1}>
            <IconButton icon="close" variant="ghost" onClick={handleClose} />
          </Show>
        </div>
      </header>
      <div class="flex-1 min-h-0">
        <HomeContent
          variant="pane"
          selectedProject={effectiveProject()}
          onSelectProject={handleSelectProject}
        />
      </div>
    </div>
  )
}

// Inner component that has access to terminal context
function GlobalTerminalAndPrompt(props: { paneId: string; sessionId?: string }) {
  const multiPane = useMultiPane()
  const layout = useLayout()
  const terminal = useTerminal()
  const prompt = usePrompt()
  const local = useLocal()
  let editorRef: HTMLDivElement | undefined

  function handleSessionCreated(sessionId: string) {
    multiPane.updatePane(props.paneId, { sessionId })
  }

  // Restore settings from cache on mount (before render to avoid flicker)
  const cached = paneCache.get(props.paneId)
  if (cached) {
    if (cached.agent) local.agent.set(cached.agent)
    if (cached.model) local.model.set(cached.model)
    if (cached.variant !== undefined) local.model.variant.set(cached.variant)
    if (cached.prompt) prompt.set(cached.prompt)
  }

  // Save all settings to cache on cleanup (before unmount)
  onCleanup(() => {
    const cache: PaneCache = {}

    // Save prompt
    const currentPrompt = prompt.current()
    if (currentPrompt && prompt.dirty()) {
      cache.prompt = currentPrompt
    }

    // Save agent
    const currentAgent = local.agent.current()
    if (currentAgent) {
      cache.agent = currentAgent.name
    }

    // Save model
    const currentModel = local.model.current()
    if (currentModel) {
      cache.model = { providerID: currentModel.provider.id, modelID: currentModel.id }
    }

    // Save variant
    cache.variant = local.model.variant.current()

    paneCache.set(props.paneId, cache)
  })

  // Auto-focus prompt when component mounts
  onMount(() => {
    requestAnimationFrame(() => {
      editorRef?.focus()
    })
  })

  return (
    <div class="shrink-0 flex flex-col border-t border-border-weak-base bg-background-base">
      {/* Terminal section */}
      <Show when={layout.terminal.opened()}>
        <div
          class="relative w-full flex flex-col shrink-0"
          style={{ height: `${Math.min(layout.terminal.height(), MAX_TERMINAL_HEIGHT)}px` }}
        >
          <ResizeHandle
            direction="vertical"
            size={Math.min(layout.terminal.height(), MAX_TERMINAL_HEIGHT)}
            min={80}
            max={300}
            collapseThreshold={40}
            onResize={layout.terminal.resize}
            onCollapse={layout.terminal.close}
          />
          <Tabs variant="alt" value={terminal.active()} onChange={terminal.open}>
            <Tabs.List class="h-8">
              <For each={terminal.all()}>
                {(pty: LocalPTY) => (
                  <Tabs.Trigger
                    value={pty.id}
                    closeButton={
                      <Tooltip value="Close terminal" placement="bottom">
                        <IconButton icon="close" variant="ghost" onClick={() => terminal.close(pty.id)} />
                      </Tooltip>
                    }
                  >
                    {pty.title}
                  </Tabs.Trigger>
                )}
              </For>
              <div class="h-full flex items-center justify-center">
                <Tooltip value="New terminal">
                  <IconButton icon="plus-small" variant="ghost" iconSize="large" onClick={terminal.new} />
                </Tooltip>
              </div>
            </Tabs.List>
            <For each={terminal.all()}>
              {(pty: LocalPTY) => (
                <Tabs.Content value={pty.id}>
                  <Terminal pty={pty} onCleanup={terminal.update} onConnectError={() => terminal.clone(pty.id)} />
                </Tabs.Content>
              )}
            </For>
          </Tabs>
        </div>
      </Show>

      {/* Prompt input */}
      <div class="p-3 flex justify-center">
        <div class="w-full max-w-[800px]">
          <PromptInput
            ref={(el) => (editorRef = el)}
            paneId={props.paneId}
            sessionId={props.sessionId}
            onSessionCreated={handleSessionCreated}
          />
        </div>
      </div>
    </div>
  )
}

// Wrapper that provides SDK/Sync context for the global prompt
function GlobalPromptSynced(props: { paneId: string; directory: string; sessionId?: string }) {
  const sync = useSync()
  const sdk = useSDK()
  const respond = (input: { sessionID: string; permissionID: string; response: "once" | "always" | "reject" }) =>
    sdk.client.permission.respond(input)

  return (
    <DataProvider data={sync.data} directory={props.directory} onPermissionRespond={respond}>
      <LocalProvider>
        <TerminalProvider paneId={props.paneId}>
          <PromptProvider paneId={props.paneId}>
            <GlobalTerminalAndPrompt paneId={props.paneId} sessionId={props.sessionId} />
          </PromptProvider>
        </TerminalProvider>
      </LocalProvider>
    </DataProvider>
  )
}

// Global prompt wrapper that switches based on focused pane
function GlobalPromptWrapper() {
  const multiPane = useMultiPane()
  const focused = createMemo(() => multiPane.focusedPane())

  // Use keyed Show to remount providers when focused pane changes
  return (
    <Show when={focused()} keyed>
      {(pane) => (
        <Show when={pane.directory}>
          {(directory) => (
            <SDKProvider directory={directory()}>
              <SyncProvider>
                <GlobalPromptSynced
                  paneId={pane.id}
                  directory={directory()}
                  sessionId={pane.sessionId}
                />
              </SyncProvider>
            </SDKProvider>
          )}
        </Show>
      )}
    </Show>
  )
}

function MultiPaneContent() {
  const multiPane = useMultiPane()
  const layout = useLayout()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  // Track when we're transitioning to single-pane view to prevent GlobalPromptWrapper remount
  const [isTransitioningToSingle, setIsTransitioningToSingle] = createSignal(false)

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

  // Auto-switch to single view when only 1 pane with a session remains
  // Use defer to skip initial mount, only trigger when user closes panes
  createEffect(
    on(
      () => multiPane.panes(),
      (panes, prev) => {
        // Only switch if we're reducing from multiple panes to 1
        if (prev && prev.length > 1 && panes.length === 1 && panes[0].directory && panes[0].sessionId) {
          // Mark transition to prevent GlobalPromptWrapper from remounting
          // This avoids floating-ui errors when refs are invalidated during cleanup
          setIsTransitioningToSingle(true)
          navigate(`/${base64Encode(panes[0].directory)}/session/${panes[0].sessionId}`)
        }
      },
    ),
  )

  function handleAddFirstPane() {
    multiPane.addPane(getLastProject())
  }

  return (
    <div class="size-full flex flex-col bg-background-base">
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
          renderPane={(pane) => {
            const isFocused = createMemo(() => multiPane.focusedPaneId() === pane.id)
            return (
              <Show when={pane.directory} keyed fallback={
                <EmptyPaneContent paneId={pane.id} isFocused={isFocused} />
              }>
                {(directory) => (
                  <SDKProvider directory={directory}>
                    <SyncProvider>
                      <PaneSyncedProviders paneId={pane.id} directory={directory}>
                        <SessionPane
                          mode="multi"
                          paneId={pane.id}
                          directory={directory}
                          sessionId={pane.sessionId}
                          isFocused={isFocused}
                          onSessionChange={(sessionId: string | undefined) => multiPane.updatePane(pane.id, { sessionId })}
                          onDirectoryChange={(dir: string) => multiPane.updatePane(pane.id, { directory: dir, sessionId: undefined })}
                          onClose={() => multiPane.removePane(pane.id)}
                        />
                      </PaneSyncedProviders>
                    </SyncProvider>
                  </SDKProvider>
                )}
              </Show>
            )
          }}
        />
        {/* Hide GlobalPromptWrapper during transition to prevent floating-ui errors */}
        <Show when={!isTransitioningToSingle()}>
          <GlobalPromptWrapper />
        </Show>
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

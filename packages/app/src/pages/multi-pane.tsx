import { Show, createMemo, onMount, createEffect, on, For, onCleanup } from "solid-js"
import { useSearchParams } from "@solidjs/router"
import { MultiPaneProvider, useMultiPane } from "@/context/multi-pane"
import { PaneGrid } from "@/components/pane-grid"
import { SessionPane } from "@/components/session-pane"
import { useLayout } from "@/context/layout"
import { HomeScreen } from "@/components/home-screen"
import { useGlobalSync } from "@/context/global-sync"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { SDKProvider, useSDK } from "@/context/sdk"
import { SyncProvider, useSync } from "@/context/sync"
import { LocalProvider, useLocal } from "@/context/local"
import { DataProvider } from "@opencode-ai/ui/context"
import { TerminalProvider, useTerminal, type LocalPTY } from "@/context/terminal"
import { PromptProvider, usePrompt, type Prompt } from "@/context/prompt"
import { FileProvider } from "@/context/file"
import { PromptInput } from "@/components/prompt-input"
import { Terminal } from "@/components/terminal"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { Tabs } from "@opencode-ai/ui/tabs"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip } from "@opencode-ai/ui/tooltip"

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
          <FileProvider>
            <PromptProvider paneId={props.paneId}>
              {props.children}
            </PromptProvider>
          </FileProvider>
        </TerminalProvider>
      </LocalProvider>
    </DataProvider>
  )
}

function HomePane(props: { paneId: string; isFocused: () => boolean }) {
  const multiPane = useMultiPane()
  const globalSync = useGlobalSync()
  const hideLogo = createMemo(() => multiPane.panes().length > 1)

  function handleProjectSelected(directory: string) {
    multiPane.updatePane(props.paneId, { directory, sessionId: undefined })
    multiPane.setFocused(props.paneId)
  }

  const mostRecentProject = createMemo(() => {
    const sorted = globalSync.data.project.toSorted(
      (a, b) => (b.time.updated ?? b.time.created) - (a.time.updated ?? a.time.created),
    )
    return sorted[0]?.worktree
  })

  createEffect(() => {
    const candidate = mostRecentProject()
    if (candidate) {
      handleProjectSelected(candidate)
    }
  })

  function handleNavigateMulti() {
    multiPane.addPane()
  }

  function handleMouseDown(event: MouseEvent) {
    const target = event.target as HTMLElement
    const isInteractive = target.closest('button, input, select, textarea, [contenteditable], [role="button"]')
    if (!isInteractive) {
      multiPane.setFocused(props.paneId)
    }
  }

  return (
    <div
      class="relative size-full flex flex-col overflow-hidden bg-background-base transition-opacity duration-150"
      classList={{
        "opacity-60": !props.isFocused(),
      }}
      onMouseDown={handleMouseDown}
    >
      <div
        class="pointer-events-none absolute inset-0 z-30 border"
        classList={{
          "border-border-accent-base": props.isFocused(),
          "border-border-weak-base": !props.isFocused(),
        }}
      />
      <HomeScreen
        hideLogo={hideLogo()}
        onProjectSelected={handleProjectSelected}
        onNavigateMulti={handleNavigateMulti}
      />
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

  function restorePaneState(paneId: string) {
    const cached = paneCache.get(paneId)
    if (!cached) return
    if (cached.agent) local.agent.set(cached.agent)
    if (cached.model) local.model.set(cached.model)
    if (cached.variant !== undefined) local.model.variant.set(cached.variant)
    if (cached.prompt && !prompt.dirty()) prompt.set(cached.prompt)
  }

  type PaneSnapshot = {
    prompt?: Prompt
    promptDirty: boolean
    agent?: string
    model?: { providerID: string; modelID: string }
    variant?: string
  }

  const paneSnapshots = new Map<string, PaneSnapshot>()

  function snapshotPaneState(): PaneSnapshot {
    const currentPrompt = prompt.current()
    const currentAgent = local.agent.current()
    const currentModel = local.model.current()
    return {
      prompt: currentPrompt,
      promptDirty: prompt.dirty(),
      agent: currentAgent?.name,
      model: currentModel ? { providerID: currentModel.provider.id, modelID: currentModel.id } : undefined,
      variant: local.model.variant.current(),
    }
  }

  function storePaneState(paneId: string, snapshot?: PaneSnapshot) {
    const state = snapshot ?? snapshotPaneState()
    const cache: PaneCache = paneCache.get(paneId) ?? {}
    if (state.prompt && state.promptDirty) {
      cache.prompt = state.prompt
    }
    if (state.agent) {
      cache.agent = state.agent
    }
    if (state.model) {
      cache.model = state.model
    }
    cache.variant = state.variant
    paneCache.set(paneId, cache)
  }

  restorePaneState(props.paneId)

  createEffect(() => {
    paneSnapshots.set(props.paneId, snapshotPaneState())
  })

  createEffect(
    on(
      () => props.paneId,
      (next, prev) => {
        if (prev) storePaneState(prev, paneSnapshots.get(prev))
        if (next) restorePaneState(next)
      },
      { defer: true },
    ),
  )

  // Save all settings to cache on cleanup (before unmount)
  onCleanup(() => {
    storePaneState(props.paneId, paneSnapshots.get(props.paneId))
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
          <FileProvider>
            <PromptProvider paneId={props.paneId}>
              <GlobalTerminalAndPrompt paneId={props.paneId} sessionId={props.sessionId} />
            </PromptProvider>
          </FileProvider>
        </TerminalProvider>
      </LocalProvider>
    </DataProvider>
  )
}

// Global prompt wrapper that switches based on focused pane
function GlobalPromptWrapper() {
  const multiPane = useMultiPane()
  const focused = createMemo(() => multiPane.focusedPane())

  return (
    <Show when={focused()}>
      {(pane) => (
        <Show when={pane().directory}>
          {(directory) => (
            <SDKProvider directory={directory()}>
              <SyncProvider>
                <GlobalPromptSynced
                  paneId={pane().id}
                  directory={directory()}
                  sessionId={pane().sessionId}
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
        const lastProject = getLastProject()
        if (wantsNewTab) {
          multiPane.addPane(lastProject)
          multiPane.addPane(lastProject)
          setSearchParams({ newTab: undefined })
        } else {
          // No URL params, use most recent project
          multiPane.addPane(lastProject)
        }
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
                <HomePane paneId={pane.id} isFocused={isFocused} />
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
        <GlobalPromptWrapper />
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

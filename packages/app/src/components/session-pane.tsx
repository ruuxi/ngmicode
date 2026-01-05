import { Show, createMemo, createEffect, on, onCleanup, For, createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import { SDKProvider, useSDK } from "@/context/sdk"
import { SyncProvider, useSync } from "@/context/sync"
import { LocalProvider } from "@/context/local"
import { DataProvider, useDialog } from "@opencode-ai/ui/context"
import { TerminalProvider } from "@/context/terminal"
import { PromptProvider } from "@/context/prompt"
import { useMultiPane } from "@/context/multi-pane"
import { useLayout } from "@/context/layout"
import { useGlobalSync } from "@/context/global-sync"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"
import { PaneHeader } from "./pane-header"
import { PaneHome } from "./pane-home"
import { DialogSelectDirectory } from "./dialog-select-directory"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Button } from "@opencode-ai/ui/button"
import { SessionTurn } from "@opencode-ai/ui/session-turn"
import { SessionMessageRail } from "@opencode-ai/ui/session-message-rail"
import { Spinner } from "@opencode-ai/ui/spinner"
import { DateTime } from "luxon"
import type { UserMessage } from "@opencode-ai/sdk/v2"

type SessionPaneProps = {
  paneId: string
  directory?: string
  sessionId?: string
}

// Component to show recent projects when no session is active
function NewSessionProjectList(props: { currentDirectory: string; onSelectProject: (dir: string) => void }) {
  const globalSync = useGlobalSync()
  const layout = useLayout()
  const platform = usePlatform()
  const dialog = useDialog()
  const server = useServer()
  const homedir = createMemo(() => globalSync.data.path.home)

  // Get recent projects, ensuring current directory is always included
  const projects = createMemo(() => {
    const sorted = globalSync.data.project
      .toSorted((a, b) => (b.time.updated ?? b.time.created) - (a.time.updated ?? a.time.created))

    // Check if current directory is in the list
    const hasCurrentDir = sorted.some((p) => p.worktree === props.currentDirectory)

    // If current directory isn't in the list, add it as a synthetic entry
    if (!hasCurrentDir && props.currentDirectory) {
      const now = Date.now()
      return [
        { id: props.currentDirectory, worktree: props.currentDirectory, time: { created: now, updated: now } },
        ...sorted,
      ].slice(0, 5)
    }

    return sorted.slice(0, 5)
  })

  function selectProject(directory: string) {
    if (directory !== props.currentDirectory) {
      layout.projects.open(directory)
      props.onSelectProject(directory)
    }
  }

  async function chooseProject() {
    function resolve(result: string | string[] | null) {
      if (Array.isArray(result)) {
        if (result[0]) selectProject(result[0])
      } else if (result) {
        selectProject(result)
      }
    }

    if (platform.openDirectoryPickerDialog && server.isLocal()) {
      const result = await platform.openDirectoryPickerDialog?.({
        title: "Open project",
        multiple: false,
      })
      resolve(result)
    } else {
      dialog.show(
        () => <DialogSelectDirectory multiple={false} onSelect={resolve} />,
        () => resolve(null),
      )
    }
  }

  return (
    <div class="flex flex-col items-center justify-center h-full p-4">
      <div class="w-full max-w-sm">
        <div class="text-center mb-6">
          <div class="text-14-medium text-text-base">New Session</div>
          <div class="text-12-regular text-text-weak mt-1">Type a message to start</div>
        </div>

        <div class="flex flex-col gap-1">
          <div class="flex gap-2 items-center justify-between px-2 mb-1">
            <div class="text-12-regular text-text-weak">Projects</div>
            <Button icon="folder-add-left" size="small" variant="ghost" onClick={chooseProject}>
              Open
            </Button>
          </div>
          <For each={projects()}>
            {(project) => {
              const isSelected = () => project.worktree === props.currentDirectory
              return (
                <Button
                  size="normal"
                  variant={isSelected() ? "secondary" : "ghost"}
                  class="text-12-mono text-left justify-between px-2 py-1.5"
                  onClick={() => selectProject(project.worktree)}
                >
                  <span class="truncate" classList={{ "text-text-accent-base": isSelected() }}>
                    {project.worktree.replace(homedir(), "~")}
                  </span>
                  <Show when={isSelected()}>
                    <span class="text-11-regular text-text-accent-base shrink-0 ml-2">current</span>
                  </Show>
                  <Show when={!isSelected()}>
                    <span class="text-11-regular text-text-weaker shrink-0 ml-2">
                      {DateTime.fromMillis(project.time.updated ?? project.time.created).toRelative()}
                    </span>
                  </Show>
                </Button>
              )
            }}
          </For>
        </div>
      </div>
    </div>
  )
}

type ActivePaneProps = {
  paneId: string
  directory: string
  sessionId?: string
}

function same<T>(a: readonly T[], b: readonly T[]) {
  if (a === b) return true
  if (a.length !== b.length) return false
  return a.every((x, i) => x === b[i])
}

function PaneContent(props: ActivePaneProps) {
  const sync = useSync()
  const multiPane = useMultiPane()

  const [store, setStore] = createStore({
    messageId: undefined as string | undefined,
    stepsExpanded: false,
  })
  const [syncingSessionId, setSyncingSessionId] = createSignal<string | undefined>(undefined)

  // Header overlay visibility state
  const [isHovering, setIsHovering] = createSignal(false)
  const [isNearTop, setIsNearTop] = createSignal(false)
  const [headerHasFocus, setHeaderHasFocus] = createSignal(false)
  const [isOverHeader, setIsOverHeader] = createSignal(false)
  let containerRef: HTMLDivElement | undefined

  const isFocused = createMemo(() => multiPane.focusedPaneId() === props.paneId)

  // Show header when: (mouse over header) OR (not focused AND hovering) OR (near top) OR (header has focus-within)
  const showHeader = createMemo(() => {
    if (headerHasFocus()) return true
    if (isOverHeader()) return true
    if (!isFocused() && isHovering()) return true
    if (isNearTop()) return true
    return false
  })

  function handleMouseMove(e: MouseEvent) {
    if (!containerRef) return
    const rect = containerRef.getBoundingClientRect()
    const relativeY = e.clientY - rect.top
    setIsNearTop(relativeY <= 40)
  }

  const messages = createMemo(() => (props.sessionId ? (sync.data.message[props.sessionId] ?? []) : []))
  const sessionSyncing = createMemo(() => syncingSessionId() === props.sessionId)
  const showSessionLoading = createMemo(() => !!props.sessionId && sessionSyncing() && messages().length === 0)
  const emptyUserMessages: UserMessage[] = []
  const userMessages = createMemo(
    () => messages().filter((m) => m.role === "user") as UserMessage[],
    emptyUserMessages,
    { equals: same },
  )
  const visibleUserMessages = createMemo(() => userMessages())
  const lastUserMessage = createMemo(() => visibleUserMessages().at(-1))
  const activeMessage = createMemo(() => {
    if (!store.messageId) return lastUserMessage()
    const found = visibleUserMessages()?.find((m) => m.id === store.messageId)
    return found ?? lastUserMessage()
  })

  const status = createMemo(() => (props.sessionId ? sync.data.session_status[props.sessionId] : undefined))
  const isWorking = createMemo(() => status()?.type === "busy")

  // Sync session data when sessionId changes
  createEffect(() => {
    if (!props.sessionId) {
      setSyncingSessionId(undefined)
      return
    }
    const sessionId = props.sessionId
    let active = true
    setSyncingSessionId(sessionId)
    sync.session.sync(sessionId).then(() => {
      if (active && props.sessionId === sessionId) {
        setSyncingSessionId(undefined)
      }
    }).catch((err) => {
      if (active && props.sessionId === sessionId) {
        setSyncingSessionId(undefined)
      }
      console.error("Failed to sync session:", sessionId, err)
    })
    onCleanup(() => {
      active = false
    })
  })

  function setActiveMessage(message: UserMessage) {
    setStore("messageId", message.id)
  }

  createEffect(
    on(
      () => isWorking(),
      (working, prev) => {
        if (working) {
          setStore("stepsExpanded", true)
        } else if (prev) {
          // Collapse when work finishes
          setStore("stepsExpanded", false)
        }
      },
    ),
  )

  createEffect(
    on(
      () => lastUserMessage(),
      (last) => {
        if (isWorking() && last) {
          setStore("messageId", last.id)
        }
      },
    ),
  )

  function handleSessionChange(sessionId: string | undefined) {
    multiPane.updatePane(props.paneId, { sessionId })
    multiPane.setFocused(props.paneId)
  }

  function handleDirectoryChange(directory: string) {
    multiPane.updatePane(props.paneId, { directory, sessionId: undefined })
    multiPane.setFocused(props.paneId)
  }

  function handleClose() {
    multiPane.removePane(props.paneId)
  }

  const SessionLoading = (props: { class?: string }) => (
    <Show when={showSessionLoading()}>
      <div class={`flex items-center justify-center text-12-regular text-text-weak ${props.class ?? ""}`}>
        <Spinner class="size-4 mr-2" />
        <span>Loading session...</span>
      </div>
    </Show>
  )

  return (
    <div
      ref={containerRef}
      class="relative size-full flex flex-col overflow-hidden bg-background-base transition-opacity duration-150"
      classList={{
        "ring-1 ring-border-accent-base": isFocused(),
        "opacity-60": !isFocused(),
      }}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => {
        setIsHovering(false)
        setIsNearTop(false)
      }}
      onMouseMove={handleMouseMove}
      onMouseDown={(e) => {
        // Only focus if clicking non-interactive elements
        const target = e.target as HTMLElement
        const isInteractive = target.closest('button, input, select, textarea, [contenteditable], [role="button"]')
        if (!isInteractive) {
          multiPane.setFocused(props.paneId)
        }
      }}
    >
      {/* Header overlay */}
      <div
        class="absolute top-0 left-0 right-0 z-10 transition-opacity duration-150"
        classList={{
          "opacity-100 pointer-events-auto": showHeader(),
          "opacity-0 pointer-events-none": !showHeader(),
        }}
        onMouseEnter={() => setIsOverHeader(true)}
        onMouseLeave={() => setIsOverHeader(false)}
        onMouseDown={(e) => {
          // Prevent container's onMouseDown from firing - don't focus when interacting with header
          e.stopPropagation()
        }}
        onFocusIn={() => setHeaderHasFocus(true)}
        onFocusOut={(e) => {
          // Only clear focus if focus is leaving the header entirely
          const relatedTarget = e.relatedTarget as HTMLElement | null
          if (!e.currentTarget.contains(relatedTarget)) {
            setHeaderHasFocus(false)
          }
        }}
      >
        <PaneHeader
          paneId={props.paneId}
          directory={props.directory}
          sessionId={props.sessionId}
          onSessionChange={handleSessionChange}
          onDirectoryChange={handleDirectoryChange}
          onClose={handleClose}
        />
      </div>

      <div class="flex-1 min-h-0 flex flex-col">
        <div class="flex-1 min-h-0 relative bg-background-stronger">
          <Show
            when={props.sessionId}
            fallback={
              <NewSessionProjectList
                currentDirectory={props.directory}
                onSelectProject={(dir) => handleDirectoryChange(dir)}
              />
            }
          >
            <div class="flex items-start justify-start h-full min-h-0">
              <SessionMessageRail
                messages={visibleUserMessages()}
                current={activeMessage()}
                onMessageSelect={setActiveMessage}
                wide={true}
              />
              <SessionLoading class="flex-1 min-w-0 h-full pb-4" />
              <Show when={activeMessage()}>
                <SessionTurn
                  sessionID={props.sessionId!}
                  messageID={activeMessage()!.id}
                  lastUserMessageID={lastUserMessage()?.id}
                  stepsExpanded={store.stepsExpanded}
                  hideTitle={true}
                  disableSticky={true}
                  onStepsExpandedToggle={() => setStore("stepsExpanded", (x) => !x)}
                  onUserInteracted={() => {}}
                  classes={{
                    root: "pb-4 flex-1 min-w-0",
                    content: "pb-4 pt-8",
                    container: "w-full pr-3 pl-5 " + (visibleUserMessages().length > 1 ? "pl-14" : ""),
                  }}
                />
              </Show>
            </div>
          </Show>
        </div>
      </div>
    </div>
  )
}

function SyncedProviders(props: { paneId: string; directory: string; children: any }) {
  const sync = useSync()
  const sdk = useSDK()
  const respond = (input: { sessionID: string; permissionID: string; response: "once" | "always" | "reject" }) =>
    sdk.client.permission.respond(input)

  return (
    <DataProvider data={sync.data} directory={props.directory} onPermissionRespond={respond}>
      <LocalProvider>
        <TerminalProvider paneId={props.paneId}>
          <PromptProvider paneId={props.paneId}>{props.children}</PromptProvider>
        </TerminalProvider>
      </LocalProvider>
    </DataProvider>
  )
}

function PaneProviders(props: ActivePaneProps & { children: any }) {
  return (
    <SyncProvider>
      <SyncedProviders paneId={props.paneId} directory={props.directory}>
        {props.children}
      </SyncedProviders>
    </SyncProvider>
  )
}

function EmptyPaneContent(props: { paneId: string }) {
  const multiPane = useMultiPane()
  const layout = useLayout()
  const isFocused = createMemo(() => multiPane.focusedPaneId() === props.paneId)

  // Header overlay visibility state
  const [isHovering, setIsHovering] = createSignal(false)
  const [isNearTop, setIsNearTop] = createSignal(false)
  const [headerHasFocus, setHeaderHasFocus] = createSignal(false)
  const [isOverHeader, setIsOverHeader] = createSignal(false)
  let containerRef: HTMLDivElement | undefined

  const showHeader = createMemo(() => {
    if (headerHasFocus()) return true
    if (isOverHeader()) return true
    if (!isFocused() && isHovering()) return true
    if (isNearTop()) return true
    return false
  })

  function handleMouseMove(e: MouseEvent) {
    if (!containerRef) return
    const rect = containerRef.getBoundingClientRect()
    const relativeY = e.clientY - rect.top
    setIsNearTop(relativeY <= 40)
  }

  function handleSelectProject(directory: string) {
    layout.projects.open(directory)
    multiPane.updatePane(props.paneId, { directory, sessionId: undefined })
    multiPane.setFocused(props.paneId)
  }

  function handleClose() {
    multiPane.removePane(props.paneId)
  }

  return (
    <div
      ref={containerRef}
      class="relative size-full flex flex-col overflow-hidden bg-background-base transition-opacity duration-150"
      classList={{
        "ring-1 ring-border-accent-base": isFocused(),
        "opacity-60": !isFocused(),
      }}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => {
        setIsHovering(false)
        setIsNearTop(false)
      }}
      onMouseMove={handleMouseMove}
      onMouseDown={() => multiPane.setFocused(props.paneId)}
    >
      {/* Header overlay */}
      <div
        class="absolute top-0 left-0 right-0 z-10 transition-opacity duration-150"
        classList={{
          "opacity-100 pointer-events-auto": showHeader(),
          "opacity-0 pointer-events-none": !showHeader(),
        }}
        onMouseEnter={() => setIsOverHeader(true)}
        onMouseLeave={() => setIsOverHeader(false)}
        onMouseDown={(e) => {
          // Prevent container's onMouseDown from firing - don't focus when interacting with header
          e.stopPropagation()
        }}
        onFocusIn={() => setHeaderHasFocus(true)}
        onFocusOut={(e) => {
          const relatedTarget = e.relatedTarget as HTMLElement | null
          if (!e.currentTarget.contains(relatedTarget)) {
            setHeaderHasFocus(false)
          }
        }}
      >
        <header
          class="h-8 shrink-0 bg-background-base border-b flex items-center px-2 gap-1 justify-between"
          classList={{
            "border-border-accent-base": isFocused(),
            "border-border-weak-base": !isFocused(),
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
      </div>
      <div class="flex-1 min-h-0 bg-background-stronger">
        <PaneHome onSelectProject={handleSelectProject} />
      </div>
    </div>
  )
}

export function SessionPane(props: SessionPaneProps) {
  return (
    <Show
      when={props.directory}
      keyed
      fallback={<EmptyPaneContent paneId={props.paneId} />}
    >
      {(directory) => (
        <SDKProvider directory={directory}>
          <PaneProviders paneId={props.paneId} directory={directory}>
            <PaneContent paneId={props.paneId} directory={directory} sessionId={props.sessionId} />
          </PaneProviders>
        </SDKProvider>
      )}
    </Show>
  )
}

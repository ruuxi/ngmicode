import { Show, createMemo, createEffect, on, For, createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import { SDKProvider, useSDK } from "@/context/sdk"
import { SyncProvider, useSync } from "@/context/sync"
import { LocalProvider } from "@/context/local"
import { DataProvider } from "@opencode-ai/ui/context"
import { TerminalProvider, useTerminal, type LocalPTY } from "@/context/terminal"
import { PromptProvider } from "@/context/prompt"
import { useMultiPane } from "@/context/multi-pane"
import { useLayout } from "@/context/layout"
import { PaneHeader } from "./pane-header"
import { PaneHome } from "./pane-home"
import { PromptInput } from "./prompt-input"
import { Terminal } from "./terminal"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { Tabs } from "@opencode-ai/ui/tabs"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { SessionTurn } from "@opencode-ai/ui/session-turn"
import { SessionMessageRail } from "@opencode-ai/ui/session-message-rail"
import type { UserMessage } from "@opencode-ai/sdk/v2"

const MAX_PANE_TERMINAL_HEIGHT = 200

type SessionPaneProps = {
  paneId: string
  directory?: string
  sessionId?: string
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
  const layout = useLayout()
  const terminal = useTerminal()
  const multiPane = useMultiPane()

  const [store, setStore] = createStore({
    messageId: undefined as string | undefined,
    stepsExpanded: true,
  })

  const messages = createMemo(() => (props.sessionId ? (sync.data.message[props.sessionId] ?? []) : []))
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

  function setActiveMessage(message: UserMessage) {
    setStore("messageId", message.id)
  }

  createEffect(
    on(
      () => isWorking(),
      (working) => {
        if (working) {
          setStore("stepsExpanded", true)
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
  }

  function handleDirectoryChange(directory: string) {
    multiPane.updatePane(props.paneId, { directory, sessionId: undefined })
  }

  function handleClose() {
    multiPane.removePane(props.paneId)
  }

  const isFocused = createMemo(() => multiPane.focusedPaneId() === props.paneId)
  const [isHovered, setIsHovered] = createSignal(false)
  const showPromptBar = createMemo(() => isFocused() || isHovered())

  return (
    <div
      class="relative size-full flex flex-col overflow-hidden bg-background-base"
      classList={{
        "ring-1 ring-border-accent-base": isFocused(),
      }}
      onMouseDown={(e) => {
        // Only focus if clicking non-interactive elements
        const target = e.target as HTMLElement
        const isInteractive = target.closest('button, input, select, textarea, [contenteditable], [role="button"]')
        if (!isInteractive) {
          multiPane.setFocused(props.paneId)
        }
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <PaneHeader
        paneId={props.paneId}
        directory={props.directory}
        sessionId={props.sessionId}
        onSessionChange={handleSessionChange}
        onDirectoryChange={handleDirectoryChange}
        onClose={handleClose}
      />

      <div class="flex-1 min-h-0 flex flex-col">
        <div class="flex-1 min-h-0 relative bg-background-stronger">
          <Show
            when={props.sessionId}
            fallback={
              <div class="flex items-center justify-center h-full text-text-weak">
                <div class="text-center">
                  <div class="text-14-medium">New Session</div>
                  <div class="text-12-regular mt-1">Type a message to start</div>
                </div>
              </div>
            }
          >
            <div class="flex items-start justify-start h-full min-h-0">
              <SessionMessageRail
                messages={visibleUserMessages()}
                current={activeMessage()}
                onMessageSelect={setActiveMessage}
                wide={true}
              />
              <Show when={activeMessage()}>
                <SessionTurn
                  sessionID={props.sessionId!}
                  messageID={activeMessage()!.id}
                  lastUserMessageID={lastUserMessage()?.id}
                  stepsExpanded={store.stepsExpanded}
                  onStepsExpandedToggle={() => setStore("stepsExpanded", (x) => !x)}
                  onUserInteracted={() => {}}
                  classes={{
                    root: "pb-16 flex-1 min-w-0",
                    content: "pb-16",
                    container: "w-full px-3 " + (visibleUserMessages().length > 1 ? "pl-12" : ""),
                  }}
                />
              </Show>
            </div>
          </Show>

          <Show when={showPromptBar()}>
            <div class="absolute inset-x-0 bottom-3 flex flex-col justify-center items-center z-50 px-3">
              <div class="w-full max-w-[600px]">
                <PromptInput
                  paneId={props.paneId}
                  sessionId={props.sessionId}
                  onSessionCreated={(sessionId) => multiPane.updatePane(props.paneId, { sessionId })}
                />
              </div>
            </div>
          </Show>
        </div>

        <Show when={layout.terminal.opened()}>
          <div
            class="relative w-full flex flex-col shrink-0 border-t border-border-weak-base"
            style={{ height: `${Math.min(layout.terminal.height(), MAX_PANE_TERMINAL_HEIGHT)}px` }}
          >
            <ResizeHandle
              direction="vertical"
              size={Math.min(layout.terminal.height(), MAX_PANE_TERMINAL_HEIGHT)}
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

  function handleSelectProject(directory: string) {
    layout.projects.open(directory)
    multiPane.updatePane(props.paneId, { directory, sessionId: undefined })
  }

  function handleClose() {
    multiPane.removePane(props.paneId)
  }

  return (
    <div
      class="relative size-full flex flex-col overflow-hidden bg-background-base"
      classList={{
        "ring-1 ring-border-accent-base": isFocused(),
      }}
      onMouseDown={() => multiPane.setFocused(props.paneId)}
    >
      <header
        class="h-8 shrink-0 bg-background-base border-b flex items-center px-2 gap-1 justify-between"
        classList={{
          "border-border-accent-base": isFocused(),
          "border-border-weak-base": !isFocused(),
        }}
      >
        <div class="text-12-regular text-text-weak">New Tab</div>
        <Show when={multiPane.panes().length > 1}>
          <IconButton icon="close" variant="ghost" onClick={handleClose} />
        </Show>
      </header>
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

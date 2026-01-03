import { Show, createMemo } from "solid-js"
import { Select } from "@opencode-ai/ui/select"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { useSync } from "@/context/sync"
import { useLayout } from "@/context/layout"
import { useMultiPane } from "@/context/multi-pane"
import { getFilename } from "@opencode-ai/util/path"
import type { Session } from "@opencode-ai/sdk/v2/client"

type PaneHeaderProps = {
  paneId: string
  directory: string
  sessionId?: string
  onClose?: () => void
  onSessionChange?: (sessionId: string | undefined) => void
  onDirectoryChange?: (directory: string) => void
}

export function PaneHeader(props: PaneHeaderProps) {
  const layout = useLayout()
  const sync = useSync()
  const multiPane = useMultiPane()

  const sessions = createMemo(() => (sync.data.session ?? []).filter((s) => !s.parentID))
  const currentSession = createMemo(() => sessions().find((s) => s.id === props.sessionId))
  const branch = createMemo(() => sync.data.vcs?.branch)
  const isFocused = createMemo(() => multiPane.focusedPaneId() === props.paneId)

  function handleSessionSelect(session: Session | undefined) {
    props.onSessionChange?.(session?.id)
  }

  function handleDirectorySelect(directory: string | undefined) {
    if (directory) {
      props.onDirectoryChange?.(directory)
    }
  }

  return (
    <header
      class="h-8 shrink-0 bg-background-base border-b flex items-center px-2 gap-1"
      classList={{
        "border-border-accent-base": isFocused(),
        "border-border-weak-base": !isFocused(),
      }}
      onClick={() => multiPane.setFocused(props.paneId)}
    >
      <div class="flex items-center gap-1 min-w-0 flex-1">
        <Select
          options={layout.projects.list().map((project) => project.worktree)}
          current={props.directory}
          label={(x) => {
            const name = getFilename(x)
            const b = x === sync.directory ? branch() : undefined
            return b ? `${name}:${b}` : name
          }}
          onSelect={handleDirectorySelect}
          class="text-12-regular text-text-base"
          variant="ghost"
        />
        <div class="text-text-weaker text-12-regular">/</div>
        <Select
          options={sessions()}
          current={currentSession()}
          placeholder="New"
          label={(x) => x.title}
          value={(x) => x.id}
          onSelect={handleSessionSelect}
          class="text-12-regular text-text-base max-w-[160px]"
          variant="ghost"
        />
      </div>
      <div class="flex items-center">
        <Show when={currentSession()}>
          <Tooltip value="New session">
            <IconButton icon="edit-small-2" variant="ghost" onClick={() => props.onSessionChange?.(undefined)} />
          </Tooltip>
        </Show>
        <Tooltip value="Toggle terminal">
          <IconButton icon={layout.terminal.opened() ? "layout-bottom-full" : "layout-bottom"} variant="ghost" onClick={layout.terminal.toggle} />
        </Tooltip>
        <Show when={props.onClose}>
          <Tooltip value="Close pane">
            <IconButton icon="close" variant="ghost" onClick={props.onClose} />
          </Tooltip>
        </Show>
      </div>
    </header>
  )
}

import { createMemo, createSignal, For, Match, Show, Switch } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { Logo } from "@opencode-ai/ui/logo"
import { Icon } from "@opencode-ai/ui/icon"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useGlobalSync } from "@/context/global-sync"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"
import { DialogSelectDirectory } from "@/components/dialog-select-directory"
import { DialogSelectServer } from "@/components/dialog-select-server"
import { DateTime } from "luxon"

export type HomeContentVariant = "page" | "pane"

export interface HomeContentProps {
  variant: HomeContentVariant
  onSelectProject?: (directory: string) => void
  onNavigateMulti?: () => void
  selectedProject?: string
  hideLogo?: boolean
  showRelativeTime?: boolean
}

export function HomeContent(props: HomeContentProps) {
  const sync = useGlobalSync()
  const platform = usePlatform()
  const dialog = useDialog()
  const server = useServer()
  const homedir = createMemo(() => sync.data.path.home)
  const [internalSelected, setInternalSelected] = createSignal<string | undefined>(undefined)

  // For page variant, auto-select most recent project
  const mostRecentProject = createMemo(() => {
    const sorted = sync.data.project.toSorted(
      (a, b) => (b.time.updated ?? b.time.created) - (a.time.updated ?? a.time.created),
    )
    return sorted[0]?.worktree
  })
  const defaultProject = createMemo(() => sync.data.path.directory)

  // Track selected project (auto-selects most recent on page variant)
  const selectedProject = createMemo(() => {
    if (props.selectedProject !== undefined) return props.selectedProject
    const internal = internalSelected()
    if (internal) return internal
    if (props.variant === "page") return mostRecentProject() || defaultProject()
    return undefined
  })

  function selectProject(directory: string) {
    setInternalSelected(directory)
    props.onSelectProject?.(directory)
  }

  async function chooseProject() {
    function resolve(result: string | string[] | null) {
      if (Array.isArray(result)) {
        for (const directory of result) {
          selectProject(directory)
        }
      } else if (result) {
        selectProject(result)
      }
    }

    if (platform.openDirectoryPickerDialog && server.isLocal()) {
      const result = await platform.openDirectoryPickerDialog?.({
        title: "Open project",
        multiple: props.variant === "page",
      })
      resolve(result)
    } else {
      dialog.show(
        () => <DialogSelectDirectory multiple={props.variant === "page"} onSelect={resolve} />,
        () => resolve(null),
      )
    }
  }

  const projects = createMemo(() =>
    sync.data.project
      .toSorted((a, b) => (b.time.updated ?? b.time.created) - (a.time.updated ?? a.time.created))
      .slice(0, 5),
  )

  const maxWidth = () => (props.variant === "page" ? "max-w-xl" : "max-w-md")
  const logoWidth = () => (props.variant === "page" ? "w-xl" : "w-48")
  const marginTop = () => (props.variant === "page" ? "mt-20" : "mt-12")
  const emptyMarginTop = () => (props.variant === "page" ? "mt-30" : "mt-20")
  const showRelativeTime = createMemo(() => (props.showRelativeTime ?? true) && !props.hideLogo)

  return (
    <Show
      when={sync.ready}
      fallback={
        <div class="size-full flex items-center justify-center text-text-weak">Loading...</div>
      }
    >
      <div class="size-full flex flex-col">
        <div class="flex-1 flex flex-col items-center justify-center">
          <div class={`flex flex-col items-center w-full ${maxWidth()} px-6`}>
            <Show when={!props.hideLogo}>
              <Logo class={`${logoWidth()} opacity-12`} />
            </Show>
            <Button
              size="large"
              variant="ghost"
              class="mt-4 mx-auto text-14-regular text-text-weak"
              onClick={() => dialog.show(() => <DialogSelectServer />)}
            >
              <div
                classList={{
                  "size-2 rounded-full": true,
                  "bg-icon-success-base": server.healthy() === true,
                  "bg-icon-critical-base": server.healthy() === false,
                  "bg-border-weak-base": server.healthy() === undefined,
                }}
              />
              {server.name}
            </Button>
            <Switch>
              <Match when={projects().length > 0}>
                <div class={`${marginTop()} w-full flex flex-col gap-4`}>
                  <div class="flex gap-2 items-center justify-between pl-3">
                    <div class="text-14-medium text-text-strong">Recent projects</div>
                    <div class="flex gap-2">
                      <Button
                        icon="folder-add-left"
                        size="normal"
                        class="pl-2 pr-3"
                        onClick={chooseProject}
                      >
                        Open project
                      </Button>
                      <Show when={props.variant === "page"}>
                        <Button
                          icon="layout-bottom"
                          size="normal"
                          class="pl-2 pr-3"
                          onClick={props.onNavigateMulti}
                        >
                          New Tab
                        </Button>
                      </Show>
                    </div>
                  </div>
                  <ul class="flex flex-col gap-2">
                    <For each={projects()}>
                      {(project) => {
                        const isSelected = () => project.worktree === selectedProject()
                        return (
                          <Button
                            size="large"
                            variant={isSelected() ? "secondary" : "ghost"}
                            class="text-14-mono text-left justify-between px-3"
                            onClick={() => selectProject(project.worktree)}
                          >
                            <span
                              class="truncate"
                              classList={{ "text-text-accent-base": isSelected() }}
                            >
                              {project.worktree.replace(homedir(), "~")}
                            </span>
                            <Show when={isSelected()}>
                              <span class="text-11-regular text-text-accent-base shrink-0 ml-2">
                                selected
                              </span>
                            </Show>
                            <Show when={!isSelected()}>
                              <Show when={showRelativeTime()}>
                                <span class="text-14-regular text-text-weak">
                                  {DateTime.fromMillis(
                                    project.time.updated ?? project.time.created,
                                  ).toRelative()}
                                </span>
                              </Show>
                            </Show>
                          </Button>
                        )
                      }}
                    </For>
                  </ul>
                </div>
              </Match>
              <Match when={true}>
                <div class={`${emptyMarginTop()} mx-auto flex flex-col items-center gap-3`}>
                  <Icon name="folder-add-left" size="large" />
                  <div class="flex flex-col gap-1 items-center justify-center">
                    <div class="text-14-medium text-text-strong">No recent projects</div>
                    <div class="text-12-regular text-text-weak">
                      Get started by opening a local project
                    </div>
                  </div>
                  <div />
                  <div class="flex gap-2">
                    <Button class="px-3" onClick={chooseProject}>
                      Open project
                    </Button>
                    <Show when={props.variant === "page"}>
                      <Button class="px-3" variant="ghost" onClick={props.onNavigateMulti}>
                        <Icon name="layout-bottom" size="small" />
                        New Tab
                      </Button>
                    </Show>
                  </div>
                </div>
              </Match>
            </Switch>
          </div>
        </div>
      </div>
    </Show>
  )
}

import { createMemo, For, Match, Show, Switch } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { Logo } from "@opencode-ai/ui/logo"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useGlobalSync } from "@/context/global-sync"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"
import { DialogSelectDirectory } from "./dialog-select-directory"
import { DialogSelectServer } from "./dialog-select-server"
import { DateTime } from "luxon"

type PaneHomeProps = {
  onSelectProject: (directory: string) => void
}

export function PaneHome(props: PaneHomeProps) {
  const sync = useGlobalSync()
  const layout = useLayout()
  const platform = usePlatform()
  const dialog = useDialog()
  const server = useServer()
  const homedir = createMemo(() => sync.data.path.home)
  const projects = createMemo(() => sync.data.project)

  function selectProject(directory: string) {
    layout.projects.open(directory)
    props.onSelectProject(directory)
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
    <Show when={sync.ready} fallback={<div class="size-full flex items-center justify-center text-text-weak">Loading...</div>}>
      <div class="size-full flex flex-col">
        <div class="flex-1 flex flex-col items-center justify-center">
          <div class="flex flex-col items-center w-full max-w-md px-6">
            <Logo class="w-48 opacity-12" />
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
                <div class="mt-12 w-full flex flex-col gap-4">
                  <div class="flex gap-2 items-center justify-between pl-3">
                    <div class="text-14-medium text-text-strong">Recent projects</div>
                    <Button icon="folder-add-left" size="normal" class="pl-2 pr-3" onClick={chooseProject}>
                      Open project
                    </Button>
                  </div>
                  <ul class="flex flex-col gap-2">
                    <For
                      each={projects()
                        .toSorted((a, b) => (b.time.updated ?? b.time.created) - (a.time.updated ?? a.time.created))
                        .slice(0, 5)}
                    >
                      {(project) => (
                        <Button
                          size="large"
                          variant="ghost"
                          class="text-14-mono text-left justify-between px-3"
                          onClick={() => selectProject(project.worktree)}
                        >
                          {project.worktree.replace(homedir(), "~")}
                          <div class="text-14-regular text-text-weak">
                            {DateTime.fromMillis(project.time.updated ?? project.time.created).toRelative()}
                          </div>
                        </Button>
                      )}
                    </For>
                  </ul>
                </div>
              </Match>
              <Match when={true}>
                <div class="mt-20 mx-auto flex flex-col items-center gap-3">
                  <Icon name="folder-add-left" size="large" />
                  <div class="flex flex-col gap-1 items-center justify-center">
                    <div class="text-14-medium text-text-strong">No recent projects</div>
                    <div class="text-12-regular text-text-weak">Get started by opening a local project</div>
                  </div>
                  <div />
                  <Button class="px-3" onClick={chooseProject}>
                    Open project
                  </Button>
                </div>
              </Match>
            </Switch>
          </div>
        </div>

        {/* Prompt bar placeholder */}
        <div class="w-full max-w-lg mx-auto px-6 pb-6">
          <button
            type="button"
            onClick={chooseProject}
            class="group/prompt w-full bg-surface-raised-stronger-non-alpha shadow-xs-border rounded-md overflow-clip cursor-pointer hover:shadow-xs-border-hover transition-shadow"
          >
            <div class="px-5 py-3 text-14-regular text-text-weak text-left">
              Select a project to start...
            </div>
          </button>
        </div>
      </div>
    </Show>
  )
}

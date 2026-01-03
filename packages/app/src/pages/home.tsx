import { useGlobalSync } from "@/context/global-sync"
import { createMemo, For, Match, Switch } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { Logo } from "@opencode-ai/ui/logo"
import { useLayout } from "@/context/layout"
import { useNavigate } from "@solidjs/router"
import { base64Encode } from "@opencode-ai/util/encode"
import { Icon } from "@opencode-ai/ui/icon"
import { usePlatform } from "@/context/platform"
import { DateTime } from "luxon"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { DialogSelectDirectory } from "@/components/dialog-select-directory"
import { DialogSelectServer } from "@/components/dialog-select-server"
import { useServer } from "@/context/server"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip } from "@opencode-ai/ui/tooltip"

export default function Home() {
  const sync = useGlobalSync()
  const layout = useLayout()
  const platform = usePlatform()
  const dialog = useDialog()
  const navigate = useNavigate()
  const server = useServer()
  const homedir = createMemo(() => sync.data.path.home)

  function openProject(directory: string) {
    layout.projects.open(directory)
    navigate(`/${base64Encode(directory)}/session`)
  }

  async function chooseProject() {
    function resolve(result: string | string[] | null) {
      if (Array.isArray(result)) {
        for (const directory of result) {
          openProject(directory)
        }
      } else if (result) {
        openProject(result)
      }
    }

    if (platform.openDirectoryPickerDialog && server.isLocal()) {
      const result = await platform.openDirectoryPickerDialog?.({
        title: "Open project",
        multiple: true,
      })
      resolve(result)
    } else {
      dialog.show(
        () => <DialogSelectDirectory multiple={true} onSelect={resolve} />,
        () => resolve(null),
      )
    }
  }

  return (
    <div class="size-full flex flex-col">
      <div class="flex-1 flex flex-col items-center justify-center">
        <div class="flex flex-col items-center w-full max-w-xl px-6">
          <Logo class="w-xl opacity-12" />
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
            <Match when={sync.data.project.length > 0}>
              <div class="mt-20 w-full flex flex-col gap-4">
                <div class="flex gap-2 items-center justify-between pl-3">
                  <div class="text-14-medium text-text-strong">Recent projects</div>
                  <div class="flex gap-2">
                    <Button icon="folder-add-left" size="normal" class="pl-2 pr-3" onClick={chooseProject}>
                      Open project
                    </Button>
                    <Button icon="layout-bottom" size="normal" class="pl-2 pr-3" onClick={() => navigate("/multi")}>
                      New Tab
                    </Button>
                  </div>
                </div>
                <ul class="flex flex-col gap-2">
                  <For
                    each={sync.data.project
                      .toSorted((a, b) => (b.time.updated ?? b.time.created) - (a.time.updated ?? a.time.created))
                      .slice(0, 5)}
                  >
                    {(project) => (
                      <Button
                        size="large"
                        variant="ghost"
                        class="text-14-mono text-left justify-between px-3"
                        onClick={() => openProject(project.worktree)}
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
              <div class="mt-30 mx-auto flex flex-col items-center gap-3">
                <Icon name="folder-add-left" size="large" />
                <div class="flex flex-col gap-1 items-center justify-center">
                  <div class="text-14-medium text-text-strong">No recent projects</div>
                  <div class="text-12-regular text-text-weak">Get started by opening a local project</div>
                </div>
                <div />
                <div class="flex gap-2">
                  <Button class="px-3" onClick={chooseProject}>
                    Open project
                  </Button>
                  <Button class="px-3" variant="ghost" onClick={() => navigate("/multi")}>
                    <Icon name="layout-bottom" size="small" />
                    New Tab
                  </Button>
                </div>
              </div>
            </Match>
          </Switch>
        </div>
      </div>

      {/* Prompt bar - triggers project selection */}
      <div class="w-full max-w-200 mx-auto px-6 pb-8">
        <button
          type="button"
          onClick={chooseProject}
          class="group/prompt w-full bg-surface-raised-stronger-non-alpha shadow-xs-border rounded-md overflow-clip cursor-pointer hover:shadow-xs-border-hover transition-shadow"
        >
          <div class="px-5 py-3 text-14-regular text-text-weak text-left">
            Select a project to start...
          </div>
          <div class="p-3 flex items-center justify-between border-t border-border-base/50">
            <div class="flex items-center gap-1">
              <Button as="div" variant="ghost" class="gap-1.5 pointer-events-none opacity-50">
                <Icon name="brain" size="small" class="text-icon-info-active" />
                Build
                <Icon name="chevron-down" size="small" />
              </Button>
              <Button as="div" variant="ghost" class="pointer-events-none opacity-50">
                Select model
                <Icon name="chevron-down" size="small" />
              </Button>
            </div>
            <div class="flex items-center gap-2">
              <Tooltip placement="top" value="Select a project first">
                <IconButton
                  type="button"
                  disabled
                  icon="arrow-up"
                  variant="primary"
                  class="h-6 w-4.5 opacity-50"
                />
              </Tooltip>
            </div>
          </div>
        </button>
      </div>
    </div>
  )
}

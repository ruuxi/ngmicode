import { Component, Show, createMemo } from "solid-js"
import { useParams } from "@solidjs/router"
import { Popover } from "@opencode-ai/ui/popover"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { Switch } from "@opencode-ai/ui/switch"
import { usePermission } from "@/context/permission"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { useLayout } from "@/context/layout"

export const SettingsPopover: Component = () => {
  const permission = usePermission()
  const params = useParams()
  const sdk = useSDK()
  const sync = useSync()
  const layout = useLayout()

  const sessionID = () => params.id
  const isGitProject = createMemo(() => sync.data.vcs !== undefined)
  const hasPermissions = createMemo(() => permission.permissionsEnabled() && sessionID())

  return (
    <Popover
      placement="top"
      trigger={
        <IconButton
          icon="settings-gear"
          variant="ghost"
          class="size-6"
          classList={{
            "text-icon-success-base": !!(sessionID() && permission.isAutoAccepting(sessionID()!)),
          }}
        />
      }
      title="Settings"
      class="min-w-64"
    >
      <div class="flex flex-col gap-3 pt-2">
        {/* Worktree Section - for new sessions */}
        <Show when={isGitProject()}>
          <div class="flex flex-col gap-2">
            <div class="text-12-medium text-text-strong">New Sessions</div>
            <Switch
              checked={layout.worktree.enabled()}
              onChange={(checked) => layout.worktree.setEnabled(checked)}
            >
              Enable worktree isolation
            </Switch>
            <Show when={layout.worktree.enabled()}>
              <div class="flex flex-col gap-1 pl-6">
                <div class="text-11-medium text-text-base">Cleanup</div>
                <div class="flex flex-col gap-0.5">
                  <label class="flex items-center gap-2 text-11-regular text-text-base cursor-pointer">
                    <input
                      type="radio"
                      name="cleanup"
                      checked={layout.worktree.cleanup() === "ask"}
                      onChange={() => layout.worktree.setCleanup("ask")}
                      class="accent-icon-success-base"
                    />
                    Ask when deleting
                  </label>
                  <label class="flex items-center gap-2 text-11-regular text-text-base cursor-pointer">
                    <input
                      type="radio"
                      name="cleanup"
                      checked={layout.worktree.cleanup() === "always"}
                      onChange={() => layout.worktree.setCleanup("always")}
                      class="accent-icon-success-base"
                    />
                    Always delete
                  </label>
                  <label class="flex items-center gap-2 text-11-regular text-text-base cursor-pointer">
                    <input
                      type="radio"
                      name="cleanup"
                      checked={layout.worktree.cleanup() === "never"}
                      onChange={() => layout.worktree.setCleanup("never")}
                      class="accent-icon-success-base"
                    />
                    Never delete
                  </label>
                </div>
              </div>
            </Show>
          </div>
        </Show>

        {/* Permission Mode Section - only when in a session */}
        <Show when={hasPermissions()}>
          <Show when={isGitProject()}>
            <div class="border-t border-border-base" />
          </Show>
          <div class="flex flex-col gap-2">
            <div class="text-12-medium text-text-strong">Permissions</div>
            <div class="flex flex-col gap-1">
              <Button
                variant={permission.isAutoAccepting(sessionID()!) ? "primary" : "ghost"}
                class="justify-start gap-2 h-8"
                onClick={() => permission.toggleAutoAccept(sessionID()!, sdk.directory)}
              >
                <Icon
                  name="chevron-double-right"
                  size="small"
                  classList={{
                    "text-icon-success-base": permission.isAutoAccepting(sessionID()!),
                  }}
                />
                <span class="text-13-regular">Auto-accept edits</span>
                <Show when={permission.isAutoAccepting(sessionID()!)}>
                  <Icon name="check" size="small" class="ml-auto text-icon-success-base" />
                </Show>
              </Button>
            </div>
          </div>
        </Show>

        {/* Info Section */}
        <div class="pt-2 border-t border-border-base">
          <div class="text-11-regular text-text-subtle">
            <Show when={isGitProject() && !hasPermissions()}>
              When worktree is enabled, new sessions will be created in an isolated git worktree.
            </Show>
            <Show when={hasPermissions()}>
              When auto-accept is enabled, file edits are automatically approved without prompting.
            </Show>
          </div>
        </div>
      </div>
    </Popover>
  )
}

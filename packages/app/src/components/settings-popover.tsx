import { Component, Show } from "solid-js"
import { useParams } from "@solidjs/router"
import { Popover } from "@opencode-ai/ui/popover"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { usePermission } from "@/context/permission"
import { useSDK } from "@/context/sdk"

export const SettingsPopover: Component = () => {
  const permission = usePermission()
  const params = useParams()
  const sdk = useSDK()

  const sessionID = () => params.id

  return (
    <Show when={permission.permissionsEnabled() && sessionID()}>
      <Popover
        placement="top"
        trigger={
          <IconButton
            icon="settings-gear"
            variant="ghost"
            class="size-6"
            classList={{
              "text-icon-success-base": permission.isAutoAccepting(sessionID()!),
            }}
          />
        }
        title="Session Settings"
        class="min-w-56"
      >
        <div class="flex flex-col gap-3 pt-2">
          {/* Permission Mode Section */}
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

          {/* Info Section */}
          <div class="pt-2 border-t border-border-base">
            <div class="text-11-regular text-text-subtle">
              When enabled, file edits are automatically approved without prompting.
            </div>
          </div>
        </div>
      </Popover>
    </Show>
  )
}

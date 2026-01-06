import { Popover as Kobalte } from "@kobalte/core/popover"
import { Component, createMemo, createSignal, JSX, Show } from "solid-js"
import { useLocal } from "@/context/local"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { popularProviders } from "@/hooks/use-providers"
import { Button } from "@opencode-ai/ui/button"
import { Tag } from "@opencode-ai/ui/tag"
import { Dialog } from "@opencode-ai/ui/dialog"
import { List } from "@opencode-ai/ui/list"
import { Switch } from "@opencode-ai/ui/switch"
import { DialogSelectProvider } from "./dialog-select-provider"
import { DialogManageModels } from "./dialog-manage-models"

const ModelList: Component<{
  provider?: string
  class?: string
  onSelect: () => void
}> = (props) => {
  const local = useLocal()
  const isClaudeCodeMode = createMemo(() => local.mode.current()?.id === "claude-code")

  const models = createMemo(() =>
    local.model
      .list()
      .filter((m) => {
        // In Claude Code mode, show only claude-agent models (skip visibility check for them)
        // In other modes, hide claude-agent models
        if (isClaudeCodeMode()) {
          return m.provider.id === "claude-agent"
        }
        return m.provider.id !== "claude-agent"
      })
      .filter((m) => {
        // Skip visibility check for claude-agent models since they're always available
        if (m.provider.id === "claude-agent") return true
        return local.model.visible({ modelID: m.id, providerID: m.provider.id })
      })
      .filter((m) => (props.provider ? m.provider.id === props.provider : true)),
  )

  return (
    <List
      class={`flex-1 min-h-0 [&_[data-slot=list-scroll]]:flex-1 [&_[data-slot=list-scroll]]:min-h-0 ${props.class ?? ""}`}
      search={{ placeholder: "Search models", autofocus: true }}
      emptyMessage="No model results"
      key={(x) => `${x.provider.id}:${x.id}`}
      items={models}
      current={local.model.current()}
      filterKeys={["provider.name", "name", "id"]}
      sortBy={(a, b) => a.name.localeCompare(b.name)}
      groupBy={(x) => x.provider.name}
      sortGroupsBy={(a, b) => {
        if (a.category === "Recent" && b.category !== "Recent") return -1
        if (b.category === "Recent" && a.category !== "Recent") return 1
        const aProvider = a.items[0].provider.id
        const bProvider = b.items[0].provider.id
        if (popularProviders.includes(aProvider) && !popularProviders.includes(bProvider)) return -1
        if (!popularProviders.includes(aProvider) && popularProviders.includes(bProvider)) return 1
        return popularProviders.indexOf(aProvider) - popularProviders.indexOf(bProvider)
      }}
      onSelect={(x) => {
        local.model.set(x ? { modelID: x.id, providerID: x.provider.id } : undefined, {
          recent: true,
        })
        props.onSelect()
      }}
    >
      {(i) => (
        <div class="w-full flex items-center gap-x-2 text-13-regular">
          <span class="truncate">{i.name}</span>
          <Show when={i.provider.id === "opencode" && (!i.cost || i.cost?.input === 0)}>
            <Tag>Free</Tag>
          </Show>
          <Show when={i.latest}>
            <Tag>Latest</Tag>
          </Show>
        </div>
      )}
    </List>
  )
}

export const ModelSelectorPopover: Component<{
  provider?: string
  children: JSX.Element
}> = (props) => {
  const [open, setOpen] = createSignal(false)
  const local = useLocal()
  const isClaudeCodeMode = createMemo(() => local.mode.current()?.id === "claude-code")

  return (
    <Kobalte open={open()} onOpenChange={setOpen} placement="top-start" gutter={8}>
      <Kobalte.Trigger as="div">{props.children}</Kobalte.Trigger>
      <Kobalte.Portal>
        <Kobalte.Content class="w-72 flex flex-col rounded-md border border-border-base bg-surface-raised-stronger-non-alpha shadow-md z-50 outline-none">
          <Kobalte.Title class="sr-only">Select model</Kobalte.Title>
          <div class="h-72 flex flex-col">
            <ModelList provider={props.provider} onSelect={() => setOpen(false)} class="p-1" />
          </div>
          <Show when={isClaudeCodeMode()}>
            <div class="px-3 py-2.5 border-t border-border-base flex items-center justify-between">
              <div class="flex flex-col">
                <span class="text-13-medium text-text-base">Extended Thinking</span>
                <span class="text-11-regular text-text-weak">Deeper reasoning</span>
              </div>
              <Switch
                checked={local.model.thinking.current()}
                onChange={(checked) => local.model.thinking.set(checked)}
              />
            </div>
          </Show>
        </Kobalte.Content>
      </Kobalte.Portal>
    </Kobalte>
  )
}

export const DialogSelectModel: Component<{ provider?: string }> = (props) => {
  const dialog = useDialog()
  const local = useLocal()
  const isOhMyMode = createMemo(() => local.mode.current()?.id === "oh-my-opencode")
  const isClaudeCodeMode = createMemo(() => local.mode.current()?.id === "claude-code")

  if (isOhMyMode()) {
    return (
      <Dialog title="Select model" description="Managed by Oh My OpenCode">
        <div class="px-3 pb-6 text-13-regular text-text-weak">
          Model selection is managed by Oh My OpenCode. The current agent will use its configured default model.
        </div>
      </Dialog>
    )
  }

  if (isClaudeCodeMode()) {
    return (
      <Dialog title="Select model" description="Claude Code models">
        <ModelList provider={props.provider} onSelect={() => dialog.close()} />
        <div class="px-3 py-3 border-t border-border-base flex items-center justify-between">
          <div class="flex flex-col">
            <span class="text-13-medium text-text-base">Extended Thinking</span>
            <span class="text-12-regular text-text-weak">Enable deeper reasoning</span>
          </div>
          <Switch
            checked={local.model.thinking.current()}
            onChange={(checked) => local.model.thinking.set(checked)}
          />
        </div>
      </Dialog>
    )
  }

  return (
    <Dialog
      title="Select model"
      action={
        <Button
          class="h-7 -my-1 text-14-medium"
          icon="plus-small"
          tabIndex={-1}
          onClick={() => dialog.show(() => <DialogSelectProvider />)}
        >
          Connect provider
        </Button>
      }
    >
      <ModelList provider={props.provider} onSelect={() => dialog.close()} />
      <Button
        variant="ghost"
        class="ml-3 mt-5 mb-6 text-text-base self-start"
        onClick={() => dialog.show(() => <DialogManageModels />)}
      >
        Manage models
      </Button>
    </Dialog>
  )
}

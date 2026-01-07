import { Popover as Kobalte } from "@kobalte/core/popover"
import { Component, createMemo, createSignal, For, Show } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { Switch } from "@opencode-ai/ui/switch"
import { Tag } from "@opencode-ai/ui/tag"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useLocal } from "@/context/local"
import type { ModeDefinition } from "@/modes/types"
import { DialogEditMode } from "./dialog-edit-mode"

// Inline InstallModeDialog - same as in mode-selector.tsx
import { Dialog } from "@opencode-ai/ui/dialog"
import { showToast } from "@opencode-ai/ui/toast"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"

const InstallModeDialog: Component<{ mode: ModeDefinition; onInstalled?: () => void }> = (props) => {
  const dialog = useDialog()
  const local = useLocal()
  const sdk = useSDK()
  const sync = useSync()
  const [saving, setSaving] = createSignal(false)
  const missing = createMemo(() => local.mode.missingPlugins(props.mode))

  const installHint = createMemo(() =>
    missing().includes("oh-my-opencode") ? "bunx oh-my-opencode install" : "",
  )

  const handleInstall = async () => {
    if (saving()) return
    setSaving(true)
    try {
      const existing = sync.data.config.plugin ?? []
      const next = Array.from(new Set([...existing, ...missing()]))
      await sdk.client.config.update({
        config: {
          plugin: next,
        },
      })
      showToast({
        variant: "success",
        title: "Plugin added",
        description: "Restart OpenCode after installing dependencies.",
      })
      props.onInstalled?.()
      dialog.close()
    } catch (err) {
      const error = err as Error
      showToast({
        variant: "error",
        title: "Failed to update config",
        description: error.message,
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog title="Install plugin" description={`"${props.mode.name}" requires ${missing().join(", ")}`}>
      <div class="flex flex-col gap-4 px-2.5 pb-3">
        <div class="text-12-regular text-text-weak">
          Add the plugin to your config and complete installation to enable this mode.
        </div>
        <Show when={installHint()}>
          <div class="flex flex-col gap-1">
            <div class="text-12-medium text-text-strong">Install command</div>
            <div class="px-2 py-1 rounded-md border border-border-base bg-surface-raised-base text-12-regular font-mono">
              {installHint()}
            </div>
          </div>
        </Show>
        <div class="flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => dialog.close()}>
            Cancel
          </Button>
          <Button type="button" variant="primary" onClick={handleInstall} disabled={saving()}>
            {saving() ? "Adding..." : "Add to config"}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

export const MegaSelector: Component<{ class?: string }> = (props) => {
  const dialog = useDialog()
  const local = useLocal()
  const [open, setOpen] = createSignal(false)

  const currentMode = createMemo(() => local.mode.current())
  const modes = createMemo(() => local.mode.list())
  const agents = createMemo(() => local.agent.list())
  const currentAgent = createMemo(() => local.agent.current())

  const isClaudeCodeMode = createMemo(() => currentMode()?.id === "claude-code")
  const isCodexMode = createMemo(() => currentMode()?.id === "codex")
  const isOhMyMode = createMemo(() => currentMode()?.id === "oh-my-opencode")

  const models = createMemo(() =>
    local.model
      .list()
      .filter((m) => {
        if (isClaudeCodeMode()) {
          return m.provider.id === "claude-agent" || m.provider.id === "openrouter"
        }
        if (isCodexMode()) {
          return m.provider.id === "codex"
        }
        return m.provider.id !== "claude-agent" && m.provider.id !== "codex"
      })
      .filter((m) => {
        if (m.provider.id === "claude-agent" || m.provider.id === "codex") return true
        return local.model.visible({ modelID: m.id, providerID: m.provider.id })
      }),
  )

  const currentModel = createMemo(() => local.model.current())
  const variants = createMemo(() => local.model.variant.list())
  const currentVariant = createMemo(() => local.model.variant.current())
  const hasVariants = createMemo(() => variants().length > 0 && !isOhMyMode())

  const handleModeSelect = (mode: ModeDefinition) => {
    if (currentMode()?.id === mode.id) return
    if (!local.mode.isAvailable(mode)) {
      setOpen(false)
      dialog.show(() => <InstallModeDialog mode={mode} onInstalled={() => local.mode.set(mode.id)} />)
      return
    }
    local.mode.set(mode.id)
  }

  const handleModeEdit = (mode: ModeDefinition, event: MouseEvent) => {
    event.stopPropagation()
    setOpen(false)
    dialog.show(() => <DialogEditMode mode={mode} />)
  }

  return (
    <Kobalte open={open()} onOpenChange={setOpen} placement="top-start" gutter={8}>
      <Kobalte.Trigger as="div" class={props.class}>
        <Button variant="ghost" class="gap-1.5">
          <span class="truncate max-w-[120px]">{currentMode()?.name ?? "Mode"}</span>
          <Icon name="chevron-down" size="small" />
        </Button>
      </Kobalte.Trigger>
      <Kobalte.Portal>
        <Kobalte.Content class="w-[640px] h-64 rounded-md border border-border-base bg-surface-raised-stronger-non-alpha shadow-md z-50 outline-none overflow-hidden">
          <Kobalte.Title class="sr-only">Mode, Agent, and Model settings</Kobalte.Title>

          <div class="flex h-full">
            {/* MODE COLUMN */}
            <div class="flex flex-col p-2 border-r border-border-base w-[180px] shrink-0">
              <div class="text-11-regular text-text-subtle px-1 pb-1 uppercase tracking-wider shrink-0">Mode</div>
              <div class="flex flex-col gap-0.5 flex-1 overflow-y-auto">
                <For each={modes()}>
                  {(mode) => {
                    const missing = createMemo(() => local.mode.missingPlugins(mode))
                    const isCurrent = createMemo(() => currentMode()?.id === mode.id)
                    return (
                      <div class="group flex items-center">
                        <button
                          type="button"
                          class="flex-1 flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-surface-raised-base-hover text-left"
                          classList={{
                            "bg-surface-raised-base-hover": isCurrent(),
                            "opacity-70": missing().length > 0,
                          }}
                          onClick={() => handleModeSelect(mode)}
                        >
                          <span class="flex-1 text-13-medium text-text-strong truncate">{mode.name}</span>
                        </button>
                        <button
                          type="button"
                          class="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-surface-raised-base-hover"
                          onClick={(e) => handleModeEdit(mode, e)}
                        >
                          <Icon name="edit-small-2" size="small" class="text-icon-base" />
                        </button>
                      </div>
                    )
                  }}
                </For>
              </div>
            </div>

            {/* AGENT COLUMN */}
            <div class="flex flex-col p-2 border-r border-border-base w-[130px] shrink-0">
              <div class="text-11-regular text-text-subtle px-1 pb-1 uppercase tracking-wider shrink-0">Agent</div>
              <div class="flex flex-col gap-0.5 flex-1 overflow-y-auto">
                <For each={agents()}>
                  {(agent) => {
                    const isCurrent = createMemo(() => currentAgent()?.name === agent.name)
                    return (
                      <button
                        type="button"
                        class="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-surface-raised-base-hover text-left"
                        classList={{ "bg-surface-raised-base-hover": isCurrent() }}
                        onClick={() => local.agent.set(agent.name)}
                      >
                        <span class="flex-1 text-13-medium text-text-strong capitalize truncate">{agent.name}</span>
                      </button>
                    )
                  }}
                </For>
              </div>
            </div>

            {/* MODEL COLUMN */}
            <div class="flex flex-col p-2 border-r border-border-base w-[190px] shrink-0">
              <div class="text-11-regular text-text-subtle px-1 pb-1 uppercase tracking-wider shrink-0">Model</div>
              <Show
                when={!isOhMyMode()}
                fallback={
                  <div class="px-2 py-3 text-12-regular text-text-weak text-center">
                    Managed by Oh My OpenCode
                  </div>
                }
              >
                <div class="flex flex-col gap-0.5 flex-1 overflow-y-auto">
                  <For each={models()}>
                    {(model) => {
                      const isCurrent = createMemo(
                        () => currentModel()?.id === model.id && currentModel()?.provider.id === model.provider.id,
                      )
                      return (
                        <button
                          type="button"
                          class="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-surface-raised-base-hover text-left"
                          classList={{ "bg-surface-raised-base-hover": isCurrent() }}
                          onClick={() => {
                            local.model.set({ modelID: model.id, providerID: model.provider.id }, { recent: true })
                          }}
                        >
                          <span class="flex-1 text-13-regular text-text-strong truncate">{model.name}</span>
                          <Show when={model.latest}>
                            <Tag>Latest</Tag>
                          </Show>
                        </button>
                      )
                    }}
                  </For>
                </div>
              </Show>
            </div>

            {/* OPTIONS COLUMN (Variant + Extended Thinking) */}
            <div class="flex flex-col p-2 flex-1 overflow-hidden">
              <div class="text-11-regular text-text-subtle px-1 pb-1 uppercase tracking-wider shrink-0">Options</div>
              <div class="flex flex-col gap-2 flex-1 overflow-y-auto">
                {/* VARIANT SECTION */}
                <Show when={hasVariants()}>
                  <div class="flex flex-col gap-1">
                    <div class="text-11-regular text-text-weak px-1">Thinking Effort</div>
                    <div class="flex flex-col gap-0.5">
                      <button
                        type="button"
                        class="px-2 py-1 rounded text-12-regular text-left"
                        classList={{
                          "bg-surface-info-base/20 text-text-info-base": currentVariant() === undefined,
                          "hover:bg-surface-raised-base-hover text-text-subtle": currentVariant() !== undefined,
                        }}
                        onClick={() => local.model.variant.set(undefined)}
                      >
                        Default
                      </button>
                      <For each={variants()}>
                        {(variant) => (
                          <button
                            type="button"
                            class="px-2 py-1 rounded text-12-regular capitalize text-left"
                            classList={{
                              "bg-surface-info-base/20 text-text-info-base": currentVariant() === variant,
                              "hover:bg-surface-raised-base-hover text-text-subtle": currentVariant() !== variant,
                            }}
                            onClick={() => local.model.variant.set(variant)}
                          >
                            {variant}
                          </button>
                        )}
                      </For>
                    </div>
                  </div>
                </Show>

                {/* EXTENDED THINKING SECTION (Claude Code only) */}
                <Show when={isClaudeCodeMode()}>
                  <div class="flex items-center justify-between gap-2 px-1 py-1.5">
                    <span class="text-12-regular text-text-base">Extended Thinking</span>
                    <Switch
                      checked={local.model.thinking.current()}
                      onChange={(checked) => local.model.thinking.set(checked)}
                    />
                  </div>
                </Show>

                {/* Fallback when no options available */}
                <Show when={!hasVariants() && !isClaudeCodeMode()}>
                  <div class="px-2 py-3 text-12-regular text-text-weak text-center">
                    No options available
                  </div>
                </Show>
              </div>
            </div>
          </div>
        </Kobalte.Content>
      </Kobalte.Portal>
    </Kobalte>
  )
}

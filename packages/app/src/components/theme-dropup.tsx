import { createMemo, createSignal, For, Show } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { Popover } from "@opencode-ai/ui/popover"
import { useTheme } from "@opencode-ai/ui/theme"

export function ThemeDropup() {
  const theme = useTheme()
  const [open, setOpen] = createSignal(false)

  const items = createMemo(() =>
    Object.entries(theme.themes())
      .map(([id, definition]) => ({
        id,
        name: definition.name ?? id,
      }))
      .toSorted((a, b) => a.name.localeCompare(b.name)),
  )

  return (
    <Popover
      placement="top-end"
      open={open()}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) theme.cancelPreview()
      }}
      trigger={
        <Button size="normal" variant="ghost" class="px-3 text-12-regular text-text-weak">
          theme
          <Icon name="chevron-down" size="small" class="rotate-180" />
        </Button>
      }
      class="w-64"
    >
      <div class="flex flex-col gap-1" onMouseLeave={() => theme.cancelPreview()}>
        <For each={items()}>
          {(item) => {
            const selected = () => item.id === theme.themeId()
            return (
              <Button
                size="normal"
                variant={selected() ? "secondary" : "ghost"}
                class="justify-between px-2"
                onClick={() => {
                  theme.setTheme(item.id)
                  theme.cancelPreview()
                  setOpen(false)
                }}
                onMouseEnter={() => theme.previewTheme(item.id)}
                onFocus={() => theme.previewTheme(item.id)}
              >
                <span class="truncate">{item.name}</span>
                <Show when={selected()}>
                  <Icon name="check-small" size="small" class="text-text-accent-base" />
                </Show>
              </Button>
            )
          }}
        </For>
      </div>
    </Popover>
  )
}

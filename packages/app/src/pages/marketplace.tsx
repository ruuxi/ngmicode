import { createMemo, createResource, createSignal, For, Match, Show, Switch } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { useServer } from "@/context/server"
import { Tag } from "@opencode-ai/ui/tag"
import { Switch as ToggleSwitch } from "@opencode-ai/ui/switch"

interface InstalledPlugin {
  id: string
  source: "local" | "marketplace"
  path: string
  enabled: boolean
  manifest: {
    name: string
    version: string
    description?: string
    author?: { name: string } | string
  }
  installedAt: number
}

interface MarketplaceEntry {
  id: string
  name: string
  version: string
  description?: string
  author?: string
  source: string
  tags?: string[]
}

export default function Marketplace() {
  const server = useServer()
  const [tab, setTab] = createSignal<"installed" | "available">("installed")
  const [loading, setLoading] = createSignal<string | null>(null)
  const [searchQuery, setSearchQuery] = createSignal("")

  // Fetch installed plugins
  const [installed, { refetch: refetchInstalled }] = createResource(async () => {
    const response = await fetch(`${server.url}/claude-plugin/installed`)
    if (!response.ok) return []
    return (await response.json()) as InstalledPlugin[]
  })

  // Fetch marketplace plugins
  const [marketplace, { refetch: refetchMarketplace }] = createResource(async () => {
    const response = await fetch(`${server.url}/claude-plugin/marketplace`)
    if (!response.ok) return []
    return (await response.json()) as MarketplaceEntry[]
  })

  // Filter marketplace to exclude already installed
  const availablePlugins = createMemo(() => {
    const installedIds = new Set(installed()?.map((p) => p.manifest.name) ?? [])
    return (marketplace() ?? []).filter((p) => !installedIds.has(p.name))
  })

  // Filter by search
  const filteredInstalled = createMemo(() => {
    const query = searchQuery().toLowerCase()
    if (!query) return installed() ?? []
    return (installed() ?? []).filter(
      (p) =>
        p.manifest.name.toLowerCase().includes(query) ||
        p.manifest.description?.toLowerCase().includes(query),
    )
  })

  const filteredAvailable = createMemo(() => {
    const query = searchQuery().toLowerCase()
    if (!query) return availablePlugins()
    return availablePlugins().filter(
      (p) =>
        p.name.toLowerCase().includes(query) ||
        p.description?.toLowerCase().includes(query) ||
        p.tags?.some((t) => t.toLowerCase().includes(query)),
    )
  })

  async function installPlugin(id: string) {
    setLoading(id)
    try {
      await fetch(`${server.url}/claude-plugin/install`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      })
      await refetchInstalled()
      await refetchMarketplace()
    } finally {
      setLoading(null)
    }
  }

  async function uninstallPlugin(id: string) {
    setLoading(id)
    try {
      await fetch(`${server.url}/claude-plugin/uninstall`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      })
      await refetchInstalled()
    } finally {
      setLoading(null)
    }
  }

  async function togglePlugin(id: string, enabled: boolean) {
    setLoading(id)
    try {
      const endpoint = enabled ? "enable" : "disable"
      await fetch(`${server.url}/claude-plugin/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      })
      await refetchInstalled()
    } finally {
      setLoading(null)
    }
  }

  async function refreshMarketplace() {
    setLoading("refresh")
    try {
      await fetch(`${server.url}/claude-plugin/marketplace/refresh`, { method: "POST" })
      await refetchMarketplace()
    } finally {
      setLoading(null)
    }
  }

  function getAuthorName(author: { name: string } | string | undefined): string {
    if (!author) return "Unknown"
    if (typeof author === "string") return author
    return author.name
  }

  return (
    <div class="size-full flex flex-col">
      {/* Header */}
      <div class="flex items-center justify-between p-6 border-b border-border-base">
        <div class="flex flex-col gap-1">
          <h1 class="text-18-medium text-text-strong">Marketplace</h1>
          <p class="text-14-regular text-text-base">Discover and manage Claude Code plugins</p>
        </div>
        <Button
          variant="ghost"
          size="normal"
          icon="magnifying-glass"
          disabled={loading() === "refresh"}
          onClick={refreshMarketplace}
        >
          Refresh
        </Button>
      </div>

      {/* Search and Tabs */}
      <div class="flex gap-4 items-center px-6 py-4 border-b border-border-base">
        <div class="flex gap-2">
          <Button variant={tab() === "installed" ? "primary" : "ghost"} onClick={() => setTab("installed")}>
            Installed
            <Show when={installed()?.length}>
              <Tag>{installed()?.length}</Tag>
            </Show>
          </Button>
          <Button variant={tab() === "available" ? "primary" : "ghost"} onClick={() => setTab("available")}>
            Available
            <Show when={availablePlugins().length}>
              <Tag>{availablePlugins().length}</Tag>
            </Show>
          </Button>
        </div>
        <div class="flex-1" />
        <input
          type="text"
          placeholder="Search plugins..."
          class="px-3 py-2 rounded-md bg-surface-raised-base border border-border-base text-14-regular text-text-base placeholder:text-text-weak focus:outline-none focus:border-border-strong-base"
          value={searchQuery()}
          onInput={(e) => setSearchQuery(e.currentTarget.value)}
        />
      </div>

      {/* Plugin List */}
      <div class="flex-1 overflow-auto p-6">
        <Switch>
          <Match when={tab() === "installed"}>
            <Show
              when={filteredInstalled().length > 0}
              fallback={
                <div class="flex flex-col items-center justify-center py-20 text-text-weak">
                  <Icon name="folder" class="size-12 opacity-50" />
                  <p class="mt-4 text-14-regular">No plugins installed</p>
                  <Button variant="ghost" class="mt-2" onClick={() => setTab("available")}>
                    Browse available plugins
                  </Button>
                </div>
              }
            >
              <div class="grid gap-4">
                <For each={filteredInstalled()}>
                  {(plugin) => (
                    <div class="flex items-center justify-between p-4 rounded-lg bg-surface-raised-base border border-border-base">
                      <div class="flex flex-col gap-1 flex-1 min-w-0">
                        <div class="flex items-center gap-2 flex-wrap">
                          <span class="text-14-medium text-text-strong">{plugin.manifest.name}</span>
                          <Tag>{plugin.manifest.version}</Tag>
                          <Tag>{plugin.source}</Tag>
                        </div>
                        <Show when={plugin.manifest.description}>
                          <p class="text-13-regular text-text-base truncate">{plugin.manifest.description}</p>
                        </Show>
                        <p class="text-12-regular text-text-weak">
                          by {getAuthorName(plugin.manifest.author)}
                        </p>
                      </div>
                      <div class="flex items-center gap-3 ml-4">
                        <ToggleSwitch
                          checked={plugin.enabled}
                          disabled={loading() === plugin.id}
                          onChange={() => togglePlugin(plugin.id, !plugin.enabled)}
                        />
                        <Button
                          variant="ghost"
                          size="small"
                          disabled={loading() === plugin.id}
                          onClick={() => uninstallPlugin(plugin.id)}
                        >
                          Uninstall
                        </Button>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </Match>

          <Match when={tab() === "available"}>
            <Show
              when={!marketplace.loading}
              fallback={
                <div class="flex flex-col items-center justify-center py-20 text-text-weak">
                  <Icon name="magnifying-glass" class="size-8 animate-spin opacity-50" />
                  <p class="mt-4 text-14-regular">Loading marketplace...</p>
                </div>
              }
            >
              <Show
                when={filteredAvailable().length > 0}
                fallback={
                  <div class="flex flex-col items-center justify-center py-20 text-text-weak">
                    <Icon name="folder" class="size-12 opacity-50" />
                    <p class="mt-4 text-14-regular">
                      {searchQuery() ? "No plugins match your search" : "No plugins available"}
                    </p>
                  </div>
                }
              >
                <div class="grid gap-4">
                  <For each={filteredAvailable()}>
                    {(plugin) => (
                      <div class="flex items-center justify-between p-4 rounded-lg bg-surface-raised-base border border-border-base">
                        <div class="flex flex-col gap-1 flex-1 min-w-0">
                          <div class="flex items-center gap-2 flex-wrap">
                            <span class="text-14-medium text-text-strong">{plugin.name}</span>
                            <Tag>{plugin.version}</Tag>
                            <Show when={plugin.tags}>
                              <For each={plugin.tags?.slice(0, 3)}>
                                {(tag) => <Tag>{tag}</Tag>}
                              </For>
                            </Show>
                          </div>
                          <Show when={plugin.description}>
                            <p class="text-13-regular text-text-base truncate">{plugin.description}</p>
                          </Show>
                          <Show when={plugin.author}>
                            <p class="text-12-regular text-text-weak">by {plugin.author}</p>
                          </Show>
                        </div>
                        <div class="flex items-center gap-3 ml-4">
                          <Button
                            variant="primary"
                            size="small"
                            disabled={loading() === plugin.id}
                            onClick={() => installPlugin(plugin.id)}
                          >
                            {loading() === plugin.id ? "Installing..." : "Install"}
                          </Button>
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </Show>
          </Match>
        </Switch>
      </div>
    </div>
  )
}

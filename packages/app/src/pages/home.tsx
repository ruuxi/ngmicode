import { createSignal } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { HomeContent } from "@/components/home-content"
import { PromptInput } from "@/components/prompt-input"
import { SDKProvider } from "@/context/sdk"
import { SyncProvider, useSync } from "@/context/sync"
import { LocalProvider } from "@/context/local"
import { TerminalProvider } from "@/context/terminal"
import { PromptProvider } from "@/context/prompt"
import { DataProvider } from "@opencode-ai/ui/context"
import { useGlobalSync } from "@/context/global-sync"
import { useLayout } from "@/context/layout"
import { base64Encode } from "@opencode-ai/util/encode"

function HomeWithPrompt(props: { directory: string }) {
  const navigate = useNavigate()
  const layout = useLayout()

  function handleSessionCreated(sessionId: string) {
    navigate(`/${base64Encode(props.directory)}/session/${sessionId}`)
  }

  return (
    <SDKProvider directory={props.directory}>
      <SyncProvider>
        <SyncedHomePrompt
          directory={props.directory}
          onSessionCreated={handleSessionCreated}
        />
      </SyncProvider>
    </SDKProvider>
  )
}

function SyncedHomePrompt(props: { directory: string; onSessionCreated: (sessionId: string) => void }) {
  const sync = useSync()

  return (
    <DataProvider
      data={sync.data}
      directory={props.directory}
      onPermissionRespond={() => Promise.resolve()}
    >
      <LocalProvider>
        <TerminalProvider>
          <PromptProvider>
            <div class="w-full max-w-200 mx-auto px-6 pb-8">
              <PromptInput onSessionCreated={props.onSessionCreated} />
            </div>
          </PromptProvider>
        </TerminalProvider>
      </LocalProvider>
    </DataProvider>
  )
}

export default function Home() {
  const navigate = useNavigate()
  const layout = useLayout()
  const globalSync = useGlobalSync()

  // Track selected project (auto-selects most recent)
  const [selectedProject, setSelectedProject] = createSignal<string | undefined>(undefined)

  // Get most recent project for prompt context
  const mostRecent = () => {
    const sorted = globalSync.data.project.toSorted(
      (a, b) => (b.time.updated ?? b.time.created) - (a.time.updated ?? a.time.created),
    )
    return sorted[0]?.worktree
  }

  const effectiveProject = () => selectedProject() ?? mostRecent()

  function handleSelectProject(directory: string) {
    setSelectedProject(directory)
    layout.projects.open(directory)
  }

  function handleNavigateProject(directory: string) {
    layout.projects.open(directory)
    navigate(`/${base64Encode(directory)}/session`)
  }

  return (
    <div class="size-full flex flex-col">
      <HomeContent
        variant="page"
        selectedProject={effectiveProject()}
        onSelectProject={handleSelectProject}
        onNavigateMulti={() => navigate("/multi")}
      />

      {/* Prompt bar - functional when a project is selected */}
      {effectiveProject() ? (
        <HomeWithPrompt directory={effectiveProject()!} />
      ) : (
        <div class="w-full max-w-200 mx-auto px-6 pb-8">
          <button
            type="button"
            onClick={() => navigate("/multi")}
            class="group/prompt w-full bg-surface-raised-stronger-non-alpha shadow-xs-border rounded-md overflow-clip cursor-pointer hover:shadow-xs-border-hover transition-shadow"
          >
            <div class="px-5 py-3 text-14-regular text-text-weak text-left">
              Select a project to start...
            </div>
          </button>
        </div>
      )}
    </div>
  )
}

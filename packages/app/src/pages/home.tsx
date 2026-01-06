import { Show, createMemo, createSignal } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { HomePromptBar, HomeScreen } from "@/components/home-screen"
import { useGlobalSync } from "@/context/global-sync"
import { base64Encode } from "@opencode-ai/util/encode"

export default function Home() {
  const navigate = useNavigate()
  const globalSync = useGlobalSync()
  const [selectedProject, setSelectedProject] = createSignal<string | undefined>(undefined)

  const mostRecent = createMemo(() => {
    const sorted = globalSync.data.project.toSorted(
      (a, b) => (b.time.updated ?? b.time.created) - (a.time.updated ?? a.time.created),
    )
    return sorted[0]?.worktree
  })

  const effectiveProject = createMemo(() => selectedProject() ?? mostRecent())

  function handleSessionCreated(directory: string, sessionId: string) {
    navigate(`/${base64Encode(directory)}/session/${sessionId}`)
  }

  return (
    <div class="size-full flex flex-col">
      <HomeScreen
        selectedProject={effectiveProject()}
        onProjectSelected={setSelectedProject}
        onNavigateMulti={() => navigate("/multi?newTab=true")}
      />
      <Show when={effectiveProject()}>
        {(directory) => (
          <HomePromptBar
            directory={directory()}
            onSessionCreated={(sessionId) => handleSessionCreated(directory(), sessionId)}
          />
        )}
      </Show>
    </div>
  )
}

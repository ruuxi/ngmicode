import { Show, createEffect } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Icon } from "@opencode-ai/ui/icon"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { Spinner } from "@opencode-ai/ui/spinner"
import { useVoice } from "@/context/voice"
import { DialogVoiceSettings } from "./dialog-voice-settings"

interface VoiceButtonProps {
  onTranscription?: (text: string) => void
}

export function VoiceButton(props: VoiceButtonProps) {
  const voice = useVoice()
  const dialog = useDialog()

  // Watch for transcription results and call the callback
  createEffect(() => {
    const text = voice.state.lastTranscription()
    if (text && props.onTranscription) {
      props.onTranscription(text)
      voice.actions.clearTranscription()
    }
  })

  const handleClick = () => {
    // If not configured, show settings dialog
    if (!voice.settings.hasConfigured()) {
      dialog.show(() => <DialogVoiceSettings />)
      return
    }

    // Toggle recording
    voice.actions.toggle()
  }

  const getTooltipText = () => {
    if (!voice.settings.hasConfigured()) {
      return "Configure voice input"
    }
    if (voice.state.isTranscribing()) {
      return "Transcribing..."
    }
    if (voice.state.isRecording()) {
      return "Stop recording"
    }
    return "Start voice input"
  }

  const getIconName = () => {
    if (voice.state.isRecording()) {
      return "microphone-recording"
    }
    return "microphone"
  }

  return (
    <Tooltip placement="top" value={getTooltipText()}>
      <Button
        type="button"
        variant="ghost"
        class="size-6"
        classList={{
          "text-icon-critical-base": voice.state.isRecording(),
        }}
        onClick={handleClick}
        disabled={voice.state.isTranscribing()}
      >
        <Show
          when={!voice.state.isTranscribing()}
          fallback={<Spinner class="size-4.5" />}
        >
          <Icon
            name={getIconName()}
            class="size-4.5"
            classList={{
              "animate-pulse": voice.state.isRecording(),
            }}
          />
        </Show>
      </Button>
    </Tooltip>
  )
}

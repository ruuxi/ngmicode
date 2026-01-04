/**
 * Audio capture utility for streaming raw PCM samples to the Rust backend.
 * Captures audio at 16kHz mono float32 format for ONNX STT inference.
 */

type AudioChunkCallback = (samples: Float32Array) => void

export class AudioCapture {
  private audioContext: AudioContext | null = null
  private mediaStream: MediaStream | null = null
  private processor: ScriptProcessorNode | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private onAudioChunk: AudioChunkCallback | null = null

  async start(onAudioChunk: AudioChunkCallback): Promise<void> {
    if (this.audioContext) {
      throw new Error("AudioCapture already started")
    }

    this.onAudioChunk = onAudioChunk

    // Request microphone access with 16kHz sample rate
    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: 16000,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    })

    // Create audio context at 16kHz
    this.audioContext = new AudioContext({ sampleRate: 16000 })

    // Create source from stream
    this.source = this.audioContext.createMediaStreamSource(this.mediaStream)

    // Use ScriptProcessorNode for audio processing
    // Buffer size of 4096 samples at 16kHz = ~256ms chunks
    this.processor = this.audioContext.createScriptProcessor(4096, 1, 1)

    this.processor.onaudioprocess = (event) => {
      const inputData = event.inputBuffer.getChannelData(0)
      // Create a copy of the samples since the buffer is reused
      const samples = new Float32Array(inputData.length)
      samples.set(inputData)
      this.onAudioChunk?.(samples)
    }

    // Connect: source -> processor -> destination (required for processor to work)
    this.source.connect(this.processor)
    this.processor.connect(this.audioContext.destination)
  }

  stop(): void {
    // Disconnect processor
    if (this.processor) {
      this.processor.disconnect()
      this.processor.onaudioprocess = null
      this.processor = null
    }

    // Disconnect source
    if (this.source) {
      this.source.disconnect()
      this.source = null
    }

    // Stop all tracks
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop())
      this.mediaStream = null
    }

    // Close audio context
    if (this.audioContext) {
      this.audioContext.close()
      this.audioContext = null
    }

    this.onAudioChunk = null
  }

  isRecording(): boolean {
    return this.audioContext !== null
  }
}

/**
 * Check if audio capture is supported in the current environment
 */
export function isAudioCaptureSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices !== "undefined" &&
    typeof navigator.mediaDevices.getUserMedia === "function" &&
    typeof AudioContext !== "undefined"
  )
}

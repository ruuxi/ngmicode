import { useMarked } from "../context/marked"
import { ComponentProps, createEffect, createSignal, onCleanup, splitProps } from "solid-js"

const MARKDOWN_CACHE_LIMIT = 200
const markdownCache = new Map<string, string>()

function getCachedMarkdown(text: string) {
  const cached = markdownCache.get(text)
  if (!cached) return undefined
  markdownCache.delete(text)
  markdownCache.set(text, cached)
  return cached
}

function setCachedMarkdown(text: string, html: string) {
  if (markdownCache.has(text)) {
    markdownCache.delete(text)
  }
  markdownCache.set(text, html)
  if (markdownCache.size > MARKDOWN_CACHE_LIMIT) {
    const oldest = markdownCache.keys().next().value
    if (oldest) markdownCache.delete(oldest)
  }
}

function escapeHtml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function toPlainHtml(text: string) {
  if (!text) return ""
  const escaped = escapeHtml(text)
  const paragraphs = escaped.split(/\n{2,}/)
  return `<p>${paragraphs.map((p) => p.replace(/\n/g, "<br/>")).join("</p><p>")}</p>`
}

export function Markdown(
  props: ComponentProps<"div"> & {
    text: string
    class?: string
    classList?: Record<string, boolean>
  },
) {
  const [local, others] = splitProps(props, ["text", "class", "classList"])
  const marked = useMarked()
  const [html, setHtml] = createSignal<string | undefined>(getCachedMarkdown(local.text) ?? toPlainHtml(local.text))

  createEffect(() => {
    const text = local.text
    if (!text) {
      setHtml("")
      return
    }

    const cached = getCachedMarkdown(text)
    if (cached) {
      setHtml(cached)
      return
    }

    let active = true
    const parsed = marked.parse(text)
    if (typeof parsed === "string") {
      setCachedMarkdown(text, parsed)
      setHtml(parsed)
      return
    }
    Promise.resolve(parsed).then((result) => {
      if (!active) return
      const value = result ?? ""
      setCachedMarkdown(text, value)
      setHtml(value)
    })
    onCleanup(() => {
      active = false
    })
  })
  return (
    <div
      data-component="markdown"
      classList={{
        ...(local.classList ?? {}),
        [local.class ?? ""]: !!local.class,
      }}
      innerHTML={html() ?? ""}
      {...others}
    />
  )
}

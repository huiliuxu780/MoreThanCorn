/** 回答正文 Markdown 渲染（09-11 治理轮 P2）：react-markdown + remark-gfm，
 * 元素样式全部映射到我方 Tailwind/token 类（禁裸标签默认样式）。 */
import * as React from "react"
import MarkdownLib from "react-markdown"
import { CodeBlock } from "@/components/chat/code-block"
import remarkGfm from "remark-gfm"

const components = {
  h1: (p: { children?: React.ReactNode }) => (
    <h1 className="mt-3 mb-1 text-base font-semibold first:mt-0">{p.children}</h1>
  ),
  h2: (p: { children?: React.ReactNode }) => (
    <h2 className="mt-3 mb-1 text-sm font-semibold first:mt-0">{p.children}</h2>
  ),
  h3: (p: { children?: React.ReactNode }) => (
    <h3 className="mt-2 mb-1 text-sm font-medium first:mt-0">{p.children}</h3>
  ),
  p: (p: { children?: React.ReactNode }) => <p className="my-1.5 leading-6">{p.children}</p>,
  ul: (p: { children?: React.ReactNode }) => (
    <ul className="my-1.5 list-disc space-y-1 pl-5">{p.children}</ul>
  ),
  ol: (p: { children?: React.ReactNode }) => (
    <ol className="my-1.5 list-decimal space-y-1 pl-5">{p.children}</ol>
  ),
  li: (p: { children?: React.ReactNode }) => <li className="leading-6">{p.children}</li>,
  a: (p: { href?: string; children?: React.ReactNode }) => (
    <a
      href={p.href}
      target="_blank"
      rel="noreferrer noopener"
      className="underline decoration-brand/60 underline-offset-2 hover:decoration-brand"
    >
      {p.children}
    </a>
  ),
  code: (p: { className?: string; children?: React.ReactNode }) => (
    <code className="rounded bg-(--segment-bg) px-1 py-0.5 font-mono text-[12px]">
      {p.children}
    </code>
  ),
  pre: (p: { children?: React.ReactNode }) => {
    const child = React.Children.toArray(p.children)[0] as React.ReactElement | undefined
    const props = (child?.props ?? {}) as { className?: string; children?: unknown }
    const m = /language-([\w-]+)/.exec(props.className ?? "")
    return <CodeBlock code={String(props.children ?? "")} language={m?.[1]} />
  },
  blockquote: (p: { children?: React.ReactNode }) => (
    <blockquote className="my-1.5 border-l-2 border-brand/50 pl-3 text-muted-foreground">
      {p.children}
    </blockquote>
  ),
  table: (p: { children?: React.ReactNode }) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-xs">{p.children}</table>
    </div>
  ),
  th: (p: { children?: React.ReactNode }) => (
    <th className="border px-2 py-1 text-left font-medium">{p.children}</th>
  ),
  td: (p: { children?: React.ReactNode }) => (
    <td className="border px-2 py-1 align-top">{p.children}</td>
  ),
  hr: () => <hr className="my-3" />,
} as const

const RAW_CODE_START = /^(<svg|<\?xml|<html|<!doctype)/i
const RAW_CODE_END: Record<string, RegExp> = {
  "<svg": /<\/svg>/i,
  "<?xml": /<\/\w+>/,
  "<html": /<\/html>/i,
  "<!doctype": /<\/html>/i,
}

/** 09-11 批9：模型常把 SVG/XML 以裸标签内联输出，react-markdown 默认丢弃未知 HTML
 *  → 代码残缺观感差。渲染前把裸代码段自动围栅成 fenced block 交 CodeBlock。 */
export function fenceRawCode(text: string): string {
  const lines = text.split("\n")
  const out: string[] = []
  let fence: string | null = null
  let endRe: RegExp | null = null
  let inOriginalFence = false
  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      inOriginalFence = !inOriginalFence
      out.push(line)
      continue
    }
    if (!fence) {
      const m = RAW_CODE_START.exec(line.trim())
      if (m && !inOriginalFence) {
        fence = m[1].toLowerCase()
        endRe = RAW_CODE_END[fence] ?? /<\/[^>]+>/
        out.push("```" + (fence === "<svg" ? "svg" : "markup"))
        out.push(line)
        if (endRe.test(line)) {
          out.push("```")
          fence = null
          endRe = null
        }
        continue
      }
      out.push(line)
    } else {
      out.push(line)
      if (endRe && endRe.test(line)) {
        out.push("```")
        fence = null
        endRe = null
      }
    }
  }
  if (fence) out.push("```")
  return out.join("\n")
}

export function Markdown({ content, className }: { content: string; className?: string }) {
  return (
    <div className={className ?? "text-sm"}>
      <MarkdownLib remarkPlugins={[remarkGfm]} components={components as never}>
        {fenceRawCode(content)}
      </MarkdownLib>
    </div>
  )
}

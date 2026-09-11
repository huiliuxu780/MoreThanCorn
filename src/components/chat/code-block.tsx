/** 代码块（09-11 批9：用户指「代码展示不专业、给过参考组件」→ 同构 beUI CodeBlock 结构：
 *  语言头（语言标签+复制按钮）+ 语法高亮体；配色走我方 token（inline style 用 var()，四主题自适应）。 */
import * as React from "react"
import { Check, Copy } from "lucide-react"
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter"
import { Button } from "@/components/ui/button"

const LANG_ALIAS: Record<string, string> = {
  js: "javascript", ts: "typescript", tsx: "tsx", jsx: "jsx", sh: "bash",
  shell: "bash", zsh: "bash", py: "python", yml: "yaml", md: "markdown",
  xml: "markup", html: "markup", svg: "markup",
}

/** token 色板：inline style 直接吃 CSS 变量，四主题（含双羊皮纸）自动跟随。 */
const tokenStyle = {
  'code[class*="language-"]': {
    color: "var(--text-secondary)",
    background: "none",
    fontFamily: "var(--mono, ui-monospace, monospace)",
    fontSize: "12px",
    lineHeight: "1.6",
  },
  'pre[class*="language-"]': {
    background: "none",
    margin: 0,
    padding: "10px 12px",
    overflow: "auto",
  },
  comment: { color: "var(--text-tertiary)", fontStyle: "italic" },
  string: { color: "var(--status-success)" },
  keyword: { color: "var(--brand)" },
  function: { color: "var(--status-running)" },
  number: { color: "var(--status-warning)" },
  operator: { color: "var(--text-secondary)", background: "none" },
  punctuation: { color: "var(--text-tertiary)", background: "none" },
  tag: { color: "var(--brand)" },
  "attr-name": { color: "var(--status-warning)" },
  "attr-value": { color: "var(--status-success)" },
  builtin: { color: "var(--status-running)" },
  boolean: { color: "var(--status-warning)" },
} as const

export function CodeBlock({ code, language }: { code: string; language?: string }) {
  const [copied, setCopied] = React.useState(false)
  const lang = LANG_ALIAS[language ?? ""] ?? (language || "text")
  return (
    <div className="my-2 overflow-hidden rounded-lg border bg-(--segment-bg)">
      <div className="flex items-center gap-2 border-b border-(--line-soft, var(--border)) px-3 py-1.5">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {lang}
        </span>
        <span className="ml-auto">
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            aria-label="复制代码"
            onClick={() => {
              void navigator.clipboard?.writeText(code)
              setCopied(true)
              window.setTimeout(() => setCopied(false), 1500)
            }}
          >
            {copied ? <Check className="size-3 text-(--status-success)" /> : <Copy className="size-3" />}
          </Button>
        </span>
      </div>
      <SyntaxHighlighter
        language={lang}
        style={tokenStyle as never}
        showLineNumbers={code.split("\n").length > 3}
        lineNumberStyle={{ color: "var(--text-tertiary)", minWidth: "2em", paddingRight: "1em" }}
        customStyle={{ maxHeight: 320 }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  )
}

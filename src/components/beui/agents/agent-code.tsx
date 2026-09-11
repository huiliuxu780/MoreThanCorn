/** beUI agent-code 的同 API 替代实现（09-11 beUI 移植轮）：
 *  原版依赖 shiki 异步高亮；我方以轻量同步词法器替代（注释/字符串/关键字/数字四色），
 *  颜色走我方 token（CSS 变量），导出签名与原版一致（AgentCode/AgentCodeLine/
 *  useAgentCodeTokens/AgentCodeLanguage/AgentCodeToken/AgentCodeTokenLines）。 */
import { type CSSProperties, Fragment } from "react"
import { cn } from "@/lib/utils"

export type AgentCodeLanguage =
  | "bash"
  | "diff"
  | "json"
  | "text"
  | "tsx"
  | "typescript"

export interface AgentCodeToken {
  content: string
  offset: number
  light?: string
  dark?: string
}

export type AgentCodeTokenLines = AgentCodeToken[][]

export interface AgentCodeProps {
  code: string
  language?: AgentCodeLanguage
  className?: string
}

export interface AgentCodeLineProps {
  code: string
  tokens?: AgentCodeToken[]
  className?: string
}

const C = {
  comment: "var(--text-tertiary)",
  string: "var(--status-success)",
  keyword: "var(--brand)",
  number: "var(--status-warning)",
  plain: "currentColor",
}

const KEYWORDS = new Set([
  "const", "let", "var", "function", "return", "if", "else", "for", "while",
  "import", "export", "from", "await", "async", "class", "new", "type",
  "interface", "true", "false", "null", "undefined", "echo", "cd", "npm",
  "git", "curl", "python", "node",
])

function tokenizeLine(line: string): AgentCodeToken[] {
  const tokens: AgentCodeToken[] = []
  let offset = 0
  const push = (content: string, color: string) => {
    if (!content) return
    tokens.push({ content, offset, light: color, dark: color })
    offset += content.length
  }
  const trimmed = line.trimStart()
  if (trimmed.startsWith("#") || trimmed.startsWith("//") || trimmed.startsWith("---")) {
    push(line, C.comment)
    return tokens
  }
  const re = /("[^"]*"|'[^']*'|`[^`]*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][A-Za-z0-9_-]*)|(\s+|[^\sA-Za-z0-9_"'`]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(line))) {
    const [text, str, num, word] = m
    if (str) push(text, C.string)
    else if (num) push(text, C.number)
    else if (word) push(text, KEYWORDS.has(word) ? C.keyword : C.plain)
    else push(text, C.plain)
  }
  return tokens
}

/** 同步词法器：原版为 shiki 异步；签名保持 (code, language) → TokenLines。 */
export function useAgentCodeTokens(code: string, _language: AgentCodeLanguage): AgentCodeTokenLines {
  return code.split("\n").map(tokenizeLine)
}

export function AgentCodeLine({ code, tokens, className }: AgentCodeLineProps) {
  return (
    <span className={className}>
      {tokens
        ? tokens.map((token) => (
            <span
              key={`${token.offset}-${token.content}`}
              style={
                {
                  "--agent-code-light": token.light ?? "currentColor",
                  "--agent-code-dark": token.dark ?? token.light ?? "currentColor",
                } as CSSProperties
              }
              className="text-[var(--agent-code-light)] dark:text-[var(--agent-code-dark)]"
            >
              {token.content}
            </span>
          ))
        : code}
    </span>
  )
}

export function AgentCode({ code, language = "bash", className }: AgentCodeProps) {
  const tokens = useAgentCodeTokens(code, language)
  let offset = 0
  const lines = code.split("\n").map((content) => {
    const line = { content, offset }
    offset += content.length + 1
    return line
  })
  return (
    <pre
      className={cn(
        "m-0 overflow-x-auto whitespace-pre font-mono text-xs leading-5 text-foreground/85",
        className,
      )}
    >
      <code>
        {lines.map((line, index) => (
          <Fragment key={line.offset}>
            <AgentCodeLine code={line.content} tokens={tokens[index]} />
            {index < lines.length - 1 ? "\n" : null}
          </Fragment>
        ))}
      </code>
    </pre>
  )
}

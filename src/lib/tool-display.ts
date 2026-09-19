/** 工具入参/出参的展示层helper（09-18 工具面板优雅展示）。
 *
 * 运行时 tool_result 的原始形态是 content-block 信封数组
 * （`[{type:"text",text:"<JSON 字符串>"}]`），input 也可能已是 JSON 字符串——
 * 直接 stringify 展示会得到双重转义引号（`"{\"ticketId\": …}"`）。
 * 统一在此：取文本 → 解字符串信封 → 对象则缩进；非 JSON 保持原文。
 */

/** 09-11：运行时 TOOL_RESULT 文本 delta 为 JSON 字符串封装，展示前解包防双重转义。 */
export function unwrapJsonString(s: string): string {
  const t = s.trim()
  if (t.startsWith('"') && t.endsWith('"')) {
    try {
      const v = JSON.parse(t)
      if (typeof v === "string") return v
    } catch {
      /* 保持原文 */
    }
  }
  return s
}

/** 从 tool_result 的 output/content 信封中取出纯文本（多 block 拼接）。 */
export function toolResultText(
  tr: Record<string, unknown> | null | undefined,
): string {
  const raw = tr ? (tr.output ?? tr.content) : undefined
  if (raw == null) return ""
  if (typeof raw === "string") return raw
  if (Array.isArray(raw)) {
    return raw
      .map((b) =>
        b && typeof b === "object"
          ? String((b as Record<string, unknown>).text ?? "")
          : String(b ?? ""),
      )
      .filter(Boolean)
      .join("\n")
  }
  if (typeof raw === "object") {
    return String((raw as Record<string, unknown>).text ?? JSON.stringify(raw))
  }
  return String(raw)
}

/** 工具入参/出参优雅展示：解字符串信封、JSON 对象缩进、非 JSON 保持原文；
 *  超 cap 截断并附诚实注记（不静默切）。 */
export function prettyToolPayload(v: unknown, cap: number): string {
  let s = typeof v === "string" ? v : JSON.stringify(v ?? {})
  s = unwrapJsonString(s)
  try {
    const parsed: unknown = JSON.parse(s)
    if (parsed !== null && typeof parsed === "object") {
      s = JSON.stringify(parsed, null, 2)
    }
  } catch {
    /* 非 JSON 保持原文 */
  }
  return s.length > cap ? `${s.slice(0, cap)}\n…（截断，全文 ${s.length} 字）` : s
}

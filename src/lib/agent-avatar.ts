/** Agent 默认头像池（09-07：6 张原站风手绘 SVG 替换 20 旧 PNG；色板/结构见实测台账 §3）。 */
export const AVATARS = Array.from({ length: 8 }, (_, i) => `/avatars/avatar-${i}.png`)

/** 头像回落：按 id 哈希稳定取图，保证列表/详情/对话一致。 */
export function avatarFor(id: string, avatar?: string | null) {
  return avatar ?? AVATARS[id.split("").reduce((a, c) => a + c.charCodeAt(0), 0) % AVATARS.length]
}

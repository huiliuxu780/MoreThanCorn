/** Agent 默认头像池（09-11：用户 supplied 五张成品工牌照为唯一池，旧 13 张已清理）。 */
export const AVATARS = Array.from({ length: 5 }, (_, i) => `/avatars/avatar-${i}.png`)

/** 头像回落：按 id 哈希稳定取图，保证列表/详情/对话一致。 */
export function avatarFor(id: string, avatar?: string | null) {
  return avatar ?? AVATARS[id.split("").reduce((a, c) => a + c.charCodeAt(0), 0) % AVATARS.length]
}

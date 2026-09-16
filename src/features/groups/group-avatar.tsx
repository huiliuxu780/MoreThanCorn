/** Group 头像簇（台账 §1/§2 实测）：侧栏 32 容器 3×15 圆三角；管理页 48 mint tile 3×21。
 * 排布=原站 CSS count-3：上中/左下/右下（3|13.5px 偏移）。成员头像源复用 Agent 头像池。 */
import { avatarFor } from "@/lib/agent-avatar"

const TRI3 = [
  { top: 1, left: 8 },
  { bottom: 2, left: 1 },
  { bottom: 2, right: 1 },
] as const

const TRI3_MGMT = [
  { top: 3, left: 13.5 },
  { bottom: 3, left: 3 },
  { bottom: 3, right: 3 },
] as const

export function GroupAvatarCluster({
  memberIds,
  variant = "sidebar",
}: {
  memberIds: string[]
  variant?: "sidebar" | "mgmt"
}) {
  const ids = memberIds.slice(0, 3)
  if (variant === "mgmt") {
    return (
      <span
        className="relative shrink-0 overflow-hidden rounded-[8px]"
        style={{ width: 48, height: 48, background: "var(--group-avatar-tile)" }}
      >
        {ids.length === 0 && (
          <span className="flex h-full w-full items-center justify-center text-[12px] text-(--text-tertiary)">
            群
          </span>
        )}
        {ids.map((id, i) => (
          <span
            key={id}
            className="absolute overflow-hidden rounded-full border border-(--background)"
            style={{
              width: 21,
              height: 21,
              top: (TRI3_MGMT[i] as Record<string, number>).top,
              left: (TRI3_MGMT[i] as Record<string, number>).left,
              bottom: (TRI3_MGMT[i] as Record<string, number>).bottom,
              right: (TRI3_MGMT[i] as Record<string, number>).right,
            }}
          >
            <img src={avatarFor(id)} alt="" className="h-full w-full object-cover" />
          </span>
        ))}
      </span>
    )
  }
  return (
    <span className="relative shrink-0" style={{ width: 32, height: 32 }}>
      {ids.map((id, i) => (
        <span
          key={id}
          className="absolute overflow-hidden rounded-full border border-(--background)"
          style={{
            width: 15,
            height: 15,
            top: (TRI3[i] as Record<string, number>).top,
            left: (TRI3[i] as Record<string, number>).left,
            bottom: (TRI3[i] as Record<string, number>).bottom,
            right: (TRI3[i] as Record<string, number>).right,
          }}
        >
          <img src={avatarFor(id)} alt="" className="h-full w-full object-cover" />
        </span>
      ))}
    </span>
  )
}

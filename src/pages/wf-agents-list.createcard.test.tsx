// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"
import { fireEvent, render } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { CreateCard } from "./wf-agents-list"

describe("CreateCard 工牌叠卡（09-11 审计补测）", () => {
  it("mouse-leave 回收后五牌顺序必变（固定随机序列走兜底轮换）", () => {
    const rnd = vi.spyOn(Math, "random").mockReturnValue(0.99)
    const { container } = render(
      <MemoryRouter>
        <CreateCard />
      </MemoryRouter>,
    )
    const srcs = () =>
      Array.from(container.querySelectorAll("img")).map((i) => i.getAttribute("src"))
    const before = srcs()
    expect(before).toHaveLength(5)
    fireEvent.mouseLeave(container.querySelector("a") as Element)
    expect(srcs()).not.toEqual(before)
    rnd.mockRestore()
  })
})

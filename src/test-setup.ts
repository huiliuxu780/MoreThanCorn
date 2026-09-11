// vitest 全局 setup：jsdom 缺失 API 的最小 polyfill（仅测试环境）。
if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {
    /* jsdom 无布局，no-op */
  }
}
// beUI PromptInput 经 radix use-size 依赖 ResizeObserver；jsdom 无实现（09-11）。
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof globalThis.ResizeObserver
}

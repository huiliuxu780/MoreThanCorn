// vitest 全局 setup：jsdom 缺失 API 的最小 polyfill（仅测试环境）。
if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {
    /* jsdom 无布局，no-op */
  }
}

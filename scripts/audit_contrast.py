"""四层审计·批2-8：四主题 WCAG 对比度量化（2026-09-13）。

方法：解析 src/index.css 的 :root（light）与三个 [data-theme] 覆盖块，
解析 var() 引用后按 WCAG 2.x 相对亮度公式计算配对对比度：
- 正文级配对（状态小字/次级文本等实际以 10–13px 渲染）门槛 4.5:1；
- 大字/UI 非文本配对（边框/填充上的徽章）门槛 3.0:1。

只报告、只修确凿 <4.5 的正文配对（审计 UI#21 承诺：不凭观感改数值）。
用法：python3 scripts/audit_contrast.py [--json-out PATH]
退出码：正文级配对存在 <4.5:1 → 1。
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CSS = ROOT / "src" / "index.css"

# (前景 token, 背景 token, 门槛, 用途说明)
PAIRS = [
    ("--text-primary", "--background", 4.5, "正文主色"),
    ("--text-secondary", "--background", 4.5, "次级文本/muted-foreground"),
    ("--text-secondary", "--surface", 4.5, "卡片上次级文本"),
    ("--text-tertiary", "--background", 4.5, "辅助小字（时间戳/说明）"),
    ("--text-tertiary", "--surface", 4.5, "卡片上辅助小字"),
    ("--status-success", "--surface", 4.5, "成功状态文本"),
    ("--status-warning", "--surface", 4.5, "警告状态文本"),
    ("--status-danger", "--surface", 4.5, "危险状态文本"),
    ("--brand-primary", "--background", 4.5, "品牌绿文本/链接"),
    ("--selected-foreground", "--selected", 4.5, "导航选中态文本"),
    # 真实徽章形态：状态色文本落在同族 soft 背景上（StateBadge/LANE_CHIP 实际用法）
    ("--status-success", "--status-success-soft", 4.5, "成功徽章文本(soft底)"),
    ("--status-warning", "--status-warning-soft", 4.5, "警告徽章文本(soft底)"),
    ("--status-danger", "--status-danger-soft", 4.5, "危险徽章文本(soft底)"),
    ("--text-secondary", "--fill-secondary", 3.0, "填充徽章文本(大字级)"),
    ("--border", "--background", 3.0, "边框非文本对比"),
]


def _blocks(css: str) -> dict[str, dict[str, str]]:
    """按主题切块：light=:root 默认；其余取 [data-theme=...] 覆盖。"""
    themes: dict[str, dict[str, str]] = {"light": {}, "dark": {},
                                         "light-parchment": {},
                                         "dark-parchment": {}}
    # :root 块（首个）
    m = re.search(r":root\s*\{(.*?)\}", css, re.S)
    if m:
        for k, v in re.findall(r"(--[\w-]+)\s*:\s*([^;]+);", m.group(1)):
            themes["light"][k] = v.strip()
    for name in ("dark", "light-parchment", "dark-parchment"):
        m = re.search(r'\[data-theme="%s"\]\s*\{(.*?)\}' % re.escape(name), css, re.S)
        if m:
            for k, v in re.findall(r"(--[\w-]+)\s*:\s*([^;]+);", m.group(1)):
                themes[name][k] = v.strip()
    # dark/parchment 继承 :root 未覆盖项
    for name in themes:
        if name != "light":
            merged = dict(themes["light"])
            merged.update(themes[name])
            themes[name] = merged
    return themes


def _resolve(token: str, theme: dict[str, str], depth: int = 0) -> str:
    v = theme.get(token, "")
    if depth > 6 or not v:
        return v
    m = re.fullmatch(r"var\((--[\w-]+)\)", v)
    if m:
        return _resolve(m.group(1), theme, depth + 1)
    return v


def _rgb(hexstr: str) -> tuple[int, int, int] | None:
    h = hexstr.strip().lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    if len(h) != 6 or not re.fullmatch(r"[0-9a-fA-F]{6}", h):
        return None
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def _lum(rgb: tuple[int, int, int]) -> float:
    def chan(c: int) -> float:
        s = c / 255.0
        return s / 12.92 if s <= 0.04045 else ((s + 0.055) / 1.055) ** 2.4
    r, g, b = (chan(x) for x in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def ratio(fg: str, bg: str) -> float | None:
    a, b = _rgb(fg), _rgb(bg)
    if a is None or b is None:
        return None
    l1, l2 = _lum(a), _lum(b)
    hi, lo = max(l1, l2), min(l1, l2)
    return (hi + 0.05) / (lo + 0.05)


def main() -> int:
    css = CSS.read_text()
    themes = _blocks(css)
    rows = []
    text_fail = 0
    for name, theme in themes.items():
        for fg_t, bg_t, threshold, usage in PAIRS:
            fg = _resolve(fg_t, theme)
            bg = _resolve(bg_t, theme)
            r = ratio(fg, bg)
            if r is None:
                rows.append({"theme": name, "pair": f"{fg_t}/{bg_t}",
                             "ratio": None, "threshold": threshold,
                             "usage": usage, "note": "token 缺失或非 hex"})
                continue
            ok = r >= threshold
            if not ok and threshold >= 4.5:
                text_fail += 1
            rows.append({"theme": name, "pair": f"{fg_t} on {bg_t}",
                         "fg": fg, "bg": bg, "ratio": round(r, 2),
                         "threshold": threshold, "usage": usage,
                         "pass": ok})
    print(f"=== 对比度量化：{len(themes)} 主题 × {len(PAIRS)} 配对 ===")
    for r in rows:
        if r.get("ratio") is None:
            print(f"  [?][{r['theme']}] {r['pair']} {r['note']}")
            continue
        mark = "PASS" if r["pass"] else ("FAIL" if r["threshold"] >= 4.5 else "warn")
        print(f"  [{mark}][{r['theme']:>16}] {r['ratio']:>6}:1 "
              f"(门槛 {r['threshold']}) {r['usage']}  {r['pair']}")
    print(f"\n正文级(<4.5:1) 确凿违规：{text_fail}")
    if "--json-out" in sys.argv:
        out = Path(sys.argv[sys.argv.index("--json-out") + 1])
        out.write_text(json.dumps(rows, ensure_ascii=False, indent=2))
        print(f"JSON 已写 {out}")
    return 1 if text_fail else 0


if __name__ == "__main__":
    sys.exit(main())

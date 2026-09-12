"""四层审计·层1：假控件/死链/硬编码状态 扫荡（2026-09-13）。

用法：python3 scripts/audit_layer1_fake_controls.py [--update-baseline]
规则：
- 假按钮候选：<Button/<button 无 onClick/onMouseDown、无 asChild、无 disabled、非 type=submit；
- 死链：<a href="#"> 或 href 空；
- 硬编码状态：JSX 文本节点直出状态词（已完成/执行中/需要操作/失败/排队中/已封存）且非变量插值；
- 基线只减不增：scripts/audit_layer1_baseline.json 存候选清单哈希集合，新增即 P0。
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
BASELINE = ROOT / "scripts" / "audit_layer1_baseline.json"

BUTTON_RE = re.compile(r"<(Button|button)\b([^>]*)>", re.S)
A_RE = re.compile(r"<a\b([^>]*)>", re.S)
STATUS_WORDS = ("已完成", "执行中", "需要操作", "失败/取消", "排队中", "已封存")
HARD_STATUS_RE = re.compile(
    r">\s*(?:" + "|".join(STATUS_WORDS) + r")\s*<")


def scan() -> dict[str, list[str]]:
    findings: dict[str, list[str]] = {"fake_buttons": [], "dead_links": [],
                                      "hard_status": []}
    for tsx in sorted(SRC.rglob("*.tsx")):
        src = tsx.read_text()
        rel = str(tsx.relative_to(ROOT))
        for m in BUTTON_RE.finditer(src):
            attrs = m.group(2)
            if any(k in attrs for k in ("onClick", "onMouseDown", "asChild",
                                        "disabled", 'type="submit"', "{...props}",
                                        "{...rest}")):
                continue
            line = src[:m.start()].count("\n") + 1
            # asChild 包装器模式：前两行出现 asChild> 的 Radix 触发器包裹；
            # trigger={ 插槽模式：按钮作为组件 trigger prop 传入，由组件接 asChild 接线
            prev = "\n".join(src[:m.start()].split("\n")[-4:])
            if "asChild" in prev or "trigger={" in prev:
                continue
            findings["fake_buttons"].append(f"{rel}:{line}")
        for m in A_RE.finditer(src):
            attrs = m.group(1)
            hm = re.search(r'href=\{?["\']([^"\']*)["\']', attrs)
            if hm and hm.group(1) in ("", "#"):
                line = src[:m.start()].count("\n") + 1
                findings["dead_links"].append(f"{rel}:{line}")
        for m in HARD_STATUS_RE.finditer(src):
            line_src = src[:m.start()].split("\n")[-1]
            # SelectItem/option 的静态选项标签是合法文案，非渲染状态
            if "SelectItem" in line_src or "option" in line_src.lower():
                continue
            # h1–h6 标题是分区标签（如「需要操作」区头，展示与否由数据条件驱动），
            # 状态徽章实际渲染在 span/div/td，标题词不算硬编码状态
            head = src.rfind("<", 0, m.start())
            tag = re.match(r"<(h[1-6])\b", src[head:head + 8]) if head >= 0 else None
            if tag:
                continue
            line = src[:m.start()].count("\n") + 1
            findings["hard_status"].append(f"{rel}:{line}")
    return findings


def main() -> int:
    findings = scan()
    total = {k: len(v) for k, v in findings.items()}
    print("=== 层1 扫荡计数 ===", total)
    for k, v in findings.items():
        for x in v[:30]:
            print(f"  [{k}] {x}")
        if len(v) > 30:
            print(f"  …另有 {len(v) - 30} 条")
    if "--update-baseline" in sys.argv:
        BASELINE.write_text(json.dumps(findings, indent=2, ensure_ascii=False))
        print("baseline updated")
        return 0
    if BASELINE.exists():
        base = json.loads(BASELINE.read_text())
        new_items = []
        for k, v in findings.items():
            new_items += [x for x in v if x not in base.get(k, [])]
        if new_items:
            print(f"\nP0 新增假控件 {len(new_items)}:")
            for x in new_items:
                print("  P0", x)
            return 1
        print("基线对比：无新增（只减不增门禁通过）")
    else:
        print("无基线文件：先 --update-baseline 建立基线")
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""HAR 脱敏脚本（仅标准库）。用法：python3 sanitize-har.py <raw.har> <sanitized.har>

剥离/掩码：Cookie、Set-Cookie、Authorization、*token*、*secret*、*api*key*、*password*、
手机号/邮箱/证件号等敏感头、cookie 数组与 JSON body 字段；保留 URL/method/status/时序/结构，
供 Network 契约分析使用。原始 HAR 不会离开你的机器。
"""
import json
import re
import sys

SENSITIVE_NAME = re.compile(
    r"(?i)(cookie|authorization|proxy-authorization|.*token.*|.*secret.*|.*api[-_]?key.*|"
    r".*password.*|.*passwd.*|phone|mobile|idcard|identity|.*session.*|.*credential.*)"
)
EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+")
PHONE = re.compile(r"(?<!\d)1[3-9]\d{9}(?!\d)")


def mask_value(v):
    if isinstance(v, str):
        v = EMAIL.sub("***@***", v)
        v = PHONE.sub("1**********", v)
        return v if v == EMAIL.sub("***@***", v) and "***" not in v else v
    return v


def clean_obj(o):
    """递归掩码 JSON 中敏感键的值。"""
    if isinstance(o, dict):
        return {
            k: ("***" if SENSITIVE_NAME.match(str(k)) else clean_obj(v))
            for k, v in o.items()
        }
    if isinstance(o, list):
        return [clean_obj(x) for x in o]
    if isinstance(o, str):
        return mask_value(o)
    return o


def clean_headers(headers):
    out = []
    for h in headers or []:
        if SENSITIVE_NAME.match(h.get("name", "")):
            out.append({"name": h.get("name"), "value": "***"})
        else:
            out.append({"name": h.get("name"), "value": mask_value(h.get("value", ""))})
    return out


def clean_post(post):
    if not post:
        return post
    text = post.get("text")
    if text:
        try:
            post = {**post, "text": json.dumps(clean_obj(json.loads(text)), ensure_ascii=False)}
        except (ValueError, TypeError):
            post = {**post, "text": mask_value(text)}
    return post


def main():
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(1)
    src, dst = sys.argv[1], sys.argv[2]
    with open(src, encoding="utf-8") as f:
        har = json.load(f)
    entries = har.get("log", {}).get("entries", [])
    for e in entries:
        req = e.get("request", {})
        res = e.get("response", {})
        req["headers"] = clean_headers(req.get("headers"))
        req["cookies"] = []
        req["queryString"] = [
            {"name": q.get("name"), "value": "***" if SENSITIVE_NAME.match(q.get("name", "")) else mask_value(q.get("value", ""))}
            for q in req.get("queryString", [])
        ]
        req["postData"] = clean_post(req.get("postData"))
        res["headers"] = clean_headers(res.get("headers"))
        res["cookies"] = []
        content = res.get("content")
        if content and content.get("text"):
            try:
                content["text"] = json.dumps(clean_obj(json.loads(content["text"])), ensure_ascii=False)
            except (ValueError, TypeError):
                content["text"] = mask_value(content["text"])
    with open(dst, "w", encoding="utf-8") as f:
        json.dump(har, f, ensure_ascii=False, indent=1)
    print(f"OK: {len(entries)} entries -> {dst}")


if __name__ == "__main__":
    main()

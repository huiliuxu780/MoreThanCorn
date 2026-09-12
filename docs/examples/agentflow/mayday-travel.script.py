# 示例：五一去哪玩 · 多 Agent 编排（A 拆解 → B 天气 ∥ C 景点 → A 汇总）
# 真实运行证据见 docs/acceptance/2026-09-12-P1-SCRIPT-AGENTFLOW.md
"""五一去哪玩：A 意图拆分设目标 → B 天气 ∥ C 景点 → 汇报 A → 完整推荐。"""
import json

META = {{
    "inputSchema": {{
        "type": "object",
        "properties": {{
            "question": {{"type": "string", "description": "消费者的原始提问", "default": "我五一去哪玩"}}
        }},
    }},
    "outputSchema": {{
        "type": "object",
        "required": ["recommendation"],
        "properties": {{
            "recommendation": {{"type": "string", "description": "完整旅行推荐（Markdown）"}},
        }},
    }},
    "phases": ["意图拆分与目标设定", "并行调研", "汇总推荐"],
    "scope_agent_id": "{aid_a}",
}}

PLAN_SCHEMA = {{
    "type": "object",
    "required": ["plan_summary", "goals"],
    "properties": {{
        "plan_summary": {{"type": "string", "description": "一句话概括消费者意图"}},
        "goals": {{
            "type": "array",
            "items": {{
                "type": "object",
                "required": ["assigned_to", "goal", "instruction"],
                "properties": {{
                    "assigned_to": {{"type": "string", "description": "B 或 C"}},
                    "goal": {{"type": "string", "description": "子目标"}},
                    "instruction": {{"type": "string", "description": "写给下游执行者的完整执行指令"}},
                }},
            }},
        }},
    }},
}}

WEATHER_SCHEMA = {{
    "type": "object",
    "required": ["cities"],
    "properties": {{
        "cities": {{
            "type": "array",
            "items": {{
                "type": "object",
                "required": ["city", "outlook", "advice"],
                "properties": {{
                    "city": {{"type": "string"}},
                    "outlook": {{"type": "string", "description": "五一期间天气预估"}},
                    "advice": {{"type": "string", "description": "出行建议"}},
                }},
            }},
        }},
        "overall": {{"type": "string"}},
    }},
}}

SEARCH_SCHEMA = {{
    "type": "object",
    "required": ["attractions"],
    "properties": {{
        "attractions": {{
            "type": "array",
            "items": {{
                "type": "object",
                "required": ["rank", "name", "city", "reason"],
                "properties": {{
                    "rank": {{"type": "integer"}},
                    "name": {{"type": "string"}},
                    "city": {{"type": "string"}},
                    "reason": {{"type": "string"}},
                }},
            }},
        }},
    }},
}}

FINAL_SCHEMA = {{
    "type": "object",
    "required": ["recommendation"],
    "properties": {{
        "recommendation": {{"type": "string", "description": "完整旅行推荐（Markdown）"}},
    }},
}}


async def run(ctx):
    phase, log, worker, askUser, parallel = ctx.primitives
    question = (ctx.input.get("question") or "我五一去哪玩").strip()

    # A：接需求 → 意图拆分 → 设定目标
    await phase("意图拆分与目标设定")
    await log(f"消费者说：{{question}}")
    plan = await worker(
        "你是旅行规划协调者A。消费者的原始提问：「" + question + "」。\\n"
        "请完成意图拆分与目标设定：\\n"
        "1. plan_summary：一句话概括消费者意图；\\n"
        "2. goals：恰好两个子目标——\\n"
        "   · assigned_to 填 \\"B\\"：五一期间热门目的地天气可行性评估（覆盖 3-5 个适合五一出行的城市）；\\n"
        "   · assigned_to 填 \\"C\\"：调研当前最受欢迎的 10 个国内景点（含城市与推荐理由）；\\n"
        "3. 每个 goal 的 instruction 写成可直接执行的完整指令原话（给下游执行者）。",
        schema=PLAN_SCHEMA, waker="{aid_a}", label="intent_split")

    # 分派：B 查天气 ∥ C 搜景点（并行）
    await phase("并行调研")
    b_task = next((g["instruction"] for g in plan.get("goals", [])
                   if g.get("assigned_to", "").upper() == "B"),
                  "查询五一期间 3-5 个热门城市的天气并给出出行建议。")
    c_task = next((g["instruction"] for g in plan.get("goals", [])
                   if g.get("assigned_to", "").upper() == "C"),
                  "调研当前最受欢迎的 10 个国内景点。")
    await log("A 已分派：B 做若干天气查询，C 做热门景点网络调研")
    results = await parallel([
        lambda: worker(
            "你是天气查询专员B。执行协调者A下达的任务：" + b_task + "\\n"
            "基于公开气候常识给出五一假期（5月1日-5日）各城市天气预估与出行建议，"
            "覆盖 3-5 个适合五一出行的城市，全部简体中文。",
            schema=WEATHER_SCHEMA, waker="{aid_b}", label="weather_b"),
        lambda: worker(
            "你是景点调研专员C。执行协调者A下达的任务：" + c_task + "\\n"
            "基于公开信息给出当前最受欢迎的 10 个国内景点（排名、所在城市、推荐理由），全部简体中文。",
            schema=SEARCH_SCHEMA, waker="{aid_c}", label="attractions_c"),
    ])
    weather = results[0]
    attractions = results[1] if len(results) > 1 else None
    if weather is None:
        await log("B 天气调研失败，汇总将标注数据缺失")
    if attractions is None:
        await log("C 景点调研失败，汇总将标注数据缺失")

    # 汇报给 A → A 给出完整推荐
    await phase("汇总推荐")
    final = await worker(
        "你是旅行规划协调者A。两位专员的调研结果已回报，请整合为一份完整的五一出行推荐（Markdown）。\\n"
        "== A 的意图拆分 ==\\n" + json.dumps(plan, ensure_ascii=False) +
        "\\n== B 天气回报 ==\\n" + (json.dumps(weather, ensure_ascii=False) if weather else "（B 失败，无数据）") +
        "\\n== C 景点回报 ==\\n" + (json.dumps(attractions, ensure_ascii=False) if attractions else "（C 失败，无数据）") +
        "\\n要求：\\n"
        "1. 结合天气与景点热度给出「首选推荐 / 备选推荐」，说明理由；\\n"
        "2. 天气为常识预估时明确注明局限；\\n"
        "3. 附行前准备清单；\\n"
        "4. 全部简体中文，recommendation 字段输出完整 Markdown 正文。",
        schema=FINAL_SCHEMA, waker="{aid_a}", label="final_recommend")
    await log("A 已产出完整推荐")
    return final

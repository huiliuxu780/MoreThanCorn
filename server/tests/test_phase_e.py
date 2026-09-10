"""R-Archive：Phase E 复制/归档/灰度封存后的契约（SDD 10 ADR-R09）。

原"复制/归档开关/灰度部署与停止/子 Run trace 树/首 token"行为封存于 tag
archive/legacy-agents-20260828（运行期拒绝与只读渲染分别由
test_legacy_agent_archive.py 与 test_phase_d1.py 承接）；本文件保留：
写路径 410、灰度落桶纯函数语义、草稿 definition 只读预览、#mention 展开纯函数。
"""
import uuid

from fastapi.testclient import TestClient

from app.agent_runtime import _canary_bucket
from app.main import app
from tests._legacy_agents import seed_agent, seed_release, seed_version

client = TestClient(app)

# wf_test 持久库：用例名带随机尾，避免跨运行撞名
T = uuid.uuid4().hex[:4]


def test_duplicate_agent_blocked():
    a = seed_agent(name=f"E2复制源{T}")
    r = client.post(f"/api/agents/{a['id']}/duplicate")
    assert r.status_code == 410, r.text


def test_archive_toggle_blocked():
    """归档/取消归档都是写操作；封存态只能经数据封存工具设置。"""
    a = seed_agent(name="E2归档")
    assert client.put(f"/api/agents/{a['id']}", json={"archived": True}).status_code == 410
    assert client.put(f"/api/agents/{a['id']}", json={"archived": False}).status_code == 410


def test_canary_bucket_pure_semantics_preserved():
    """落桶函数：确定性 + 范围 + 0/100 边界语义（纯函数，不受封存影响）。"""
    assert all(0 <= _canary_bucket(f"id-{i}") <= 99 for i in range(200))
    assert _canary_bucket("固定id") == _canary_bucket("固定id")
    assert all(_canary_bucket(f"id-{i}") < 100 for i in range(200))   # 100% 必命中灰度
    assert not any(_canary_bucket(f"id-{i}") < 0 for i in range(200))  # 0% 永不命中


def test_canary_release_writes_blocked():
    a = seed_agent(name=f"E2灰度{T}")
    v = seed_version(a["id"])
    seed_release(a["id"], v["id"], environment="prod", canary_percent=50)
    assert client.post(f"/api/agents/{a['id']}/releases",
                       json={"versionId": v["id"], "environment": "prod",
                             "canaryPercent": 101}).status_code == 410
    rels = client.get(f"/api/agents/{a['id']}/releases").json()
    canary_id = next(r["releaseId"] for r in rels if r["canaryPercent"] == 50)
    assert client.post(f"/api/agents/{a['id']}/releases/{canary_id}/stop-canary").status_code == 410


def test_draft_definition_preview_preserved():
    """E-2.2 草稿 definition 预览端点只读保留（供历史对比）。"""
    a = seed_agent(name=f"E2对比{T}", config={"rolePrompt": "草稿提示词"})
    d = client.get(f"/api/agents/{a['id']}/definition-draft").json()
    assert d["definition"]["rolePrompt"] == "草稿提示词"


def test_prompt_mention_expansion_retired():
    """P0-07 退役不变量（原 E-4.2）：#tool: mention 展开属旧自建 ReAct 引擎的
    prompt 组装；引擎退役后该函数删除，prompt 编译唯一路径 =
    agent_execution.compile_system_prompt（AgentScope AgentRecord）。
    产品如需 mention 展开，应作为 PromptBundle 编译步骤重新立项（已登记报告
    "尚存差异"，不得在旧位置复活）。"""
    from app import agent_runtime

    assert not hasattr(agent_runtime, "_expand_mentions")
    from app.agent_execution import compile_system_prompt

    compiled, digest, _ = compile_system_prompt(
        {"rolePrompt": "你可以使用 #tool:某工具 完成任务"})
    # 编译路径是确定性纯函数：不再隐式改写 prompt 文本
    assert "#tool:某工具" in compiled and digest

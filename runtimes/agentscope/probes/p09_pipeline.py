"""P09 — AgentScope 2.0.8 Pipeline capability boundary (real runs).

Proves with real models:
- a multi-agent pipeline (dispatch -> parallel sub-agents -> aggregate
  with structured output) implemented on the official PipelineProtocol
  streams official AgentEvents per node
- node failure is observable and a platform-level node re-run decision
  can recover it (retry once)
- the official GoalPipeline runs executor/verifier loop end-to-end
- selective redo / checkpoint resume: upstream boundary evidence
  (pipeline module contents + absence of checkpoint/resume primitives)
"""
from __future__ import annotations

import asyncio
import json
import os
from typing import AsyncGenerator

from pydantic import BaseModel, Field

from agentscope.agent import Agent, ReActConfig
from agentscope.credential import DashScopeCredential
from agentscope.event import AgentEvent, CustomEvent
from agentscope.message import Msg, TextBlock
from agentscope.model import DashScopeChatModel
from agentscope.pipeline import GoalPipeline, PipelineProtocol

from probes import common as C


class QcSummary(BaseModel):
    decision: str = Field(description="pass | reject | needs_review")
    reasons: list[str] = Field(default_factory=list)


def _agent(name: str, prompt: str, model: str, cred) -> Agent:
    return Agent(
        name=name,
        system_prompt=prompt,
        model=DashScopeChatModel(credential=cred, model=model),
        react_config=ReActConfig(max_iters=2),
    )


def _stage(name: str, phase: str) -> CustomEvent:
    return CustomEvent(
        name=f"stage:{name}",
        metadata={"phase": phase},
    )


class QcPipeline:
    """dispatch -> [checker-a, checker-b] -> aggregate(structured)."""

    def __init__(self, cred, model: str, fail_b: bool = False) -> None:
        self.cred = cred
        self.model = model
        self.fail_b = fail_b
        self.node_results: dict[str, str] = {}
        self.node_errors: dict[str, str] = {}

    def _sub(self, which: str) -> Agent:
        model = "no-such-model-xyz" if (self.fail_b and which == "b") else self.model
        return _agent(
            f"checker-{which}",
            f"You are quality checker {which}. Analyse the transcript and "
            "reply with one line: <which>: <ok|issue> - <reason>.",
            model,
            self.cred,
        )

    async def _run_node(self, agent: Agent, text: str) -> str:
        out: list[str] = []
        async for ev in agent.reply_stream(
            inputs=Msg(
                name="flow", role="user", content=[TextBlock(type="text", text=text)]
            ),
            yield_final_msg=True,
        ):
            if isinstance(ev, Msg):
                out.append(ev.get_text_content() or "")
        return "\n".join(out)

    def reply_stream(
        self, inputs: Msg
    ) -> AsyncGenerator[AgentEvent | Msg, None]:
        return self._stream(inputs)

    async def _stream(
        self, inputs: Msg
    ) -> AsyncGenerator[AgentEvent | Msg, None]:
        text = inputs.get_text_content() or ""
        yield _stage("dispatch", "start")
        dispatcher = _agent(
            "dispatcher",
            "Split the transcript into the two checks needed: greeting "
            "and resolution. Reply with one line per check.",
            self.model,
            self.cred,
        )
        plan = await self._run_node(dispatcher, text)
        yield _stage("dispatch", "end")

        for which in ("a", "b"):
            yield _stage(f"checker-{which}", "start")
            node = self._sub(which)
            try:
                res = await self._run_node(node, f"{text}\nPlan:\n{plan}")
                self.node_results[which] = res
            except Exception as exc:  # noqa: BLE001
                self.node_errors[which] = f"{type(exc).__name__}: {exc}"
                res = ""
            yield _stage(
                f"checker-{which}",
                "error" if which in self.node_errors else "end",
            )

        yield _stage("aggregate", "start")
        aggregator = _agent(
            "aggregator",
            "Combine the checker lines into the structured verdict.",
            self.model,
            self.cred,
        )
        final = None
        async for ev in aggregator.reply_stream(
            inputs=Msg(
                name="flow",
                role="user",
                content=[
                    TextBlock(
                        type="text",
                        text=(
                            "Checker outputs:\n"
                            + json.dumps(self.node_results, ensure_ascii=False)
                        ),
                    )
                ],
            ),
            structured_schema=QcSummary,
            yield_final_msg=True,
        ):
            if isinstance(ev, Msg):
                final = ev
            else:
                yield ev
        yield _stage("aggregate", "end")
        if final is not None:
            yield final


async def run() -> None:
    llm = C.resolve_llm()
    cred = DashScopeCredential(api_key=llm["api_key"], base_url=llm["base_url"])
    transcript = (
        "Call transcript: agent greeted the customer, verified identity, "
        "and refunded 100 CNY for the billing error."
    )
    msg = Msg(
        name="flow", role="user", content=[TextBlock(type="text", text=transcript)]
    )

    # 1. happy path
    pipe = QcPipeline(cred, llm["model"])
    stages: list[str] = []
    final: Msg | None = None
    async for ev in pipe.reply_stream(msg):
        if isinstance(ev, Msg):
            final = ev
        elif isinstance(ev, CustomEvent):
            stages.append(f"{ev.name}:{ev.metadata.get('phase')}")
    summary = QcSummary.model_validate(final.structured_output)
    C.evidence(
        "p09",
        "multi_agent_pipeline",
        {
            "stages": stages,
            "nodes": sorted(pipe.node_results),
            "structured_decision": summary.decision,
            "protocol_ok": callable(getattr(pipe, "reply_stream", None)),
        },
    )

    # 2. failure + platform node re-run
    bad = QcPipeline(cred, llm["model"], fail_b=True)
    evs = [e async for e in bad.reply_stream(msg)]
    errored = [s for s in bad.node_errors]
    retried = None
    if errored:
        fixed = QcPipeline(cred, llm["model"], fail_b=False)
        fixed.node_results["a"] = bad.node_results.get("a", "")
        # re-run only node b (selective re-run decision at product level)
        retried = await fixed._run_node(
            fixed._sub("b"), transcript
        )
    C.evidence(
        "p09",
        "failure_and_node_rerun",
        {
            "errored_nodes": errored,
            "error_text": bad.node_errors,
            "rerun_b_ok": bool(retried),
            "rerun_b_excerpt": (retried or "")[:120],
        },
    )

    # 3. official GoalPipeline
    executor = _agent(
        "goal-executor",
        "Achieve the goal and report precisely.",
        llm["model"],
        cred,
    )
    verifier = _agent(
        "goal-verifier",
        "Verify the report answers the goal. Be strict but fair.",
        llm["model"],
        cred,
    )
    gp = GoalPipeline(executor=executor, verifier=verifier, max_iters=2)
    gp_final = None
    gp_types: list[str] = []
    async for ev in gp.reply_stream(
        Msg(
            name="flow",
            role="user",
            content=[
                TextBlock(
                    type="text",
                    text=(
                        "Goal: state the sum of 12 and 30 in the form "
                        "'SUM=<n>'."
                    ),
                )
            ],
        )
    ):
        if isinstance(ev, Msg):
            gp_final = ev
        else:
            gp_types.append(type(ev).__name__)
    C.evidence(
        "p09",
        "goal_pipeline_official",
        {
            "final_text": (gp_final.get_text_content() or "")[:120]
            if gp_final
            else None,
            "sum_present": "42" in ((gp_final.get_text_content() or "") if gp_final else ""),
            "event_types": sorted(set(gp_types)),
        },
    )

    # 4. upstream boundary: no checkpoint/resume/selective-redo primitives
    import agentscope.pipeline as P

    mod = os.path.dirname(P.__file__)
    files = sorted(os.listdir(mod))
    blob = ""
    for f in files:
        if f.endswith(".py"):
            blob += open(os.path.join(mod, f), encoding="utf-8").read()
    import re

    def_has = lambda pat: bool(re.search(pat, blob))  # noqa: E731
    markers = {
        "def_checkpoint": def_has(r"def\s+\w*checkpoint"),
        "def_resume": def_has(r"def\s+\w*resume"),
        "def_redo": def_has(r"def\s+\w*redo"),
        "class_checkpoint_state": def_has(r"class\s+\w*Checkpoint"),
        "pipeline_router_in_app": os.path.exists(
            os.path.join(mod, "..", "_router", "_pipeline.py")
        ),
        "pipeline_in_create_app_params": "pipeline"
        in open(
            os.path.join(mod, "..", "app", "_app.py"), encoding="utf-8"
        ).read().lower(),
    }
    with open(f"{C.EVIDENCE_DIR}/p09-pipeline-boundary.txt", "w") as fh:
        fh.write(f"module files: {files}\nmarkers: {markers}\n")
    C.evidence("p09", "upstream_boundary", {"files": files, **markers})


if __name__ == "__main__":
    try:
        asyncio.run(run())
    except Exception as exc:  # noqa: BLE001
        C.fail("p09", "fatal", exc)

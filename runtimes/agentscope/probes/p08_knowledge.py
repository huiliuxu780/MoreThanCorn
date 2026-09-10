"""P08 — Knowledge base + RAG middleware with the real embedding model.

Proves: create a KB through the official router (embedding model from the
credential store), upload a document, wait for real indexing, attach the
KB to a session via SessionKnowledgeConfig, and observe the agent
retrieving the uploaded fact during a real chat turn. Also exercises the
official /search endpoint directly.
"""
from __future__ import annotations

import threading
import time

from probes import common as C
from probes.p01_session_chat import _assistant_text

DOC = (
    "Internal policy P-77: the maximum refund amount for a standard "
    "billing dispute is 480 CNY. Refunds above that require manager "
    "approval code MGR-REFUND-9."
)


def main() -> None:
    llm = C.resolve_llm()
    with C.client() as c:
        cid = c.post(
            "/credential/",
            json={
                "data": {
                    "type": "dashscope_credential",
                    "api_key": llm["api_key"],
                    "base_url": llm["base_url"],
                }
            },
        ).json()["credential_id"]
        r = c.post(
            "/knowledge_bases/",
            json={
                "name": "probe-kb",
                "description": "probe policy docs",
                "embedding_model_config": {
                    "type": "dashscope_credential",
                    "credential_id": cid,
                    "model": "text-embedding-v3",
                    "dimensions": 1024,
                    "parameters": {},
                },
            },
        )
        C.evidence("p08", "kb_create", {"status": r.status_code})
        r.raise_for_status()
        kb_id = r.json().get("knowledge_base_id") or r.json().get("id")

        data = DOC.encode()
        r = c.post(
            f"/knowledge_bases/{kb_id}/documents",
            files=[("file", ("policy.txt", data, "text/plain"))],
        )
        C.evidence("p08", "doc_upload", {"status": r.status_code})
        r.raise_for_status()
        doc_id = r.json()["document_id"]

        def indexed():
            st = c.get(
                f"/knowledge_bases/{kb_id}/documents/status",
                params={"ids": doc_id},
            ).json()
            rows = st if isinstance(st, list) else st.get("items", [])
            states = [str(x.get("status", "")).lower() for x in rows]
            if any(s == "error" for s in states):
                raise RuntimeError(f"indexing failed: {rows}")
            return rows if rows and all(s == "ready" for s in states) else None

        rows = C.wait_until(indexed, timeout=180, interval=3)
        C.evidence("p08", "indexing", {"documents": rows})

        r = c.post(
            f"/knowledge_bases/{kb_id}/search",
            json={"query": "maximum refund amount billing dispute", "limit": 3},
        )
        r.raise_for_status()
        hits = r.json()
        C.evidence(
            "p08",
            "direct_search",
            {
                "hit_count": len(
                    hits if isinstance(hits, list) else hits.get("results", [])
                ),
                "top_excerpt": str(hits)[:200],
            },
        )

        aid = c.post(
            "/agent/",
            json={
                "name": "probe-p08",
                "system_prompt": (
                    "Answer policy questions using the knowledge base. "
                    "Quote the exact figures."
                ),
            },
        ).json()["agent_id"]
        sid = c.post(
            "/sessions/",
            json={
                "agent_id": aid,
                "chat_model_config": {
                    "type": "dashscope",
                    "credential_id": cid,
                    "model": llm["model"],
                    "parameters": {},
                },
                "knowledge_config": {
                    "knowledge_base_ids": [kb_id],
                    "parameters": {},
                },
            },
        ).json()["session_id"]

        events: list[dict] = []
        t = threading.Thread(
            target=lambda: events.extend(C.sse_events(sid, aid, timeout=150)),
            daemon=True,
        )
        t.start()
        c.post(
            "/chat/",
            json={
                "agent_id": aid,
                "session_id": sid,
                "input": {
                    "role": "user",
                    "name": "probe",
                    "content": [
                        {
                            "type": "text",
                            "text": (
                                "What is the maximum refund for a standard "
                                "billing dispute, and which approval code "
                                "is needed above it?"
                            ),
                        }
                    ],
                },
            },
        ).raise_for_status()
        C.wait_until(
            lambda: any(e.get("type") == "REPLY_END" for e in events),
            timeout=150,
        )
        text = _assistant_text(
            c.get(
                f"/sessions/{sid}/messages", params={"agent_id": aid}
            ).json()
        )
        C.evidence(
            "p08",
            "rag_effect",
            {
                "reply_excerpt": text[-200:],
                "fact_retrieved_ok": "480" in text
                and "MGR-REFUND-9" in text,
                "retrieval_events": sorted(
                    {
                        e["type"]
                        for e in events
                        if "TOOL" in (e.get("type") or "")
                        or "RETRIEV" in (e.get("type") or "").upper()
                    }
                ),
            },
        )


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001
        C.fail("p08", "fatal", exc)

"""In-memory VectorStoreBase implementation for probes.

The official extension point for pluggable vector backends. Used by the
probe host so KnowledgeBase/RAGMiddleware can be verified end-to-end
without standing up an external vector database; the production backend
choice (qdrant/milvuslite) is a deployment decision recorded separately.
"""
from __future__ import annotations

import math
from typing import Any

from agentscope.rag import (
    DocumentSummary,
    VectorRecord,
    VectorSearchResult,
    VectorStoreBase,
)


class InMemoryVectorStore(VectorStoreBase):
    def __init__(self) -> None:
        self._cols: dict[str, dict[str, Any]] = {}

    async def create_collection(self, name: str, dimensions: int) -> None:
        self._cols.setdefault(name, {"dims": dimensions, "rows": []})

    async def delete_collection(self, name: str) -> None:
        self._cols.pop(name, None)

    async def has_collection(self, name: str) -> bool:
        return name in self._cols

    async def insert(
        self, collection: str, records: list[VectorRecord]
    ) -> None:
        col = self._cols[collection]
        col["rows"].extend(records)

    async def delete(self, collection: str, document_id: str) -> None:
        col = self._cols.get(collection)
        if col:
            col["rows"] = [
                r for r in col["rows"] if r.document_id != document_id
            ]

    async def search(
        self,
        collection: str,
        query_vector: list[float],
        top_k: int = 5,
        metadata_filter: dict[str, Any] | None = None,
    ) -> list[VectorSearchResult]:
        col = self._cols.get(collection)
        if not col:
            return []
        scored = []
        for rec in col["rows"]:
            v = rec.vector
            dot = sum(a * b for a, b in zip(v, query_vector))
            na = math.sqrt(sum(a * a for a in v)) or 1.0
            nb = math.sqrt(sum(b * b for b in query_vector)) or 1.0
            scored.append((dot / (na * nb), rec))
        scored.sort(key=lambda t: t[0], reverse=True)
        return [
            VectorSearchResult(
                score=score,
                document_id=rec.document_id,
                chunk=rec.chunk,
            )
            for score, rec in scored[:top_k]
        ]

    async def list_documents(self, collection: str) -> list[DocumentSummary]:
        col = self._cols.get(collection, {"rows": []})
        counts: dict[str, int] = {}
        for rec in col["rows"]:
            counts[rec.document_id] = counts.get(rec.document_id, 0) + 1
        return [
            DocumentSummary(
                document_id=doc_id,
                source=doc_id,
                chunk_count=n,
            )
            for doc_id, n in counts.items()
        ]

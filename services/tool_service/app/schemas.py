from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class KnowledgeSearchRequest(StrictModel):
    query: str = Field(min_length=1, max_length=2000)
    limit: int = Field(default=3, ge=1, le=10)


class CaseQueryRequest(StrictModel):
    case_id: str = Field(min_length=1, max_length=128)


class GenericToolCall(StrictModel):
    arguments: dict[str, Any]


class ToolEnvelope(StrictModel):
    tool: str
    version: str
    fixture_dataset: str
    output: dict[str, Any]

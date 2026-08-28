from quality_runtime_evaluation.evaluate_results import _evidence_present, evaluate_run


def test_evaluate_run_checks_findings_tools_and_duplicates() -> None:
    truth = {
        "expected_findings": {
            "abusive_language": "passed",
            "knowledge_accuracy": "failed",
            "promise_fulfillment": "not_applicable",
        },
        "required_tools": ["knowledge_search"],
        "forbidden_tools": ["ticket_query", "sms_query", "appointment_query"],
        "expected_issue_codes": ["KNOWLEDGE_ERROR"],
        "expected_evidence_refs": ["KB-1"],
    }
    run = {
        "status": "succeeded",
        "output": {
            "findings": [
                {"criterion": "abusive_language", "status": "passed", "evidence": []},
                {
                    "criterion": "knowledge_accuracy",
                    "status": "failed",
                    "evidence": [{"reference": "knowledge_search:KB-1"}],
                },
                {"criterion": "promise_fulfillment", "status": "not_applicable", "evidence": []},
            ],
            "labels": {"issue_codes": ["KNOWLEDGE_ERROR"]},
        },
        "trace": [
            {
                "type": "ToolCallStartEvent",
                "name": "mcp__quality-tools-poc-SMOKE-B01__knowledge_search",
            },
            {"type": "tool/call", "name": "mcp__quality__knowledge_search"},
        ],
        "error": None,
    }
    result = evaluate_run(run, truth)
    assert result["passed"] is True
    assert result["tool_call_counts"] == {"knowledge_search": 2}
    assert result["duplicate_tool_calls"] == ["knowledge_search"]


def test_evidence_reference_accepts_provider_formatting_but_not_prefix_collisions() -> None:
    expected = {"KB-1"}
    assert _evidence_present(expected, {"knowledge_search -> KB-1《规则》"})
    assert _evidence_present(expected, {"knowledge_search:KB-1"})
    assert not _evidence_present(expected, {"knowledge_search -> KB-10《另一规则》"})

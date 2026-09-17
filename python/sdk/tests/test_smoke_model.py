from __future__ import annotations

import json
import runpy
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[3]
SMOKE = runpy.run_path(ROOT / "scripts" / "smoke-python-runtime.py")


@pytest.mark.parametrize("prompt", [SMOKE["TEAM_CHILD_PROMPT"], SMOKE["TEAM_CHILD_CANCEL_PROMPT"]])
def test_child_team_smoke_delegates_explicit_resource_bounds(prompt: str) -> None:
    chunks = SMOKE["completion_chunks"]({
        "messages": [{"role": "user", "content": prompt}],
        "tools": [{"type": "function", "function": {"name": "team_task_delegate"}}],
    })
    calls = [call for chunk in chunks for choice in chunk.get("choices", [])
             for call in choice.get("delta", {}).get("tool_calls", [])]
    arguments = json.loads(calls[0]["function"]["arguments"])
    assert arguments["budget"] == {"maxChildTeams": 0, "maxLiveActivations": 1}


def test_child_team_smoke_preserves_the_exact_final_channel_id() -> None:
    chunks = SMOKE["completion_chunks"]({
        "messages": [
            {"role": "system", "content": "call team_final with channel_id channel-smoke and text"},
            {"role": "user", "content": "Complete the delegated child objective."},
        ],
        "tools": [{"type": "function", "function": {"name": "team_final"}}],
    })
    calls = [call for chunk in chunks for choice in chunk.get("choices", [])
             for call in choice.get("delta", {}).get("tool_calls", [])]
    assert json.loads(calls[0]["function"]["arguments"])["channel_id"] == "channel-smoke"


@pytest.mark.parametrize(
    ("prompt_name", "expected"),
    [
        ("SNAPSHOT_WORKFLOW_CHILD_PROMPT", "WORKFLOW_CHILD_OK"),
    ],
)
def test_child_prompt_precedes_runtime_context(prompt_name: str, expected: str) -> None:
    chunks = SMOKE["completion_chunks"]({
        "messages": [
            {"role": "user", "content": SMOKE[prompt_name]},
            {"role": "user", "content": "Current runtime context"},
        ],
    })

    assert any(
        choice.get("delta", {}).get("content") == expected
        for chunk in chunks
        for choice in chunk.get("choices", [])
    )


def test_direct_child_requests_cancellation_before_resumed_result() -> None:
    chunks = SMOKE["completion_chunks"]({
        "messages": [
            {"role": "user", "content": SMOKE["SNAPSHOT_DIRECT_CHILD_PROMPT"]},
            {"role": "user", "content": "Current runtime context"},
        ],
        "tools": [{"type": "function", "function": {"name": "snapshot_resume_pending"}}],
    })
    calls = [
        call
        for chunk in chunks
        for choice in chunk.get("choices", [])
        for call in choice.get("delta", {}).get("tool_calls", [])
    ]
    assert calls[0]["function"]["name"] == "snapshot_resume_pending"


def test_mcp_smoke_requests_the_discovered_tool() -> None:
    chunks = SMOKE["completion_chunks"]({
        "messages": [{"role": "user", "content": SMOKE["MCP_PROMPT"]}],
        "tools": [{"type": "function", "function": {"name": "mcp__fixture__add"}}],
    })

    calls = [
        call
        for chunk in chunks
        for choice in chunk.get("choices", [])
        for call in choice.get("delta", {}).get("tool_calls", [])
    ]
    assert calls[0]["function"] == {
        "name": "mcp__fixture__add",
        "arguments": '{"a": 19, "b": 23}',
    }


def test_mcp_smoke_accepts_the_external_server_result() -> None:
    chunks = SMOKE["completion_chunks"]({
        "messages": [
            {"role": "user", "content": SMOKE["MCP_PROMPT"]},
            {
                "role": "assistant",
                "tool_calls": [{
                    "id": "mcp-add",
                    "type": "function",
                    "function": {"name": "mcp__fixture__add", "arguments": '{}'},
                }],
            },
            {"role": "tool", "tool_call_id": "mcp-add", "content": "42"},
        ],
    })

    assert any(
        choice.get("delta", {}).get("content") == SMOKE["MCP_TEXT"]
        for chunk in chunks
        for choice in chunk.get("choices", [])
    )

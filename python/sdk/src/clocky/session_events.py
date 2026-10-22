"""Session vocabulary understood by this SDK; parity with the Core generated set is verified in the owning tests."""

KNOWN_SESSION_EVENT_TYPES = frozenset({
    "agent-preset/selected", "agent-runtime-acp/prompt-completed", "agent/inbox/spliced", "approval/asked", "approval/decided",
    "approval/policy", "assistant/chunk", "assistant/message", "command/done", "command/run", "compaction/assessment", "compaction/end",
    "compaction/prune", "compaction/request", "compaction/start", "compaction/summary", "feedback/record", "goal/change",
    "hook/invoked", "hook/result", "llm/retry", "llm/retry-started", "permission/preset", "plan/mode", "request/context",
    "request/header", "sandbox/mode", "schedule/change", "session/end-seed", "session/title", "session/title-llm-request",
    "simulation/context-view", "simulation/generation-input", "simulation/generation-output", "step/end", "step/start", "subagent/descriptor", "team/channel-view", "todo/write",
    "tool-workflow/agent-end", "tool-workflow/agent-start", "tool-workflow/run-end", "tool-workflow/run-start", "tool/call",
    "tool/code-dispatch", "tool/code-dispatch-start", "tool/result", "turn/end", "turn/start", "user/message",
})

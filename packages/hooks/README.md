# hooks/ — hook bridges + shared protocol

English | [中文](README.zh.md)

The hooks subsystem contains the shared protocol library for bridge implementations. The canonical extension surface itself is the harness's typed interception points ([the interception extension-points Agent Note](../../.agents/notes/implemented/feature/2026-06-30-interception-extension-points.md)); a "native hook" is just an ordinary Cordis plugin on those extension points.

| Package | Role | Shape |
|---|---|---|
| [`hook-protocol/`](hook-protocol/README.md) | Shared shell-hook protocol library | library |

The shared library owns protocol-neutral parsing, matching, execution, and durable event helpers; a bridge implementation owns its dialect-specific event mapping.

#!/usr/bin/env python3
"""Run one minimal-agent turn through the bundled Python SDK runtime."""

from __future__ import annotations

import argparse
import os
from pathlib import Path

from clocky import Clocky


CONFIG = Path(__file__).with_name("minimal.cordis.yml")


def main() -> None:
    """Parse one task and print the agent's final response."""
    parser = argparse.ArgumentParser()
    parser.add_argument("prompt", help="Task for the minimal agent")
    parser.add_argument("--workspace", type=Path, default=Path.cwd())
    parser.add_argument("--session-root", type=Path, default=Path(".clocky-sessions"))
    parser.add_argument("--session-id")
    parser.add_argument("--provider", default=os.environ.get("CLOCKY_PROVIDER"))
    parser.add_argument("--model", default=os.environ.get("CLOCKY_MODEL"))
    parser.add_argument("--max-tokens", type=int)
    args = parser.parse_args()
    if args.provider is None or args.model is None:
        parser.error("--provider and --model are required (or set CLOCKY_PROVIDER and CLOCKY_MODEL)")

    workspace = args.workspace.resolve()
    session_root = args.session_root.resolve()
    with Clocky(
        provider=args.provider,
        model=args.model,
        max_tokens=args.max_tokens,
        cwd=str(workspace),
        session_root=str(session_root),
        cordis=str(CONFIG.resolve()),
    ) as harness:
        result = harness.run(args.prompt, session_id=args.session_id)
    print(result.final_response)


if __name__ == "__main__":
    main()

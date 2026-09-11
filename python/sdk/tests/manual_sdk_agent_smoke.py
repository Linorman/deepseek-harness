"""Drive the repo-source JSON-RPC bin through the SDK and a keyless mock SSE server.

Requires ``pnpm install`` but no build. This manual test is not collected by
pytest; run ``python tests/manual_sdk_agent_smoke.py``.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from clocky import Clocky
from clocky_runtime import bundled_default_config_path


class MockCompletionHandler(BaseHTTPRequestHandler):
    requests: list[dict[str, Any]] = []

    def do_POST(self) -> None:
        length = int(self.headers.get("content-length", "0"))
        body = json.loads(self.rfile.read(length).decode("utf-8"))
        if not isinstance(body, dict):
            raise AssertionError("model request must be a JSON object")
        self.requests.append({
            "path": self.path,
            "authorization": self.headers.get("authorization"),
            "body": body,
        })
        self.send_response(200)
        self.send_header("content-type", "text/event-stream")
        self.end_headers()
        if self._has_team_final(body):
            self._text_response("The Team final was delivered.")
        else:
            self._team_final_response(self._channel_id(body))
        self.wfile.write(b"data: [DONE]\n\n")

    def _has_team_final(self, body: dict[str, Any]) -> bool:
        messages = body.get("messages")
        if not isinstance(messages, list):
            return False
        return any(
            isinstance(message, dict)
            and isinstance(message.get("tool_calls"), list)
            and any(
                isinstance(call, dict)
                and isinstance(call.get("function"), dict)
                and call["function"].get("name") == "team_final"
                for call in message["tool_calls"]
            )
            for message in messages
        )

    def _channel_id(self, body: dict[str, Any]) -> str:
        match = re.search(
            r"call team_final with channel_id ([^\s]+) and",
            json.dumps(body),
        )
        if match is None:
            raise AssertionError("coordinator request did not carry a Team final channel")
        return match.group(1)

    def _team_final_response(self, channel_id: str) -> None:
        arguments = json.dumps({
            "channel_id": channel_id,
            "text": "SDK runtime reached the configured HTTP model endpoint.",
        })
        self._send({"choices": [{"delta": {"role": "assistant", "content": None, "reasoning_content": ""}}]})
        self._send({"choices": [{"delta": {"tool_calls": [{
            "index": 0,
            "id": "sdk-team-final",
            "type": "function",
            "function": {"name": "team_final", "arguments": arguments},
        }]}}]})
        self._send({
            "choices": [{"delta": {"content": ""}, "finish_reason": "tool_calls"}],
            "usage": {"prompt_tokens": 7, "completion_tokens": 9},
        })

    def _text_response(self, text: str) -> None:
        self._send({"choices": [{"delta": {"role": "assistant", "content": None, "reasoning_content": ""}}]})
        self._send({"choices": [{"delta": {"content": text}}]})
        self._send({
            "choices": [{"delta": {"content": ""}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 7, "completion_tokens": 9},
        })

    def _send(self, payload: dict[str, Any]) -> None:
        self.wfile.write(f"data: {json.dumps(payload)}\n\n".encode())

    def log_message(self, _format: str, *_args: object) -> None:
        return


def run_smoke(repo_root: Path, keep_sessions: bool) -> None:
    session_root = Path(tempfile.mkdtemp(prefix=".tmp-clocky-sdk-smoke-", dir=repo_root))
    runtime_entry = repo_root / "packages/examples/jsonrpc-demo/src/bin.ts"
    server = ThreadingHTTPServer(("127.0.0.1", 0), MockCompletionHandler)
    MockCompletionHandler.requests.clear()
    thread = threading.Thread(target=server.serve_forever, name="mock-openai-compatible-server", daemon=True)
    thread.start()
    base_url = f"http://127.0.0.1:{server.server_address[1]}"

    print(f"repo_root={repo_root}")
    print(f"session_root={session_root}")
    print(f"mock_base_url={base_url}")
    config_path = session_root / "cordis.yml"
    config_path.write_text(
        bundled_default_config_path().read_text().replace(
            "baseURL: http://127.0.0.1:9",
            f"baseURL: {base_url}",
        )
    )

    try:
        with Clocky(
            credential="sdk-smoke-product-credential",
            provider="test-provider",
            model="sdk-smoke-model",
            cwd=str(repo_root / "python/sdk"),
            runtime_cwd=str(repo_root),
            session_root=str(session_root),
            cordis=str(config_path),
            launch_args_override=("node", "--import", "tsx", str(runtime_entry)),
            env={
                "TEST_API_KEY": "sdk-smoke-key",
                "TEST_MODEL": "sdk-smoke-model",
            },
            request_timeout_seconds=20,
            shutdown_timeout_seconds=2,
        ) as harness:
            result = harness.run(
                "Please reply with a short confirmation and do not call tools.",
            )
        print(f"final_response={result.final_response}")
        assert "configured HTTP model endpoint" in result.final_response
        assert len(MockCompletionHandler.requests) == 2
        for request in MockCompletionHandler.requests:
            assert request["authorization"] == "Bearer sdk-smoke-key"
            assert request["body"]["model"] == "sdk-smoke-model"
        print(json.dumps(MockCompletionHandler.requests[0], ensure_ascii=False, indent=2)[:4000])

        jsonl_files = sorted(session_root.rglob("*.jsonl.zstd"))
        assert jsonl_files, f"no Zstandard JSONL sessions were written under {session_root}"
        print("session_jsonl_zstd_files:")
        for path in jsonl_files:
            print(f"  {path} bytes={path.stat().st_size}")
            assert path.read_bytes().startswith(bytes.fromhex("28b52ffd"))
    finally:
        server.shutdown()
        server.server_close()

    if keep_sessions:
        print(f"kept_session_root={session_root}")
    else:
        shutil.rmtree(session_root)
        print("removed temporary session root")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=Path(__file__).resolve().parents[3],
        help="Path to the clocky checkout.",
    )
    parser.add_argument("--keep-sessions", action="store_true")
    args = parser.parse_args()
    run_smoke(args.repo_root.resolve(), args.keep_sessions)


if __name__ == "__main__":
    main()

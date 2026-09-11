"""Both SDK clients consume this shared corpus through their stdio boundary."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

from clocky import Clocky, JsonObject, SdkProtocolError


CORPUS = json.loads(
    (
        Path(__file__).resolve().parents[3]
        / "packages/sdk/protocol/tests/fixtures/team-channel-view-cases.json"
    ).read_text()
)


@pytest.mark.parametrize("case", CORPUS, ids=[entry["name"] for entry in CORPUS])
def test_channel_view_stdio_contract(case: JsonObject, tmp_path: Path) -> None:
    runtime = tmp_path / "channel_view_runtime.py"
    runtime.write_text(
        """
import json
import os
import sys

for line in sys.stdin:
    request = json.loads(line)
    method = request.get("method")
    result = {}
    if method == "initialize":
        result = {"serverInfo": {"name": "channel-view-contract"}}
    elif method == "team/create":
        print(json.dumps({
            "jsonrpc": "2.0",
            "method": "session.event",
            "params": {
                "sessionId": "coordinator-view",
                "event": json.loads(os.environ["CHANNEL_VIEW_EVENT"]),
            },
        }), flush=True)
        result = {
            "teamId": "team-view",
            "coordinatorSessionId": "coordinator-view",
            "envelopeId": "input-view",
        }
    elif method == "team/wait-final":
        result = {
            "teamId": "team-view",
            "channelId": "channel-view",
            "envelopeId": "final-view",
            "text": "The result is durable.",
        }
    print(json.dumps({"jsonrpc": "2.0", "id": request["id"], "result": result}), flush=True)
    if method == "shutdown":
        break
""".strip()
    )

    with Clocky(
        credential="channel-view-test-credential",
        provider="test-provider",
        model="test-model",
        cwd=str(tmp_path),
        launch_args_override=(sys.executable, str(runtime)),
        env={"CHANNEL_VIEW_EVENT": json.dumps(case["event"])},
    ) as harness:
        if case["valid"]:
            result = harness.run(case["name"])
            assert result.events == [case["event"]]
        else:
            with pytest.raises(SdkProtocolError):
                harness.run(case["name"])

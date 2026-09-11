"""Run explicit human invitation consent against the authenticated Clocky SDK runtime."""
import json
import os
import time
from pathlib import Path

from clocky.client import HarnessClient, HarnessConfig

root = Path(os.environ["CLOCKY_INVITATION_CWD"])
launch = json.loads(os.environ["CLOCKY_INVITATION_LAUNCH"])
client = HarnessClient(HarnessConfig(launch_args_override=tuple(launch), cwd=str(root), request_timeout_seconds=20))
try:
    client.initialize(credential="explicit-python-invitation", cwd=str(root),
                      provider="sdk-subagent-team-snapshot", model="sdk-subagent-team-snapshot")
    created = client.create_team("Explicit Python invitation", [{"type": "text", "text": "Keep this Team open."}])
    deadline = time.monotonic() + 10
    while True:
        state = client.get_team(created.teamId).state
        if state.get("usage", {}).get("outputTokens", 0) > 0 and all(
            item["activation"]["status"] == "idle" for item in state["activations"]
        ):
            break
        assert time.monotonic() < deadline, "Initial coordinator turn did not settle"
        time.sleep(0.02)
    human = next(p for p in state["participants"] if p["role"] == "human")
    coordinator = next(p for p in state["participants"] if p["role"] == "coordinator")
    channel = client.open_team_channel({"teamId": created.teamId, "expectedCursor": state["team"]["cursor"],
        "adapter": {"type": "direct", "version": 4}, "viewPolicy": {"type": "directed", "version": 1},
        "participants": [{"id": human["id"], "role": "owner"}, {"id": coordinator["id"], "role": "member"}], "limits": {}}).value
    channel_id = channel["manifest"]["id"]
    own = client.get_team_channel_invitation(channel_id).value
    assert own["channel"]["phase"] == "pending"
    assert own["invitation"]["participantId"] == human["id"]
    assert own["invitation"]["status"] == "pending"
    invitation = own["invitation"]
    acceptance = {"channelId": channel_id, "revision": invitation["revision"],
                  "manifestFingerprint": invitation["manifestFingerprint"], "idempotencyKey": "python-explicit-acceptance"}
    accepted = client.acknowledge_team_channel_invitation(acceptance).value
    assert accepted["invitation"]["status"] == "acknowledged"
    assert client.acknowledge_team_channel_invitation(acceptance).value["invitation"] == accepted["invitation"]
    deadline = time.monotonic() + 10
    while True:
        current = client.get_team_channel_invitation(channel_id).value["channel"]
        if current["phase"] == "active":
            break
        assert time.monotonic() < deadline, "Agent endpoint did not acknowledge"
        time.sleep(0.02)
    posted = client.post_team_channel({"channelId": channel_id, "expectedCursor": current["cursor"], "audience": None,
        "kind": "message", "payload": {"content": [{"type": "text", "text": "Explicit Python invitation accepted."}]},
        "delivery": "context"}).value
    deadline = time.monotonic() + 10
    while True:
        page = client.read_team_channel(channel_id).value
        if any(r["type"] == "channel/receipt" and r["envelopeId"] == posted["id"] for r in page["records"]):
            break
        assert time.monotonic() < deadline, "Agent Session receipt did not commit"
        time.sleep(0.02)
    print(json.dumps({"query": "pending", "ack": "acknowledged", "channel": "active", "receipt": True}, sort_keys=True))
finally:
    client.close()

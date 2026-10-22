"""Compaction evidence strict parsing matches the TypeScript transcript boundary."""
import copy
import pytest
from clocky.api import validated_coordinator_event
from clocky.errors import SdkProtocolError
from clocky.models import Notification

ASSESSMENT = dict(type="compaction/assessment", seq=0, time=0, data=dict(trigger="pressure", reason="no-gain",
    generation=0, pressureTokens=100, fixedTokens=20, selectedTokens=80, retainedTokens=0, outputReserveTokens=None))
END = dict(type="compaction/end", seq=0, time=0, data=dict(compactionId="cut", turn=None, error="no gain",
    noGain=dict(fingerprint="a"*64, contextFingerprint="b"*64, prefixFingerprint="c"*64,
                generation=0, selectedNodes=1, selectedTokens=80, summaryTokens=80)))

@pytest.mark.parametrize("event", [ASSESSMENT, END])
def test_valid_evidence_remains_in_typed_transcript(event):
    assert validated_coordinator_event(Notification("session.event", {"event": event})) == event

@pytest.mark.parametrize("mutation", [
    lambda e: e["data"].update(pressureTokens=-1), lambda e: e["data"].update(secret="extra"),
    lambda e: e.update(ignorable=True), lambda e: e.update(surfaceOp="append"),
    lambda e: e["data"].update(pressureTokens=True),
])
def test_invalid_assessment_refuses(mutation):
    event = copy.deepcopy(ASSESSMENT); mutation(event)
    with pytest.raises(SdkProtocolError):
        validated_coordinator_event(Notification("session.event", {"event": event}))

@pytest.mark.parametrize("mutation", [
    lambda e: e["data"].pop("error"), lambda e: e["data"]["noGain"].update(fingerprint="bad"),
    lambda e: e["data"]["noGain"].update(summaryTokens=79), lambda e: e["data"]["noGain"].update(selectedNodes=0),
    lambda e: e["data"]["noGain"].update(secret="extra"),
])
def test_invalid_no_gain_refuses(mutation):
    event = copy.deepcopy(END); mutation(event)
    with pytest.raises(SdkProtocolError):
        validated_coordinator_event(Notification("session.event", {"event": event}))

"""Strict wire validation for replayable compaction diagnostics and no-gain evidence."""
from .errors import SdkProtocolError


def validate_compaction_evidence_event(event: dict) -> None:
    """Reject malformed typed evidence without inferring an auxiliary request's success."""
    def counter(value: object) -> bool:
        return type(value) in (int, float) and 0 <= value <= 9_007_199_254_740_991 and value % 1 == 0

    def text(value: object) -> bool:
        return isinstance(value, str) and len(value) > 0

    def digest(value: object) -> bool:
        return isinstance(value, str) and len(value) == 64 and all(char in "0123456789abcdef" for char in value)

    data = event.get("data")
    valid = set(event) == {"type", "seq", "time", "data"} and counter(event.get("seq")) and counter(event.get("time"))
    if not isinstance(data, dict):
        valid = False
    elif event["type"] == "compaction/assessment":
        counts = {"generation", "pressureTokens", "fixedTokens", "selectedTokens", "retainedTokens"}
        valid = (valid and set(data) == counts | {"trigger", "reason", "outputReserveTokens"}
                 and data.get("trigger") in ("pressure", "context-overflow")
                 and data.get("reason") in ("attempt", "no-gain", "fixed-context", "no-range")
                 and all(counter(data.get(key)) for key in counts)
                 and (data.get("outputReserveTokens") is None or counter(data.get("outputReserveTokens"))))
    else:
        evidence = data.get("noGain")
        hashes = {"fingerprint", "contextFingerprint", "prefixFingerprint"}
        counts = {"generation", "selectedNodes", "selectedTokens", "summaryTokens"}
        valid = (valid and set(data) <= {"compactionId", "sourceCommandId", "turn", "error", "noGain"}
                 and text(data.get("compactionId")) and ("sourceCommandId" not in data or text(data["sourceCommandId"]))
                 and "turn" in data and (data["turn"] is None or counter(data["turn"]))
                 and isinstance(data.get("error"), str) and isinstance(evidence, dict)
                 and set(evidence) == hashes | counts and all(digest(evidence.get(key)) for key in hashes)
                 and all(counter(evidence.get(key)) for key in counts)
                 and evidence["selectedNodes"] > 0 and evidence["summaryTokens"] >= evidence["selectedTokens"])
    if not valid:
        raise SdkProtocolError("Compaction evidence event is malformed")

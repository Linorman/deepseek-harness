"""Token recovery mirrors the strict Native quote and remains a paused command."""
import pytest
from pydantic import ValidationError
from clocky import SimulationManageInput, SimulationTokenRecoveryRequest, SimulationRequestBudgetBlock

QUOTE = dict(reservationId="tokens/10", reserved=16384, used=26990, interval="0", additionalTokens=0)

def test_original_overrun_quote_remains_paused():
    value = SimulationManageInput(runId="run", managementId="ack", phase="paused", tokenRecovery=QUOTE)
    assert value.model_dump(exclude_none=True)["tokenRecovery"] == QUOTE
    assert value.phase == "paused"

@pytest.mark.parametrize("change", [{"used": 1}, {"reserved": 0}, {"additionalTokens": -1}, {"used": 2**53}, {"interval": "00"}])
def test_rejects_invalid_quote(change):
    with pytest.raises(ValidationError):
        SimulationTokenRecoveryRequest(**(QUOTE | change))

@pytest.mark.parametrize("phase,quote", [("running", QUOTE), ("paused", None)])
def test_rejects_start_and_explicit_null(phase, quote):
    with pytest.raises(ValidationError):
        SimulationManageInput(runId="run", managementId="ack", phase=phase, tokenRecovery=quote)

def test_budget_refusal_requires_actual_excess():
    block = dict(decisionId="decision", sessionSequence=1, requestHash="a"*64,
                 estimatedInputTokens=20000, maxOutputTokens=4096, safetyMarginTokens=2048, limit=16384)
    assert SimulationRequestBudgetBlock(**block).limit == 16384
    with pytest.raises(ValidationError):
        SimulationRequestBudgetBlock(**(block | {"limit": 65536}))

"""Calendar SDK rejects unknown clock versions and preserves complete original commands."""
import pytest
from pydantic import ValidationError
from clocky.simulation_calendar import SimulationCalendarInput, SimulationCalendarSubmit


def command():
    return {"runId": "run", "request": {"commandId": "edit", "expectedRuleRevision": 1,
        "calendar": {"id": "shift", "target": {"kind": "position", "positionId": "role"}, "body": "Work",
            "startsAt": "1", "endsAt": "10", "period": "3", "maxOccurrences": 4,
            "recurrence": {"version": 1, "clock": "simulation", "shifts": ["0"], "exceptions": [], "additions": []}}}}


def test_exact_original_calendar_quote():
    source = command()
    parsed = SimulationCalendarInput.model_validate(source)
    assert parsed.model_dump(exclude_none=True) == source
    submit = SimulationCalendarSubmit.model_validate({"input": source, "revision": 5, "previewHash": "sha256:" + "a" * 64})
    assert submit.input == parsed


@pytest.mark.parametrize("change", [{"version": 2}, {"clock": "local"}, {"timezone": "UTC"}, {"shifts": ["0", "0"]}])
def test_unknown_or_ambiguous_calendar_clock_rejects(change):
    source = command()
    source["request"]["calendar"]["recurrence"].update(change)
    with pytest.raises(ValidationError):
        SimulationCalendarInput.model_validate(source)


def test_recovered_outcome_rejects_substituted_receipt():
    from clocky.simulation_calendar import SimulationCalendarCommandResult
    quote = {"input": command(), "revision": 5, "previewHash": "sha256:" + "a" * 64, "cancelled": [], "queued": []}
    value = {"preview": quote, "status": "retained", "retainedSequence": 6, "receipt": None}
    assert SimulationCalendarCommandResult.model_validate({"command": value}).command.status == 'retained'
    with pytest.raises(ValidationError):
        SimulationCalendarCommandResult.model_validate({"command": {**value, "status": "applied"}})
    receipt = {"runId": "other", "commandId": "edit", "revision": 7, "ruleRevision": 2, "sequence": 7}
    with pytest.raises(ValidationError):
        SimulationCalendarCommandResult.model_validate({"command": {**value, "status": "applied", "receipt": receipt}})


def test_civil_calendar_preserves_explicit_iana_origin_and_rejects_two_clocks():
    from clocky.simulation_calendar_base import WorldCivilCalendar
    civil = {"version": 1, "timeZone": "America/New_York", "tzdbVersion": "2026e", "disambiguation": "later",
        "origin": "2026-01-01T00:00:00Z", "tickMilliseconds": 60000, "from": "2026-11-01", "until": "2026-11-01",
        "weekdays": [7], "shifts": ["01:30:00"], "exceptDates": [], "additions": []}
    assert WorldCivilCalendar.model_validate(civil).model_dump() == civil
    source = command()
    source['request']['calendar']['civil'] = civil
    with pytest.raises(ValidationError):
        SimulationCalendarInput.model_validate(source)
    del source['request']['calendar']['recurrence']
    assert SimulationCalendarInput.model_validate(source).model_dump(exclude_none=True) == source

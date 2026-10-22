"""Private draft CAS keeps explicit null ancestry and rejects authority/executable fields."""
import json
from pathlib import Path
import pytest
from pydantic import ValidationError
from clocky.simulation_drafts import ScenarioDraftSave, ScenarioDraftSaveResponse


def original():
    root = Path(__file__).resolve().parents[3]
    definition = json.loads((root / 'packages/sdk/protocol/tests/fixtures/world-v1-definition.json').read_text())
    return {'draftId': 'draft', 'saveId': 'original', 'parentRevision': None, 'name': 'Draft', 'definition': definition}


def test_original_ancestry_and_conflict_remain_explicit():
    request = ScenarioDraftSave.model_validate(original())
    assert request.model_dump(exclude_none=True)['parentRevision'] is None
    result = ScenarioDraftSaveResponse.model_validate({'status': 'conflict', 'current': None, 'attempted': request.model_dump(exclude_none=True)}).root
    assert result.attempted.saveId == 'original'
    assert result.current is None


def test_drafts_reject_self_reported_authority_and_executable_input():
    value = original()
    with pytest.raises(ValidationError):
        ScenarioDraftSave.model_validate({**value, 'author': 'someone-else'})
    value['definition']['include'] = '/execute/me'
    with pytest.raises(ValidationError):
        ScenarioDraftSave.model_validate(value)


def test_names_use_the_same_normalization_as_host_cas_intents():
    assert ScenarioDraftSave.model_validate({**original(), "name": "  Draft  "}).name == "Draft"
    with pytest.raises(ValidationError):
        ScenarioDraftSave.model_validate({**original(), "name": "   "})


def test_layout_is_separate_and_rejects_duplicate_or_nonfinite_positions():
    value = original()
    layout = [{'id': 'unit', 'x': 12, 'y': -9}]
    request = ScenarioDraftSave.model_validate({**value, 'layout': layout})
    assert request.model_dump(exclude_none=True)['layout'] == layout
    assert request.model_dump()['definition'] == ScenarioDraftSave.model_validate(value).model_dump()['definition']
    for invalid in [layout * 2, [{'id': 'unit', 'x': float('inf'), 'y': 0}], [{'id': 'unit', 'x': 100001, 'y': 0}]]:
        with pytest.raises(ValidationError):
            ScenarioDraftSave.model_validate({**value, 'layout': invalid})


def test_sdk_refuses_changed_layout_in_original_save_receipt(monkeypatch):
    from clocky import HarnessClient, HarnessConfig, SdkProtocolError
    request = ScenarioDraftSave.model_validate({**original(), 'layout': [{'id': 'unit', 'x': 1, 'y': 2}]})
    client = HarnessClient(HarnessConfig())
    saved = {**request.model_dump(exclude_none=True), 'revision': 0, 'author': 'owner', 'savedAt': 1}
    monkeypatch.setattr(client, '_request_raw', lambda *_args, **_kwargs: {'status': 'saved', 'value': saved})
    assert client.save_simulation_draft(request).value.layout == request.layout
    saved['layout'] = []
    with pytest.raises(SdkProtocolError, match='another original intent'):
        client.save_simulation_draft(request)

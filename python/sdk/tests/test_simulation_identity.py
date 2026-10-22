"""Shared Simulation identity follows the TS JS-string owner; layered field rules retain their own scope."""
import json
import shutil
import subprocess
from typing import Annotated

import pytest
from pydantic import Field, TypeAdapter, ValidationError, field_validator
from clocky.simulation_base import Identity, CommandSelectorId, SimulationModel


@pytest.mark.parametrize("value", ["x", " " , "\ufeff", "a" * 100_000, "😀", "\ud800", "\udfff",
                                    "\ud83d\ude00", "a\ud800b", "\ud800\ud83d\ude00\udfff", "e\u0301\ufeff"])
def test_identity_accepts_js_nonempty_strings_and_only_combines_valid_pairs(value):
    parsed = TypeAdapter(Identity).validate_python(value)
    assert parsed.encode("utf-16-le", "surrogatepass") == value.encode("utf-16-le", "surrogatepass")
    assert TypeAdapter(CommandSelectorId).validate_python(value) == parsed
    assert json.loads(json.dumps(parsed)) == parsed
    assert parsed != "é\ufeff" if value == "e\u0301\ufeff" else True


@pytest.mark.parametrize("value", ["", None, b"bytes", True, False, 1, 1.0, [], {}])
def test_identity_rejects_empty_and_nonstrings_even_without_a_model_config(value):
    with pytest.raises(ValidationError):
        TypeAdapter(Identity).validate_python(value)


def test_shared_identity_preserves_layered_field_and_business_validators():
    class Owned(SimulationModel):
        identity: Annotated[Identity, Field(max_length=3)]

        @field_validator("identity")
        @classmethod
        def _business(cls, value):
            if value == "bad":
                raise ValueError("Owner rejects this exact identity")
            return value

    assert Owned(identity=" x ").identity == " x "
    for value in ["", "long", "bad", b"x", True]:
        with pytest.raises(ValidationError):
            Owned(identity=value)


def test_shared_identity_model_dump_crosses_actual_node_json_without_losing_utf16(tmp_path):
    node = shutil.which("node")
    assert node is not None, "The shared identity wire owner test requires the repository Node runtime"

    class Selection(SimulationModel):
        identity: Identity

    values = ["\ud800", "\udfff", "\ud83d\ude00", "😀", "e\u0301\ufeff", " \ufeff\t"]
    originals = [Selection(identity=value) for value in values]
    payload = json.dumps([value.model_dump() for value in originals])
    script = tmp_path / "identity-codec.mjs"
    script.write_text("""let value='';process.stdin.setEncoding('utf8');process.stdin.on('data',s=>value+=s);
process.stdin.on('end',()=>process.stdout.write(JSON.stringify(JSON.parse(value))));""")
    result = subprocess.run([node, str(script)], input=payload, text=True, capture_output=True, check=True)
    returned = [Selection.model_validate(value) for value in json.loads(result.stdout)]
    assert [value.model_dump() for value in returned] == [value.model_dump() for value in originals]
    assert "\\ud800" in result.stdout and "\\udfff" in result.stdout

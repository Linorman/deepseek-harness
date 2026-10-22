"""Private immutable authoring revisions; save retries retain the original ID and payload."""
from typing import Annotated, Literal
from pydantic import Field, RootModel, StringConstraints, model_validator
from .simulation import ObservationCount
from .simulation_scenario import WorldScenarioV1, WorldV1Model, ScenarioTemplateManifest

DraftIdentity = Annotated[str, Field(min_length=1, max_length=128)]

class DraftLayoutNode(WorldV1Model):
    """Presentation coordinates have no effect on compilation or execution."""
    id: DraftIdentity
    x: Annotated[float, Field(ge=-100000, le=100000, allow_inf_nan=False)]
    y: Annotated[float, Field(ge=-100000, le=100000, allow_inf_nan=False)]

class ScenarioDraftSave(WorldV1Model):
    """CAS save; null parent creates a new draft, a numeric parent must match its head."""
    draftId: DraftIdentity
    saveId: DraftIdentity
    parentRevision: ObservationCount | None
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=256)]
    definition: WorldScenarioV1
    layout: Annotated[list[DraftLayoutNode], Field(max_length=10000)] | None = None
    templateManifest: ScenarioTemplateManifest | None = None

    @model_validator(mode="after")
    def _layout(self):
        if self.layout is not None and len({node.id for node in self.layout}) != len(self.layout):
            raise ValueError("Layout node IDs must be unique")
        return self

class ScenarioDraftRead(WorldV1Model):
    """Private lookup; omitted revision selects the current head."""
    draftId: DraftIdentity
    revision: ObservationCount | None = None

class ScenarioDraftRevision(ScenarioDraftSave):
    """Original definition and authenticated author retained by the Host."""
    revision: ObservationCount
    author: Annotated[str, Field(min_length=1)]
    savedAt: ObservationCount

    @model_validator(mode="after")
    def _ancestry(self):
        if self.revision != (0 if self.parentRevision is None else self.parentRevision + 1):
            raise ValueError("Draft revision must follow its original parent")
        return self

class ScenarioDraftReadResult(WorldV1Model):
    """Missing and unauthorized identities both return null."""
    value: ScenarioDraftRevision | None

class ScenarioDraftSaved(WorldV1Model):
    """Original successful save, including on exact retry."""
    status: Literal['saved']
    value: ScenarioDraftRevision

class ScenarioDraftConflict(WorldV1Model):
    """Both versions remain intact until an explicit subsequent save."""
    status: Literal['conflict']
    current: ScenarioDraftRevision | None
    attempted: ScenarioDraftSave

ScenarioDraftSaveResult = Annotated[ScenarioDraftSaved | ScenarioDraftConflict, Field(discriminator='status')]

class ScenarioDraftSaveResponse(RootModel[ScenarioDraftSaveResult]):
    """Strict discriminated response envelope."""

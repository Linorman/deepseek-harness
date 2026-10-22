"""Verify F0's independent scene batches without presenting them as one execution."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import sys

# Imported validators must not create bytecode outside this repository's evidence directories.
sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
ASSOCIATION = "examples/simulation-company/tests/world-longitudinal-association.ts"
RUNNER = "scripts/world-post-mvp-baseline.py"
LEGACY_SHA256 = {
    ASSOCIATION: "19868842135e01223b69d30ca1b37b9b638f41d2613136ec972ecae8f9eddfa4",
    RUNNER: "e4c6ad1178bafc75bd7e9ee63a383630ac67c4b3d37e206037389a602abe680e",
}


def module(name):
    """Load an existing validator without running its CLI or writing import caches."""
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / f"{name}.py")
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


BASELINE = module("world-post-mvp-baseline")
REPORT = module("world-post-mvp-report")


def digest(value):
    """Return the SHA256 of the original bytes, including their whitespace."""
    return hashlib.sha256(value).hexdigest()


def legacy_inputs(root):
    """Reconstruct only the two reviewed historical files, byte for byte.

    The association change adds its deployment's knowledge ceiling. The runner
    change adds company-only Team budgets; the other scenes keep the same env.
    These are content-addressed exceptions, never a path-only ignore list.
    """
    association = (root / ASSOCIATION).read_bytes().decode("utf-8")
    runner = (root / RUNNER).read_bytes().decode("utf-8")
    old_association = association.replace(",\n    maxKnowledgeBytes: 262144", "")
    old_runner = runner.replace(
        '    company_team_limits = {**team_limits, "maxActivationsPerTeam": args.rounds * 32,\n'
        '                           "maxTurnsPerTeam": args.rounds * 128}\n', "")
    old_runner = old_runner.replace('                 "companyTeamLimits": company_team_limits,\n', "")
    old_runner = old_runner.replace(
        'SIMULATION_BENCHMARK_TEAM_LIMITS=json.dumps(\n'
        '                               company_team_limits if scene == "company" else team_limits))',
        'SIMULATION_BENCHMARK_TEAM_LIMITS=json.dumps(team_limits))')
    old_runner = old_runner.replace(
        '                           SIMULATION_CONTEXT_LIMIT',
        '                               SIMULATION_CONTEXT_LIMIT')
    reconstructed = {ASSOCIATION: digest(old_association.encode()), RUNNER: digest(old_runner.encode())}
    return {name: value for name, value in reconstructed.items() if value == LEGACY_SHA256[name]}


def validate(sources, root=ROOT):
    """Read three explicit original directories and return a fail-closed collection report.

    Raw files stay untouched. Their hashes bind each selected record to the
    original manifest, process streams and drift receipt. The original batches
    may contain failed records for other scenes; those remain explicitly excluded.
    """
    root = root.resolve()
    issues, components, rows = [], [], []
    try:
        current = BASELINE.fingerprint(root)
        legacy = legacy_inputs(root)
    except (OSError, UnicodeError) as error:
        return {"kind": "independent-scene-evidence-collection", "complete": False,
                "issues": [f"Cannot inventory current inputs: {error}"], "components": [], "rows": []}
    reference = None
    for scene in BASELINE.SCENES:
        directory = Path(sources[scene]).resolve()
        component = {"scene": scene, "directory": str(directory), "rawFiles": {},
                     "selectedRecords": [], "excludedRecords": [], "inputCompatibility": []}
        components.append(component)
        if not directory.is_relative_to(root):
            issues.append(f"{scene}: evidence directory must stay inside the repository")
            continue

        def read(name, parse=True):
            path = directory / name
            if not path.resolve().is_relative_to(directory):
                issues.append(f"{scene}/{name}: evidence file escapes its original directory")
                return None
            try:
                raw = path.read_bytes()
                component["rawFiles"][name] = {"sha256": digest(raw), "bytes": len(raw)}
                return json.loads(raw) if parse else raw
            except (OSError, ValueError, UnicodeError) as error:
                issues.append(f"{scene}/{name}: missing or invalid evidence ({type(error).__name__})")
                return None

        manifest, results, drift = read("manifest.json"), read("results.json"), read("input-drift.json")
        if not isinstance(manifest, dict):
            issues.append(f"{scene}: invalid manifest")
            continue
        workload, frozen = manifest.get("workload"), manifest.get("inputs")
        component["originalWorkload"] = workload
        metadata = {key: manifest.get(key) for key in ("hardware", "node", "baseRevision")}
        component.update(metadata)
        if (not isinstance(metadata["hardware"], dict) or not metadata["hardware"]
                or any(not isinstance(metadata[key], str) or not metadata[key] for key in ("node", "baseRevision"))):
            issues.append(f"{scene}: missing hardware, node or baseRevision")
        if reference is None:
            reference = metadata
        elif metadata != reference:
            issues.append(f"{scene}: hardware, node or baseRevision differs between original batches")
        if not isinstance(frozen, dict):
            issues.append(f"{scene}: missing source inventory")
        else:
            for name in sorted(current.keys() | frozen.keys()):
                original, present = frozen.get(name), current.get(name)
                if original == present and name in current and name in frozen:
                    continue
                allowed = ((name == ASSOCIATION and scene == "laboratory")
                           or (name == RUNNER and scene in ("laboratory", "association")))
                if allowed and name in legacy and original == legacy[name] and present is not None:
                    component["inputCompatibility"].append({"path": name, "originalSha256": original,
                        "currentSha256": present, "proof": "Exact reverse reconstruction of the reviewed scene-independent change"})
                else:
                    issues.append(f"{scene}: input hash mismatch or inventory change: {name}")
        valid_workload = (isinstance(workload, dict) and type(workload.get("rounds")) is int
                          and workload["rounds"] == 32 and isinstance(workload.get("scenes"), list)
                          and all(type(value) is str and value in BASELINE.SCENES for value in workload["scenes"])
                          and len(workload["scenes"]) == len(set(workload["scenes"]))
                          and scene in workload["scenes"] and workload.get("backends") == ["json", "sqlite"]
                          and workload.get("concurrency") == 1 and workload.get("mode") == "source")
        if not valid_workload:
            issues.append(f"{scene}: original workload must declare 32 rounds, both backends and sequential source mode")
        team_limits = {"maxParticipantsPerTeam": 48, "maxActivationsPerTeam": 512, "maxTurnsPerTeam": 2048,
                       "maxPostIdempotencyEntriesPerChannel": 2048, "maxRatePerParticipantPerMinute": 2048,
                       "maxWallTimeMsPerTeam": 7200000}
        common = {"concurrency": 1, "mode": "source", "processTimeoutSeconds": 7200, "optimizationTarget": None,
                  "scheduling": "Sequential scene/backend pairs; warm process completes before its fresh cold process",
                  "modelPolicy": "scripted keyless; laboratory stages canonical Session tool decisions without inference",
                  "teamLimits": team_limits, "residentLimits": {"company": 3, "laboratory": 2, "association": 2},
                  "modelConcurrency": 2, "replayPageSize": 4, "contextBytes": 524288,
                  "laboratoryNormHistoryBytes": 262144}
        if isinstance(workload, dict):
            if any(key not in workload or workload[key] != value for key, value in common.items()):
                issues.append(f"{scene}: workload differs from the fixed execution policy")
            company_limits = {**team_limits, "maxActivationsPerTeam": 1024, "maxTurnsPerTeam": 4096}
            if ((scene == "company" or "companyTeamLimits" in workload)
                    and workload.get("companyTeamLimits") != company_limits):
                issues.append(f"{scene}: company-specific Team limits do not match the reviewed runner")
        if not isinstance(results, list):
            issues.append(f"{scene}: missing or invalid original process results")
            results = []
        selected = []
        for index, record in enumerate(results):
            if isinstance(record, dict) and record.get("scene") == scene:
                selected.append(record)
                component["selectedRecords"].append(index)
            else:
                component["excludedRecords"].append({"index": index,
                    **({key: record.get(key) for key in ("scene", "backend", "recover", "exitCode", "failure")}
                       if isinstance(record, dict) else {"invalid": True})})
        projection = {**manifest, "workload": {**(workload if isinstance(workload, dict) else {}),
                      "scenes": [scene], "backends": ["json", "sqlite"], "rounds": 32}}
        summary = REPORT.summarize(projection, selected, drift)
        issues.extend(f"{scene}: {issue}" for issue in summary["issues"])
        rows.extend(summary["rows"])
        expected_paths = {name: (root / f"packages/simulation/{package}/src/index.ts").as_uri()
                          for name, package in [("@clocky/clocky-simulation", "simulation"),
                                                ("@clocky/clocky-simulation-local", "simulation-local"),
                                                ("@clocky/clocky-simulation-world", "simulation-world")]}
        entry, fixture = BASELINE.SCENES[scene]
        command = ["node", "--import", "tsx/esm", f"examples/simulation-company/tests/{entry}",
                   f"examples/simulation-company/tests/fixtures/{fixture}/cordis.yml"]
        for backend in ("json", "sqlite"):
            for recover in (False, True):
                name = f"{scene}-{backend}/{'cold' if recover else 'warm'}"
                stdout, _stderr = read(f"{name}.stdout", False), read(f"{name}.stderr", False)
                records = [record for record in selected if record.get("backend") == backend
                           and record.get("recover") is recover]
                if len(records) != 1:
                    continue  # The report validator already rejects absent or duplicate process identities.
                record = records[0]
                if record.get("command") != command:
                    issues.append(f"{name}: command differs from the canonical scene entry")
                result = record.get("result")
                if not isinstance(result, dict):
                    continue  # Failed or malformed payloads are rejected by the shared report validator.
                if result.get("runtimePaths") != expected_paths:
                    issues.append(f"{name}: resolved runtime paths do not match current source owners")
                try:
                    actual = json.loads(stdout.splitlines()[-1]) if stdout is not None else None
                except (IndexError, ValueError, UnicodeError):
                    actual = None  # An incomplete or malformed last line cannot substantiate a result.
                if actual != result:
                    issues.append(f"{name}: original stdout last result differs from results.json")
    shared_workloads = [{key: value for key, value in component.get("originalWorkload", {}).items()
                        if key not in ("scenes", "companyTeamLimits")}
                       for component in components if isinstance(component.get("originalWorkload"), dict)]
    if len(shared_workloads) == 3 and any(value != shared_workloads[0] for value in shared_workloads[1:]):
        issues.append("Shared workload settings differ between original batches")
    return {"kind": "independent-scene-evidence-collection", "schemaVersion": 1, "complete": not issues,
            "issues": sorted(issues), "components": components, "rows": rows, "currentInputs": current,
            "validatorSha256": digest(Path(__file__).read_bytes()),
            "scope": "Three original batches, selected by scene; this collection is not one execution.",
            "limits": ["Original failures and calibration interruptions remain excluded failures in their source batches.",
                       "Laboratory cold restore validates Native governance/norm replay; other scenes restore Team checkpoints.",
                       "RSS is sampled after each round, not a continuous peak; usage is scripted, not live-provider cost."]}


def main():
    """Write a collection summary inside the project; never mutate an original batch."""
    parser = argparse.ArgumentParser(description=__doc__)
    for scene in BASELINE.SCENES:
        parser.add_argument(f"--{scene}", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    sources = {scene: getattr(args, scene).resolve() for scene in BASELINE.SCENES}
    output = args.output.resolve()
    if not output.is_relative_to(ROOT) or any(output.is_relative_to(source) for source in sources.values()):
        parser.error("output must stay inside the repository and outside every original evidence directory")
    summary = validate(sources)
    output.mkdir(parents=True, exist_ok=True)
    target = output / "summary.json"
    if not target.resolve().is_relative_to(output):
        parser.error("summary.json must not redirect writes outside the output directory")
    target.write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps({"complete": summary["complete"], "rows": len(summary["rows"]), "output": str(target)}))
    if not summary["complete"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()

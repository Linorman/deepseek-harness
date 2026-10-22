"""Measure actual full-run generated-hire maintenance and independent cold recovery, retaining raw evidence."""
import json
import os
from pathlib import Path
import time
import importlib.util

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("baseline", ROOT / "scripts/world-post-mvp-baseline.py")
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
def fingerprints():
    values = base.fingerprint(ROOT)
    for name in ["scripts/world-b1-maintenance.py", "examples/simulation-company/tests/world-hire-scenario.ts",
                 "packages/simulation/simulation-local/tests/longitudinal-metrics.ts",
                 "examples/simulation-company/tests/world-protocol-model.ts",
                 "examples/simulation-company/tests/world-domain-input.ts",
                 "examples/simulation-company/tests/world-r06-observation.ts",
                 "examples/simulation-company/tests/fixtures/world-protocol/cordis.yml"]:
        values[name] = base.hashlib.sha256((ROOT / name).read_bytes()).hexdigest()
    return values

root = ROOT / ".local/world-post-mvp/b1-maintenance" / str(time.time_ns())
root.mkdir(parents=True)
(root / "tmp").mkdir()
manifest = {"workload": "existing Loader generated-hire canonical identity preparation and atomic commit",
            "repetitions": 3, "backends": ["json", "sqlite"], "mode": "source", "modelPolicy": "scripted keyless",
            "target": {"localMutationInvestigationMinMaintenanceFraction": 0.1},
            "timingScope": "Wall clock after Loader boot, before Native open; includes preparation and domain work, excludes process startup", "hardware": base.hardware(),
            "inputs": fingerprints()}
(root / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
print(root, flush=True)
results = []
for backend in manifest["backends"]:
    for repetition in range(manifest["repetitions"]):
        directory = root / f"{backend}-{repetition}"
        directory.mkdir()
        for recover in [False, True]:
            env = dict(os.environ, TMPDIR=str(root / "tmp"), TSX_TSCONFIG_PATH=str(ROOT / "tsconfig.base.json"),
                       SIMULATION_COMPANY_ROOT=str(directory), SIMULATION_COMPANY_BACKEND=backend,
                       WORLD_RESOLUTION="apply", WORLD_HIRE_CRASH="", WORLD_HIRE_RECOVER=str(recover).lower(), WORLD_B1_METRICS="true",
                       CLOCKY_EXAMPLE_MODE="src")
            command = ["node", "--import", "tsx/esm", "examples/simulation-company/tests/world-hire-scenario.ts",
                       "examples/simulation-company/tests/fixtures/world-protocol/cordis.yml"]
            result = {"backend": backend, "repetition": repetition, "recover": recover,
                      **base.run_process(command, directory, "cold" if recover else "warm", env, timeout=300)}
            value = result.get("result", {})
            if (result["exitCode"] == 0 and (value.get("atomicCommit") is not True or value.get("identitiesPreserved") is not True
                    or value.get("modelCalls") != (0 if recover else 6) or not isinstance(value.get("metrics"), dict))):
                result["failure"] = {"kind": "invalid-maintenance-result", "reason": "Expected original atomic hire and measured zero-call recovery"}
            results.append(result)
            (root / "results.json").write_text(json.dumps(results, indent=2) + "\n")
            print(json.dumps({key: value for key, value in result.items() if key not in {"result", "command"}}), flush=True)
final = fingerprints()
drift = sorted(key for key in manifest["inputs"].keys() | final.keys() if manifest["inputs"].get(key) != final.get(key))
(root / "input-drift.json").write_text(json.dumps(drift, indent=2) + "\n")
if any(item["exitCode"] != 0 or item.get("failure") for item in results):
    raise SystemExit("One or more processes failed; original results retained")

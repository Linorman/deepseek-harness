"""Run the fixed F0 histories and fresh-process replay; keep every artifact under the repository."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import subprocess
import time

ROOT = Path(__file__).resolve().parents[1]
SCENES = {
    "company": ("world-longitudinal-company.ts", "world-longitudinal-company"),
    "laboratory": ("world-longitudinal-scenario.ts", "world-post-mvp"),
    "association": ("world-longitudinal-association.ts", "world-longitudinal-association"),
}


def source_files(root):
    """Inventory all package/vendor sources and manifests, excluding generated dependencies/artifacts."""
    files = set()
    for directory in [root / "packages", root / "vendor"]:
        for current, directories, names in os.walk(directory):
            directories[:] = [name for name in directories if name not in {"lib", "node_modules", ".git", "__pycache__"}]
            folder = Path(current)
            for name in names:
                path = folder / name
                if "src" in path.relative_to(directory).parts or name == "package.json" or name.startswith("tsconfig") and name.endswith(".json"):
                    files.add(path)
    files.update(root / name for name in [
        "pnpm-lock.yaml", "pnpm-workspace.yaml", "package.json", "tsconfig.base.json",
        "scripts/world-post-mvp-baseline.py", "scripts/world-post-mvp-report.py",
        "packages/simulation/simulation-local/tests/hiring-resource-harness.ts",
        "packages/simulation/simulation-local/tests/context-fixture.ts",
        "packages/simulation/simulation-local/tests/world-longitudinal-governance.ts",
        "packages/simulation/simulation-local/tests/longitudinal-metrics.ts",
        "packages/simulation/simulation-scenario/tests/fixtures.ts",
        "examples/simulation-company/tests/fixtures/world-v1-product/deployment.ts",
        "examples/simulation-company/cordis.yml"])
    examples = root / "examples/simulation-company"
    files.update((examples / "scenarios").rglob("*.json"))
    files.update((examples / "presets").rglob("*.yml"))
    for entry, fixture in SCENES.values():
        files.update([examples / "tests" / entry, examples / "tests/fixtures" / fixture / "cordis.yml"])
    files.update([examples / "tests/world-longitudinal-company-model.ts", examples / "tests/world-longitudinal-association-model.ts"])
    return sorted(files)


def fingerprint(root, allow_missing=False):
    """Freeze the complete inventory, including new/deleted source detection on the final rescan."""
    return {str(path.relative_to(root)): hashlib.sha256(path.read_bytes()).hexdigest() for path in source_files(root)
            if not allow_missing or path.is_file()}


def run_process(command, directory, name, env, timeout=7200):
    """Retain raw streams and a structured outcome even for timeout, launch or JSON failure."""
    started = time.perf_counter()
    record = {"command": command, "exitCode": None}
    with (directory / f"{name}.stdout").open("w") as stdout, (directory / f"{name}.stderr").open("w") as stderr:
        try:
            completed = subprocess.run(command, cwd=ROOT, env=env, stdout=stdout, stderr=stderr, timeout=timeout, check=False)
            record["exitCode"] = completed.returncode
        except subprocess.TimeoutExpired:
            record["failure"] = {"kind": "timeout", "timeoutSeconds": timeout}
        except OSError as error:
            record["failure"] = {"kind": "launch", "message": str(error)}
    record["elapsedMs"] = (time.perf_counter() - started) * 1000
    if record["exitCode"] == 0:
        try:
            lines = (directory / f"{name}.stdout").read_text().splitlines()
            value = json.loads(lines[-1]) if lines else None
            if not isinstance(value, dict):
                raise ValueError("Last stdout line must be a result object")
            record["result"] = value
        except (OSError, UnicodeError, ValueError) as error:
            record["failure"] = {"kind": "invalid-result", "message": str(error)}
    elif "failure" not in record:
        record["failure"] = {"kind": "exit", "exitCode": record["exitCode"]}
    return record


def hardware():
    """Record actual macOS CPU/memory probes; unsupported or failed probes stay explicitly unknown."""
    result = {"platform": platform.platform(), "machine": platform.machine(), "cpuCount": os.cpu_count(),
              "cpuModel": "unknown", "physicalMemoryBytes": None, "probeErrors": []}
    if platform.system() != "Darwin":
        result["probeErrors"].append("CPU model and physical memory probe unavailable on this platform")
        return result
    for field, key in [("cpuModel", "machdep.cpu.brand_string"), ("physicalMemoryBytes", "hw.memsize")]:
        try:
            raw = subprocess.check_output(["sysctl", "-n", key], text=True, stderr=subprocess.DEVNULL, timeout=5).strip()
            if not raw:
                raise ValueError("empty hardware probe")
            value = int(raw) if field == "physicalMemoryBytes" else raw
            if field == "physicalMemoryBytes" and value <= 0:
                raise ValueError("invalid physical memory size")
            result[field] = value
        except (OSError, subprocess.SubprocessError, ValueError) as error:
            result["probeErrors"].append(f"{key}: {type(error).__name__}")
    return result


def main():
    """Freeze workload inputs, preserve raw process results, and reject failed or drifting runs."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scene", choices=SCENES, action="append")
    parser.add_argument("--rounds", type=int, default=32)
    parser.add_argument("--backend", choices=["json", "sqlite"], action="append")
    args = parser.parse_args()
    if args.scene and len(args.scene) != len(set(args.scene)) or args.backend and len(args.backend) != len(set(args.backend)):
        parser.error("scenes and backends must not be repeated")
    if not 1 <= args.rounds <= 64:
        parser.error("rounds must be between 1 and 64")
    root = ROOT / ".local/world-post-mvp/f0-longitudinal" / str(time.time_ns())
    root.mkdir(parents=True)
    temporary = root / "tmp"
    temporary.mkdir()
    team_limits = {"maxParticipantsPerTeam": args.rounds + 16, "maxActivationsPerTeam": args.rounds * 16,
                   "maxTurnsPerTeam": args.rounds * 64, "maxPostIdempotencyEntriesPerChannel": args.rounds * 64,
                   "maxRatePerParticipantPerMinute": args.rounds * 64, "maxWallTimeMsPerTeam": 7200000}
    company_team_limits = {**team_limits, "maxActivationsPerTeam": args.rounds * 32,
                           "maxTurnsPerTeam": args.rounds * 128}
    fingerprints = fingerprint(ROOT)
    manifest = {"workload": {"measurementVersion": 2, "rounds": args.rounds, "scenes": args.scene or list(SCENES),
                 "backends": args.backend or ["json", "sqlite"], "concurrency": 1, "mode": "source",
                 "scheduling": "Sequential scene/backend pairs; warm process completes before its fresh cold process",
                 "modelPolicy": "scripted keyless; laboratory stages canonical Session tool decisions without inference",
                 "processTimeoutSeconds": 7200, "optimizationTarget": {"localMutationInvestigationMinMaintenanceFraction": 0.1}, "teamLimits": team_limits,
                 "companyTeamLimits": company_team_limits,
                 "residentLimits": {"company": 3, "laboratory": 2, "association": 2}, "modelConcurrency": 2, "replayPageSize": 4, "contextBytes": 524288, "laboratoryNormHistoryBytes": 262144},
                "hardware": hardware(),
                "baseRevision": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
                "node": subprocess.check_output(["node", "--version"], cwd=ROOT, text=True).strip(), "inputs": fingerprints}
    (root / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(str(root), flush=True)
    outcomes = []
    (root / "results.json").write_text("[]\n")
    try:
        for scene in manifest["workload"]["scenes"]:
            entry, fixture = SCENES[scene]
            for backend in manifest["workload"]["backends"]:
                directory = root / f"{scene}-{backend}"
                directory.mkdir()
                for recover in [False, True]:
                    name = "cold" if recover else "warm"
                    env = dict(os.environ, TMPDIR=str(temporary), TSX_TSCONFIG_PATH=str(ROOT / "tsconfig.base.json"),
                               SIMULATION_COMPANY_ROOT=str(directory), SIMULATION_COMPANY_BACKEND=backend,
                               WORLD_LONGITUDINAL_ROUNDS=str(args.rounds), WORLD_POST_MVP_RECOVER=str(recover).lower(),
                               CLOCKY_EXAMPLE_MODE="src", SIMULATION_MODEL_LIMIT="2", SIMULATION_MODEL_QUEUE_LIMIT="16", SIMULATION_REPLAY_PAGE_SIZE="4",
                           SIMULATION_CONTEXT_LIMIT="524288", SIMULATION_BENCHMARK_TEAM_LIMITS=json.dumps(
                               company_team_limits if scene == "company" else team_limits))
                    command = ["node", "--import", "tsx/esm", f"examples/simulation-company/tests/{entry}",
                               f"examples/simulation-company/tests/fixtures/{fixture}/cordis.yml"]
                    record = {"scene": scene, "backend": backend, "recover": recover,
                              **run_process(command, directory, name, env)}
                    outcomes.append(record)
                    (root / "results.json").write_text(json.dumps(outcomes, indent=2) + "\n")
                    print(json.dumps({key: value for key, value in record.items() if key not in {"result", "command"}}), flush=True)
                    if record.get("failure") is not None:
                        raise SystemExit(f"{scene}/{backend}/{name} failed; inspect retained stderr")
    finally:
        current = fingerprint(ROOT, allow_missing=True)
        drift = sorted(name for name in fingerprints.keys() | current.keys() if fingerprints.get(name) != current.get(name))
        (root / "input-drift.json").write_text(json.dumps(drift, indent=2) + "\n")
    if drift:
        raise SystemExit("Inputs changed during execution; preserved samples are not a fixed-input baseline")


if __name__ == "__main__":
    main()

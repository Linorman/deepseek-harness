"""Exercise F0 collection provenance and rejection without running a simulation."""
import copy
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]
TEMP = ROOT / ".tmp/world-post-mvp/acceptance-tests"
TEMP.mkdir(parents=True, exist_ok=True)
SPEC = importlib.util.spec_from_file_location("world_post_mvp_acceptance", ROOT / "scripts/world-post-mvp-acceptance.py")
ACCEPTANCE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ACCEPTANCE)
FIXTURES = Path(__file__).resolve().parent / "fixtures/world-post-mvp-acceptance"


class AcceptanceTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(dir=TEMP)
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        # Freeze the reviewed F0 inputs: later measurement changes must invalidate
        # production historical exceptions without changing this regression case.
        for name, fixture in ((ACCEPTANCE.RUNNER, "runner.py.txt"),
                              (ACCEPTANCE.ASSOCIATION, "association.ts.txt")):
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes((FIXTURES / fixture).read_bytes())
        self.current = {name: ACCEPTANCE.digest((self.root / name).read_bytes())
                        for name in (ACCEPTANCE.RUNNER, ACCEPTANCE.ASSOCIATION)}
        self.current["packages/example/src/index.ts"] = "unchanged-source-hash"
        self.sources = {scene: self.root / scene for scene in ACCEPTANCE.BASELINE.SCENES}
        limits = {"maxParticipantsPerTeam": 48, "maxActivationsPerTeam": 512, "maxTurnsPerTeam": 2048,
                  "maxPostIdempotencyEntriesPerChannel": 2048, "maxRatePerParticipantPerMinute": 2048,
                  "maxWallTimeMsPerTeam": 7200000}
        self.workload = {"rounds": 32, "scenes": list(self.sources), "backends": ["json", "sqlite"],
                         "concurrency": 1, "mode": "source", "processTimeoutSeconds": 7200,
                         "optimizationTarget": None, "teamLimits": limits,
                         "companyTeamLimits": {**limits, "maxActivationsPerTeam": 1024, "maxTurnsPerTeam": 4096},
                         "scheduling": "Sequential scene/backend pairs; warm process completes before its fresh cold process",
                         "modelPolicy": "scripted keyless; laboratory stages canonical Session tool decisions without inference",
                         "residentLimits": {"company": 3, "laboratory": 2, "association": 2}, "modelConcurrency": 2,
                         "replayPageSize": 4, "contextBytes": 524288, "laboratoryNormHistoryBytes": 262144}
        for scene, directory in self.sources.items():
            directory.mkdir()
            manifest = {"workload": copy.deepcopy(self.workload), "inputs": dict(self.current),
                        "hardware": {"cpuModel": "fixture", "physicalMemoryBytes": 16000000000},
                        "node": "v24.0.0", "baseRevision": "fixture-base"}
            if scene in ("laboratory", "association"):
                manifest["inputs"][ACCEPTANCE.RUNNER] = ACCEPTANCE.LEGACY_SHA256[ACCEPTANCE.RUNNER]
                del manifest["workload"]["companyTeamLimits"]
            if scene == "laboratory":
                manifest["inputs"][ACCEPTANCE.ASSOCIATION] = ACCEPTANCE.LEGACY_SHA256[ACCEPTANCE.ASSOCIATION]
            self.write(scene, "manifest.json", manifest)
            self.write(scene, "input-drift.json", [])
            records = []
            for backend in ("json", "sqlite"):
                folder = directory / f"{scene}-{backend}"
                folder.mkdir()
                for recover in (False, True):
                    result = {"scenario": scene, "backend": backend, "rounds": 32, "recoveredProcess": recover,
                              "restored": True, "modelCalls": 0, "runtimePaths": {
                                  f"@clocky/clocky-{package}": (self.root / f"packages/simulation/{package}/src/index.ts").as_uri()
                                  for package in ("simulation", "simulation-local", "simulation-world")}}
                    if recover:
                        result["coldRestoreMs"] = 10
                    else:
                        result["samples"] = [{"round": index, "elapsedMs": index * 2, "rss": 100,
                                              "activeActors": 3, "people": {"assignedPeople": 2,
                                                  "nonterminatedPeople": 3, "residentActors": 2,
                                                  "unreleasedWriters": 2, "residentLimit": 3}}
                                             for index in range(1, 33)]
                    entry, fixture = ACCEPTANCE.BASELINE.SCENES[scene]
                    records.append({"scene": scene, "backend": backend, "recover": recover,
                                    "command": ["node", "--import", "tsx/esm", f"examples/simulation-company/tests/{entry}",
                                                f"examples/simulation-company/tests/fixtures/{fixture}/cordis.yml"],
                                    "exitCode": 0, "elapsedMs": 100, "result": result})
                    name = "cold" if recover else "warm"
                    (folder / f"{name}.stdout").write_text("original loader output\n" + json.dumps(result) + "\n")
                    (folder / f"{name}.stderr").write_text("original progress\n")
            self.write(scene, "results.json", records)

    def write(self, scene, name, value):
        (self.sources[scene] / name).write_text(json.dumps(value) + "\n")

    def read(self, scene, name):
        return json.loads((self.sources[scene] / name).read_text())

    def validate(self):
        with patch.object(ACCEPTANCE.BASELINE, "fingerprint", return_value=self.current):
            return ACCEPTANCE.validate(self.sources, self.root)

    def test_exact_historical_reconstruction_and_independent_complete_collection(self):
        self.assertEqual(ACCEPTANCE.legacy_inputs(self.root), ACCEPTANCE.LEGACY_SHA256)
        result = self.validate()
        self.assertTrue(result["complete"], result["issues"])
        self.assertEqual(len(result["rows"]), 6)
        self.assertIn("not one execution", result["scope"])
        components = {component["scene"]: component for component in result["components"]}
        self.assertEqual(len(components["laboratory"]["inputCompatibility"]), 2)
        self.assertEqual(len(components["association"]["inputCompatibility"]), 1)
        self.assertEqual(len(components["company"]["inputCompatibility"]), 0)
        for scene, component in components.items():
            self.assertEqual(len(component["selectedRecords"]), 4)
            self.assertEqual(len(component["rawFiles"]), 11)
            for name, identity in component["rawFiles"].items():
                self.assertEqual(identity["sha256"], ACCEPTANCE.digest((self.sources[scene] / name).read_bytes()))

    def test_failed_other_scene_records_remain_explicitly_excluded(self):
        records = self.read("laboratory", "results.json")
        records.append({"scene": "association", "backend": "json", "recover": False, "exitCode": 1,
                        "failure": {"kind": "exit", "exitCode": 1}})
        self.write("laboratory", "results.json", records)
        result = self.validate()
        self.assertTrue(result["complete"], result["issues"])
        lab = next(component for component in result["components"] if component["scene"] == "laboratory")
        self.assertEqual(lab["excludedRecords"][0]["exitCode"], 1)

    def test_missing_processes_and_streams_never_complete(self):
        self.write("company", "results.json", [])
        (self.sources["company"] / "input-drift.json").unlink()
        (self.sources["company"] / "company-json/cold.stdout").unlink()
        result = self.validate()
        self.assertFalse(result["complete"])
        self.assertTrue(any("expected exactly one" in issue for issue in result["issues"]))
        self.assertTrue(any("input-drift.json" in issue for issue in result["issues"]))

    def test_failed_duplicate_and_invalid_round_records_are_rejected(self):
        original = self.read("company", "results.json")
        for change in ("failure", "duplicate", "round", "restore", "rss", "runtime", "command"):
            with self.subTest(change=change):
                records = copy.deepcopy(original)
                if change == "failure":
                    records[0]["exitCode"] = -15
                elif change == "duplicate":
                    records.append(records[0])
                elif change == "round":
                    records[0]["result"]["samples"][1]["round"] = 1
                elif change == "restore":
                    records[1]["result"]["modelCalls"] = 1
                elif change == "rss":
                    del records[0]["result"]["samples"][0]["rss"]
                elif change == "runtime":
                    records[0]["result"]["runtimePaths"] = {}
                else:
                    records[0]["command"] = ["wrong entry"]
                self.write("company", "results.json", records)
                self.assertFalse(self.validate()["complete"])

    def test_wrong_hash_inventory_addition_and_wrong_scene_exception_are_rejected(self):
        original = self.read("association", "manifest.json")
        for name, value in [(ACCEPTANCE.RUNNER, "unreviewed-runner-hash"),
                            (ACCEPTANCE.ASSOCIATION, ACCEPTANCE.LEGACY_SHA256[ACCEPTANCE.ASSOCIATION]),
                            ("packages/example/src/index.ts", "changed-source"),
                            ("packages/new/src/index.ts", "new-source")]:
            with self.subTest(name=name):
                manifest = copy.deepcopy(original)
                manifest["inputs"][name] = value
                self.write("association", "manifest.json", manifest)
                self.assertFalse(self.validate()["complete"])
        manifest = copy.deepcopy(original)
        del manifest["inputs"]["packages/example/src/index.ts"]
        self.write("association", "manifest.json", manifest)
        self.assertFalse(self.validate()["complete"])

    def test_unreviewed_current_change_cannot_broaden_legacy_exception(self):
        for name in (ACCEPTANCE.ASSOCIATION, ACCEPTANCE.RUNNER):
            with self.subTest(name=name):
                path = self.root / name
                original = path.read_bytes()
                path.write_bytes(original + b"\n# unrelated new code\n")
                self.current[name] = ACCEPTANCE.digest(path.read_bytes())
                try:
                    self.assertNotIn(name, ACCEPTANCE.legacy_inputs(self.root))
                    self.assertFalse(self.validate()["complete"])
                finally:
                    path.write_bytes(original)
                    self.current[name] = ACCEPTANCE.digest(original)

    def test_metadata_policy_and_drift_mismatch_are_rejected(self):
        original = self.read("company", "manifest.json")
        for change in ("hardware", "node", "baseRevision", "rounds", "modelPolicy", "companyTeamLimits"):
            with self.subTest(change=change):
                manifest = copy.deepcopy(original)
                if change in ("hardware", "node", "baseRevision"):
                    manifest[change] = "different metadata"
                else:
                    manifest["workload"][change] = "different policy"
                self.write("company", "manifest.json", manifest)
                self.assertFalse(self.validate()["complete"])
        self.write("company", "manifest.json", original)
        self.write("company", "input-drift.json", ["changed-input"])
        self.assertFalse(self.validate()["complete"])

    def test_original_stdout_must_match_result_and_files_cannot_escape_source(self):
        path = self.sources["company"] / "company-json/warm.stdout"
        path.write_text('{"scenario":"fabricated"}\n')
        self.assertFalse(self.validate()["complete"])
        path.unlink()
        outside = self.root / "outside.stdout"
        outside.write_text("{}\n")
        path.symlink_to(outside)
        result = self.validate()
        self.assertTrue(any("escapes its original directory" in issue for issue in result["issues"]))

    def test_cli_writes_incomplete_summary_and_preserves_original_batches(self):
        self.write("company", "results.json", [])
        before = {str(path): path.read_bytes() for directory in self.sources.values()
                  for path in directory.rglob("*") if path.is_file()}
        output = self.root / "collection"
        argv = ["acceptance", "--output", str(output)]
        for scene, directory in self.sources.items():
            argv.extend([f"--{scene}", str(directory)])
        real_validate = ACCEPTANCE.validate
        with patch.object(sys, "argv", argv), patch.object(ACCEPTANCE, "ROOT", self.root), \
                patch.object(ACCEPTANCE.BASELINE, "fingerprint", return_value=self.current), \
                patch.object(ACCEPTANCE, "validate", side_effect=lambda sources: real_validate(sources, self.root)), \
                self.assertRaises(SystemExit) as failure:
            ACCEPTANCE.main()
        self.assertEqual(failure.exception.code, 1)
        self.assertFalse(json.loads((output / "summary.json").read_text())["complete"])
        self.assertEqual(before, {str(path): path.read_bytes() for directory in self.sources.values()
                                  for path in directory.rglob("*") if path.is_file()})


if __name__ == "__main__":
    unittest.main()

"""Small F0 evidence tests; never execute the simulation benchmark workload."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
TEMP = ROOT / ".tmp/world-post-mvp/script-tests"
TEMP.mkdir(parents=True, exist_ok=True)


def module(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / f"{name}.py")
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


BASELINE = module("world-post-mvp-baseline")
REPORT = module("world-post-mvp-report")


def evidence():
    manifest = {"workload": {"scenes": ["company"], "backends": ["sqlite"], "rounds": 2}, "hardware": {}}
    sample = {"elapsedMs": 12.5, "rss": 100, "activeActors": 3, "people": {
        "assignedPeople": 2, "nonterminatedPeople": 3, "residentActors": 2, "unreleasedWriters": 2, "residentLimit": 3}}
    records = []
    for recover in [False, True]:
        value = {"scenario": "company", "backend": "sqlite", "rounds": 2, "recoveredProcess": recover,
                 "restored": True, "modelCalls": 0 if recover else 6}
        if recover:
            value["coldRestoreMs"] = 8.5
        else:
            value["samples"] = [{"round": index, **copy.deepcopy(sample)} for index in [1, 2]]
        records.append({"scene": "company", "backend": "sqlite", "recover": recover, "exitCode": 0,
                        "elapsedMs": 100, "result": value})
    return manifest, records


class ReportTests(unittest.TestCase):
    def test_b1_metrics_require_all_cost_categories_and_report_peak_separately(self):
        manifest, records = evidence()
        manifest["workload"]["measurementVersion"] = 2
        self.assertFalse(REPORT.summarize(manifest, records, [])["complete"])
        for sample in records[0]["result"]["samples"]:
            sample.update(processElapsedMs=100, maintenanceMs=10, maintenanceFraction=.1,
                          processPeakRssBytes=1024, historicalIdentities=5,
                          monetaryCost={"status": "unknown", "reason": "No prices"},
                          modelAccounting={name: {"calls": 1, "knownTokens": 15, "unknownCalls": 0, "retainedTokens": 0}
                                           for name in ["actor", "director", "generation", "auxiliary"]})
        records[1]["result"]["processPeakRssBytes"] = 2048
        result = REPORT.summarize(manifest, records, [])
        self.assertTrue(result["complete"])
        self.assertEqual(result["rows"][0]["b1Metrics"]["coldProcessPeakRssBytes"], 2048)
        del records[0]["result"]["samples"][0]["modelAccounting"]["generation"]
        self.assertFalse(REPORT.summarize(manifest, records, [])["complete"])

    def test_valid_pair_and_measurements(self):
        manifest, records = evidence()
        result = REPORT.summarize(manifest, records, [])
        self.assertTrue(result["complete"])
        self.assertEqual(result["rows"][0]["coldRestoreMs"], 8.5)
        self.assertEqual(result["rows"][0]["p95Ms"], 12.5)

    def test_duplicate_and_missing_warm_or_cold_never_complete(self):
        manifest, records = evidence()
        for changed in [records[:1], records[1:], [records[1], records[1]], [records[0], records[0]], records + [records[0]]]:
            with self.subTest(changed=changed):
                result = REPORT.summarize(manifest, changed, [])
                self.assertFalse(result["complete"])
                self.assertTrue(result["issues"])

    def test_exact_original_rounds_and_required_metrics(self):
        for field, changed in [("round", 2), ("round", 0), ("activeActors", None), ("people", None),
                               ("elapsedMs", float("nan")), ("rss", -1)]:
            with self.subTest(field=field, changed=changed):
                manifest, records = evidence()
                records[0]["result"]["samples"][0][field] = changed
                self.assertFalse(REPORT.summarize(manifest, records, [])["complete"])
        manifest, records = evidence()
        del records[0]["result"]["samples"][1]["activeActors"]
        self.assertFalse(REPORT.summarize(manifest, records, [])["complete"])

    def test_payload_identity_cold_failure_and_drift(self):
        for field, changed in [("backend", "json"), ("rounds", 3), ("restored", False), ("modelCalls", 1), ("coldRestoreMs", None)]:
            manifest, records = evidence()
            records[1]["result"][field] = changed
            self.assertFalse(REPORT.summarize(manifest, records, [])["complete"])
        manifest, records = evidence()
        records[0]["failure"] = {"kind": "invalid-result"}
        self.assertFalse(REPORT.summarize(manifest, records, [])["complete"])
        self.assertFalse(REPORT.summarize(*evidence(), None)["complete"])
        self.assertFalse(REPORT.summarize(*evidence(), ["changed.ts"])["complete"])

    def test_incomplete_files_and_legacy_sample_write_explicit_failed_summary(self):
        with tempfile.TemporaryDirectory(dir=TEMP) as temporary:
            directory = Path(temporary)
            manifest, records = evidence()
            del records[0]["result"]["samples"][0]["activeActors"]
            for name, value in [("manifest.json", manifest), ("results.json", records), ("input-drift.json", [])]:
                (directory / name).write_text(json.dumps(value))
            with patch.object(sys, "argv", ["report", str(directory)]), self.assertRaises(SystemExit) as error:
                REPORT.main()
            self.assertEqual(error.exception.code, 1)
            self.assertFalse(json.loads((directory / "summary.json").read_text())["complete"])


class ProcessTests(unittest.TestCase):
    def run_small(self, code, timeout=5):
        with tempfile.TemporaryDirectory(dir=TEMP) as temporary:
            directory = Path(temporary)
            result = BASELINE.run_process([sys.executable, "-c", code], directory, "warm", os.environ.copy(), timeout)
            self.assertTrue((directory / "warm.stdout").exists())
            self.assertTrue((directory / "warm.stderr").exists())
            return result

    def test_timeout_is_a_structured_outcome(self):
        result = self.run_small("import time; time.sleep(2)", timeout=.05)
        self.assertIsNone(result["exitCode"])
        self.assertEqual(result["failure"]["kind"], "timeout")
        self.assertGreaterEqual(result["elapsedMs"], 0)

    def test_invalid_json_empty_output_and_nonzero_exit(self):
        for code in ["print('bad json')", "pass", "print('[]')"]:
            result = self.run_small(code)
            self.assertEqual(result["exitCode"], 0)
            self.assertEqual(result["failure"]["kind"], "invalid-result")
        self.assertEqual(self.run_small("raise SystemExit(2)")["failure"], {"kind": "exit", "exitCode": 2})
        self.assertEqual(self.run_small("print('{}')")["result"], {})

    def test_main_records_timeout_and_parse_failure_before_exit(self):
        for failure in ["timeout", "invalid-result"]:
            with self.subTest(failure=failure), tempfile.TemporaryDirectory(dir=TEMP) as temporary:
                root = Path(temporary)
                outcome = {"command": ["not-executed"], "exitCode": None if failure == "timeout" else 0,
                           "elapsedMs": 1, "failure": {"kind": failure}}
                with patch.object(BASELINE, "ROOT", root), patch.object(BASELINE, "fingerprint", return_value={"input": "hash"}), \
                        patch.object(BASELINE, "hardware", return_value={"cpuModel": "unknown"}), \
                        patch.object(BASELINE.subprocess, "check_output", return_value="fixed-version"), \
                        patch.object(BASELINE, "run_process", return_value=outcome), \
                        patch.object(sys, "argv", ["baseline", "--rounds", "1", "--scene", "company", "--backend", "json"]), \
                        self.assertRaises(SystemExit):
                    BASELINE.main()
                evidence_root = next((root / ".local/world-post-mvp/f0-longitudinal").iterdir())
                records = json.loads((evidence_root / "results.json").read_text())
                self.assertEqual(records[0]["failure"]["kind"], failure)
                self.assertFalse(records[0]["recover"])
                self.assertEqual(json.loads((evidence_root / "input-drift.json").read_text()), [])
                self.assertEqual(json.loads((evidence_root / "manifest.json").read_text())["workload"]["concurrency"], 1)

    def test_hardware_uses_real_probe_values_or_explicit_unknown(self):
        with patch.object(BASELINE.platform, "platform", return_value="Darwin-test"), \
                patch.object(BASELINE.platform, "system", return_value="Darwin"), \
                patch.object(BASELINE.subprocess, "check_output", side_effect=["Example CPU\n", "17179869184\n"]):
            value = BASELINE.hardware()
            self.assertEqual(value["cpuModel"], "Example CPU")
            self.assertEqual(value["physicalMemoryBytes"], 17179869184)
        with patch.object(BASELINE.platform, "system", return_value="Other"):
            value = BASELINE.hardware()
            self.assertEqual(value["cpuModel"], "unknown")
            self.assertIsNone(value["physicalMemoryBytes"])
            self.assertTrue(value["probeErrors"])

    def test_actual_dependency_inventory_and_generated_exclusions(self):
        files = {str(path.relative_to(ROOT)) for path in BASELINE.source_files(ROOT)}
        for path in ["packages/llm/llm/src/index.ts", "packages/preset/agent-presets/src/index.ts", "vendor/loader/src/index.ts",
                     "vendor/cordis/src/index.ts", "packages/llm/llm/package.json", "scripts/world-post-mvp-report.py"]:
            self.assertIn(path, files)
        self.assertFalse(any("node_modules" in Path(path).parts or "lib" in Path(path).parts for path in files))

    def test_new_and_deleted_source_are_detected(self):
        with tempfile.TemporaryDirectory(dir=TEMP) as temporary:
            root = Path(temporary)
            path = root / "packages/example/src/index.ts"
            path.parent.mkdir(parents=True)
            path.write_text("original")
            first = BASELINE.fingerprint(root, allow_missing=True)
            path.unlink()
            added = path.with_name("new.ts"); added.write_text("new")
            last = BASELINE.fingerprint(root, allow_missing=True)
            drift = {name for name in first.keys() | last.keys() if first.get(name) != last.get(name)}
            self.assertEqual(drift, {"packages/example/src/index.ts", "packages/example/src/new.ts"})


if __name__ == "__main__":
    unittest.main()

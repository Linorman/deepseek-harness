"""Summarize F0 evidence without turning missing, duplicate or failed measurements into success."""
import argparse
from collections import Counter
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def number(value, integer=False):
    """Accept finite nonnegative measurements, excluding booleans and missing values."""
    return (type(value) in (int, float) and (not integer or type(value) is int)
            and math.isfinite(value) and value >= 0)


def summarize(manifest, results, drift):
    """Validate the exact workload matrix and original round order before aggregating samples."""
    issues, rows = [], []
    workload = manifest.get("workload", {}) if isinstance(manifest, dict) else {}
    if not isinstance(workload, dict):
        workload = {}
    scenes, backends, rounds = workload.get("scenes"), workload.get("backends"), workload.get("rounds")
    def choices(values, allowed):
        return (isinstance(values, list) and bool(values) and all(type(value) is str and value in allowed for value in values)
                and len(values) == len(set(values)))
    valid_workload = (choices(scenes, {"company", "laboratory", "association"})
                      and choices(backends, {"json", "sqlite"}) and type(rounds) is int and 1 <= rounds <= 64)
    if not valid_workload:
        issues.append("Invalid or duplicated workload scenes/backends/rounds")
    if drift != []:
        issues.append("Missing, invalid or nonempty input-drift evidence")
    if not isinstance(results, list):
        issues.append("Missing or invalid process results")
        results = []
    expected = {(scene, backend, recover) for scene in scenes for backend in backends for recover in (False, True)} if valid_workload else set()
    counts, admitted = Counter(), {}
    for index, record in enumerate(results):
        label = f"result[{index}]"
        if (not isinstance(record, dict) or type(record.get("scene")) is not str
                or type(record.get("backend")) is not str or type(record.get("recover")) is not bool):
            issues.append(f"{label}: invalid process identity")
            continue
        key = (record["scene"], record["backend"], record["recover"])
        counts[key] += 1
        if key not in expected:
            issues.append(f"{label}: unexpected process identity {key}")
            continue
        label = f"{key[0]}/{key[1]}/{'cold' if key[2] else 'warm'}"
        if (type(record.get("exitCode")) is not int or record["exitCode"] != 0 or record.get("failure") is not None
                or not number(record.get("elapsedMs"))):
            issues.append(f"{label}: failed or invalid process outcome")
            continue
        value = record.get("result")
        if (not isinstance(value, dict) or value.get("scenario") != key[0] or value.get("backend") != key[1]
                or type(value.get("rounds")) is not int or value["rounds"] != rounds
                or value.get("recoveredProcess") is not key[2] or value.get("restored") is not True
                or not number(value.get("modelCalls"), integer=True)):
            issues.append(f"{label}: payload identity, rounds, restoration or model count does not match workload")
            continue
        if key[2]:
            if (not number(value.get("coldRestoreMs")) or value["modelCalls"] != 0
                    or workload.get("measurementVersion") == 2 and not number(value.get("processPeakRssBytes"))):
                issues.append(f"{label}: missing restore timing or unexpected replay inference")
                continue
        else:
            samples = value.get("samples")
            if not isinstance(samples, list) or len(samples) != rounds:
                issues.append(f"{label}: missing original round samples")
                continue
            valid = True
            for ordinal, sample in enumerate(samples, 1):
                people = sample.get("people") if isinstance(sample, dict) else None
                if workload.get("measurementVersion") == 2:
                    accounting = sample.get("modelAccounting") if isinstance(sample, dict) else None
                    valid_metrics = (isinstance(sample, dict) and all(number(sample.get(key)) for key in
                        ("processElapsedMs", "maintenanceMs", "maintenanceFraction", "processPeakRssBytes", "historicalIdentities"))
                        and sample["maintenanceFraction"] <= 1 and sample["maintenanceMs"] <= sample["processElapsedMs"]
                        and isinstance(accounting, dict) and set(accounting) == {"actor", "director", "generation", "auxiliary"}
                        and all(isinstance(row, dict) and all(number(row.get(key), integer=True) for key in
                            ("calls", "knownTokens", "unknownCalls", "retainedTokens")) for row in accounting.values())
                        and isinstance(sample.get("monetaryCost"), dict) and sample["monetaryCost"].get("status") == "unknown")
                    if not valid_metrics:
                        issues.append(f"{label}: round {ordinal} has missing or invalid B1 maintenance/cost/peak metrics")
                        valid = False
                if (not isinstance(sample, dict) or type(sample.get("round")) is not int or sample["round"] != ordinal
                        or not number(sample.get("elapsedMs")) or not number(sample.get("rss"), integer=True)
                        or not number(sample.get("activeActors"), integer=True) or not isinstance(people, dict)
                        or not all(number(people.get(field), integer=True) for field in
                                   ("assignedPeople", "nonterminatedPeople", "residentActors", "unreleasedWriters", "residentLimit"))):
                    issues.append(f"{label}: round {ordinal} is missing, reordered, duplicated or has invalid measurements")
                    valid = False
            if not valid:
                continue
        admitted[key] = record
    for key in expected:
        if counts[key] != 1:
            issues.append(f"{key}: expected exactly one process record, found {counts[key]}")
    for key, record in admitted.items():
        if key[2] or counts[key] != 1:
            continue
        value = record["result"]
        samples = value["samples"]
        cold_key = (key[0], key[1], True)
        cold = admitted.get(cold_key) if counts[cold_key] == 1 else None
        latencies = sorted(sample["elapsedMs"] for sample in samples)
        def quantile(q):
            return latencies[max(0, math.ceil(q * len(latencies)) - 1)]
        rows.append({"scene": key[0], "backend": key[1], "rounds": len(samples),
                     "p50Ms": quantile(.5), "p95Ms": quantile(.95), "p99Ms": quantile(.99),
                     "maxObservedRssBytes": max(sample["rss"] for sample in samples),
                     "modelCalls": value["modelCalls"], "people": samples[-1]["people"],
                     "activeActors": samples[-1]["activeActors"], "elapsedMs": record["elapsedMs"],
                     "coldRestoreMs": None if cold is None else cold["result"]["coldRestoreMs"],
                     "coldScope": "Native governance/norm replay" if key[0] == "laboratory" else "Simulation/Team checkpoint restore"})
        if workload.get("measurementVersion") == 2:
            latest = samples[-1]
            rows[-1]["b1Metrics"] = {"processPeakRssBytes": max(sample["processPeakRssBytes"] for sample in samples),
                "coldProcessPeakRssBytes": None if cold is None else cold["result"]["processPeakRssBytes"],
                "historicalIdentities": latest["historicalIdentities"], "maintenanceMs": latest["maintenanceMs"],
                "maintenanceFraction": latest["maintenanceFraction"], "modelAccounting": latest["modelAccounting"],
                "monetaryCost": latest["monetaryCost"], "activeMaintenance": latest.get("activeMaintenance")}
    return {"complete": not issues, "issues": sorted(issues), "workload": workload,
            "hardware": manifest.get("hardware", {}) if isinstance(manifest, dict) else {}, "rows": rows,
            "limits": ["Nearest-rank percentiles describe these finite samples, not population guarantees.",
                       "RSS round samples and process high-water RSS (measurement version 2) are reported separately.",
                       "Scripted usage is not a live-provider price or token-efficiency benchmark.",
                       "This is the initial baseline; no B-stage performance improvement is claimed."]}


def main():
    """Write an explicit incomplete summary even when an evidence file or required metric is missing."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    args = parser.parse_args()
    directory = args.directory.resolve()
    if not directory.is_relative_to(ROOT):
        parser.error("evidence must stay inside this repository")
    def read(name):
        try:
            return json.loads((directory / name).read_text())
        except (OSError, ValueError):
            return None  # Missing/unparseable evidence cannot satisfy the complete workload contract.
    summary = summarize(read("manifest.json"), read("results.json"), read("input-drift.json"))
    (directory / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps({"complete": summary["complete"], "rows": len(summary["rows"]), "output": str(directory / "summary.json")}))
    if not summary["complete"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()

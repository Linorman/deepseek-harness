"""Independent final B1 v2 integrity check; no workload or acceptance thresholds changed."""
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import sys
sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]
BATCH = ROOT / '.local/world-post-mvp/f0-longitudinal/1792387319584824000'
FROZEN = ROOT / '.tmp/world-post-mvp/b1-v2-manifest.sha256'
OUTPUT = ROOT / '.agents/plans/2026-10-16-world-post-mvp/evidence/b1/v2-integrity.json'

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

baseline, report = load('world-post-mvp-baseline'), load('world-post-mvp-report')
issues, raw, details = [], {}, []

def require(condition, message):
    if not condition:
        issues.append(message)

def read(name):
    path = BATCH / name
    raw[name] = {'sha256': digest(path), 'bytes': path.stat().st_size}
    return json.loads(path.read_text())

manifest, records, drift = read('manifest.json'), read('results.json'), read('input-drift.json')
require(digest(BATCH / 'manifest.json') == FROZEN.read_text().strip(), 'Manifest differs from monitoring-time frozen digest')
workload = manifest['workload']
require(workload['measurementVersion'] == 2 and workload['rounds'] == 32
        and workload['scenes'] == ['company', 'laboratory', 'association']
        and workload['backends'] == ['json', 'sqlite'] and workload['concurrency'] == 1
        and workload['mode'] == 'source', 'Unexpected v2 matrix dimensions or mode')
current = baseline.fingerprint(ROOT, allow_missing=True)
changes = sorted(name for name in current.keys() | manifest['inputs'].keys()
                 if current.get(name) != manifest['inputs'].get(name))
require(changes == [], 'Current source inventory differs from frozen manifest')
summary = report.summarize(manifest, records, drift)
issues.extend(summary['issues'])
expected = [(scene, backend, recover) for scene in workload['scenes']
            for backend in workload['backends'] for recover in (False, True)]
require([(r.get('scene'), r.get('backend'), r.get('recover')) for r in records] == expected,
        'Original process order differs from strict sequential matrix')
for record in records:
    scene, backend, recover = record['scene'], record['backend'], record['recover']
    label = f"{scene}-{backend}/{'cold' if recover else 'warm'}"
    entry, fixture = baseline.SCENES[scene]
    require(record['command'] == ['node', '--import', 'tsx/esm', f'examples/simulation-company/tests/{entry}',
            f'examples/simulation-company/tests/fixtures/{fixture}/cordis.yml'], label + ': unexpected command')
    for suffix in ['stdout', 'stderr']:
        path = BATCH / (label + '.' + suffix)
        raw[label + '.' + suffix] = {'sha256': digest(path), 'bytes': path.stat().st_size}
    value = record.get('result', {})
    require(json.loads((BATCH / (label + '.stdout')).read_text().splitlines()[-1]) == value,
            label + ': stdout differs from structured result')
    expected_paths = {name: (ROOT / f'packages/simulation/{package}/src/index.ts').as_uri()
                      for name, package in [('@clocky/clocky-simulation', 'simulation'),
                       ('@clocky/clocky-simulation-local', 'simulation-local'), ('@clocky/clocky-simulation-world', 'simulation-world')]}
    require(value.get('runtimePaths') == expected_paths, label + ': unexpected runtime source owners')
    if recover:
        require(value.get('modelCalls') == 0, label + ': cold recovery invoked model')
        continue
    samples = value.get('samples', [])
    progress = [json.loads(line) for line in (BATCH / (label + '.stderr')).read_text().splitlines()
                if line.startswith('{"kind":"f0-progress"')]
    require([{k: v for k, v in row.items() if k not in {'kind', 'scenario'}} for row in progress] == samples,
            label + ': original round progress differs from final samples')
    previous = None
    for sample in samples:
        prefix = label + '/round' + str(sample['round'])
        require(sample['people']['residentActors'] <= sample['people']['residentLimit'] == workload['residentLimits'][scene],
                prefix + ': residency ceiling mismatch')
        require(sample['people']['cursor'] == sample['sourceRevision'], prefix + ': personnel/source cut mismatch')
        require(sample['historicalIdentities'] >= sample['people']['assignedPeople'], prefix + ': historical identity undercount')
        require(sample['activeMaintenance'] is None, prefix + ': maintenance still active at round boundary')
        intervals = sample['maintenanceIntervals']
        duration = sum(row['finishedMs'] - row['startedMs'] for row in intervals)
        require(all(0 <= row['startedMs'] <= row['finishedMs'] <= sample['processElapsedMs'] for row in intervals),
                prefix + ': invalid maintenance interval')
        require(math.isclose(duration, sample['maintenanceMs'], abs_tol=1e-6)
                and math.isclose(duration / sample['processElapsedMs'], sample['maintenanceFraction'], abs_tol=1e-9),
                prefix + ': maintenance total/ratio differs from raw intervals')
        for category, usage in sample['modelAccounting'].items():
            require(usage['unknownCalls'] <= usage['calls'], prefix + ': unknown calls exceed category calls')
            require(usage['unknownCalls'] == 0 or usage['retainedTokens'] > 0,
                    prefix + ': unknown model liability lost its token reservation')
        if previous is not None:
            require(all(sample[key] >= previous[key] for key in ['sourceRevision', 'historicalIdentities',
                        'processPeakRssBytes', 'processElapsedMs', 'maintenanceMs']), prefix + ': cumulative metric regressed')
        previous = sample
    details.append({'scene': scene, 'backend': backend, 'samples': len(samples),
                    'final': samples[-1] if samples else None})
result = {'kind': 'independent-b1-v2-integrity', 'complete': not issues, 'issues': sorted(issues),
          'batch': str(BATCH.relative_to(ROOT)), 'frozenManifestSha256': FROZEN.read_text().strip(),
          'currentInputDrift': changes, 'rawFiles': raw, 'rows': summary['rows'], 'details': details,
          'validatorSha256': digest(Path(__file__)),
          'scope': 'One unchanged v2 sequential 12-process/192-round matrix; integrity and measurements only.',
          'limits': ['Old independent-scene F0 acceptance script fixes optimizationTarget=None and is inapplicable to v2.',
                     'B19 index/local improvement thresholds remain separately frozen in their original workloads.',
                     'Scripted fixture usage has no frozen provider pricing; monetary costs remain unknown.',
                     'Laboratory cold restore covers Native governance/norm replay, not Team checkpoint restore.']}
OUTPUT.write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({'complete': result['complete'], 'issues': result['issues'], 'output': str(OUTPUT)}))
sys.exit(0 if result['complete'] else 1)

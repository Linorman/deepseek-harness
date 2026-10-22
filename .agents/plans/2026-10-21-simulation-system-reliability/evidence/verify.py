"""Verify the retained evidence and Git baseline without running business code."""
from pathlib import Path
import hashlib
import json
import subprocess

root = Path(__file__).resolve().parents[4]
manifest = json.loads(Path(__file__).with_name('manifest.json').read_text())
commit = manifest['baselineCommit']

def git(*arguments):
    return subprocess.check_output(['git', '-C', str(root), *arguments])

assert git('rev-parse', manifest['baselineRef']).decode().strip() == commit
assert git('rev-parse', commit + '^{tree}').decode().strip() == manifest['baselineTree']
assert not git('diff', '--name-only', manifest['head'], commit, '--', 'vendor')
for record in manifest['evidence']:
    data = (root / record['path']).read_bytes()
    assert len(data) == record['bytes'], record['path']
    assert hashlib.sha256(data).hexdigest() == record['sha256'], record['path']
for record in manifest['sources']:
    data = git('show', commit + ':' + record['path'])
    assert hashlib.sha256(data).hexdigest() == record['sha256'], record['path']
print(f"Verified {len(manifest['evidence'])} evidence artifacts, {len(manifest['sources'])} source hashes and pinned baseline {commit}")

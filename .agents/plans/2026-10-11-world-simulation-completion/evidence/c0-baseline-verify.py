"""Verify the preserved integration bytes without modifying repository state."""
import hashlib
import json
import pathlib
import tarfile

root = pathlib.Path(__file__).resolve().parents[4]
evidence = pathlib.Path(__file__).parent
manifest = json.loads((evidence / 'c0-baseline-manifest.json').read_text())
input_bytes = json.dumps(manifest['files'], ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()
assert hashlib.sha256(input_bytes).hexdigest() == manifest['inputHash']
archive = evidence / manifest['archive']
assert hashlib.sha256(archive.read_bytes()).hexdigest() == manifest['archiveSha256']
with tarfile.open(archive, 'r:gz') as source:
    members = {member.name: member for member in source.getmembers()}
    assert len(members) == manifest['selectedCount']
    for item in manifest['files']:
        member = members[item['path']]
        if item['kind'] == 'symlink':
            data = member.linkname.encode()
        else:
            data = source.extractfile(member).read()
        assert len(data) == item['bytes'], item['path']
        assert hashlib.sha256(data).hexdigest() == item['sha256'], item['path']
old = manifest['originalChecklist']
assert hashlib.sha256((root / old['path']).read_bytes()).hexdigest() == old['sha256']
metadata = json.loads((evidence / 'c0-baseline-metadata.json').read_text())
assert hashlib.sha256((evidence / 'source-design.html').read_bytes()).hexdigest() == metadata['sourceHtmlSha256']
print(json.dumps({'archiveEntriesVerified': len(members), 'archiveSha256': manifest['archiveSha256'],
                  'inputHash': manifest['inputHash'], 'originalChecklistUnchanged': True,
                  'oldTotal': old['total'], 'oldChecked': old['checked'], 'originalHtmlVerified': True}))

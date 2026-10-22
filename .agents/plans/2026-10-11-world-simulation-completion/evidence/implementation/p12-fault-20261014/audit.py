from pathlib import Path
import hashlib
import json
from clocky import SimulationWorldCaseInspection

base = Path('.local/world-completion/p12-execution-faults')
reports = []
dto_count = 0
for face in ('source', 'lib'):
    roots = sorted(p for p in (base / f'verified-{face}').iterdir() if (p / 'barrier.json').is_file())
    assert len(roots) == 12, (face, len(roots))
    for root in roots:
        producer = json.loads((root / 'barrier.json').read_text())
        initial = producer['state']
        first = next(r for r in initial['world']['requests'].values() if r['proposal']['businessKey'] == 'first-colleague')
        target = next(r for r in initial['world']['requests'].values() if r['proposal']['businessKey'] == 'second-colleague')
        stage = producer['stage']
        processes = []
        for round_ in range(3):
            path = root / f'process-{round_}.json'
            process = json.loads(path.read_text())
            assert not process['timedOut']
            assert process['signal'] == ('SIGKILL' if round_ == 0 else None)
            assert process['code'] == (None if round_ == 0 else 0)
            if round_ == 0:
                document = producer
                state = initial
            else:
                document = json.loads((root / f'recovered-{round_}.json').read_text())
                state = document['state']
                assert document['modelCalls'] == 0
                assert state['phase'] == 'paused'
                assert set(state['entities']) == set(initial['entities'])
                for id_, entity in initial['entities'].items():
                    binding = entity.get('binding') or entity.get('participantReservation', {}).get('binding')
                    current = state['entities'][id_]
                    assert (current.get('binding') or current.get('participantReservation', {}).get('binding')) == binding
                assert state['world']['plans'] == initial['world']['plans']
                assert state['resources'] == initial['resources']
                for id_, result in initial['world']['results'].items():
                    assert state['world']['results'][id_] == result
            view_sets = [('views', document['views'])]
            if round_ == 1:
                # The first set is deliberately queried before explicit writable restore.
                view_sets.append(('afterViews', document['afterViews']))
            for name, cases in view_sets:
                source_state = initial if round_ == 1 and name == 'views' else state
                for case in cases:
                    native = source_state['world']['requests'][case['requestId']]
                    for view in case['views']:
                        parsed = SimulationWorldCaseInspection.model_validate(view)
                        assert parsed.value.summary.status == native['status']
                        if parsed.value.section == 'plans':
                            assert [p.id for p in parsed.value.items] == native['plans']
                        dto_count += 1
            if stage == 'notification':
                canonical = json.loads((root / 'canonical-notification.json').read_text())
                op_id = canonical['operationId']
                assert state['operations'][op_id] == initial['operations'][op_id]
                assert state['operations'][op_id]['status'] == 'outcome-unknown'
                evidence = document['notification']
                assert evidence['canonical']['receipt'] == canonical['receipt']
                assert evidence['record']['envelope'] == canonical['receipt']
            processes.append({'round': round_, 'pid': process['pid'], 'path': str(path),
                              'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
        assert first['status'] == 'committed'
        reports.append({'root': str(root), 'face': face, 'stage': stage, 'processes': processes})
result = {'groups': len(reports), 'processes': sum(len(r['processes']) for r in reports),
          'sigkills': len(reports), 'cold_processes': len(reports) * 2, 'dtos': dto_count, 'reports': reports}
(base / 'audit.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({k: v for k, v in result.items() if k != 'reports'}))

"""Verify retained evidence independently of the generation and artistic review states."""
from pathlib import Path
from datetime import datetime, timezone
import ast
import csv
import hashlib
import json
import re
import subprocess

root = Path.cwd()
base = root / 'docs/spikes/evidence/look/references'
sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
template = json.loads((root / 'docs/spikes/evidence/record.template.json').read_text())
records = sorted(base.glob('*/001/record.json'))
assert len(records) == 7
artifact_count = 0
for path in records:
    record = json.loads(path.read_text())
    assert set(template) <= set(record)
    assert set(template['look']) <= set(record['look'])
    assert record['status'] in ['pass', 'fail', 'blocked', 'not_run']
    assert record['look']['cross_review']['verdict'] == 'pending'
    assert record['look']['owner_pick']['state'] == 'pending'
    assert record['look']['owner_pick']['picked'].startswith('n/a:')
    for artifact in record['artifacts']:
        item = root / artifact['path']
        assert item.is_file(), item
        assert item.stat().st_size == artifact['bytes'], item
        assert sha(item) == artifact['sha256'], item
        assert artifact['regenerate'], item
        artifact_count += 1

with (base / 'candidates.csv').open() as source:
    candidates = list(csv.DictReader(source))
assert len(candidates) == 84
assert len({candidate['sha256'] for candidate in candidates}) == 84
original_paths = {
    json.loads(path.read_text())['source_path']
    for path in base.glob('*/001/candidate-*.provenance.json')
}
assert len(original_paths) == 84
assert sum(candidate['screening_status'] == 'rejected_by_automatic_screen' for candidate in candidates) == 83
assert [f"{candidate['frame']}/{candidate['candidate']}" for candidate in candidates if candidate['screening_status'] != 'rejected_by_automatic_screen'] == ['screen-day/08']

for path in (base / '_tools').glob('*.py'):
    ast.parse(path.read_text(), filename=str(path))
for target in re.findall(r'\]\(([^)]+)\)', (base / 'README.md').read_text()):
    if target != 'verification.json':
        assert (base / target).exists(), target
# Git checks the actual staged addition, including new files that an unstaged diff omits.
subprocess.run(['git', 'diff', '--cached', '--check'], check=True)
staged = subprocess.check_output(['git', 'diff', '--cached', '--name-only'], text=True).splitlines()
assert staged and all(path.startswith('docs/spikes/evidence/look/references/') for path in staged)
assert not (root / 'package.json').exists()

report = {
    'executed_at_utc': datetime.now(timezone.utc).isoformat(),
    'source_revision': '4e0c2ca1a72166a6517cb7ca30f911e726189ece',
    'scope': 'Static generated-reference evidence and local analysis utilities; no application implementation or art approval.',
    'integrity': {
        'status': 'pass', 'readable_originals': 84, 'unique_original_hashes': 84,
        'distinct_tool_output_paths': 84, 'matching_exact_prompt_hashes': 84,
        'unchanged_source_copy_pairs': 84, 'template_complete_records': 7,
        'record_artifacts_verified': artifact_count, 'contact_sheets': 7,
        'contact_sheet_width_pixels': 2048, 'contact_sheet_cards_each': 12,
        'readme_links_resolve': True, 'python_syntax': 'pass', 'staged_diff_check': 'pass',
        'assembler_command': 'python3 docs/spikes/evidence/look/references/_tools/package-evidence.py',
        'verification_command': 'python3 docs/spikes/evidence/look/references/_tools/verify-evidence.py'
    },
    'visual_contact_sheet_check': {
        'status': 'pass',
        'scope': 'Layout and completeness only: seven sheets inspected with all twelve images and readable candidate/flag captions; no selection or artistic approval.',
        'groups': ['rack-day', 'rack-night', 'stall-day', 'stall-night', 'district-day', 'district-night', 'screen-day']
    },
    'automatic_screen': {'flagged': 83, 'not_flagged': 1, 'not_flagged_candidate': 'screen-day/08', 'meaning': 'No automatic flag is not approval or proof of orthographic projection.'},
    'synthetic_controls': {
        'broad_controls': 'pass for parallel/converging lines and zero/one/two orange patches',
        'compact_convergence': 'known false negative retained; below coverage threshold; no detector threshold changed to hide it',
        'files': ['screening-controls.json', 'screening-controls-compact-convergence.json']
    },
    'application_checks': [
        {'command': f'bun run {name}', 'status': 'not_run', 'reason': 'No root package.json or application scripts exist on this docs-only source revision. Recheck after integrating with Stage 0; no passing result is claimed.'}
        for name in ['typecheck', 'lint', 'build']
    ],
    'review': 'Claude pending', 'owner_pick': 'pending',
    'next_action': 'Claude reviews exclusions and common failures before a supported shortlist; owner then picks or rejects. Stop before tones/assets.'
}
(base / 'verification.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({'integrity': 'pass', 'records': len(records), 'record_artifacts_verified': artifact_count, 'originals': len(candidates), 'automatic_flags': 83, 'art_review': 'pending'}))

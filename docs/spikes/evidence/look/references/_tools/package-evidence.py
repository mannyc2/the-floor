"""Assemble an auditable reference batch without treating generated images as approvals."""
from pathlib import Path
from datetime import datetime, timezone
import csv
import hashlib
import json
import re
from PIL import Image

ROOT = Path.cwd()
BASE = ROOT / 'docs/spikes/evidence/look/references'
TOOLS = 'docs/spikes/evidence/look/references/_tools'
GROUPS = ['rack-day', 'rack-night', 'stall-day', 'stall-night', 'district-day', 'district-night', 'screen-day']
SOURCE_REVISION = '4e0c2ca1a72166a6517cb7ca30f911e726189ece'
SOURCE = ROOT / 'docs/floor-docs-2026-10-12/the-floor.md'
SHA = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
DUMP = lambda path, data: path.write_text(json.dumps(data, indent=2) + '\n')
now = datetime.now(timezone.utc).isoformat()
source = SOURCE.read_text()
style = re.search(r'\*\*Style block\*\*.*?```text\n(.*?)\n```', source, re.S).group(1)
avoid = re.search(r'\*\*Avoid block\*\*.*?```text\n(.*?)\n```', source, re.S).group(1)
provenance = json.loads((BASE / 'prompt-provenance.json').read_text())
assert SHA(SOURCE) == provenance['source']['sha256']
assert style == provenance['style_block'] and avoid == provenance['avoid_block']
template = json.loads((ROOT / 'docs/spikes/evidence/record.template.json').read_text())
rows = []
summaries = []
image_hashes = set()
all_image_bytes = 0

for group in GROUPS:
    folder = BASE / group / '001'
    promptset = json.loads((folder / 'prompts.json').read_text())
    images = sorted(folder.glob('candidate-*.png'))
    assert len(images) == len(promptset) == 12, (group, len(images), len(promptset))
    records = []
    for index, path in enumerate(images):
        prompt = promptset[index]
        assert prompt['candidate'] == path.stem[-2:]
        digest = SHA(path)
        assert digest not in image_hashes, 'Duplicate original image'
        image_hashes.add(digest)
        all_image_bytes += path.stat().st_size
        with Image.open(path) as img:
            img.verify()
        with Image.open(path) as img:
            width, height = img.size
        generated = json.loads(path.with_suffix('.provenance.json').read_text())
        screened = json.loads(path.with_suffix('.screening.json').read_text())
        assert generated['sha256'] == screened['image_sha256'] == digest
        assert generated['bytes'] == path.stat().st_size
        assert SHA(Path(generated['source_path'])) == digest, 'Copied original changed'
        prompt_sha = hashlib.sha256(prompt['prompt'].encode()).hexdigest()
        assert prompt['prompt_sha256'] == generated['prompt_sha256'] == prompt_sha
        assert prompt['prompt'].startswith(style + '\n\n')
        tail = avoid.replace('text, letters, ', '') if group == 'screen-day' else avoid
        assert prompt['prompt'].endswith(tail)
        assert generated['input_reference_images'] == 0
        assert (screened['width'], screened['height']) == (width, height)
        row = {'frame': group, 'candidate': prompt['candidate'], 'path': str(path.relative_to(ROOT)), 'width': width, 'height': height, 'bytes': path.stat().st_size, 'sha256': digest, 'prompt_sha256': prompt_sha, 'screening_status': screened['screening_status'], 'perspective_status': screened['perspective']['status'], 'orange_components': screened['orange']['count'], 'ocr_flags': len(screened['ocr']['flagged_tokens']), 'nonopaque_pixels': screened['nonopaque_pixels'], 'reasons': ';'.join(screened['reasons']), 'claude_review': 'pending', 'owner_pick': 'pending'}
        rows.append(row)
        records.append((prompt, generated, screened))
    with Image.open(folder / 'contact-sheet.png') as sheet:
        sheet.verify()
    with Image.open(folder / 'contact-sheet.png') as sheet:
        assert sheet.width == 2048
        sheet_dimensions = list(sheet.size)
    html = (folder / 'contact-sheet.html').read_text()
    assert html.count('<article>') == 12
    rejected = sum(item[2]['screening_status'] == 'rejected_by_automatic_screen' for item in records)
    perspective = sum(item[2]['perspective']['status'] == 'rejected_by_heuristic' for item in records)
    orange = sum(item[2]['orange']['count'] != 1 for item in records)
    text = sum(bool(item[2]['ocr']['flagged_tokens']) for item in records)
    alpha = sum(item[2]['nonopaque_pixels'] > 0 for item in records)
    metrics = {'threshold_source': 'No-perspective/no-text/one-orange rules: look handoff; detector thresholds: frozen operational choices in _tools/screen.py, not Atlas geometric tolerances.', 'transparency_flags': alpha, 'candidates': 12, 'automatic_rejections': rejected, 'not_flagged_automatically': 12 - rejected, 'perspective_flags': perspective, 'orange_count_flags': orange, 'ocr_flags': text, 'claude_shortlist': 'pending', 'owner_pick': 'pending'}
    summaries.append({'frame': group, **metrics})
    screening_command = f'python3 {TOOLS}/screen.py docs/spikes/evidence/look/references/{group}/001/candidate-*.png'
    contact_command = f'bun {TOOLS}/contact-sheet.mjs {group}'
    artifacts = []
    for path in sorted(folder.iterdir()):
        if not path.is_file() or path.name == 'record.json':
            continue
        if path.name == 'prompts.json':
            regenerate = 'Exact prompts are frozen generation inputs; preserve this file.'
        elif path.name.endswith('.screening.json'):
            regenerate = screening_command
        elif path.name.startswith('contact-sheet.'):
            regenerate = contact_command
        elif path.name.endswith('.provenance.json'):
            regenerate = 'Recorded observation of the corresponding independent built-in image_gen call; cannot regenerate historical metadata.'
        else:
            regenerate = f'Call built-in image_gen.imagegen once with the matching prompt in {group}/001/prompts.json; omit both reference-image arguments. Exact bytes are not reproducible because the tool exposes no seed/model revision.'
        artifacts.append({'path': str(path.relative_to(ROOT)), 'committed': True, 'bytes': path.stat().st_size, 'sha256': SHA(path), 'regenerate': regenerate})
    raw = ROOT / 'work/spikes/look/references/screening' / group / '001'
    for path in sorted(raw.rglob('*')):
        if path.is_file():
            artifacts.append({'path': str(path.relative_to(ROOT)), 'committed': False, 'bytes': path.stat().st_size, 'sha256': SHA(path), 'regenerate': screening_command})
    assert sum(not item['committed'] for item in artifacts) == 36
    record = json.loads(json.dumps(template))
    record.update({
        'check_id': f'references-{group}', 'attempt': '001',
        'status': 'fail' if rejected else 'pass',
        'executed_at_utc': min(item[1].get('copied_at_utc', item[1].get('requested_at_utc')) for item in records),
        'operator': 'Codex using built-in image_gen.imagegen, one independent call per original',
        'reviewer': 'Claude pending; no cross-review performed in this generation track',
        'source_revision': SOURCE_REVISION,
        'dependency_versions': {'Bun': '1.4.0', 'Python': '3.12.14', 'opencv-python-headless': '5.0.0.93', 'cv2': '5.0.0', 'NumPy': '2.5.4', 'Pillow': '12.3.0', 'Tesseract': '5.5.1', 'Playwright': '1.62.1', 'Chrome': '155.0.8059.39', 'image_generation_model': 'unknown: built-in tool exposes no exact model revision'},
        'api_evidence': [{'tool': 'built-in image_gen.imagegen', 'independent_calls': 12, 'input_reference_images_per_call': 0, 'prompt_set': str((folder / 'prompts.json').relative_to(ROOT)), 'result_provenance': 'candidate-NN.provenance.json', 'result_images': 'candidate-NN.png', 'montage_substitution': False}],
        'execution_target': 'Built-in image generation, followed by local static image screening and local contact-sheet composition on macOS 15.0; no application renderer executed',
        'runtime_configuration': {'generation': 'Exact prompts in prompts.json; tool defaults; no references; seed and provider model revision unavailable', 'contact_sheet': {'browser': 'local system Google Chrome, headless', 'width': 2048, 'device_scale_factor': 1, 'dimensions': sheet_dimensions}, 'screening': 'Frozen thresholds described in ../../README.md and ../../_tools/screen.py'},
        'stage_and_resources': 'n/a: no application stage or hosted resources for static reference generation',
        'inputs': [{'path': str(SOURCE.relative_to(ROOT)), 'sha256': SHA(SOURCE)}, {'path': str((folder / 'prompts.json').relative_to(ROOT)), 'sha256': SHA(folder / 'prompts.json')}],
        'procedure': ['Generate 12 independent original images with the exact prompts, preserving the source style/avoid blocks and the explicit key-frame-8 exception.', 'Copy each returned PNG without altering it, retaining the tool original; record bytes and SHA-256.', screening_command, contact_command, 'Verify 12 readable unique originals, matching prompt/output hashes, a 2048px contact sheet and all required evidence fields.'],
        'expected_result': 'Twelve retained independent originals and one contact sheet. Batch automatic screen passes only when none of the twelve is flagged; this status never establishes artistic approval.',
        'observed_result': {'generation_complete': True, 'contact_sheet_complete': True, 'automatic_screen': metrics, 'status_scope': 'This record status is the aggregate automatic screen across the batch; generation completion and art approval are separate.'},
        'artifacts': artifacts,
        'policy_and_cost': {'network_policy': 'Generation uses only the built-in image tool; no provider API fallback. Local contact-sheet composition permits file/data resources only.', 'budget': 'User authorized 12–20 independent candidates per frame; 12 selected for each of 7 groups (84 total).', 'observed_cost': 'unknown: built-in tool does not expose billing'},
        'cleanup_result': 'Original tool outputs and copied evidence retained as requested. Scratch masks/OCR TSVs retained outside git. No hosted resources were created.',
        'decision_link': 'docs/decisions.md: owner chose technique B on WebGL; Part B references authorized, with no reference/tone/proportion picks yet',
        'limitations_and_next_action': 'Automatic geometry/color/OCR checks have false positives and false negatives. Generated images are composition references, not exact geometry or readings. Claude must review raw flags and common failures before shortlisting; the owner then picks or rejects. No tones, proportions, kit unit or assets were derived. Full-size originals exceed the normal artifact cap because the user explicitly requested every candidate to be committed.',
        'look': {
            'technique': 'n/a: AI-generated references, not a run of technique B',
            'tone_set': 'n/a: tone selection awaits owner-picked references',
            'theme': group.rsplit('-', 1)[1], 'rung': 'machine' if group.startswith('rack') else 'stall' if group.startswith('stall') else 'district' if group.startswith('district') else 'full screen',
            'dpr': 'n/a: generated raster source; contact sheet uses deviceScaleFactor 1',
            'camera': 'Requested orthographic from one corner, looking down 30 degrees; actual projection is generated and not calibrated; see per-image convergence metrics',
            'canvas': {'original_dimensions': sorted({f"{row['width']}x{row['height']}" for row in rows if row['frame'] == group}), 'contact_sheet_dimensions': sheet_dimensions},
            'backend': 'n/a: no WebGL/WebGPU application rendering', 'renderer_string': 'n/a: no graphics renderer evidence in this reference batch',
            'device_profile': 'n/a: no runtime/phone performance test for generated references',
            'clock_and_seed': 'Generation request/completion timestamps recorded per image except first-call timing unavailable; tool exposes no seed; not deterministic',
            'metrics': metrics,
            'made_by': 'Codex via built-in image generation, independent original calls; contact sheet composed locally from unchanged originals',
            'cross_review': {'reviewer_agent': 'Claude', 'verdict': 'pending', 'notes': 'Automatic screening is not Claude review; no GPT substitute shortlist.'},
            'owner_pick': {'state': 'pending', 'options_shown': [f'{group}/001/contact-sheet.png (all 12, unshortlisted)'], 'picked': 'n/a: not picked', 'owner_note': 'n/a: no pick supplied', 'date': 'n/a: pending'}
        }
    })
    assert set(template) <= set(record) and set(template['look']) <= set(record['look'])
    DUMP(folder / 'record.json', record)

assert len(rows) == len(image_hashes) == 84
with (BASE / 'candidates.csv').open('w', newline='') as output:
    writer = csv.DictWriter(output, fieldnames=rows[0].keys(), lineterminator='\n')
    writer.writeheader()
    writer.writerows(rows)
DUMP(BASE / 'summary.json', {'packaged_at_utc': now, 'source_revision': SOURCE_REVISION, 'independent_calls': 84, 'original_images': 84, 'unique_original_hashes': len(image_hashes), 'original_image_bytes': all_image_bytes, 'contact_sheets': 7, 'groups': summaries, 'claude_review': 'pending', 'owner_pick': 'pending', 'status': 'generation complete; automatic exclusions retained; art review pending'})
print(json.dumps({'images': len(rows), 'unique_hashes': len(image_hashes), 'image_bytes': all_image_bytes, 'contact_sheets': 7, 'groups': summaries}, indent=2))

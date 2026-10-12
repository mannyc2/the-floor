"""Check triage behavior on known parallel lines, converging lines and accent counts."""
from pathlib import Path
import json
import sys
import screen
cv2, np = screen.cv2, screen.np
root = Path('work/spikes/look/references/control-check')
root.mkdir(parents=True, exist_ok=True)

def canvas():
    return np.full((1200, 1200, 3), 245, dtype=np.uint8)

coefficient = float(sys.argv[1]) if len(sys.argv) > 1 else .75
parallel = canvas()
convergent = canvas()
for y in range(130, 731, 60):
    cv2.line(parallel, (50, y), (1100, y + 400), (30, 30, 30), 2)
    cv2.line(convergent, (50, y), (1100, round(y * coefficient + 500)), (30, 30, 30), 2)
for x in range(160, 1041, 80):
    cv2.line(parallel, (x, 70), (x, 1120), (30, 30, 30), 2)
    cv2.line(convergent, (x, 70), (x, 1120), (30, 30, 30), 2)
reports = {'parallel': screen.perspective(parallel), 'convergent': screen.perspective(convergent)}
for count in (0, 1, 2):
    image = canvas()
    for index in range(count):
        cv2.rectangle(image, (100 + index * 450, 100), (300 + index * 450, 450), (240, 100, 10), -1)
    out = root / f'orange-{count}'
    out.mkdir(exist_ok=True)
    reports[f'orange-{count}'] = screen.orange(image, 'day', out)
checks = {
    'parallel_not_rejected': reports['parallel']['status'] == 'no_convergence_flag',
    'convergent_rejected': reports['convergent']['status'] == 'rejected_by_heuristic',
    'orange_counts_exact': all(reports[f'orange-{count}']['count'] == count for count in (0, 1, 2)),
}
result = {'coefficient': coefficient, 'purpose': 'Limited synthetic sanity controls; not validation on real reference-image geometry.', 'checks': checks, 'reports': reports}
(root / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(checks))
if not all(checks.values()):
    raise SystemExit(1)

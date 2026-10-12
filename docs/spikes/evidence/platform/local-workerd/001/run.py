"""Drive only the local workerd probe; never call a provider or remote binding."""
import concurrent.futures
import datetime
import json
from pathlib import Path
import sys
import time
import urllib.error
import urllib.request

base = 'http://127.0.0.1:8791'
phase = sys.argv[1]
output = Path(__file__).with_name(phase + '.json')

def request(path):
    started = time.monotonic()
    try:
        with urllib.request.urlopen(base + path, timeout=25) as response:
            status = response.status
            body = response.read().decode()
    except urllib.error.HTTPError as failure:
        status = failure.code
        body = failure.read().decode()
    return {'path': path, 'status': status, 'elapsed_ms': round((time.monotonic() - started) * 1000, 3), 'body': json.loads(body)}

record = {'phase': phase, 'executed_at_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'execution_target': 'local_workerd', 'responses': []}
if phase == 'before-restart':
    for route in ['/crypto', '/journal/read', '/journal/rollback', '/journal/nested', '/d1/initialize', '/d1/read', '/d1/batch']:
        record['responses'].append(request(route))
    with concurrent.futures.ThreadPoolExecutor(max_workers=20) as pool:
        record['concurrent_reservations'] = list(pool.map(lambda _: request('/journal/reserve'), range(20)))
    record['responses'].append(request('/journal/read'))
    record['responses'].append(request('/alarm/read'))
    record['responses'].append(request('/alarm/schedule'))
    # No request runs during this interval; only the Durable Object's alarm can increment its counter.
    start = time.monotonic()
    time.sleep(2)
    record['request_free_interval_ms'] = round((time.monotonic() - start) * 1000, 3)
    record['responses'].append(request('/alarm/read'))
elif phase == 'after-restart':
    for route in ['/crypto', '/journal/read', '/d1/read', '/alarm/read']:
        record['responses'].append(request(route))
else:
    raise ValueError('Unknown phase')
output.write_text(json.dumps(record, indent=2) + '\n')
print(json.dumps(record, indent=2))

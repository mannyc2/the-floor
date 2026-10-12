"""Local-only experiment driver; each execution requires a fresh attempt/state directory."""
from pathlib import Path
import concurrent.futures, datetime, hashlib, json, os, signal, socket, subprocess, time, urllib.error, urllib.request

root = Path.cwd()
base = root / 'work/spikes/platform'
state = base / 'final-002-state'
if state.exists():
    raise RuntimeError('Refusing to overwrite an existing attempt state')
revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()
source_files = [Path('package.json'), Path('bun.lock'), Path('tsconfig.json'), Path('.oxlintrc.json'), *Path('apps/floor/spikes/platform').glob('*')]
manifest = {str(p): {'bytes': p.stat().st_size, 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()} for p in source_files if p.is_file()}
process = None
logs = []

def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()

def request(path, method='GET'):
    start = time.time_ns() // 1000000
    try:
        with urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:8791' + path, method=method), timeout=30) as response:
            status, body = response.status, json.load(response)
    except urllib.error.HTTPError as error:
        status, body = error.code, json.load(error)
    return {'path': path, 'method': method, 'started_at_ms': start, 'finished_at_ms': time.time_ns() // 1000000, 'status': status, 'body': body}

def save(check, name, value):
    folder = base / check / ('001' if check == 'agent-interruption' else '002')
    folder.mkdir(parents=True, exist_ok=True)
    (folder / name).write_text(json.dumps(value, indent=2) + '\n')
    (folder / 'source-manifest.json').write_text(json.dumps({'git_revision': revision, 'files': manifest}, indent=2) + '\n')

def stop(hard=False):
    global process
    if process is None:
        return
    os.killpg(process.pid, signal.SIGKILL if hard else signal.SIGINT)
    process.wait(timeout=15)
    process = None
    for _ in range(30):
        with socket.socket() as probe:
            if probe.connect_ex(('127.0.0.1', 8791)) != 0:
                return
        time.sleep(0.1)
    raise RuntimeError('Local server survived process-group stop')

def start(bare, tag):
    global process
    folder = base / 'final-run-002'
    folder.mkdir(exist_ok=True)
    log = open(folder / (tag + '.log'), 'w')
    logs.append(log)
    config = 'wrangler.bare.jsonc' if bare else 'wrangler.jsonc'
    command = ['bun', 'x', '--no-install', 'wrangler', 'dev', '--local', '--config', 'apps/floor/spikes/platform/' + config, '--port', '8791', '--persist-to', str(state)]
    process = subprocess.Popen(command, stdout=log, stderr=subprocess.STDOUT, env={**os.environ, 'WRANGLER_SEND_METRICS': 'false'}, start_new_session=True)
    for _ in range(100):
        if process.poll() is not None:
            raise RuntimeError('Wrangler exited: ' + tag)
        try:
            if request('/crypto')['status'] == 200:
                return
        except (OSError, urllib.error.URLError):
            pass
        time.sleep(0.2)
    raise RuntimeError('Local server did not start')

def results(record):
    assert all(r['status'] == 200 and r['body'].get('ok', True) for r in record['responses']), record
    return {r['path']: r['body'].get('result', r['body']) for r in record['responses']}

try:
    start(True, 'bare-before')
    before = {'executed_at_utc': now(), 'responses': []}
    for path in ['/crypto', '/journal/read', '/journal/rollback', '/journal/nested', '/d1/initialize', '/d1/read', '/d1/batch']:
        before['responses'].append(request(path))
    with concurrent.futures.ThreadPoolExecutor(max_workers=20) as pool:
        before['concurrent_reservations'] = list(pool.map(lambda _: request('/journal/reserve'), range(20)))
    before['responses'] += [request('/journal/read'), request('/alarm/read'), request('/alarm/schedule')]
    quiet = time.monotonic(); time.sleep(2)
    before['request_free_interval_ms'] = round((time.monotonic() - quiet) * 1000)
    before['responses'].append(request('/alarm/read'))
    save('local-workerd', 'before-restart.json', before)
    pre = results(before)
    assert pre['/journal/rollback']['failureMarker'] == 'outer'
    assert 'UNIQUE constraint failed: probe_history.id' in pre['/d1/batch']['batchError']
    assert pre['/d1/batch']['interactiveTransactionSupported'] is False
    assert sum(r['body']['result']['changed'] for r in before['concurrent_reservations']) == 1
    stop()
    start(True, 'bare-after')
    after = {'executed_at_utc': now(), 'responses': [request(p) for p in ['/crypto', '/journal/read', '/d1/read', '/alarm/read']]}
    save('local-workerd', 'after-restart.json', after)
    post = results(after)
    assert pre['/journal/read'] == post['/journal/read'] == {'rows': [{'id': 'parent', 'value': 11}, {'id': 'persisted', 'value': 8}], 'migrations': 1}
    assert pre['/d1/read'] == post['/d1/read'] == {'rows': [{'id': 'persisted', 'value': 13}]}
    assert pre['/alarm/read'] == post['/alarm/read'] == {'scheduled': True, 'wakeCount': 1, 'alarmPending': False}
    assert post['/crypto']['processGlobalPresent'] is False and post['/crypto']['bunGlobalPresent'] is False
    stop()

    start(False, 'node-before')
    launch = {'executed_at_utc': now(), 'responses': [request('/crypto'), request('/launch')]}
    save('launch-construction', 'result.json', launch)
    constructed = results(launch)['/launch']
    for name in ['meteora', 'doppler']:
        item = constructed[name]['result']
        assert item['sha256'] == item['repeatSha256'] and item['byteLength'] > 0
        assert item['attachedSignatures'] == 0 and item['negativeControlRejected'] and item['negativeControlRequests'] == 1
        assert item['rejectedConstructionRequests'] == 0
    assert constructed['meteora']['result']['syntheticReads'] == 2
    assert constructed['doppler']['result']['constructionTransportRequests'] == 0
    assert constructed['doppler']['result']['requiredSigners']['_tag'] == 'None'
    upgrade = {'executed_at_utc': now(), 'responses': [request(p) for p in ['/crypto', '/d1/migrate', '/d1/migrate', '/d1/read']]}
    save('storage-upgrade', 'result.json', upgrade)
    results(upgrade)
    assert upgrade['responses'][1]['body']['result']['fromVersion'] == 0
    assert upgrade['responses'][2]['body']['result']['fromVersion'] == 2

    thread, key = 'local-agent-alarm-002', 'local-submit-002'
    agent = {'executed_at_utc': now(), 'responses': [request(f'/agent/submit?thread={thread}&key={key}', 'POST')]}
    quiet = time.monotonic(); time.sleep(5)
    agent['request_free_interval_ms'] = round((time.monotonic() - quiet) * 1000)
    agent['responses'] += [request(f'/agent/snapshot?thread={thread}'), request(f'/agent/read?thread={thread}')]
    save('agent-alarm', 'before-restart.json', agent)
    results(agent)
    snapshot = agent['responses'][1]['body']
    records = agent['responses'][2]['body']['result']
    assert snapshot['invocations'] == 1 and not snapshot['nativeAlarmPending']
    assert snapshot['completedAtMillis'][0] < agent['responses'][1]['started_at_ms']
    assert len([r for r in records if r['kind'] == 'SubmissionSettled' and r['settlementOutcome']['value'] == 'completed']) == 1
    assert 'synthetic-alarm-completion-v1' in json.dumps(records)
    stop()
    start(False, 'node-after')
    resumed = {'executed_at_utc': now(), 'responses': [request(f'/agent/snapshot?thread={thread}'), request(f'/agent/read?thread={thread}'), request(f'/agent/submit?thread={thread}&key={key}', 'POST'), request('/d1/migrate')]}
    save('agent-alarm', 'after-restart.json', resumed)
    results(resumed)
    assert resumed['responses'][0]['body']['completedAtMillis'] == snapshot['completedAtMillis']
    assert resumed['responses'][1]['body']['result'] == records
    assert resumed['responses'][2]['body']['result'] == agent['responses'][0]['body']['result']
    assert resumed['responses'][3]['body']['result']['fromVersion'] == 2
    save('storage-upgrade', 'after-restart.json', {'executed_at_utc': now(), 'responses': [resumed['responses'][3]]})

    interrupted_thread = 'local-agent-interruption-002'
    interrupted = {'executed_at_utc': now(), 'responses': [request(f'/agent/submit?thread={interrupted_thread}&key=interruption-002', 'POST')]}
    time.sleep(0.25)
    interrupted['responses'].append(request(f'/agent/snapshot?thread={interrupted_thread}'))
    interrupted['kill_at_ms'] = time.time_ns() // 1000000
    save('agent-interruption', 'before-kill.json', interrupted)
    assert interrupted['responses'][1]['body']['invocations'] >= 1 and not interrupted['responses'][1]['body']['completedAtMillis']
    stop(True)
    start(False, 'node-recovery')
    quiet = time.monotonic(); time.sleep(5)
    recovered = {'executed_at_utc': now(), 'request_free_interval_ms': round((time.monotonic() - quiet) * 1000), 'responses': [request(f'/agent/snapshot?thread={interrupted_thread}'), request(f'/agent/read?thread={interrupted_thread}')]}
    save('agent-interruption', 'after-restart.json', recovered)
    results(recovered)
    recovery_snapshot = recovered['responses'][0]['body']
    recovery_records = recovered['responses'][1]['body']['result']
    assert recovery_snapshot['completedAtMillis'] and recovery_snapshot['completedAtMillis'][-1] < recovered['responses'][0]['started_at_ms']
    assert len([r for r in recovery_records if r['kind'] == 'SubmissionSettled' and r['settlementOutcome']['value'] == 'completed']) == 1
    assert 'synthetic-alarm-completion-v1' in json.dumps(recovery_records)
    save('final-run', 'summary.json', {'executed_at_utc': now(), 'revision': revision, 'status': 'pass', 'checks': ['bare workerd storage/crypto/CAS/restart', 'SDK synthetic unsigned construction', 'D1 upgrade and restart', 'Yielded native alarm and completed restart/idempotency', 'Yielded interrupted turn recovery']})
    print('PASS: frozen-source local runtime checks and interrupted native-agent recovery')
finally:
    stop()
    for log in logs:
        log.close()

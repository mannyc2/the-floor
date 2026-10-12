from __future__ import annotations
import collections, hashlib, io, json, pathlib, re, subprocess, sys, tarfile, zipfile
from pypdf import PdfReader
ROOT=pathlib.Path(sys.argv[1]).resolve()
SNAPSHOT=json.loads(pathlib.Path(sys.argv[2]).read_text())
patterns={
 'private-key':r'-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----',
 'github-token':r'(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,})',
 'openai-token':r'\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}',
 'aws-access-key':r'\b(?:AKIA|ASIA)[A-Z0-9]{16}\b',
 'slack-token':r'\bxox[baprs]-[A-Za-z0-9-]{20,}',
 'stripe-live-key':r'\b(?:sk|rk)_live_[A-Za-z0-9]{20,}',
 'google-api-key':r'\bAIza[A-Za-z0-9_-]{35}\b',
 'jwt':r'\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}',
 'url-credentials':r'https?://[^\s/:@]{2,}:[^\s/@]{5,}@',
 'assigned-secret':r'''(?im)(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|password|secret[_-]?key|signer[_-]?token)\s*["']?\s*[:=]\s*["']([A-Za-z0-9_+/=-]{16,})["']''',
}
compiled={name:re.compile(pattern) for name,pattern in patterns.items()}
rows=[];counts=collections.Counter(); zip_entries=[]; tar_entries=[]; png_meta=[]; pdfs=[]; binary_files=[]
cafe_hashes={}
for row in subprocess.check_output(['git','ls-tree','-rl',SNAPSHOT['refs']['refs/heads/main'],'reference/cafe-reference'],cwd=ROOT,text=True).splitlines():
    meta,path=row.split('\t',1);parts=meta.split()
    if int(parts[3]) < 100:continue
    data=subprocess.check_output(['git','cat-file','blob',parts[2]],cwd=ROOT)
    cafe_hashes.setdefault(hashlib.sha256(data).hexdigest(),[]).append(path)
cafe_copies=[]
def scan(data: bytes,path: str,oid: str):
    if not path.startswith('reference/cafe-reference/') and hashlib.sha256(data).hexdigest() in cafe_hashes:
        cafe_copies.append({'path':path,'oid':oid,'bytes':len(data),'cafe_sources':cafe_hashes[hashlib.sha256(data).hexdigest()]})
    counts['blob_bytes']+=len(data)
    if data[:2]==b'\x1f\x8b':
        try:
            archive=tarfile.open(fileobj=io.BytesIO(data),mode='r:gz')
            for entry in archive.getmembers():
                if not entry.isfile():continue
                tar_entries.append({'archive':path,'path':entry.name,'bytes':entry.size})
                if entry.size>20_000_000: counts['tar_oversize_entries']+=1; continue
                source=archive.extractfile(entry)
                if source:scan(source.read(),path+'!'+entry.name,oid)
        except tarfile.TarError:counts['invalid_tar']+=1
        return
    if data[:4]==b'PK\x03\x04':
        try:
            archive=zipfile.ZipFile(io.BytesIO(data))
            for entry in archive.infolist():
                if entry.is_dir():continue
                zip_entries.append({'archive':path,'path':entry.filename,'bytes':entry.file_size})
                if entry.file_size>20_000_000: counts['zip_oversize_entries']+=1; continue
                scan(archive.read(entry),path+'!'+entry.filename,oid)
        except zipfile.BadZipFile:counts['invalid_zip']+=1
        return
    if data.startswith(b'%PDF-'):
        pdf=PdfReader(io.BytesIO(data))
        body='\n'.join(page.extract_text() or '' for page in pdf.pages)
        metadata=str(pdf.metadata or {})
        pdfs.append({'path':path,'pages':len(pdf.pages),'text_chars':len(body),'metadata_keys':list(pdf.metadata or {})})
        scan((body+'\n'+metadata).encode(),path+' [extracted PDF text and metadata]',oid)
        return
    if data.startswith(b'\x89PNG\r\n\x1a\n'):
        offset=8; keys=[]
        while offset+12<=len(data):
            size=int.from_bytes(data[offset:offset+4],'big');kind=data[offset+4:offset+8];chunk=data[offset+8:offset+8+size]
            if kind in [b'tEXt',b'iTXt',b'zTXt',b'eXIf']:
                keys.append({'chunk':kind.decode(),'keyword':chunk.split(b'\0',1)[0][:100].decode('utf8','replace'),'bytes':size})
                for name,regex in compiled.items():
                    if regex.search(chunk.decode('latin1')):rows.append({'path':path,'oid':oid,'category':name,'line':'PNG metadata','value':'REDACTED'})
            offset+=12+size
        png_meta.append({'path':path,'metadata':keys})
        counts['png']+=1;return
    if b'\0' in data[:8000]:counts['binary_skipped']+=1;binary_files.append({'path':path,'bytes':len(data),'reason':'NUL in first8000 bytes'});return
    try:body=data.decode('utf8')
    except UnicodeDecodeError:counts['non_utf8_skipped']+=1;binary_files.append({'path':path,'bytes':len(data),'reason':'not UTF8'});return
    counts['text_blobs']+=1
    for name,regex in compiled.items():
        for match in regex.finditer(body):
            rows.append({'path':path,'oid':oid,'category':name,'line':body.count('\n',0,match.start())+1,'matched_chars':len(match.group()),'value':'REDACTED'})
    if '/Users/' in body:counts['text_blobs_with_local_paths']+=1
objects=subprocess.check_output(['git','rev-list','--objects',*SNAPSHOT['revisions']],cwd=ROOT,text=True).splitlines()
proc=subprocess.Popen(['git','cat-file','--batch'],cwd=ROOT,stdin=subprocess.PIPE,stdout=subprocess.PIPE)
assert proc.stdin and proc.stdout
for row in objects:
    oid,_,path=row.partition(' ')
    proc.stdin.write((oid+'\n').encode());proc.stdin.flush()
    header=proc.stdout.readline().decode().split();size=int(header[2]);data=proc.stdout.read(size);assert proc.stdout.read(1)==b'\n'
    counts['git_objects']+=1
    if header[1]=='blob':counts['git_blobs']+=1;scan(data,path,oid)
proc.stdin.close();proc.wait()
report={'scope':'all blobs reachable from the immutable snapshot.json revisions; ZIP/tar/tgz contents recursively; PNG metadata keywords; read-only', 'counts':dict(counts),'findings':rows,'zip_entries':zip_entries,'tar_entries':tar_entries,'png_metadata':png_meta,'cafe_exact_copies':cafe_copies,'pdfs':pdfs,'unscanned_binary_text':binary_files}
out=pathlib.Path(sys.argv[3]);out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'report':str(out),'counts':dict(counts),'findings':rows,'zip_entries':len(zip_entries),'tar_entries':len(tar_entries),'cafe_exact_copies':cafe_copies,'png_metadata_keys':sorted({m['keyword'] for p in png_meta for m in p['metadata']})},indent=2))

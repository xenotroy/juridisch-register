"""Archive supporting public historical sources; never infer unsupported exact dates."""
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
import urllib.request
from download import ROOT

def main():
    lesson=json.loads((ROOT/'data/editorial/lesson-timeline.json').read_text())
    index=json.loads((ROOT/'data/source-index/publications.json').read_text())
    out=ROOT/'data/source-index/lesson-sources.json'
    previous=json.loads(out.read_text()) if out.exists() else {}
    report={}
    for sid,s in lesson['sources'].items():
        if sid in previous and previous[sid].get('url')==s['url']:
            report[sid]=previous[sid]
            continue
        if s.get('publication_id') in index:
            report[sid]=index[s['publication_id']]
            continue
        try:
            with urllib.request.urlopen(urllib.request.Request(s['url'],headers={'User-Agent':'VaultTek-legal-register/0.1'}),timeout=30) as r:
                data=r.read();mime=r.headers.get('Content-Type','');url=r.url
            if not data:raise ValueError('Empty response')
            is_pdf=data.startswith(b'%PDF')
            if 'pdf' in s['url'] and not is_pdf:raise ValueError('Expected PDF, received another format')
            sha=hashlib.sha256(data).hexdigest();p=ROOT/'data/raw/lesson'/sid/(sha+('.pdf' if is_pdf else '.html'))
            p.parent.mkdir(parents=True,exist_ok=True)
            if not p.exists():p.write_bytes(data)
            meta={'url':s['url'],'resolved_url':url,'file':str(p.relative_to(ROOT)),'sha256':sha,'bytes':len(data),'content_type':mime,'retrieved_at':datetime.now(timezone.utc).isoformat()}
            mp=p.with_suffix('.source.json')
            if not mp.exists():mp.write_text(json.dumps(meta,indent=2)+'\n')
            report[sid]=meta
        except Exception as e:
            report[sid]={'url':s['url'],'error':str(e),'status':'not_archived'}
        print(sid,report[sid].get('bytes',report[sid].get('error')),flush=True)
    out.write_text(json.dumps(report,indent=2)+'\n')

if __name__=='__main__':main()

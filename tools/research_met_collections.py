"""Cache Open Access botanical and modern-art records from The Met."""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import json
import subprocess
import urllib.parse

ROOT=Path(__file__).resolve().parents[1]
DEST=ROOT/'design'/'artwork-research'

def download(url,path):
    if not path.exists():
        subprocess.run(['curl','--fail','--location','--silent','--show-error','--retry','2','--max-time','40',url,'-o',str(path)],check=True)
    return json.loads(path.read_text())

def record(oid):
    return download('https://collectionapi.metmuseum.org/public/collection/v1/objects/'+str(oid),DEST/f'met-{oid}.json')

def main():
    queries=[('botanical','Temple of Flora',True),('abstract','Kandinsky',False),('abstract','Klee',False),('abstract','Gris',False),('abstract','Doesburg',False)]
    results={}
    for category,term,title in queries:
        params={'q':term,'hasImages':'true','limit':45,'title':'true'} if title else {'q':term,'hasImages':'true','limit':35,'artistOrCulture':'true'}
        data=download('https://collectionapi.metmuseum.org/public/collection/v1.1/search?'+urllib.parse.urlencode(params),DEST/('met-search-'+term.lower().replace(' ','-')+'.json'))
        ids=data.get('objectIDs') or []
        print(term+': checking '+str(len(ids))+' records',flush=True)
        for item in ThreadPoolExecutor(max_workers=3).map(record,ids):
            if item.get('isPublicDomain') and item.get('primaryImage'):
                results[item['objectID']]=item
                print(json.dumps({key:item.get(key) for key in ('objectID','title','artistDisplayName','objectDate','classification')},ensure_ascii=False),flush=True)
    (DEST/'met-candidates.json').write_text(json.dumps(list(results.values()),indent=2)+'\n')

if __name__=='__main__':main()

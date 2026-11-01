"""Cache museum catalogue search results for manual collection curation."""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import json
import subprocess
import time
import urllib.parse

ROOT=Path(__file__).resolve().parents[1]
DEST=ROOT/'design'/'artwork-research'
SEARCHES={
 'light':['Claude Monet','Camille Pissarro','Alfred Sisley','Renoir','Seurat','Van Gogh','Caillebotte'],
 'japan':['Hiroshige','Hokusai'],
 'botanical':['Temple of Flora','Hoytema'],
 'abstract':['Kandinsky','Mondrian','Theo van Doesburg','Franz Marc','Juan Gris','Robert Delaunay','Morgan Russell'],
}

def fetch(term):
    path=DEST/('search-'+term.lower().replace(' ','-')+'.json')
    if not path.exists():
        query=urllib.parse.urlencode({'q':term,'limit':50,'fields':'id,title,artist_title,artist_display,date_display,image_id,is_public_domain,artwork_type_title,style_titles'})
        subprocess.run(['curl','--fail','--location','--silent','--show-error','--retry','2','--max-time','45','--user-agent','Mozilla/5.0','--referer','https://www.artic.edu/','https://api.artic.edu/api/v1/artworks/search?'+query,'-o',str(path)],check=True)
        time.sleep(1)
    return term,json.loads(path.read_text())

def main():
    DEST.mkdir(parents=True,exist_ok=True)
    terms=[term for values in SEARCHES.values() for term in values]
    found=dict(ThreadPoolExecutor(max_workers=2).map(fetch,terms))
    for category,terms in SEARCHES.items():
        records={}
        for term in terms:
            for item in found[term].get('data',[]):
                if item.get('is_public_domain') and item.get('image_id'):records[item['id']]=item
        (DEST/(category+'-candidates.json')).write_text(json.dumps(list(records.values()),indent=2)+'\n')
        print(category+': '+str(len(records))+' public-domain images',flush=True)
        for item in list(records.values())[:12]:print(json.dumps({key:item.get(key) for key in ('id','title','artist_title','date_display','artwork_type_title')},ensure_ascii=False),flush=True)

if __name__=='__main__':main()

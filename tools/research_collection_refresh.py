"""Bounded metadata research for the 0.14 included-art refresh; no app runtime work."""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import json,urllib.parse,urllib.request,time
ROOT=Path(__file__).resolve().parents[1]
DEST=ROOT/'design/artwork-research'
def get(task):
 name,base,query=task;path=DEST/(name+'.json')
 url=base+'?'+urllib.parse.urlencode(query)
 request=urllib.request.Request(url,headers={'User-Agent':'SART-Gallery-Curation/0.14 (personal local gallery)'})
 for attempt in range(3):
  try:
   with urllib.request.urlopen(request,timeout=35) as r:data=r.read(5*1024*1024+1)
   if len(data)>5*1024*1024:raise ValueError('Oversized metadata')
   payload=json.loads(data);path.write_text(json.dumps(payload,ensure_ascii=False,indent=2)+'\n');print(name,len(payload.get('data',payload.get('query',{}).get('pages',{}))),flush=True);return
  except Exception:
   if attempt==2:raise
   time.sleep(attempt+1)
def main():
 tasks=[]
 for name,query in [('china-landscapes',{'q':'landscape','culture':'China','type':'Painting'}),('china-albums',{'q':'album','culture':'China','type':'Painting'}),('china-birds-flowers',{'q':'flowers','culture':'China','type':'Painting'}),('botanical-ferns',{'q':'fern'}),('botanical-fruit',{'q':'fruit','type':'Print'}),('botanical-plants',{'q':'botanical','type':'Print'})]:
  tasks.append(('cma-refresh-'+name,'https://openaccess-api.clevelandart.org/api/artworks/',{'cc0':'1','has_image':'1','limit':'60','fields':'id,title,creators,creation_date,url,share_license_status,images,culture,type,technique',**query}))
 for term in ['Vasily Kandinsky','Piet Mondrian','Paul Klee','Kazimir Malevich','Robert Delaunay','Lyubov Popova']:
  tasks.append(('nga-refresh-'+term.lower().replace(' ','-'),'https://commons.wikimedia.org/w/api.php',{'action':'query','format':'json','generator':'search','gsrsearch':'('+term+') incategory:"Images from the National Gallery of Art" filetype:bitmap','gsrnamespace':'6','gsrlimit':'30','prop':'imageinfo','iiprop':'url|size|mime|extmetadata','iiurlwidth':'600','iiurlheight':'420','iiextmetadatalanguage':'en','iiextmetadatafilter':'ObjectName|Artist|DateTimeOriginal|LicenseShortName|LicenseUrl|Copyrighted|Credit'}))
 tasks.append(('search-refresh-flower-paintings','https://api.artic.edu/api/v1/artworks/search',{'q':'flowers still life','limit':'100','fields':'id,title,artist_title,artist_display,date_display,image_id,is_public_domain,artwork_type_title,style_titles,place_of_origin'}))
 list(ThreadPoolExecutor(max_workers=2).map(get,tasks))
if __name__=='__main__':main()

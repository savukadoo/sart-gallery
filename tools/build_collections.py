"""Build the curated, offline museum-art collection assets from cached records."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import hashlib
import json
import subprocess
import os
import shutil
from datetime import date
from PIL import Image, ImageOps, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
RESEARCH = ROOT/'design/artwork-research'
ASSETS = ROOT/'app/assets'
CACHE = ROOT/'.local/art-source'
POLICIES = {
    'aic': 'https://www.artic.edu/open-access/open-access-images',
    'cma': 'https://www.clevelandart.org/open-access',
    'artvee': 'https://artvee.com/terms-of-service/',
}
PREVIOUS = {a['id']: a for a in json.loads((ASSETS/'provenance.json').read_text()).get('artworks', [])} if (ASSETS/'provenance.json').exists() else {}


def museum_records():
    records = {}
    for path in sorted(RESEARCH.glob('search-*.json')):
        for item in json.loads(path.read_text()).get('data', []):
            if item.get('is_public_domain') and item.get('image_id'):
                records['aic', item['id']] = {
                    'title': item['title'], 'artist': item.get('artist_title') or item.get('artist_display'),
                    'date': item.get('date_display', ''), 'source': f"https://www.artic.edu/artworks/{item['id']}",
                    'originalUrl': f"https://www.artic.edu/iiif/2/{item['image_id']}/full/1686,/0/default.jpg",
                    'imageId': item['image_id'], 'museum': 'Art Institute of Chicago',
                    'museumCulture': [item.get('place_of_origin') or ''],
                    'rights': 'CC0 public-domain museum image',
                }
    for path in sorted(RESEARCH.glob('cma-*.json')):
        for item in json.loads(path.read_text()).get('data', []):
            if item.get('share_license_status') == 'CC0' and item.get('images', {}).get('web'):
                creators = [c['description'] for c in item.get('creators', []) if c.get('role') == 'artist']
                if not creators:
                    creators = [c['description'] for c in item.get('creators', [])]
                records['cma', item['id']] = {
                    'title': item['title'], 'artist': '; '.join(c.split(' (')[0] for c in creators) or 'Artist unknown',
                    'date': item.get('creation_date', ''), 'source': item['url'],
                    'originalUrl': item['images'].get('print', item['images']['web'])['url'],
                    'imageId': item['images']['web']['url'], 'museum': 'Cleveland Museum of Art',
                    'museumCulture': item.get('culture', []),
                    'rights': 'CC0 public-domain museum image',
                }
    artvee = RESEARCH/'artvee-selected-014.json'
    if artvee.exists():
        for item in json.loads(artvee.read_text())['data']:
            if item.get('publicDomain') is not True or item.get('rights') != 'Public domain (Artvee)':
                raise ValueError('Unconfirmed Artvee rights')
            records['artvee', item['providerId']] = {
                'title': item['title'], 'artist': item['artist'], 'date': item['date'],
                'source': item['source'], 'originalUrl': item['image'].split('?')[0],
                'imageId': item['image'].split('?')[0], 'museum': 'Artvee',
                'museumCulture': [], 'rights': 'Public domain (Artvee)',
                'retrievalNote': 'Free Standard JPEG resolved from the public artwork page at build time.',
            }
    return records


def asset(task):
    provider, oid, group, record = task
    stem = str(oid) if provider == 'aic' else f'{provider}-{oid}'
    photo_id = f'demo-{oid}' if provider == 'aic' else f'{provider}-{oid}'
    original = CACHE/f'{stem}.jpg'
    previous = PREVIOUS.get(photo_id)
    retained = previous and previous['imageId'] == record['imageId'] and all(
        (ROOT/'app'/previous[key]).is_file() and hashlib.sha256((ROOT/'app'/previous[key]).read_bytes()).hexdigest() == previous[hash_key]
        for key, hash_key in [('url','sha256'),('thumbnail','thumbnailSha256')])
    # Retained works keep their exact image bytes; IDs never move to different art.
    if retained:
        original_size, display_size = previous['originalDimensions'], previous['displayDimensions']
    else:
        original_size = display_size = None
    if not retained and not original.exists():
        temp = original.with_suffix('.download')
        if provider == 'artvee':
            node = os.environ.get('SART_NODE') or shutil.which('node')
            if not node:
                raise RuntimeError('Set SART_NODE to Node.js to resolve free Artvee images.')
            subprocess.run([node, str(ROOT/'tools/download_artvee_image.mjs'), str(oid), str(temp)], check=True)
        else:
            subprocess.run(['curl', '--fail', '--location', '--silent', '--show-error', '--retry', '2',
                        '--continue-at', '-', '--max-time', '240', '--user-agent', 'Mozilla/5.0', '--referer', record['source'],
                        record['originalUrl'], '-o', str(temp)], check=True)
        with Image.open(temp) as image:
            image.verify()
        temp.replace(original)
    if not retained:
        with Image.open(original) as opened:
            image = ImageOps.exif_transpose(opened).convert('RGB')
            original_size = image.size
            image.thumbnail((1920, 1920), Image.Resampling.LANCZOS)
            image.save(ASSETS/f'{stem}.jpg', quality=88, optimize=True, progressive=True, subsampling=0)
            display_size = image.size
            image.thumbnail((640, 480), Image.Resampling.LANCZOS)
            image.save(ASSETS/f'{stem}-thumb.jpg', quality=80, optimize=True, progressive=True)
    photo = {'id': photo_id,
             'title': record.get('displayTitle', record['title']), 'artist': record['artist'], 'date': record['date'],
             'url': f'assets/{stem}.jpg', 'thumbnail': f'assets/{stem}-thumb.jpg',
             'source': record['source'], 'publicDomain': True, 'collectionId': group}
    if record.get('country'):
        photo['country'] = record['country']
    provenance = {**photo, 'catalogueTitle': record['title'], 'provider': provider, 'museum': record['museum'], 'objectId': oid,
                  'imageId': record['imageId'], 'originalUrl': record['originalUrl'],
                  'rights': record['rights'], 'policy': POLICIES[provider],
                  'museumCulture': record.get('museumCulture', []),
                  'originalDimensions': original_size, 'displayDimensions': display_size,
                  'sha256': hashlib.sha256((ASSETS/f'{stem}.jpg').read_bytes()).hexdigest(),
                  'thumbnailSha256': hashlib.sha256((ASSETS/f'{stem}-thumb.jpg').read_bytes()).hexdigest()}
    if record.get('retrievalNote'):
        provenance['retrievalNote'] = record['retrievalNote']
    print(f'{group}: {photo["title"]}', flush=True)
    return photo, provenance


def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    curation = json.loads((ROOT/'design/collections-curation.json').read_text())
    records = museum_records()
    tasks = [(item['provider'], item['id'], group['id'], {**records[item['provider'], item['id']],
              'displayTitle': item.get('title', records[item['provider'], item['id']]['title']),
              'country': item.get('country')})
             for group in curation for item in group['artworks']]
    assert len(curation) == 4 and all(len(g['artworks']) == 15 for g in curation)
    assert len({(p, i) for p, i, _, _ in tasks}) == 60
    assert len({r['imageId'] for _, _, _, r in tasks}) == 60
    results = list(ThreadPoolExecutor(max_workers=3).map(asset, tasks))
    photos, provenance = zip(*results)
    groups = [{key: value for key, value in group.items() if key != 'artworks'} for group in curation]
    (ASSETS/'catalog.mjs').write_text('export const DEMO_PHOTOS = '+json.dumps(photos, ensure_ascii=False, indent=2)+';\n\nexport const BUILTIN_COLLECTIONS = '+json.dumps(groups, ensure_ascii=False, indent=2)+';\n')
    (ASSETS/'provenance.json').write_text(json.dumps({
        'checked': date.today().isoformat(), 'collections': groups,
        'processing': 'Source reproductions resized proportionally to a maximum 1920-pixel long edge, JPEG quality 88. No creative changes or crops; thumbnails maximum 640 x 480.',
        'artworks': provenance}, ensure_ascii=False, indent=2)+'\n')
    # Retire replaced images into the private build cache, not the TV widget.
    expected = {Path(p[key]).name for p in photos for key in ('url','thumbnail')}
    retired = ROOT/'.local/retired-collection-assets-0.13.0'
    for path in ASSETS.glob('*.jpg'):
        if path.name not in expected:
            retired.mkdir(parents=True, exist_ok=True)
            shutil.move(str(path),str(retired/path.name))
    sheets = ROOT/'.local/qa/collections'
    sheets.mkdir(parents=True, exist_ok=True)
    for group in groups:
        sheet = Image.new('RGB', (1500, 1020), '#181d24')
        draw = ImageDraw.Draw(sheet)
        draw.text((20, 10), group['name'], fill='white')
        for index, photo in enumerate(p for p in photos if p['collectionId'] == group['id']):
            image = Image.open(ROOT/'app'/photo['thumbnail'])
            image.thumbnail((280, 260))
            x, y = (index % 5)*300+10, (index // 5)*325+40
            sheet.paste(image, (x+(280-image.width)//2, y+(260-image.height)//2))
            draw.text((x, y+265), photo['title'][:39], fill='white')
            draw.text((x, y+280), photo['artist'][:39], fill='#c0c7cf')
        sheet.save(sheets/(group['id']+'.jpg'), quality=88)
    total = sum((ROOT/'app'/p[k]).stat().st_size for p in photos for k in ('url', 'thumbnail'))
    print(json.dumps({'collections': len(groups), 'artworks': len(photos), 'imageBytes': total, 'imageMB': round(total/1_000_000, 2)}, indent=2))


if __name__ == '__main__':
    main()

"""Bundle app source and the unsigned widget, excluding local/private state."""
from pathlib import Path
import hashlib
import json
import zipfile

ROOT=Path(__file__).resolve().parents[1]
DIST=ROOT/'dist'
VERSION=json.loads((ROOT/'package.json').read_text())['version']
target=DIST/f'SART-Gallery-{VERSION}-development.zip'
from public_files import public_files
from check_public_privacy import check_privacy
privacy=check_privacy(ROOT)
files=public_files(ROOT)
files.extend(DIST/name for name in (f'SART-Gallery-{VERSION}-unsigned.wgt','build.json'))
with zipfile.ZipFile(target,'w',zipfile.ZIP_DEFLATED) as archive:
    for file in sorted(files):
        if file.suffix in {'.p12','.pem','.key','.sqlite3'} or '.local' in file.parts:
            raise RuntimeError('Private state must not be included in a development bundle')
        relative=file.relative_to(ROOT).as_posix()
        archive.write(file,'SART Gallery/'+relative)
with zipfile.ZipFile(target) as archive:
    assert archive.testzip() is None
    names=archive.namelist()
    assert all('/.local/' not in name and not name.endswith(('.p12','.pem','.key','.sqlite3')) for name in names)
report={'file':target.name,'bytes':target.stat().st_size,'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),
        'license':'AGPL-3.0-only','privacyCheck':privacy,'signed':False,'privateStateIncluded':False,'entries':len(names)}
(DIST/'development-bundle.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))

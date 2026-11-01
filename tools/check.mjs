import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {createHash} from 'node:crypto';
import {parse} from 'acorn';
const root=path.resolve(import.meta.dirname,'..');
for(const file of ['app/uploads-manager.mjs','app/native-art-library.mjs','app/native-art-manager.mjs','app/native-art.mjs','app/native-art-worker.mjs','app/native-art-tls.mjs'])parse(fs.readFileSync(path.join(root,file),'utf8'),{ecmaVersion:2020,sourceType:'module'});
const files=['app/compat.mjs','app/core.mjs','app/storage.mjs','app/platform.mjs','app/slideshow.mjs','app/find-art.mjs','app/find-art-batch.mjs','app/main.mjs','app/mobile-shared.mjs','app/mobile-identity.mjs','app/mobile-tls.mjs','app/mobile-host.mjs','app/mobile-http.mjs','app/mobile-setup.mjs','app/mobile-native.mjs','mobile/mobile.mjs','companion/manage.mjs','dist/widget/bundle.js','dist/widget/mobile-worker.js'];
for(const file of files){const result=spawnSync(process.execPath,['--check',path.join(root,file)],{encoding:'utf8'});if(result.status!==0){process.stderr.write(result.stderr);process.exit(1);}}
const widget=path.join(root,'dist/widget');
const config=fs.readFileSync(path.join(widget,'config.xml'),'utf8');
if(!config.includes('SartGal001.Gallery'))throw new Error('Unexpected app ID');
if(!fs.readFileSync(path.join(widget,'index.html'),'utf8').includes('bundle.js'))throw new Error('Bundle is not loaded');
for(const file of ['index.html','security-policy.js','bundle.js','styles.css','icon.png','runtime-config.js','LICENSE','NOTICE','ARTWORK-RIGHTS.md','LICENSES/provenance.json'])if(!fs.existsSync(path.join(widget,file)))throw new Error('Missing '+file);
if(JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).license!=='AGPL-3.0-only')throw new Error('Unexpected project licence');
const notices=JSON.parse(fs.readFileSync(path.join(widget,'LICENSES/provenance.json'),'utf8'));
for(const notice of notices.files){
  const bytes=fs.readFileSync(path.join(widget,'LICENSES',notice.file));
  if(createHash('sha256').update(bytes).digest('hex')!==notice.sha256)throw new Error('Third-party notice hash mismatch: '+notice.file);
}
const page=fs.readFileSync(path.join(widget,'index.html'),'utf8');
if(page.indexOf('security-policy.js')<0||page.indexOf('security-policy.js')>page.indexOf('bundle.js'))throw new Error('Security policy must load before the app');
for(const file of ['app/styles.css','dist/widget/styles.css']){
  const css=fs.readFileSync(path.join(root,file),'utf8');
  if(/(?:justify-content|align-items)\s*:\s*(?:start|end)\b/.test(css))throw new Error('Use flex-start/flex-end alignment supported by the Frame browser: '+file);
}
if(!config.includes('required_version="6.5"'))throw new Error('Shared package must keep the Tizen 6.5 minimum');
for(const file of fs.readdirSync(widget).filter(name=>name.endsWith('.js')))parse(fs.readFileSync(path.join(widget,file),'utf8'),{ecmaVersion:2020,sourceType:'script'});
const bundle=fs.readFileSync(path.join(widget,'bundle.js'),'utf8');
if(/^import /m.test(bundle)||/^export /m.test(bundle))throw new Error('Unbundled module');
if(/google-analytics|googletagmanager|samsungads|samsungacr|cdn\.jsdelivr|unpkg\.com/i.test(bundle))throw new Error('Unexpected external service');
console.log('JavaScript syntax, ES2020 baseline, Tizen 6.5 minimum, self-contained widget and preserved licence checks passed.');

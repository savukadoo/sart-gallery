import {hasOwn} from './compat.mjs';
export const MAX_PHOTO_BYTES = 12 * 1024 * 1024;
export const MAX_LIBRARY_BYTES = 200 * 1024 * 1024;
export const DEFAULTS = Object.freeze({ interval: 300, order: 'sequence', transition:'crossfade', transitionDuration:1, motion:'off', resume: false, brightness: 1, contrast:1, matte: 'paper', fit: 'cover', frame:'none', matStyle:'flat' });
export const TRANSITIONS = Object.freeze({none:'None',crossfade:'Crossfade',dark:'Fade through dark',slide:'Slide'});
export const MATTES = Object.freeze({ paper:'#e8e4dc',antique:'#bca98b',linen:'#c6b9a2',taupe:'#817568',stone:'#777b78',slate:'#46505a',white:'#faf9f5',ink:'#191b20',none:'#070809' });
export const MAT_NAMES = Object.freeze({paper:'Warm paper',antique:'Antique paper',linen:'Natural linen',taupe:'Warm taupe',stone:'Soft stone',slate:'Slate',white:'Soft white',ink:'Charcoal',none:'No mat'});
export const MAT_STYLES = Object.freeze({flat:'Flat',bevel:'Bevelled thin','bevel-thick':'Bevelled thick'});
export const FRAMES = Object.freeze({none:'No frame',white:'Gallery white',teak:'Natural teak',walnut:'Dark walnut',gold:'Sand gold',shadow:'Shadow box'});

export function photosInCollection(photos,id='') {
  return id?photos.filter(photo=>(photo.collectionId||(photo.demo?'light-water':'my-photos'))===id):photos;
}

export function normalisePhotoCollections(value,photos) {
  const assignments={};
  if(!value||typeof value!=='object'||Array.isArray(value))return assignments;
  for(const photo of photos){
    const entry=hasOwn(value,photo.id)?value[photo.id]:null;
    if(!entry||typeof entry!=='object'||typeof entry.collectionId!=='string'||
       !/^(?:light-water|japan-print|botanical-cabinet|shape-colour|my-photos|(?:mobile|museum)-[A-Za-z0-9-]{1,100})$/.test(entry.collectionId)||
       typeof entry.collectionName!=='string'||!entry.collectionName.trim())continue;
    assignments[photo.id]={collectionId:entry.collectionId,collectionName:entry.collectionName.trim().slice(0,80)};
  }
  return assignments;
}

export function assignPhotoCollection(assignments,photo,group) {
  const entry=normalisePhotoCollections({[photo.id]:{collectionId:group.id,collectionName:group.name}},[photo])[photo.id];
  if(!entry)throw new Error('Choose a collection, or create a new one.');
  return {...assignments,[photo.id]:entry};
}

// Plan one atomic edit of stored photos. Bundled artwork and native Samsung
// copies are never part of this list or its removal operations.
export function savedPhotoChanges(photos,ids,settings={},destination=null) {
  if(!Array.isArray(ids)||!ids.length||ids.length>200||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'||!id))throw new Error('Select one or more saved images.');
  const selected=ids.map(id=>photos.find(p=>p.id===id&&!p.demo));
  if(selected.some(p=>!p))throw new Error('Some images are no longer available. Refresh and try again.');
  const raw=settings.photoCollectionsV1;
  let assignments=raw&&typeof raw==='object'&&!Array.isArray(raw)?{...raw}:{};
  if(destination){
    for(const photo of selected)assignments=assignPhotoCollection(assignments,photo,destination);
    return {remove:[],settings:{photoCollectionsV1:assignments},deleteSettings:[]};
  }
  const values={},deleteSettings=[],ignored=Array.isArray(settings.ignored)?settings.ignored:[],nextIgnored=new Set(ignored);let ignoreAdded=false;
  for(const photo of selected){
    if(photo.source!=='mobile'&&photo.origin!=='mobile'&&photo.origin!=='museum'&&!nextIgnored.has(photo.id)){nextIgnored.add(photo.id);ignoreAdded=true;}
    delete assignments[photo.id];
  }
  if(ignoreAdded)values.ignored=[...nextIgnored];
  if(raw&&ids.some(id=>hasOwn(raw,id)))values.photoCollectionsV1=assignments;
  if(ids.includes(settings.lastPhoto))deleteSettings.push('lastPhoto');
  return {remove:[...ids],settings:values,deleteSettings};
}

export function uploadedPhotoDuplicate(photos,candidate,assignments={}) {
  const key=value=>String(value||'').normalize('NFC').trim().replace(/\s+/g,' ').toLowerCase();
  const title=key(candidate.title);
  for(const photo of photos){
    if(photo.demo||(assignments[photo.id]?.collectionId||photo.collectionId||'my-photos')!==candidate.collectionId)continue;
    if((candidate.transferSha256&&photo.transferSha256===candidate.transferSha256)||(candidate.sha256&&photo.sha256===candidate.sha256))return {photo,reason:'content'};
    if(title&&key(photo.title)===title)return {photo,reason:'name'};
  }
  return null;
}

export function normaliseLook(value={}) {
  return {matte:hasOwn(MATTES,value.matte)?value.matte:DEFAULTS.matte,
    fit:value.fit==='contain'?'contain':DEFAULTS.fit,
    frame:hasOwn(FRAMES,value.frame)?value.frame:'none',
    matStyle:hasOwn(MAT_STYLES,value.matStyle)?value.matStyle:'flat'};
}

export function safeText(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function normaliseSettings(value = {}) {
  return {
    interval: [30, 60, 300, 900, 3600].includes(Number(value.interval)) ? Number(value.interval) : DEFAULTS.interval,
    order: value.order === 'shuffle' ? 'shuffle' : 'sequence',
    transition: hasOwn(TRANSITIONS,value.transition)?value.transition:DEFAULTS.transition,
    transitionDuration: [.5,1,2].includes(Number(value.transitionDuration))?Number(value.transitionDuration):DEFAULTS.transitionDuration,
    motion: value.motion==='gentle'?'gentle':'off',
    resume: value.resume === true,
    brightness: Math.max(0.35, Math.min(1, Number(value.brightness) || 1)),
    contrast: Math.max(0.5, Math.min(1.5, Number(value.contrast) || 1)),
    matte: hasOwn(MATTES, value.matte) ? value.matte : DEFAULTS.matte,
    fit: value.fit === 'contain' ? 'contain' : DEFAULTS.fit,
    frame: hasOwn(FRAMES,value.frame) ? value.frame : DEFAULTS.frame,
    matStyle: hasOwn(MAT_STYLES,value.matStyle) ? value.matStyle : DEFAULTS.matStyle,
  };
}

export function artworkLook(settings, saved={}) {
  return normaliseLook({...normaliseSettings(settings),...saved});
}

export function applyGlobalAppearance(settings, looks, appearance) {
  const {matte,frame,matStyle}=normaliseLook(appearance);
  const remaining=Object.fromEntries(Object.entries(looks).map(([id,look])=>{
    const {matte:oldMat,frame:oldFrame,matStyle:oldStyle,...rest}=look||{};
    return [id,rest];
  }));
  return {settings:normaliseSettings({...settings,matte,frame,matStyle}),looks:remaining};
}

export function validateLibraryUrl(input) {
  let url;
  try { url = new URL(String(input).includes('://') ? input : 'https://' + input); }
  catch { throw new Error('Enter your PC’s local address, including the port.'); }
  const parts = url.hostname.split('.').map(Number);
  const ipv4 = parts.length === 4 && parts.every(n => Number.isInteger(n) && n >= 0 && n <= 255);
  const local = url.hostname === 'localhost' || (ipv4 && (
    parts[0] === 127 || parts[0] === 10 || (parts[0] === 192 && parts[1] === 168) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
  ));
  if (!local || url.protocol!=='https:' || url.username || url.password ||
      url.search || url.hash || !['', '/'].includes(url.pathname)) {
    throw new Error('Use a local HTTPS address with a certificate the TV trusts, or Add photos → Connect to my PC for direct uploads.');
  }
  return url.origin;
}

export function nextIndex(current, count, direction = 1, shuffle = false, random = Math.random) {
  if (count < 1) return -1;
  if (count === 1) return 0;
  if (shuffle) {
    const candidate = Math.floor(random() * (count - 1));
    return candidate >= current ? candidate + 1 : candidate;
  }
  return ((current + direction) % count + count) % count;
}

export function spatialTarget(current, candidates, direction) {
  const axis = ['left', 'right'].includes(direction) ? 'x' : 'y';
  const sign = ['right', 'down'].includes(direction) ? 1 : -1;
  const cross = axis === 'x' ? 'y' : 'x';
  let best = null, score = Infinity;
  for (const candidate of candidates) {
    if (candidate.id === current.id) continue;
    const primary = (candidate[axis] - current[axis]) * sign;
    if (primary < 2) continue;
    const secondary = Math.abs(candidate[cross] - current[cross]);
    // Prefer aligned neighbours; long diagonals should not jump between rows.
    const value = primary + secondary * 3 + secondary * secondary / Math.max(primary, 1);
    if (value < score) { best = candidate.id; score = value; }
  }
  return best;
}

export function formatBytes(bytes) {
  return bytes < 1024 * 1024 ? Math.round(bytes / 1024) + ' KB' : (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

export function validateManifest(manifest) {
  if (!manifest || !Array.isArray(manifest.items) || manifest.items.length > 200) throw new Error('The PC library returned an invalid collection.');
  const seen = new Set();
  for (const item of manifest.items) {
    if (!/^[a-f0-9-]{36}$/.test(item.id) || seen.has(item.id) ||
        !Number.isSafeInteger(item.bytes) || item.bytes < 1 || item.bytes > MAX_PHOTO_BYTES ||
        !/^[a-f0-9]{64}$/.test(item.sha256) || typeof item.title !== 'string' || item.title.length > 200) {
      throw new Error('The PC library returned invalid photo details.');
    }
    seen.add(item.id);
  }
  return manifest.items;
}

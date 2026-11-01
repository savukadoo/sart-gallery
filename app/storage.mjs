import { MAX_LIBRARY_BYTES, MAX_PHOTO_BYTES, savedPhotoChanges, uploadedPhotoDuplicate, normalisePhotoCollections } from './core.mjs';
let database;
export function openStore() {
  if (database) return Promise.resolve(database);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('sart-gallery', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('photos', { keyPath: 'id' });
      request.result.createObjectStore('settings');
    };
    request.onsuccess = () => { database = request.result; resolve(database); };
    request.onerror = () => reject(new Error('Photo storage is unavailable on this device.'));
    request.onblocked = () => reject(new Error('Close other SART Gallery windows and try again.'));
  });
}

const requireUploadSession=guard=>{if(guard&&(!guard()||guard.signal?.aborted))throw new DOMException('The connection was closed before this photo was saved.','AbortError');};
async function operation(store, mode, action, guard) {
  const db = await openStore();
  requireUploadSession(guard);
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(store, mode);
    const cancel=()=>{try{transaction.abort();}catch{}};
    const clean=()=>guard?.signal?.removeEventListener('abort',cancel);
    guard?.signal?.addEventListener('abort',cancel,{once:true});
    let request;
    try{requireUploadSession(guard);request=action(transaction.objectStore(store));}
    catch(error){clean();cancel();reject(error);return;}
    transaction.oncomplete = () => {clean();resolve(request.result);};
    transaction.onerror = () => {
      clean();
      try{requireUploadSession(guard);}catch(error){reject(error);return;}
      reject(transaction.error || new Error('The photo could not be saved.'));
    };
    transaction.onabort = () => {clean();reject(transaction.error || new DOMException('The photo was not saved.','AbortError'));};
  });
}
export const getSetting = key => operation('settings', 'readonly', store => store.get(key));
export const setSetting = (key, value) => operation('settings', 'readwrite', store => store.put(value, key));
export async function setSettings(values) {
  const db=await openStore();
  return new Promise((resolve,reject)=>{
    const transaction=db.transaction('settings','readwrite'),store=transaction.objectStore('settings');
    try { for(const [key,value] of Object.entries(values))store.put(value,key); }
    catch(error){transaction.abort();reject(error);return;}
    transaction.oncomplete=()=>resolve();
    transaction.onerror=transaction.onabort=()=>reject(transaction.error||new Error('Your gallery settings could not be saved.'));
  });
}
// Read-modify-write in one transaction; stale remote screens cannot overwrite
// another source edit, and closing the approved session aborts a pending commit.
export async function updateSetting(key,change,guard){
 const db=await openStore();requireUploadSession(guard);
 return new Promise((resolve,reject)=>{
  const tx=db.transaction('settings','readwrite'),store=tx.objectStore('settings');let value,failure;
  const cancel=()=>{try{tx.abort();}catch{}};const clean=()=>guard?.signal?.removeEventListener('abort',cancel);
  guard?.signal?.addEventListener('abort',cancel,{once:true});
  const q=store.get(key);q.onsuccess=()=>{try{requireUploadSession(guard);value=change(q.result);store.put(value,key);}catch(error){failure=error;cancel();}};
  tx.oncomplete=()=>{clean();resolve(value);};tx.onerror=tx.onabort=()=>{clean();reject(failure||tx.error||new DOMException('Settings were not saved.','AbortError'));};
 });
}
export const listPhotos = () => operation('photos', 'readonly', store => store.getAll());
export const deletePhoto = id => operation('photos', 'readwrite', store => store.delete(id));

let photoWriteQueue=Promise.resolve();
export function savePhoto(photo){
  const next=photoWriteQueue.then(()=>savePhotoChecked(photo));
  photoWriteQueue=next.catch(()=>{});return next;
}
export function saveUploadedPhoto(photo,guard){
  const next=photoWriteQueue.then(async()=>{
    requireUploadSession(guard);
    const photos=await listPhotos(),assignments=normalisePhotoCollections(await getSetting('photoCollectionsV1'),photos),previous=photos.find(p=>p.id===photo.id);
    requireUploadSession(guard);
    if(previous){
      if(previous.source!=='mobile'||previous.transferSha256!==photo.transferSha256)throw new Error('That photo identifier is already in use. Select the photo again.');
      return {...previous,alreadySaved:true,duplicateReason:'retry'};
    }
    const duplicate=uploadedPhotoDuplicate(photos,photo,assignments);
    if(duplicate)return {...duplicate.photo,alreadySaved:true,duplicateReason:duplicate.reason};
    await savePhotoChecked(photo,guard);return photo;
  });
  photoWriteQueue=next.catch(()=>{});return next;
}
export function updateSavedPhotos(ids,destination=null){
  const next=photoWriteQueue.then(()=>updateSavedPhotosChecked(ids,destination));
  photoWriteQueue=next.catch(()=>{});return next;
}
async function updateSavedPhotosChecked(ids,destination) {
  const db=await openStore();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(['photos','settings'],'readwrite'),photos=tx.objectStore('photos'),settings=tx.objectStore('settings');
    const records=photos.getAll(),keys=['photoCollectionsV1','ignored','lastPhoto'],requests=keys.map(key=>settings.get(key));
    let pending=1+requests.length,failure=null,changed=[];
    const loaded=()=>{
      if(--pending)return;
      try{
        const plan=savedPhotoChanges(records.result,ids,Object.fromEntries(keys.map((key,i)=>[key,requests[i].result])),destination);
        for(const id of plan.remove)photos.delete(id);
        for(const [key,value] of Object.entries(plan.settings))settings.put(value,key);
        for(const key of plan.deleteSettings)settings.delete(key);
        changed=[...ids];
      }catch(error){failure=error;tx.abort();}
    };
    records.onsuccess=loaded;for(const request of requests)request.onsuccess=loaded;
    tx.oncomplete=()=>resolve(changed);
    tx.onerror=tx.onabort=()=>reject(failure||tx.error||new Error('Your images could not be updated. Try again.'));
  });
}
async function savePhotoChecked(photo,guard) {
  requireUploadSession(guard);
  if (!(photo.blob instanceof Blob) || photo.blob.type !== 'image/jpeg' || photo.blob.size > MAX_PHOTO_BYTES) {
    throw new Error('Use a JPEG image under 12 MB.');
  }
  const photos = await listPhotos();
  const bytes = photos.filter(item => item.id !== photo.id).reduce((sum, item) => sum + item.blob.size + (item.thumbnailBlob?.size || 0), 0);
  if (photos.length >= 200 && !photos.some(item => item.id === photo.id)) throw new Error('Your gallery has reached its 200-photo limit.');
  if (bytes + photo.blob.size + (photo.thumbnailBlob?.size || 0) > MAX_LIBRARY_BYTES) throw new Error('Your gallery is full. Remove some photos before adding more.');
  requireUploadSession(guard);
  return operation('photos', 'readwrite', store => store.put(photo),guard);
}

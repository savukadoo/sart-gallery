import {requestTimeout,setControlsAvailable,handleImeExit} from './compat.mjs';
import {readLimitedResponse,LIBRARY_JSON_LIMIT} from './response-limits.mjs';
import { DEFAULTS, MATTES, MAT_NAMES, MAT_STYLES, FRAMES, TRANSITIONS, MAX_LIBRARY_BYTES, safeText, normaliseSettings, normaliseLook, artworkLook, applyGlobalAppearance, photosInCollection, normalisePhotoCollections, assignPhotoCollection, validateLibraryUrl, nextIndex, spatialTarget, formatBytes, validateManifest } from './core.mjs';
import { openStore, getSetting, setSetting, setSettings, updateSetting, listPhotos, savePhoto, deletePhoto, updateSavedPhotos, saveUploadedPhoto } from './storage.mjs';
import { artActive, registerRemote, exitApp, platformStatus, ready } from './platform.mjs';
import { DEMO_PHOTOS, BUILTIN_COLLECTIONS } from './assets/catalog.mjs';
import { MobileHost } from './mobile-host.mjs';
import { mobileHash, mobileUploadCollection } from './mobile-shared.mjs';
import { ArtworkPresenter } from './slideshow.mjs';
import { NativeArt } from './native-art.mjs';
import { NativeArtManager } from './native-art-manager.mjs';
import { UploadsManager } from './uploads-manager.mjs';
import { nativeExportMatch,nativeExportRemember } from './native-art-library.mjs';
import { renderNativeLook } from './native-composition.mjs';
import { FindArtCatalog, FIND_ART_SOURCES, normaliseFindArtHistory, rememberFindArtSearch } from './find-art.mjs';
import { FindArtSelection, FindArtBatch, normaliseHiddenArtwork } from './find-art-batch.mjs';
import { FIND_SOURCE_KEY, normaliseFindSources, enabledFindSources, FindSourcesService } from './find-art-sources.mjs';
import { FindSourcesManager } from './find-sources-manager.mjs';
import { helpTopics } from './help.mjs';

const root = document.getElementById('app');
const dialog = document.getElementById('dialog');
const version = safeText(window.SART_CONFIG?.version || '0.20.4');
const objects = new Map();
const state = { photos: [], tab: 'gallery', view: 'gallery', current: '', activeCollection:'', collectionFocus:'', collectionStart:0, settings: { ...DEFAULTS },
  favourites: [], looks: {}, connection: null, syncing: false, online: false, playing: false,
  controls: true, lastFocus: '', syncError: '', error: '', hidden: document.hidden, ignored: [], hiddenArtwork:[],nativeArtIncludeLook:false };
let slideTimer, hideTimer, toastTimer, syncTimer, lookSection='frame', globalLookDraft=null;
let mobileVisible=false,mobileRenderedPhase='',mobilePanel='connect',mobileStartId=0;
const nativeArt=new NativeArt(window);
let nativeArtChecking=false,nativeArtVisible=false,nativeArtPhoto=null,nativeArtPhase='confirm',nativeArtError='',nativeArtGeneration=0;
let nativeArtPrepared=null;
const nativeManager=new NativeArtManager({dialog,button:(...args)=>button(...args),text:safeText,header:dialogHead,show:showDialog,close:()=>closeDialog(true),getPhotos:()=>state.photos,getExports:()=>getSetting('nativeArtExportsV1'),setExports:exports=>setSetting('nativeArtExportsV1',exports)});
const uploadsManager=new UploadsManager({dialog,button:(...args)=>button(...args),icon:name=>icon(name),text:safeText,header:dialogHead,show:showDialog,close:()=>closeDialog(true),getPhotos:()=>state.photos.filter(p=>!p.demo),getCollections:collectionList,url:p=>photoUrl(p,true),reload:refreshUploadedLibrary,move:async(ids,group)=>{await updateSavedPhotos(ids,group);await refreshUploadedLibrary();},remove:async ids=>{await updateSavedPhotos(ids);for(const id of ids)for(const key of [id,id+'-thumb'])if(objects.has(key)){URL.revokeObjectURL(objects.get(key));objects.delete(key);}await refreshUploadedLibrary();}});
const mobile=new MobileHost({onChange:()=>{if(mobileVisible)renderMobileDialog();},save:saveMobilePhoto,collections:async()=>{await reloadPhotos();return uploadCollections();},sources:(action,body,guard)=>findSourcesService.handle(action,body,guard)});
const presenter=new ArtworkPresenter({onSettled:()=>scheduleSlide(),onError:message=>toast(message)});
let slideDirection=1;
const findArtCatalog=new FindArtCatalog();
let findSources=normaliseFindSources(),sourcePickerPage=0;
const sourceName=id=>findSources.sources.find(s=>s.id===id)?.name||FIND_ART_SOURCES[id]||'Wikimedia Commons';
const findSourcesService=new FindSourcesService({read:()=>getSetting(FIND_SOURCE_KEY),update:(change,guard)=>updateSetting(FIND_SOURCE_KEY,change,guard),test:(draft,signal)=>findArtCatalog.testSource(draft,signal),changed:config=>{
 const previous=findSources,before=previous.sources.find(s=>s.id===findArtState.source);
 findSources=config;findArtCatalog.configure(config);stopFindArt();
 const useDefault=previous.defaultId!==config.defaultId||!config.sources.some(s=>s.id===findArtState.source&&s.enabled);
 if(useDefault)findArtState.source=config.defaultId;
 const after=config.sources.find(s=>s.id===findArtState.source);
 // An edited category keeps its ID. Invalidate its visible records and credits
 // as well as the catalogue cache; leave the query ready for an explicit search.
 if(useDefault||['id','kind','category','name'].some(key=>before?.[key]!==after?.[key])){
  findArtState.items=[];findArtState.searched=false;findArtState.page=0;findArtState.more=false;
  findArtState.error='';findArtState.partial=false;findArtState.selected=0;
 }
 if(!dialog.open&&state.view==='gallery'&&['find','settings'].includes(state.tab))render();
}});
const sourcesManager=new FindSourcesManager({service:findSourcesService,dialog,button:(...args)=>button(...args),text:safeText,header:dialogHead,show:showDialog,close:()=>closeDialog(true),connect:()=>{closeDialog(true);void handleAction('add-photos',document.createElement('button'));}});
function findSourcePicker(){
 const sources=enabledFindSources(findSources),page=sources.slice(sourcePickerPage*4,sourcePickerPage*4+4);
 showDialog(`${dialogHead('Choose art source')}<div class="source-list">${page.map((s,i)=>`<button class="source-row button" data-action="find-source" data-id="${s.id}" data-focus="source-choice-${i}" data-nav-up="${i?'source-choice-'+(i-1):'close-dialog'}" data-nav-down="${i+1<page.length?'source-choice-'+(i+1):'source-pick-done'}"><strong>${safeText(s.name)}</strong><span>${s.id===findArtState.source?'Selected':''}</span></button>`).join('')}</div><div class="source-footer">${sourcePickerPage?button('find-source-page','Previous','left','','source-pick-prev','data-page="'+(sourcePickerPage-1)+'"'):''}${(sourcePickerPage+1)*4<sources.length?button('find-source-page','Next','right','','source-pick-next','data-page="'+(sourcePickerPage+1)+'"'):''}${button('sources-open','Manage sources','','','find-manage')}${button('close-dialog','Done','','primary','source-pick-done')}</div>`,'source-choice-0',()=>dialog.classList.add('sources-options','source-picker-options'));
}
const findArtSelection=new FindArtSelection(),findArtBatch=new FindArtBatch();
const findArtState={source:'nga',query:'',history:[],page:0,items:[],more:false,loading:false,searched:false,error:'',partial:false,request:0,selected:0,saving:false,selecting:false,batchPicking:false,collectionId:'',collectionName:'',collectionOpen:false,saveError:''};
let findArtDisplayIds=[],findArtPlayback=null,moveDraft=null,helpTopicIndex=0;
const icons = {
  plus: '<path d="M12 4v16M4 12h16"/>',
  play: '<path d="m8 4 12 8-12 8z"/>', pause: '<path d="M8 4v16M16 4v16"/>',
  left: '<path d="m15 5-7 7 7 7"/>', right: '<path d="m9 5 7 7-7 7"/>',
  close: '<path d="m5 5 14 14M19 5 5 19"/>', heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="m9 2-.8 3-2.7 1L3 5.3 1 9l2.3 2v3L1 16l2 3.7 2.5-.7 2.7 1 .8 3h6l.8-3 2.7-1 2.5.7 2-3.7-2.3-2v-3L23 9l-2-3.7-2.5.7-2.7-1L15 2Z"/>',
  sync: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 6a8 8 0 0 1 13 2M18 18a8 8 0 0 1-13-2"/>',
  frame: '<rect x="3" y="4" width="18" height="16" rx="1"/><rect x="7" y="8" width="10" height="8"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name] || ''}</svg>`;
const button = (name, label, symbol, cls = '', focus = '', navigation = '') => `<button type="button" class="button ${cls}" data-action="${name}" data-focus="${focus||(name==='close-dialog'?'dialog-done':name)}" ${navigation}>${symbol ? icon(symbol) : ''}${label}</button>`;
const favourite = id => state.favourites.includes(id);
const currentPhoto = () => state.photos.find(item => item.id === state.current);
const collection = () => findArtPlayback&&state.view==='player' ? findArtPlayback.ids.map(id=>state.photos.find(p=>p.id===id)).filter(Boolean) : state.tab === 'favourites' ? state.photos.filter(item => favourite(item.id)) : photosInCollection(state.photos,state.activeCollection);
function collectionList() {
  const entries=BUILTIN_COLLECTIONS.map(group=>({...group,photos:photosInCollection(state.photos,group.id)}));
  const uploaded=photosInCollection(state.photos,'my-photos');
  if(uploaded.length)entries.unshift({id:'my-photos',name:'My photos',description:'Your photographs, collected in one place.',photos:uploaded,coverId:uploaded[0].id,personal:true});
  const personal=new Map();
  for(const photo of state.photos.filter(p=>p.collectionId?.startsWith('mobile-')||p.collectionId?.startsWith('museum-'))){
    if(!personal.has(photo.collectionId))personal.set(photo.collectionId,{id:photo.collectionId,name:photo.collectionName||'My mobile photos',description:'Art and photos you’ve collected.',photos:[],coverId:photo.id,personal:true});
    personal.get(photo.collectionId).photos.push(photo);
  }
  entries.unshift(...personal.values());
  return entries;
}
function uploadCollections(){const groups=collectionList().map(g=>({id:g.id,name:g.name}));if(!groups.some(g=>g.id==='my-photos'))groups.push({id:'my-photos',name:'My photos'});return groups;}
const activeCollection = () => collectionList().find(group=>group.id===state.activeCollection);
const artLook = photo => artworkLook(state.settings,state.looks[photo.id]);
const settingChoices = {
  interval: { title:'Change artwork', description:'Choose how long each artwork stays on screen during a slideshow.', choices:[[30,'30 seconds'],[60,'1 minute'],[300,'5 minutes'],[900,'15 minutes'],[3600,'1 hour']] },
  order: { title:'Slideshow order', description:'Choose how the slideshow moves through your collection.', choices:[['sequence','In order'],['shuffle','Shuffle']] },
  matte: { title:'Default mat', description:'Used for artworks without a saved mat choice.', choices:Object.entries(MAT_NAMES) },
};
const choiceLabel = key => settingChoices[key].choices.find(([value])=>value===state.settings[key])?.[1] || '';
function settingControl(key, up, down) {
  const label=key==='brightness'?`${Math.round(state.settings.brightness*100)}% / ${Math.round(state.settings.contrast*100)}%`:choiceLabel(key);
  const title=key==='brightness'?'Brightness and contrast':settingChoices[key].title;
  return `<button type="button" class="button setting-value" data-action="choose-setting" data-setting-name="${key}" data-focus="setting-${key}" data-nav-up="${up}" data-nav-down="${down}" aria-haspopup="dialog" aria-label="${title}: ${label}"><span>${label}</span>${icon('right')}</button>`;
}

function photoUrl(photo, thumbnail = false) {
  if (!photo.blob) return thumbnail ? photo.thumbnail : photo.url;
  const key = photo.id + (thumbnail ? '-thumb' : '');
  if (!objects.has(key)) objects.set(key, URL.createObjectURL(thumbnail && photo.thumbnailBlob ? photo.thumbnailBlob : photo.blob));
  return objects.get(key);
}

function makeThumbnail(blob) {
  return new Promise((resolve,reject)=>{
    const image = new Image(), url = URL.createObjectURL(blob);
    image.onload = ()=>{
      try {
        const scale = Math.min(1,960/image.naturalWidth,640/image.naturalHeight);
        const canvas = document.createElement('canvas');
        canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));
        canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
        canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
        canvas.toBlob(result=>{URL.revokeObjectURL(url);result?resolve(result):reject(new Error('A photo preview could not be saved.'));},'image/jpeg',0.8);
      } catch(error){URL.revokeObjectURL(url);reject(error);}
    };
    image.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('A photo could not be decoded.'));};
    image.src=url;
  });
}

function toast(message) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('visible'), 4400);
}

function focusables() {
  const scope = dialog.open ? dialog : root;
  return [...scope.querySelectorAll('[data-focus]:not(:disabled)')].filter(el => el.getClientRects().length &&
    !(state.view === 'player' && !state.controls && !dialog.open));
}
function focusKey(key) {
  const el = focusables().find(item => item.dataset.focus === key) || focusables()[0];
  if (el) {
    if(el.matches('.collection-card'))selectCollection(el.dataset.id);
    el.focus({ preventScroll: true });
    // The home strip moves horizontally itself; browser scrolling would displace the TV shell.
    if(!root.querySelector('.collections-home')||dialog.open)el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    if(root.querySelector('.collection-shell')&&!dialog.open){
      const grid=root.querySelector('.collection-artworks');
      if(!el.closest('.collection-artworks')||Array.from(grid.children).indexOf(el)<(innerWidth<=900?3:5))grid.scrollTop=0;
      window.scrollTo(0,0);
    }
  }
}
function restoreFocus(key) { focusKey(key); }
function render(focus = '') {
  if (state.view === 'player') renderPlayer();
  else {findArtPlayback=null;presenter.clear();renderGallery();}
  if(root.querySelector('.collection-shell,.collections-home,.find-shell'))window.scrollTo(0,0);
  if (focus) restoreFocus(focus);
}

function card(photo, index, items) {
  const grid=state.tab==='gallery'&&state.activeCollection,columns=innerWidth<=900?3:5;
  const navigation=grid?`data-nav-up="${index<columns?'back-collections':'photo-'+safeText(items[index-columns].id)}" data-nav-down="photo-${safeText(items[Math.min(index+columns,items.length-1)].id)}" data-nav-left="photo-${safeText(items[index%columns?index-1:index].id)}" data-nav-right="photo-${safeText(items[index%columns<columns-1?Math.min(index+1,items.length-1):index].id)}"`:'';
  return `<button type="button" class="art-card ${index === 0 ? 'featured' : ''}" data-action="photo" data-id="${safeText(photo.id)}" data-focus="photo-${safeText(photo.id)}" ${navigation} aria-label="Display ${safeText(photo.title)}${favourite(photo.id) ? ', favourite' : ''}">
    <div class="image-wrap"><img src="${safeText(photoUrl(photo, true))}" alt="" ${index > 3 ? 'loading="lazy"' : ''} decoding="async">
    ${index === 0 ? `<span class="photo-badge">${photo.demo ? 'From the collection' : 'Your gallery'}</span>` : ''}
    ${favourite(photo.id) ? `<span class="favourite-mark">${icon('heart')}</span>` : ''}</div>
    <span class="caption"><span style="min-width:0"><span class="title">${safeText(photo.title)}</span><span class="artist">${safeText(photo.artist || 'Your photograph')}</span></span></span></button>`;
}

function collectionCard(group,index) {
  const cover=group.photos.find(photo=>photo.id===group.coverId)||group.photos[0];
  return `<button type="button" class="collection-card" data-action="open-collection" data-id="${safeText(group.id)}" data-focus="collection-${safeText(group.id)}" data-nav-up="tab-gallery" data-nav-down="collection-${safeText(group.id)}" aria-label="Open ${safeText(group.name)}, ${collectionCount(group)}"><span class="collection-cover">${cover?`<img src="${safeText(photoUrl(cover,true))}" alt="" decoding="async">`:'<span class="collection-no-art">No images</span>'}</span><span class="collection-caption"><strong class="title">${safeText(group.name)}</strong><span class="collection-count">${collectionCount(group)}</span></span></button>`;
}

function collectionCount(group) {
  const count=group.photos.length,word=group.personal?'photo':'artwork';
  return `${count} ${word}${count===1?'':'s'}`;
}

function collectionBrowser() {
  const groups=collectionList(),selected=groups.find(group=>group.id===state.collectionFocus)||groups[0];
  state.collectionFocus=selected.id;
  const cover=selected.photos.find(photo=>photo.id===selected.coverId)||selected.photos[0];
  return `<div class="collection-home-content"><section class="collection-preview" aria-label="Selected collection"><div class="collection-preview-copy"><div class="intro"><div><h1>Art, collected.</h1><span class="eyebrow home-tagline">Curated for your wall</span></div></div><div class="collection-summary"><p class="collection-preview-count">${collectionCount(selected)}</p><h2 class="collection-preview-title">${safeText(selected.name)}</h2><p class="collection-description">${safeText(selected.description)}</p></div></div><div class="collection-preview-mount"><img class="collection-preview-image" ${cover?`src="${safeText(photoUrl(cover,true))}"`:'hidden'} alt="Preview of ${safeText(selected.name)}" decoding="async"><div class="collection-preview-empty" ${cover?'hidden':''}>${icon('frame')}<p>No images in this collection.</p></div></div></section><section class="collection-browser" aria-label="Art collections"><div class="collection-row-heading"><h2>All collections</h2><span class="collection-position" role="status" aria-live="polite"></span></div><div class="collection-strip"><button type="button" class="collection-chevron previous" data-action="collection-previous" data-focus="collection-previous" data-nav-up="tab-gallery" aria-label="Previous collection">${icon('left')}</button><div class="collection-viewport"><div class="collections-grid">${groups.map(collectionCard).join('')}</div></div><button type="button" class="collection-chevron next" data-action="collection-next" data-focus="collection-next" data-nav-up="tab-gallery" aria-label="Next collection">${icon('right')}</button></div></section></div>`;
}

function layoutCollections() {
  const viewport=root.querySelector('.collection-viewport'),track=viewport?.querySelector('.collections-grid');
  if(!track)return;
  const cards=[...track.children],selected=cards.findIndex(el=>el.dataset.id===state.collectionFocus);
  if(selected<0)return;
  const visible=innerWidth<=600?2:innerWidth<=900?3:4;
  let start=Math.max(0,Math.min(state.collectionStart,cards.length-visible));
  if(selected<start)start=selected;
  if(selected>=start+visible)start=selected-visible+1;
  state.collectionStart=start;
  const gap=parseFloat(getComputedStyle(track).columnGap)||0;
  track.style.transform=`translateX(${-start*(cards[0].getBoundingClientRect().width+gap)}px)`;
}

function selectCollection(id) {
  const home=root.querySelector('.collections-home');
  if(!home)return;
  const groups=collectionList(),index=groups.findIndex(group=>group.id===id);
  if(index<0)return;
  const group=groups[index],cover=group.photos.find(photo=>photo.id===group.coverId)||group.photos[0];
  state.collectionFocus=id;
  const image=home.querySelector('.collection-preview-image'),url=cover?photoUrl(cover,true):'';
  image.hidden=!cover;home.querySelector('.collection-preview-empty').hidden=!!cover;
  if(!cover)image.removeAttribute('src');else if(image.getAttribute('src')!==url)image.src=url;
  image.alt='Preview of '+group.name;
  home.querySelector('.collection-preview-title').textContent=group.name;
  home.querySelector('.collection-preview-count').textContent=collectionCount(group);
  home.querySelector('.collection-description').textContent=group.description;
  home.querySelector('.collection-position').textContent=`${index+1} of ${groups.length}`;
  for(const [i,card] of [...home.querySelectorAll('.collection-card')].entries()){
    card.classList.toggle('is-selected',card.dataset.id===id);
    if(card.dataset.id===id)card.setAttribute('aria-current','true');else card.removeAttribute('aria-current');
    card.dataset.navLeft='collection-'+groups[Math.max(0,i-1)].id;
    card.dataset.navRight='collection-'+groups[Math.min(groups.length-1,i+1)].id;
  }
  for(const tab of home.querySelectorAll('.topbar [data-focus]'))tab.dataset.navDown='collection-'+id;
  home.querySelector('.collection-chevron.previous').disabled=index===0;
  home.querySelector('.collection-chevron.next').disabled=index===groups.length-1;
  layoutCollections();
}

function moveCollection(direction) {
  const groups=collectionList(),index=Math.max(0,groups.findIndex(group=>group.id===state.collectionFocus));
  focusKey('collection-'+groups[Math.max(0,Math.min(groups.length-1,index+direction))].id);
}

function backToCollections() {
  const id=state.activeCollection;
  if(id)state.collectionFocus=id;
  state.activeCollection='';state.tab='gallery';render(id?'collection-'+id:'tab-gallery');
}

function renderGallery() {
  if(state.activeCollection&&!activeCollection())state.activeCollection='';
  const group=activeCollection(),home=state.tab==='gallery'&&!group;
  const photos = collection();
  const subtitle = state.tab === 'favourites' ? 'A collection of the pieces you love most.' :
    group?`${photos.length} artworks · ${group.description}`:'';
  root.innerHTML = `<div class="shell ${state.tab==='settings'?'settings-shell':state.tab==='find'?'find-shell':group?'collection-shell':home?'collections-shell collections-home':'collections-shell'}"><header class="topbar">
    <div class="brand"><img class="brand-mark" src="icon.png" alt=""><span>SART<small>GALLERY</small></span></div>
    <nav class="tabs" aria-label="Gallery sections">${[['gallery', 'Collections'], ['find','Find art'], ['favourites', 'Favourites'], ['settings', 'Settings']].map(([id, name]) =>
    `<button class="tab" type="button" data-action="tab" data-tab="${id}" data-focus="tab-${id}" ${id==='settings'?'data-nav-down="setting-interval"':id==='find'?'data-nav-down="'+(findArtState.history.length?'find-recent-0':'find-query')+'"':''} ${state.tab === id ? 'aria-current="page"' : ''}>${name}</button>`).join('')}</nav>
    <div class="top-actions">${button('add-photos', 'Add photos', 'plus','','header-pair')}${button('start-slideshow', state.tab==='favourites'?'Play favourites':group?'Play collection':'Play all art', 'play', 'primary')}</div>
    </header>
    ${home?'':`<section class="intro"><div class="${group?'collection-heading':''}">${group?button('back-collections','Collections','left','','back-collections'):''}<div>${state.tab==='favourites'?'<span class="eyebrow">A personal collection</span>':''}
    <h1>${state.tab === 'settings' ? 'Gallery settings.' : state.tab==='find'?'Find art.':state.tab === 'favourites' ? 'Your favourites.' : group?safeText(group.name):'Art, collected.'}</h1>
    ${home?'<span class="eyebrow home-tagline">Curated for your wall</span>':''}
    ${state.tab==='settings'||subtitle?`<p>${state.tab === 'settings' ? 'Small details that make the gallery yours.' : safeText(subtitle)}</p>`:''}</div></div>
    ${state.tab!=='find'&&(state.syncing||state.online)?`<div class="quiet-status"><span class="status-dot ${state.online ? 'online' : ''}"></span>${state.syncing ? 'Saving photos…' : 'Connected to your PC'}</div>`:''}</section>`}
    ${state.tab === 'settings' ? settingsView() : state.tab==='find'?findArtView():home?collectionBrowser():`<section class="gallery ${group?'collection-artworks':''}" aria-label="${state.tab === 'favourites' ? 'Favourite artwork' : safeText(group?.name||'Artwork')}">${photos.length ? photos.map(card).join('') : `<div class="empty"><h2>A collection starts with one.</h2><p>${state.tab === 'favourites' ? 'Open an artwork and choose Favourite to keep it here.' : 'Add photos from your PC to make this gallery yours.'}</p>${button(state.tab === 'favourites' ? 'show-gallery' : 'add-photos', state.tab === 'favourites' ? 'Browse collections' : 'Add photos', 'plus', 'primary','empty-action')}</div>`}</section>`}
    <footer class="foot"><div class="keys"><span><kbd>${home?'← →':'← ↑ ↓ →'}</kbd> ${home?'Collections':'Browse'}</span><span><kbd>OK</kbd> ${home?'Open collection':'Select'}</span><span><kbd>Back</kbd> Return</span></div></footer></div>`;
  if(home){selectCollection(state.collectionFocus);requestAnimationFrame(layoutCollections);}
}

function findArtTools(){
  const f=findArtState,n=findArtSelection.size,eligible=f.items.some(item=>!state.photos.some(p=>p.id===item.id));
  const nav='data-nav-down="find-result-0" data-nav-up="find-source-'+f.source+'"';
  const tools=f.selecting?`${button('find-select-page','Select page','','','find-select-page',nav+' data-nav-right="find-select-clear" '+(!eligible||f.loading?'disabled':''))}${button('find-select-clear','Clear','','','find-select-clear',nav+' data-nav-left="find-select-page" data-nav-right="find-batch-open" '+(!n?'disabled':''))}${button('find-batch-open','Add selected ('+n+')','','primary','find-batch-open',nav+' data-nav-left="find-select-clear" data-nav-right="find-select-cancel" '+(!n?'disabled':''))}${button('find-select-cancel','Cancel','','','find-select-cancel',nav+' data-nav-left="find-batch-open"')}`:f.items.length?button('find-select','Select images','','','find-select',nav):'';
  return `<div class="find-result-tools"><p class="find-status" role="status" aria-live="polite">${f.loading?'Searching for art…'+(f.selecting?' · '+n+' selected':''):f.error?safeText(f.error):f.selecting?n+' selected · OK selects or deselects':f.searched?`${f.items.length} artwork${f.items.length===1?'':'s'} on this page${f.partial?' · Some results could not load.':''}`:'Search for an artist or subject.'}</p><div class="find-selection-tools" role="group" aria-label="Select images">${tools}</div></div>`;
}
function updateFindSelection(focus){
  const tools=root.querySelector('.find-result-tools');if(tools)tools.outerHTML=findArtTools();
  for(const el of root.querySelectorAll('.find-result')){
    const item=findArtState.items[Number(el.dataset.index)],selected=findArtSelection.has(item.id),saved=state.photos.some(p=>p.id===item.id);
    el.classList.toggle('is-selected',selected);el.classList.toggle('selection-saved',findArtState.selecting&&saved);
    el.setAttribute('aria-label',(findArtState.selecting?(saved?'Already saved: ':selected?'Deselect ':'Select '):'Preview ')+item.title);
    el.dataset.navUp=Number(el.dataset.index)<4?(findArtState.selecting?'find-select-cancel':'find-source-'+findArtState.source):'find-result-'+(Number(el.dataset.index)-4);
    if(findArtState.selecting){el.setAttribute('aria-pressed',String(selected));let mark=el.querySelector('.selection-check');if(!mark){mark=document.createElement('span');mark.className='selection-check';mark.setAttribute('aria-hidden','true');el.appendChild(mark);}mark.textContent=saved?'Saved':selected?'✓':'';}
    else{el.removeAttribute('aria-pressed');el.querySelector('.selection-check')?.remove();}
  }
  if(focus)focusKey(focus);
}
function findArtView(){
  const f={...findArtState,history:findArtState.history.filter(e=>findSources.sources.some(s=>s.id===e.source&&s.enabled))},providers=enabledFindSources(findSources).map(s=>s.id),items=f.items;
  return `<section class="find-art ${f.history.length?'has-recents':''}" aria-label="Find artwork">
  ${f.history.length?`<div class="find-recents" role="group" aria-label="Recent searches"><span>Recent</span>${f.history.map((entry,i)=>`<button class="button" type="button" data-action="find-recent" data-index="${findArtState.history.indexOf(entry)}" data-focus="find-recent-${i}" data-nav-up="tab-find" data-nav-down="find-query" data-nav-left="find-recent-${Math.max(0,i-1)}" data-nav-right="find-recent-${Math.min(f.history.length-1,i+1)}" aria-label="Search ${safeText(entry.query)} in ${safeText(sourceName(entry.source))}"><span>${safeText(entry.query)}</span></button>`).join('')}</div>`:''}
  <div class="find-search" role="search" aria-label="Custom art search"><button id="find-query" ${providers.length?'':'disabled'} class="find-query-trigger" data-action="find-edit" data-focus="find-query" data-nav-up="${f.history.length?'find-recent-0':'tab-find'}" data-nav-right="find-search" data-nav-down="find-source-${f.source}" aria-haspopup="dialog" aria-label="${f.query?'New search. Current results: '+safeText(f.query):'Enter an artist or subject'}"><span class="find-query-copy ${f.query?'':'placeholder'}">${safeText(f.query)||'Artist or subject'}</span><span class="find-query-hint">${f.query?'New search':'OK to type'}</span></button><button class="button primary" type="button" data-action="find-search" ${providers.length?'':'disabled'} data-focus="find-search" data-nav-left="find-query" data-nav-up="${f.history.length?'find-recent-'+(f.history.length-1):'tab-find'}" data-nav-down="find-source-${f.source}">Search art</button></div>
  <div class="find-filters" role="group" aria-label="Art source">${providers.length>3?button('find-source-picker',safeText(sourceName(f.source))+' ▾','','','find-source-'+f.source,'data-nav-up="find-query" data-nav-right="find-manage" aria-haspopup="dialog"'):providers.map(id=>`<button class="button" type="button" data-action="find-source" data-id="${id}" data-focus="find-source-${id}" data-nav-up="find-query" data-nav-down="${f.selecting?'find-select-cancel':items.length?'find-select':f.loading?'find-cancel':f.more?'find-next':f.page?'find-previous':'find-source-'+id}" aria-pressed="${id===f.source}">${safeText(id==='met'?'The Met':sourceName(id))}</button>`).join('')}${button('sources-open','Manage sources','','','find-manage','data-nav-up="find-search" data-nav-down="'+(items.length?'find-result-0':'find-manage')+'"')}<span>Public-domain art · Free to save</span></div>
  <div class="find-content" aria-busy="${f.loading}">${!providers.length?'<div class="find-empty"><h2>No art sources are enabled.</h2><p>Open Manage sources to turn on a source or add a Commons category.</p></div>':''}${findArtTools()}<div class="find-results">${items.map((item,i)=>`<button class="find-result ${findArtSelection.has(item.id)?'is-selected':''}" type="button" data-action="find-preview" data-index="${i}" data-record-id="${safeText(item.id)}" data-focus="find-result-${i}" data-nav-left="find-result-${i%4?i-1:i}" data-nav-right="find-result-${i%4<3?Math.min(i+1,items.length-1):i}" data-nav-up="${i<4?(f.selecting?'find-select-cancel':'find-source-'+f.source):'find-result-'+(i-4)}" data-nav-down="${i+4<items.length?'find-result-'+(i+4):f.more?'find-next':f.page?'find-previous':f.selecting?'find-batch-open':'find-source-'+f.source}" ${f.selecting?'aria-pressed="'+findArtSelection.has(item.id)+'"':''} aria-label="${f.selecting?(findArtSelection.has(item.id)?'Deselect':'Select'):'Preview'} ${safeText(item.title)}"><span class="find-image"><img src="${safeText(item.thumbnail)}" alt="" decoding="async" referrerpolicy="no-referrer"></span><strong>${safeText(item.title)}</strong><span class="find-result-artist">${safeText(item.artist)}</span>${f.selecting?'<span class="selection-check" aria-hidden="true">'+(state.photos.some(p=>p.id===item.id)?'Saved':findArtSelection.has(item.id)?'✓':'')+'</span>':''}</button>`).join('')}</div>${f.searched&&!items.length&&!f.loading&&!f.error?`<div class="find-empty"><h2>No public-domain images on this page.</h2><p>${f.more?'Try the next page, or choose another search.':'Try a different artist, subject or art source.'}</p></div>`:''}</div>
  <div class="find-pagination"><span>${f.searched?'Page '+(f.page+1)+' · '+safeText(sourceName(f.source)):'Images save on this TV for offline viewing.'}</span>${f.loading?button('find-cancel','Cancel search','','','find-cancel'):''}${f.page?button('find-previous','Previous','left','','find-previous','data-nav-up="'+(items.length?'find-result-'+(items.length-1):'find-source-'+f.source)+'"'):''}${f.more?button('find-next','Next page','right','','find-next','data-nav-up="'+(items.length?'find-result-'+(items.length-1):'find-source-'+f.source)+'"'):''}${f.error?button('find-search','Try again','','','find-retry'):''}</div></section>`;
}
function findArtQueryDialog(){
  stopFindArt();
  showDialog(`${dialogHead('Search art')}<form id="find-query-form"><label for="find-query-input">New artist or subject</label><div class="find-query-row"><input id="find-query-input" type="search" maxlength="100" autocomplete="off" enterkeyhint="done" data-focus="find-query-input" placeholder="Artist or subject" value=""><div class="dialog-actions">${button('close-dialog','Cancel','','','find-query-cancel','data-nav-up="close-dialog" data-nav-left="find-query-input" data-nav-right="find-query-submit"')}<button class="button primary" type="submit" data-focus="find-query-submit" data-nav-up="close-dialog" data-nav-left="find-query-cancel">Search art</button></div></div><p class="remote-hint">Done finishes typing. Back or Cancel returns to Find art.</p><p id="find-query-error" class="dialog-error" role="alert"></p></form>`,'find-query-input',()=>dialog.classList.add('find-query-options'));
}
function submitFindArtQuery(){
  const input=document.getElementById('find-query-input'),query=input?.value.trim().slice(0,100);
  if(!query){document.getElementById('find-query-error').textContent='Enter an artist or subject, or choose Cancel.';focusKey('find-query-input');return;}
  findArtState.query=query;input.blur();closeDialog();void searchFindArt();
}
function stopFindArt(){findArtState.request++;if(findArtBatch.running)findArtBatch.cancel();findArtCatalog.cancel();findArtState.loading=false;findArtState.saving=false;}
async function searchFindArt(page=0){
  const f=findArtState;
  if(!findSources.sources.some(s=>s.id===f.source&&s.enabled)){await sourcesManager.open();return;}
  f.query=f.query.trim().slice(0,100);
  if(!f.query){findArtQueryDialog();return;}
  if(page===0){f.history=rememberFindArtSearch(f.history,f.source,f.query);void setSetting('findArtRecentV1',f.history).catch(()=>toast('Recent searches could not be saved.'));}
  const request=++f.request;f.loading=true;f.error='';f.items=[];f.more=false;f.searched=true;f.page=page;render('find-cancel');
  try{const result=await findArtCatalog.search(f.source,f.query,page);if(request!==f.request||state.tab!=='find')return;f.items=result.items;f.more=result.more;f.partial=result.partial;}
  catch(error){if(request!==f.request||state.tab!=='find')return;f.error=error.message;}
  finally{if(request===f.request&&state.tab==='find'){f.loading=false;const active=document.activeElement?.dataset.focus;render(active==='find-cancel'?(f.items.length?'find-result-0':f.more?'find-next':f.error?'find-retry':'find-query'):active);}}
}
function findArtPreview(index,focus='find-collection-picker'){
  const f=findArtState,record=f.batchPicking?findArtSelection.values()[0]:f.items[index];if(!record)return;
  f.selected=index;
  const groups=collectionList().sort((a,b)=>Number(!!a.personal)-Number(!!b.personal)),saved=f.batchPicking?null:state.photos.find(p=>p.id===record.id);
  if(!groups.some(g=>g.id===f.collectionId)&&f.collectionId!=='new')f.collectionId='';
  const selected=groups.find(g=>g.id===f.collectionId),same=saved&&f.collectionId===saved.collectionId;
  const options=[...groups,{id:'new',name:'New collection…'}];
  showDialog(`${dialogHead(f.batchPicking?'Add '+findArtSelection.size+' images':record.title)}<div class="find-preview-layout">${f.batchPicking?`<div class="find-batch-summary"><strong>${findArtSelection.size} images selected</strong><p>Choose a collection once for all selected images.</p><ul>${findArtSelection.values().slice(0,5).map(item=>'<li>'+safeText(item.title)+'</li>').join('')}</ul>${findArtSelection.size>5?'<p>And '+(findArtSelection.size-5)+' more.</p>':''}</div>`:`<div class="find-preview-image"><img src="${safeText(record.thumbnail)}" alt="${safeText(record.title)}" referrerpolicy="no-referrer"></div>`}<div class="find-preview-details"><p class="find-artist">${f.batchPicking?'Images download one at a time to keep your TV responsive.':safeText(record.artist)+(record.date?'<br>'+safeText(record.date):'')}</p><p class="find-credit">${f.batchPicking?'Selected public-domain artwork':safeText(record.sourceName||sourceName(record.provider))+'<br>'+safeText(record.rights)}</p><h3>Collection</h3><button class="button find-collection-picker" data-action="find-pick-collection" data-focus="find-collection-picker" data-nav-up="close-dialog" data-nav-down="${f.collectionOpen?'find-collection-'+(selected?.id||options[0].id):f.collectionId==='new'?'find-collection-name':'find-save'}" aria-haspopup="listbox" aria-expanded="${f.collectionOpen}" aria-controls="find-collection-list"><span>${safeText(selected?.name||(f.collectionId==='new'?'New collection':'Choose a collection'))}</span>${icon('right')}</button>${f.collectionOpen?`<div id="find-collection-list" class="find-collection-list" role="listbox" aria-label="Choose collection">${options.map((g,i)=>`<button class="find-collection-option" role="option" data-action="find-collection" data-id="${safeText(g.id)}" data-focus="find-collection-${safeText(g.id)}" data-nav-up="${i?'find-collection-'+safeText(options[i-1].id):'find-collection-picker'}" data-nav-down="${i+1<options.length?'find-collection-'+safeText(options[i+1].id):'find-collection-'+safeText(g.id)}" aria-selected="${f.collectionId===g.id}"><span>${g.id==='new'?'+ ':''}${safeText(g.name)}</span><span aria-hidden="true">${f.collectionId===g.id?'✓':''}</span></button>`).join('')}</div>`:''}<label class="find-new-label" ${f.collectionId==='new'&&!f.collectionOpen?'':'hidden'}>Collection name<input id="find-collection-name" data-focus="find-collection-name" data-nav-up="find-collection-picker" data-nav-down="find-save" maxlength="80" value="${safeText(f.collectionName)}"></label><p class="find-save-status" id="find-save-status" role="status" aria-live="polite">${safeText(f.saveError||(saved?'Already saved. Display it now, or choose another collection to move it.':'Choose a collection, or create a new one.'))}</p></div></div><div class="dialog-actions">${button('close-dialog','Cancel','','','find-dismiss')}${button(f.batchPicking?'find-batch-save':same?'find-display-existing':'find-save',f.batchPicking?'Download '+findArtSelection.size+' images':same?'Display now':saved?'Move to collection':'Add to collection',same?'play':saved?'':'plus','primary','find-save','data-nav-up="'+(f.collectionId==='new'?'find-collection-name':'find-collection-picker')+'"')}</div>` ,focus);
  dialog.classList.add('find-art-options');
}
function findArtDestination(){
  const f=findArtState;let group=collectionList().find(g=>g.id===f.collectionId);
  if(f.collectionId==='new'){
    const name=document.getElementById('find-collection-name')?.value.trim().slice(0,80);
    if(!name){document.getElementById('find-save-status').textContent='Enter a name for your new collection.';focusKey('find-collection-name');return null;}
    group={id:'museum-'+[...crypto.getRandomValues(new Uint8Array(12))].map(b=>b.toString(16).padStart(2,'0')).join(''),name};f.collectionName=name;
  }
  if(!group){f.saveError='Choose a collection, or create a new one.';f.collectionOpen=true;findArtPreview(f.selected,'find-collection-'+BUILTIN_COLLECTIONS[0].id);}
  return group;
}
async function persistFoundArt(record,group,active,moveExisting=false){
  const assertActive=()=>{if(!active())throw new DOMException('Cancelled','AbortError');};assertActive();
  const previous=state.photos.find(p=>p.id===record.id);
  if(previous){if(!moveExisting||previous.collectionId===group.id)return 'skipped';await setSetting('photoCollectionsV1',assignPhotoCollection(state.photoCollections,previous,group));return 'saved';}
  let url,canvas;
  try{
    const blob=await findArtCatalog.image(record);assertActive();url=URL.createObjectURL(blob);const image=new Image();
    await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error('This artwork could not be decoded.'));image.src=url;});assertActive();
    const scale=Math.min(1,1920/image.naturalWidth,1920/image.naturalHeight);canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
    const clean=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('The artwork could not be saved.')),'image/jpeg',.9));assertActive();
    const thumbnailBlob=await makeThumbnail(clean),sha256=await mobileHash(await clean.arrayBuffer());assertActive();
    await savePhoto({id:record.id,title:record.title,artist:record.artist,date:record.date,collectionId:group.id,collectionName:group.name,blob:clean,thumbnailBlob,sha256,source:record.source,provider:record.provider,providerId:record.providerId,sourceName:record.sourceName||sourceName(record.provider),catalogSourceId:record.catalogSourceId||record.provider,rights:record.rights,publicDomain:true,origin:'museum',addedAt:Date.now(),demo:false});
    return 'saved';
  }finally{if(url)URL.revokeObjectURL(url);if(canvas)canvas.width=canvas.height=1;}
}
async function saveFoundArt(){
  const f=findArtState,record=f.items[f.selected];if(!record||f.saving)return;
  const group=findArtDestination();if(!group)return;const previous=state.photos.find(p=>p.id===record.id);
  if(previous?.collectionId===group.id)return;
  f.saving=true;f.collectionOpen=false;const request=++f.request,active=()=>request===f.request&&dialog.open&&!document.hidden;
  const controls='[data-action="find-save"],[data-action="find-collection"],[data-action="find-pick-collection"],#find-collection-name';dialog.querySelectorAll(controls).forEach(el=>el.disabled=true);
  const status=document.getElementById('find-save-status');status.textContent=previous?'Moving artwork…':'Downloading artwork…';focusKey('find-dismiss');
  try{await persistFoundArt(record,group,active,true);await reloadPhotos();if(active()){
    f.collectionId=group.id;state.lastFocus='find-result-'+f.selected;findArtDisplayIds=[record.id];
    showDialog(`${dialogHead(previous?'Artwork moved':'Artwork added')}<p>${safeText(record.title)}</p><p class="muted">Saved to ${safeText(group.name)}.</p><div class="dialog-actions">${button('close-dialog','Keep browsing','','','find-keep-browsing','data-nav-right="find-display"')}${button('find-display','Display now','play','primary','find-display','data-nav-left="find-keep-browsing" data-nav-up="close-dialog"')}</div>`,'find-display',()=>dialog.classList.add('find-batch-progress'));
  }}
  catch(error){if(active()){status.textContent=error.name==='AbortError'?'Download cancelled. Please try again.':error.message;dialog.querySelectorAll(controls).forEach(el=>el.disabled=false);focusKey('find-save');}}
  finally{f.saving=false;}
}
function stopFindArtBatch(){
  findArtBatch.cancel();findArtCatalog.cancel();const status=document.getElementById('find-batch-status');if(status)status.textContent='Stopping… Saved images will stay in your collection.';
  const stop=dialog.querySelector('[data-action="find-batch-stop"]');if(stop)stop.disabled=true;
}
async function saveFoundArtBatch(){
  const f=findArtState;if(findArtBatch.running||!findArtSelection.size)return;const group=findArtDestination();if(!group)return;
  const records=findArtSelection.values();f.batchPicking=false;f.collectionOpen=false;
  showDialog(`${dialogHead('Downloading images')}<p id="find-batch-status" role="status" aria-live="polite">Starting download…</p><progress id="find-batch-progress" max="${records.length}" value="0" aria-label="Images processed"></progress><p id="find-batch-title"></p><p>Saved images stay in ${safeText(group.name)} if you stop.</p><div class="dialog-actions">${button('find-batch-stop','Stop','','','find-batch-stop')}</div>`,'find-batch-stop',()=>dialog.classList.add('find-batch-progress'));
  let result;
  try{result=await findArtBatch.run(records,(record,active)=>persistFoundArt(record,group,()=>active()&&!document.hidden&&dialog.open),p=>{
    const status=document.getElementById('find-batch-status'),title=document.getElementById('find-batch-title'),bar=document.getElementById('find-batch-progress');if(status)status.textContent=`Image ${p.index} of ${p.total} · ${p.saved} saved${p.failed?' · '+p.failed+' failed':''}`;if(title)title.textContent=p.title;if(bar)bar.value=p.index-1;
  });}catch(error){result={saved:[],skipped:[],failed:[{error:error.message}],remaining:records,cancelled:false,stoppedReason:error.message};}
  findArtSelection.remove([...result.saved,...result.skipped]);f.selecting=findArtSelection.size>0;await reloadPhotos();if(result.saved.length)f.collectionId=group.id;
  state.lastFocus=findArtSelection.size?'find-batch-open':'find-select';
  findArtDisplayIds=[...result.saved,...result.skipped].filter(id=>state.photos.some(p=>p.id===id));
  const summary=`${result.saved.length} image${result.saved.length===1?'':'s'} saved to ${group.name}.`,remaining=result.remaining.length;
  if(!document.hidden&&dialog.open){showDialog(`${dialogHead(result.cancelled?'Download stopped':remaining?'Some images remain':'Images added')}<p>${safeText(summary)}</p>${result.skipped.length?'<p>'+result.skipped.length+' already saved; no duplicates added.</p>':''}${remaining?'<p>'+remaining+' remain selected. You can retry them without downloading successful images again.</p>':''}${result.stoppedReason?'<p class="dialog-error">'+safeText(result.stoppedReason)+'</p>':''}${result.failed.length?'<ul class="find-batch-errors">'+result.failed.slice(0,3).map(x=>'<li>'+safeText(x.title||'Image')+': '+safeText(x.error)+'</li>').join('')+'</ul>':''}<div class="dialog-actions">${remaining?button('find-batch-open','Retry remaining','','','find-batch-retry','data-nav-right="find-keep-browsing"'):''}${button('close-dialog','Keep browsing','',findArtDisplayIds.length?'':'primary','find-keep-browsing',`data-nav-left="${remaining?'find-batch-retry':'find-keep-browsing'}" data-nav-right="${findArtDisplayIds.length?'find-display':'find-keep-browsing'}"`)}${findArtDisplayIds.length?button('find-display','Display now','play','primary','find-display','data-nav-left="find-keep-browsing" data-nav-up="close-dialog"'):''}</div>`,findArtDisplayIds.length?'find-display':'find-keep-browsing',()=>dialog.classList.add('find-batch-progress'));}
  else{if(dialog.open)closeDialog(true);f.error=summary+(remaining?' '+remaining+' remain selected.':'');}
}

async function displayFoundArt(){
  const ids=[...new Set(findArtDisplayIds)].filter(id=>state.photos.some(p=>p.id===id));
  if(!ids.length){toast('This artwork is no longer in your gallery.');return;}
  const focus=state.lastFocus;
  closeDialog();findArtPlayback={ids,focus};
  await display(state.photos.find(p=>p.id===ids[0]));
}

function settingsView() {
  const used = state.photos.reduce((sum, p) => sum + (p.blob?.size || 0) + (p.thumbnailBlob?.size || 0), 0);
  const s = state.settings;
  const libraryKeys=['library-manage','library-add','library-advanced',...(state.connection?['sync','disconnect']:[]),...(state.hiddenArtwork.length?['restore-included']:[]),...(nativeArt.support.supported?['native-manager-open']:[]),'settings-sources','about'];
  const libraryNav=key=>{const index=libraryKeys.indexOf(key);return `data-nav-up="${index?libraryKeys[index-1]:'setting-matte'}" data-nav-down="${libraryKeys[Math.min(index+1,libraryKeys.length-1)]}" data-nav-left="setting-matte"`;};
  return `<div class="settings-grid"><section class="settings-panel settings-display"><h2>Artwork display</h2>
    <div class="setting-row"><div class="setting-label">Change artwork<small>The time each piece stays on your screen.</small></div>${settingControl('interval','tab-settings','setting-order')}</div>
    <div class="setting-row"><div class="setting-label">Slideshow options<small>${TRANSITIONS[s.transition]} · ${s.transitionDuration} sec · ${choiceLabel('order')}</small></div>${button('slideshow-options','Order & effects','settings','setting-value','setting-order','data-nav-up="setting-interval" data-nav-down="setting-resume" aria-haspopup="dialog"')}</div>
    <div class="setting-row"><div class="setting-label">Return to your last artwork<small>Show it when you next open SART Gallery.</small></div><button type="button" class="button setting-value resume-toggle" data-action="toggle-resume" data-focus="setting-resume" data-nav-up="setting-order" data-nav-down="setting-brightness" aria-label="Return to your last artwork" aria-pressed="${s.resume}"><span>${s.resume?'On':'Off'}</span><span class="toggle-track" aria-hidden="true"></span></button></div>
    <div class="setting-row"><div class="setting-label">Brightness & contrast<small>Adjust the image to suit your room.</small></div>${settingControl('brightness','setting-resume','setting-matte')}</div>
    <div class="setting-row"><div class="setting-label">Frame & mat for all artwork<small>${FRAMES[s.frame]} · ${MAT_NAMES[s.matte]} · ${MAT_STYLES[s.matStyle]}</small></div>${button('global-look','Choose look','frame','setting-value','setting-matte','data-nav-up="setting-brightness" data-nav-down="library-manage" aria-haspopup="dialog" aria-label="Frame and mat for all artwork"')}</div>
    </section><div class="settings-side"><section class="settings-panel library-panel"><h2>Your photo library</h2>
    <div class="library-stat"><strong>${state.photos.filter(p=>!p.demo).length}</strong><div><span>saved photos</span><small>${formatBytes(used)} of ${formatBytes(MAX_LIBRARY_BYTES)}</small></div>${button('uploads-open','Manage uploads','','','library-manage',libraryNav('library-manage'))}</div>
    <p>Saved photos stay available offline.</p>
    <div class="library-connection"><span class="status-dot ${state.online?'online':''}"></span><span>${state.connection ? state.online?'PC companion connected':'PC companion offline' : 'Ready for direct uploads'}</span></div>
    <p class="library-address">${state.connection ? safeText(state.connection.origin) : 'Bring your own photographs into the gallery.'}</p>
    <div class="library-actions">${button('add-photos','Add photos','plus','primary','library-add',libraryNav('library-add'))}${button('advanced-connections','Advanced','','','library-advanced',libraryNav('library-advanced'))}${state.connection?button('sync','Sync companion','sync','','sync',libraryNav('sync')):''}</div>
    <div class="library-links">${state.connection?`<button class="link" data-action="disconnect" data-focus="disconnect" ${libraryNav('disconnect')}>Disconnect this PC</button>`:''}${state.hiddenArtwork.length?`<button class="link" data-action="restore-included" data-focus="restore-included" ${libraryNav('restore-included')}>Restore included artwork (${state.hiddenArtwork.length})</button>`:''}</div>
    ${nativeArt.support.supported?`<section class="native-settings-section"><div><h3>Samsung Art Mode</h3><p>View and manage photos saved in Samsung’s My Photos.</p></div>${button('native-manager-open','Manage collection','frame','','native-manager-open',libraryNav('native-manager-open'))}</section>`:''}</section><section class="settings-panel sources-settings"><div><h2>Find art</h2><p>Choose your search sources.</p></div>${button('sources-open','Manage sources','','','settings-sources',libraryNav('settings-sources'))}</section><section class="settings-panel about-panel"><div><h2>SART Gallery</h2><p>Version ${version} · Local photos.<br>No ads or analytics in this app.</p></div>${button('about','About','','','about',libraryNav('about'))}</section></div></div>`;
}

function renderPlayer() {
  const photo = currentPhoto();
  if (!photo) { state.view = 'gallery'; findArtPlayback=null;presenter.clear();renderGallery(); return; }
  const look = artLook(photo);
  const controls=`<div class="player-controls ${state.controls?'shown':''}" ${state.controls?'':'inert'}><div class="player-top"><button class="button" data-action="back-gallery" data-focus="back-gallery">${icon('left')} ${findArtPlayback?'Find art':state.tab==='favourites'?'Favourites':state.activeCollection?'Collection':'Collections'}</button><span>SART GALLERY</span></div>
    <div class="player-bottom"><div><h2>${safeText(photo.title)}</h2><p>${safeText(photo.artist || 'Your photograph')}${photo.date?' · '+safeText(photo.date):''}</p><span class="playback-status">${state.playing?`Slideshow · ${choiceLabel('interval')} per artwork${state.settings.motion==='gentle'?' · Pan & zoom on':''}`:state.settings.motion==='gentle'?'Auto-change paused · Pan & zoom on':'Slideshow paused'}</span></div>
    <div class="player-buttons"><button class="icon-button" aria-label="Previous artwork" data-action="previous" data-focus="previous">${icon('left')}</button>
    <button class="button" data-action="toggle-play" data-focus="toggle-play">${icon(state.playing?'pause':'play')}${state.playing?'Pause':'Slideshow'}</button>
    <button class="icon-button" aria-label="Slideshow options" data-action="slideshow-options" data-focus="slideshow-options">${icon('settings')}</button>
    <button class="icon-button" aria-label="Next artwork" data-action="next" data-focus="next">${icon('right')}</button>
    <button class="button" data-action="mat" data-focus="mat">${icon('frame')} Frame & mat</button>
    <button class="button" data-action="favourite" data-focus="favourite" aria-pressed="${favourite(photo.id)}">${icon('heart')}${favourite(photo.id)?'Saved':'Favourite'}</button>
    ${nativeArt.support.supported?'<button class="button" data-action="native-art" data-focus="native-art">'+icon('frame')+'Samsung Art Mode</button>':''}
    <button class="button" data-action="move-image" data-focus="move-image">Move to collection</button>
    <button class="button" data-action="remove" data-focus="remove">Remove</button></div></div></div>`;
  if(!root.querySelector('.player'))root.innerHTML=`<section class="player" aria-label="Artwork display"><div class="canvas"><div class="picture-frame"><div class="mat-surface"><div class="art-window"></div></div>${['top','right','bottom','left'].map(side=>`<i class="frame-rail ${side}" aria-hidden="true"></i>`).join('')}</div></div>${controls}</section>`;
  else root.querySelector('.player-controls').outerHTML=controls;
  setControlsAvailable(root.querySelector('.player-controls'),state.controls);
  presenter.setMotionActive(!state.hidden&&!dialog.open&&state.view==='player');
  presenter.setScene(root.querySelector('.canvas'),{...state.settings,id:photo.id,url:photoUrl(photo),title:photo.title,look,matte:MATTES[look.matte],direction:slideDirection});
}

function scheduleSlide() {
  clearTimeout(slideTimer);
  presenter.setMotionActive(state.view==='player'&&!state.hidden&&!dialog.open);
  if (state.playing && state.view === 'player' && !state.hidden && !dialog.open && !presenter.busy && collection().length > 1) {
    slideTimer = setTimeout(() => { advance(1, true); }, state.settings.interval * 1000);
  }
}
function hideControls() {
  if (state.view !== 'player' || dialog.open) return;
  state.controls = false;
  const controls = root.querySelector('.player-controls');
  controls?.classList.remove('shown');
  setControlsAvailable(controls,false);
  if (root.contains(document.activeElement)) document.activeElement.blur();
}
function showControls(focus = '') {
  state.controls = true;
  const controls = root.querySelector('.player-controls');
  controls?.classList.add('shown');
  setControlsAvailable(controls,true);
  clearTimeout(hideTimer);
  hideTimer = setTimeout(hideControls, 6500);
  if (focus) restoreFocus(focus);
}

async function display(photo, playing = false) {
  if(state.tab==='find')stopFindArt();
  if (!photo) { toast('Add an artwork to this collection first.'); return; }
  state.current = photo.id; state.view = 'player'; state.playing = playing; state.controls = false;
  await setSetting('lastPhoto', photo.id);
  render(); await artActive(!state.hidden); scheduleSlide();
  toast('Press OK for artwork controls.');
}
function advance(direction, automatic = false) {
  const photos = collection();
  const index = photos.findIndex(p=>p.id===state.current);
  const target = nextIndex(index, photos.length, direction, automatic && state.settings.order === 'shuffle');
  if (target < 0) return;
  slideDirection=direction;
  state.current = photos[target].id;
  void setSetting('lastPhoto', state.current);
  render(state.controls ? (direction<0?'previous':'next') : '');
  if (state.controls) showControls();
  scheduleSlide();
}
async function backToGallery() {
  const returnFocus=findArtPlayback?.focus;findArtPlayback=null;
  state.view = 'gallery'; state.playing = false; clearTimeout(slideTimer); clearTimeout(hideTimer);
  render(returnFocus||'photo-'+state.current);await artActive(false);
}

function showDialog(html, focus, onShow) {
  if(findArtState.loading)stopFindArt();
  clearTimeout(hideTimer); clearTimeout(slideTimer);
  if(presenter.animations?.length)presenter.finish(false);presenter.setMotionActive(false);
  if(!dialog.open)state.lastFocus = document.activeElement?.dataset.focus || '';
  dialog.innerHTML = html;
  dialog.classList.remove('art-options','global-art-options','mobile-options','slideshow-options','native-art-options','native-manager-options','find-art-options','find-query-options','find-batch-progress','collection-move-options','uploads-manager-options','help-options','about-options','sources-options','source-picker-options');
  const heading=dialog.querySelector('h2');
  if(heading){heading.id='dialog-title';dialog.setAttribute('aria-labelledby','dialog-title');}
  if (!dialog.open) dialog.showModal();
  onShow?.();
  restoreFocus(focus);
}
function closeDialog(force=false) {
  if(sourcesManager.visible){if(!force){sourcesManager.back();return;}sourcesManager.dismiss();}
  if(!force&&dialog.classList.contains('help-options')){aboutDialog();return;}
  if(moveDraft?.saving&&!force)return;
  if(uploadsManager.visible&&!uploadsManager.dismiss(force))return;
  if(nativeManager.visible&&!nativeManager.dismiss(force))return;
  if(findArtBatch.running){stopFindArtBatch();if(!force)return;}
  if(mobileVisible&&!force){
    if(mobilePanel==='confirm-close'){mobilePanel='connect';renderMobileDialog();return;}
    if(mobilePanel!=='connect'){mobile.closeSetup();mobilePanel='connect';renderMobileDialog();return;}
    if(mobileTransferBusy()){mobilePanel='confirm-close';renderMobileDialog();return;}
  }
  if(mobileVisible){mobileStartId++;mobileVisible=false;mobile.close();mobileRenderedPhase='';}
  if(nativeArtVisible){nativeArtGeneration++;nativeArtVisible=false;nativeArt.cancel();nativeArtPhoto=null;clearNativeArtwork();}
  if(dialog.classList.contains('find-art-options')){document.getElementById('find-collection-name')?.blur();stopFindArt();}
  if(dialog.classList.contains('find-query-options'))document.getElementById('find-query-input')?.blur();
  document.getElementById('move-collection-name')?.blur();moveDraft=null;
  globalLookDraft=null;findArtState.batchPicking=false;
  dialog.close();
  if (state.view === 'player') showControls(state.lastFocus || 'toggle-play');
  else if(state.tab==='find'){if(!document.hidden)render(state.lastFocus);}
  else restoreFocus(state.lastFocus);
  scheduleSlide();
}
function dialogHead(title) {
  return `<div class="dialog-top"><h2>${title}</h2><button class="icon-button" data-action="close-dialog" data-focus="close-dialog" aria-label="Close">${icon('close')}</button></div>`;
}

function aboutDialog() {
  const p=platformStatus();
  showDialog(`${dialogHead('SART Gallery')}<p>Your art. A quieter screen.</p><p>Your uploaded photos are saved on this device. Add photos connects your phone, tablet or computer directly to this TV over home Wi-Fi, with no companion or cloud photo storage. The upload page and pairing use HTTPS, and photo transfers are encrypted. First-time public certificate downloads use a separate temporary HTTP setup page. Only approve devices you recognise.</p><p>SART Gallery includes no advertising or analytics. Display copies omit location metadata. Four included collections contain 60 public-domain artworks, with source credits from the Art Institute of Chicago, Cleveland Museum of Art and Artvee. All included images are available offline.</p><p class="muted">Version ${version} · ${p.tv?'Samsung TV':'Browser preview'} · ${p.width} × ${p.height} app viewport<br>Screensaver: ${safeText(p.screensaver)}<br>Source (AGPL-3.0-only): ${safeText(window.SART_CONFIG.sourceUrl||'https://github.com/savukadoo/sart-gallery')}</p><div class="dialog-actions">${button('help-guide','Help guide','','primary','about-help','data-nav-up="close-dialog" data-nav-right="dialog-done"')}${button('close-dialog','Done','','','dialog-done','data-nav-up="close-dialog" data-nav-left="about-help"')}</div>`,'about-help',()=>dialog.classList.add('about-options'));
  dialog.querySelector('[data-focus="close-dialog"]').dataset.navDown='about-help';
}

function helpDialog(index=helpTopicIndex) {
  const topics=helpTopics(nativeArt.support.supported);
  helpTopicIndex=Math.max(0,Math.min(topics.length-1,Number(index)||0));
  const topic=topics[helpTopicIndex],selected='help-topic-'+helpTopicIndex;
  showDialog(`${dialogHead('Help guide')}<p class="help-summary">Choose a topic. Press Back to return to About.</p><div class="help-layout"><nav class="help-topics" role="tablist" aria-label="Help topics" aria-orientation="vertical">${topics.map((item,i)=>`<button type="button" class="button help-topic" role="tab" id="help-tab-${i}" aria-selected="${i===helpTopicIndex}" aria-controls="help-content" data-action="help-topic" data-index="${i}" data-focus="help-topic-${i}" data-nav-up="${i?'help-topic-'+(i-1):'close-dialog'}" data-nav-down="${i+1<topics.length?'help-topic-'+(i+1):'help-about'}" data-nav-right="help-content">${safeText(item.title)}</button>`).join('')}</nav><article id="help-content" class="help-content" role="tabpanel" tabindex="0" data-focus="help-content" data-nav-left="${selected}" data-nav-right="help-about" aria-labelledby="help-tab-${helpTopicIndex}"><h3>${safeText(topic.title)}</h3><ol>${topic.steps.map(step=>`<li>${safeText(step)}</li>`).join('')}</ol><p class="help-tip">${safeText(topic.tip)}</p></article></div><div class="dialog-actions"><span class="remote-hint">Use the arrows to browse topics and scroll the guide.</span>${button('help-about','Back to About','','','help-about',`data-nav-up="${selected}" data-nav-left="${selected}"`)}</div>`,selected,()=>dialog.classList.add('help-options'));
  dialog.querySelector('[data-focus="close-dialog"]').dataset.navDown=selected;
}

function moveDestinations() {
  const groups=collectionList();
  if(!groups.some(g=>g.id==='my-photos'))groups.push({id:'my-photos',name:'My photos'});
  return groups.filter(g=>g.id!==currentPhoto()?.collectionId);
}
function moveImageDialog(focus='move-picker') {
  const draft=moveDraft,photo=state.photos.find(p=>p.id===draft?.photoId);
  if(!draft||!photo)return;
  const groups=moveDestinations(),options=[...groups,{id:'new',name:'New collection…'}],selected=groups.find(g=>g.id===draft.collectionId);
  const from=collectionList().find(g=>g.id===photo.collectionId)?.name||'My photos';
  showDialog(`${dialogHead('Move to collection')}<div class="find-preview-layout"><div class="find-preview-image"><img src="${safeText(photoUrl(photo,true))}" alt="${safeText(photo.title)}"></div><div class="find-preview-details"><p class="move-image-title">${safeText(photo.title)}</p><p class="find-credit">Currently in ${safeText(from)}</p><h3>Move to</h3><button class="button find-collection-picker" data-action="move-pick-collection" data-focus="move-picker" data-nav-up="close-dialog" data-nav-down="${draft.open?'move-collection-'+(draft.collectionId||options[0].id):draft.collectionId==='new'?'move-collection-name':'move-confirm'}" aria-haspopup="listbox" aria-expanded="${draft.open}" aria-controls="move-collection-list"><span>${safeText(selected?.name||(draft.collectionId==='new'?'New collection':'Choose a collection'))}</span>${icon('right')}</button>${draft.open?`<div id="move-collection-list" class="find-collection-list" role="listbox" aria-label="Move to collection">${options.map((g,i)=>`<button class="find-collection-option" role="option" data-action="move-collection" data-id="${safeText(g.id)}" data-focus="move-collection-${safeText(g.id)}" data-nav-up="${i?'move-collection-'+safeText(options[i-1].id):'move-picker'}" data-nav-down="${i+1<options.length?'move-collection-'+safeText(options[i+1].id):'move-collection-'+safeText(g.id)}" aria-selected="${draft.collectionId===g.id}"><span>${g.id==='new'?'+ ':''}${safeText(g.name)}</span><span aria-hidden="true">${draft.collectionId===g.id?'✓':''}</span></button>`).join('')}</div>`:''}<label class="find-new-label" ${draft.collectionId==='new'&&!draft.open?'':'hidden'}>Collection name<input id="move-collection-name" data-focus="move-collection-name" data-nav-up="move-picker" data-nav-down="move-confirm" maxlength="80" value="${safeText(draft.collectionName)}"></label><p class="find-save-status" role="status" aria-live="polite">${safeText(draft.saving?'Moving image…':draft.error||'Keeps its favourite status, frame and mat settings.')}</p></div></div><div class="dialog-actions">${button('close-dialog','Cancel','','','move-cancel','data-nav-up="move-picker" data-nav-right="move-confirm"')}${button('move-confirm',draft.saving?'Moving…':'Move to collection','','primary','move-confirm','data-nav-left="move-cancel" data-nav-up="'+(draft.collectionId==='new'?'move-collection-name':'move-picker')+'"')}</div>`,focus,()=>dialog.classList.add('collection-move-options'));
  dialog.querySelector('[data-focus="close-dialog"]').dataset.navDown='move-picker';
  if(draft.saving)for(const el of dialog.querySelectorAll('button,input'))el.disabled=true;
}
async function confirmImageMove() {
  const draft=moveDraft,photo=state.photos.find(p=>p.id===draft?.photoId);
  if(!draft||!photo||draft.saving)return;
  let group=moveDestinations().find(g=>g.id===draft.collectionId);
  if(draft.collectionId==='new'){
    const name=document.getElementById('move-collection-name')?.value.trim().slice(0,80);
    if(!name){draft.error='Enter a name for your new collection.';moveImageDialog('move-collection-name');return;}
    draft.collectionName=name;
    group={id:'mobile-'+[...crypto.getRandomValues(new Uint8Array(12))].map(b=>b.toString(16).padStart(2,'0')).join(''),name};
  }
  if(!group){draft.error='Choose a collection, or create a new one.';draft.open=true;moveImageDialog('move-collection-'+(moveDestinations()[0]?.id||'new'));return;}
  draft.saving=true;draft.error='';moveImageDialog('move-confirm');
  try{
    await setSetting('photoCollectionsV1',assignPhotoCollection(state.photoCollections,photo,group));
    await reloadPhotos();
    if(moveDraft!==draft)return;
    if(state.tab==='gallery'&&!findArtPlayback)state.activeCollection=group.id;
    renderPlayer();draft.saving=false;closeDialog();toast('Moved to '+group.name+'.');
  }catch(error){
    if(moveDraft!==draft)return;
    draft.saving=false;draft.error=error.message||'The image could not be moved. Try again.';moveImageDialog('move-confirm');
  }
}

async function checkNativeArt(){
  if(nativeArtChecking||nativeArtVisible)return;
  nativeArtChecking=true;
  try{await nativeArt.detect();if(state.view==='player'){const focus=document.activeElement?.dataset.focus;renderPlayer();if(state.controls&&focus)restoreFocus(focus);}else if(state.tab==='settings'&&!dialog.open)render(document.activeElement?.dataset.focus);}
  finally{nativeArtChecking=false;}
}
function renderNativeArtDialog(){
  if(!nativeArtVisible||!nativeArtPhoto)return;
  const working=['checking','saving','opening'].includes(nativeArtPhase),known=!!nativeArtPrepared?.contentId;
  const copy=nativeArtPhase==='checking'?'Checking Samsung Art collection…':nativeArtPhase==='saving'?'Adding artwork to Samsung Art…':nativeArtPhase==='opening'?'Opening Samsung Art Mode…':nativeArtPhase==='error'?nativeArtError:known?'Already in Samsung Art.':'Add this artwork to Samsung Art and show it.';
  const styled=state.nativeArtIncludeLook;
  const note=styled?(known?'Reuses this styled Samsung copy.':'Saves a separate copy with this image’s frame, mat, bevel and fit.')+' Samsung’s extra mat is removed. Its picture settings still apply. Your original and other copies stay unchanged.':known?'Uses the existing Samsung copy. Samsung’s own mat and picture settings apply in Art Mode.':'A copy will be saved in Samsung’s My Photos. Your original stays in SART. Samsung’s mat and picture settings apply in Art Mode.';
  const down=working?'native-art-cancel':'native-art-confirm',preview=nativeArtPrepared?.previewUrl||photoUrl(nativeArtPhoto,true);
  showDialog(`${dialogHead('Samsung Art Mode')}<div class="native-art-body"><div class="native-art-look-row"><div><strong>Include SART frame & mat</strong><small>Includes bevel and image fit. Remembered on this TV.</small></div><button type="button" class="button resume-toggle" data-action="native-art-look" data-focus="native-art-look" role="switch" aria-label="Include SART frame and mat" aria-checked="${styled}" data-nav-up="close-dialog" data-nav-down="${down}" ${working?'disabled':''}><span>${styled?'On':'Off'}</span><span class="toggle-track" aria-hidden="true"></span></button></div><div class="native-art-preview"><img src="${safeText(preview)}" alt="${safeText(nativeArtPhoto.title+(styled?' with SART frame and mat':''))}"><strong>${safeText(nativeArtPhoto.title)}</strong></div><p role="status">${safeText(copy)}</p><p class="native-art-note">${safeText(working&&!known?'Your SART original stays available.':note)}</p></div><div class="dialog-actions">${button('close-dialog',working?'Cancel':'Back','','','native-art-cancel',`data-nav-up="${working?'close-dialog':'native-art-look'}" data-nav-right="native-art-confirm"`)}${working?'':button(nativeArtPhase==='error'?'native-art-check':'native-art-confirm',nativeArtPhase==='error'?'Try again':known?'Show in Art Mode':'Add & show in Art Mode','play','primary','native-art-confirm','data-nav-up="native-art-look" data-nav-left="native-art-cancel"')}</div>`,working?'native-art-cancel':'native-art-confirm',()=>dialog.classList.add('native-art-options'));
  dialog.querySelector('[data-focus="close-dialog"]').dataset.navDown=working?'native-art-cancel':'native-art-look';
}
function clearNativeArtwork(){if(nativeArtPrepared?.previewUrl)URL.revokeObjectURL(nativeArtPrepared.previewUrl);nativeArtPrepared=null;}
async function prepareNativeArtwork(){
  if(!nativeArtVisible||!nativeArtPhoto)return;const generation=++nativeArtGeneration,photo=nativeArtPhoto,active=()=>generation===nativeArtGeneration&&nativeArtVisible;
  clearNativeArtwork();nativeArt.cancel();nativeArtPhase='checking';renderNativeArtDialog();let previewUrl='';
  try{
    // File-origin TVs do not treat fetched Blob URLs as connect-src 'self'.
    // Saved photos already have a bounded Blob; read it without a fetch.
    let source=photo.blob;
    if(!(source instanceof Blob)){const response=await fetch(photoUrl(photo));if(!response.ok)throw new Error('The artwork could not be read.');source=await response.blob();}
    if(source.size>12*1024*1024)throw new Error('Choose a JPEG artwork under 12 MB.');let bytes=new Uint8Array(await source.arrayBuffer());
    const sourceHash=await mobileHash(bytes);if(!active())return;
    let appearanceKey='';
    if(state.nativeArtIncludeLook){const rendered=await renderNativeLook(bytes,artLook(photo),{active});if(!active())return;bytes=new Uint8Array(await rendered.blob.arrayBuffer());appearanceKey=rendered.appearanceKey;previewUrl=URL.createObjectURL(rendered.blob);}
    const hash=await mobileHash(bytes),exports=await getSetting('nativeArtExportsV1');if(!active())return;
    const cached=nativeExportMatch(exports,photo.id,hash,appearanceKey),library=await nativeArt.library();if(!active())return;
    nativeArtPrepared={bytes,hash,sourceHash,appearanceKey,previewUrl,contentId:cached&&library.items.some(p=>p.content_id===cached.contentId)?cached.contentId:null};previewUrl='';nativeArtPhase='confirm';renderNativeArtDialog();
  }catch(error){if(active()){nativeArtPhase='error';nativeArtError=error.message;renderNativeArtDialog();}}
  finally{if(previewUrl)URL.revokeObjectURL(previewUrl);}
}
async function showNativeArtwork(){
  if(!nativeArtVisible||!nativeArtPhoto||!nativeArtPrepared||nativeArtPhase!=='confirm')return;
  const generation=++nativeArtGeneration,photo=nativeArtPhoto,prepared=nativeArtPrepared,active=()=>generation===nativeArtGeneration&&nativeArtVisible;
  nativeArtPhase=prepared.contentId?'opening':'saving';renderNativeArtDialog();
  try{
    const options={noMat:!!prepared.appearanceKey};
    if(prepared.contentId){await nativeArt.showExisting(prepared.contentId,options);return;}
    const result=await nativeArt.save(prepared.bytes,null),stored=await getSetting('nativeArtExportsV1');
    const exports=nativeExportRemember(stored,photo.id,{contentId:result.contentId,sha256:prepared.hash,...(prepared.appearanceKey?{appearanceKey:prepared.appearanceKey,sourceSha256:prepared.sourceHash}:{})});await setSetting('nativeArtExportsV1',exports);
    if(!active()){nativeArt.cancel();return;}nativeArtPhase='opening';renderNativeArtDialog();await nativeArt.show(result.contentId,options);
  }catch(error){nativeArt.cancel();if(active()){nativeArtPhase='error';nativeArtError=error.message||'Samsung Art Mode could not open.';renderNativeArtDialog();}}
}
function pairDialog() {
  const origin = state.connection?.origin || window.SART_CONFIG?.libraryUrl || '';
  showDialog(`${dialogHead('PC companion setup')}<p>This optional library connection requires an HTTPS address with a certificate the TV trusts. For direct browser uploads from any device, use Add photos.</p>
    <form id="pair-form"><label for="mac-address">PC library HTTPS address</label><input id="mac-address" name="address" type="text" value="${safeText(origin)}" placeholder="https://192.0.2.10:8767" autocomplete="off" spellcheck="false" data-focus="mac-address" data-nav-up="close-dialog" data-nav-down="pair-code" required>
    <label for="pair-code">Connection code</label><input id="pair-code" name="code" type="text" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="off" placeholder="000000" data-focus="pair-code" data-nav-up="mac-address" data-nav-down="pair-submit" required>
    <p class="remote-hint">After entering the code, press ↓ to reach Connect & save photos.</p><p class="dialog-error" id="pair-error" role="alert"></p><div class="dialog-actions"><button class="button" type="button" data-action="close-dialog" data-focus="pair-cancel" data-nav-up="pair-code" data-nav-right="pair-submit">Cancel</button><button class="button primary" id="pair-submit" data-focus="pair-submit" data-nav-up="pair-code" data-nav-left="pair-cancel" type="submit">Connect & save photos</button></div></form>`, 'pair-code');
}

function advancedConnectionsDialog(){
  showDialog(`${dialogHead('Advanced connections')}<p>Optional companion library synchronisation. For uploads from a phone, tablet or computer browser, choose Add photos.</p><div class="dialog-actions">${button('pair','PC companion setup','','','legacy-pair','data-nav-up="close-dialog" data-nav-right="dialog-done"')}${button('close-dialog','Done','','primary','dialog-done','data-nav-up="close-dialog" data-nav-left="legacy-pair"')}</div>`,'legacy-pair');
}
async function startMobile(){
  const startId=++mobileStartId;
  mobilePanel='connect';
  mobileVisible=true;mobileRenderedPhase='';mobile.phase='starting';renderMobileDialog();
  try{await ready();if(startId!==mobileStartId||!mobileVisible)return;if(!window.tizen)throw new Error('Direct uploads run on the Samsung TV. Open Add photos there.');const ip=window.webapis?.network?.getIp?.();if(!ip)throw new Error('The TV’s network address is unavailable. Check its Wi-Fi connection and try again.');await mobile.start(ip);}
  catch(error){if(startId!==mobileStartId||!mobileVisible||error.name==='AbortError')return;mobile.error=error.message;mobile.phase='error';renderMobileDialog();}
}
function renderMobileDialog(){
  const focus=document.activeElement?.dataset.focus,phase=mobile.phase;
  if(phase!=='waiting'&&!['connect','confirm-close'].includes(mobilePanel)){mobilePanel='connect';mobile.closeSetup();}
  const renderKey=phase+':'+mobilePanel+':'+mobile.setupPhase,changingPhase=!mobileRenderedPhase.startsWith(phase+':');
  const receipt=mobile.receipt,progress=mobile.progress,detail=progress?.phase==='existing'?'Already in this collection. No extra copy saved.':progress?.phase==='receiving'?`Receiving “${progress.title}”`:
    progress?.phase==='saving'?`Saving “${progress.title}”…`:progress?.phase==='saved'?'Photo saved on this TV.':
    progress?.phase==='error'?progress.message:progress?.phase==='cancelled'?'Transfer cancelled. Saved photos stay in your gallery.':'Choose photos and a destination collection on your device.';
  if(mobileRenderedPhase===renderKey&&dialog.open){
    const line=dialog.querySelector('#mobile-progress-text');if(line)line.textContent=detail;
    const bar=dialog.querySelector('#mobile-progress');if(bar)bar.value=progress?.total?Math.round(progress.bytes/progress.total*100):['saved','existing'].includes(progress?.phase)?100:0;
    const count=dialog.querySelector('#mobile-saved');if(count)count.textContent=mobile.saved+' added'+(mobile.skipped?' · '+mobile.skipped+' already in collection':'');
    const card=dialog.querySelector('#mobile-receipt');if(card){card.hidden=!receipt;if(receipt){dialog.querySelector('#mobile-receipt-status').textContent=receipt.phase==='existing'?'Already in collection':'Latest photo added';dialog.querySelector('#mobile-receipt-title').textContent=receipt.title;dialog.querySelector('#mobile-receipt-collection').textContent='Collection · '+receipt.collectionName;}}return;
  }
  mobileRenderedPhase=renderKey;
  const connected=phase==='connected',waiting=phase==='waiting',setup=mobilePanel==='setup',details=mobilePanel==='details';
  const qr=(address,label)=>{try{const code=window.qrcode(0,'M');code.addData(address);code.make();return `<div class="mobile-qr" aria-label="${label}">${code.createSvgTag({cellSize:4,margin:16,scalable:true})}</div>`;}catch{return '<p>QR unavailable. Use the address shown.</p>';}};
  const action=(name,label,key,nav='',primary=false)=>button(name,label,'',primary?'primary':'',key,`data-nav-up="close-dialog" ${nav}`);
  let body='',footer='',defaultFocus='mobile-done',footerHint='Keep this screen open while connecting.';
  if(mobilePanel==='confirm-close'){
    body=`<div class="mobile-state"><h3>Stop sending photos?</h3><p>The current transfer will stop. Photos already saved stay in your gallery.</p></div>`;
    footer=action('mobile-connect','Keep sending','mobile-keep','data-nav-right="mobile-stop"',true)+action('mobile-stop','Stop & disconnect','mobile-stop','data-nav-left="mobile-keep"');defaultFocus='mobile-keep';
  }else if(details){
    body=`<div class="mobile-certificate-details"><h3>Verify this TV’s certificate</h3><p>${safeText(mobile.certificateName||'')}</p><p>Compare this SHA-256 fingerprint with the certificate on your device before enabling trust.</p><code>${safeText(mobile.rootFingerprint||'Unavailable')}</code><p>The setup download uses HTTP for public certificate files only. Photos and pairing use the separate HTTPS connection.</p></div>`;
    footer=action('mobile-setup','Back to setup','mobile-setup');defaultFocus='mobile-setup';footerHint='Certificate installation and trust need your approval.';
  }else if(setup){
    if(mobile.setupPhase==='ready')body=`${qr(mobile.setupUrl,'Scan for the public TV certificate setup page')}<div class="mobile-instructions"><h3>Set up this device once</h3><p>Scan to download this TV’s public certificate.</p><ol><li>Download and install the profile.</li><li>Enable certificate trust in device Settings.</li><li>Return here and choose Back to connection.</li></ol><p class="mobile-address">${safeText(mobile.setupUrl)}</p><p class="remote-hint">Setup files use HTTP. Verify the fingerprint in Certificate details before trusting. Photo uploads use HTTPS.</p></div>`;
    else body=`<div class="mobile-state"><h3>${mobile.setupPhase==='error'?'Setup unavailable':'Opening device setup…'}</h3><p>${safeText(mobile.setupPhase==='error'?mobile.setupError:'Preparing the public certificate download on this TV.')}</p></div>`;
    footer=action('mobile-details','Certificate details','mobile-details','data-nav-right="mobile-connect"')+action('mobile-connect','Back to connection','mobile-connect','data-nav-left="mobile-details"',true);defaultFocus='mobile-connect';footerHint='One-time setup on each phone, tablet or computer.';
  }else if(waiting){
    body=`${qr(mobile.url,'Scan to connect a phone or tablet')}<div class="mobile-instructions"><h3>Scan to connect</h3><p>Use your phone or tablet camera.</p><span class="mobile-label">Or open this address in a browser</span><p class="mobile-address">${safeText(mobile.url?.split('#')[0]||'')}</p><span class="mobile-label">Enter this code</span><div class="mobile-match-code">${safeText(mobile.code)}</div><p class="remote-hint">Approve the matching code on this TV. New devices need first-time certificate setup.</p></div>`;
    footer=action('mobile-setup','Set up this device','mobile-setup','data-nav-right="mobile-new"')+action('mobile-new','New code','mobile-new','data-nav-left="mobile-setup" data-nav-right="mobile-done"')+action('mobile-close','Close','mobile-done','data-nav-left="mobile-new"');defaultFocus='mobile-setup';footerHint='Phone, tablet or computer · Same home Wi-Fi';
  }else if(phase==='approval'){
    body=`<div class="mobile-state"><h3>Allow this device?</h3><p>${safeText(mobile.deviceName||'A browser')} wants to add photos and manage Find art sources during this connection. Check that the code on its screen matches.</p><div class="mobile-match-code">${safeText(mobile.code)}</div></div>`;
    footer=action('mobile-close','Deny','mobile-deny','data-nav-right="mobile-allow"')+action('mobile-allow','Allow device','mobile-allow','data-nav-left="mobile-deny"',true);defaultFocus='mobile-deny';footerHint='Only approve the device you are connecting.';
  }else{
    const title=phase==='starting'?'Opening the connection…':phase==='connecting'?'Connecting your device…':connected?'Device connected':'Connection ended';
    const copy=connected?'Choose Photos or Art sources on your device.':phase==='starting'?'Preparing a secure connection on this TV.':phase==='connecting'?'Keep the upload page open on the same home Wi-Fi.':mobile.error||'Saved photos stay in your gallery.';
    body=`<div class="mobile-state ${connected?'mobile-connected':''}"><span class="mobile-state-symbol" aria-hidden="true">${connected?'✓':phase==='starting'||phase==='connecting'?'…':'○'}</span><h3>${title}</h3><p>${safeText(copy)}</p>${connected?`<div class="mobile-transfer-status"><strong id="mobile-saved">${mobile.saved} added${mobile.skipped?' · '+mobile.skipped+' already in collection':''}</strong><p id="mobile-progress-text" role="status">${safeText(detail)}</p><progress id="mobile-progress" max="100" value="0" aria-label="Photo transfer progress"></progress><div id="mobile-receipt" class="mobile-receipt" role="status" aria-live="polite" aria-atomic="true" ${receipt?'':'hidden'}><span id="mobile-receipt-status">${receipt?.phase==='existing'?'Already in collection':'Latest photo added'}</span><strong id="mobile-receipt-title">${safeText(receipt?.title||'')}</strong><p id="mobile-receipt-collection">${receipt?'Collection · '+safeText(receipt.collectionName):''}</p></div></div>`:''}</div>`;
    footer=action('mobile-close',connected?'Finish & disconnect':'Close','mobile-done',mobile.active?'':'data-nav-right="mobile-new"',connected)+(!mobile.active&&phase!=='starting'?action('mobile-new','New code','mobile-new','data-nav-left="mobile-done"',true):'');footerHint=connected?'Keep both screens open while sending.':'Saved photos stay available offline.';
  }
  const layout=(waiting&&!details&&(!setup||mobile.setupPhase==='ready')&&mobilePanel!=='confirm-close')?'':'single';
  const title=setup||details?'Device setup':'Add photos';
  const nextFocus=!changingPhase&&footer.includes(`data-focus="${focus}"`)?focus:defaultFocus;
  showDialog(`${dialogHead(title)}<p class="mobile-summary">${setup||details?'Trust this TV once to use secure photo uploads.':'Add photos or manage art sources from your device.'}</p><div class="mobile-pair-layout ${layout}">${body}</div><div class="dialog-actions"><span class="remote-hint">${footerHint}</span>${footer}</div>`,phase==='approval'||mobilePanel==='confirm-close'?defaultFocus:nextFocus,()=>dialog.classList.add('mobile-options'));
  const close=dialog.querySelector('[data-focus="close-dialog"]');close.dataset.action='mobile-close';close.dataset.navDown=defaultFocus;
}
function mobileTransferBusy(){return mobile.phase==='connected'&&['receiving','saving'].includes(mobile.progress?.phase);}
async function saveMobilePhoto(meta,blob,isActive){
  // Re-encode only pixels on the TV as well, so even a modified sender cannot
  // smuggle GPS or other metadata into the stored display copy.
  const url=URL.createObjectURL(blob),image=new Image();let clean;
  try{await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error('That photo could not be decoded.'));image.src=url;});
    const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;canvas.getContext('2d').drawImage(image,0,0);
    clean=await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('The photo could not be saved.')),'image/jpeg',.9));canvas.width=canvas.height=1;
  }finally{URL.revokeObjectURL(url);}
  const thumbnailBlob=await makeThumbnail(clean);if(!isActive())throw new Error('The connection was closed before this photo was saved.');
  await reloadPhotos();const group=mobileUploadCollection(meta,uploadCollections());if(!isActive())throw new Error('The connection was closed before this photo was saved.');
  const photo={id:meta.id,title:meta.title,collectionId:group.id,collectionName:group.name,blob:clean,thumbnailBlob,sha256:await mobileHash(await clean.arrayBuffer()),transferSha256:meta.sha256,addedAt:Date.now(),source:'mobile',demo:false};
  if(!isActive())throw new DOMException('The connection was closed before this photo was saved.','AbortError');
  const result=await saveUploadedPhoto(photo,isActive);await reloadPhotos();if(isActive()&&state.view==='gallery')render();
  const stored=state.photos.find(p=>p.id===result.id),destination=uploadCollections().find(g=>g.id===stored?.collectionId)||group;
  return {...result,collectionId:destination.id,collectionName:destination.name};
}

function globalAppearancePreview(photo,look) {
  return `<div class="global-preview-column"><p class="global-preview-label">Preview</p><div class="global-look-preview ${look.matte==='none'?'no-matte':''}" style="--matte:${MATTES[look.matte]};--fit:${artLook(photo).fit};--brightness:${state.settings.brightness};--contrast:${state.settings.contrast}"><div class="picture-frame" data-frame="${look.frame}"><div class="mat-surface" data-mat-style="${look.matStyle}"><div class="art-window"><img src="${safeText(photoUrl(photo,true))}" alt="${safeText(photo.title)}"></div></div>${['top','right','bottom','left'].map(side=>`<i class="frame-rail ${side}" aria-hidden="true"></i>`).join('')}</div></div><p class="global-preview-caption">${safeText(photo.title)}</p></div>`;
}
function slideshowControls(){
  const s=state.settings,timer='slide-interval-'+s.interval,order='slide-order-'+s.order,motion='slide-motion-'+s.motion,effect='slide-transition-'+s.transition,duration='slide-duration-'+s.transitionDuration;
  const choices=(key,prefix,items,navigate)=>items.map(([value,label],index)=>`<button type="button" class="button" data-action="set-player-setting" data-setting-name="${key}" data-value="${value}" data-focus="${prefix+value}" ${Object.entries(navigate(index,items)).map(([direction,target])=>`data-nav-${direction}="${target}"`).join(' ')} aria-pressed="${value===s[key]}">${label}</button>`).join('');
  return `<div class="slideshow-settings">
    <section class="slide-setting-row"><h3>Artwork timer</h3><div class="slide-times" role="group" aria-label="Artwork timer">${choices('interval','slide-interval-',[[30,'30 sec'],[60,'1 min'],[300,'5 min'],[900,'15 min'],[3600,'1 hour']],(i,items)=>({left:'slide-interval-'+items[Math.max(0,i-1)][0],right:'slide-interval-'+items[Math.min(4,i+1)][0],up:'look-tab-slideshow',down:order}))}</div></section>
    <section class="slide-setting-row"><h3>Slideshow order</h3><div class="slide-orders" role="group" aria-label="Slideshow order">${choices('order','slide-order-',[['sequence','In order'],['shuffle','Shuffle']],i=>({left:'slide-order-sequence',right:'slide-order-shuffle',up:timer,down:motion}))}</div></section>
    <section class="slide-setting-row"><h3>Artwork motion</h3><div class="slide-orders" role="group" aria-label="Artwork motion">${choices('motion','slide-motion-',[['off','Off'],['gentle','Gentle pan & zoom']],i=>({left:'slide-motion-off',right:'slide-motion-gentle',up:order,down:effect}))}</div></section>
    <section class="slide-setting-row"><h3>Transition effect</h3><div class="slide-effects" role="group" aria-label="Transition effect">${choices('transition','slide-transition-',Object.entries(TRANSITIONS),(i,items)=>({left:'slide-transition-'+items[Math.max(0,i-1)][0],right:'slide-transition-'+items[Math.min(items.length-1,i+1)][0],up:motion,down:duration}))}</div></section>
    <section class="slide-setting-row"><h3>Transition duration</h3><div class="slide-durations" role="group" aria-label="Transition duration">${choices('transitionDuration','slide-duration-',[[.5,'0.5 sec'],[1,'1 sec'],[2,'2 sec']],(i,items)=>({left:'slide-duration-'+items[Math.max(0,i-1)][0],right:'slide-duration-'+items[Math.min(2,i+1)][0],up:effect,down:'slide-play'}))}</div></section>
  </div>`;
}

function matDialog(focus='') {
  const global=globalLookDraft!==null;
  const outsidePlayer=state.view!=='player'&&!global;
  const photo=currentPhoto()||state.photos.find(p=>p.id==='demo-16568')||state.photos[0];
  const look=global?globalLookDraft:artLook(photo);
  const mats = Object.keys(MATTES);
  const selected=lookSection==='frame'?'frame-'+look.frame:lookSection==='mat'?'mat-style-'+look.matStyle:lookSection==='picture'?'tune-brightness':lookSection==='slideshow'?'slide-interval-'+state.settings.interval:'fit-'+look.fit;
  let content;
  if(lookSection==='frame'){
    const frames=Object.keys(FRAMES);
    content=`<div class="frame-options" role="group" aria-label="Frame style">${frames.map((id,index)=>`<button type="button" class="frame-option" data-action="set-frame" data-frame="${id}" data-focus="frame-${id}" data-nav-left="frame-${frames[index%3?index-1:index]}" data-nav-right="frame-${frames[index%3<2?Math.min(index+1,frames.length-1):index]}" data-nav-up="${index<3?'look-tab-frame':'frame-'+frames[index-3]}" data-nav-down="${index<3?'frame-'+frames[index+3]:'mat-done'}" aria-pressed="${id===look.frame}"><span class="mini-frame picture-frame" data-frame="${id}" style="--matte:${MATTES.paper};--fit:cover;--brightness:1"><span class="mat-surface"><span class="art-window"><img src="${safeText(photoUrl(photo,true))}" alt=""></span></span>${['top','right','bottom','left'].map(side=>`<i class="frame-rail ${side}" aria-hidden="true"></i>`).join('')}</span><span class="frame-label">${FRAMES[id]}<span class="choice-check" aria-hidden="true">✓</span></span></button>`).join('')}</div>`;
  }else if(lookSection==='mat'){
    content=`<div class="mat-style-row" role="group" aria-label="Mat finish"><span class="mat-style-label">Paper edge</span>${Object.entries(MAT_STYLES).map(([id,label],index)=>`<button type="button" class="mat-style-option" data-action="set-mat-style" data-mat-style="${id}" data-focus="mat-style-${id}" data-nav-left="mat-style-${Object.keys(MAT_STYLES)[Math.max(0,index-1)]}" data-nav-right="mat-style-${Object.keys(MAT_STYLES)[Math.min(Object.keys(MAT_STYLES).length-1,index+1)]}" data-nav-up="look-tab-mat" data-nav-down="mat-${look.matte}" aria-pressed="${id===look.matStyle}"><span class="mat-finish-preview mat-surface" data-mat-style="${id}" style="--matte:${MATTES[look.matte]}"><span class="art-window"><img src="${safeText(photoUrl(photo,true))}" alt=""></span></span><span>${label}</span><span class="choice-check" aria-hidden="true">✓</span></button>`).join('')}</div><div class="mat-options" role="group" aria-label="Mat colour">${Object.entries(MATTES).map(([id,colour],index)=>`<button type="button" class="mat-option" data-action="set-mat" data-matte="${id}" data-focus="mat-${id}" data-nav-left="mat-${mats[index%3?index-1:index]}" data-nav-right="mat-${mats[index%3<2?index+1:index]}" data-nav-up="${index<3?'mat-style-'+look.matStyle:'mat-'+mats[index-3]}" data-nav-down="${index<6?'mat-'+mats[index+3]:'mat-done'}" aria-pressed="${id===look.matte}"><span class="swatch" style="background:${colour}"></span>${MAT_NAMES[id]}<span class="mat-check" aria-hidden="true">✓</span></button>`).join('')}</div>`;
  }else if(lookSection==='picture'){
    const controls=pictureControls('look-tab-picture','mat-done');
    content=outsidePlayer?`<div class="picture-adjustment-layout">${globalAppearancePreview(photo,look)}${controls}</div>`:controls;
  }else if(lookSection==='slideshow'){
    content=slideshowControls();
  }else{
    content=`<div class="fit-options" role="group" aria-label="Image fit">${[['cover','Fill space','Fills the space; crops the edges.'],['contain','Fit image','Keeps the whole image visible.']].map(([fit,label,description])=>`<button type="button" class="fit-option" data-action="set-fit" data-fit="${fit}" data-focus="fit-${fit}" data-nav-left="fit-cover" data-nav-right="fit-contain" data-nav-up="look-tab-fit" data-nav-down="mat-done" aria-pressed="${fit===look.fit}"><span class="fit-preview"><img src="${safeText(photoUrl(photo,true))}" alt="" style="object-fit:${fit}"></span><span class="fit-label">${label}<span class="fit-check" aria-hidden="true">✓</span></span><span class="fit-description">${description}</span></button>`).join('')}</div>`;
  }
  showDialog(`${dialogHead(global?'Frame & mat for all artwork':'Artwork display')}<p>${global?'Choose one frame, mat colour and paper edge for every image. Each image keeps its fit.':lookSection==='picture'?'Picture adjustments apply to all artwork.':lookSection==='slideshow'?'The timer controls automatic changes. Pan & zoom also works when browsing manually.':'Frame, mat and fit are saved for this artwork.'}</p><div class="appearance-tabs" role="tablist" aria-label="Artwork appearance">${(global?[['frame','Frame'],['mat','Mat']]:outsidePlayer?[['picture','Brightness & contrast'],['slideshow','Slideshow']]:[['frame','Frame'],['mat','Mat'],['fit','Fit'],['picture','Brightness & contrast'],['slideshow','Slideshow']]).map(([id,label])=>`<button type="button" role="tab" id="look-tab-${id}" data-action="look-tab" data-look-tab="${id}" data-focus="look-tab-${id}" data-nav-up="close-dialog" data-nav-down="${id===lookSection?selected:'look-tab-'+lookSection}" aria-selected="${id===lookSection}" aria-controls="appearance-panel" tabindex="${id===lookSection?'0':'-1'}">${label}</button>`).join('')}</div>${global?'<div class="global-look-layout">'+globalAppearancePreview(photo,look):''}<div id="appearance-panel" class="appearance-panel" role="tabpanel" aria-labelledby="look-tab-${lookSection}">${content}</div>${global?'</div>':''}<div class="dialog-actions mat-actions"><span class="remote-hint">← → Adjust / switch tabs · ↑ ↓ Browse · Back closes</span>${lookSection==='slideshow'?button('dialog-toggle-play',state.playing?'Pause slideshow':'Start slideshow','','','slide-play','data-nav-up="slide-duration-'+state.settings.transitionDuration+'" data-nav-right="mat-done"'):''}${global?button('close-dialog','Cancel','','','global-cancel','data-nav-right="mat-done" data-nav-up="'+selected+'"'):''}<button type="button" class="button primary" data-action="${global?'apply-global-look':'close-dialog'}" data-focus="mat-done" data-nav-up="${selected}" ${global?'data-nav-left="global-cancel"':''}>${global?'Apply to all artwork':'Done'}</button></div>`,focus||selected,()=>{
    dialog.classList.add('art-options');
    if(global)dialog.classList.add('global-art-options');
    if(lookSection==='slideshow')dialog.classList.add('slideshow-options');
    dialog.querySelector('[data-focus="close-dialog"]').dataset.navDown='look-tab-'+lookSection;
    const done=dialog.querySelector('[data-focus="mat-done"]');
    done.dataset.navUp=lookSection==='slideshow'?'slide-duration-'+state.settings.transitionDuration:lookSection==='picture'?'picture-reset':lookSection==='mat'?'mat-'+look.matte:selected;
    if(lookSection==='slideshow')done.dataset.navLeft='slide-play';
  });
}

function pictureControls(up,done) {
  return `<section class="picture-tuning" aria-label="Brightness and contrast">${[['brightness','Brightness',35,100,up,'tune-contrast'],['contrast','Contrast',50,150,'tune-brightness','picture-reset']].map(([key,label,min,max,above,below])=>`<div class="tuning-row"><div class="tuning-label"><label for="tune-${key}">${label}</label><output id="value-${key}" for="tune-${key}">${Math.round(state.settings[key]*100)}%</output></div><input id="tune-${key}" type="range" min="${min}" max="${max}" step="5" value="${Math.round(state.settings[key]*100)}" data-tuning="${key}" data-focus="tune-${key}" data-nav-up="${above}" data-nav-down="${below}" data-nav-enter="${done}" aria-valuetext="${Math.round(state.settings[key]*100)} percent"></div>`).join('')}<div class="picture-reset"><p>← → Adjust · ↑ ↓ Move · OK Done</p><button type="button" class="button" data-action="reset-picture" data-focus="picture-reset" data-nav-up="tune-contrast" data-nav-down="${done}">Reset to 100%</button></div></section>`;
}

async function updateTuning(key,percent) {
  if(!['brightness','contrast'].includes(key))return;
  state.settings=normaliseSettings({...state.settings,[key]:Number(percent)/100});
  const value=Math.round(state.settings[key]*100);
  const input=dialog.querySelector(`[data-tuning="${key}"]`),output=dialog.querySelector('#value-'+key);
  if(input){input.value=String(value);input.setAttribute('aria-valuetext',value+' percent');}
  if(output)output.textContent=value+'%';
  root.querySelector('.canvas')?.style.setProperty('--'+key,String(state.settings[key]));
  dialog.querySelector('.picture-adjustment-layout .global-look-preview')?.style.setProperty('--'+key,String(state.settings[key]));
  const setting=root.querySelector('[data-focus="setting-brightness"]');
  if(setting){const label=Math.round(state.settings.brightness*100)+'% / '+Math.round(state.settings.contrast*100)+'%';setting.querySelector('span').textContent=label;setting.setAttribute('aria-label','Brightness and contrast: '+label);}
  await setSetting('preferences',state.settings);
}

function settingDialog(key) {
  if(key==='brightness'){
    lookSection='picture';matDialog();
    return;
  }
  const setting=settingChoices[key];
  if(!setting)return;
  const focus=index=>'choice-'+key+'-'+index;
  const selected=setting.choices.findIndex(([value])=>value===state.settings[key]);
  const columns=key==='matte'?3:1;
  showDialog(`${dialogHead(setting.title)}<p>${setting.description}</p><div class="choice-list ${key==='matte'?'mat-choice-list':''}" role="group" aria-label="${setting.title}">${setting.choices.map(([value,label],index)=>`<button type="button" class="choice-option" data-action="set-preference" data-setting-name="${key}" data-value="${value}" data-focus="${focus(index)}" data-nav-up="${index>=columns?focus(index-columns):'close-dialog'}" data-nav-down="${index+columns<setting.choices.length?focus(index+columns):'choice-cancel'}" ${columns>1?`data-nav-left="${focus(index%3?index-1:index)}" data-nav-right="${focus(index%3<2?index+1:index)}"`:''} aria-pressed="${index===selected}"><span>${key==='matte'?`<span class="choice-swatch" style="background:${MATTES[value]}"></span>`:''}${label}</span><span class="choice-check" aria-hidden="true">✓</span></button>`).join('')}</div><div class="dialog-actions choice-actions"><span class="remote-hint">↑ ↓ Browse · OK Select</span><button type="button" class="button" data-action="close-dialog" data-focus="choice-cancel" data-nav-up="${focus(setting.choices.length-1)}">Cancel</button></div>`,focus(Math.max(0,selected)));
  dialog.querySelector('[data-focus="close-dialog"]').dataset.navDown=focus(0);
}

async function updatePreference(key,value) {
  state.settings=normaliseSettings({...state.settings,[key]:value});
  await setSetting('preferences',state.settings);
  scheduleSlide();
}

async function updateLook(key, value) {
  if(globalLookDraft){
    globalLookDraft=normaliseLook({...globalLookDraft,[key]:value});
    const focus=key==='matte'?'mat-'+value:key==='matStyle'?'mat-style-'+value:'frame-'+value;
    matDialog(focus);return;
  }
  state.looks[state.current] = { ...artLook(currentPhoto()), [key]: value };
  await setSetting('looks', state.looks);
  render();
  if (dialog.open) {
    const attribute=key==='matStyle'?'mat-style':key;
    for (const el of dialog.querySelectorAll(`button[data-${attribute}]`)) el.setAttribute('aria-pressed', String(el.getAttribute('data-'+attribute) === value));
    const done=dialog.querySelector('[data-focus="mat-done"]');
    const look=artLook(currentPhoto());
    if(done)done.dataset.navUp=lookSection==='frame'?'frame-'+look.frame:lookSection==='mat'?'mat-'+look.matte:'fit-'+look.fit;
    const tab=dialog.querySelector(`[data-look-tab="${lookSection}"]`);
    if(tab)tab.dataset.navDown=lookSection==='mat'?'mat-style-'+look.matStyle:done?.dataset.navUp;
    if(lookSection==='mat'){
      for(const el of dialog.querySelectorAll('.mat-style-option'))el.dataset.navDown='mat-'+look.matte;
      for(const id of Object.keys(MATTES).slice(0,3))dialog.querySelector('[data-focus="mat-'+id+'"]').dataset.navUp='mat-style-'+look.matStyle;
      for(const el of dialog.querySelectorAll('.mat-finish-preview'))el.style.setProperty('--matte',MATTES[look.matte]);
    }
  }
}

async function requestJson(origin, path, options = {}) {
  origin=validateLibraryUrl(origin);
  const timeout=requestTimeout(15000);
  try{
    const response = await fetch(origin + path, { ...options, credentials:'omit', cache:'no-store', redirect:'error', signal:timeout.signal });
    const bytes=await readLimitedResponse(response,response.ok?LIBRARY_JSON_LIMIT:16384,timeout.signal);
    let body;try{body=JSON.parse(new TextDecoder().decode(bytes));}catch{throw new Error('The PC returned an invalid response.');}
    if (!response.ok) throw new Error(body.error || 'Could not connect to your PC. Check the address and Wi-Fi connection.');
    return body;
  }finally{timeout.cancel();}
}

async function connect(form) {
  const error = document.getElementById('pair-error'), submit = document.getElementById('pair-submit');
  error.textContent = ''; submit.disabled = true;
  try {
    const origin = validateLibraryUrl(form.address.value.trim());
    const paired = await requestJson(origin, '/api/pair', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({code:form.code.value.trim()}) });
    if (!/^[A-Za-z0-9_-]{40,100}$/.test(paired.token)) throw new Error('The PC returned an invalid connection.');
    state.connection = { origin, token:paired.token };
    await setSetting('connection', state.connection);
    closeDialog();
    await syncPhotos(true);
  } catch (err) { error.textContent = err.message || 'Connection failed. Please try again.'; }
  finally { submit.disabled = false; }
}

async function syncPhotos(announce = false) {
  if (!state.connection || state.syncing || state.hidden) return;
  state.syncing = true;
  const connection = { ...state.connection };
  let added = 0;
  try {
    const headers = { Authorization:'Bearer '+connection.token };
    const manifest = await requestJson(connection.origin, '/api/library', {headers});
    const items = validateManifest(manifest);
    state.online = true; state.syncError = '';
    const existing = new Map(state.photos.map(p=>[p.id,p]));
    for (const item of items) {
      if (!state.connection || state.connection.token !== connection.token) break;
      if (state.ignored.includes(item.id) || existing.get(item.id)?.sha256 === item.sha256) continue;
      const timeout=requestTimeout(30000);let blob;
      try{
        const response = await fetch(connection.origin+'/api/images/'+item.id, {headers, credentials:'omit', cache:'no-store', redirect:'error', signal:timeout.signal });
        if (!response.ok || !response.headers.get('Content-Type')?.startsWith('image/jpeg')) throw new Error('A photo could not be downloaded. Try syncing again.');
        blob = new Blob([await readLimitedResponse(response,item.bytes,timeout.signal,item.bytes)],{type:'image/jpeg'});
      }finally{timeout.cancel();}
      if (blob.size !== item.bytes) throw new Error('A photo download was incomplete. Try syncing again.');
      if (globalThis.crypto?.subtle) {
        const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
        const hash = [...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join('');
        if (hash !== item.sha256) throw new Error('A photo failed its integrity check. Try syncing again.');
      }
      if (state.ignored.includes(item.id)) continue;
      const thumbnailBlob = await makeThumbnail(blob);
      await savePhoto({ ...item, blob, thumbnailBlob, addedAt:Date.now(), demo:false }); added++;
    }
    await reloadPhotos();
    if (announce || added) toast(added ? `${added} photo${added===1?'':'s'} saved on this screen.` : 'Your gallery is up to date.');
  } catch (err) {
    state.online = false; state.syncError = err.message;
    if (announce) toast(added ? `${added} saved. ${err.message}` : (err.message || 'PC offline. Your saved photos are still here.'));
    if (added) await reloadPhotos();
  } finally {
    state.syncing = false;
    if (state.view === 'gallery' && !dialog.open) render(document.activeElement?.dataset.focus);
  }
}

async function reloadPhotos() {
  const stored = await listPhotos();
  stored.sort((a,b)=>b.addedAt-a.addedAt);
  const photos=[...stored.map(photo=>({...photo,collectionId:photo.collectionId||'my-photos'})),...DEMO_PHOTOS.map(p=>({...p,demo:true}))];
  state.photoCollections=normalisePhotoCollections(await getSetting('photoCollectionsV1'),photos);
  state.photos=photos.filter(p=>!p.demo||!state.hiddenArtwork.includes(p.id)).map(p=>({...p,...state.photoCollections[p.id]}));
}

async function refreshUploadedLibrary(){
  state.ignored=(await getSetting('ignored'))||[];await reloadPhotos();
  if(state.view==='gallery'&&state.tab==='settings')render(dialog.open?'':document.activeElement?.dataset.focus);
}

async function handleAction(name, el) {
  if(name.startsWith('sources-')){await sourcesManager.handle(name,el);return;}
  if(name.startsWith('uploads-')){await uploadsManager.handle(name,el);return;}
  if(name.startsWith('native-manager-')){if(nativeArt.support.supported)await nativeManager.handle(name,el);return;}
  switch (name) {
    case 'tab': if(state.tab==='find')stopFindArt();state.tab=el.dataset.tab;state.activeCollection='';render('tab-'+state.tab);break;
    case 'find-source': if(!findSources.sources.some(s=>s.id===el.dataset.id&&s.enabled))break;if(dialog.classList.contains('source-picker-options'))closeDialog(true);stopFindArt();findArtState.source=el.dataset.id;findArtState.items=[];findArtState.searched=false;findArtState.error='';findArtState.more=false;findArtState.page=0;render('find-source-'+el.dataset.id);break;
    case 'find-source-picker':sourcePickerPage=0;findSourcePicker();break;
    case 'find-source-page':sourcePickerPage=Number(el.dataset.page);findSourcePicker();break;
    case 'find-edit': findArtQueryDialog();break;
    case 'find-recent': {const recent=findArtState.history[Number(el.dataset.index)];if(recent&&findSources.sources.some(s=>s.id===recent.source&&s.enabled)){findArtState.source=recent.source;findArtState.query=recent.query;await searchFindArt();}break;}
    case 'find-search': await searchFindArt();break;
    case 'find-next': await searchFindArt(findArtState.page+1);break;
    case 'find-previous': await searchFindArt(findArtState.page-1);break;
    case 'find-cancel': stopFindArt();findArtState.error='Search cancelled.';render('find-query');break;
    case 'find-select': findArtState.selecting=true;updateFindSelection('find-result-0');break;
    case 'find-select-page': for(const record of findArtState.items){if(!state.photos.some(p=>p.id===record.id)){try{findArtSelection.add(record);}catch(error){toast(error.message);break;}}}updateFindSelection('find-select-page');break;
    case 'find-select-clear': findArtSelection.clear();updateFindSelection('find-select-page');break;
    case 'find-select-cancel': findArtState.selecting=false;findArtSelection.clear();updateFindSelection(findArtState.items.length?'find-select':'find-query');break;
    case 'find-batch-open': if(!findArtSelection.size||findArtBatch.running)break;findArtState.batchPicking=true;findArtState.collectionOpen=false;findArtState.saveError='';findArtPreview(0);break;
    case 'find-batch-save': await saveFoundArtBatch();break;
    case 'find-batch-stop': stopFindArtBatch();break;
    case 'find-preview': {const index=Number(el.dataset.index),record=findArtState.items[index],saved=state.photos.find(p=>p.id===record?.id);if(findArtState.selecting){if(saved)toast('This image is already in your gallery.');else findArtSelection.toggle(record);updateFindSelection('find-result-'+index);break;}if(saved)findArtState.collectionId=saved.collectionId;findArtState.batchPicking=false;findArtState.collectionOpen=false;findArtState.saveError='';findArtPreview(index);break;}
    case 'find-pick-collection': findArtState.collectionName=document.getElementById('find-collection-name')?.value??findArtState.collectionName;findArtState.collectionOpen=!findArtState.collectionOpen;findArtPreview(findArtState.selected,findArtState.collectionOpen?'find-collection-'+(collectionList().find(g=>g.id===findArtState.collectionId)?.id||BUILTIN_COLLECTIONS[0].id):'find-collection-picker');break;
    case 'find-collection': findArtState.collectionId=el.dataset.id;findArtState.collectionOpen=false;findArtState.saveError='';findArtPreview(findArtState.selected,el.dataset.id==='new'?'find-collection-name':'find-collection-picker');break;
    case 'find-save': await saveFoundArt();break;
    case 'find-display': await displayFoundArt();break;
    case 'find-display-existing': findArtDisplayIds=[findArtState.items[findArtState.selected]?.id];await displayFoundArt();break;
    case 'show-gallery': state.tab='gallery';state.activeCollection='';render('tab-gallery');break;
    case 'open-collection': state.tab='gallery';state.activeCollection=el.dataset.id;state.collectionFocus=el.dataset.id;render('photo-'+collection()[0]?.id);break;
    case 'collection-previous': moveCollection(-1);break;
    case 'collection-next': moveCollection(1);break;
    case 'back-collections': backToCollections();break;
    case 'photo': await display(state.photos.find(p=>p.id===el.dataset.id)); break;
    case 'start-slideshow': await display(collection()[0], true); break;
    case 'pair': pairDialog(); break;
    case 'add-photos': case 'mobile-pair': case 'pc-pair': case 'mobile-new': await startMobile();break;
    case 'advanced-connections': advancedConnectionsDialog();break;
    case 'mobile-setup': mobilePanel='setup';renderMobileDialog();mobile.openSetup();break;
    case 'mobile-details': mobilePanel='details';renderMobileDialog();break;
    case 'mobile-connect': mobile.closeSetup();mobilePanel='connect';renderMobileDialog();break;
    case 'mobile-close': if(mobileTransferBusy()){mobilePanel='confirm-close';renderMobileDialog();}else closeDialog(true);break;
    case 'mobile-stop': closeDialog(true);break;
    case 'mobile-allow': await mobile.approve();break;
    case 'sync': await syncPhotos(true); break;
    case 'back-gallery': await backToGallery(); break;
    case 'next': advance(1); break;
    case 'previous': advance(-1); break;
    case 'toggle-play': state.playing=!state.playing; render('toggle-play'); showControls(); scheduleSlide(); break;
    case 'slideshow-options': lookSection='slideshow';matDialog();break;
    case 'dialog-toggle-play':
      if(state.view!=='player')await display(collection()[0],true);
      else{state.playing=!state.playing;render();}
      matDialog('slide-play');break;
    case 'set-player-setting': {
      const key=el.dataset.settingName;await updatePreference(key,['interval','transitionDuration'].includes(key)?Number(el.dataset.value):el.dataset.value);
      render();matDialog(el.dataset.focus);break;
    }
    case 'global-look': globalLookDraft=normaliseLook(state.settings);lookSection='frame';matDialog();break;
    case 'apply-global-look': {
      const next=applyGlobalAppearance(state.settings,state.looks,globalLookDraft);
      await setSettings({preferences:next.settings,looks:next.looks});
      state.settings=next.settings;state.looks=next.looks;
      closeDialog();render('setting-matte');toast('Frame and mat applied to all artwork.');break;
    }
    case 'mat': globalLookDraft=null;lookSection='frame';matDialog(); break;
    case 'native-art':
      if(!nativeArt.support.supported)return;
      nativeArtVisible=true;nativeArtPhoto=currentPhoto();nativeArtError='';await prepareNativeArtwork();break;
    case 'native-art-check':await prepareNativeArtwork();break;
    case 'native-art-look':
      if(!nativeArtVisible||!nativeArt.support.supported||['checking','saving','opening'].includes(nativeArtPhase))return;
      state.nativeArtIncludeLook=!state.nativeArtIncludeLook;await setSetting('nativeArtIncludeLookV1',state.nativeArtIncludeLook);await prepareNativeArtwork();break;
    case 'native-art-confirm': await showNativeArtwork();break;
    case 'look-tab': lookSection=el.dataset.lookTab;matDialog(el.getAttribute('role')==='tab'?'look-tab-'+lookSection:'');break;
    case 'set-mat': await updateLook('matte',el.dataset.matte); break;
    case 'set-mat-style': await updateLook('matStyle',el.dataset.matStyle); break;
    case 'set-fit': await updateLook('fit',el.dataset.fit); break;
    case 'set-frame': await updateLook('frame',el.dataset.frame); break;
    case 'choose-setting': settingDialog(el.dataset.settingName); break;
    case 'set-preference': {
      const key=el.dataset.settingName;
      await updatePreference(key,key==='interval'?Number(el.dataset.value):el.dataset.value);
      closeDialog();render('setting-'+key);break;
    }
    case 'toggle-resume': await updatePreference('resume',!state.settings.resume);render('setting-resume');break;
    case 'reset-picture': await updateTuning('brightness',100);await updateTuning('contrast',100);break;
    case 'close-dialog': closeDialog(); break;
    case 'favourite': {
      state.favourites = favourite(state.current) ? state.favourites.filter(id=>id!==state.current) : [...state.favourites,state.current];
      await setSetting('favourites', state.favourites); render('favourite'); showControls(); break;
    }
    case 'move-image': if(currentPhoto()){moveDraft={photoId:state.current,collectionId:'',collectionName:'',open:false,saving:false,error:''};moveImageDialog();}break;
    case 'move-pick-collection': if(moveDraft){moveDraft.collectionName=document.getElementById('move-collection-name')?.value??moveDraft.collectionName;moveDraft.open=!moveDraft.open;moveImageDialog(moveDraft.open?'move-collection-'+(moveDraft.collectionId||moveDestinations()[0]?.id||'new'):'move-picker');}break;
    case 'move-collection': if(moveDraft){moveDraft.collectionId=el.dataset.id;moveDraft.open=false;moveDraft.error='';moveImageDialog(el.dataset.id==='new'?'move-collection-name':'move-confirm');}break;
    case 'move-confirm': await confirmImageMove();break;
    case 'remove': {
      const photo=currentPhoto();if(!photo)break;
      showDialog(`${dialogHead('Remove this image?')}<p>“${safeText(photo.title)}” will be removed from SART App. ${photo.demo?'You can restore included artwork in Settings.':photo.origin==='museum'?'The museum’s original is unchanged.':'Your original stays on its source device.'}</p><div class="dialog-actions">${button('close-dialog','Keep image','')}${button('confirm-remove','Remove from SART App','','danger')}</div>`,'close-dialog');break;
    }
    case 'confirm-remove': {
      const photo=currentPhoto();if(!photo)break;const id=photo.id;
      if(photo.demo){const hidden=normaliseHiddenArtwork([...state.hiddenArtwork,id],DEMO_PHOTOS);await setSetting('hiddenArtworkV1',hidden);state.hiddenArtwork=hidden;}
      else{if(photo.source!=='mobile'&&photo.origin!=='museum'){state.ignored=[...new Set([...state.ignored,id])];await setSetting('ignored',state.ignored);}await deletePhoto(id);}
      for(const key of [id,id+'-thumb'])if(objects.has(key)){URL.revokeObjectURL(objects.get(key));objects.delete(key);}
      closeDialog();await reloadPhotos();await backToGallery();toast('Image removed from SART App.');break;
    }
    case 'restore-included': showDialog(`${dialogHead('Restore included artwork?')}<p>Restore ${state.hiddenArtwork.length} included image${state.hiddenArtwork.length===1?'':'s'} to their collections. Your own photos and downloaded art stay as they are.</p><div class="dialog-actions">${button('close-dialog','Cancel','')}${button('confirm-restore-included','Restore','','primary')}</div>`,'close-dialog');break;
    case 'confirm-restore-included': await setSetting('hiddenArtworkV1',[]);state.hiddenArtwork=[];await reloadPhotos();closeDialog();render('library-add');toast('Included artwork restored.');break;
    case 'disconnect':
      state.connection=null; state.online=false; await setSetting('connection',null); render(state.tab==='settings'?'library-add':'header-pair'); toast('PC disconnected. Saved photos stay in your gallery.'); break;
    case 'about': case 'help-about': aboutDialog();break;
    case 'help-guide': helpDialog();break;
    case 'help-topic': helpDialog(el.dataset.index);break;
    case 'exit': await artActive(false); if(!exitApp()){closeDialog();toast('This is the browser preview. Close the browser tab to exit.');} break;
  }
}

function back() {
  if(sourcesManager.visible){sourcesManager.back();return;}
  if(dialog.open&&uploadsManager.visible){uploadsManager.back();return;}
  if(dialog.open&&moveDraft?.open){moveDraft.open=false;moveImageDialog('move-picker');return;}
  if(dialog.open&&nativeManager.visible){nativeManager.back();return;}
  if(state.view==='gallery'&&!dialog.open&&state.tab==='find'&&findArtState.selecting){findArtState.selecting=false;findArtSelection.clear();updateFindSelection(findArtState.items.length?'find-select':'find-query');return;}
  if(dialog.open&&dialog.classList.contains('find-art-options')&&findArtState.collectionOpen){findArtState.collectionOpen=false;findArtPreview(findArtState.selected,'find-collection-picker');return;}
  if (dialog.open) { closeDialog(); return; }
  if (state.view==='player') {
    if (state.controls) { clearTimeout(hideTimer); hideControls(); }
    else void backToGallery();
  } else if(state.tab==='gallery'&&state.activeCollection) {backToCollections();}
  else if(state.tab!=='gallery') {if(state.tab==='find')stopFindArt();state.tab='gallery';state.activeCollection='';render('tab-gallery');}
  else showDialog(`${dialogHead('Leave the gallery?')}<p>You can open SART Gallery again from your TV’s Apps screen.</p><div class="dialog-actions">${button('close-dialog','Stay here','','primary')}${button('exit','Exit gallery','')}</div>`,'close-dialog');
}

document.addEventListener('click', event => {
  const el=event.target.closest('[data-action]');
  if (el && !el.disabled) void handleAction(el.dataset.action, el).catch(error=>toast(error.message));
});
root.addEventListener('focusin',event=>{if(event.target.matches('.collection-card'))selectCollection(event.target.dataset.id);});
dialog.addEventListener('focusin',event=>{const input=event.target;if(input.id==='find-query-input'||input.id==='source-text-input'){const end=input.value.length;input.setSelectionRange(end,end);}});
window.addEventListener('resize',layoutCollections);
document.addEventListener('submit', event => { if(event.target.id==='pair-form'){event.preventDefault();void connect(event.target);}if(event.target.id==='source-text-form'){event.preventDefault();sourcesManager.textDone();}if(event.target.id==='find-query-form'){event.preventDefault();submitFindArtQuery();} });
document.addEventListener('input',event=>{if(event.target.id==='uploads-collection-name')uploadsManager.input(event.target.value);if(event.target.id==='move-collection-name'&&moveDraft){moveDraft.collectionName=event.target.value;moveDraft.error='';dialog.querySelector('[role="status"]').textContent='Keeps its favourite status, frame and mat settings.';}if(event.target.dataset.tuning)void updateTuning(event.target.dataset.tuning,event.target.value).catch(error=>toast(error.message));});
document.addEventListener('change', async event => {
  const el=event.target;
  try {
    if(el.dataset.setting){state.settings=normaliseSettings({...state.settings,[el.dataset.setting]:el.type==='checkbox'?el.checked:el.value});await setSetting('preferences',state.settings);scheduleSlide();}
    if(el.dataset.photoSetting) await updateLook(el.dataset.photoSetting, el.value);
  } catch(error){toast(error.message);}
});
document.addEventListener('keydown', event => {
  const code=event.keyCode, key=event.key;
  if(handleImeExit(event,document.getElementById('source-text-input'),()=>focusKey('sources-text-done'),()=>sourcesManager.back()))return;
  if(handleImeExit(event,document.getElementById('uploads-collection-name'),()=>focusKey('uploads-confirm-move'),()=>focusKey('uploads-picker')))return;
  if(handleImeExit(event,document.getElementById('move-collection-name'),()=>focusKey('move-confirm'),()=>focusKey('move-picker')))return;
  if(handleImeExit(event,document.getElementById('find-query-input'),()=>focusKey('find-query-submit'),()=>closeDialog()))return;
  if(handleImeExit(event,document.getElementById('find-collection-name'),()=>focusKey('find-save'),()=>{findArtState.collectionId='';findArtState.collectionName='';findArtPreview(findArtState.selected,'find-collection-picker');}))return;
  if(code===10009||key==='Escape'||(key==='Backspace'&&!['INPUT','TEXTAREA'].includes(event.target.tagName))){event.preventDefault();back();return;}
  if(event.target.dataset.tuning){
    const el=event.target;
    if(['ArrowLeft','ArrowRight','Home','End'].includes(key)||[37,39].includes(code)){
      event.preventDefault();const value=key==='Home'?Number(el.min):key==='End'?Number(el.max):Number(el.value)+((key==='ArrowLeft'||code===37)?-5:5);
      void updateTuning(el.dataset.tuning,value).catch(error=>toast(error.message));
    }else if(['ArrowUp','ArrowDown','Enter'].includes(key)||[38,40,13].includes(code)){
      event.preventDefault();focusKey(el.getAttribute('data-nav-'+((key==='Enter'||code===13)?'enter':(key==='ArrowUp'||code===38)?'up':'down')));
    }
    return;
  }
  if(event.target.closest('#pair-form')&&event.target.tagName==='INPUT'&&!event.isComposing&&(key==='ArrowUp'||key==='ArrowDown'||code===38||code===40)){
    event.preventDefault();focusKey(event.target.getAttribute('data-nav-'+((key==='ArrowUp'||code===38)?'up':'down')));return;
  }
  if(['INPUT','SELECT','TEXTAREA'].includes(event.target.tagName)) return;
  const media=[10252,415,19,413,10232,10233].includes(code)||key===' ';
  if(media&&state.view==='player'&&!dialog.open){event.preventDefault();if(code===10232)advance(-1);else if(code===10233)advance(1);else{state.playing=code===415?true:code===19||code===413?false:!state.playing;render();showControls('toggle-play');scheduleSlide();}return;}
  if(state.view==='player'&&!state.controls&&!dialog.open){
    if(key==='ArrowLeft'||code===37){event.preventDefault();advance(-1);return;}
    if(key==='ArrowRight'||code===39){event.preventDefault();advance(1);return;}
    if(['Enter','ArrowUp','ArrowDown'].includes(key)||[13,38,40].includes(code)){event.preventDefault();showControls('toggle-play');return;}
  }
  const direction=({ArrowLeft:'left',ArrowRight:'right',ArrowUp:'up',ArrowDown:'down'})[key]||({37:'left',39:'right',38:'up',40:'down'})[code];
  if(dialog.open&&dialog.classList.contains('help-options')&&event.target.dataset.focus==='help-content'&&['up','down'].includes(direction)){
    event.preventDefault();const content=event.target,previous=content.scrollTop;
    content.scrollTop+=Math.max(72,content.clientHeight*.45)*(direction==='down'?1:-1);
    if(Math.abs(content.scrollTop-previous)<1)focusKey(direction==='down'?'help-about':'help-topic-'+helpTopicIndex);
    return;
  }
  if(direction&&event.target.getAttribute('role')==='tab'&&event.target.dataset.lookTab&&['left','right'].includes(direction)){
    event.preventDefault();const sections=globalLookDraft?['frame','mat']:state.view==='player'?['frame','mat','fit','picture','slideshow']:['picture','slideshow'];const index=sections.indexOf(lookSection);
    lookSection=sections[Math.max(0,Math.min(sections.length-1,index+(direction==='right'?1:-1)))];matDialog('look-tab-'+lookSection);return;
  }
  if(direction){event.preventDefault();const els=focusables();const active=document.activeElement;const explicit=active?.getAttribute('data-nav-'+direction);if(explicit&&els.some(el=>el.dataset.focus===explicit)){focusKey(explicit);return;}const boxes=els.map(el=>{const r=el.getBoundingClientRect();return{id:el.dataset.focus,x:r.left+r.width/2,y:r.top+r.height/2};});const from=boxes.find(b=>b.id===active?.dataset.focus);if(!from){els[0]?.focus();return;}const target=spatialTarget(from,boxes,direction);if(target)focusKey(target);if(state.view==='player')showControls();}
});
dialog.addEventListener('cancel', event=>{event.preventDefault();back();});
document.addEventListener('visibilitychange',()=>{
  if(document.hidden&&sourcesManager.visible)closeDialog(true);
  if(document.hidden&&uploadsManager.visible)closeDialog(true);
  if(nativeManager.visible){if(!document.hidden&&nativeManager.phase==='showing')closeDialog(true);else if(document.hidden&&nativeManager.phase!=='showing')closeDialog(true);}
  if(document.hidden&&mobile.active){mobile.close('disconnected');mobile.error='SART Gallery was paused. Create a new QR code to reconnect.';if(mobileVisible)renderMobileDialog();}
  if(document.hidden){const searching=findArtState.loading;stopFindArt();if(searching)findArtState.error='Search paused. Try again.';if(dialog.open&&dialog.classList.contains('find-art-options'))closeDialog(true);}
  state.hidden=document.hidden;clearTimeout(slideTimer);clearTimeout(hideTimer);
  if(state.hidden&&presenter.animations?.length)presenter.finish(false);presenter.setMotionActive(!state.hidden&&!dialog.open&&state.view==='player');
  void artActive(!state.hidden&&state.view==='player');
  if(!state.hidden){if(state.view==='gallery'&&state.tab==='find'&&!dialog.open)render('tab-find');if(nativeArtVisible&&nativeArtPhase==='opening')closeDialog(true);scheduleSlide();if(state.controls&&state.view==='player')showControls();void syncPhotos();if(!nativeArt.support.supported)void checkNativeArt();}
  else if(nativeArtVisible&&nativeArtPhase==='saving'){nativeArt.cancel();nativeArtPhase='error';nativeArtError='SART was paused. Return to this artwork and try again.';}
});
window.addEventListener('pagehide',()=>{sourcesManager.dismiss();uploadsManager.dismiss(true);nativeManager.dismiss(true);stopFindArt();mobile.close();nativeArt.cancel();presenter.clear();clearTimeout(slideTimer);clearTimeout(hideTimer);clearInterval(syncTimer);void artActive(false);});
root.addEventListener('mousemove',()=>{if(state.view==='player')showControls();});
root.addEventListener('click',event=>{if(state.view==='player'&&!state.controls&&!event.target.closest('[data-action]'))showControls('toggle-play');});

async function boot() {
  try {
    await openStore();
    state.settings=normaliseSettings(await getSetting('preferences'));
    // Version 0.1.0 had no global fit control: its saved contain value was the old default.
    // Update that default once, while keeping every artwork's explicit look in `looks`.
    if((await getSetting('fitDefaultRevision'))!==1){
      state.settings.fit=DEFAULTS.fit;
      await setSetting('preferences',state.settings);
      await setSetting('fitDefaultRevision',1);
    }
    state.favourites=(await getSetting('favourites'))||[];
    state.looks=(await getSetting('looks'))||{};
    state.ignored=(await getSetting('ignored'))||[];
    state.hiddenArtwork=normaliseHiddenArtwork(await getSetting('hiddenArtworkV1'),DEMO_PHOTOS);
    state.nativeArtIncludeLook=(await getSetting('nativeArtIncludeLookV1'))===true;
    state.connection=(await getSetting('connection'))||null;
    findSources=normaliseFindSources(await getSetting(FIND_SOURCE_KEY));findArtCatalog.configure(findSources);findArtState.source=findSources.defaultId;
    findArtState.history=normaliseFindArtHistory(await getSetting('findArtRecentV1'));
    if(state.connection){try{validateLibraryUrl(state.connection.origin);}catch{state.syncError="This saved PC connection needs HTTPS. Use Add photos to upload directly from your browser.";}}
    await reloadPhotos();registerRemote();
    const last=await getSetting('lastPhoto');
    if(state.settings.resume&&state.photos.some(p=>p.id===last)){const photo=state.photos.find(p=>p.id===last);state.activeCollection=photo.collectionId;await display(photo);}
    else{render('collection-'+collectionList()[0]?.id);await artActive(false);}
    void syncPhotos();syncTimer=setInterval(()=>void syncPhotos(),30000);
    void checkNativeArt();
  } catch(error){state.error=error.message;root.innerHTML=`<div class="loading"><img class="brand-mark" src="icon.png" alt=""><h1>Your gallery needs a moment.</h1><p>${safeText(error.message)}</p><p>Restart SART Gallery and try again.</p></div>`;}
}
void boot();

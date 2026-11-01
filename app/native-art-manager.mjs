import {NativeArt} from './native-art.mjs';
// Six native previews at a time; cache at most two pages. No artwork originals
// are imported into SART when browsing Samsung's own My Photos library.
export class NativeArtManager{
 constructor(options){Object.assign(this,options);this.art=new NativeArt(window);this.visible=false;this.phase='list';this.items=[];this.urls=new Map();this.viewed=new Set();this.selected=new Set();this.page=0;this.request=0;this.error='';this.id='';this.selecting=false;this.returnPhase='list';}
 title(id){const p=this.items.find(x=>x.content_id===id);return p?.title||'Art image '+(this.items.indexOf(p)+1);}
 clearPreviews(){for(const url of this.urls.values())URL.revokeObjectURL(url);this.urls.clear();}
 dismiss(force=false){if(this.phase==='deleting'&&!force)return false;this.visible=false;this.request++;this.art.cancel();this.clearPreviews();return true;}
 async open(){this.visible=true;this.selected.clear();this.selecting=false;this.page=0;await this.load();}
 async load(){
  const request=++this.request;this.art.cancel();this.clearPreviews();this.viewed.clear();this.selected.clear();this.selecting=false;this.phase='loading';this.error='';this.render();
  try{
   const result=await this.art.library(),exports=await this.getExports();if(!this.visible||request!==this.request)return;
   const photos=this.getPhotos();this.items=result.items.map(p=>{const match=Object.entries(exports||{}).find(([,v])=>v?.contentId===p.content_id),source=match&&photos.find(x=>x.id===(match[1].sourcePhotoId||match[0]));return {...p,title:source?source.title+(match[1].appearanceKey?' · SART frame & mat':''):p.title||''};});this.currentId=result.currentId;
   this.selected=new Set([...this.selected].filter(id=>this.items.some(p=>p.content_id===id)));this.page=Math.min(this.page,Math.max(0,Math.ceil(this.items.length/6)-1));this.phase='list';this.render();await this.previews(request);
  }catch(error){if(this.visible&&request===this.request){this.phase='error';this.error=error.message;this.render();}}
 }
 async previews(request=this.request){
  const ids=this.items.slice(this.page*6,this.page*6+6).map(p=>p.content_id).filter(id=>!this.urls.has(id));if(!ids.length)return;
  try{
   const images=await this.art.thumbnails(ids);if(!this.visible||request!==this.request)return;
   for(const image of images){if(this.urls.size>=12){const [key,url]=this.urls.entries().next().value;URL.revokeObjectURL(url);this.urls.delete(key);}this.urls.set(image.id,URL.createObjectURL(new Blob([image.buffer],{type:image.mime})));this.viewed.add(image.id);}
   this.error=ids.every(id=>this.urls.has(id))?'':'Some previews could not load. Refresh to try again.';
  }catch(error){if(!this.visible||request!==this.request)return;this.error='Some previews could not load. Refresh to try again.';}
  if(this.visible&&request===this.request)this.render(this.dialog.contains(document.activeElement)?document.activeElement.dataset.focus:'');
 }
 render(focus=''){
  if(!this.visible)return;const b=this.button,t=this.text,phase=this.phase,busy=['loading','deleting','showing'].includes(phase);let body='',first='native-manager-close';
  if(busy){body=`<div class="native-library-state" role="status"><h3>${phase==='loading'?'Loading Samsung Art…':phase==='deleting'?'Deleting selected photos…':'Opening Samsung Art Mode…'}</h3><p>${phase==='deleting'?'Please wait for Samsung to confirm the deletion.':'Connecting to this Frame TV.'}</p></div>`;}
  else if(phase==='error'){body=`<div class="native-library-state"><h3>Unable to load Samsung Art</h3><p>${t(this.error)}</p>${b('native-manager-refresh','Try again','','primary','native-refresh')}</div>`;first='native-refresh';}
  else if(phase==='confirm'){
   const ids=this.deleting;body=`<div class="native-library-confirm"><h3>Delete ${ids.length===1?'this image':ids.length+' images'} from Samsung Art?</h3><p>This permanently deletes ${ids.length===1?'the native copy':'these native copies'} from Samsung’s My Photos. Any originals in SART or on your other devices stay available.</p><ul>${ids.slice(0,3).map(id=>'<li>'+t(this.title(id))+'</li>').join('')}</ul>${ids.length>3?'<p>And '+(ids.length-3)+' more.</p>':''}<div class="dialog-actions">${b('native-manager-keep','Keep '+(ids.length===1?'image':'images'),'','','native-keep','data-nav-right="native-delete-confirm"')}${b('native-manager-delete-confirm','Delete from Samsung Art','','danger','native-delete-confirm','data-nav-left="native-keep"')}</div></div>`;first='native-keep';
  }else if(phase==='detail'){
   const p=this.items.find(x=>x.content_id===this.id),url=this.urls.get(this.id);if(!p){this.phase='list';this.render();return;}
   body=`<div class="native-library-detail"><div class="native-library-image">${url?'<img src="'+t(url)+'" alt="'+t(this.title(this.id))+'">':'<span>Preview unavailable. Refresh to try again.</span>'}</div><div><h3>${t(this.title(this.id))}</h3><p>${t(this.details(p))}</p><p>${p.content_id===this.currentId?'Currently selected in Samsung Art.':'Saved in Samsung’s My Photos.'}</p><div class="native-detail-actions">${b('native-manager-show','Show in Art Mode','play','primary','native-show',url?'':'disabled')}${b('native-manager-delete','Delete from Samsung Art','','danger','native-delete',url?'':'disabled')}${b('native-manager-back','Back','','','native-detail-back')}</div></div></div>`;first=url?'native-show':'native-detail-back';
  }else{
   const page=this.items.slice(this.page*6,this.page*6+6),pages=Math.max(1,Math.ceil(this.items.length/6));
   const toolbar=`<div class="native-library-toolbar">${b('native-manager-refresh','Refresh','sync','','native-refresh')}${this.selecting?b('native-manager-select-page','Select page','','','native-select-page')+b('native-manager-clear','Clear','','','native-clear',this.selected.size?'':'disabled')+b('native-manager-delete','Delete selected ('+this.selected.size+')','','danger','native-delete-selected',this.selected.size?'':'disabled')+b('native-manager-select-cancel','Cancel selection','','','native-select-cancel'):b('native-manager-select','Select images','','','native-select',this.items.length?'':'disabled')}</div>`;
   body=toolbar+`<p class="native-library-error" role="status">${t(this.error)}</p><div class="native-library-grid">${page.length?page.map((p,i)=>{const id=p.content_id,url=this.urls.get(id),key='native-image-'+i;return `<button class="native-library-card" data-action="native-manager-image" data-id="${t(id)}" data-focus="${key}" data-nav-left="native-image-${i%3?i-1:i}" data-nav-right="native-image-${i%3<2?Math.min(i+1,page.length-1):i}" data-nav-up="${i<3?'native-refresh':'native-image-'+(i-3)}" data-nav-down="${i+3<page.length?'native-image-'+(i+3):'native-next'}" ${this.selecting?'aria-pressed="'+this.selected.has(id)+'"':''} aria-label="${t((this.selecting?'Select ':'Open ')+this.title(id))}"><span class="native-library-thumb">${url?'<img src="'+t(url)+'" alt="">':'<span>Loading preview…</span>'}${this.selecting?'<i class="native-library-check">'+(this.selected.has(id)?'✓':'')+'</i>':''}</span><strong>${t(this.title(id))}</strong><span>${id===this.currentId?'Selected in Art Mode · ':''}${t(this.details(p))}</span></button>`}).join(''):'<div class="native-library-empty"><h3>No photos in Samsung Art</h3><p>Open an artwork in SART and choose Samsung Art Mode to add it.</p></div>'}</div><div class="native-library-footer"><span>${this.items.length} photos · Page ${this.page+1} of ${pages}</span><div>${b('native-manager-previous','Previous','left','','native-previous',this.page?'':'disabled')}${b('native-manager-next','Next','right','','native-next',this.page+1<pages?'':'disabled')}${b('native-manager-close','Close','','','native-manager-close')}</div></div>`;first=page.length?'native-image-0':'native-refresh';
  }
  this.show(`${this.header('Samsung Art collection')}<p class="native-library-subtitle">Photos stored in this Frame’s Samsung Art Mode.</p>${body}`,focus||first,()=>{this.dialog.classList.add('native-manager-options');const close=this.dialog.querySelector('[data-focus="close-dialog"]');close.disabled=phase==='deleting';});
 }
 details(p){const w=Number(p.width),h=Number(p.height);return w>0&&h>0?w+' × '+h:'Samsung My Photos';}
 back(){if(this.phase==='deleting')return;if(this.phase==='confirm'){this.phase=this.returnPhase;this.render();}else if(this.phase==='detail'){this.phase='list';this.render('native-image-'+Math.max(0,this.items.slice(this.page*6,this.page*6+6).findIndex(p=>p.content_id===this.id)));}else if(this.selecting){this.selecting=false;this.selected.clear();this.render('native-select');}else this.close();}
 confirm(){const ids=this.phase==='detail'?[this.id]:[...this.selected];if(!ids.length||ids.some(id=>!this.viewed.has(id))){this.error='Wait for the selected previews to load before deleting.';this.render();return;}this.deleting=ids;this.returnPhase=this.phase;this.phase='confirm';this.render();}
 async delete(){
  if(this.phase!=='confirm')return;const ids=[...this.deleting],request=++this.request;this.art.cancel();this.phase='deleting';this.render();
  try{await this.art.remove(ids);const exports=await this.getExports();for(const [key,value] of Object.entries(exports||{}))if(ids.includes(value?.contentId))delete exports[key];await this.setExports(exports||{});if(!this.visible||request!==this.request)return;this.selected.clear();this.selecting=false;await this.load();}
  catch(error){if(this.visible&&request===this.request){this.phase='error';this.error=error.message;this.render();}}
 }
 async display(){if(this.phase!=='detail')return;this.art.cancel();this.phase='showing';this.render();try{await this.art.showExisting(this.id);}catch(error){if(this.visible){this.phase='error';this.error=error.message;this.render();}}}
 async handle(action,el){
  switch(action){
   case 'native-manager-open':await this.open();break;
   case 'native-manager-close':this.close();break;
   case 'native-manager-refresh':await this.load();break;
   case 'native-manager-select':this.selecting=true;this.render('native-image-0');break;
   case 'native-manager-select-cancel':this.selecting=false;this.selected.clear();this.render('native-select');break;
   case 'native-manager-select-page':for(const p of this.items.slice(this.page*6,this.page*6+6))if(this.urls.has(p.content_id)&&this.selected.size<50)this.selected.add(p.content_id);this.render('native-select-page');break;
   case 'native-manager-clear':this.selected.clear();this.render('native-select-page');break;
   case 'native-manager-image':if(this.selecting){if(this.selected.has(el.dataset.id))this.selected.delete(el.dataset.id);else if(this.selected.size<50&&this.urls.has(el.dataset.id))this.selected.add(el.dataset.id);this.render(el.dataset.focus);}else{this.id=el.dataset.id;this.phase='detail';this.render();}break;
   case 'native-manager-delete':this.confirm();break;
   case 'native-manager-keep':this.phase=this.returnPhase;this.render();break;
   case 'native-manager-delete-confirm':await this.delete();break;
   case 'native-manager-back':this.back();break;
   case 'native-manager-show':await this.display();break;
   case 'native-manager-previous':case 'native-manager-next':this.art.cancel();this.request++;this.page=Math.max(0,Math.min(Math.ceil(this.items.length/6)-1,this.page+(action.endsWith('next')?1:-1)));this.phase='list';this.render('native-image-0');await this.previews();break;
  }
 }
}

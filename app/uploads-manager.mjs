// Browse six saved thumbnails at a time. Selection spans pages; mutations are
// delegated to the storage transaction and never touch bundled/native art.
export class UploadsManager {
  constructor(options){Object.assign(this,options);this.visible=false;this.busy=false;this.selected=new Set();this.items=[];this.page=0;this.phase='list';this.message='';this.error='';}
  async open(){this.visible=true;this.selected.clear();this.page=0;this.phase='list';this.message='';this.error='';try{await this.refresh(true);}catch(error){this.error=error.message;this.render('uploads-close');}}
  async refresh(reload=false){
    if(reload)await this.reload();
    this.items=this.getPhotos().filter(p=>!p.demo);this.selected=new Set([...this.selected].filter(id=>this.items.some(p=>p.id===id)));
    this.page=Math.max(0,Math.min(this.page,Math.ceil(this.items.length/6)-1));this.phase='list';this.render();
  }
  dismiss(force=false){if(this.busy&&!force)return false;this.visible=false;this.selected.clear();return true;}
  groups(){const groups=this.getCollections();if(!groups.some(g=>g.id==='my-photos'))groups.push({id:'my-photos',name:'My photos'});return groups;}
  destinations(){const selected=this.items.filter(p=>this.selected.has(p.id));return this.groups().filter(g=>!selected.every(p=>(p.collectionId||'my-photos')===g.id));}
  name(photo){return this.groups().find(g=>g.id===(photo.collectionId||'my-photos'))?.name||photo.collectionName||'My photos';}
  render(focus=''){
    if(!this.visible)return;
    const b=this.button,t=this.text;let body='',first='uploads-close',heading='Manage uploads',subtitle='Photos and downloaded art saved in SART.';
    if(this.busy){body='<div class="native-library-state" role="status"><h3>'+t(this.phase==='removing'?'Removing images…':'Moving images…')+'</h3><p>Please wait while your library is updated.</p></div>';}
    else if(this.phase==='confirm'){
      const count=this.pending.length;heading=this.removeAll?'Remove all uploads?':'Remove selected images?';
      body=`<div class="native-library-confirm"><h3>Remove ${count} image${count===1?'':'s'} from SART App?</h3><p>${this.removeAll?'This removes all '+count+' saved images shown in Manage uploads.':'This removes only the selected images.'} Your originals on other devices, included artwork and photos in Samsung Art Mode stay available.</p><ul>${this.pending.slice(0,3).map(id=>'<li>'+t(this.items.find(p=>p.id===id)?.title||'Untitled image')+'</li>').join('')}</ul>${count>3?'<p>And '+(count-3)+' more.</p>':''}<div class="dialog-actions">${b('uploads-keep','Keep images','','','uploads-keep','data-nav-right="uploads-confirm-remove"')}${b('uploads-confirm-remove','Remove from SART App','','danger','uploads-confirm-remove','data-nav-left="uploads-keep"')}</div></div>`;first='uploads-keep';
    }else if(this.phase==='move'){
      const options=[...this.destinations(),{id:'new',name:'New collection…'}],group=options.find(g=>g.id===this.destination),count=this.selected.size;
      heading='Move '+count+' image'+(count===1?'':'s');subtitle='';
      body=`<div class="find-preview-layout"><div class="find-batch-summary"><strong>${count} image${count===1?'':'s'} selected</strong><p>Choose a destination for the selected images.</p><ul>${this.items.filter(p=>this.selected.has(p.id)).slice(0,5).map(p=>'<li>'+t(p.title)+'</li>').join('')}</ul>${count>5?'<p>And '+(count-5)+' more.</p>':''}</div><div class="find-preview-details"><h3>Move to</h3><button class="button find-collection-picker" data-action="uploads-pick" data-focus="uploads-picker" data-nav-up="close-dialog" data-nav-down="${this.expanded?'uploads-destination-'+(this.destination||options[0].id):this.destination==='new'?'uploads-name':'uploads-confirm-move'}" aria-haspopup="listbox" aria-expanded="${!!this.expanded}" aria-controls="uploads-collection-list"><span>${t(group?.name||'Choose a collection')}</span>${this.icon('right')}</button>${this.expanded?`<div id="uploads-collection-list" class="find-collection-list" role="listbox" aria-label="Move to collection">${options.map((g,i)=>`<button class="find-collection-option" role="option" data-action="uploads-destination" data-id="${t(g.id)}" data-focus="uploads-destination-${t(g.id)}" data-nav-up="${i?'uploads-destination-'+t(options[i-1].id):'uploads-picker'}" data-nav-down="${i+1<options.length?'uploads-destination-'+t(options[i+1].id):'uploads-destination-'+t(g.id)}" aria-selected="${this.destination===g.id}"><span>${g.id==='new'?'+ ':''}${t(g.name)}</span><span aria-hidden="true">${this.destination===g.id?'✓':''}</span></button>`).join('')}</div>`:''}<label class="find-new-label" ${this.destination==='new'&&!this.expanded?'':'hidden'}>Collection name<input id="uploads-collection-name" data-focus="uploads-name" data-nav-up="uploads-picker" data-nav-down="uploads-confirm-move" maxlength="80" value="${t(this.collectionName)}"></label><p class="find-save-status" role="status">${t(this.error||'Keeps each image’s favourite status, frame and mat settings.')}</p></div></div><div class="dialog-actions">${b('uploads-back','Cancel','','','uploads-move-cancel','data-nav-up="uploads-picker" data-nav-right="uploads-confirm-move"')}${b('uploads-confirm-move','Move to collection','','primary','uploads-confirm-move','data-nav-left="uploads-move-cancel" data-nav-up="'+(this.destination==='new'?'uploads-name':'uploads-picker')+'"')}</div>`;first='uploads-picker';
    }else{
      const page=this.items.slice(this.page*6,this.page*6+6),pages=Math.max(1,Math.ceil(this.items.length/6));
      const actions=[['uploads-select-all','Select all','uploads-select-all',!this.items.length],['uploads-clear','Clear','uploads-clear',!this.selected.size],['uploads-move','Move selected ('+this.selected.size+')','uploads-move',!this.selected.size],['uploads-remove','Remove selected','uploads-remove',!this.selected.size],['uploads-remove-all','Remove all uploads','uploads-remove-all',!this.items.length],['uploads-refresh','Refresh','uploads-refresh',false]];
      body=`<div class="native-library-toolbar uploads-toolbar">${actions.map(([action,label,key,disabled],i)=>b(action,label,'',action.includes('remove')?'danger':'',key,`data-nav-down="${page.length?'uploads-image-0':'uploads-close'}" data-nav-up="close-dialog" data-nav-left="${actions[Math.max(0,i-1)][2]}" data-nav-right="${actions[Math.min(actions.length-1,i+1)][2]}" ${disabled?'disabled':''}`)).join('')}</div><p class="native-library-error" role="status">${t(this.error||this.message||`${this.selected.size} selected · OK selects an image. Selections stay when changing pages.`)}</p><div class="native-library-grid">${page.length?page.map((p,i)=>`<button class="native-library-card" data-action="uploads-image" data-id="${t(p.id)}" data-focus="uploads-image-${i}" data-nav-left="uploads-image-${i%3?i-1:i}" data-nav-right="uploads-image-${i%3<2?Math.min(i+1,page.length-1):i}" data-nav-up="${i<3?'uploads-select-all':'uploads-image-'+(i-3)}" data-nav-down="${i+3<page.length?'uploads-image-'+(i+3):'uploads-next'}" aria-pressed="${this.selected.has(p.id)}" aria-label="Select ${t(p.title)}"><span class="native-library-thumb"><img src="${t(this.url(p))}" alt=""><i class="native-library-check">${this.selected.has(p.id)?'✓':''}</i></span><strong>${t(p.title||'Untitled image')}</strong><span>${t(this.name(p))}</span></button>`).join(''):'<div class="native-library-empty"><h3>No uploads yet</h3><p>Add photos or save artwork from Find art to build your library.</p></div>'}</div><div class="native-library-footer"><span>${this.items.length} saved image${this.items.length===1?'':'s'} · Page ${this.page+1} of ${pages}</span><div>${b('uploads-previous','Previous','left','','uploads-previous',this.page?'':'disabled')}${b('uploads-next','Next','right','','uploads-next',this.page+1<pages?'':'disabled')}${b('uploads-close','Close','','','uploads-close')}</div></div>`;first=page.length?'uploads-image-0':'uploads-close';
    }
    this.show(`${this.header(heading)}${subtitle?'<p class="native-library-subtitle">'+t(subtitle)+'</p>':''}${body}`,focus||first,()=>{
      this.dialog.classList.add('uploads-manager-options',this.phase==='move'&&!this.busy?'collection-move-options':'native-manager-options');
      const close=this.dialog.querySelector('[data-focus="close-dialog"]');close.disabled=this.busy;close.dataset.navDown=first;
    });
  }
  input(value){this.collectionName=value;this.error='';const status=this.dialog.querySelector('[role="status"]');if(status)status.textContent='Keeps each image’s favourite status, frame and mat settings.';}
  back(){if(this.busy)return;if(this.phase==='confirm'){this.phase='list';this.render('uploads-remove-all');}else if(this.phase==='move'&&this.expanded){this.expanded=false;this.render('uploads-picker');}else if(this.phase==='move'){this.phase='list';this.error='';this.render();}else this.close();}
  async confirmMove(){
    if(this.busy||this.phase!=='move'||!this.selected.size)return;
    let group=this.destinations().find(g=>g.id===this.destination);
    if(this.destination==='new'){
      const name=this.dialog.querySelector('#uploads-collection-name')?.value.trim().slice(0,80);
      if(!name){this.error='Enter a name for your new collection.';this.render('uploads-name');return;}
      this.collectionName=name;group={id:'mobile-'+[...crypto.getRandomValues(new Uint8Array(12))].map(b=>b.toString(16).padStart(2,'0')).join(''),name};
    }
    if(!group){this.error='Choose a collection, or create a new one.';this.expanded=true;this.render('uploads-destination-'+(this.destinations()[0]?.id||'new'));return;}
    const ids=[...this.selected];this.busy=true;this.render();
    try{await this.move(ids,group);this.selected.clear();this.error='';this.message=ids.length+' image'+(ids.length===1?'':'s')+' moved to '+group.name+'.';this.phase='list';}
    catch(error){this.error=error.message;this.phase='move';}
    finally{this.busy=false;if(this.visible){if(this.phase==='list')await this.refresh();else this.render('uploads-confirm-move');}}
  }
  async confirmRemove(){
    if(this.busy||this.phase!=='confirm')return;const ids=[...this.pending];this.busy=true;this.phase='removing';this.render();
    try{await this.remove(ids);this.selected.clear();this.error='';this.message=ids.length+' image'+(ids.length===1?'':'s')+' removed from SART App.';}
    catch(error){this.error=error.message;}
    finally{this.busy=false;this.phase='list';if(this.visible)await this.refresh();}
  }
  async handle(action,el){
    if(this.busy)return;
    switch(action){
      case 'uploads-open':await this.open();break;
      case 'uploads-refresh':this.error='';this.message='';await this.refresh(true);break;
      case 'uploads-close':this.close();break;
      case 'uploads-image':if(this.selected.has(el.dataset.id))this.selected.delete(el.dataset.id);else if(this.items.some(p=>p.id===el.dataset.id))this.selected.add(el.dataset.id);this.message='';this.render(el.dataset.focus);break;
      case 'uploads-select-all':this.selected=new Set(this.items.map(p=>p.id));this.render('uploads-move');break;
      case 'uploads-clear':this.selected.clear();this.render('uploads-select-all');break;
      case 'uploads-previous':case 'uploads-next':this.page=Math.max(0,Math.min(Math.ceil(this.items.length/6)-1,this.page+(action.endsWith('next')?1:-1)));this.render('uploads-image-0');break;
      case 'uploads-remove':case 'uploads-remove-all':this.pending=action==='uploads-remove-all'?this.items.map(p=>p.id):[...this.selected];if(this.pending.length){this.removeAll=action==='uploads-remove-all';this.phase='confirm';this.render();}break;
      case 'uploads-keep':this.phase='list';this.render(this.removeAll?'uploads-remove-all':'uploads-remove');break;
      case 'uploads-move':if(this.selected.size){this.destination='';this.collectionName='';this.expanded=false;this.error='';this.phase='move';this.render();}break;
      case 'uploads-pick':this.collectionName=this.dialog.querySelector('#uploads-collection-name')?.value??this.collectionName;this.expanded=!this.expanded;this.render(this.expanded?'uploads-destination-'+(this.destination||this.destinations()[0]?.id||'new'):'uploads-picker');break;
      case 'uploads-destination':this.destination=el.dataset.id;this.expanded=false;this.error='';this.render(this.destination==='new'?'uploads-name':'uploads-confirm-move');break;
      case 'uploads-back':this.phase='list';this.error='';this.render('uploads-move');break;
      case 'uploads-confirm-move':await this.confirmMove();break;
      case 'uploads-confirm-remove':await this.confirmRemove();break;
    }
  }
}

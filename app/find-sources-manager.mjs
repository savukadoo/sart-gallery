// One task per panel; text entry is a separate keyboard-safe row near the top.
export class FindSourcesManager{
 constructor(options){Object.assign(this,options);this.visible=false;this.page=0;this.phase='list';this.message='';this.busy=false;}
 async open(){this.dismiss();this.visible=true;this.page=0;this.phase='list';this.message='';this.config=await this.service.snapshot();this.render();}
 dismiss(){this.visible=false;this.abort?.abort();this.abort=null;this.busy=false;this.ticket='';return true;}
 context(){this.abort?.abort();this.abort=new AbortController();const serial=this.abort;return Object.assign(()=>this.visible&&this.abort===serial&&!serial.signal.aborted&&!document.hidden,{signal:serial.signal,session:'tv'});}
 render(focus=''){
  if(!this.visible)return;const t=this.text,b=this.button;let body='',footer='',first='sources-done',title='Manage sources';
  if(this.phase==='text'){
   const name=this.field==='name',value=this.draft[this.field]||'';title=name?'Source name':'Commons category';
   body=`<form id="source-text-form"><label for="source-text-input">${name?'Name on your TV':'Category name or Commons category URL'}</label><div class="find-query-row"><input id="source-text-input" type="text" value="${t(value)}" maxlength="${name?60:600}" autocomplete="off" spellcheck="false" enterkeyhint="done" data-focus="source-text-input"><div class="dialog-actions">${b('sources-text-cancel','Cancel','','','sources-text-cancel','data-nav-left="source-text-input" data-nav-right="sources-text-done"')}<button type="submit" class="button primary" data-focus="sources-text-done" data-nav-left="sources-text-cancel">Done</button></div></div><p class="remote-hint">Done finishes typing. Back cancels this edit.</p><p role="alert" class="dialog-error">${t(this.message)}</p></form>`;first='sources-text-input';
  }else if(this.phase==='remove'){
   title='Remove this source?';body=`<div class="source-confirm"><h3>${t(this.draft.name)}</h3><p>Removes this source from Find art. Artwork already saved, its collections, favourites and Samsung Art copies stay available.</p><div class="dialog-actions">${b('sources-keep','Keep source','','','sources-keep','data-nav-right="sources-remove-confirm"')}${b('sources-remove-confirm','Remove source','','danger','sources-remove-confirm','data-nav-left="sources-keep"')}</div></div>`;first='sources-keep';
  }else if(this.phase==='details'){
   const current=this.config.sources.find(s=>s.id===this.draft.id),custom=this.draft.kind==='commons';title=current?current.name:'Add art source';
   body=`<div class="source-details"><p>${custom?'Wikimedia Commons category · Public-domain JPEGs':'Included art source'}</p>${custom?`<button class="source-field button" data-action="sources-field" data-field="name" data-focus="source-name" data-nav-up="close-dialog" data-nav-down="source-category"><span>Source name</span><strong>${t(this.draft.name||'Choose a name')}</strong></button><button class="source-field button" data-action="sources-field" data-field="category" data-focus="source-category" data-nav-up="source-name" data-nav-down="sources-test"><span>Commons category</span><strong>${t(this.draft.category||'Enter category name or URL')}</strong></button><p class="muted">Use a category containing image files. A parent category may contain only subcategories.</p>`:''}
   ${current?`<div class="source-choices">${b('sources-enabled',current.enabled?'Turn off':'Turn on','','','sources-enabled','data-nav-up="close-dialog"')}${b('sources-default',this.config.defaultId===current.id?'Default source':'Use by default','','','sources-default',(!current.enabled||this.config.defaultId===current.id?'disabled':'')+' data-nav-up="close-dialog"')}</div>`:''}
   <p class="source-message" role="status" aria-live="polite">${t(this.message||'Test this source before saving it.')}</p>${this.sample?'<p class="source-example">Example: '+t(this.sample.title)+' · '+t(this.sample.rights)+'</p>':''}</div>`;
   footer=`${current&&custom?b('sources-remove','Remove source','','danger','sources-remove'):''}${b('sources-back','Back','','','sources-back')}${b('sources-test',this.busy?'Testing…':'Test source','','','sources-test',this.busy?'disabled':'')}${custom?b('sources-save',this.busy?'Please wait…':'Save source','','primary','sources-save',!this.ticket||this.busy?'disabled':''):''}`;first=custom?'source-name':'sources-enabled';
  }else{
   const page=this.config.sources.slice(this.page*4,this.page*4+4),pages=Math.ceil(this.config.sources.length/4);
   body=`<p class="source-summary">Choose where Find art searches. Downloaded artwork stays on this TV.</p><div class="source-list">${page.map((s,i)=>`<button class="source-row button" data-action="sources-detail" data-id="${s.id}" data-focus="source-row-${i}" data-nav-up="${i?'source-row-'+(i-1):'close-dialog'}" data-nav-down="${i+1<page.length?'source-row-'+(i+1):'sources-add'}"><span><strong>${t(s.name)}</strong><small>${s.kind==='commons'?'Wikimedia Commons category':'Included source'}</small></span><span class="source-state">${this.config.defaultId===s.id?'Default · ':''}${s.enabled?'On':'Off'} ›</span></button>`).join('')}</div><p class="source-message" role="status">${t(this.message)}</p>`;
   footer=`<span class="muted">${this.config.sources.length} of 12 sources · ${this.page+1} / ${pages}</span>${b('sources-add','Add source','plus','','sources-add',this.config.sources.length>=12?'disabled':'')}${b('sources-connect','Use phone / PC','','','sources-connect')}${this.page?b('sources-prev','Previous','left','','sources-prev'):''}${this.page+1<pages?b('sources-next','Next','right','','sources-next'):''}${b('sources-close','Done','','primary','sources-done')}`;first='source-row-0';
  }
  this.show(`${this.header(t(title))}${body}${footer?'<div class="source-footer">'+footer+'</div>':''}`,focus||first,()=>{
   this.dialog.classList.add(this.phase==='text'?'find-query-options':'sources-options');const close=this.dialog.querySelector('[data-focus="close-dialog"]');close.dataset.action='sources-back';close.dataset.navDown=first;
   if(this.busy)this.dialog.querySelectorAll('[data-action]:not([data-action="sources-back"])').forEach(n=>n.disabled=true);
  });
 }
 async commit(change){
  const guard=this.context();this.busy=true;
  try{this.config=await this.service.handle('change',{...change,revision:this.config.revision},guard);if(!guard())return;this.message=change.type==='remove'?'Source removed. Saved artwork is unchanged.':'Source saved.';this.phase='list';this.page=Math.min(this.page,Math.floor((this.config.sources.length-1)/4));}
  catch(error){if(guard()){this.message=error.message;this.config=await this.service.snapshot();}}
  finally{if(guard()){this.busy=false;this.render();}}
 }
 async test(){
  const guard=this.context();this.busy=true;this.message='Checking search, preview and image access…';this.render('sources-back');
  try{const r=await this.service.handle('test',this.draft.kind==='builtin'?{builtin:this.draft.id}:{draft:this.draft},guard);if(!guard())return;this.ticket=r.ticket;this.draft=r.draft;this.sample=r.sample;this.message=r.message;}
  catch(error){if(guard()){this.ticket='';this.message=error.message;}}
  finally{if(guard()){this.busy=false;this.render(this.ticket&&this.draft.kind==='commons'?'sources-save':'sources-test');}}
 }
 back(){this.abort?.abort();this.busy=false;if(this.phase==='text'){this.phase='details';this.message='';this.render('source-'+this.field);}else if(this.phase!=='list'){this.phase='list';this.message='';this.render();}else{this.dismiss();this.close();}}
 textDone(){this.draft[this.field]=this.dialog.querySelector('#source-text-input').value.trim();this.ticket='';this.sample=null;this.message='';this.phase='details';this.render('source-'+this.field);}
 async handle(action,el){
  if(action==='sources-open'){await this.open();return;}if(!this.visible)return;
  if(action==='sources-back'||action==='sources-close'){this.back();return;}if(this.busy)return;
  switch(action){
   case 'sources-detail':this.draft={...this.config.sources.find(s=>s.id===el.dataset.id)};this.phase='details';this.ticket='';this.sample=null;this.message='';this.render();break;
   case 'sources-add':this.draft={id:'',name:'',category:'',kind:'commons'};this.phase='details';this.ticket='';this.sample=null;this.message='';this.render();break;
   case 'sources-field':this.field=el.dataset.field;this.phase='text';this.message='';this.render();break;
   case 'sources-text-cancel':this.back();break;
   case 'sources-text-done':this.textDone();break;
   case 'sources-test':await this.test();break;
   case 'sources-save':await this.commit({type:'save',draft:this.draft,ticket:this.ticket});break;
   case 'sources-enabled':await this.commit({type:'enabled',id:this.draft.id,enabled:!this.config.sources.find(s=>s.id===this.draft.id).enabled});break;
   case 'sources-default':await this.commit({type:'default',id:this.draft.id});break;
   case 'sources-remove':this.phase='remove';this.render();break;
   case 'sources-keep':this.phase='details';this.render();break;
   case 'sources-remove-confirm':await this.commit({type:'remove',id:this.draft.id});break;
   case 'sources-prev':this.page--;this.render();break;
   case 'sources-next':this.page++;this.render();break;
   case 'sources-connect':this.dismiss();this.connect();break;
  }
 }
}

import {MOBILE_LIMITS,mobileToken,mobileId,mobileName,mobileHash,mobileIce,MobileSender,mobileCollections} from '../app/mobile-shared.mjs';
const $=id=>document.getElementById(id);
const deviceName=/iPhone|iPad/.test(navigator.userAgent)?'iPhone or iPad':/Android/.test(navigator.userAgent)?'Android phone':'Computer browser';
let token=location.hash.slice(1),client=mobileToken(),peer,sender,pollTimer,files=[],previews=[],sending=false,cancelled=false,collectionId='',currentCollectionName='',savedIds=new Set(),transferIds=new Map(),stopped=false,answerSent=false,failures=0,collections=[],collectionsReady=false,loadingCollections=false,batchDestination=null,duplicateIds=new Set(),nameConflictIds=new Set();
// Remove the QR secret from the address bar/history before the page does anything else.
history.replaceState(null,'',location.pathname);
const showError=message=>{$('error').textContent=message;$('error').hidden=false;};
function status(title,detail,kind=''){$('connection-title').textContent=title;$('connection-detail').textContent=detail;$('dot').className='status-dot '+kind;}
async function api(path,body){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),path==='sources/test'?30000:10000);
 try{const response=await fetch('/api/'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'X-Sart-Client':client,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,cache:'no-store',credentials:'omit',signal:controller.signal});const value=await response.json();if(!response.ok)throw new Error(value.error||'The TV could not be reached.');return value;}finally{clearTimeout(timer);}
}
function cleanup(){stopped=true;clearTimeout(pollTimer);closeCollectionPicker();if(sending)sender?.cancel();peer?.close();peer=null;sender=null;$('send').disabled=true;$('disconnect').hidden=true;}
function disconnected(message){cleanup();$('pairing').hidden=true;$('upload-form').hidden=true;$('device-tabs').hidden=true;$('sources-panel').hidden=true;$('help').hidden=false;status('Connection ended',message,'error');}
async function claim(body){const result=await api('claim',body);$('pair-code').textContent=result.code;$('pairing').hidden=false;await poll();}
$('join-form').addEventListener('submit',async event=>{
 event.preventDefault();$('join-error').hidden=true;$('join-button').disabled=true;
 try{const value=await api('pair',{code:$('tv-code').value.trim(),name:deviceName});if(!/^[a-f0-9]{48}$/.test(value.token))throw new Error('The TV returned an invalid connection.');token=value.token;$('join-form').hidden=true;$('pair-code').textContent=value.code;$('pairing').hidden=false;await poll();}
 catch(error){$('join-error').textContent=error.message;$('join-error').hidden=false;}
 finally{$('join-button').disabled=false;}
});
async function poll(){
 if(stopped||sender?.hello)return;
 try{
  const value=await api('status');failures=0;
  if(value.phase==='approval'){status('Waiting for your approval','Choose Allow device with the TV remote.');$('pairing').hidden=false;$('pair-code').textContent=value.code;}
  else if(value.phase==='connecting'){
   status('Making a direct connection','Keep this device on the same home network as the TV.');$('pairing').hidden=true;
   if(value.offer&&!answerSent){answerSent=true;await answer(value.offer);}
  }else if(['closed','error','expired','disconnected'].includes(value.phase)){disconnected(value.error||'Scan a new QR code on the TV to reconnect.');return;}
 }catch(error){if(++failures>=3){disconnected(error.message||'The TV is no longer reachable.');return;}}
 if(!stopped&&!sender?.hello)pollTimer=setTimeout(poll,900);
}
async function answer(offer){
 peer=new RTCPeerConnection({iceServers:[]});
 peer.ondatachannel=event=>{
  const channel=event.channel;if(channel.label!=='sart-photos'){channel.close();return;}
  sender=new MobileSender(channel);
  channel.addEventListener('message',event=>{if(typeof event.data==='string'){try{const message=JSON.parse(event.data);if(message.type==='hello'&&message.v===1){clearTimeout(pollTimer);status('Connected to your TV','Your photos will be saved in SART Gallery.','connected');$('pairing').hidden=true;$('upload-form').hidden=false;$('device-tabs').hidden=false;$('disconnect').hidden=false;void refreshCollections();}}catch{}}});
  channel.addEventListener('close',()=>{if(!stopped)disconnected('Photos already saved are still in your gallery.');});
 };
 peer.onconnectionstatechange=()=>{if(peer?.connectionState==='failed')disconnected('The direct connection failed. Check your Wi-Fi and scan a new code.');};
 await peer.setRemoteDescription(offer);await peer.setLocalDescription(await peer.createAnswer());await mobileIce(peer);
 await api('answer',{answer:{type:peer.localDescription.type,sdp:peer.localDescription.sdp}});
 setTimeout(()=>{if(!stopped&&!sender?.hello)disconnected('Your devices could not connect. Avoid guest Wi-Fi or networks that isolate devices.');},45000);
}
function clearPreviews(){for(const url of previews)URL.revokeObjectURL(url);previews=[];$('thumbnails').replaceChildren();}
let collectionOptions=[],activeCollectionOption=-1,collectionSearch='',collectionSearchAt=0;
function closeCollectionPicker(returnFocus=false){
 const open=!$('collection-options').hidden;$('collection-options').hidden=true;$('collection-select').setAttribute('aria-expanded','false');$('collection-options').removeAttribute('aria-activedescendant');collectionSearch='';
 if(open&&returnFocus)$('collection-select').focus({preventScroll:true});
}
function setCollectionOption(index){
 activeCollectionOption=Math.max(0,Math.min(collectionOptions.length-1,index));
 const options=$('collection-options').children;
 for(let i=0;i<options.length;i++)options[i].dataset.active=String(i===activeCollectionOption);
 const option=options[activeCollectionOption];if(!option)return;
 $('collection-options').setAttribute('aria-activedescendant',option.id);
 const box=$('collection-options');if(option.offsetTop<box.scrollTop)box.scrollTop=option.offsetTop;else if(option.offsetTop+option.offsetHeight>box.scrollTop+box.clientHeight)box.scrollTop=option.offsetTop+option.offsetHeight-box.clientHeight;
}
function openCollectionPicker(index){
 if($('collection-select').disabled||!collectionOptions.length)return;
 const rect=$('collection-select').getBoundingClientRect(),viewport=window.visualViewport,top=viewport?.offsetTop||0,bottom=top+(viewport?.height||innerHeight),below=bottom-rect.bottom-16,above=rect.top-top-16,up=below<220&&above>below;
 $('collection-options').dataset.placement=up?'above':'below';$('collection-options').style.maxHeight=Math.max(48,Math.min(288,up?above:below))+'px';
 $('collection-options').hidden=false;$('collection-select').setAttribute('aria-expanded','true');$('collection-options').focus({preventScroll:true});
 setCollectionOption(index??Math.max(0,collectionOptions.findIndex(g=>g.id===$('collection-select').value)));
}
function renderCollectionOptions(){
 closeCollectionPicker();collectionOptions=[...collections,{id:'new',name:'New collection…'}];
 $('collection-options').replaceChildren(...collectionOptions.map((group,index)=>{
  const option=document.createElement('div'),name=document.createElement('span'),check=document.createElement('span');option.id='collection-option-'+index;option.className='collection-option';option.dataset.value=group.id;option.setAttribute('role','option');option.setAttribute('aria-selected',String(group.id===$('collection-select').value));
  name.textContent=(group.id==='new'?'＋ ':'')+group.name;check.textContent=group.id===$('collection-select').value?'✓':'';check.setAttribute('aria-hidden','true');option.append(name,check);return option;
 }));
 $('collection-value').textContent=collectionOptions.find(g=>g.id===$('collection-select').value)?.name||'Choose a collection';
}
function chooseCollectionOption(index){
 const option=collectionOptions[index];if(!option)return;$('collection-select').value=option.id;renderCollectionOptions();$('collection-select').focus({preventScroll:true});$('collection-select').dispatchEvent(new Event('change'));
}
function collectionPickerKey(event){
 const open=!$('collection-options').hidden;
 if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
  event.preventDefault();const index=event.key==='Home'?0:event.key==='End'?collectionOptions.length-1:open?activeCollectionOption+(event.key==='ArrowDown'?1:-1):undefined;
  if(open)setCollectionOption(index);else openCollectionPicker(index);return;
 }
 if(event.key==='Escape'&&open){event.preventDefault();event.stopPropagation();closeCollectionPicker(true);return;}
 if(event.key==='Tab'){if(open)$('collection-select').focus({preventScroll:true});closeCollectionPicker();return;}
 if((event.key==='Enter'||event.key===' ')&&open){event.preventDefault();chooseCollectionOption(activeCollectionOption);return;}
 if(event.key.length===1&&!event.ctrlKey&&!event.altKey&&!event.metaKey&&event.key!==' '){
  event.preventDefault();const now=Date.now();collectionSearch=(now-collectionSearchAt>700?'':collectionSearch)+event.key.toLocaleLowerCase();collectionSearchAt=now;
  const index=collectionOptions.findIndex(g=>g.name.toLocaleLowerCase().startsWith(collectionSearch));if(index>=0){if(open)setCollectionOption(index);else openCollectionPicker(index);}
 }
}
$('collection-select').addEventListener('click',()=>{if($('collection-options').hidden)openCollectionPicker();else closeCollectionPicker(true);});
$('collection-select').addEventListener('keydown',collectionPickerKey);$('collection-options').addEventListener('keydown',collectionPickerKey);
$('collection-options').addEventListener('click',event=>{const option=event.target.closest('[role=option]');if(option)chooseCollectionOption(collectionOptions.findIndex(g=>g.id===option.dataset.value));});
document.addEventListener('pointerdown',event=>{if(!$('collection-picker').contains(event.target))closeCollectionPicker();});
document.addEventListener('focusin',event=>{if(!$('collection-picker').contains(event.target))closeCollectionPicker();});
window.addEventListener('resize',()=>closeCollectionPicker(true));
function updateSend(){const selected=$('collection-select').value,valid=batchDestination||selected==='new'&&mobileName($('collection-name').value,'',80)||collections.some(g=>g.id===selected);$('send').disabled=sending||loadingCollections||!collectionsReady||!sender?.hello||!files.length||!valid;}
function resetSelection(){files=[];savedIds.clear();duplicateIds.clear();nameConflictIds.clear();transferIds.clear();batchDestination=null;collectionControls();$('photos').value='';clearPreviews();$('selection').hidden=true;updateSend();}
function collectionControls(){
 const locked=sending||!!batchDestination,isNew=$('collection-select').value==='new';
 $('collection-select').disabled=locked||loadingCollections||!collectionsReady;$('refresh-collections').disabled=locked||loadingCollections||!sender?.hello;
 if($('collection-select').disabled)closeCollectionPicker();
 $('new-collection').hidden=!isNew;$('collection-name').disabled=locked||!isNew;$('collection-name').required=isNew;
 if(batchDestination&&!sending){$('collection-message').textContent='Retry keeps this destination. Clear the selection to change it.';$('collection-message').hidden=false;}
 else if(collectionsReady){$('collection-message').hidden=true;}
}
async function refreshCollections(preferred=$('collection-select').value){
 if(loadingCollections||stopped)return;loadingCollections=true;collectionControls();updateSend();
 try{
  const result=await api('collections');if(stopped)return;collections=mobileCollections(result.collections);collectionsReady=true;
  $('collection-select').value=preferred==='new'||collections.some(g=>g.id===preferred)?preferred:collections.some(g=>g.id==='my-photos')?'my-photos':collections[0]?.id||'new';
  renderCollectionOptions();
 }catch(error){if(stopped)return;collectionsReady=false;$('collection-message').textContent='Could not load collections. Select Refresh to try again.';$('collection-message').hidden=false;}
 finally{loadingCollections=false;collectionControls();updateSend();}
}
function chosenCollection(){
 if(!collectionsReady)throw new Error('Refresh the collection list before sending.');
 if($('collection-select').value==='new'){
  const name=mobileName($('collection-name').value,'',80);if(!name)throw new Error('Enter a name for your new collection.');
  if(currentCollectionName!==name||!collectionId){collectionId='mobile-'+mobileId();currentCollectionName=name;}
  return {id:collectionId,name,mode:'new'};
 }
 const group=collections.find(g=>g.id===$('collection-select').value);if(!group)throw new Error('Choose a collection before sending.');return {...group,mode:'existing'};
}
$('collection-select').addEventListener('change',()=>{if($('collection-select').value==='new'){collectionId='';currentCollectionName='';}collectionControls();updateSend();});
$('collection-name').addEventListener('input',updateSend);
$('refresh-collections').addEventListener('click',()=>void refreshCollections());
$('picker-label').addEventListener('click',()=>{
 if(sending)return;
 // iOS can keep the text keyboard/IME attached to the collection field when
 // an associated label opens a native file menu. End text editing explicitly,
 // and open the actual input synchronously within this trusted user gesture.
 document.activeElement?.blur();
 $('photos').focus({preventScroll:true});
 $('photos').click();
});
$('photos').addEventListener('cancel',()=>$('picker-label').focus({preventScroll:true}));
$('photos').addEventListener('change',()=>{
 $('picker-label').focus({preventScroll:true});
 if(sending)return;clearPreviews();savedIds.clear();duplicateIds.clear();nameConflictIds.clear();transferIds.clear();batchDestination=null;collectionControls();$('error').hidden=true;$('success').hidden=true;files=Array.from($('photos').files);
 if(files.length>MOBILE_LIMITS.batch){files=[];showError('Choose up to 50 photos at a time.');}
 const tooLarge=files.some(file=>file.size>MOBILE_LIMITS.sourceBytes||file.size<1);if(tooLarge){files=[];showError('Each original photo must be under 25 MB.');}
 $('selection').hidden=!files.length;$('selection-count').textContent=files.length+' photo'+(files.length===1?'':'s')+' selected';
 for(const [index,file] of files.slice(0,6).entries()){const url=URL.createObjectURL(file);previews.push(url);const wrap=document.createElement('div');wrap.className='thumb';const image=new Image();image.src=url;image.alt='Selected photo '+(index+1);wrap.append(image);$('thumbnails').append(wrap);}
 updateSend();
});
$('clear').addEventListener('click',resetSelection);
$('cancel').addEventListener('click',()=>{cancelled=true;sender?.cancel();$('cancel').disabled=true;});
$('disconnect').addEventListener('click',()=>{void api('cancel',{}).catch(()=>{});disconnected('Scan a new QR code when you want to add more photos.');});
async function displayCopy(file){
 const url=URL.createObjectURL(file),image=new Image();image.decoding='async';
 try{
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('That image took too long to open. Export it as JPEG and try again.')),20000);image.onload=()=>{clearTimeout(timer);resolve();};image.onerror=()=>{clearTimeout(timer);reject(new Error('This browser cannot open “'+mobileName(file.name,'photo',60)+'”. Export it as JPEG and try again.'));};image.src=url;});
  if(!image.naturalWidth||!image.naturalHeight||image.naturalWidth*image.naturalHeight>60000000)throw new Error('Choose an image under 60 megapixels.');
  const scale=Math.min(1,3840/image.naturalWidth,2160/image.naturalHeight),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));const context=canvas.getContext('2d');context.fillStyle='#f8f6f1';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);
  const blob=await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('The photo could not be prepared.')),'image/jpeg',.9));canvas.width=canvas.height=1;
  if(blob.size>MOBILE_LIMITS.photoBytes)throw new Error('The display copy is too large. Choose a smaller photo.');return blob;
 }finally{image.src='';URL.revokeObjectURL(url);}
}
$('upload-form').addEventListener('submit',async event=>{
 event.preventDefault();if(sending||!files.length)return;
 let target;try{target=batchDestination||chosenCollection();}catch(error){showError(error.message);$('collection-name').focus();return;}batchDestination=target;const name=target.name;
 sending=true;updateDeviceTabs();cancelled=false;$('error').hidden=true;$('success').hidden=true;$('transfer').hidden=false;$('cancel').hidden=false;$('cancel').disabled=false;
 for(const id of ['photos','picker-label','clear'])$(id).disabled=true;collectionControls();updateSend();
 try{
  for(const [index,file]of files.entries()){
   if(savedIds.has(index))continue;if(cancelled)break;
   $('transfer-title').textContent='Preparing photo '+(index+1)+' of '+files.length;$('progress').value=0;$('percentage').textContent='';$('transfer-detail').textContent='Creating a display copy on your device…';
   const blob=await displayCopy(file);if(cancelled)break;if(!transferIds.has(index))transferIds.set(index,mobileId());const meta={v:1,type:'photo',id:transferIds.get(index),bytes:blob.size,sha256:await mobileHash(await blob.arrayBuffer()),title:mobileName(file.name.replace(/\.[^.]+$/,'')),collectionId:target.id,collectionName:name,collectionMode:target.mode};if(cancelled)break;
   $('transfer-title').textContent='Sending photo '+(index+1)+' of '+files.length;
   const reply=await sender.send({meta,blob},(bytes,total)=>{const percent=Math.round(bytes/total*100);$('progress').value=percent;$('percentage').textContent=percent+'%';$('transfer-detail').textContent=percent===100?'Checking and saving on your TV…':'Sending directly to your TV…';});
   savedIds.add(index);if(reply?.status==='existing'){duplicateIds.add(index);if(reply.reason==='name')nameConflictIds.add(index);}$('transfer-detail').textContent=reply?.status==='existing'?'Already in collection.':'Saved on your TV.';
  }
  if(cancelled)throw new Error('Transfer cancelled. Photos already saved stay on your TV.');
  const added=savedIds.size-duplicateIds.size,existing=duplicateIds.size;$('success').textContent=added?added+' photo'+(added===1?'':'s')+' added to “'+name+'”.'+(existing?' '+existing+' already in this collection; no extra copies were saved.':''):existing+' photo'+(existing===1?' is':'s are')+' already in “'+name+'”. No extra copies were saved.';if(nameConflictIds.size)$('success').textContent+=' A saved image already uses that name. Rename the file to add a different image.';$('success').hidden=false;$('transfer').hidden=true;resetSelection();await refreshCollections(target.id);
 }catch(error){showError(error.message+' '+(savedIds.size?(savedIds.size-duplicateIds.size)+' added · '+duplicateIds.size+' already in collection.':''));$('transfer-detail').textContent='Only confirmed photos are marked as saved.';}
 finally{sending=false;updateDeviceTabs();for(const id of ['photos','picker-label','clear'])$(id).disabled=false;$('cancel').hidden=true;collectionControls();updateSend();}
});
window.addEventListener('pagehide',()=>{cleanup();token='';clearPreviews();});
async function boot(){
 if(!/^[a-f0-9]{48}$/.test(token)){status('Connect to your TV','Enter the six-digit code shown in SART Gallery.');$('join-form').hidden=false;return;}
 if(typeof RTCPeerConnection!=='function'){disconnected('This browser does not support WebRTC data transfer. Try Safari or Chrome.');return;}
 try{await claim({name:deviceName});}catch(error){disconnected(error.message);}
}
void boot();

// The existing approved, TLS-protected session carries source settings too.
// Public-source requests happen on the TV; the phone never proxies artwork.
let sourceConfig=null,sourceDraft=null,sourceTicket='',sourceBusy=false,sourceView=false;
const sourceStatus=message=>{$('sources-status').textContent=message;};
function updateDeviceTabs(){$('mode-sources').disabled=sending;$('mode-photos').disabled=sourceBusy;}
function sourceMode(show){if(sending||sourceBusy||stopped)return;sourceView=show;$('mode-photos').setAttribute('aria-pressed',String(!show));$('mode-sources').setAttribute('aria-pressed',String(show));$('upload-form').hidden=show;$('sources-panel').hidden=!show;document.querySelector('.intro h1').textContent=show?'Art sources.':'Add photos.';$('connection-detail').textContent=show?'Manage sources saved on this TV.':'Your photos will be saved in SART Gallery.';if(show)void loadSources();}
$('mode-photos').addEventListener('click',()=>sourceMode(false));$('mode-sources').addEventListener('click',()=>sourceMode(true));
function sourceButton(label,action){const b=document.createElement('button');b.type='button';b.className='text-button';b.textContent=label;b.addEventListener('click',()=>void action());return b;}
function renderSources(){
 $('sources-list').replaceChildren();$('sources-list').hidden=!!sourceDraft;$('source-add').hidden=!!sourceDraft;$('sources-refresh').hidden=!!sourceDraft;
 if(!sourceConfig)return;$('source-add').disabled=sourceConfig.sources.length>=12||sourceBusy;
 for(const s of sourceConfig.sources){
  const row=document.createElement('article'),heading=document.createElement('strong'),info=document.createElement('p'),actions=document.createElement('div');row.className='device-source';heading.textContent=s.name;info.textContent=(s.kind==='commons'?'Commons category':'Included source')+(sourceConfig.defaultId===s.id?' · Default':'')+(s.enabled?'':' · Off');actions.className='device-source-actions';
  const toggle=sourceButton(s.enabled?'On':'Off',()=>changeSource({type:'enabled',id:s.id,enabled:!s.enabled}));toggle.setAttribute('role','switch');toggle.setAttribute('aria-checked',String(s.enabled));toggle.setAttribute('aria-label',s.name);toggle.disabled=sourceBusy;actions.append(toggle);
  const def=sourceButton(sourceConfig.defaultId===s.id?'Default source':'Use by default',()=>changeSource({type:'default',id:s.id}));def.disabled=sourceBusy||!s.enabled||sourceConfig.defaultId===s.id;actions.append(def);
  if(s.kind==='commons'){const edit=sourceButton('Edit',()=>editSource(s));edit.disabled=sourceBusy;actions.append(edit);}
  row.append(heading,info,actions);$('sources-list').append(row);
 }
}
async function loadSources(){if(sourceBusy||stopped)return;sourceBusy=true;updateDeviceTabs();sourceStatus('Loading sources…');try{sourceConfig=await api('sources');if(!stopped){sourceStatus('');renderSources();}}catch(e){if(!stopped)sourceStatus(e.message);}finally{sourceBusy=false;updateDeviceTabs();if(!stopped)renderSources();}}
async function changeSource(change){if(sourceBusy||!sourceConfig||stopped)return;sourceFormBusy(true);renderSources();sourceStatus('Saving sources…');try{sourceConfig=await api('sources/change',{...change,revision:sourceConfig.revision});if(stopped)return;sourceDraft=null;$('source-form').hidden=true;sourceStatus(change.type==='remove'?'Source removed. Your saved artwork is unchanged.':'Sources saved on your TV.');}catch(e){if(!stopped){if(e.message.includes('Sources changed')){try{sourceConfig=await api('sources');sourceStatus('Sources changed on another screen. The list is refreshed; review and save again.');}catch{sourceStatus('Could not refresh sources. Return to All sources and select Refresh.');}}else sourceStatus(e.message);}}finally{sourceFormBusy(false);if(!stopped){renderSources();if(!sourceDraft)$('source-add').focus({preventScroll:true});}}}
function editSource(source={id:'',name:'',category:''}){
 if(sourceBusy)return;sourceDraft={id:source.id,name:source.name,category:source.category,kind:'commons'};sourceTicket='';$('source-name').value=source.name;$('source-category').value=source.category;$('source-save').disabled=true;$('source-feedback').textContent='Test this source before saving it.';$('source-remove').hidden=!source.id;$('source-remove-confirm').hidden=true;$('source-form-title').textContent=source.id?'Edit source':'Add art source';$('source-form').hidden=false;renderSources();$('source-back').focus({preventScroll:true});
}
$('source-add').addEventListener('click',()=>editSource());$('sources-refresh').addEventListener('click',()=>void loadSources());
$('source-back').addEventListener('click',()=>{if(sourceBusy)return;sourceDraft=null;$('source-form').hidden=true;renderSources();$('source-add').focus({preventScroll:true});});
function sourceEdited(){sourceTicket='';$('source-save').disabled=true;$('source-feedback').textContent='Test this source before saving it.';}
$('source-name').addEventListener('input',sourceEdited);$('source-category').addEventListener('input',sourceEdited);
function sourceFormBusy(busy){sourceBusy=busy;updateDeviceTabs();for(const id of ['source-name','source-category','source-test','source-back','source-remove','source-keep','source-remove-final'])$(id).disabled=busy;$('source-save').disabled=busy||!sourceTicket;}
$('source-test').addEventListener('click',async()=>{
 if(sourceBusy||!sourceDraft)return;document.activeElement?.blur();sourceFormBusy(true);$('source-test-cancel').hidden=false;$('source-feedback').textContent='Checking search, preview and image access…';
 try{const r=await api('sources/test',{draft:{...sourceDraft,name:$('source-name').value,category:$('source-category').value}});if(stopped)return;sourceDraft=r.draft;sourceTicket=r.ticket;$('source-name').value=r.draft.name;$('source-category').value=r.draft.category;$('source-feedback').textContent=r.message+' Example: '+r.sample.title+' · '+r.sample.rights;}
 catch(e){if(!stopped){sourceTicket='';$('source-feedback').textContent=e.message;}}
 finally{$('source-test-cancel').hidden=true;sourceFormBusy(false);if(!stopped&&sourceTicket)$('source-save').focus({preventScroll:true});}
});
$('source-form').addEventListener('submit',async event=>{event.preventDefault();if(sourceBusy||!sourceTicket)return;document.activeElement?.blur();await changeSource({type:'save',draft:{...sourceDraft,name:$('source-name').value,category:$('source-category').value},ticket:sourceTicket});});
$('source-remove').addEventListener('click',()=>{$('source-remove-confirm').hidden=false;$('source-keep').focus({preventScroll:true});});$('source-keep').addEventListener('click',()=>{$('source-remove-confirm').hidden=true;$('source-remove').focus({preventScroll:true});});$('source-remove-final').addEventListener('click',()=>void changeSource({type:'remove',id:sourceDraft?.id}));

$('source-test-cancel').addEventListener('click',()=>{void api('sources/cancel',{}).catch(e=>{$('source-feedback').textContent=e.message;});});

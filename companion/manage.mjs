const $ = id => document.getElementById(id);
const managementToken = document.querySelector('meta[name="sart-management-token"]')?.content || '';
let uploading = false;
const esc = value => String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const bytes = n => (n/1024/1024).toFixed(1)+' MB';

async function api(path, options={}) {
  const response=await fetch(path,{...options,headers:{...options.headers,'X-Sart-Management':managementToken},cache:'no-store',credentials:'omit'});
  const data=await response.json();
  if(!response.ok)throw new Error(data.error||'The local library is unavailable.');
  return data;
}
async function refresh() {
  try {
    const data=await api('/api/manage/status');
    $('pair-code').textContent=data.code.slice(0,3)+' '+data.code.slice(3);
    $('mac-address').textContent=data.addresses[0]||'Use your PC’s local IP address with port '+location.port;
    $('connection-status').textContent='The code changes after a screen connects.';
    $('photo-count').textContent=data.items.length+' photo'+(data.items.length===1?'':'s');
    $('storage').textContent=bytes(data.items.reduce((sum,p)=>sum+p.bytes,0))+' / '+bytes(data.limit);
    const signature=data.items.map(p=>p.id).join(',');
    if($('photos-grid').dataset.signature!==signature){
      $('photos-grid').dataset.signature=signature;
      $('photos-grid').innerHTML=data.items.length?data.items.map(p=>`<article class="photo"><img src="/api/manage/images/${p.id}" alt="${esc(p.title)}" loading="lazy"><h3>${esc(p.title)}</h3><div class="meta"><span>${p.width} × ${p.height}</span><button class="remove" data-id="${p.id}" aria-label="Remove ${esc(p.title)} from PC library">Remove</button></div></article>`).join(''):'<p class="empty">Your photographs will appear here.</p>';
    }
  }catch(error){$('connection-status').textContent=error.message;}
}
function status(message,error=false){$('upload-status').textContent=message;$('upload-status').classList.toggle('error',error);}
async function upload(files){
  if(uploading)return;
  uploading=true;
  let done=0;
  const errors=[];
  for(const file of files){
    status(`Saving ${done+1} of ${files.length}: ${file.name}`);
    try{
      if(file.size>25*1024*1024)throw new Error('Choose an image under 25 MB.');
      await api('/api/manage/photos?name='+encodeURIComponent(file.name),{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:file});
      done++;
    }catch(error){errors.push(file.name+': '+error.message);}
  }
  status(errors.length?`${done} saved. ${errors.join(' ')}`:`${done} photo${done===1?'':'s'} ready for your TV.`,errors.length>0);
  uploading=false;$('photos').value='';await refresh();
}
$('photos').addEventListener('change',event=>void upload([...event.target.files]));
for(const event of ['dragenter','dragover'])$('dropzone').addEventListener(event,e=>{e.preventDefault();$('dropzone').classList.add('dragover');});
for(const event of ['dragleave','drop'])$('dropzone').addEventListener(event,e=>{e.preventDefault();$('dropzone').classList.remove('dragover');});
$('dropzone').addEventListener('drop',event=>void upload([...event.dataTransfer.files]));
$('photos-grid').addEventListener('click',async event=>{
  const button=event.target.closest('[data-id]');
  if(!button||!confirm('Remove this photo from the PC library? Copies already saved on your TV will stay there.'))return;
  try{await api('/api/manage/photos/'+button.dataset.id,{method:'DELETE'});await refresh();}catch(error){status(error.message,true);}
});
$('revoke').addEventListener('click',async()=>{
  if(!confirm('Disconnect all paired screens? Their saved photos will remain available.'))return;
  try{await api('/api/manage/pairings',{method:'DELETE'});await refresh();status('Screens disconnected. Use the new code to reconnect.');}catch(error){status(error.message,true);}
});
void refresh();setInterval(()=>void refresh(),3000);

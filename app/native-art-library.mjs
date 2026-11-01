// The native manager is restricted to Samsung's personal My Photos category.
export function nativeArtIds(ids,limit=50){
 if(!Array.isArray(ids)||!ids.length||ids.length>limit||ids.some(id=>typeof id!=='string'||!/^MY_[A-Za-z0-9_-]{1,100}$/.test(id))||new Set(ids).size!==ids.length)throw new Error('Choose valid photos from Samsung My Photos.');
 return [...ids];
}
export function nativePersonalArt(records){return records.filter(p=>p.category_id==='MY-C0002'&&typeof p.content_id==='string'&&/^MY_[A-Za-z0-9_-]{1,100}$/.test(p.content_id));}
export function nativeExportMatch(exports,photoId,hash,appearanceKey=''){
 const values=exports&&typeof exports==='object'&&!Array.isArray(exports)?exports:{};
 return [values[photoId],...Object.values(values)].find(p=>p&&p.sha256===hash&&(p.appearanceKey||'')===appearanceKey&&typeof p.contentId==='string'&&/^MY_[A-Za-z0-9_-]{1,100}$/.test(p.contentId))||null;
}
export function nativeExportRemember(stored,photoId,entry){
 nativeArtIds([entry?.contentId]);
 if(typeof photoId!=='string'||!photoId||photoId.length>200||!/^[a-f0-9]{64}$/.test(entry.sha256))throw new Error('Invalid Art Mode copy identity.');
 const exports=Object.assign(Object.create(null),stored&&typeof stored==='object'&&!Array.isArray(stored)?stored:{});
 // Keep the original index and every styled variant separate. Native deletion
 // removes only the index entries belonging to that exact native photo ID.
 const key=entry.appearanceKey?'sart:'+photoId+':'+entry.sha256:photoId;
 exports[key]={...entry,sourcePhotoId:photoId};return exports;
}
export function nativeThumbnailMime(bytes){
 if(bytes[0]===255&&bytes[1]===216)return 'image/jpeg';
 if(bytes.length>=24&&[137,80,78,71,13,10,26,10].every((b,i)=>bytes[i]===b)){const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);if(v.getUint32(16)>4096||v.getUint32(20)>4096)throw new Error('Native preview dimensions are too large.');return 'image/png';}
 throw new Error('Samsung returned an invalid photo preview.');
}
export class NativeThumbnailReader{
 constructor(ids){this.ids=new Set(nativeArtIds(ids,6));this.chunks=[];this.length=0;this.received=0;this.header=null;this.headerLength=0;this.images=[];this.total=0;this.complete=false;}
 take(n){const out=new Uint8Array(n);let at=0;while(at<n){const c=this.chunks[0],count=Math.min(c.length,n-at);out.set(c.subarray(0,count),at);at+=count;this.length-=count;if(count===c.length)this.chunks.shift();else this.chunks[0]=c.subarray(count);}return out;}
 push(bytes){
  if(this.complete&&bytes.length)throw new Error('Unexpected extra native preview data.');
  this.received+=bytes.length;if(this.received>12*1024*1024)throw new Error('Native previews exceed the memory limit.');
  if(bytes.length){this.chunks.push(bytes);this.length+=bytes.length;}
  while(!this.complete){
   if(!this.header){
    if(!this.headerLength){if(this.length<4)return;const b=this.take(4);this.headerLength=new DataView(b.buffer).getUint32(0);if(this.headerLength<2||this.headerLength>4096)throw new Error('Invalid native preview header.');}
    if(this.length<this.headerLength)return;
    const h=JSON.parse(new TextDecoder().decode(this.take(this.headerLength)));this.headerLength=0;
    const id=String(h.fileID||'').replace(/\.(jpe?g|png)$/i,'');
    const numeric=value=>typeof value==='number'||(typeof value==='string'&&/^\d{1,8}$/.test(value)),size=Number(h.fileLength),total=Number(h.total);
    if(!this.ids.has(id)||this.images.some(p=>p.id===id)||!numeric(h.fileLength)||!Number.isInteger(size)||size<4||size>2*1024*1024||!numeric(h.total)||!Number.isInteger(total)||total<1||total>this.ids.size||(this.total&&total!==this.total))throw new Error('Unexpected native preview identity or size.');
    this.total=total;this.header={id,fileLength:size};
   }
   if(this.length<this.header.fileLength)return;
   const buffer=this.take(this.header.fileLength);this.images.push({id:this.header.id,buffer:buffer.buffer,mime:nativeThumbnailMime(buffer)});this.header=null;
   if(this.images.length===this.total){this.complete=true;if(this.length)throw new Error('Unexpected trailing native preview data.');}
  }
 }
}

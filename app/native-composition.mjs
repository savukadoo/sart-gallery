import {MATTES,normaliseLook,MAX_PHOTO_BYTES} from './core.mjs';

export const NATIVE_LOOK_SIZE=Object.freeze({width:3840,height:2160});
// Version this recipe when its pixels change: old Samsung copies stay reusable.
export function nativeLookKey(value){
 const look=normaliseLook(value);
 return JSON.stringify({renderer:1,...NATIVE_LOOK_SIZE,...look,matStyle:look.matte==='none'?'flat':look.matStyle});
}
export function nativeLookGeometry(value,width=3840,height=2160){
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<160||height<90||width>3840||height>2160)throw new Error('Invalid Art Mode render size.');
 const look=normaliseLook(value),unit=Math.min(width,height),scale=width/1920;
 const frame=look.frame==='none'?0:unit*(look.frame==='shadow'?.035:.028);
 const px=look.frame==='shadow'?width*.06:look.matte==='none'?0:width*.045;
 const py=look.frame==='shadow'?height*.07:look.matte==='none'?0:height*.05;
 const bevel=look.matte==='none'||look.matStyle==='flat'?0:look.matStyle==='bevel-thick'?Math.max(4*scale,Math.min(10*scale,unit*.0068)):Math.max(3*scale,Math.min(7*scale,unit*.0048));
 const mat={x:frame,y:frame,width:width-frame*2,height:height-frame*2};
 const opening={x:frame+px,y:frame+py,width:width-(frame+px)*2,height:height-(frame+py)*2};
 const image={x:opening.x+bevel,y:opening.y+bevel,width:opening.width-bevel*2,height:opening.height-bevel*2};
 return {width,height,scale,look,frame,bevel,mat,opening,image};
}
export function nativeImagePlacement(imageWidth,imageHeight,box,fit){
 if(!Number.isFinite(imageWidth)||!Number.isFinite(imageHeight)||imageWidth<=0||imageHeight<=0)throw new Error('The artwork dimensions are unavailable.');
 const ratio=(fit==='contain'?Math.min:Math.max)(box.width/imageWidth,box.height/imageHeight);
 const width=imageWidth*ratio,height=imageHeight*ratio;
 return {x:box.x+(box.width-width)/2,y:box.y+(box.height-height)/2,width,height};
}
const FRAME_COLOURS={white:['#faf8f1','#dedbd2','#9a978f'],teak:['#d4ad7b','#b4824d','#77512f'],walnut:['#7e6048','#503927','#23180f'],gold:['#f0dba5','#c3a268','#79613b'],shadow:['#41454a','#22272d','#07090b']};
function polygon(ctx,points){ctx.beginPath();points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();}
function gradient(ctx,x1,y1,x2,y2,stops){const g=ctx.createLinearGradient(x1,y1,x2,y2);for(const [at,colour] of stops)g.addColorStop(at,colour);return g;}
function inset(ctx,box,depth,alpha,sides=['top','left','right','bottom']){
 const {x,y,width:w,height:h}=box,clear='rgba(0,0,0,0)',dark='rgba(0,0,0,'+alpha+')';
 for(const side of sides){
  const horizontal=side==='top'||side==='bottom',reverse=side==='right'||side==='bottom';
  const x1=horizontal?x:reverse?x+w:x,y1=horizontal?(reverse?y+h:y):y;
  ctx.fillStyle=gradient(ctx,x1,y1,x1+(horizontal?0:reverse?-depth:depth),y1+(horizontal?(reverse?-depth:depth):0),[[0,dark],[1,clear]]);
  ctx.fillRect(horizontal?x:reverse?x+w-depth:x,horizontal?(reverse?y+h-depth:y):y,horizontal?w:depth,horizontal?depth:h);
 }
}
function paintFrame(ctx,g,scope){
 if(!g.frame)return;
 const {width:w,height:h,frame:f,scale,look}=g,[light,colour,dark]=FRAME_COLOURS[look.frame];
 const rails=[{points:[[0,0],[w,0],[w-f,f],[f,f]],x:0,y:0,vertical:true},{points:[[f,h-f],[w-f,h-f],[w,h],[0,h]],x:0,y:h-f,vertical:true},{points:[[0,0],[f,f],[f,h-f],[0,h]],x:0,y:0,vertical:false},{points:[[w-f,f],[w,0],[w,h],[w-f,h-f]],x:w-f,y:0,vertical:false}];
 for(const rail of rails){
  ctx.save();polygon(ctx,rail.points);ctx.clip();
  if(['teak','walnut'].includes(look.frame)){
   const period=Math.max(1,Math.round(7*scale)),tile=scope.document.createElement('canvas');tile.width=rail.vertical?1:period;tile.height=rail.vertical?period:1;
   const t=tile.getContext('2d');t.fillStyle=gradient(t,0,rail.vertical?period:0,rail.vertical?0:period,0,[[0,colour],[1/7,dark],[2/7,colour],[3/7,light],[1,colour]]);t.fillRect(0,0,tile.width,tile.height);
   ctx.fillStyle=ctx.createPattern(tile,'repeat');ctx.fillRect(0,0,w,h);tile.width=tile.height=1;
   ctx.fillStyle=gradient(ctx,rail.x,rail.y,rail.x+(rail.vertical?0:f),rail.y+(rail.vertical?f:0),[[0,'rgba(255,255,255,.188)'],[.22,'rgba(0,0,0,0)'],[.75,'rgba(0,0,0,.063)'],[1,'rgba(0,0,0,.502)']]);
  }else{
   const stops=look.frame==='gold'?[[0,'#f0dba5'],[.13,'#b99a61'],[.3,'#e3c58d'],[.76,'#aa8952'],[1,'#765a32']]:[[0,light],[.2,colour],[.7,colour],[1,dark]];
   ctx.fillStyle=gradient(ctx,rail.x,rail.y,rail.x+(rail.vertical?0:f),rail.y+(rail.vertical?f:0),stops);
  }
  ctx.fillRect(0,0,w,h);ctx.restore();
 }
}
export function paintNativeLook(canvas,image,value,scope=globalThis){
 const g=nativeLookGeometry(value,canvas.width,canvas.height),ctx=canvas.getContext('2d',{alpha:false});
 if(!ctx)throw new Error('Artwork rendering is unavailable on this TV.');
 const colour=MATTES[g.look.matte];ctx.fillStyle=colour;ctx.fillRect(0,0,g.width,g.height);
 if(g.bevel){
  ctx.fillStyle=gradient(ctx,0,0,g.width,g.height,[[0,'rgba(255,255,255,.047)'],[.45,'rgba(0,0,0,0)'],[1,'rgba(0,0,0,.039)']]);ctx.fillRect(g.mat.x,g.mat.y,g.mat.width,g.mat.height);
  const r=g.opening,b=g.bevel,x=r.x,y=r.y,w=r.width,h=r.height;
  const edges=[{colour:'#b8b0a0',p:[[x,y],[x+w,y],[x+w-b,y+b],[x+b,y+b]]},{colour:'#faf5e9',p:[[x+w-b,y+b],[x+w,y],[x+w,y+h],[x+w-b,y+h-b]]},{colour:'#fff9ec',p:[[x+b,y+h-b],[x+w-b,y+h-b],[x+w,y+h],[x,y+h]]},{colour:'#d5cebe',p:[[x,y],[x+b,y+b],[x+b,y+h-b],[x,y+h]]}];
  for(const edge of edges){polygon(ctx,edge.p);ctx.fillStyle=edge.colour;ctx.fill();}
 }
 const dest=nativeImagePlacement(image.naturalWidth||image.width,image.naturalHeight||image.height,g.image,g.look.fit);
 ctx.save();ctx.beginPath();ctx.rect(g.image.x,g.image.y,g.image.width,g.image.height);ctx.clip();ctx.fillStyle=colour;ctx.fillRect(g.image.x,g.image.y,g.image.width,g.image.height);ctx.drawImage(image,dest.x,dest.y,dest.width,dest.height);
 if(g.look.matte!=='none'){
  if(g.bevel){inset(ctx,g.image,Math.min(g.width,g.height)*.0055,.33,['top']);inset(ctx,g.image,Math.min(g.width,g.height)*.004,.13,['left']);}
  else inset(ctx,g.image,5*g.scale,.22,['top','left']);
 }
 ctx.restore();if(g.look.frame==='shadow')inset(ctx,g.mat,14*g.scale,.56);
 paintFrame(ctx,g,scope);return g;
}
export async function renderNativeLook(bytes,value,{active=()=>true,scope=globalThis,width=3840,height=2160}={}){
 if(!(bytes instanceof Uint8Array)||bytes.length<4||bytes.length>MAX_PHOTO_BYTES)throw new Error('Choose artwork under 12 MB.');
 const current=()=>{if(!active())throw new DOMException('Art Mode rendering cancelled.','AbortError');};
 let image,canvas,url;
 try{
  current();nativeLookGeometry(value,width,height);image=new scope.Image();url=scope.URL.createObjectURL(new Blob([bytes],{type:'image/jpeg'}));
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{image.onload=image.onerror=null;reject(new Error('The artwork took too long to decode.'));},10000);image.onload=()=>{clearTimeout(timer);resolve();};image.onerror=()=>{clearTimeout(timer);reject(new Error('The artwork could not be decoded.'));};image.src=url;});
  current();if(!image.naturalWidth||!image.naturalHeight||image.naturalWidth>8192||image.naturalHeight>8192||image.naturalWidth*image.naturalHeight>32000000)throw new Error('The artwork dimensions are too large.');
  canvas=scope.document.createElement('canvas');canvas.width=width;canvas.height=height;paintNativeLook(canvas,image,value,scope);current();
  const blob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('The styled artwork could not be created.')),'image/jpeg',.94));
  current();if(blob.type!=='image/jpeg'||blob.size>MAX_PHOTO_BYTES)throw new Error('The styled artwork exceeds the 12 MB Art Mode limit.');
  return {blob,width,height,appearanceKey:nativeLookKey(value)};
 }finally{
  if(image){image.onload=image.onerror=null;image.src='';}
  if(url)scope.URL.revokeObjectURL(url);
  if(canvas)canvas.width=canvas.height=1;
 }
}

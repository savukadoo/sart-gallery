// Only artwork layers animate. The frame, mat, bevel and remote controls remain
// outside the animation. Old loads/animations cannot replace a newer artwork.
export const ARTWORK_MOTION_DURATION=18000;
export class ArtworkPresenter {
 constructor({onSettled=()=>{},onError=()=>{}}={}) {
  this.onSettled=onSettled;this.onError=onError;this.generation=0;this.busy=false;this.motionActive=false;
  this.media=typeof matchMedia==='function'?matchMedia('(prefers-reduced-motion: reduce)'):null;
  const mediaChanged=()=>{if(this.media.matches&&this.animations?.length)this.finish();this.updateMotion();};
  if(this.media?.addEventListener)this.media.addEventListener('change',mediaChanged);
  else this.media?.addListener?.(mediaChanged);
 }
 clear(){
  this.generation++;this.cancelLoad?.();this.cancelLoad=null;this.finish(false);this.stopMotion();
  this.canvas=null;this.layer=null;this.id='';this.busy=false;
 }
 // Motion belongs to the displayed artwork. Automatic image changes have their
 // own timer; pausing that timer must not silently disable manual-browsing motion.
 setMotionActive(active){this.motionActive=active;this.updateMotion();}
 applyLook(){
  const {look,matte,brightness,contrast}=this.scene;
  this.canvas.classList.toggle('no-matte',look.matte==='none');
  this.canvas.style.setProperty('--matte',matte);this.canvas.style.setProperty('--brightness',brightness);this.canvas.style.setProperty('--contrast',contrast);
  this.canvas.querySelector('.picture-frame').dataset.frame=look.frame;
  this.canvas.querySelector('.mat-surface').dataset.matStyle=look.matStyle;
 }
 setScene(canvas,scene){
  if(this.canvas!==canvas){this.clear();this.canvas=canvas;}
  this.scene=scene;
  if(this.id===scene.id){this.applyLook();if(this.layer)this.layer.querySelector('img').style.objectFit=scene.look.fit;this.updateMotion();return;}
  this.finish(false);this.cancelLoad?.();const generation=++this.generation;this.id=scene.id;this.busy=true;
  const image=document.createElement('img');image.alt=scene.title;image.decoding='async';image.style.objectFit=scene.look.fit;
  const loaded=new Promise(resolve=>{
   const done=value=>{clearTimeout(timer);image.onload=image.onerror=null;this.cancelLoad=null;resolve(value);};
   const timer=setTimeout(()=>done(false),12000);image.onload=()=>done(image.naturalWidth>0);image.onerror=()=>done(false);
   this.cancelLoad=()=>{done(false);image.src='';};image.src=scene.url;
  });
  void loaded.then(async okay=>{
   if(generation!==this.generation||!canvas.isConnected)return;
   if(okay&&image.decode)try{await image.decode();}catch{okay=false;}
   if(generation!==this.generation||!canvas.isConnected)return;
   if(!okay){this.busy=false;this.onError('This artwork could not be displayed. Try the next image.');this.onSettled();return;}
   this.applyLook();image.style.objectFit=this.scene.look.fit;const window=canvas.querySelector('.art-window'),old=this.layer;
   // Freeze the outgoing artwork's current pan/zoom before cancelling its player.
   if(old&&this.motionAnimation)this.stopMotion(true);
   const layer=document.createElement('div');layer.className='art-layer';
   const motion=document.createElement('div');motion.className='art-motion';motion.append(image);layer.append(motion);this.layer=layer;window.append(layer);
   const effect=this.media?.matches?'none':scene.transition,duration=scene.transitionDuration*1000;
   const animations=[];const animate=(node,frames)=>animations.push(node.animate(frames,{duration,easing:effect==='slide'?'ease-in-out':'linear',fill:'both'}));
   if(old&&effect!=='none'&&typeof layer.animate==='function'){
    window.dataset.transition=effect;
    if(effect==='crossfade')animate(layer,[{opacity:0},{opacity:1}]);
    if(effect==='dark'){
     animate(old,[{opacity:1,offset:0},{opacity:0,offset:.5},{opacity:0,offset:1}]);
     animate(layer,[{opacity:0,offset:0},{opacity:0,offset:.5},{opacity:1,offset:1}]);
    }
    if(effect==='slide'){
     const direction=scene.direction<0?-1:1;
     animate(old,[{transform:'translateX(0)'},{transform:`translateX(${-direction*100}%)`}]);
     animate(layer,[{transform:`translateX(${direction*100}%)`},{transform:'translateX(0)'}]);
    }
   }
   this.animations=animations;this.updateMotion();
   if(animations.length)Promise.all(animations.map(animation=>animation.finished)).then(()=>{if(generation===this.generation)this.finish();}).catch(()=>{});
   else this.finish();
  });
 }
 finish(notify=true){
  this.animations?.forEach(animation=>animation.cancel());this.animations=[];
  const window=this.canvas?.querySelector('.art-window');
  // Do not detach/reinsert the active layer: TV compositors can lose its moving
  // surface even while the Web Animation continues reporting "running".
  if(window&&this.layer){for(const child of [...window.children])if(child!==this.layer)child.remove();delete window.dataset.transition;}
  const wasBusy=this.busy;this.busy=false;if(notify&&wasBusy)this.onSettled();
 }
 motionTarget(){return this.layer?.querySelector('.art-motion')||this.layer?.querySelector('img');}
 stopMotion(freeze=false){
  if(!this.motionAnimation)return;
  const target=this.motionAnimation.effect.target;
  if(freeze)target.style.transform=getComputedStyle(target).transform;
  else target.style.transform='';
  this.motionAnimation.cancel();target.style.willChange='';this.motionAnimation=null;
 }
 updateMotion(){
  if(!this.layer)return;
  if(this.scene.motion!=='gentle'||this.media?.matches){this.stopMotion();return;}
  const target=this.motionTarget();
  if(!this.motionAnimation&&this.motionActive&&typeof target?.animate==='function'){
   target.style.willChange='transform';
   this.motionAnimation=target.animate([
    {transform:'translate3d(-1.2%, 0.7%, 0) scale(1.03)'},
    {transform:'translate3d(1.2%, -0.7%, 0) scale(1.20)'}
   ],{duration:ARTWORK_MOTION_DURATION,easing:'linear',iterations:Infinity,direction:'alternate',fill:'both'});
  }
  if(this.motionAnimation){
   if(this.motionActive&&this.motionAnimation.playState!=='running')this.motionAnimation.play();
   else if(!this.motionActive&&this.motionAnimation.playState!=='paused')this.motionAnimation.pause();
  }
 }
}

// Keep the shared package usable on the Chromium 85 baseline (Tizen 6.5).
// Prefer small local helpers to changing built-in prototypes or guessing by TV year.
export const hasOwn=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);

// The caller disposes the timer after reading the response body, not just headers.
export function requestTimeout(milliseconds,scope=globalThis){
  const controller=new scope.AbortController();
  const timer=scope.setTimeout(()=>controller.abort(),milliseconds);
  return {signal:controller.signal,cancel:()=>scope.clearTimeout(timer)};
}

export function directUploadSupport(scope=globalThis){
  const features={
    webRTC:typeof scope.RTCPeerConnection==='function'&&typeof scope.RTCPeerConnection.prototype?.createDataChannel==='function',
    worker:typeof scope.Worker==='function',
    webAssembly:typeof scope.WebAssembly?.instantiate==='function',
    secureCrypto:typeof scope.crypto?.getRandomValues==='function'&&typeof scope.crypto?.subtle?.unwrapKey==='function'&&typeof scope.crypto?.subtle?.digest==='function',
  };
  return {supported:Object.values(features).every(Boolean),features};
}

// Older engines ignore `inert`. Keep hidden playback buttons out of native Tab
// navigation as well as the remote focus list, and restore their original order.
export function setControlsAvailable(container,available){
  if(!container)return;
  if(available)container.removeAttribute('inert');else container.setAttribute('inert','');
  container.setAttribute('aria-hidden',String(!available));
  for(const control of container.querySelectorAll('[data-focus]')){
    if(!available){
      if(!hasOwn(control.dataset,'sartTabindex'))control.dataset.sartTabindex=control.getAttribute('tabindex')??'';
      control.setAttribute('tabindex','-1');
    }else if(hasOwn(control.dataset,'sartTabindex')){
      const previous=control.dataset.sartTabindex;
      if(previous==='')control.removeAttribute('tabindex');else control.setAttribute('tabindex',previous);
      delete control.dataset.sartTabindex;
    }
  }
}
// Samsung IME Done/Cancel must release the input before moving app focus.
// Leave the IME's default key handling intact so it can dismiss itself.
export function handleImeExit(event,input,onDone,onCancel){
  if(!input||event.target!==input||![65376,65385].includes(event.keyCode))return false;
  input.blur();
  if(event.keyCode===65376)onDone();else onCancel();
  return true;
}

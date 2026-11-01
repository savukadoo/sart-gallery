// Install before application scripts. Chromium 85 needs unsafe-eval for WASM;
// newer engines use the narrower WASM-only permission and still reject eval.
(function(){
 'use strict';
 var chrome=/Chrome\/(\d+)/.exec(navigator.userAgent)||/\) (\d+)\.[\d.]+\/[\d.]+ TV Safari/.exec(navigator.userAgent);
 var legacy=chrome&&Number(chrome[1])<103;
 var wasm=legacy?"'unsafe-eval'":"'wasm-unsafe-eval'";
 var plugins=legacy?"object-src 'self'; plugin-types application/x-ppapi-appcommon application/x-ppapi-network; ":"object-src 'none'; ";
 var meta=document.createElement('meta');
 meta.httpEquiv='Content-Security-Policy';
 meta.content="default-src 'none'; script-src 'self' "+wasm+"; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data: https://images.metmuseum.org https://upload.wikimedia.org https://thumb.wikimedia.org https://mdl.artvee.com; connect-src 'self' https: http://127.0.0.1:8001 wss://127.0.0.1:8002; worker-src 'self'; child-src 'self'; "+plugins+"frame-src 'none'; base-uri 'none'; form-action 'none'";
 document.head.appendChild(meta);
})();

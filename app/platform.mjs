const status = { tv: typeof window.tizen !== 'undefined', screensaver: 'not requested', mediaKeys: false };
let apiReady;

export function ready() {
  if (!apiReady) apiReady = new Promise(resolve => {
    // Some older TVs predefine a partial webapis namespace. The network and
    // screensaver APIs arrive only after the standard Web API library loads.
    if (!status.tv || (typeof window.webapis?.network?.getIp === 'function' &&
        typeof window.webapis?.appcommon?.setScreenSaver === 'function')) { resolve(); return; }
    const script = document.createElement('script');
    script.src = '$WEBAPIS/webapis/webapis.js';
    script.onload = resolve;
    script.onerror = () => { apiReady = null; resolve(); };
    document.head.appendChild(script);
  });
  return apiReady;
}

export async function artActive(active) {
  await ready();
  const api = window.webapis?.appcommon;
  if (!api) { status.screensaver = status.tv ? 'unavailable' : 'browser preview'; return; }
  try {
    const value = active ? api.AppCommonScreenSaverState.SCREEN_SAVER_OFF : api.AppCommonScreenSaverState.SCREEN_SAVER_ON;
    api.setScreenSaver(value, () => { status.screensaver = active ? 'suppressed during artwork' : 'enabled'; },
      () => { status.screensaver = 'request declined'; });
  } catch { status.screensaver = 'request declined'; }
}

export function registerRemote() {
  try {
    for (const key of ['MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop', 'MediaTrackNext', 'MediaTrackPrevious']) {
      window.tizen.tvinputdevice.registerKey(key);
    }
    status.mediaKeys = true;
  } catch { /* Arrow, Enter and Back work without registration. */ }
}
export function exitApp() {
  try { window.tizen.application.getCurrentApplication().exit(); }
  catch { return false; }
  return true;
}
export const platformStatus = () => ({ ...status, width: window.innerWidth, height: window.innerHeight, pixelRatio: window.devicePixelRatio });

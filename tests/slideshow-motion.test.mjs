import test from 'node:test';
import assert from 'node:assert/strict';
import {ArtworkPresenter} from '../app/slideshow.mjs';
function fixture(interval=60){
 const calls=[],target={style:{},animate(frames,timing){const animation={playState:'running',currentTime:12000,effect:{target},play(){this.playState='running';},pause(){this.playState='paused';},cancel(){this.playState='idle';this.cancelled=true;}};calls.push({frames,timing,animation});return animation;}};
 const presenter=new ArtworkPresenter();presenter.layer={querySelector:()=>target};presenter.scene={motion:'gentle',interval,transitionDuration:1};
 return {presenter,target,calls};
}
test('motion stays visible and repeats even when artwork remains for an hour',()=>{
 for(const interval of [30,60,300,900,3600]){
  const {presenter,calls}=fixture(interval);presenter.setMotionActive(true);
  assert.equal(calls.length,1);assert.ok(calls[0].timing.duration<=30000);assert.equal(calls[0].timing.iterations,Infinity);assert.equal(calls[0].timing.direction,'alternate');assert.equal(calls[0].timing.easing,'linear','Manual navigation must not restart a near-still ease-in');assert.ok(calls[0].timing.duration<=18000);
  presenter.scene.interval=3600;presenter.setMotionActive(true);assert.equal(calls.length,1,'Changing the artwork timer must not reset motion');
 }
});
test('hiding or opening settings pauses motion without resetting its position; Off cancels and clears its compositor hint',()=>{
 const {presenter,target,calls}=fixture();presenter.setMotionActive(true);const animation=calls[0].animation;
 presenter.setMotionActive(false);assert.equal(animation.playState,'paused');assert.equal(animation.currentTime,12000);
 presenter.setMotionActive(true);assert.equal(animation.playState,'running');assert.equal(animation.currentTime,12000);
 presenter.scene.motion='off';presenter.updateMotion();assert.equal(animation.cancelled,true);assert.equal(target.style.willChange,'');assert.equal(presenter.motionAnimation,null);
});
test('finishing an image transition never detaches its active motion layer',()=>{
 const {presenter}=fixture();let removed=0,settled=0;const active=presenter.layer;
 const window={children:[{remove(){removed++;}},active],dataset:{transition:'crossfade'},replaceChildren(){throw Error('Active artwork must remain attached');}};
 presenter.canvas={querySelector:()=>window};presenter.busy=true;presenter.onSettled=()=>settled++;
 presenter.finish();assert.equal(removed,1);assert.equal(settled,1);assert.equal(window.dataset.transition,undefined);
});

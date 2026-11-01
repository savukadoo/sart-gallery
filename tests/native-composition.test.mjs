import test from 'node:test';import assert from 'node:assert/strict';
import {nativeLookGeometry,nativeLookKey,nativeImagePlacement} from '../app/native-composition.mjs';
import {nativeExportMatch,nativeExportRemember} from '../app/native-art-library.mjs';
import {NativeArt} from '../app/native-art.mjs';
test('landscape composition preserves the TV layout proportions and the thicker paper edge',()=>{
 const look={frame:'walnut',matte:'antique',matStyle:'bevel',fit:'contain'},g=nativeLookGeometry(look),thick=nativeLookGeometry({...look,matStyle:'bevel-thick'});
 assert.equal(g.width,3840);assert.equal(g.height,2160);assert.equal(g.frame,2160*.028);assert.equal(g.opening.x,g.frame+3840*.045);assert.ok(thick.bevel>g.bevel);assert.ok(thick.image.width<g.image.width);
 const none=nativeLookGeometry({frame:'none',matte:'none',matStyle:'bevel-thick'});assert.equal(none.frame,0);assert.equal(none.bevel,0);assert.deepEqual(none.image,{x:0,y:0,width:3840,height:2160});
 for(const [w,h]of[[0,2160],[3841,2160],[3840,2161],[Infinity,2160]])assert.throws(()=>nativeLookGeometry(look,w,h));
});
test('fit preserves portrait aspect ratio while fill crops symmetrically',()=>{
 const box={x:10,y:20,width:800,height:400},fit=nativeImagePlacement(100,200,box,'contain'),fill=nativeImagePlacement(100,200,box,'cover');
 assert.deepEqual(fit,{x:310,y:20,width:200,height:400});assert.deepEqual(fill,{x:10,y:-580,width:800,height:1600});assert.throws(()=>nativeImagePlacement(0,200,box,'contain'));
});
test('look identities distinguish visible styles and ignore a bevel hidden by No mat',()=>{
 const look={frame:'gold',matte:'antique',matStyle:'bevel',fit:'cover'},key=nativeLookKey(look);
 for(const change of[{frame:'white'},{matte:'ink'},{matStyle:'bevel-thick'},{fit:'contain'}])assert.notEqual(nativeLookKey({...look,...change}),key);
 assert.equal(nativeLookKey({...look,matte:'none',matStyle:'bevel'}),nativeLookKey({...look,matte:'none',matStyle:'flat'}));
});
test('native export index preserves original and styled copies and rejects cross-style reuse',()=>{
 const a='a'.repeat(64),b='b'.repeat(64),c='c'.repeat(64),first={photo:{contentId:'MY_RAW',sha256:a},other:{contentId:'MY_OTHER',sha256:c}},key=nativeLookKey({frame:'gold',matte:'antique'});
 const styled=nativeExportRemember(first,'photo',{contentId:'MY_STYLED',sha256:b,appearanceKey:key,sourceSha256:a});
 assert.deepEqual(styled.photo,first.photo);assert.deepEqual(styled.other,first.other);assert.equal(Object.keys(first).length,2);
 assert.equal(nativeExportMatch(styled,'photo',a).contentId,'MY_RAW');assert.equal(nativeExportMatch(styled,'photo',b,key).contentId,'MY_STYLED');assert.equal(nativeExportMatch(styled,'photo',b),null);assert.equal(nativeExportMatch(styled,'photo',b,nativeLookKey({frame:'white'})),null);
 const remembered=nativeExportRemember(styled,'photo',{contentId:'MY_STYLED',sha256:b,appearanceKey:key});assert.equal(Object.keys(remembered).length,3);
 assert.throws(()=>nativeExportRemember(styled,'photo',{contentId:'STORE_1',sha256:b,appearanceKey:key}));
});
function matArt({refuse=false,pending=false,none=false,lag=0}={}){
 const art=new NativeArt({}),calls=[];let updated=none,selected='MY_OTHER',resolve,reads=0;
 art.client={async request(name,fields){calls.push({name,fields});if(name==='get_content_list'){if(pending)return new Promise(r=>resolve=r);const applied=updated&&reads++>=lag;return{content_list:[{content_id:'MY_STYLED',category_id:'MY-C0002',matte_id:applied?'none':'shadowbox_black',portrait_matte_id:'none'}]};}if(name==='change_matte'&&!refuse)updated=true;if(name==='get_current_artwork')return{content_id:selected,matte_id:updated?'none':'shadowbox_black',portrait_matte_id:'none'};if(name==='select_image')selected=fields.content_id;return{};},close(){this.closed=true;}};
 return{art,calls,complete:()=>resolve({content_list:[{content_id:'MY_STYLED',category_id:'MY-C0002',matte_id:'shadowbox_black',portrait_matte_id:'none'}]})};
}
test('styled handoff removes only its own Samsung mat, verifies it and selects before entering Art Mode',async()=>{
 const{art,calls}=matArt();await art.show('MY_STYLED',{noMat:true});assert.deepEqual(calls.find(c=>c.name==='change_matte').fields,{content_id:'MY_STYLED',matte_id:'none'});assert.deepEqual(calls.filter(c=>c.name==='select_image').map(c=>c.fields.content_id),['MY_STYLED']);assert.equal(calls.at(-1).name,'set_artmode_status');assert.equal(art.client,null);
 const already=matArt({none:true});await already.art.show('MY_STYLED',{noMat:true});assert.equal(already.calls.some(c=>c.name==='change_matte'),false);
});
test('an acknowledged mat change waits for delayed library persistence before selecting',async()=>{
 const{art,calls}=matArt({lag:2});await art.show('MY_STYLED',{noMat:true});assert.equal(calls.filter(c=>c.name==='get_content_list').length,4);assert.equal(calls.filter(c=>c.name==='change_matte').length,1);assert.equal(calls.at(-1).name,'set_artmode_status');
});
test('a rejected no-mat readback never selects or enters Art Mode',async()=>{
 const{art,calls}=matArt({refuse:true});await assert.rejects(art.show('MY_STYLED',{noMat:true}),/extra mat/);assert.equal(calls.some(c=>['select_image','set_artmode_status'].includes(c.name)),false);
});
test('cancelling styled handoff cannot change a mat or hijack a replacement connection',async()=>{
 const{art,calls,complete}=matArt({pending:true}),request=art.show('MY_STYLED',{noMat:true}),cancelled=assert.rejects(request,/cancelled/);await new Promise(r=>setTimeout(r,0));art.cancel();const fresh={close(){this.closed=true;}};art.client=fresh;complete();await cancelled;assert.equal(calls.length,1);assert.equal(fresh.closed,undefined);assert.equal(art.client,fresh);
});

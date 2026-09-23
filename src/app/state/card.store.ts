import {inject} from '@angular/core';
import {patchState,signalStore,withHooks,withMethods,withState} from '@ngrx/signals';
import {CameraService, FacingMode} from '../core/camera.service';
import {CardExportService} from '../core/card-export.service';
import {CardRendererService} from '../core/card-renderer.service';
import {RatedPlayer,randomPlayer} from '../data/fc27-players.data';
import {InactivityService} from '../core/inactivity.service';
import {PhotoFilterService} from '../core/photo-filter.service';
import {GoogleDriveService} from '../core/google-drive.service';
import {GOOGLE_DRIVE_CONFIG} from '../../environments/google-drive.config';
export type CardStage='intro'|'camera'|'countdown'|'recording'|'result';
export type Experience='home'|'card'|'filter';
export type FilterStage='source'|'camera'|'editor';
export type CardDesign='blue-gold'|'red-black'|'white-red'|'mono-red';
interface CardState{experience:Experience;stage:CardStage;filterStage:FilterStage;facingMode:FacingMode;filterImageUrl:string;filterProcessed:boolean;cardMediaType:'image'|'video';countdown:number;error:string;isSharing:boolean;driveAvailable:boolean;driveUploading:boolean;driveMessage:string;cardLoading:boolean;playerName:string;playerPosition:string;playerNumber:number;cardDesign:CardDesign;replayUrl:string;mediaStream:MediaStream|null;matchedPlayer:RatedPlayer}
const initialState:CardState={experience:'home',stage:'intro',filterStage:'source',facingMode:'environment',filterImageUrl:'',filterProcessed:false,cardMediaType:'video',countdown:3,error:'',isSharing:false,driveAvailable:!GOOGLE_DRIVE_CONFIG.clientId.startsWith('PASTE_'),driveUploading:false,driveMessage:'',cardLoading:false,playerName:'',playerPosition:'ST',playerNumber:10,cardDesign:'blue-gold',replayUrl:'',mediaStream:null,matchedPlayer:randomPlayer('ST')};
export const CardStore=signalStore(
 {providedIn:'root'},withState(initialState),
 withMethods((store,camera=inject(CameraService),renderer=inject(CardRendererService),exporter=inject(CardExportService),filter=inject(PhotoFilterService),drive=inject(GoogleDriveService))=>{
  let clipUrl='',filterUrl='',flowVersion=0;
  const delay=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
  const openCurrentCamera=async()=>{
   try{
    const mediaStream=await camera.open(store.facingMode());
    patchState(store,{mediaStream,error:''});
   }catch{
    patchState(store,{error:'Camera access is needed. Allow it in your browser settings.'});
   }
  };
  return{
   chooseCard(){patchState(store,{experience:'card',stage:'intro',error:''})},
   chooseFilter(){patchState(store,{experience:'filter',filterStage:'source',error:''})},
   setName(playerName:string){patchState(store,{playerName})},
   setPosition(playerPosition:string){patchState(store,{playerPosition,matchedPlayer:randomPlayer(playerPosition,store.matchedPlayer().name)})},
   setNumber(value:number|string){const number=Math.max(0,Math.min(99,Number(value)||0));patchState(store,{playerNumber:number})},
   setCardDesign(cardDesign:CardDesign){patchState(store,{cardDesign})},
   setFacingMode(facingMode:FacingMode){
    if(store.facingMode()===facingMode)return;
    patchState(store,{facingMode});
    if((store.experience()==='card'&&store.stage()==='camera')||(store.experience()==='filter'&&store.filterStage()==='camera')){
     void openCurrentCamera();
    }
   },
   toggleFacingMode(){
    const nextMode:FacingMode=store.facingMode()==='environment'?'user':'environment';
    patchState(store,{facingMode:nextMode});
    if((store.experience()==='card'&&store.stage()==='camera')||(store.experience()==='filter'&&store.filterStage()==='camera')){
     void openCurrentCamera();
    }
   },
   async openCamera(){patchState(store,{error:''});try{const mediaStream=await camera.open(store.facingMode());patchState(store,{stage:'camera',mediaStream});window.scrollTo(0,0);}catch{patchState(store,{error:'Camera access is needed. Allow it in your browser settings.'})}},
   attachCamera(video:HTMLVideoElement){camera.attach(video)},
   async captureCardPhoto(video:HTMLVideoElement){const current=++flowVersion;patchState(store,{error:'',cardLoading:true});try{const blob=await camera.capture(video,store.facingMode());if(current!==flowVersion)return;camera.stop();if(clipUrl)URL.revokeObjectURL(clipUrl);clipUrl=URL.createObjectURL(blob);patchState(store,{replayUrl:clipUrl,cardMediaType:'image',stage:'result',mediaStream:null})}catch{if(current===flowVersion)patchState(store,{error:'Photo capture failed. Please try again.',stage:'camera'})}finally{if(current===flowVersion)patchState(store,{cardLoading:false})}},
   async startSequence(){const current=++flowVersion;patchState(store,{stage:'countdown'});for(let n=3;n>0;n--){if(current!==flowVersion)return;patchState(store,{countdown:n});await delay(1000)}if(current!==flowVersion)return;patchState(store,{stage:'recording'});try{const blob=await camera.record(2000);if(current!==flowVersion)return;camera.stop();if(clipUrl)URL.revokeObjectURL(clipUrl);clipUrl=URL.createObjectURL(blob);patchState(store,{replayUrl:clipUrl,cardMediaType:'video',stage:'result',mediaStream:null})}catch{if(current===flowVersion)patchState(store,{error:'Recording failed. Please try again.',stage:'camera'})}},
   async renderCard(video:HTMLVideoElement,canvas:HTMLCanvasElement){patchState(store,{cardLoading:true,error:''});try{await renderer.start(video,canvas,()=>({name:store.playerName(),position:store.playerPosition(),number:store.playerNumber(),design:store.cardDesign(),match:store.matchedPlayer(),facingMode:store.facingMode()}))}catch(error){console.error(error);patchState(store,{error:'Background removal could not start. Check your connection and reload.'})}finally{patchState(store,{cardLoading:false})}},
   async renderCardPhoto(image:HTMLImageElement,canvas:HTMLCanvasElement){patchState(store,{cardLoading:true,error:''});try{await renderer.renderImage(image,canvas,()=>({name:store.playerName(),position:store.playerPosition(),number:store.playerNumber(),design:store.cardDesign(),match:store.matchedPlayer(),facingMode:store.facingMode()}))}catch(error){console.error(error);patchState(store,{error:'Background removal could not start. Check your connection and reload.'})}finally{patchState(store,{cardLoading:false})}},
   async share(canvas:HTMLCanvasElement){patchState(store,{isSharing:true});try{await exporter.share(canvas,store.playerName())}catch(error){if((error as DOMException).name!=='AbortError')patchState(store,{error:'Sharing failed. Please download the card instead.'})}finally{patchState(store,{isSharing:false})}},
   async download(canvas:HTMLCanvasElement){await exporter.download(canvas,store.playerName())},
   async startLivePreview(video:HTMLVideoElement,canvas:HTMLCanvasElement){try{await renderer.startLivePreview(video,canvas,()=>({name:store.playerName(),position:store.playerPosition(),number:store.playerNumber(),design:store.cardDesign(),match:store.matchedPlayer(),facingMode:store.facingMode()}))}catch(e){console.error(e)}},
   async shareCardVideo(canvas:HTMLCanvasElement){patchState(store,{isSharing:true,error:''});try{await exporter.shareVideo(canvas,`${store.playerName()||'star'}-card`,'My KORA Player Card')}catch(error){if((error as DOMException).name!=='AbortError')patchState(store,{error:'Video export is not supported by this browser. Try downloading the image instead.'})}finally{patchState(store,{isSharing:false})}},
   async downloadCardVideo(canvas:HTMLCanvasElement){patchState(store,{isSharing:true,error:''});try{await exporter.downloadVideo(canvas,`${store.playerName()||'star'}-card`)}catch{patchState(store,{error:'Video export is not supported by this browser.'})}finally{patchState(store,{isSharing:false})}},
   async saveCardVideoToDrive(canvas:HTMLCanvasElement){await saveVideoToDrive(canvas,`${store.playerName()||'star'}-card`)},
   async openFilterCamera(){patchState(store,{error:'',cardLoading:true});try{const mediaStream=await camera.open(store.facingMode());patchState(store,{filterStage:'camera',mediaStream})}catch{patchState(store,{error:'Camera access is needed. Allow it in your browser settings.',cardLoading:false})}},
   async startLiveFilter(video:HTMLVideoElement,canvas:HTMLCanvasElement){try{await filter.startLive(video,canvas,store.facingMode()==='user')}catch(error){console.error(error);patchState(store,{error:'The live KORA effect could not start. Check your connection and try again.'})}finally{patchState(store,{cardLoading:false})}},
   async captureFilterPhoto(){try{const blob=await filter.captureBase();filter.stop();camera.stop();if(filterUrl)URL.revokeObjectURL(filterUrl);filterUrl=URL.createObjectURL(blob);patchState(store,{filterImageUrl:filterUrl,filterProcessed:true,filterStage:'editor',mediaStream:null})}catch{patchState(store,{error:'The filtered photo is not ready yet. Please try again.'})}},
   selectFilterFile(event:Event){const input=event.target as HTMLInputElement,file=input.files?.[0];if(!file)return;if(!file.type.startsWith('image/')){patchState(store,{error:'Please choose an image file.'});return}camera.stop();if(filterUrl)URL.revokeObjectURL(filterUrl);filterUrl=URL.createObjectURL(file);patchState(store,{filterImageUrl:filterUrl,filterProcessed:false,filterStage:'editor',mediaStream:null,error:''});input.value=''},
   async renderFilter(image:HTMLImageElement,canvas:HTMLCanvasElement){if(store.filterProcessed()){await filter.renderProcessed(image,canvas);return}patchState(store,{cardLoading:true,error:''});try{await filter.render(image,image.naturalWidth,image.naturalHeight,canvas)}catch(error){console.error(error);patchState(store,{error:'The KORA effect could not load. Check your connection and try again.'})}finally{patchState(store,{cardLoading:false})}},
   async shareFilter(canvas:HTMLCanvasElement){patchState(store,{isSharing:true});try{await exporter.share(canvas,'framed-photo','My KORA Photo','Created with KORA ⚽')}catch(error){if((error as DOMException).name!=='AbortError')patchState(store,{error:'Sharing failed. Please download the image instead.'})}finally{patchState(store,{isSharing:false})}},
   async downloadFilter(canvas:HTMLCanvasElement){await exporter.download(canvas,'framed-photo')},
   async shareFilterVideo(canvas:HTMLCanvasElement){patchState(store,{isSharing:true,error:''});try{await exporter.shareVideo(canvas,'filtered-video','My KORA Filter')}catch(error){if((error as DOMException).name!=='AbortError')patchState(store,{error:'Video export is not supported by this browser. Try downloading the image instead.'})}finally{patchState(store,{isSharing:false})}},
   async downloadFilterVideo(canvas:HTMLCanvasElement){patchState(store,{isSharing:true,error:''});try{await exporter.downloadVideo(canvas,'filtered-video')}catch{patchState(store,{error:'Video export is not supported by this browser.'})}finally{patchState(store,{isSharing:false})}},
   async saveFilterVideoToDrive(canvas:HTMLCanvasElement){await saveVideoToDrive(canvas,'kora-filter')},
   resetFilter(){filter.stop();camera.stop();if(filterUrl){URL.revokeObjectURL(filterUrl);filterUrl=''}patchState(store,{filterStage:'source',filterImageUrl:'',filterProcessed:false,mediaStream:null,error:''})},
   async retake(){renderer.stop();if(clipUrl){URL.revokeObjectURL(clipUrl);clipUrl=''}patchState(store,{replayUrl:''});try{const mediaStream=await camera.open(store.facingMode());patchState(store,{stage:'camera',mediaStream})}catch{patchState(store,{error:'Camera access is needed.',stage:'intro'})}},
   resetToHome(){flowVersion++;renderer.stop();filter.stop();camera.stop();if(clipUrl){URL.revokeObjectURL(clipUrl);clipUrl=''}if(filterUrl){URL.revokeObjectURL(filterUrl);filterUrl=''}patchState(store,{...initialState,matchedPlayer:randomPlayer('ST')})},
   destroy(){renderer.destroy();filter.destroy();camera.stop();drive.disconnect();if(clipUrl)URL.revokeObjectURL(clipUrl);if(filterUrl)URL.revokeObjectURL(filterUrl)}
  };
  async function saveVideoToDrive(canvas:HTMLCanvasElement,name:string){
   patchState(store,{driveUploading:true,driveMessage:'Creating video…',error:''});
   try{
    const blob=await exporter.createVideoBlob(canvas),extension=blob.type.includes('mp4')?'mp4':'webm';
    patchState(store,{driveMessage:'Waiting for Google Drive…'});
    const file=new File([blob],`${name.toLowerCase().replace(/[^a-z0-9]+/g,'-')}-${Date.now()}.${extension}`,{type:blob.type});
    await drive.upload(file);patchState(store,{driveMessage:'Video saved to Google Drive.'});
   }catch(error){console.error(error);patchState(store,{error:error instanceof Error?error.message:'Google Drive upload failed.',driveMessage:''});}
   finally{patchState(store,{driveUploading:false});}
  }
 }),
 withHooks((store)=>{const inactivity=inject(InactivityService);return{onInit(){inactivity.start(30000,()=>{if(store.experience()!=='home')store.resetToHome()})},onDestroy(){inactivity.stop();store.destroy()}}})
);

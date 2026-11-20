import {inject} from '@angular/core';
import {patchState,signalStore,withHooks,withMethods,withState} from '@ngrx/signals';
import {CameraService, FacingMode} from '../core/camera.service';
import {CardExportService} from '../core/card-export.service';
import {CardRendererService} from '../core/card-renderer.service';
import {TemplateCardRendererService} from '../core/template-card-renderer.service';
import {RatedPlayer,randomPlayer} from '../data/fc27-players.data';
import {InactivityService} from '../core/inactivity.service';
import {PhotoFilterService} from '../core/photo-filter.service';
import {GoogleDriveService} from '../core/google-drive.service';
import {SupabaseCardStorageService} from '../core/supabase-card-storage.service';
import {SupabasePlayerRegistrationService} from '../core/supabase-player-registration.service';
import {qrDataUrl} from '../core/qr-code.util';
import {GOOGLE_DRIVE_CONFIG} from '../../environments/google-drive.config';
export type CardStage='intro'|'camera'|'countdown'|'recording'|'result';
export type Experience='home'|'card'|'filter';
export type FilterStage='source'|'camera'|'editor';
export type CardDesign='blue-gold'|'red-black'|'white-red'|'mono-red';
export type RenderEngine='legacy'|'template';
interface CardState{experience:Experience;stage:CardStage;filterStage:FilterStage;facingMode:FacingMode;filterImageUrl:string;filterProcessed:boolean;cardMediaType:'image'|'video';countdown:number;error:string;isSharing:boolean;driveAvailable:boolean;driveUploading:boolean;driveMessage:string;cloudBusy:boolean;cloudMessage:string;cloudConsent:boolean;dataConsent:boolean;registrationBusy:boolean;registrationSaved:boolean;cardLinkToken:string;cloudQrUrl:string;cloudQrImage:string;qrPopupOpen:boolean;cardLoading:boolean;playerName:string;playerEmail:string;instagramHandle:string;phoneNumber:string;whatsappError:string;playerPosition:string;playerNumber:number;cardDesign:CardDesign;renderEngine:RenderEngine;replayUrl:string;mediaStream:MediaStream|null;matchedPlayer:RatedPlayer}
const initialState:CardState={experience:'card',stage:'intro',filterStage:'source',facingMode:'environment',filterImageUrl:'',filterProcessed:false,cardMediaType:'video',countdown:3,error:'',isSharing:false,driveAvailable:!GOOGLE_DRIVE_CONFIG.clientId.startsWith('PASTE_'),driveUploading:false,driveMessage:'',cloudBusy:false,cloudMessage:'',cloudConsent:false,dataConsent:false,registrationBusy:false,registrationSaved:false,cardLinkToken:'',cloudQrUrl:'',cloudQrImage:'',qrPopupOpen:false,cardLoading:false,playerName:'',playerEmail:'',instagramHandle:'',phoneNumber:'',whatsappError:'',playerPosition:'ST',playerNumber:10,cardDesign:'blue-gold',renderEngine:'template',replayUrl:'',mediaStream:null,matchedPlayer:randomPlayer('ST')};
export const CardStore=signalStore(
 {providedIn:'root'},withState(initialState),
 withMethods((store,camera=inject(CameraService),renderer=inject(CardRendererService),templateRenderer=inject(TemplateCardRendererService),exporter=inject(CardExportService),filter=inject(PhotoFilterService),drive=inject(GoogleDriveService),cloud=inject(SupabaseCardStorageService),registration=inject(SupabasePlayerRegistrationService))=>{
  let clipUrl='',filterUrl='',flowVersion=0;
  const delay=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
  const validatePlayerDetails=():string=>{
   if(!store.playerName().trim())return 'Please enter your name.';
   const email=store.playerEmail().trim();
   if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return 'Please enter a valid email address.';
   if(!/^@?[A-Za-z0-9._]{1,30}$/.test(store.instagramHandle().trim()))return 'Please enter your Instagram username.';
   const raw=store.phoneNumber().trim();
   const digits=raw.replace(/[\s().-]/g,'').replace(/^\+/,'');
   if(!/^\+?[0-9\s().-]+$/.test(raw)||!/^\d{8,15}$/.test(digits)||digits.startsWith('0'))
    return 'Please enter your telephone number with country code (e.g. +49 151 12345678).';
   if(!store.playerPosition())return 'Please select your position.';
   if(!Number.isInteger(store.playerNumber())||store.playerNumber()<0||store.playerNumber()>99)
    return 'Please enter a shirt number from 0 to 99.';
   return '';
  };

  const saveRegistration=async():Promise<boolean>=>{
    if(!store.dataConsent()||store.registrationSaved())return true;
    patchState(store,{registrationBusy:true,error:''});
    try{
      const cardLinkToken=await registration.save({
        name:store.playerName().trim(),
        email:store.playerEmail().trim(),
        instagram:store.instagramHandle().trim(),
        telephone:store.phoneNumber().trim(),
        position:store.playerPosition(),
        shirtNumber:store.playerNumber(),
        cardCloudConsent:store.cloudConsent(),
        eventScreenConsent:store.dataConsent()&&store.cloudConsent(),
      });
      patchState(store,{registrationSaved:true,cardLinkToken});
      return true;
    }catch(error){
      console.error('KORA registration failed',error);
      patchState(store,{error:error instanceof Error?error.message:'Could not save player details. Try again.'});
      return false;
    }finally{
      patchState(store,{registrationBusy:false});
    }
  };
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
   setName(playerName:string){patchState(store,{playerName,registrationSaved:false})},
   setEmail(playerEmail:string){patchState(store,{playerEmail,registrationSaved:false})},
   setInstagramHandle(instagramHandle:string){patchState(store,{instagramHandle,registrationSaved:false})},
   setPhoneNumber(phoneNumber:string){patchState(store,{phoneNumber,whatsappError:'',registrationSaved:false})},
   // One explicit choice controls BOTH private registration and cloud card upload.
   // Keeping the two internal flags synchronised preserves the existing
   // registration -> private photo linkage and QR workflow.
   setCombinedConsent(consent:boolean){
     patchState(store,{dataConsent:consent,cloudConsent:consent,registrationSaved:false,cardLinkToken:''});
   },
   toggleQrPopup(){if(store.cloudQrImage())patchState(store,{qrPopupOpen:!store.qrPopupOpen()})},
   closeQrPopup(){patchState(store,{qrPopupOpen:false})},
   openWhatsApp(){
    if(store.cardLoading()||store.error()||store.cardMediaType()!=='image')return;
    // WhatsApp click-to-chat requires the country code and digits only.
    const raw=store.phoneNumber().trim();
    const digits=raw.replace(/[\s().-]/g,'').replace(/^\+/,'');
    if(!/^\+?[0-9\s().-]+$/.test(raw)||!/^\d{8,15}$/.test(digits)||digits.startsWith('0')){
      patchState(store,{whatsappError:'Enter the full WhatsApp number with country code, e.g. +49 151 12345678.'});
      return;
    }
    patchState(store,{whatsappError:''});
    const player=store.playerName().trim()||'KORA STAR';
    const link=store.cloudQrUrl();
    const message=`⚽ Your KORA player card for ${player} is ready! 📸${link ? `\nDownload your card (link valid for 7 days): ${link}` : '\nSave and attach your card photo to this chat.'}`;
    // This opens a prefilled text conversation; wa.me cannot attach a canvas.
    window.location.assign(`https://wa.me/${digits}?text=${encodeURIComponent(message)}`);
   },
   setPosition(playerPosition:string){patchState(store,{playerPosition,registrationSaved:false,matchedPlayer:randomPlayer(playerPosition,store.matchedPlayer().name)})},
   setNumber(value:number|string){const number=Math.max(0,Math.min(99,Number(value)||0));patchState(store,{playerNumber:number,registrationSaved:false})},
   setCardDesign(cardDesign:CardDesign){patchState(store,{cardDesign})},
   setRenderEngine(renderEngine:RenderEngine){renderer.stop();templateRenderer.stop();patchState(store,{renderEngine})},
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
   async openCamera(){if(store.registrationBusy())return;const validationError=validatePlayerDetails();if(validationError){patchState(store,{error:validationError});return;}patchState(store,{dataConsent:true,cloudConsent:true,registrationSaved:false,cardLinkToken:''});if(!await saveRegistration())return;patchState(store,{error:''});try{const mediaStream=await camera.open(store.facingMode());patchState(store,{stage:'camera',mediaStream});window.scrollTo(0,0);}catch{patchState(store,{error:'Camera access is needed. Allow it in your browser settings.'})}},
   attachCamera(video:HTMLVideoElement){camera.attach(video)},
   async captureCardPhoto(video:HTMLVideoElement){
    const current=++flowVersion;patchState(store,{error:'',cardLoading:true});try{const blob=await camera.capture(video,store.facingMode());if(current!==flowVersion)return;camera.stop();if(clipUrl)URL.revokeObjectURL(clipUrl);clipUrl=URL.createObjectURL(blob);patchState(store,{replayUrl:clipUrl,cardMediaType:'image',stage:'result',mediaStream:null})}catch{if(current===flowVersion)patchState(store,{error:'Photo capture failed. Please try again.',stage:'camera'})}finally{if(current===flowVersion)patchState(store,{cardLoading:false})}},
   async selectCardPhoto(event:Event){const input=event.target as HTMLInputElement;const file=input.files?.[0];if(!file)return;input.value='';if(store.registrationBusy())return;const validationError=validatePlayerDetails();if(validationError){patchState(store,{error:validationError});return;}if(!file.type.startsWith('image/')){patchState(store,{error:'Please select a photo.'});return;}patchState(store,{dataConsent:true,cloudConsent:true,registrationSaved:false,cardLinkToken:''});if(!await saveRegistration())return;flowVersion++;renderer.stop();templateRenderer.stop();camera.stop();if(clipUrl)URL.revokeObjectURL(clipUrl);clipUrl=URL.createObjectURL(file);patchState(store,{cardMediaType:'image',replayUrl:clipUrl,stage:'result',mediaStream:null,error:''});},
   async startSequence(){if(store.renderEngine()==='template'){patchState(store,{error:'New KORA template supports photos only. Use the photo shutter.'});return;}const current=++flowVersion;patchState(store,{stage:'countdown'});for(let n=3;n>0;n--){if(current!==flowVersion)return;patchState(store,{countdown:n});await delay(1000)}if(current!==flowVersion)return;patchState(store,{stage:'recording'});try{const blob=await camera.record(2000);if(current!==flowVersion)return;camera.stop();if(clipUrl)URL.revokeObjectURL(clipUrl);clipUrl=URL.createObjectURL(blob);patchState(store,{replayUrl:clipUrl,cardMediaType:'video',stage:'result',mediaStream:null})}catch{if(current===flowVersion)patchState(store,{error:'Recording failed. Please try again.',stage:'camera'})}},
   async renderCard(video:HTMLVideoElement,canvas:HTMLCanvasElement){if(store.renderEngine()==='template'){patchState(store,{error:'Video is only available in Classic Cards.'});return;}patchState(store,{cardLoading:true,error:''});try{await (store.renderEngine()==='template'?templateRenderer:renderer).start(video,canvas,()=>({name:store.playerName(),instagramHandle:store.instagramHandle(),position:store.playerPosition(),number:store.playerNumber(),design:store.cardDesign(),match:store.matchedPlayer(),facingMode:store.facingMode()}))}catch(error){console.error(error);patchState(store,{error:'Card renderer could not start. Please reload.'})}finally{patchState(store,{cardLoading:false})}},
   async renderCardPhoto(image:HTMLImageElement,canvas:HTMLCanvasElement){
     const current=flowVersion;
     patchState(store,{cardLoading:true,error:'',cloudMessage:'',cloudQrUrl:'',cloudQrImage:'',qrPopupOpen:false});
     try{
       await (store.renderEngine()==='template'?templateRenderer:renderer).renderImage(image,canvas,()=>({
         name:store.playerName(),instagramHandle:store.instagramHandle(),position:store.playerPosition(),
         number:store.playerNumber(),design:store.cardDesign(),match:store.matchedPlayer(),facingMode:store.facingMode()
       }));
       if(current===flowVersion && store.renderEngine()==='template' && store.cloudConsent()){
         const file=await exporter.createImageBlob(canvas);
         if(current===flowVersion)patchState(store,{cloudBusy:true,cloudMessage:'Uploading your card…'});
         // Upload is deliberately separate from photo render completion.
         void cloud.uploadCard(file,store.dataConsent()?store.cardLinkToken():undefined).then(downloadUrl=>{
           const qrImage=qrDataUrl(downloadUrl);
           if(current===flowVersion)patchState(store,{
             cloudMessage:'Your card is ready. Tap QR in the toolbar to download.',
             cloudQrUrl:downloadUrl,cloudQrImage:qrImage
           });
         }).catch(error=>{
           console.error('KORA Supabase upload failed',error);
           if(current===flowVersion)patchState(store,{
             cloudMessage:error instanceof Error?error.message:'Cloud upload failed. Save your card locally.'
           });
         }).finally(()=>{
           if(current===flowVersion)patchState(store,{cloudBusy:false});
         });
       }
     }catch(error){
       console.error(error);
       patchState(store,{error:store.renderEngine()==='template'
         ?(error instanceof Error?error.message:'AI background removal failed. Try a brighter photo.')
         :'Card renderer could not start. Please reload.'});
     }finally{
       if(current===flowVersion)patchState(store,{cardLoading:false});
     }
   },
   async share(canvas:HTMLCanvasElement){patchState(store,{isSharing:true});try{await exporter.share(canvas,store.playerName())}catch(error){if((error as DOMException).name!=='AbortError')patchState(store,{error:'Sharing failed. Please download the card instead.'})}finally{patchState(store,{isSharing:false})}},
   async download(canvas:HTMLCanvasElement){await exporter.download(canvas,store.playerName())},
   printCard(canvas:HTMLCanvasElement){
    if(store.cardLoading()||store.error())return;
    try{exporter.printCard(canvas)}catch(error){
      patchState(store,{error:error instanceof Error?error.message:'Unable to open the print dialog. Save the card and print it from Photos.'});
    }
   },
   async startLivePreview(video:HTMLVideoElement,canvas:HTMLCanvasElement){
    try {
      await (store.renderEngine()==='template'?templateRenderer:renderer).startLivePreview(
        video,canvas,()=>({name:store.playerName(),instagramHandle:store.instagramHandle(),
          position:store.playerPosition(),number:store.playerNumber(),design:store.cardDesign(),
          match:store.matchedPlayer(),facingMode:store.facingMode()}));
    } catch(e) {console.error(e)}
   },
   async shareCardVideo(canvas:HTMLCanvasElement){patchState(store,{isSharing:true,error:''});try{const rawHandle=store.instagramHandle().trim(),handle=rawHandle?(rawHandle.startsWith('@')?rawHandle:`@${rawHandle}`):'',target=handle||store.playerName().trim()||'KORA STAR',shareText=`Created with KORA for ${target} ⚽`;await exporter.shareVideo(canvas,`${store.playerName()||'star'}-card`,'My KORA Player Card',shareText)}catch(error){if((error as DOMException).name!=='AbortError')patchState(store,{error:'Video export is not supported by this browser. Try downloading the image instead.'})}finally{patchState(store,{isSharing:false})}},
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
   async retake(){renderer.stop();templateRenderer.stop();if(clipUrl){URL.revokeObjectURL(clipUrl);clipUrl=''}patchState(store,{replayUrl:''});try{const mediaStream=await camera.open(store.facingMode());patchState(store,{stage:'camera',mediaStream})}catch{patchState(store,{error:'Camera access is needed.',stage:'intro'})}},
   resetToHome(){flowVersion++;renderer.stop();templateRenderer.stop();filter.stop();camera.stop();if(clipUrl){URL.revokeObjectURL(clipUrl);clipUrl=''}if(filterUrl){URL.revokeObjectURL(filterUrl);filterUrl=''}patchState(store,{...initialState,matchedPlayer:randomPlayer('ST')})},
   destroy(){renderer.destroy();templateRenderer.destroy();filter.destroy();camera.stop();drive.disconnect();if(clipUrl)URL.revokeObjectURL(clipUrl);if(filterUrl)URL.revokeObjectURL(filterUrl)}
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
 withHooks((store)=>{const inactivity=inject(InactivityService);return{onInit(){inactivity.start(120000,()=>{if(store.experience()!=='home')store.resetToHome()})},onDestroy(){inactivity.stop();store.destroy()}}})
);

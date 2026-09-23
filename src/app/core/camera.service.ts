import {Injectable} from '@angular/core';
@Injectable({providedIn:'root'})
export class CameraService{
 private stream?:MediaStream;
 async open(){this.stop();this.stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:1080},height:{ideal:1920}},audio:false});return this.stream;}
 attach(video:HTMLVideoElement){if(this.stream)video.srcObject=this.stream;}
 capture(video:HTMLVideoElement){
  if(!this.stream||video.readyState<2)throw new Error('Camera is not ready');
  const canvas=document.createElement('canvas'),portrait=video.videoHeight>=video.videoWidth;
  canvas.width=portrait?video.videoWidth:video.videoHeight;canvas.height=portrait?video.videoHeight:video.videoWidth;
  const ctx=canvas.getContext('2d')!;ctx.translate(canvas.width,0);ctx.scale(-1,1);ctx.drawImage(video,0,0,canvas.width,canvas.height);
  return new Promise<Blob>((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Photo capture failed')),'image/jpeg',.94));
 }
 captureCanvas(canvas:HTMLCanvasElement){return new Promise<Blob>((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Photo capture failed')),'image/png'));}
 async record(milliseconds=2000){if(!this.stream)throw new Error('Camera is not open');const types=['video/webm;codecs=vp9','video/webm','video/mp4'];const type=types.find(t=>MediaRecorder.isTypeSupported(t))||'';const recorder=new MediaRecorder(this.stream,type?{mimeType:type}:undefined),parts:BlobPart[]=[];recorder.ondataavailable=e=>{if(e.data.size)parts.push(e.data)};const stopped=new Promise<void>(resolve=>recorder.onstop=()=>resolve());recorder.start(100);await new Promise(resolve=>setTimeout(resolve,milliseconds));recorder.stop();await stopped;return new Blob(parts,{type:recorder.mimeType});}
 stop(){this.stream?.getTracks().forEach(track=>track.stop());this.stream=undefined;}
}

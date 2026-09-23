import { CommonModule } from '@angular/common';
import { Component, ElementRef, OnDestroy, ViewChild, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

type Stage = 'intro' | 'camera' | 'countdown' | 'recording' | 'result';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent implements OnDestroy {
  @ViewChild('camera') camera?: ElementRef<HTMLVideoElement>;
  @ViewChild('replay') replay?: ElementRef<HTMLVideoElement>;
  readonly stage = signal<Stage>('intro');
  readonly countdown = signal(10);
  readonly error = signal('');
  readonly isSharing = signal(false);
  playerName = '';
  playerNumber = 10;
  private stream?: MediaStream;
  private clip?: Blob;
  replayUrl = '';
  posterUrl = '';

  async openCamera(): Promise<void> {
    this.error.set('');
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:1080},height:{ideal:1920}},audio:false});
      this.stage.set('camera');
      setTimeout(()=>{if(this.camera)this.camera.nativeElement.srcObject=this.stream!;});
    } catch {
      this.error.set('Camera access is needed to record your celebration. You can allow it in your browser settings.');
    }
  }

  async startSequence(): Promise<void> {
    this.stage.set('countdown');
    for(let remaining=10;remaining>0;remaining--){this.countdown.set(remaining);await this.delay(1000);}
    await this.recordCelebration();
  }

  private async recordCelebration(): Promise<void> {
    if(!this.stream)return;
    this.stage.set('recording');
    const mimeTypes=['video/webm;codecs=vp9','video/webm','video/mp4'];
    const mimeType=mimeTypes.find(type=>MediaRecorder.isTypeSupported(type)) || '';
    const recorder=new MediaRecorder(this.stream,mimeType?{mimeType}:undefined);
    const parts: BlobPart[]=[];
    recorder.ondataavailable=event=>{if(event.data.size)parts.push(event.data);};
    const stopped=new Promise<void>(resolve=>recorder.onstop=()=>resolve());
    recorder.start(100);
    await this.delay(2000);
    recorder.stop();
    await stopped;
    this.clip=new Blob(parts,{type:recorder.mimeType});
    this.replayUrl=URL.createObjectURL(this.clip);
    this.stage.set('result');
    setTimeout(()=>this.makePoster());
  }

  private async makePoster(): Promise<void> {
    const video=this.replay?.nativeElement;
    if(!video)return;
    await new Promise<void>(resolve=>{if(video.readyState>=2)resolve();else video.onloadeddata=()=>resolve();});
    video.currentTime=Math.min(1,video.duration || 1);
    await new Promise<void>(resolve=>video.onseeked=()=>resolve());
    const canvas=document.createElement('canvas'); canvas.width=1080; canvas.height=1350;
    const ctx=canvas.getContext('2d'); if(!ctx)return;
    const sourceRatio=video.videoWidth/video.videoHeight, targetRatio=canvas.width/canvas.height;
    let sw=video.videoWidth,sh=video.videoHeight,sx=0,sy=0;
    if(sourceRatio>targetRatio){sw=video.videoHeight*targetRatio;sx=(video.videoWidth-sw)/2;}else{sh=video.videoWidth/targetRatio;sy=(video.videoHeight-sh)/2;}
    ctx.drawImage(video,sx,sy,sw,sh,0,0,canvas.width,canvas.height);
    const shade=ctx.createLinearGradient(0,650,0,1350);shade.addColorStop(0,'transparent');shade.addColorStop(1,'rgba(2,12,8,.94)');ctx.fillStyle=shade;ctx.fillRect(0,0,1080,1350);
    ctx.strokeStyle='#b9ff39';ctx.lineWidth=26;ctx.strokeRect(28,28,1024,1294);
    ctx.fillStyle='#b9ff39';ctx.font='900 54px Chakra Petch';ctx.fillText('KORA',74,110);
    ctx.textAlign='right';ctx.font='900 90px Chakra Petch';ctx.fillText(String(this.playerNumber).padStart(2,'0'),996,128);
    ctx.textAlign='left';ctx.fillStyle='white';ctx.font='900 82px Chakra Petch';ctx.fillText((this.playerName||'KORA STAR').toUpperCase(),74,1190,900);
    ctx.fillStyle='#b9ff39';ctx.font='700 34px Chakra Petch';ctx.fillText('GOAL CELEBRATION',78,1250);
    canvas.toBlob(blob=>{if(blob){if(this.posterUrl)URL.revokeObjectURL(this.posterUrl);this.posterUrl=URL.createObjectURL(blob);}},'image/jpeg',.94);
  }

  async share(): Promise<void> {
    if(!this.posterUrl)return;
    this.isSharing.set(true);
    try {
      const blob=await fetch(this.posterUrl).then(r=>r.blob());
      const file=new File([blob],`kora-${(this.playerName||'star').toLowerCase().replace(/\s+/g,'-')}.jpg`,{type:'image/jpeg'});
      if(navigator.canShare?.({files:[file]}))await navigator.share({files:[file],title:'My Kora Card',text:'My goal celebration! ⚽'});
      else this.download();
    } catch (e) { if((e as DOMException).name!=='AbortError')this.download(); }
    finally {this.isSharing.set(false);}
  }

  download(): void { if(!this.posterUrl)return;const a=document.createElement('a');a.href=this.posterUrl;a.download=`kora-${this.playerName||'star'}.jpg`;a.click(); }
  async retake(): Promise<void> { if(this.replayUrl)URL.revokeObjectURL(this.replayUrl);this.replayUrl='';this.clip=undefined;await this.openCamera(); }
  private delay(ms:number):Promise<void>{return new Promise(resolve=>setTimeout(resolve,ms));}
  ngOnDestroy():void{this.stream?.getTracks().forEach(track=>track.stop());if(this.replayUrl)URL.revokeObjectURL(this.replayUrl);if(this.posterUrl)URL.revokeObjectURL(this.posterUrl);}
}

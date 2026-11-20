import {Directive,ElementRef,EventEmitter,HostListener,Input,OnChanges,OnDestroy,Output} from '@angular/core';

/** Decode only visible MP4s and fall back to a still when TV playback fails. */
@Directive({selector:'video[wallVisible]',standalone:true})
export class WallVisibleVideoDirective implements OnChanges,OnDestroy {
  @Input() wallVisible=false;
  @Output() wallPlaybackFailed=new EventEmitter<void>();
  private failureTimer?:ReturnType<typeof setTimeout>;
  private playing=false;
  constructor(private readonly element:ElementRef<HTMLVideoElement>){}
  private get video():HTMLVideoElement{return this.element.nativeElement}
  ngOnChanges():void{this.syncPlayback()}
  @HostListener('playing')
  onPlaying():void{this.playing=true;this.clearFailureTimer()}
  @HostListener('error')
  onError():void{if(this.wallVisible)this.fail()}
  @HostListener('stalled')
  onStalled():void{
    if(this.wallVisible && !this.playing)this.scheduleFailure();
  }
  @HostListener('waiting')
  onWaiting():void{
    if(this.wallVisible)this.scheduleFailure();
  }
  @HostListener('loadeddata')
  onLoadedData():void{if(this.wallVisible)this.syncPlayback()}
  private syncPlayback():void{
    this.clearFailureTimer();
    if(!this.wallVisible){this.video.pause();this.playing=false;return;}
    this.playing=false;
    this.scheduleFailure();
    if(this.video.readyState>=2){
      try{this.video.currentTime=0}catch{}
    }
    void this.video.play().catch(()=>{if(this.wallVisible)this.fail()});
  }
  private scheduleFailure():void{
    this.clearFailureTimer();
    this.failureTimer=setTimeout(()=>{
      if(this.wallVisible && (!this.playing || this.video.readyState<2))this.fail();
    },5000);
  }
  private clearFailureTimer():void{
    if(this.failureTimer)clearTimeout(this.failureTimer);
    this.failureTimer=undefined;
  }
  private fail():void{
    this.clearFailureTimer();
    this.video.pause();
    this.wallPlaybackFailed.emit();
  }
  ngOnDestroy():void{this.clearFailureTimer();this.video.pause()}
}

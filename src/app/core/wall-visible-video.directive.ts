import {Directive,ElementRef,HostListener,Input,OnChanges,OnDestroy} from '@angular/core';

/** Pause hidden faces: TVs should only decode the MP4 actually on screen. */
@Directive({selector:'video[wallVisible]',standalone:true})
export class WallVisibleVideoDirective implements OnChanges,OnDestroy {
  @Input() wallVisible=false;
  constructor(private readonly element:ElementRef<HTMLVideoElement>){}
  private get video():HTMLVideoElement{return this.element.nativeElement}
  ngOnChanges():void{this.syncPlayback()}
  @HostListener('loadeddata')
  onLoadedData():void{this.syncPlayback()}
  private syncPlayback():void{
    if(!this.wallVisible){this.video.pause();return;}
    // Start each clip from its beginning when it becomes visible.
    if(this.video.readyState>=2){
      try{this.video.currentTime=0}catch{}
    }
    void this.video.play().catch(()=>{
      // Browser might block autoplay; keep the rest of the wall functional.
    });
  }
  ngOnDestroy():void{this.video.pause()}
}

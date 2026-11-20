import {Directive,ElementRef,Input,OnChanges,OnDestroy} from '@angular/core';

/** Only decode/play the currently visible face of a flipping TV tile. */
@Directive({selector:'video[wallVisible]',standalone:true})
export class WallVisibleVideoDirective implements OnChanges,OnDestroy {
  @Input() wallVisible=false;
  private readonly video=injectVideo(this.element);
  constructor(private readonly element:ElementRef<HTMLVideoElement>){}
  ngOnChanges():void{
    if(!this.wallVisible){this.video.pause();return;}
    // A clip starts from its beginning when the tile comes into view.
    try{this.video.currentTime=0;}catch{}
    void this.video.play().catch(()=>{
      // Muted inline playback may still be blocked by a kiosk browser policy.
      // Do not take down the wall; operator must enable video autoplay.
    });
  }
  ngOnDestroy():void{this.video.pause()}
}
function injectVideo(element:ElementRef<HTMLVideoElement>):HTMLVideoElement{
  return element.nativeElement;
}

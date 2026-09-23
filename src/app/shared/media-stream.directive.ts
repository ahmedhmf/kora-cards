import {Directive,ElementRef,Input} from '@angular/core';
@Directive({selector:'video[appMediaStream]',standalone:true})
export class MediaStreamDirective{
 constructor(private readonly element:ElementRef<HTMLVideoElement>){}
 @Input() set appMediaStream(stream:MediaStream|null){this.element.nativeElement.srcObject=stream;}
}

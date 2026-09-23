import {Injectable,NgZone} from '@angular/core';
@Injectable({providedIn:'root'})
export class InactivityService{
 private timer?:ReturnType<typeof setTimeout>;private cleanup:()=>void=()=>{};
 constructor(private readonly zone:NgZone){}
 start(timeoutMs:number,onInactive:()=>void){this.stop();const events=['pointerdown','touchstart','keydown','scroll'] as const;const reset=()=>{if(this.timer)clearTimeout(this.timer);this.timer=setTimeout(()=>this.zone.run(onInactive),timeoutMs)};this.zone.runOutsideAngular(()=>{events.forEach(event=>window.addEventListener(event,reset,{passive:true}));this.cleanup=()=>events.forEach(event=>window.removeEventListener(event,reset));reset();});}
 stop(){if(this.timer)clearTimeout(this.timer);this.timer=undefined;this.cleanup();this.cleanup=()=>{};}
}

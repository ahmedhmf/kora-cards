import {CommonModule} from '@angular/common';
import {ChangeDetectionStrategy,Component,OnDestroy,OnInit,signal} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {SUPABASE_STORAGE_CONFIG} from '../environments/supabase-storage.config';
import {qrDataUrl} from './core/qr-code.util';

interface WallCard { path:string; url:string; qrUrl:string; uploadedAt:string; }
interface WallTile { front:WallCard|null; back:WallCard|null; flipped:boolean; }
interface WallPage { cards:WallCard[]; nextOffset:number|null; error?:string; }

@Component({
  selector:'app-root',
  standalone:true,
  imports:[CommonModule,FormsModule],
  templateUrl:'./tv-wall.component.html',
  styleUrl:'./tv-wall.component.css',
  changeDetection:ChangeDetectionStrategy.OnPush,
})
export class TvWallComponent implements OnInit,OnDestroy {
  private readonly slots=18;
  private readonly displayMs=60*60*1000;
  readonly accessCode=signal('');
  readonly connected=signal(false);
  readonly loading=signal(false);
  readonly error=signal('');
  readonly cards=signal<WallCard[]>([]);
  readonly tiles=signal<WallTile[]>(Array.from({length:18},()=>({front:null,back:null,flipped:false})));
  readonly lastUpdated=signal('');
  readonly fullScreen=signal(false);
  readonly enlargedQr=signal<WallCard|null>(null);
  private readonly qrCache=new Map<string,string>();
  private flipTimer?:ReturnType<typeof setInterval>;
  private refreshTimer?:ReturnType<typeof setInterval>;
  private expiryTimer?:ReturnType<typeof setInterval>;
  private tileCursor=0;
  private cardCursor=0;
  private refreshing=false;
  private lastFullLoad=0;
  private aborted=false;
  private controller?:AbortController;

  ngOnInit():void {
    // Session-only: never store the access code in the URL or persistent storage.
    const cached=sessionStorage.getItem('kora-wall-session-code');
    if(cached){this.accessCode.set(cached);void this.connect()}
  }
  ngOnDestroy():void {
    this.aborted=true;
    this.stopTimers();
    this.controller?.abort();
  }

  async connect():Promise<void>{
    if(this.loading()||!this.accessCode().trim())return;
    this.loading.set(true);
    this.error.set('');
    try{
      const result=await this.fetchPage(0);
      if(this.aborted)return;
      this.connected.set(true);
      sessionStorage.setItem('kora-wall-session-code',this.accessCode().trim());
      await this.populate(result);
      this.stopTimers();
      this.flipTimer=setInterval(()=>this.flipOne(),3500);
      this.refreshTimer=setInterval(()=>{void this.refresh()},30000);
      this.expiryTimer=setInterval(()=>this.expireCards(),1000);
    }catch(err){
      this.connected.set(false);
      this.error.set(err instanceof Error?err.message:'Could not open the KORA wall.');
    }finally{this.loading.set(false)}
  }
  disconnect():void{
    this.stopTimers();
    this.controller?.abort();
    this.connected.set(false);
    this.cards.set([]);
    this.qrCache.clear();
    this.enlargedQr.set(null);
    this.tiles.set(Array.from({length:16},()=>({front:null,back:null,flipped:false})));
    this.error.set('');
    this.accessCode.set('');
    this.cardCursor=0;
    this.tileCursor=0;
    this.lastFullLoad=0;
    sessionStorage.removeItem('kora-wall-session-code');
  }
  private stopTimers():void{
    if(this.flipTimer)clearInterval(this.flipTimer);
    if(this.refreshTimer)clearInterval(this.refreshTimer);
    if(this.expiryTimer)clearInterval(this.expiryTimer);
    this.flipTimer=undefined;this.refreshTimer=undefined;this.expiryTimer=undefined;
  }
  private async fetchPage(offset:number):Promise<WallPage>{
    const config=SUPABASE_STORAGE_CONFIG;
    if(!config.url.startsWith('https://')||config.url.includes('YOUR_PROJECT_REF')||
      !config.publishableKey||config.publishableKey.startsWith('PASTE_')){
      throw new Error('Supabase is not configured in the Vercel build.');
    }
    const base=config.url.replace(/\/$/,'');
    const response=await fetch(`${base}/functions/v1/kora-wall-feed?offset=${offset}`,{
      method:'GET',
      headers:{apikey:config.publishableKey,'x-kora-wall-key':this.accessCode().trim()},
      cache:'no-store',
      signal:this.controller?.signal,
    });
    const body=await response.json().catch(()=>({})) as Partial<WallPage>;
    if(!response.ok){
      if(response.status===401||response.status===403){
        sessionStorage.removeItem('kora-wall-session-code');
        throw new Error('Incorrect TV access code or origin not allowed.');
      }
      throw new Error(body.error||`Unable to load KORA cards (HTTP ${response.status}).`);
    }
    if(!Array.isArray(body.cards))throw new Error('Unexpected TV wall response.');
    return {cards:body.cards.filter(c=>typeof c.path==='string'&&typeof c.url==='string'&&typeof c.qrUrl==='string'&&typeof c.uploadedAt==='string'),nextOffset:typeof body.nextOffset==='number'?body.nextOffset:null};
  }
  private async populate(first:WallPage):Promise<void>{
    const collected=[...first.cards];
    let offset=first.nextOffset;
    // Read pages of 80 until all available cards are loaded.
    // A safety limit prevents a misconfigured server from looping indefinitely.
    for(let page=0;offset!==null&&page<60&&!this.aborted;page++){
      const next=await this.fetchPage(offset);
      collected.push(...next.cards);
      if(next.nextOffset===offset)break;
      offset=next.nextOffset;
    }
    if(this.aborted||!this.connected())return;
    const known=new Map<string,WallCard>();
    for(const card of collected)known.set(card.path,card);
    this.lastFullLoad=Date.now();
    this.applyCards([...known.values()]);
  }
  private isFresh(card:WallCard,now=Date.now()):boolean{
    const uploaded=Date.parse(card.uploadedAt);
    return Number.isFinite(uploaded)&&uploaded<=now&&now-uploaded<this.displayMs;
  }
  // Reconcile the live wall independently of fetch success. An expired card
  // disappears even if the TV loses its network connection.
  private expireCards():void{
    const now=Date.now();
    const current=this.cards();
    if(current.some(card=>!this.isFresh(card,now))){
      this.applyCards(current.filter(card=>this.isFresh(card,now)));
    }
    const enlarged=this.enlargedQr();
    if(enlarged&&!this.isFresh(enlarged,now))this.closeQr();
  }
  private applyCards(items:WallCard[]):void{
    const now=Date.now();
    const eligible=items.filter(card=>this.isFresh(card,now));
    const previous=this.cards();
    const priorPaths=previous.map(card=>card.path);
    const changed=priorPaths.length!==eligible.length||
      priorPaths.some((path,i)=>path!==eligible[i].path);
    this.cards.set(eligible);
    this.qrCache.clear();
    const zoomed=this.enlargedQr();
    if(zoomed)this.enlargedQr.set(eligible.find(item=>item.path===zoomed.path)??null);
    this.lastUpdated.set(new Date().toLocaleTimeString());
    const known=new Map(eligible.map(item=>[item.path,item]));
    if(changed){
      // Refill empty/expired slots promptly; nothing older than an hour
      // remains on either side of a flipping tile.
      this.tiles.set(Array.from({length:this.slots},(_,i)=>({
        front:eligible[i]??null,back:null,flipped:false,
      })));
      this.cardCursor=Math.min(this.slots,eligible.length);
      this.tileCursor=0;
    }else{
      // Refresh signed image URLs without interrupting animations.
      this.tiles.update(tiles=>tiles.map(tile=>({
        ...tile,
        front:tile.front?known.get(tile.front.path)??null:null,
        back:tile.back?known.get(tile.back.path)??null:null,
      })));
    }
  }
  async refresh():Promise<void>{
    if(this.refreshing||!this.connected())return;
    this.refreshing=true;
    this.controller=new AbortController();
    try{
      const result=await this.fetchPage(0);
      if(Date.now()-this.lastFullLoad>4*60*1000||this.cards().length<=80||result.nextOffset===null){
        // Renew all signed links periodically and discover older pages.
        await this.populate(result);
      }else{
        // Poll only the newest page every 30 seconds, avoiding a large
        // re-download of hundreds of signed images on each poll.
        const freshPaths=new Set(result.cards.map(card=>card.path));
        this.applyCards([...result.cards,...this.cards().filter(card=>!freshPaths.has(card.path))]);
      }
      this.error.set('');
    }catch(err){
      if(!this.aborted)this.error.set(err instanceof Error?err.message:'Connection lost. Retrying…');
    }finally{this.refreshing=false;this.controller=undefined}
  }
  flipOne():void{
    this.expireCards();
    const pool=this.cards();
    if(pool.length<=this.slots)return; // All eligible cards already fit.
    const slot=this.tileCursor++%this.slots;
    // Prefer a player not already visible in another TV tile.
    const onScreen=new Set(this.tiles().map(tile=>(
      tile.flipped?tile.back?.path:tile.front?.path
    )).filter(Boolean));
    let card=pool[this.cardCursor++%pool.length];
    for(let i=0;i<pool.length&&onScreen.has(card.path);i++){
      card=pool[this.cardCursor++%pool.length];
    }
    this.tiles.update(tiles=>{
      const copy=[...tiles];
      const old=copy[slot];
      copy[slot]=old.flipped
        ?{front:card,back:old.back,flipped:false}
        :{front:old.front,back:card,flipped:true};
      return copy;
    });
  }
  // The QR contains a compact, seven-day token URL rather than the dense
  // and rapidly expiring image URL. No external QR provider is involved.
  qrImage(card:WallCard):string{
    const cached=this.qrCache.get(card.qrUrl);
    if(cached)return cached;
    const encoded=qrDataUrl(card.qrUrl);
    this.qrCache.set(card.qrUrl,encoded);
    return encoded;
  }
  showQr(card:WallCard):void{this.enlargedQr.set(card)}
  closeQr():void{this.enlargedQr.set(null)}
  async toggleFullscreen():Promise<void>{
    try{
      if(document.fullscreenElement)await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
      this.fullScreen.set(!!document.fullscreenElement);
    }catch{this.error.set('Fullscreen is unavailable on this device. Use the TV browser fullscreen setting.')}
  }
  trackTile(index:number):number{return index}
}

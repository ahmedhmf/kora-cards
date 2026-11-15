import {Injectable} from '@angular/core';
import {SUPABASE_STORAGE_CONFIG as config} from '../../environments/supabase-storage.config';

interface AuthTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: {id:string};
}
interface StoredSession {
  access_token:string;
  refresh_token:string;
  expires_at:number;
  user_id:string;
}

/**
 * KORA staff authenticate the booth once per browser session.
 * Finished cards upload into a private Supabase Storage bucket using only
 * the public publishable key and a narrowly authorized staff user JWT.
 * The PWA never receives a secret/service_role key.
 */
@Injectable({providedIn:'root'})
export class SupabaseCardStorageService {
  private readonly key='kora-supabase-staff-session';
  private session:StoredSession|null=this.restore();
  private refreshing?:Promise<void>;

  get configured():boolean{
    return config.url.startsWith('https://') &&
      !config.url.includes('YOUR_PROJECT_REF') &&
      Boolean(config.publishableKey) &&
      !config.publishableKey.startsWith('PASTE_');
  }
  get connected():boolean{return this.configured&&!!this.session}

  private restore():StoredSession|null {
    try {
      const raw=sessionStorage.getItem(this.key);
      if (!raw) return null;
      const value=JSON.parse(raw) as Partial<StoredSession>;
      return value.access_token && value.refresh_token && value.user_id && typeof value.expires_at==='number'
        ? value as StoredSession : null;
    }catch{return null}
  }
  private save(session:StoredSession){
    this.session=session;
    sessionStorage.setItem(this.key,JSON.stringify(session));
  }
  disconnect(){
    this.session=null;
    sessionStorage.removeItem(this.key);
  }
  private base():string{
    if(!this.configured)throw new Error('Supabase is not configured yet. Ask KORA staff to add the project URL and publishable key.');
    return config.url.replace(/\/$/,'');
  }
  private async authRequest(endpoint:string,body:unknown):Promise<AuthTokens>{
    const response=await fetch(`${this.base()}/auth/v1/token?grant_type=${endpoint}`,{
      method:'POST',
      headers:{'apikey':config.publishableKey,'Content-Type':'application/json'},
      body:JSON.stringify(body),
    });
    if(!response.ok) {
      const error=await response.json().catch(()=>({msg:'Sign-in failed'})) as {msg?:string;error_description?:string};
      throw new Error(error.error_description||error.msg||'Supabase authentication failed');
    }
    return response.json() as Promise<AuthTokens>;
  }
  private storeTokens(data:AuthTokens){
    if(!data.access_token||!data.refresh_token||!data.user?.id)throw new Error('Supabase did not return a valid staff session');
    this.save({access_token:data.access_token,refresh_token:data.refresh_token,
      expires_at:Date.now()+(data.expires_in||3600)*1000,user_id:data.user.id});
  }

  async connect(email:string,password:string):Promise<void>{
    if(!email.trim()||!password)throw new Error('Enter the staff Supabase email and password.');
    const tokens=await this.authRequest('password',{email:email.trim(),password});
    this.storeTokens(tokens);
  }

  private async validSession():Promise<StoredSession>{
    if(!this.session)throw new Error('Supabase is not connected. Ask KORA staff to sign in.');
    if(this.session.expires_at>Date.now()+60000)return this.session;
    if(!this.refreshing){
      this.refreshing=(async()=>{
        try{
          const tokens=await this.authRequest('refresh_token',{refresh_token:this.session!.refresh_token});
          this.storeTokens(tokens);
        }catch(error){
          this.disconnect();
          throw new Error('Supabase staff login expired. Sign in again to resume automatic uploads.');
        }
      })().finally(()=>{this.refreshing=undefined});
    }
    await this.refreshing;
    return this.session!;
  }

  /** Share only a time-limited download link, not a public bucket URL. */
  async signedDownloadUrl(path:string):Promise<string>{
    const session=await this.validSession();
    const encoded=path.split('/').map(encodeURIComponent).join('/');
    const response=await fetch(`${this.base()}/storage/v1/object/sign/${encodeURIComponent(config.bucket)}/${encoded}`,{
      method:'POST',
      headers:{apikey:config.publishableKey,Authorization:`Bearer ${session.access_token}`,
        'Content-Type':'application/json'},
      body:JSON.stringify({expiresIn:7*24*60*60}),
    });
    if(response.status===401){
      this.disconnect();
      throw new Error('Supabase session expired. KORA staff must reconnect.');
    }
    if(!response.ok){
      const data=await response.json().catch(()=>({message:'Cannot create download link'})) as {message?:string};
      throw new Error(data.message||'Could not create download link');
    }
    const data=await response.json() as {signedURL?:string};
    if(!data.signedURL)throw new Error('Supabase did not return a signed download link');
    const signedPath=data.signedURL.startsWith('/storage/v1/')
      ? data.signedURL.slice('/storage/v1/'.length)
      : data.signedURL.replace(new RegExp('^/+'), '');
    const signed=new URL(signedPath,`${this.base()}/storage/v1/`);
    if(signed.origin!==new URL(this.base()).origin)throw new Error('Unexpected Supabase download host');
    signed.searchParams.set('download','kora-card.png');
    return signed.toString();
  }

  async uploadCard(blob:Blob):Promise<string>{
    const session=await this.validSession();
    if(blob.type!=='image/png'||!blob.size)throw new Error('Only completed PNG cards can be uploaded');
    const filename=`${session.user_id}/${new Date().toISOString().slice(0,10)}/${crypto.randomUUID()}.png`;
    const path=filename.split('/').map(encodeURIComponent).join('/');
    const response=await fetch(`${this.base()}/storage/v1/object/${encodeURIComponent(config.bucket)}/${path}`,{
      method:'POST',
      headers:{
        'apikey':config.publishableKey,
        'Authorization':`Bearer ${session.access_token}`,
        'Content-Type':'image/png',
        'cache-control':'3600',
        'x-upsert':'false',
      },
      body:blob,
    });
    if(response.status===401){this.disconnect();throw new Error('Supabase session expired; staff must reconnect.')}
    if(!response.ok){
      const detail=await response.json().catch(()=>({message:'Upload failed'})) as {message?:string;error?:string};
      throw new Error(`Supabase upload failed (${response.status}): ${detail.message||detail.error||'Unknown error'}`);
    }
    return filename;
  }
}

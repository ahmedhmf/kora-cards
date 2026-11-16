import {Injectable} from '@angular/core';
import {SUPABASE_STORAGE_CONFIG as config} from '../../environments/supabase-storage.config';

/**
 * Unauthenticated customer upload through the server-side KORA Edge Function.
 * The function checks consent, file size, image dimensions, allowed origins and
 * rate limits, then signs a private download URL. No credentials in the PWA.
 */
@Injectable({providedIn:'root'})
export class SupabaseCardStorageService {
  get configured():boolean {
    return config.url.startsWith('https://') &&
      !config.url.includes('YOUR_PROJECT_REF') &&
      !!config.publishableKey &&
      !config.publishableKey.startsWith('PASTE_');
  }

  async uploadCard(blob:Blob,linkToken?:string):Promise<string>{
    if(!this.configured)throw new Error('KORA cloud storage is not configured yet.');
    if(blob.type!=='image/png'||!blob.size||blob.size>10*1024*1024){
      throw new Error('Only completed KORA card PNGs smaller than 10 MB can be uploaded.');
    }
    const response=await fetch(
      `${(config.url.endsWith('/') ? config.url.slice(0,-1) : config.url)}/functions/v1/kora-card-upload`,{
      method:'POST',
      headers:{
        'Content-Type':'image/png',
        'x-kora-consent':'yes',
        ...(linkToken?{'x-kora-registration-token':linkToken}:{}),
        apikey:config.publishableKey,
      },
      body:blob,
    });
    const data=await response.json().catch(()=>({error:'Cloud service unavailable'})) as {
      downloadUrl?:string;error?:string;
    };
    if(!response.ok)throw new Error(data.error||`Cloud upload failed (${response.status}).`);
    if(!data.downloadUrl||!data.downloadUrl.startsWith((config.url.endsWith('/') ? config.url.slice(0,-1) : config.url))){
      throw new Error('Cloud upload succeeded but no valid card download link was returned.');
    }
    return data.downloadUrl;
  }
}

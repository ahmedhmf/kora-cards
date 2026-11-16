import {Injectable} from '@angular/core';
import {SUPABASE_STORAGE_CONFIG as config} from '../../environments/supabase-storage.config';

export interface KoraPlayerRegistration {
  name:string;
  email:string;
  instagram:string;
  telephone:string;
  position:string;
  shirtNumber:number;
  cardCloudConsent:boolean;
}

/** Sends consented player details to a private, server-managed Supabase table. */
@Injectable({providedIn:'root'})
export class SupabasePlayerRegistrationService {
  async save(player:KoraPlayerRegistration):Promise<void>{
    if(!config.url.startsWith('https://')||config.url.includes('YOUR_PROJECT_REF')||
       !config.publishableKey||config.publishableKey.startsWith('PASTE_')){
      throw new Error('KORA database is not configured yet.');
    }
    const base=config.url.replace(/\/$/,'');
    let response:Response;
    try{
      response=await fetch(`${base}/functions/v1/kora-player-save`,{
        method:'POST',
        headers:{
          'Content-Type':'application/json',
          'x-kora-data-consent':'yes',
          apikey:config.publishableKey,
        },
        body:JSON.stringify(player),
      });
    }catch{
      throw new Error('Unable to reach the KORA registration service. Check your connection.');
    }
    const result=await response.json().catch(()=>({})) as {saved?:boolean;error?:string};
    if(!response.ok||!result.saved)throw new Error(result.error||`Player registration failed (${response.status}).`);
  }
}

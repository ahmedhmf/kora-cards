import {Injectable} from '@angular/core';
import {GOOGLE_DRIVE_CONFIG} from '../../environments/google-drive.config';

interface GoogleTokenResponse {access_token?:string;error?:string;error_description?:string}
interface GoogleTokenClient {requestAccessToken(options?:{prompt?:string}):void}
interface GoogleIdentityServices {
  accounts:{oauth2:{initTokenClient(options:{client_id:string;scope:string;callback:(response:GoogleTokenResponse)=>void;error_callback?:(error:unknown)=>void}):GoogleTokenClient}}
}
declare global {interface Window {google?:GoogleIdentityServices}}

export interface DriveUploadResult {id:string;name:string;webViewLink?:string}

@Injectable({providedIn:'root'})
export class GoogleDriveService {
  private accessToken='';
  private tokenClient?:GoogleTokenClient;
  private scriptPromise?:Promise<void>;
  private folderId='';

  async upload(file:File):Promise<DriveUploadResult>{
    this.assertConfigured();
    const token=await this.authorize();
    const folderId=await this.ensureFolder(token);
    const boundary=`kora_${crypto.randomUUID()}`;
    const metadata:{name:string;mimeType:string;parents:string[]}={name:file.name,mimeType:file.type,parents:[folderId]};
    const body=new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
      JSON.stringify(metadata),
      `\r\n--${boundary}\r\nContent-Type: ${file.type}\r\n\r\n`,
      file,
      `\r\n--${boundary}--`
    ],{type:`multipart/related; boundary=${boundary}`});
    const response=await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink',{
      method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':`multipart/related; boundary=${boundary}`},body
    });
    if(response.status===401){this.accessToken='';throw new Error('Google authorization expired. Please try again.');}
    if(!response.ok){const detail=await response.text();throw new Error(`Google Drive upload failed (${response.status}): ${detail}`);}
    return response.json() as Promise<DriveUploadResult>;
  }

  disconnect(){this.accessToken='';this.folderId='';}

  private async ensureFolder(token:string):Promise<string>{
    if(this.folderId)return this.folderId;
    const escaped=GOOGLE_DRIVE_CONFIG.folderName.replace(/'/g,"\\'");
    const query=encodeURIComponent(`name='${escaped}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
    const existing=await fetch(`https://www.googleapis.com/drive/v3/files?q=${query}&spaces=drive&fields=files(id,name)&pageSize=1`,{headers:{Authorization:`Bearer ${token}`}});
    if(!existing.ok)throw new Error(`Google Drive folder lookup failed (${existing.status}).`);
    const found=await existing.json() as {files?:Array<{id:string}>};
    if(found.files?.[0])return this.folderId=found.files[0].id;
    const created=await fetch('https://www.googleapis.com/drive/v3/files?fields=id',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({name:GOOGLE_DRIVE_CONFIG.folderName,mimeType:'application/vnd.google-apps.folder'})});
    if(!created.ok)throw new Error(`Google Drive folder creation failed (${created.status}).`);
    const folder=await created.json() as {id:string};
    return this.folderId=folder.id;
  }

  private async authorize():Promise<string>{
    if(this.accessToken)return this.accessToken;
    await this.loadScript();
    return new Promise<string>((resolve,reject)=>{
      this.tokenClient??=window.google!.accounts.oauth2.initTokenClient({
        client_id:GOOGLE_DRIVE_CONFIG.clientId,
        scope:'https://www.googleapis.com/auth/drive.file',
        callback:response=>{
          if(response.error||!response.access_token){reject(new Error(response.error_description||response.error||'Google authorization was cancelled.'));return;}
          this.accessToken=response.access_token;resolve(this.accessToken);
        },
        error_callback:error=>reject(new Error(`Google sign-in failed: ${String(error)}`))
      });
      this.tokenClient.requestAccessToken({prompt:'select_account'});
    });
  }

  private loadScript():Promise<void>{
    if(window.google?.accounts.oauth2)return Promise.resolve();
    if(this.scriptPromise)return this.scriptPromise;
    this.scriptPromise=new Promise<void>((resolve,reject)=>{
      const existing=document.querySelector<HTMLScriptElement>('script[data-google-identity]');
      const script=existing??document.createElement('script');
      script.onload=()=>resolve();script.onerror=()=>reject(new Error('Google sign-in could not load. Check the connection.'));
      if(!existing){script.src='https://accounts.google.com/gsi/client';script.async=true;script.defer=true;script.dataset['googleIdentity']='true';document.head.appendChild(script);}
    });
    return this.scriptPromise;
  }

  private assertConfigured(){
    if(!GOOGLE_DRIVE_CONFIG.clientId||GOOGLE_DRIVE_CONFIG.clientId.startsWith('PASTE_'))throw new Error('Google Drive is not configured yet. Add the OAuth client ID in google-drive.config.ts.');
  }
}

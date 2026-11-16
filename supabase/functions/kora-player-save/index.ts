// Private KORA player registration. Server-side key only; no customer login.
import {createClient} from 'npm:@supabase/supabase-js@2';

const projectUrl=Deno.env.get('SUPABASE_URL')??'';
const allowedOrigins=(Deno.env.get('KORA_ALLOWED_ORIGINS')||'')
  .split(',').map(value=>value.trim()).filter(Boolean);
const salt=Deno.env.get('KORA_RATE_LIMIT_SALT')||'';
const MAX_BYTES=2048;
const POSITIONS=new Set([
  'GK','RB','RWB','CB','LB','LWB','CDM','CM','CAM','RM','RW','LM','LW','CF','ST',
]);
function serverKey():string{
  const raw=Deno.env.get('SUPABASE_SECRET_KEYS');
  if(raw){
    try{
      const parsed=JSON.parse(raw) as Record<string,string>;
      if(typeof parsed.default==='string'&&parsed.default)return parsed.default;
    }catch{console.error('KORA: invalid SUPABASE_SECRET_KEYS JSON')}
  }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
}
function reply(status:number,payload:Record<string,unknown>,origin:string){
  return new Response(JSON.stringify(payload),{status,headers:{
    'Content-Type':'application/json','Cache-Control':'no-store',
    'Access-Control-Allow-Origin':origin,'Vary':'Origin',
    'Access-Control-Allow-Methods':'POST,OPTIONS',
    'Access-Control-Allow-Headers':'apikey,content-type,x-kora-data-consent,authorization,x-client-info',
  }});
}
async function hashLinkToken(token:string){
  const input=new TextEncoder().encode(salt+'|registration-link|'+token);
  const digest=await crypto.subtle.digest('SHA-256',input);
  return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}
async function hashedIp(ip:string){
  const bytes=new TextEncoder().encode(salt+'|'+ip);
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}
Deno.serve(async request=>{
  const origin=request.headers.get('origin')||'';
  if(!origin||!allowedOrigins.includes(origin)){
    return reply(403,{error:'KORA player registration origin is not allowed'},origin||'null');
  }
  if(request.method==='OPTIONS')return reply(200,{ok:true},origin);
  if(request.method!=='POST')return reply(405,{error:'Method not allowed'},origin);
  const key=serverKey();
  if(!projectUrl||!key||!salt)return reply(503,{error:'Player registration service is not configured'},origin);
  if(request.headers.get('x-kora-data-consent')!=='yes'){
    return reply(400,{error:'Consent to save player details is required'},origin);
  }
  if(request.headers.get('content-type')?.split(';')[0].trim()!=='application/json'){
    return reply(415,{error:'Player registration requires JSON'},origin);
  }
  if(Number(request.headers.get('content-length')||'0')>MAX_BYTES){
    return reply(413,{error:'Player registration is too large'},origin);
  }
  try{
    const reader=request.body?.getReader();
    if(!reader)return reply(400,{error:'Player details are required'},origin);
    const chunks:Uint8Array[]=[];
    let total=0;
    for(;;){
      const {done,value}=await reader.read();
      if(done)break;
      total+=value.byteLength;
      if(total>MAX_BYTES){await reader.cancel();return reply(413,{error:'Player registration is too large'},origin)}
      chunks.push(value);
    }
    const bytes=new Uint8Array(total);
    let offset=0;
    for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength}
    let body:unknown;
    try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))}catch{
      return reply(400,{error:'Invalid player details'},origin);
    }
    if(!body||typeof body!=='object'||Array.isArray(body)){
      return reply(400,{error:'Invalid player details'},origin);
    }
    const value=body as Record<string,unknown>;
    const name=typeof value.name==='string'?value.name.trim():'';
    const email=typeof value.email==='string'?value.email.trim().toLowerCase():'';
    const instagram=typeof value.instagram==='string'?value.instagram.trim().replace(/^@/,''):'';
    const telephone=typeof value.telephone==='string'?value.telephone.trim():'';
    const digits=telephone.replace(/[\s().-]/g,'').replace(/^\+/,'');
    const position=typeof value.position==='string'?value.position:'';
    const shirtNumber=value.shirtNumber;
    const cloudConsent=value.cardCloudConsent===true;
    if(!name||name.length>18||
       email.length>254||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||
       !/^[A-Za-z0-9._]{1,30}$/.test(instagram)||
       telephone.length>24||!/^\+?[0-9\s().-]+$/.test(telephone)||
       !/^\d{8,15}$/.test(digits)||digits.startsWith('0')||
       !POSITIONS.has(position)||
       typeof shirtNumber!=='number'||!Number.isInteger(shirtNumber)||
       shirtNumber<0||shirtNumber>99){
      return reply(400,{error:'Please check your name, email, Instagram, phone, position and shirt number'},origin);
    }
    const admin=createClient(projectUrl,key,{auth:{autoRefreshToken:false,persistSession:false}});
    const ip=request.headers.get('cf-connecting-ip')||
      request.headers.get('x-real-ip')||
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()||'unknown';
    const {data:allowed,error:quotaError}=await admin.rpc('kora_claim_upload_slot',{
      p_hash:await hashedIp(ip),
    });
    if(quotaError)throw quotaError;
    if(!allowed)return reply(429,{error:'Too many registrations. Please try again later'},origin);

    // One-time capability for linking THIS guest's completed PNG to their
    // private registration. Never expose database IDs or secret keys.
    const linkToken=crypto.randomUUID();
    const {error}=await admin.from('kora_player_registrations').insert({
      name,email,instagram,telephone,position,
      shirt_number:shirtNumber,card_cloud_consent:cloudConsent,
      data_consent_version:'v1',
      card_link_token_hash:cloudConsent?await hashLinkToken(linkToken):null,
    });
    if(error)throw error;
    return reply(201,{saved:true,linkToken:cloudConsent?linkToken:null},origin);
  }catch(error){
    // Log details only server-side; never expose data, SQL errors or keys to PWA.
    console.error('KORA player registration failed',error);
    return reply(503,{error:'Unable to save player details. Please try again'},origin);
  }
});

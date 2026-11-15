// Supabase Edge Function: no customer or staff login.
// Private bucket access uses a server-only key; NEVER expose it to the PWA.
import {createClient} from 'npm:@supabase/supabase-js@2';

const projectUrl=Deno.env.get('SUPABASE_URL')??'';
function serviceKey():string {
  // A malformed environment variable must not crash the worker before OPTIONS.
  const raw=Deno.env.get('SUPABASE_SECRET_KEYS');
  if(raw){
    try {
      const decoded=JSON.parse(raw) as Record<string,string>;
      if(typeof decoded.default==='string'&&decoded.default)return decoded.default;
    }catch {
      console.error('SUPABASE_SECRET_KEYS is not valid JSON');
    }
  }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
}
const allowedOrigins=(Deno.env.get('KORA_ALLOWED_ORIGINS')||'')
  .split(',').map(s=>s.trim()).filter(Boolean);
const salt=Deno.env.get('KORA_RATE_LIMIT_SALT')||'';
const MAX_SIZE=10*1024*1024;
const PNG_MAGIC=[137,80,78,71,13,10,26,10];

function responseJson(status:number,data:Record<string,unknown>,origin:string){
  return new Response(JSON.stringify(data),{status,headers:{
    'Content-Type':'application/json','Cache-Control':'no-store',
    'Access-Control-Allow-Origin':origin,'Vary':'Origin',
    'Access-Control-Allow-Headers':'content-type,apikey,x-kora-consent,authorization,x-client-info',
    'Access-Control-Allow-Methods':'POST,OPTIONS',
  }});
}
function isValidPng(bytes:Uint8Array):boolean{
  if(bytes.length<33||!PNG_MAGIC.every((byte,i)=>bytes[i]===byte))return false;
  const dv=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  return dv.getUint32(8,false)===13&&
    String.fromCharCode(...bytes.slice(12,16))==='IHDR'&&
    dv.getUint32(16,false)===877&&dv.getUint32(20,false)===1558&&
    bytes[24]===8&&[2,6].includes(bytes[25]); // RGB / RGBA, 8-bit
}
async function hashClient(ip:string){
  const input=new TextEncoder().encode(salt+'|'+ip);
  const digest=await crypto.subtle.digest('SHA-256',input);
  return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
}

Deno.serve(async request=>{
  const origin=request.headers.get('origin')||'';
  if(!origin||!allowedOrigins.includes(origin)){
    console.warn('Blocked KORA upload from non-allowlisted origin:',origin);
    return responseJson(403,{error:'Origin is not allowlisted in KORA_ALLOWED_ORIGINS'},origin||'null');
  }
  // A valid preflight must succeed before the browser sends any image bytes.
  if(request.method==='OPTIONS')return responseJson(200,{ok:true},origin);
  if(request.method!=='POST')return responseJson(405,{error:'Method not allowed'},origin);
  const secretKey=serviceKey();
  if(!projectUrl||!secretKey||!salt||allowedOrigins.length===0){
    return responseJson(503,{error:'KORA cloud service is not configured'},origin);
  }
  if(request.headers.get('x-kora-consent')!=='yes'){
    return responseJson(400,{error:'Cloud storage consent is required'},origin);
  }
  if(request.headers.get('content-type')?.split(';')[0]!=='image/png'){
    return responseJson(415,{error:'Only PNG cards can be uploaded'},origin);
  }
  const length=Number(request.headers.get('content-length')||'0');
  if(length>MAX_SIZE)return responseJson(413,{error:'Card exceeds maximum upload size'},origin);
  try{
    // An explicit streaming upper bound prevents arbitrary-size request bodies.
    const reader=request.body?.getReader();
    if(!reader)return responseJson(400,{error:'No image supplied'},origin);
    const chunks:Uint8Array[]=[];
    let total=0;
    for(;;){
      const {done,value}=await reader.read();
      if(done)break;
      total+=value.byteLength;
      if(total>MAX_SIZE){await reader.cancel();return responseJson(413,{error:'Card exceeds 10 MB limit'},origin)}
      chunks.push(value);
    }
    const image=new Uint8Array(total);let offset=0;
    for(const chunk of chunks){image.set(chunk,offset);offset+=chunk.length}
    if(!isValidPng(image))return responseJson(400,{error:'Invalid KORA card image dimensions or format'},origin);

    // IP supplied by the Supabase gateway; the rate limit is an abuse mitigation,
    // not proof of a human. Apply gateway-level rate limits / CAPTCHA if targeted.
    const ip=request.headers.get('cf-connecting-ip')||
      request.headers.get('x-real-ip')||
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()||'unknown';
    const admin=createClient(projectUrl,secretKey,{auth:{autoRefreshToken:false,persistSession:false}});
    const {data:allowed,error:quotaError}=await admin.rpc('kora_claim_upload_slot',{
      p_hash:await hashClient(ip)
    });
    if(quotaError)throw quotaError;
    if(!allowed)return responseJson(429,{error:'Too many card uploads. Please try again later.'},origin);

    const path=`${new Date().toISOString().slice(0,10)}/${crypto.randomUUID()}.png`;
    const {error:uploadError}=await admin.storage.from('kora-cards')
      .upload(path,image,{contentType:'image/png',cacheControl:'3600',upsert:false});
    if(uploadError)throw uploadError;
    const {data:link,error:linkError}=await admin.storage.from('kora-cards')
      .createSignedUrl(path,7*24*60*60,{download:'kora-card.png'});
    if(linkError||!link?.signedUrl)throw linkError??new Error('Cannot generate download link');
    return responseJson(200,{downloadUrl:link.signedUrl},origin);
  }catch(error){
    console.error('KORA card upload failed',error);
    return responseJson(503,{error:'Cloud upload unavailable. You can still save your card.'},origin);
  }
});

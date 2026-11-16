// Short event QR link. Anyone with a valid unguessable QR token can download
// the consenting player's card, without a TV access code or browser CORS.
// No personal/contact information is exposed. Link lasts 7 days from upload.
import {createClient} from 'npm:@supabase/supabase-js@2';

const projectUrl=Deno.env.get('SUPABASE_URL')||'';
function serviceKey():string{
  const raw=Deno.env.get('SUPABASE_SECRET_KEYS');
  if(raw){
    try{
      const keys=JSON.parse(raw) as Record<string,string>;
      if(typeof keys.default==='string'&&keys.default)return keys.default;
    }catch{console.error('KORA wall download: malformed secret keys')}
  }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
}
function fail(status:number,description:string):Response{
  return new Response(description,{status,headers:{
    'Cache-Control':'no-store','Content-Type':'text/plain; charset=utf-8',
    'Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff',
  }});
}
Deno.serve(async request=>{
  if(request.method!=='GET')return fail(405,'Method not allowed');
  const url=new URL(request.url);
  const token=url.searchParams.get('t')||'';
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token)){
    return fail(404,'This card link was not found');
  }
  const key=serviceKey();
  if(!projectUrl||!key)return fail(503,'KORA card downloads are temporarily unavailable');
  try{
    const admin=createClient(projectUrl,key,{auth:{autoRefreshToken:false,persistSession:false}});
    const since=new Date(Date.now()-7*24*60*60*1000).toISOString();
    const {data,error}=await admin.from('kora_player_registrations')
      .select('card_storage_path')
      .eq('wall_share_token',token)
      .eq('event_screen_consent',true)
      .eq('card_cloud_consent',true)
      .gt('card_uploaded_at',since)
      .maybeSingle();
    if(error)throw error;
    if(!data?.card_storage_path)return fail(410,'This KORA card link has expired or is no longer available');
    const {data:link,error:signError}=await admin.storage.from('kora-cards')
      .createSignedUrl(data.card_storage_path,60,{download:'kora-card.png'});
    if(signError||!link?.signedUrl)throw signError??new Error('Signed URL missing');
    return new Response(null,{status:302,headers:{
      Location:link.signedUrl,
      'Cache-Control':'no-store',
      'Referrer-Policy':'no-referrer',
      'X-Content-Type-Options':'nosniff',
    }});
  }catch(error){
    console.error('KORA event QR download failed',error);
    return fail(503,'Unable to open this card right now. Please try again');
  }
});

// Read-only event TV wall feed. Server-issued short-lived signed PNG and MP4 URLs.
// The event access code is never stored in GitHub or exposed to the PWA build.
import {createClient} from 'npm:@supabase/supabase-js@2';

const projectUrl=Deno.env.get('SUPABASE_URL')||'';
const allowedOrigins=(Deno.env.get('KORA_ALLOWED_ORIGINS')||'')
  .split(',').map(s=>s.trim()).filter(Boolean);
const accessKey=Deno.env.get('KORA_WALL_ACCESS_KEY')||'';
const PAGE_SIZE=80;

function serviceKey():string{
  const raw=Deno.env.get('SUPABASE_SECRET_KEYS');
  if(raw){
    try{
      const parsed=JSON.parse(raw) as Record<string,string>;
      if(typeof parsed.default==='string'&&parsed.default)return parsed.default;
    }catch{console.error('KORA wall: invalid SUPABASE_SECRET_KEYS')}
  }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
}
function responseJson(status:number,body:Record<string,unknown>,origin:string){
  return new Response(JSON.stringify(body),{status,headers:{
    'Content-Type':'application/json','Cache-Control':'private, no-store',
    'Access-Control-Allow-Origin':origin,'Vary':'Origin',
    'Access-Control-Allow-Headers':'apikey,x-kora-wall-key,authorization,x-client-info',
    'Access-Control-Allow-Methods':'GET,OPTIONS',
    'Referrer-Policy':'no-referrer',
  }});
}
function sameSecret(a:string,b:string):boolean{
  const lhs=new TextEncoder().encode(a);
  const rhs=new TextEncoder().encode(b);
  // Avoid leaking how many characters matched.
  let difference=lhs.length^rhs.length;
  for(let i=0;i<Math.max(lhs.length,rhs.length);i++)difference|=(lhs[i]??0)^(rhs[i]??0);
  return difference===0;
}

Deno.serve(async request=>{
  const origin=request.headers.get('origin')||'';
  if(!origin||!allowedOrigins.includes(origin)){
    return responseJson(403,{error:'Origin is not allowed for the KORA event display'},origin||'null');
  }
  if(request.method==='OPTIONS')return responseJson(200,{ok:true},origin);
  if(request.method!=='GET')return responseJson(405,{error:'Method not allowed'},origin);
  const secret=serviceKey();
  if(!projectUrl||!secret||accessKey.length<8){
    return responseJson(503,{error:'KORA TV wall is not configured'},origin);
  }
  if(!sameSecret(request.headers.get('x-kora-wall-key')||'',accessKey)){
    return responseJson(401,{error:'Incorrect TV access code'},origin);
  }

  const url=new URL(request.url);
  const rawOffset=url.searchParams.get('offset')||'0';
  if(!/^\d{1,6}$/.test(rawOffset))return responseJson(400,{error:'Invalid page offset'},origin);
  const offset=Number(rawOffset);
  if(offset>999999)return responseJson(400,{error:'Invalid page offset'},origin);

  try{
    const admin=createClient(projectUrl,secret,{auth:{autoRefreshToken:false,persistSession:false}});
    // Both sources are opt-in, approved and fresh. Independent pagination
    // prevents a busy booth from starving ball videos (and vice versa).
    const since=new Date(Date.now()-60*60*1000).toISOString();
    const [cardResult,videoResult]=await Promise.all([
      admin.from('kora_player_registrations')
        .select('card_storage_path,wall_share_token,card_uploaded_at')
        .eq('event_screen_consent',true).eq('card_cloud_consent',true)
        .not('card_storage_path','is',null).not('wall_share_token','is',null)
        .gt('card_uploaded_at',since)
        .order('card_uploaded_at',{ascending:false})
        .range(offset,offset+PAGE_SIZE-1),
      admin.from('kora_wall_ball_videos')
        .select('storage_path,uploaded_at')
        .eq('approved',true).eq('event_screen_consent',true)
        .gt('uploaded_at',since)
        .order('uploaded_at',{ascending:false})
        .range(offset,offset+PAGE_SIZE-1),
    ]);
    if(cardResult.error)throw cardResult.error;
    if(videoResult.error)throw videoResult.error;

    const validCards=(cardResult.data||[]).filter(row=>
      typeof row.card_storage_path==='string'&&
      typeof row.wall_share_token==='string'&&
      typeof row.card_uploaded_at==='string');
    const cardTokens=new Map(validCards.map(row=>[
      row.card_storage_path,{token:row.wall_share_token,uploadedAt:row.card_uploaded_at},
    ]));
    const cards:{path:string;url:string;qrUrl:string;uploadedAt:string}[]=[];
    if(validCards.length){
      const paths=validCards.map(row=>row.card_storage_path);
      const {data:urls,error:signError}=await admin.storage.from('kora-cards')
        .createSignedUrls(paths,10*60);
      if(signError)throw signError;
      for(const item of urls||[]){
        if(item.signedUrl&&item.path){
          const meta=cardTokens.get(item.path);
          if(meta)cards.push({path:item.path,url:item.signedUrl,
            qrUrl:`${projectUrl}/functions/v1/kora-wall-download?t=${meta.token}`,
            uploadedAt:meta.uploadedAt});
        }
      }
    }
    const validVideos=(videoResult.data||[]).filter(row=>
      typeof row.storage_path==='string'&&
      /^balls\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9._-]+\.mp4$/.test(row.storage_path)&&
      typeof row.uploaded_at==='string');
    const videoTimes=new Map(validVideos.map(row=>[row.storage_path,row.uploaded_at]));
    const videos:{path:string;url:string;uploadedAt:string}[]=[];
    if(validVideos.length){
      const {data:urls,error:signError}=await admin.storage.from('kora-wall-media')
        .createSignedUrls(validVideos.map(row=>row.storage_path),10*60);
      if(signError)throw signError;
      for(const item of urls||[]){
        if(item.signedUrl&&item.path){
          const uploadedAt=videoTimes.get(item.path);
          if(uploadedAt)videos.push({path:item.path,url:item.signedUrl,uploadedAt});
        }
      }
    }
    const nextOffset=(cardResult.data?.length===PAGE_SIZE||
      videoResult.data?.length===PAGE_SIZE)?offset+PAGE_SIZE:null;
    return responseJson(200,{cards,videos,nextOffset},origin);
  }catch(error){
    console.error('KORA wall feed unavailable',error);
    return responseJson(503,{error:'Unable to load event cards. Check Supabase function logs'},origin);
  }
});

'use strict';
const crypto=require('node:crypto');
const HEAD=['evento_id','registrado_em_utc','sha256','dados_json'];
const norm=s=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
const digest=s=>crypto.createHash('sha256').update(s).digest('hex');
const goodId=s=>typeof s==='string'&&/^[A-Za-z0-9_-]{20,120}$/.test(s);
const uuid=s=>typeof s==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
const qty=n=>Number.isSafeInteger(n)&&n>=0&&n<=1000000;
const validDate=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const err=(code,status=400)=>Object.assign(Error(code),{status});
const empty=()=>({users:new Map(),balances:[],targets:new Map(),events:new Map()});
function catalogFromSeed(seed){
 const stores=new Map(seed.lojas.map(l=>[String(l.id),{id:String(l.id),name:String(l.nome),city:String(l.cidade),branch:String(l.filial),promoter:String(l.promotor),coordinator:String(l.coord)}]));
 const products=new Map(seed.produtos.map(p=>[String(p.id),{id:String(p.id),name:String(p.nome),unitsPerBox:Number(p.unc)}]));
 if(stores.size!==36||products.size!==134||[...products.values()].some(p=>!Number.isSafeInteger(p.unitsPerBox)||p.unitsPerBox<1))throw Error('INVALID_OPERATIONAL_CATALOG');
 return {stores,products};
}
function profiles(c){
 const m=new Map([['Leonir',{role:'chief',name:'Leonir'}]]);
 for(const s of c.stores.values()){
  if(s.coordinator)m.set(s.coordinator,{role:'coordinator',name:s.coordinator});
  if(s.promoter){if(m.has(s.promoter)&&m.get(s.promoter).role!=='promoter')throw Error('AMBIGUOUS_OPERATIONAL_PROFILE');m.set(s.promoter,{role:'promoter',name:s.promoter})}
 }return m;
}
function permitted(u,store){
 return !!u&&!!store&&(u.role==='admin'||u.role==='chief'||(u.role==='coordinator'&&store.coordinator===u.name)||(u.role==='promoter'&&store.promoter===u.name));
}
const canBalance=u=>['admin','chief','promoter'].includes(u?.role);
const canTarget=u=>['admin','chief'].includes(u?.role);
function normalizeBalance(data,c){
 const store=String(data?.store??'');if(!c.stores.has(store)||!data.items||typeof data.items!=='object'||Array.isArray(data.items))throw err('INVALID_BALANCE');
 const entries=Object.entries(data.items);if(!entries.length||entries.length>c.products.size)throw err('INVALID_BALANCE_ITEMS');
 const items={};
 for(const [id,v] of entries){
  if(!c.products.has(id)||!qty(v?.qty)||!Array.isArray(v.lots)||v.lots.length>30)throw err('INVALID_BALANCE_ITEM');
  const dates=new Map();let total=0;for(const l of v.lots){if(!validDate(l?.date)||!qty(l.qty)||l.qty===0)throw err('INVALID_EXPIRY');total+=l.qty;dates.set(l.date,(dates.get(l.date)||0)+l.qty)}
  if(total>v.qty)throw err('EXPIRY_EXCEEDS_BALANCE');
  items[id]={qty:v.qty,lots:[...dates].sort(([a],[b])=>a.localeCompare(b)).map(([date,qty])=>({date,qty}))};
 }
 if(typeof data.note!=='string'||data.note.length>1000)throw err('INVALID_BALANCE_NOTE');
 return {store,items,note:data.note};
}
function normalizeTargets(data,c){
 const store=String(data?.store??'');if(!c.stores.has(store)||!data.items||typeof data.items!=='object'||Array.isArray(data.items))throw err('INVALID_TARGET');
 const entries=Object.entries(data.items);if(!entries.length||entries.length>c.products.size)throw err('INVALID_TARGET');
 const items={};for(const [id,v] of entries){if(!c.products.has(id)||(v!==null&&!qty(v)))throw err('INVALID_TARGET');items[id]=v}
 return {store,items};
}
function normalizeAccount(d,c,adminName){
 const username=String(d?.username??'').trim().toLowerCase(),profile=profiles(c).get(d?.profile);
 if(!/^[a-z0-9._-]{3,64}$/.test(username)||username===adminName||!profile||typeof d.enabled!=='boolean'||!uuid(d.version)||!(/^[0-9a-f]{32}$/.test(d.salt||''))||!(/^[0-9a-f]{64}$/.test(d.hash||'')))throw err('INVALID_ACCOUNT');
 return {username,profile:d.profile,enabled:d.enabled,version:d.version,salt:d.salt,hash:d.hash};
}
function applyEvent(state,e,c,adminName){
 if(!e||!uuid(e.id)||!Number.isFinite(Date.parse(e.at))||typeof e.actor!=='string'||typeof e.actorName!=='string')throw err('INVALID_OPERATIONAL_EVENT');
 const json=JSON.stringify(e),prior=state.events.get(e.id);if(prior){if(prior!==json)throw err('OPERATIONAL_EVENT_CONFLICT',409);return}
 if(e.kind==='account'){
  if(e.actor!==adminName)throw err('INVALID_ACCOUNT_ACTOR');const d=normalizeAccount(e.data,c,adminName);
  if(d.enabled&&[...state.users.values()].some(v=>v.enabled&&v.profile===d.profile&&v.username!==d.username))throw err('PROFILE_ALREADY_ASSIGNED',409);
  state.users.set(d.username,d);
 }else{
  const u=e.actor===adminName?{role:'admin',name:'Administrador'}:state.users.get(e.actor)&&{...profiles(c).get(state.users.get(e.actor).profile),enabled:state.users.get(e.actor).enabled};
  if(!u||u.enabled===false||u.name!==e.actorName)throw err('INVALID_OPERATIONAL_ACTOR');
  if(e.kind==='balance'){
   const d=normalizeBalance(e.data,c);if(!canBalance(u)||!permitted(u,c.stores.get(d.store)))throw err('FORBIDDEN',403);
   state.balances.push({id:e.id,at:e.at,author:e.actorName,...d});
  }else if(e.kind==='targets'){
   const d=normalizeTargets(e.data,c);if(!canTarget(u)||!permitted(u,c.stores.get(d.store)))throw err('FORBIDDEN',403);
   const existing=state.targets.get(d.store)||{};for(const [id,v] of Object.entries(d.items)){if(v===null)delete existing[id];else existing[id]=v}state.targets.set(d.store,existing);
  }else throw err('INVALID_OPERATIONAL_KIND');
 }
 state.events.set(e.id,json);
}
function decodeRows(rows,c,adminName){
 if(JSON.stringify(rows[0])!==JSON.stringify(HEAD))throw err('INVALID_OPERATIONAL_HEADER',503);
 const s=empty();
 for(const row of rows.slice(1)){
  if(!row.length)continue;
  if(row.length!==4||typeof row[3]!=='string'||row[3].length>48000||digest(row[3])!==row[2])throw err('OPERATIONAL_INTEGRITY_ERROR',503);
  const e=JSON.parse(row[3]);if(row[0]!==e.id||row[1]!==e.at)throw err('OPERATIONAL_INTEGRITY_ERROR',503);
  applyEvent(s,e,c,adminName);
 }return s;
}
function createStore({id,excludedIds,catalog,adminName,token,fetchFn=fetch,log=console.log}){
 let state=empty(),ready=false,loadedAt=0,queue=Promise.resolve(),health={configured:!!id,status:'pending'};
 const exclusive=fn=>{const p=queue.then(fn);queue=p.catch(()=>{});return p};
 const request=async()=>{if(!goodId(id)||excludedIds.has(id))throw err('INVALID_OPERATIONAL_DESTINATION',503);const bearer=await token(),base='https://sheets.googleapis.com/v4/spreadsheets/'+encodeURIComponent(id);return async(suffix,method='GET',body)=>{const r=await fetchFn(base+suffix,{method,headers:{Authorization:'Bearer '+bearer,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(25000),redirect:'error'});if(!r.ok)throw err('OPERATIONAL_HTTP_'+r.status,503);return r.json()}};
 const range=encodeURIComponent("'Operacional'!A1:D");
 async function load(force=false){
  if(ready&&!force&&Date.now()-loadedAt<10000)return state;
  try{
   const get=await request();
   if(!ready){const meta=await get('?fields=properties(title),sheets(properties(title))');if(norm(meta.properties?.title)!=='prime - historico americanas')throw err('INVALID_OPERATIONAL_DESTINATION',503);if(!meta.sheets?.some(s=>s.properties?.title==='Operacional'))await get(':batchUpdate','POST',{requests:[{addSheet:{properties:{title:'Operacional'}}}]})}
   let rows=(await get('/values/'+range+'?valueRenderOption=UNFORMATTED_VALUE')).values||[];
   if(!rows.length){await get('/values/'+encodeURIComponent("'Operacional'!A1:D1")+'?valueInputOption=RAW','PUT',{values:[HEAD]});rows=[HEAD]}
   state=decodeRows(rows,catalog,adminName);ready=true;loadedAt=Date.now();health={configured:true,status:'ok',lastSuccess:new Date().toISOString(),balances:state.balances.length,accounts:[...state.users.values()].filter(u=>u.enabled).length};
   return state;
  }catch(e){ready=false;health={configured:!!id,status:'unavailable',error:/^[A-Z_0-9]+$/.test(e.message)?e.message:'OPERATIONAL_READ_FAILED'};throw err(health.error,503)}
 }
 function principal(s,claims){if(claims?.username===adminName&&claims.version==='admin')return {username:adminName,name:'Administrador',role:'admin'};const account=s.users.get(claims?.username);if(!account?.enabled||account.version!==claims.version)return null;return {username:account.username,...profiles(catalog).get(account.profile)}}
 async function append(e){
  const json=JSON.stringify(e);if(json.length>48000)throw err('OPERATIONAL_EVENT_TOO_LARGE');
  const get=await request();
  try{const r=await get('/values/'+range+':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS','POST',{values:[[e.id,e.at,digest(json),json]]});if(r.updates?.updatedRows!==1)throw err('OPERATIONAL_WRITE_UNCONFIRMED',503);await load(true);if(state.events.get(e.id)!==json)throw err('OPERATIONAL_WRITE_UNCONFIRMED',503)}
  catch(e){ready=false;throw err('OPERATIONAL_WRITE_UNCONFIRMED',503)}
 }
 const publicUser=u=>({username:u.username,profile:u.profile,enabled:u.enabled});
 async function getState(claims){return exclusive(async()=>{const s=await load(),u=principal(s,claims);if(!u)throw err('AUTH_REQUIRED',401);const stores=[...catalog.stores.values()].filter(l=>permitted(u,l));const ids=new Set(stores.map(l=>l.id)),balances=s.balances.filter(v=>ids.has(v.store));const latest={};for(const b of balances){const m=latest[b.store]??={};for(const [id,v] of Object.entries(b.items))m[id]={...v,at:b.at,author:b.author}}return {user:u,canBalance:canBalance(u),canTarget:canTarget(u),stores,products:[...catalog.products.values()],latest,balances:balances.slice(-500).reverse(),targets:Object.fromEntries([...s.targets].filter(([id])=>ids.has(id))),...(u.role==='admin'?{users:[...s.users.values()].map(publicUser),profiles:[...profiles(catalog).values()]}:{})}})}
 async function authenticate(username,password){
  return exclusive(async()=>{const s=await load(),a=s.users.get(username);
   const salt=a?.salt||'0'.repeat(32),expected=a?.hash||'0'.repeat(64);
   const actual=crypto.scryptSync(password,salt,32).toString('hex');
   if(!a?.enabled||!crypto.timingSafeEqual(Buffer.from(actual,'hex'),Buffer.from(expected,'hex')))return null;
   return {username,version:a.version};
  });
 }
 async function mutate(claims,input){return exclusive(async()=>{
  const s=await load(true),u=principal(s,claims);if(!u)throw err('AUTH_REQUIRED',401);if(!uuid(input?.id))throw err('INVALID_REQUEST_ID');
  const old=s.events.get(input.id);
  if(old){const e=JSON.parse(old);if(e.actor!==u.username||e.kind!==input.kind)throw err('OPERATIONAL_EVENT_CONFLICT',409);if(e.kind==='balance'||e.kind==='targets'){const d=e.kind==='balance'?normalizeBalance(input.data,catalog):normalizeTargets(input.data,catalog);if(JSON.stringify(d)!==JSON.stringify(e.data))throw err('OPERATIONAL_EVENT_CONFLICT',409)}else throw err('ACCOUNT_REQUEST_ALREADY_RECORDED',409);return {ok:true,duplicate:true,id:e.id,at:e.at}}
  let data;
  if(input.kind==='balance'){data=normalizeBalance(input.data,catalog);if(!canBalance(u)||!permitted(u,catalog.stores.get(data.store)))throw err('FORBIDDEN',403)}
  else if(input.kind==='targets'){data=normalizeTargets(input.data,catalog);if(!canTarget(u)||!permitted(u,catalog.stores.get(data.store)))throw err('FORBIDDEN',403)}
  else if(input.kind==='account'){
   if(u.role!=='admin')throw err('FORBIDDEN',403);
   const d=input.data||{},username=String(d.username??'').trim().toLowerCase(),prior=s.users.get(username);
   if(typeof d.enabled!=='boolean')throw err('INVALID_ACCOUNT');
   let salt,hash;
   if(d.password){if(typeof d.password!=='string'||d.password.length<12||d.password.length>128)throw err('PASSWORD_LENGTH');salt=crypto.randomBytes(16).toString('hex');hash=crypto.scryptSync(d.password,salt,32).toString('hex')}
   else{if(!prior||d.enabled&&prior.profile!==d.profile)throw err('PASSWORD_REQUIRED');salt=prior.salt;hash=prior.hash}
   data=normalizeAccount({username,profile:d.profile,enabled:d.enabled,version:crypto.randomUUID(),salt,hash},catalog,adminName);
   if(data.enabled&&[...s.users.values()].some(v=>v.enabled&&v.profile===data.profile&&v.username!==username))throw err('PROFILE_ALREADY_ASSIGNED',409);
  }else throw err('INVALID_OPERATIONAL_KIND');
  const e={id:input.id,at:new Date().toISOString(),actor:u.username,actorName:u.name,kind:input.kind,data};
  await append(e);return {ok:true,id:e.id,at:e.at};
 })}

 // One-time provisioning from private deployment configuration; never reset existing accounts.
 async function provision(password,rotate=false){
  if(!password)return;
  if(typeof password!=='string'||password.length<12||password.length>128)throw err('PASSWORD_LENGTH');
  const s=await load(true),list=[...profiles(catalog).keys()].sort(),names=new Set();
  const planned=list.map(profile=>({profile,username:norm(profile).replace(/\s+/g,'.')}));
  if(planned.length!==24||planned.some(x=>!(/^[a-z0-9._-]{3,64}$/.test(x.username))||x.username===adminName||names.has(x.username)||!names.add(x.username)))throw err('INVALID_PROVISIONING_PROFILES');
  const events=[];let existing=0;
  if(rotate&&planned.some(({username,profile})=>s.users.get(username)?.profile!==profile||!s.users.get(username)?.enabled))throw err('ROTATION_ACCOUNT_MISMATCH',409);
  for(const {profile,username} of planned){
   const prior=s.users.get(username);
   if(prior){if(prior.profile!==profile)throw err('PROVISIONING_CONFLICT',409);existing++;if(!rotate||crypto.timingSafeEqual(Buffer.from(prior.hash,'hex'),crypto.scryptSync(password,prior.salt,32)))continue}
   if(!prior&&[...s.users.values()].some(v=>v.profile===profile))throw err('PROVISIONING_CONFLICT',409);
   const salt=crypto.randomBytes(16).toString('hex');
   const data=normalizeAccount({username,profile,enabled:true,version:crypto.randomUUID(),salt,hash:crypto.scryptSync(password,salt,32).toString('hex')},catalog,adminName);
   events.push({id:crypto.randomUUID(),at:new Date().toISOString(),actor:adminName,actorName:'Administrador',kind:'account',data});
  }
  if(events.length){
   const rows=events.map(e=>{const json=JSON.stringify(e);return [e.id,e.at,digest(json),json]});
   const get=await request();
   try{const r=await get('/values/'+range+':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS','POST',{values:rows});if(r.updates?.updatedRows!==rows.length)throw err('OPERATIONAL_WRITE_UNCONFIRMED',503)}catch{ready=false;throw err('OPERATIONAL_WRITE_UNCONFIRMED',503)}
  }
  const verified=await load(true);
  const checked=planned.filter(({username,profile})=>{const a=verified.users.get(username);return a?.enabled&&a.profile===profile&&crypto.timingSafeEqual(Buffer.from(a.hash,'hex'),crypto.scryptSync(password,a.salt,32))});
  log((rotate?'[operations-rotation] ':'[operations-provision] ')+JSON.stringify({status:checked.length===planned.length?'ok':'existing_accounts_not_changed',changed:events.length,existing,verified:checked.length,total:planned.length}));
 }

 return {init:()=>exclusive(async()=>{try{await load();if(process.env.PRIME_ROTATE_PASSWORD)await provision(process.env.PRIME_ROTATE_PASSWORD,true);else if(process.env.PRIME_PROVISION_PASSWORD)await provision(process.env.PRIME_PROVISION_PASSWORD);log('[operations] '+JSON.stringify({status:'ok',balances:state.balances.length,accounts:health.accounts}))}catch(e){log('[operations] '+JSON.stringify({status:'unavailable',code:e.message}))}}),getState,authenticate,mutate,health:()=>health};
}
module.exports={catalogFromSeed,profiles,permitted,canBalance,canTarget,normalizeBalance,normalizeTargets,decodeRows,applyEvent,createStore};

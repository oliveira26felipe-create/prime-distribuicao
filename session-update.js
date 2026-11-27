(()=>{
'use strict';
const finalMode=location.pathname==='/final';
const PROFILE=finalMode?'prime.final.profile.v1':'prime.preview.profile.v1',STATE=finalMode?'prime.final.reload.v1':'prime.preview.reload.v1';
const read=k=>{try{return JSON.parse(sessionStorage.getItem(k)||'null')}catch{return null}};
const write=(k,v)=>{try{sessionStorage.setItem(k,JSON.stringify(v));return true}catch{return false}};
const clear=k=>{try{sessionStorage.removeItem(k)}catch{}};
const name=()=>session?.u==='admin'||session?.role==='Administrador'?'admin':session?.name;
const validName=n=>['admin','Leonir','Leonardo','Wander'].includes(n)||db.lojas.some(l=>l.promotor===n);
const origEnter=enterDemo,origLogout=logout;
enterDemo=function(n){origEnter(n);if(session){write(PROFILE,{name:n});const b=document.getElementById('logout');if(b)b.textContent=finalMode?'Trocar perfil':'Trocar perfil de teste';}};
logout=function(){clear(PROFILE);clear(STATE);origLogout();};
const freshLogin=new URLSearchParams(location.search).get('login')==='1';
if(freshLogin){clear(PROFILE);clear(STATE);history.replaceState(null,'',finalMode?'/final':'/');}
const previous=read(STATE);clear(STATE);
const importRevision=JSON.stringify(window.PRIME_COMMERCIAL_IMPORT||null);
const stored=read(PROFILE);
if(previous&&previous.expires>Date.now()&&previous.name===stored?.name&&validName(previous.name)){
  if(previous.changes&&typeof previous.changes==='object')for(const k of ['visitas','metasCaixas','vendas','mesesVendas','metasComerciais'])if(Object.hasOwn(previous.changes,k))db[k]=previous.changes[k];
  const commercial=window.PRIME_COMMERCIAL_IMPORT;for(const [month,source] of Object.entries(commercial?.months||(commercial?{[commercial.month]:commercial}:{})))if(source?.rows)db.metasComerciais[month]=Object.fromEntries(source.rows.map(([id,meta])=>[id,meta]));
  enterDemo(previous.name);
  filial=typeof previous.filial==='string'?previous.filial:'';
  dashboardStore=previous.dashboardStore||'';
  store=allowed().some(l=>l.id===previous.store)?previous.store:'';
  if(/^\d{4}-\d{2}$/.test(previous.salesMonth||''))salesMonth=previous.salesMonth;
  page=previous.page||'painel';query=typeof previous.query==='string'?previous.query:'';render();if(query)filterRows();
}else if(stored&&validName(stored.name)){enterDemo(stored.name);}else{enterDemo('admin');}
const initialVersion=document.querySelector('meta[name="prime-release"]')?.content;
let pending=false,checking=false,reloading=false,authExpired=false;
const notice=document.createElement('div');
notice.setAttribute('role','status');notice.style.cssText='position:fixed;right:12px;top:12px;max-width:min(380px,calc(100% - 24px));z-index:9999;background:#21364f;color:#fff;border:1px solid #617fa4;border-radius:10px;padding:12px;font:14px Arial;box-shadow:0 4px 18px #0005';notice.hidden=true;document.body.append(notice);
const msg=t=>{notice.textContent=t;notice.hidden=false};

const DRAFT=finalMode?'prime.final.balanceDraft.v2':'prime.preview.balanceDraft.v2';
const savedDrafts=()=>read(DRAFT)||{};
function captureDraft(){
 if(!session||page!=='balanco'||!store)return true;
 const n=name(),all=savedDrafts(),expiry=window.primeExpiryDraftGet?.()||{},obs=document.getElementById('obs')?.value||'';
 const has=Object.values(draft).some(v=>v!=='')||obs||Object.values(expiry).some(rows=>rows.some(r=>r.date||r.qty!==''));
 if(has)all[n]={store,filial,qty:{...draft},expiry,obs,at:Date.now()};
 else if(all[n]?.store===store)delete all[n];
 return write(DRAFT,all);
}
function restoreDraft(){
 if(!session)return;
 const n=name(),saved=savedDrafts()[n];
 if(!saved||!db.lojas.some(l=>l.id===saved.store)||!saved.qty)return;
 const oldFilial=filial;filial=saved.filial||'';
 if(!allowed().some(l=>l.id===saved.store)){filial=oldFilial;return}
 store=saved.store;page='balanco';query='';draft={...saved.qty};window.primeExpiryDraftSet?.(saved.expiry);render();
 const obs=document.getElementById('obs');if(obs)obs.value=saved.obs||'';
}
window.addEventListener('pagehide',captureDraft);
document.addEventListener('input',()=>{if(!captureDraft())msg('Não foi possível guardar o rascunho neste navegador. Não feche a página.');});
document.addEventListener('click',()=>setTimeout(captureDraft,0));
const finishBeforeDraft=finish;finish=function(){const n=name(),id=store,len=db.visitas.length;finishBeforeDraft();if(db.visitas.length>len){const all=savedDrafts();if(all[n]?.store===id){delete all[n];write(DRAFT,all)}}};

if(!previous)restoreDraft();
const end=document.createElement('a');end.href=finalMode?'/sair-previa?modo=final':'/sair-previa';end.textContent='Sair da conta';end.style.cssText='display:block;text-align:center;padding:12px;font:13px Arial;color:#a9c8ff';end.addEventListener('click',e=>{if(page==='balanco'&&store&&busy()&&!confirm('Sair e descartar o rascunho desta sessão?')){e.preventDefault();return}clear(PROFILE);clear(STATE);clear(DRAFT)});document.body.append(end);
function busy(){if(!session)return false;if(['painel','metas','oportunidades','estoqueprime','integracoes'].includes(page))return false;if(['importar','sugestao'].includes(page))return true;if(page==='balanco'&&store){return Object.values(draft).some(v=>v!=='')||!!document.getElementById('obs')?.value||Array.from(document.querySelectorAll('.exp-row input')).some(e=>e.value!=='' )||!!document.querySelector('.exp-row input:focus')}return !!document.activeElement?.matches('input:not([type=button]),textarea,select,[contenteditable=true]');}
function refresh(){if(authExpired||!pending||reloading||document.visibilityState!=='visible')return;if(busy()){msg('Dados novos disponíveis. Atualização automática ao concluir ou sair da tela de edição.');return;}
 if(session){const n=name();if(!write(PROFILE,{name:n})||!write(STATE,{expires:Date.now()+120000,importRevision,name:n,page,store,filial,dashboardStore,salesMonth,query,changes:Object.fromEntries(['visitas','metasCaixas','vendas','mesesVendas','metasComerciais'].filter(k=>Object.hasOwn(db,k)).map(k=>[k,db[k]]))})){msg('Nova versão disponível. Não foi possível preservar os dados temporários deste teste. Atualize a página quando terminar.');return;}}
 reloading=true;msg('Atualizando a Prime…');location.reload();}
async function check(){if(checking||reloading||!initialVersion||document.visibilityState!=='visible')return;checking=true;try{const response=await fetch('/versao',{cache:'no-store',credentials:'same-origin'});if(response.status===401){authExpired=true;captureDraft();msg('Sessão expirada. O rascunho foi mantido nesta aba quando possível. Recarregue e entre novamente antes de continuar.');return}if(!response.ok){msg('Não foi possível consultar o servidor; mantenha a página aberta e tente novamente.');return}if(authExpired){authExpired=false;notice.hidden=true}const data=await response.json();window.primeUpdateStock?.(data.stock);window.primeUpdateHealth?.(data.health);if(typeof data.version==='string'&&data.version!==initialVersion){pending=true;refresh();}}catch{captureDraft();msg('Conexão indisponível. Os dados exibidos podem estar desatualizados.')}finally{checking=false}}
setInterval(check,30000);setInterval(()=>{if(pending)refresh()},2000);document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')check()});window.addEventListener('focus',check);check();
})();
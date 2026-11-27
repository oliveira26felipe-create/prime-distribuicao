(()=>{
'use strict';
const initial=window.PRIME_OPERATIONAL;
if(!initial?.user){location.replace('/operacional');return}
let state=initial,auth=true,pending=null,saving=false,checking=false,reloading=false,activeRequest=null;
const me=initial.user,roleLabel={admin:'Administrador',chief:'Coordenador',coordinator:'Coordenador',promoter:'Promotor'};
const key='prime.real.draft.v3.'+me.username,navKey='prime.real.nav.v3.'+me.username;
const read=k=>{try{return JSON.parse(sessionStorage.getItem(k)||'null')}catch{return null}};
const write=(k,v)=>{try{if(v===null)sessionStorage.removeItem(k);else sessionStorage.setItem(k,JSON.stringify(v));return true}catch{return false}};
const notice=document.createElement('div');notice.setAttribute('role','status');notice.style.cssText='position:fixed;right:12px;top:12px;max-width:min(420px,calc(100% - 24px));z-index:9999;background:#21364f;color:#fff;border:1px solid #617fa4;border-radius:10px;padding:12px;font:14px Arial;box-shadow:0 4px 18px #0005';notice.hidden=true;document.body.append(notice);
const msg=t=>{notice.textContent=t;notice.hidden=false};
const status=(id,t)=>{const node=$(id);if(node)node.textContent=t;else msg(t)};
const localDate=t=>new Date(t).toLocaleString('pt-BR',{timeZone:'America/Bahia'});
function hydrate(v){
 state=v;db.visitas=v.balances.slice().reverse().map(b=>({id:b.id,loja:b.store,data:localDate(b.at),unidade:'caixas',q:Object.fromEntries(Object.entries(b.items).map(([id,x])=>[id,x.qty])),validades:Object.fromEntries(Object.entries(b.items).map(([id,x])=>[id,x.lots])),obs:b.note,autor:b.author}));
 db.metasCaixas=v.targets||{};
}
hydrate(initial);
session={name:me.name,u:me.role==='chief'?'leonir':me.username,role:roleLabel[me.role]};
$('identity').textContent=me.name+' • '+(me.role==='chief'?'Chefe dos coordenadores':roleLabel[me.role]);
$('logout').hidden=false;$('logout').textContent='Sair';
let saved=read(key);
const defaultPage=me.role==='promoter'&&matchMedia('(max-width:740px)').matches?'balanco':'painel';
const nav=read(navKey);write(navKey,null);
page=nav?.page||defaultPage;filial=nav?.filial||'';dashboardStore=nav?.dashboardStore||'';salesMonth=/^\d{4}-\d{2}$/.test(nav?.salesMonth||'')?nav.salesMonth:initial.commercial.month;store=allowed().some(l=>l.id===nav?.store)?nav.store:'';
if(saved&&initial.canBalance&&db.lojas.some(l=>l.id===saved.store)){filial=saved.filial||'';store=saved.store;page='balanco';draft={...saved.qty};window.primeExpiryDraftSet?.(saved.expiry);activeRequest=saved.request||null}else saved=null;
function capture(){
 if(page!=='balanco'||!store)return true;
 const expiry=window.primeExpiryDraftGet?.()||{},obs=$('obs')?.value??saved?.obs??'';
 const has=activeRequest||Object.values(draft).some(v=>v!=='')||obs||Object.values(expiry).some(a=>a.some(r=>r.date||r.qty!==''));
 if(!has){saved=null;return write(key,null)}
 saved={store,filial,qty:{...draft},expiry,obs,request:activeRequest};
 const ok=write(key,saved);if(!ok)msg('Rascunho não pôde ser protegido nesta aba. Não feche a página.');return ok;
}
function hasDraft(){return !!(activeRequest||(page==='balanco'&&store&&(Object.values(draft).some(v=>v!=='')||$('obs')?.value||Object.values(window.primeExpiryDraftGet?.()||{}).some(a=>a.some(r=>r.date||r.qty!=='')))))}
function resetDraft(){saved=null;activeRequest=null;write(key,null);draft={};window.primeExpiryDraftSet?.({})}
function beforeLeave(){if(saving)return false;if(activeRequest){msg('Existe um envio sem confirmação. Finalize o balanço novamente antes de sair desta tela.');return false}if(hasDraft()&&!confirm('Sair desta contagem e descartar o rascunho?'))return false;resetDraft();return true}
const originalGo=go;go=function(p){if(saving)return;if(p!==page&&page==='balanco'&&!beforeLeave())return;if(p==='importar')p='metas';originalGo(p)};
window.primeSelectStore=function(id){if(saving||!beforeLeave()){render();return}store=allowed().some(l=>l.id===id)?id:'';order={};render()};
window.primeSelectBranch=function(id){if(saving||!beforeLeave()){render();return}filial=id;store='';dashboardStore='';order={};render()};
enterDemo=function(){msg('Use o login individual da plataforma.')};loginScreen=function(){location.replace('/operacional')};
logout=function(){if(!beforeLeave())return;location.assign('/operacional/logout')};
const errors={AUTH_REQUIRED:'Sessão expirada. Reabra a plataforma e entre novamente; o rascunho permanece nesta aba.',FORBIDDEN:'Permissão insuficiente.',OPERATIONAL_WRITE_UNCONFIRMED:'Gravação não confirmada. Repita o envio sem alterar o rascunho.',EXPIRY_EXCEEDS_BALANCE:'A quantidade de lotes ultrapassa o balanço.',INVALID_EXPIRY:'Validade ou quantidade inválida.',INVALID_BALANCE_ITEM:'Quantidade inválida.',PASSWORD_LENGTH:'Senha precisa ter de 12 a 128 caracteres.',PROFILE_ALREADY_ASSIGNED:'Perfil já possui uma conta ativa.',PASSWORD_REQUIRED:'Informe uma senha para criar ou trocar o perfil.'};
const explain=e=>errors[e.message]||'Não foi possível concluir: '+e.message;
async function api(method='GET',body=null,path='/operacional/api'){
 const r=await fetch(path,{method,credentials:'same-origin',cache:'no-store',...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
 if(r.status===401){auth=false;capture();msg(errors.AUTH_REQUIRED);throw Error('AUTH_REQUIRED')}
 let v;try{v=await r.json()}catch{throw Error('OPERATIONAL_UNAVAILABLE')}
 if(!r.ok)throw Error(v.error||'HTTP_'+r.status);return v
}
const definite=new Set(['INVALID_BALANCE','INVALID_BALANCE_ITEMS','INVALID_BALANCE_ITEM','INVALID_EXPIRY','EXPIRY_EXCEEDS_BALANCE','INVALID_BALANCE_NOTE','FORBIDDEN','INVALID_REQUEST_ID']);
finish=async function(){
 if(!initial.canBalance||!allowed().some(l=>l.id===store)||page!=='balanco'||saving||!auth)return;
 if(!activeRequest){
  const exp=window.primeExpiryDraftGet?.()||{},items={};
  for(const [id,value] of Object.entries(draft)){if(value==='')continue;const q=Number(value);if(!Number.isSafeInteger(q)||q<0||q>1000000)return status('balanceStatus','Informe caixas inteiras entre 0 e 1.000.000.');items[id]={qty:q,lots:[]}}
  for(const [id,rows] of Object.entries(exp)){const r=rows.filter(x=>x.date||x.qty!=='');if(!r.length)continue;if(!items[id])return status('balanceStatus','Informe caixas contadas antes de incluir validades: '+id);items[id].lots=r.map(x=>({date:x.date,qty:Number(x.qty)}));if(items[id].lots.some(x=>!x.date||!Number.isSafeInteger(x.qty)||x.qty<=0)||items[id].lots.reduce((s,x)=>s+x.qty,0)>items[id].qty)return status('balanceStatus','Confira as validades e caixas do produto '+id+'.')}
  if(!Object.keys(items).length)return status('balanceStatus','Informe pelo menos um produto.');
  if(!confirm('Gravar o balanço real desta loja?'))return;
  activeRequest={id:crypto.randomUUID(),kind:'balance',data:{store,items,note:$('obs')?.value||''}};
  if(!capture()){activeRequest=null;return}
 }
 saving=true;status('balanceStatus','Confirmando gravação no servidor…');lockBalance();
 try{
  const r=await api('POST',activeRequest);if(!r.ok)throw Error('OPERATIONAL_WRITE_UNCONFIRMED');
  resetDraft();page='historico';try{hydrate(await api());render();msg('Balanço confirmado em '+localDate(r.at)+'.')}catch{msg('Balanço gravado. Recarregue para atualizar o histórico.')}
 }catch(e){if(definite.has(e.message)){activeRequest=null;capture()}status('balanceStatus',explain(e));}finally{saving=false;lockBalance()}
};
function lockBalance(){if(page!=='balanco')return;const locked=saving||!!activeRequest;document.querySelectorAll('.balance-area input,.balance-area .qty-step,.balance-area .exp-add,.balance-area .exp-remove').forEach(e=>e.disabled=locked);const b=document.querySelector('.balance-actions button');if(b){b.disabled=saving||!auth;b.textContent=activeRequest?'Confirmar envio novamente':'Finalizar balanço'}}
async function targets(items){
 if(!auth||saving||!initial.canTarget||!allowed().some(l=>l.id===store))return;
 const id=store;saving=true;status('suggestMessage','Salvando metas…');
 try{await api('POST',{id:crypto.randomUUID(),kind:'targets',data:{store:id,items}});hydrate(await api());if(page==='sugestao'&&store===id){render();status('suggestMessage','Metas confirmadas no servidor.')}}catch(e){status('suggestMessage',explain(e))}finally{saving=false}
}
updateTarget=function(i,input){const p=db.produtos[i],v=input.value;if(!p||input.validity.badInput||v!==''&&(!validBox(v)||Number(v)>1000000))return status('suggestMessage','Informe uma quantidade inteira válida.');targets({[p.id]:v===''?null:Number(v)})};
applyBulkTarget=function(){const v=$('bulkTarget')?.value;if(!validBox(v)||Number(v)>1000000)return status('suggestMessage','Informe uma meta inteira válida.');const items=Object.fromEntries(db.produtos.filter(p=>targetFor(store,p.id)===null).map(p=>[p.id,Number(v)]));if(Object.keys(items).length)targets(items)};
exportSuggestion=function(){status('suggestMessage','Exportação operacional bloqueada até validar pedidos pendentes e preços atuais.')};
const originalSuggestion=suggestionPanel;
suggestionPanel=function(a,picker,search,table){return originalSuggestion(a,picker,search,table).replace('Exportar Excel — modelo Americanas','Exportação — aguardando fontes').replace('O Excel usa os preços históricos das planilhas da filial 08 (inclusive preços zerados); confirme os preços de cada filial. A exportação mantém o layout original e inclui os dois produtos novos.','A exportação real está bloqueada até a confirmação de pedidos pendentes e preços atualizados. A sugestão atual é necessidade bruta.')};
userPanel=function(){
 if(me.role!=='admin')return '';
 const users=state.users||[],profiles=state.profiles||[],roleText={chief:'Chefe dos coordenadores',coordinator:'Coordenador',promoter:'Promotor'};
 return '<h1>Usuários e permissões</h1><section><p>Contas individuais ativas e inativas. Alterações de senha invalidam sessões anteriores.</p><div class="scroll"><table><thead><tr><th>Usuário</th><th>Perfil</th><th>Situação</th></tr></thead><tbody>'+users.map(u=>'<tr><td>'+esc(u.username)+'</td><td>'+esc(u.profile)+'</td><td>'+(u.enabled?'Ativo':'Inativo')+'</td></tr>').join('')+'</tbody></table></div></section><section><h2>Cadastrar / alterar conta</h2><form id="primeAccountForm"><div class="bar"><label>Usuário <input name="username" required minlength="3" maxlength="64"></label><label>Perfil <select name="profile" required>'+profiles.map(p=>'<option value="'+esc(p.name)+'">'+esc(p.name+' — '+roleText[p.role])+'</option>').join('')+'</select></label><label>Nova senha <input name="password" type="password" autocomplete="new-password" minlength="12" maxlength="128"></label><label>Situação <select name="enabled"><option value="yes">Ativa</option><option value="no">Inativa</option></select></label></div><button class="red" type="submit">Salvar conta</button></form><p id="accountStatus" role="status"></p></section>';
};
bindUsers=function(){const f=$('primeAccountForm');if(!f)return;f.onsubmit=async e=>{e.preventDefault();if(saving||!auth)return;const x=new FormData(f);saving=true;status('accountStatus','Salvando conta…');try{await api('POST',{id:crypto.randomUUID(),kind:'account',data:{username:x.get('username'),profile:x.get('profile'),password:x.get('password'),enabled:x.get('enabled')==='yes'}});hydrate(await api());render();status('accountStatus','Conta confirmada no servidor.')}catch(e){status('accountStatus',explain(e))}finally{saving=false}}};
const baseGoalPanel=goalAdminPanel;goalAdminPanel=function(...args){return baseGoalPanel(...args).replace(/<details class="goal-table">[\s\S]*?<\/details>/,'')};
window.primeSyncNow=async function(){if(me.role!=='admin'||saving||!auth)return;try{status('primeSyncFeedback','Consultando fontes…');const v=await api('POST',{},'/operacional/sync');window.primeUpdateHealth?.(v.health);window.primeUpdateStock?.({branches:v.stock});msg('Sincronização concluída.');pending=v}catch(e){msg(explain(e))}};
const baseRender=render;render=function(){baseRender();if(page==='balanco'&&saved?.store===store){const obs=$('obs');if(obs)obs.value=saved.obs||''}lockBalance();const b=$('logout');if(b)b.textContent='Sair'};
window.addEventListener('pagehide',capture);document.addEventListener('input',e=>{if(page==='balanco'&&e.target.closest('.balance-area'))capture()});document.addEventListener('click',()=>{if(page==='balanco')setTimeout(capture,0)});
function rememberNav(){return write(navKey,{page,store,filial,dashboardStore,salesMonth})}
function reload(){if(reloading||saving||hasDraft()||['sugestao','usuarios'].includes(page))return;rememberNav();reloading=true;location.reload()}
async function check(){if(checking||saving||!auth||reloading||document.visibilityState!=='visible')return;checking=true;try{const v=await api();window.primeUpdateHealth?.(v.health);window.primeUpdateStock?.({branches:v.stock});if(v.version!==initial.version){pending=v;if(!hasDraft()&&!['sugestao','usuarios'].includes(page))reload();else msg('Dados novos disponíveis. Atualize após concluir a edição.')}}catch(e){if(e.message!=='AUTH_REQUIRED')msg('Conexão indisponível. Os dados exibidos podem estar desatualizados.')}finally{checking=false}}
setInterval(check,30000);document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')check()});
render();if(activeRequest)status('balanceStatus','Há um envio sem confirmação. Finalize novamente para confirmar.');
})();

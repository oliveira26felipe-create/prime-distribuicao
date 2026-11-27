(()=>{
'use strict';
const initial=window.PRIME_OPERATIONAL;
if(!initial?.user){location.replace('/operacional');return}
let state=initial,auth=true,pending=null,saving=false,checking=false,reloading=false,activeRequest=null,historyOffset=0;
const me=initial.user,roleLabel={admin:'Administrador',chief:'Coordenador',coordinator:'Coordenador',promoter:'Promotor'};
const key='prime.real.draft.v3.'+me.username,navKey='prime.real.nav.v3.'+me.username,targetKey='prime.real.targets.v1.'+me.username;
const read=k=>{try{return JSON.parse(sessionStorage.getItem(k)||'null')}catch{return null}};
const write=(k,v)=>{try{if(v===null)sessionStorage.removeItem(k);else sessionStorage.setItem(k,JSON.stringify(v));return true}catch{return false}};
const persistentRead=k=>{try{return JSON.parse(localStorage.getItem(k)||'null')}catch{return null}};
const persistentWrite=(k,v)=>{try{if(v===null)localStorage.removeItem(k);else localStorage.setItem(k,JSON.stringify(v));return true}catch{return false}};
const notice=document.createElement('div');notice.setAttribute('role','status');notice.style.cssText='position:fixed;right:12px;top:12px;max-width:min(420px,calc(100% - 24px));z-index:9999;background:#21364f;color:#fff;border:1px solid #617fa4;border-radius:10px;padding:12px;font:14px Arial;box-shadow:0 4px 18px #0005';notice.hidden=true;document.body.append(notice);
const msg=t=>{notice.textContent=t;notice.hidden=false};
const status=(id,t)=>{const node=$(id);if(node)node.textContent=t;else msg(t)};
const localDate=t=>new Date(t).toLocaleString('pt-BR',{timeZone:'America/Bahia'});
const toVisit=b=>({id:b.id,loja:b.store,data:localDate(b.at),unidade:'caixas',q:Object.fromEntries(Object.entries(b.items).map(([id,x])=>[id,x.qty])),validades:Object.fromEntries(Object.entries(b.items).map(([id,x])=>[id,x.lots])),obs:b.note,autor:b.author,cancelled:b.cancelled});
function hydrate(v){
 state=v;historyOffset=0;db.visitas=v.balances.slice().reverse().map(toVisit);
 db.metasCaixas=JSON.parse(JSON.stringify(v.targets||{}));
}
last=function(id){
 const items=state.latest?.[id];if(!items||!Object.keys(items).length)return undefined;
 const latestAt=Object.values(items).map(x=>x.at).sort().at(-1);
 return {loja:id,data:localDate(latestAt),unidade:'caixas',q:Object.fromEntries(Object.entries(items).map(([k,x])=>[k,x.qty])),validades:Object.fromEntries(Object.entries(items).map(([k,x])=>[k,x.lots])),positions:Object.fromEntries(Object.entries(items).map(([k,x])=>[k,localDate(x.at)]))};
};
hydrate(initial);
session={name:me.name,u:me.role==='chief'?'leonir':me.username,role:roleLabel[me.role]};
$('identity').textContent=me.name+' • '+(me.role==='chief'?'Chefe dos coordenadores':roleLabel[me.role]);
$('logout').hidden=false;$('logout').textContent='Sair';
let saved=persistentRead(key)||read(key);
const defaultPage=me.role==='promoter'&&matchMedia('(max-width:740px)').matches?'balanco':'painel';
const nav=read(navKey);write(navKey,null);
page=nav?.page||defaultPage;filial=nav?.filial||'';dashboardStore=nav?.dashboardStore||'';salesMonth=/^\d{4}-\d{2}$/.test(nav?.salesMonth||'')?nav.salesMonth:initial.commercial.month;store=allowed().some(l=>l.id===nav?.store)?nav.store:'';
if(saved&&initial.canBalance&&db.lojas.some(l=>l.id===saved.store)){filial=saved.filial||'';store=saved.store;page='balanco';draft={...saved.qty};window.primeExpiryDraftSet?.(saved.expiry);activeRequest=saved.request||null}else saved=null;
function capture(){
 if(page!=='balanco'||!store)return true;
 const expiry=window.primeExpiryDraftGet?.()||{},obs=$('obs')?.value??saved?.obs??'';
 const has=activeRequest||Object.values(draft).some(v=>v!=='')||obs||Object.values(expiry).some(a=>a.some(r=>r.date||r.qty!==''));
 if(!has){saved=null;write(key,null);return persistentWrite(key,null)}
 saved={store,filial,qty:{...draft},expiry,obs,request:activeRequest};
 const ok=persistentWrite(key,saved);if(ok)write(key,null);else write(key,saved);if(!ok)msg('Rascunho protegido somente nesta aba, quando possível. Não feche a página.');return ok;
}
function hasDraft(){return !!(activeRequest||(page==='balanco'&&store&&(Object.values(draft).some(v=>v!=='')||$('obs')?.value||Object.values(window.primeExpiryDraftGet?.()||{}).some(a=>a.some(r=>r.date||r.qty!=='')))))}
function resetDraft(){saved=null;activeRequest=null;write(key,null);persistentWrite(key,null);draft={};window.primeExpiryDraftSet?.({})}
function beforeLeave(){if(saving)return false;if(activeRequest){msg('Existe um envio sem confirmação. Finalize o balanço novamente antes de sair desta tela.');return false}if(hasDraft()&&!confirm('Sair desta contagem e descartar o rascunho?'))return false;resetDraft();return true}
const originalGo=go;go=function(p){if(saving)return;if(p!==page&&page==='balanco'&&!beforeLeave())return;if(p==='importar')p='metas';if(p==='historico'&&page!=='historico'){historyOffset=0;db.visitas=state.balances.slice().reverse().map(toVisit)}originalGo(p)};
window.primeSelectStore=function(id){if(saving||!beforeLeave()){render();return}store=allowed().some(l=>l.id===id)?id:'';order={};render()};
window.primeSelectBranch=function(id){if(saving||!beforeLeave()){render();return}filial=id;store='';dashboardStore='';order={};render()};
enterDemo=function(){msg('Use o login individual da plataforma.')};loginScreen=function(){location.replace('/operacional')};
logout=function(){if(saving)return;if(hasDraft()&&!capture())return;if(hasDraft()&&!confirm('Sair e manter o rascunho neste dispositivo para seu próximo acesso?'))return;location.assign('/operacional/logout')};
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
let targetQueue=persistentRead(targetKey)||[];
function overlayTargets(){for(const job of targetQueue){const m=db.metasCaixas[job.data.store]??={};for(const [id,val] of Object.entries(job.data.items)){if(val===null)delete m[id];else m[id]=val}}}
overlayTargets();
function targetNote(){if(!targetQueue.length)return '';return targetQueue.length+' alteração(ões) de metas aguardando confirmação.'}
let flushing=false;
async function flushTargets(){
 if(flushing||!auth||!initial.canTarget||!targetQueue.length)return;
 flushing=true;
 try{
  while(targetQueue.length){
   const job=targetQueue[0];await api('POST',job);targetQueue.shift();if(!persistentWrite(targetKey,targetQueue.length?targetQueue:null))throw Error('DRAFT_STORAGE_FAILED');
  }
  const v=await api();hydrate(v);overlayTargets();if(page==='sugestao'){refreshSuggestion();status('suggestMessage','Metas confirmadas no servidor.')}
 }catch(e){status('suggestMessage',targetNote()+' '+explain(e))}finally{flushing=false}
}
function targets(items){
 if(!auth||!initial.canTarget||!allowed().some(l=>l.id===store))return;
 const job={id:crypto.randomUUID(),kind:'targets',data:{store,items}},next=[...targetQueue,job];
 if(!persistentWrite(targetKey,next)){status('suggestMessage','Não foi possível proteger as metas. Nenhuma nova alteração enviada.');return}
 targetQueue=next;overlayTargets();refreshSuggestion();status('suggestMessage',targetNote());void flushTargets()
}
updateTarget=function(i,input){const p=db.produtos[i],v=input.value;if(!p||input.validity.badInput||v!==''&&(!validBox(v)||Number(v)>1000000))return status('suggestMessage','Informe uma quantidade inteira válida.');targets({[p.id]:v===''?null:Number(v)})};
applyBulkTarget=function(){const v=$('bulkTarget')?.value;if(!validBox(v)||Number(v)>1000000)return status('suggestMessage','Informe uma meta inteira válida.');const items=Object.fromEntries(db.produtos.filter(p=>targetFor(store,p.id)===null).map(p=>[p.id,Number(v)]));if(Object.keys(items).length){targets(items);render();status('suggestMessage',targetNote()||'Metas confirmadas.')}};
const rawRows=suggestionRows;
const unitKey='prime.order.quantity-unit.v1.'+me.username;
let orderUnit=persistentRead(unitKey)||'';
if(!['units','boxes'].includes(orderUnit))orderUnit='';
window.primeOrderUnit=function(value){
 if(!['units','boxes',''].includes(value))return;
 if(value&&!confirm('Confirma que QTVENDA do relatório Farol está em '+(value==='units'?'UNIDADES':'CAIXAS')+'? Esta escolha altera o cálculo das sugestões.')){render();return}
 orderUnit=value;persistentWrite(unitKey,value);render();
};
function storeOrders(id){const l=db.lojas.find(l=>l.id===id);return window.primeOrderModel.recent(state.commercial?.months,id,l?.filial)}
suggestionRows=function(id){
 const l=db.lojas.find(l=>l.id===id),supply=state.supply||{},valid=supply.status?.pending==='ok',priced=supply.status?.prices==='ok',orders=storeOrders(id);
 return rawRows(id).map(r=>{
  const units=valid?(supply.pending?.[id]?.[r.p.id]??0):null,price=priced?(supply.prices?.[String(l?.filial)]?.[r.p.id]??null):null;
  const calc=window.primeOrderModel.calculate({orders,product:r.p,manual:r.t,count:r.q,pending:units,stock:state.stock?.[String(l?.filial)],unit:orderUnit});
  return {...r,...calc,t:r.t,pendingUnits:units,price};
 });
};
const prevStatus=suggestStatus;
suggestStatus=function(r){if(r.q===null)return 'Não conferido';if(r.basis==='unknown')return 'Sem referência confirmada';if(r.s===null)return 'Saldo Prime não validado';if(r.need>r.s)return 'Limitado pelo saldo Prime';return r.s>0?(r.pendingKnown?'Repor':'Repor · revisar pendências'):'Sem reposição'};
exportSuggestion=function(){status('suggestMessage','Sugestão para revisão. A exportação oficial continua bloqueada até validar preços e modelo de pedido.')};
const originalSuggestion=suggestionPanel;
suggestionPanel=function(a,picker,search,table){
 const supply=state.supply||{},ok=supply.status?.pending==='ok',priceOk=supply.status?.prices==='ok',l=a.find(x=>x.id===store),orders=l?storeOrders(l.id):[];
 const orderInfo='<section><h2>Histórico dos últimos pedidos faturados</h2><p>Fonte: Farol 8095. Até três pedidos da mesma loja e filial, considerando o histórico disponível. A média inclui zero nos pedidos que não contêm o item. Estoque ideal manual prevalece quando preenchido. Estoque físico é a última contagem de cada SKU.</p><div class="bar"><label>Unidade da coluna QTVENDA <select onchange="primeOrderUnit(this.value)"><option value="" '+(!orderUnit?'selected':'')+'>Não confirmada</option><option value="units" '+(orderUnit==='units'?'selected':'')+'>Unidades</option><option value="boxes" '+(orderUnit==='boxes'?'selected':'')+'>Caixas</option></select></label></div>'+(!orderUnit?'<p class="warn">A referência automática em caixas só será habilitada após confirmar a unidade original do relatório.</p>':'')+(!l?'<p>Selecione uma loja para consultar os pedidos.</p>':!orders.length?'<p class="warn">Sem pedidos faturados válidos no histórico disponível.</p>':table(['Pedido','Data do pedido','Última saída','Valor faturado','Itens distintos'],orders.map(o=>'<tr><td>'+esc(o.id)+'</td><td>'+esc(o.date.split('-').reverse().join('/'))+'</td><td>'+esc(o.exit.split('-').reverse().join('/'))+'</td><td>'+esc(brl(Object.values(o.items).reduce((n,x)=>n+x[1],0)))+'</td><td>'+Object.keys(o.items).length+'</td></tr>').join(''))+(orders.length<2?'<p>Histórico insuficiente para gerar referência automática; use meta manual.</p>':''))+'</section>';
 const wrapped=(heads,body)=>{if(!l||!heads.includes('Sugestão (CX)'))return table(heads,body);const rs=suggestionRows(l.id),next=heads.slice(),i=next.indexOf('Sugestão (CX)');next.splice(i,0,'Média QTVENDA','Referência histórica (CX)','Valor histórico','Pendente (UN)','Preço caixa atual');return table(next,body.replace(/<td id="suggest-(\d+)">/g,(m,n)=>{const r=rs[n];return '<td>'+esc(r?.average==null?'—':r.average.toLocaleString('pt-BR',{maximumFractionDigits:2}))+'</td><td>'+esc(r?.historyTarget??'—')+'</td><td>'+esc(r?.orderCount?brl(r.historyCents):'—')+'</td><td>'+esc(r?.pendingUnits??'—')+'</td><td>'+esc(r?.price==null?'—':brl(r.price))+'</td>'+m}))};
 return orderInfo+originalSuggestion(a,picker,search,wrapped).replace('Reposição em caixas com base no último balanço da loja. Defina o estoque ideal para cada produto. Produtos sem contagem ou sem meta não geram sugestão.','Reposição limitada à posição validada da filial Prime (até 24h). A referência vem dos pedidos faturados ou da meta manual, descontando a última contagem e pendências confirmadas. Produtos sem contagem ou sem saldo validado não geram quantidade positiva.').replace('Exportar Excel — modelo Americanas','Exportação — aguardando validação').replace('O Excel usa os preços históricos das planilhas da filial 08 (inclusive preços zerados); confirme os preços de cada filial. A exportação mantém o layout original e inclui os dois produtos novos.','Pedidos pendentes: '+(ok?'fonte validada; abatidos em unidades':'indisponíveis; revisar antes de emitir')+'. Preços: '+(priceOk?'fonte validada':'indisponíveis; valores históricos não são preços atuais')+'. Saldo Prime é compartilhado pelas lojas: sugestão individual não reserva estoque. Exportação oficial bloqueada.').replace('<p id="suggestMessage" role="status"></p>','<p id="suggestMessage" role="status">'+esc(targetNote())+'</p>');
};
const originalHistory=historyPanel;
historyPanel=function(a){return originalHistory(a)+'<section><div class="bar"><button onclick="primeHistory(-100)" '+(historyOffset===0?'disabled':'')+'>Anteriores</button><small>Registros '+(state.balanceCount?historyOffset+1:0)+'–'+Math.min(historyOffset+100,state.balanceCount||0)+' de '+(state.balanceCount||0)+' (antes do filtro de filial)</small><button onclick="primeHistory(100)" '+(historyOffset+100>=(state.balanceCount||0)?'disabled':'')+'>Próximos</button></div></section>'};
window.primeHistory=async function(delta){if(saving)return;const offset=Math.max(0,historyOffset+delta);try{const r=await api('GET',null,'/operacional/history?offset='+offset);historyOffset=r.offset;db.visitas=r.rows.slice().reverse().map(toVisit);state.balanceCount=r.total;render()}catch(e){msg(explain(e))}};
const originalDetails=details;
details=function(i){originalDetails(i);const v=db.visitas[i],root=$('detail');if(!v||!root||root.hidden)return;const note=document.createElement('p');if(v.cancelled){note.className='warn';note.textContent='ESTORNADO • '+v.cancelled.author+' • '+localDate(v.cancelled.at)+' • '+v.cancelled.reason;root.prepend(note)}else if(initial.canTarget){const b=document.createElement('button');b.type='button';b.textContent='Estornar balanço';b.className='red';b.onclick=async()=>{const reason=prompt('Motivo do estorno (mínimo 5 caracteres). O registro original permanecerá no histórico.');if(!reason||reason.trim().length<5||!confirm('Estornar este balanço e recalcular o estoque?'))return;try{await api('POST',{id:crypto.randomUUID(),kind:'correction',data:{balanceId:v.id,reason}});hydrate(await api());overlayTargets();render();msg('Estorno confirmado. Estoque recalculado.')}catch(e){msg(explain(e))}};root.append(b)}};
userPanel=function(){
 if(me.role!=='admin')return '';
 const users=state.users||[],profiles=state.profiles||[],roleText={chief:'Chefe dos coordenadores',coordinator:'Coordenador',promoter:'Promotor'};
 return '<h1>Usuários e permissões</h1><section><p>Contas individuais ativas e inativas. Alterações de senha invalidam sessões anteriores.</p><div class="scroll"><table><thead><tr><th>Usuário</th><th>Perfil</th><th>Situação</th></tr></thead><tbody>'+users.map(u=>'<tr><td>'+esc(u.username)+'</td><td>'+esc(u.profile)+'</td><td>'+(u.enabled?'Ativo':'Inativo')+'</td></tr>').join('')+'</tbody></table></div></section><section><h2>Cadastrar / alterar conta</h2><form id="primeAccountForm"><div class="bar"><label>Usuário <input name="username" required minlength="3" maxlength="64"></label><label>Perfil <select name="profile" required>'+profiles.map(p=>'<option value="'+esc(p.name)+'">'+esc(p.name+' — '+roleText[p.role])+'</option>').join('')+'</select></label><label>Nova senha <input name="password" type="password" autocomplete="new-password" minlength="12" maxlength="128"></label><label>Situação <select name="enabled"><option value="yes">Ativa</option><option value="no">Inativa</option></select></label></div><button class="red" type="submit">Salvar conta</button></form><p id="accountStatus" role="status"></p></section>';
};
bindUsers=function(){const f=$('primeAccountForm');if(!f)return;f.onsubmit=async e=>{e.preventDefault();if(saving||!auth)return;const x=new FormData(f);saving=true;status('accountStatus','Salvando conta…');try{await api('POST',{id:crypto.randomUUID(),kind:'account',data:{username:x.get('username'),profile:x.get('profile'),password:x.get('password'),enabled:x.get('enabled')==='yes'}});hydrate(await api());render();status('accountStatus','Conta confirmada no servidor.')}catch(e){status('accountStatus',explain(e))}finally{saving=false}}};
const baseGoalPanel=goalAdminPanel;goalAdminPanel=function(...args){return baseGoalPanel(...args).replace(/<details class="goal-table">[\s\S]*?<\/details>/,'')};
window.primeSyncNow=async function(){if(me.role!=='admin'||saving||!auth)return;try{status('primeSyncFeedback','Consultando fontes…');const v=await api('POST',{},'/operacional/sync');window.primeUpdateHealth?.(v.health);window.primeUpdateStock?.({branches:v.stock});msg('Sincronização concluída.');pending=v}catch(e){msg(explain(e))}};
const baseRender=render;render=function(){baseRender();if(page==='historico'){document.querySelectorAll('tbody tr').forEach(row=>{const b=row.querySelector('button[onclick]');const m=b?.getAttribute('onclick')?.match(/details\((\d+)\)/);if(m&&db.visitas[Number(m[1])]?.cancelled){row.classList.add('warn');row.lastElementChild?.append(document.createTextNode(' • ESTORNADO'))}})}if(page==='balanco'&&saved?.store===store){const obs=$('obs');if(obs)obs.value=saved.obs||''}lockBalance();const b=$('logout');if(b)b.textContent='Sair'};
window.addEventListener('pagehide',capture);document.addEventListener('input',e=>{if(page==='balanco'&&e.target.closest('.balance-area'))capture()});document.addEventListener('click',()=>{if(page==='balanco')setTimeout(capture,0)});
function rememberNav(){return write(navKey,{page,store,filial,dashboardStore,salesMonth})}
function reload(){if(reloading||saving||flushing||hasDraft()||['sugestao','usuarios'].includes(page))return;rememberNav();reloading=true;location.reload()}
async function check(){if(checking||saving||flushing||!auth||reloading||document.visibilityState!=='visible')return;if(targetQueue.length){await flushTargets();if(targetQueue.length)return}checking=true;try{const v=await api();window.primeUpdateHealth?.(v.health);window.primeUpdateStock?.({branches:v.stock});if(v.version!==state.version){pending=v;if(page==='sugestao'&&!document.activeElement?.matches('input,select,textarea')&&!flushing){hydrate(v);overlayTargets();render();msg('Estoque e sugestões atualizados.')}else if(!hasDraft()&&!['sugestao','usuarios'].includes(page))reload();else msg('Dados novos disponíveis. Atualize após concluir a edição.')}else if(v.version!==initial.version&&!hasDraft()&&!['sugestao','usuarios'].includes(page))reload();}catch(e){if(e.message!=='AUTH_REQUIRED')msg('Conexão indisponível. Os dados exibidos podem estar desatualizados.')}finally{checking=false}}
setInterval(check,35000+Math.floor(Math.random()*10000));document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')check()});
if(me.role!=='admin'){
 const b=document.createElement('button');b.type='button';b.textContent='Alterar senha';b.className='secondary';$('logout').before(b);
 b.onclick=()=>{const d=document.createElement('dialog');d.style.cssText='background:#18263a;color:white;border:1px solid #667890;border-radius:10px;padding:20px;max-width:95vw';d.innerHTML='<form><h2>Alterar senha</h2><label>Senha atual <input type="password" name="current" required autocomplete="current-password"></label><label>Nova senha <input type="password" name="password" required minlength="12" maxlength="128" autocomplete="new-password"></label><label>Confirmar nova senha <input type="password" name="confirm" required minlength="12" maxlength="128" autocomplete="new-password"></label><p role="status"></p><button type="submit">Alterar</button> <button type="button" data-close>Cancelar</button></form>';document.body.append(d);d.querySelector('[data-close]').onclick=()=>d.close();d.addEventListener('close',()=>d.remove());d.querySelector('form').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target),p=d.querySelector('[role=status]');if(f.get('password')!==f.get('confirm')){p.textContent='Senhas diferentes.';return}if(hasDraft()&&!capture())return;try{await api('POST',{id:crypto.randomUUID(),kind:'password',data:{current:f.get('current'),password:f.get('password')}});location.assign('/operacional/logout')}catch(err){p.textContent=explain(err)}};d.showModal()};
}
render();if(targetQueue.length)void flushTargets();if(activeRequest)status('balanceStatus','Há um envio sem confirmação. Finalize novamente para confirmar.');
})();

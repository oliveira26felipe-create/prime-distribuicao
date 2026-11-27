'use strict';
const encode=v=>JSON.stringify(v).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
function replaceOnce(s,a,b){if(!s.includes(a))throw Error('OPERATIONAL_LAYOUT_MISMATCH');return s.replace(a,()=>b)}
function originalLayout({template,seed,commercialTag,view,stockJs,mixJs,integrationJs,release,withPwa}){
 if(!view?.user||!Array.isArray(view.stores)||!view.commercial?.months)throw Error('INVALID_OPERATIONAL_VIEW');
 const allowed=new Set(view.stores.map(l=>l.id));
 const safeSeed={lojas:seed.lojas.filter(l=>allowed.has(l.id)),produtos:seed.produtos,visitas:[],metasCaixas:{}};
 const seedPattern=/const seed=\{[\s\S]*?\};let db=/;
 if(!seedPattern.test(template))throw Error('OPERATIONAL_SEED_MISMATCH');
 let h=template.replace(seedPattern,()=> 'const seed='+encode(safeSeed)+';let db=');
 // Remove the previous spreadsheet's embedded private document and historical price data.
 for(const [pattern,replacement] of [[/const modelParts=\{[\s\S]*?\};/,'const modelParts={};'],[/const modelRows=\[[\s\S]*?\];/,'const modelRows=[];'],[/const modelExtra=\[[\s\S]*?\];/,'const modelExtra=[];']]){
  if(!pattern.test(h))throw Error('OPERATIONAL_EXPORT_TEMPLATE_MISMATCH');h=h.replace(pattern,replacement);
 }
 h=replaceOnce(h,'loginScreen();</script>','</script>');
 h=replaceOnce(h,'DEMONSTRAÇÃO INTERNA • Estoques de exemplo, sem validade operacional • Alterações temporárias nesta sessão','AMBIENTE OPERACIONAL • Dados reais • Acesso individual');
 h=replaceOnce(h,'Coordenador • acesso a todas as lojas Americanas das duas filiais.','Coordenador • acesso às lojas atribuídas ao seu perfil.');
 h=replaceOnce(h,"['produtos','Produtos'],['importar','Importação'],['metas','Metas comerciais'],['usuarios','Usuários']","['produtos','Produtos'],['metas','Metas comerciais'],['usuarios','Usuários']");
 h=replaceOnce(h,'<script src="/session-update.js"></script>','<script src="/operacional/order-suggestion.js"></script><script src="/operacional/original.js"></script>');
 h=replaceOnce(h,"onchange=\"filial=this.value;store='';draft={};order={};render()\"","onchange=\"primeSelectBranch(this.value)\"");
 h=replaceOnce(h,"onchange=\"store=this.value;draft={};order={};render()\"","onchange=\"primeSelectStore(this.value)\"");
 h=replaceOnce(h,commercialTag,'<script>window.PRIME_OPERATIONAL='+encode(view)+';window.PRIME_COMMERCIAL_IMPORT='+encode(view.commercial)+';window.PRIME_STOCK_IMPORT='+encode({branches:view.stock||{}})+';window.PRIME_SYNC_HEALTH='+encode(view.health||{})+';</script><script src="/commercial-summary.js"></script><script>'+stockJs+'</script><script>'+mixJs+'</script><script>'+integrationJs+'</script>');
 h=h.replace(/<title>[^<]*<\/title>/i,'<title>Prime Distribuição | Gestão Americanas</title>').replace('content="'+release+'"','content="'+view.version+'"');
 // Do not expose a demo profile selector or allow it to run in the real layout.
 return withPwa(h);
}
module.exports={originalLayout};

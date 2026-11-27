(()=>{
'use strict';
let mixFilter='opportunity';
const fmt=n=>Number(n).toLocaleString('pt-BR',{maximumFractionDigits:2});
const allMonths=()=>window.PRIME_COMMERCIAL_IMPORT?.months||{[window.PRIME_COMMERCIAL_IMPORT?.month]:window.PRIME_COMMERCIAL_IMPORT};
const imp=()=>allMonths()[salesMonth];
const branch=l=>window.PRIME_STOCK_IMPORT?.branches?.[String(Number(l.filial))];
const oldPosition=b=>{const p=b?.position;if(!p)return true;const t=Date.parse((p.includes('T')?p:p+'T00:00:00')+'-03:00');return !Number.isFinite(t)||Date.now()-t>86400000};
const label=(b,p)=>{const v=b?.items?.[p.id];if(!v)return 'Sem informação';if(!v.compatible)return fmt(v.units)+' un. • conferir embalagem';return fmt(v.whole)+' CX / '+fmt(v.units)+' un.'};
function rowsFor(l){
 const sold=new Set(imp().soldByStore[l.id]),b=branch(l);
 return db.produtos.map(p=>{const v=b?.items?.[p.id];return {p,positive:sold.has(p.id),stock:v?.compatible===true&&Number.isFinite(v.whole)?v.whole:null,stockLabel:label(b,p)}})
}
window.primeMixChoose=id=>{if(!allowed().some(l=>l.id===id))return;store=id;query='';mixFilter='opportunity';render()};
window.primeMixFilter=value=>{if(['opportunity','stock','zero','unknown','positive','all'].includes(value)){mixFilter=value;render()}};
window.primeMixPanel=function(a,picker,search,table,tr){
 const i=imp();let h='<h1>Oportunidades de mix</h1><section><p>Produtos do catálogo ainda sem venda líquida positiva por loja no mês. A lista é uma referência comercial, não uma confirmação de sortimento autorizado individual.</p>';
 h+='<div class="bar"><label>Mês de referência <input type="month" value="'+esc(salesMonth)+'" onchange="setDashboardMonth(this.value)"></label></div>';
 if(!i?.live||!i.soldByStore||!i.month)return h+'<p class="warn">Dados de mix por produto ainda indisponíveis. Nenhum item será classificado como oportunidade sem uma leitura válida.</p></section>';
 const [year,month]=i.month.split('-');
 h+='<p><b>Período: '+esc(month+'/'+year)+'</b> • Flash de Vendas / Dados'+(i.mixStatus==='stale'?' • Última leitura válida; sincronização indisponível.':'')+'</p><div class="bar">'+picker+search+'</div>';
 const l=a.find(x=>x.id===store);
 if(!l){
   h+='<p>Selecione a loja para consultar os produtos. Os totais consideram o catálogo atual.</p>';
   return h+table(['Código','Loja','Cidade','Mix positivado','Oportunidades','Com saldo na posição (CX)'],a.map(l=>{
     if(!Array.isArray(i.soldByStore[l.id]))return tr([l.id,l.nome,l.cidade,'—','—','—']);
     const rows=rowsFor(l),opp=rows.filter(r=>!r.positive),sold=rows.length-opp.length;
     return '<tr><td>'+esc(l.id)+'</td><td><button type="button" onclick="primeMixChoose(this.dataset.id)" data-id="'+esc(l.id)+'">'+esc(l.nome)+'</button></td><td>'+esc(l.cidade)+'</td><td>'+sold+'</td><td>'+opp.length+'</td><td>'+opp.filter(r=>r.stock>0).length+'</td></tr>'
   }).join(''))+'</section>'
 }
 if(!Array.isArray(i.soldByStore[l.id]))return h+'<p>Sem dados de vendas validados para esta loja.</p></section>';
 const b=branch(l),rows=rowsFor(l),opp=rows.filter(r=>!r.positive),positive=rows.length-opp.length,withStock=opp.filter(r=>r.stock>0).length,unknown=opp.filter(r=>r.stock===null).length;
 const known=new Set(db.produtos.map(p=>p.id)),outside=i.soldByStore[l.id].filter(p=>!known.has(p)).length;
 h+='<h2>'+esc(l.nome)+' — '+esc(l.cidade)+'</h2><p>Filial '+esc(String(l.filial).padStart(2,'0'))+' • Posição Prime: '+esc(b?.position?b.position.slice(0,10).split('-').reverse().join('/')+' '+b.position.slice(11,16):'indisponível')+(b?.status==='stale'?' • Última leitura válida':'')+(b?.position&&oldPosition(b)?' • ATENÇÃO: posição com mais de 24h':'')+'</p>';
 h+='<div class="tiles">'+[['Catálogo',rows.length],['Mix positivado',positive],['Oportunidades',opp.length],['Com saldo na posição (CX)',withStock]].map(([k,v])=>'<div class="tile">'+k+'<b>'+v+'</b></div>').join('')+'</div>';
 h+='<p>'+(Array.isArray(i.matchedIds)&&!i.matchedIds.includes(l.id)?'ATENÇÃO: loja sem linhas de vendas na origem; confirme a completude antes de agir. ':'')+unknown+' oportunidades sem saldo em caixas validado. '+(outside?outside+' SKU(s) vendidos fora do catálogo atual não integram a lista. ':'')+'Saldo Prime é posição de estoque, não disponibilidade de venda confirmada.</p>';
 const filters=[['opportunity','Não positivados'],['stock','Não positivados com saldo em CX'],['zero','Não positivados sem caixa completa'],['unknown','Não positivados sem informação validada'],['positive','Positivados'],['all','Todos os produtos']];
 h+='<div class="bar"><label>Exibir <select onchange="primeMixFilter(this.value)">'+filters.map(([k,v])=>'<option value="'+k+'" '+(mixFilter===k?'selected':'')+'>'+v+'</option>').join('')+'</select></label></div>';
 const visible=rows.filter(r=>mixFilter==='all'||(mixFilter==='positive'?r.positive:!r.positive&&(mixFilter==='opportunity'||(mixFilter==='stock'&&r.stock>0)||(mixFilter==='zero'&&r.stock===0)||(mixFilter==='unknown'&&r.stock===null))));
 visible.sort((x,y)=>Number(y.stock>0)-Number(x.stock>0)||x.p.nome.localeCompare(y.p.nome,'pt-BR'));
 return h+(visible.length?table(['Código Prime','Produto','Mix no mês','Estoque Prime'],visible.map(r=>tr([r.p.id,r.p.nome,r.positive?'Positivado':'Não positivado',r.stockLabel])).join('')):'<p>Nenhum produto neste filtro.</p>')+'</section>';
}
})();
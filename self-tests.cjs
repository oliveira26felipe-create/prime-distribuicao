'use strict';
const assert=require('node:assert/strict');
const {aggregate,validateCoverage,readOfficialGoal,readStoreGoals,makeSync,parseClosures}=require('./sheets-reader.cjs');
const {parsePosition}=require('./stock-reader.cjs');
const {makeStockBackup,encode,decode}=require('./stock-backup.cjs');
const {makeHistory,encodeSnapshot,decodeSnapshot}=require('./history-store.cjs');
async function run(){
 let checks=0;const check=(condition,label)=>{assert.ok(condition,label);checks++};
 const throws=(fn,match)=>{assert.throws(fn,match);checks++};
 const baseline={month:'2026-11',rows:Array.from({length:36},(_,i)=>[String(i+1),100,50])};
 const salesRows=n=>Array.from({length:n},(_,i)=>[String(i+1),'10','',10]);
 const net=aggregate([...salesRows(33),['1','10','',-10],['1','20','',3]],baseline);
 check(net.soldByStore['1'].join(',')==='20','devoluções e mix líquido');
 throws(()=>validateCoverage(aggregate(salesRows(18),baseline),null),/SALES_COVERAGE_TOO_LOW/);
 throws(()=>validateCoverage(aggregate(salesRows(30),baseline),{live:true,lineCount:100,matchedIds:net.matchedIds}),/SUDDEN_SALES_ROW_DROP/);
 validateCoverage(net,null);checks++;
 const goals=Array.from({length:7},()=>[]);
 goals[3][85]='TOTAL';goals[4][85]='Faturamento';goals[5][85]='Meta';goals[5][1]='Cod';goals[5][2]='EQUIPE';goals[6][1]=1001;goals[6][2]='Americanas';goals[6][85]=123.45;
 check(readOfficialGoal(goals)===12345,'meta em coluna deslocada');
 let newGoal=3,failSales=false,partial=false,failOfficial=false;
 const individual=()=>[['METAS NOVEMBRO 2026'],[],[],['Filial','Código cliente','Loja','Cidade','Meta de faturamento (R$)'],...baseline.rows.map(([id])=>[5,id,'Loja','Cidade',newGoal])];
 check(readStoreGoals(individual(),baseline).size===36,'metas individuais completas');
 throws(()=>readStoreGoals(individual().slice(0,-1),baseline),/MISSING_STORE_GOALS/);
 const salesId='synthetic-sales-source-0001',goalsId='synthetic-goals-source-0001';
 const fetchFn=async url=>{
  const u=decodeURIComponent(url);let data;
  if(u.includes('?fields='))data={properties:{title:u.includes(salesId)?'Flash Novembro 2026':'Metas Novembro 2026'}};
  else if(u.includes("'Dados'")){if(failSales)return {ok:false,status:503};data={values:[['CODCLI','PRODUTO','DESCRICAO','VLVENDA'],...salesRows(partial?18:33)]}}
  else if(u.includes("'Metas x Realizado'")){if(failOfficial)return {ok:false,status:503};data={values:goals}}
  else if(u.includes("'Metas novembro'"))data={values:individual()};
  else throw Error('UNEXPECTED_TEST_URL');
  return {ok:true,json:async()=>data};
 };
 const reader=makeSync(baseline,{salesId,goalsId,fetchFn,getToken:async()=>'test',log:()=>{}});
 await reader.refresh(true);
 check(reader.get().live&&reader.get().rows[0][1]===300&&reader.get().rows[0][2]===1000,'leitura integrada');
 failSales=true;newGoal=7;await reader.refresh(true);
 check(reader.get().rows[0][1]===700&&reader.get().rows[0][2]===1000&&reader.get().mixStatus==='stale','falha de vendas não impede metas');
 failSales=false;partial=true;failOfficial=true;await reader.refresh(true);
 check(reader.get().lineCount===33&&reader.get().officialGoal===12345&&reader.get().goalStatus==='stale','proteção última leitura válida');
 partial=false;failOfficial=false;await reader.refresh(true);
 check(reader.get().mixStatus==='ok'&&reader.get().goalStatus==='ok','recuperação automática');
 const report=[['105 - Posição do estoque','15/01/2025 9:55'],[],['','','Código','Descrição','Qt.Estoque','','','','','Qt.Estoque Emb.Master'],['',5906,'PRODUTO','UNIDADE',119,0,0,9.92],['',1,'Itens Listados','Total Geral :']];
 const stock=parsePosition(report,new Map([['5906',12]]));
 check(stock.position==='2025-01-15T09:55:00'&&stock.items['5906'].whole===9,'data e caixas completas');
 throws(()=>parsePosition([...report.slice(0,-1),report[3],['',2,'Itens Listados','Total Geral :']],new Map([['5906',12]])),/DUPLICATE_STOCK_PRODUCT/);
 throws(()=>parsePosition(report.map((r,i)=>i===0?[r[0],'31/02/2025']:r),new Map([['5906',12]])),/INVALID_STOCK_DATE/);
 const ids=new Set(baseline.rows.map(r=>r[0])),snapshot=reader.get();
 const encoded=encodeSnapshot(snapshot,ids);
 check(decodeSnapshot(encoded,ids).rows.length===36,'compressão e verificação do histórico');
 throws(()=>decodeSnapshot([encoded[0],encoded[1],'0'.repeat(64),encoded[3]],ids),/HISTORY_DIGEST_MISMATCH/);
 let tab=false,rows=[],writes=0;
 const historyFetch=async(url,opt)=>{
  const u=decodeURIComponent(url);let data;
  if(u.includes('?fields='))data={properties:{title:'PRIME - Histórico Americanas'},sheets:tab?[{properties:{title:'Comercial'}}]:[]};
  else if(u.includes(':batchUpdate')){tab=true;data={}}
  else if(u.includes(':append')){const v=JSON.parse(opt.body).values;rows.push(...v);writes++;data={updates:{updatedRows:v.length}}}
  else if(opt.method==='PUT'){rows=JSON.parse(opt.body).values;data={}}
  else if(opt.method==='GET')data={values:rows};
  else throw Error('UNEXPECTED_TEST_URL');
  return {ok:true,json:async()=>data};
 };
 const opts={id:'synthetic-history-destination',storeIds:ids,excludedIds:new Set(),token:async()=>'test',fetchFn:historyFetch,log:()=>{}};
 const h=makeHistory(opts);await h.load();await h.save([snapshot]);await h.save([snapshot]);
 check(writes===1&&h.get().has('2026-11'),'histórico idempotente');
 const restored=makeHistory(opts);await restored.load();check(restored.get().get('2026-11').rows.length===36,'recuperação após reinício');
 const rejected=makeHistory({...opts,excludedIds:new Set([opts.id])});await rejected.load();
 check(rejected.health().error==='INVALID_HISTORY_DESTINATION','não gravar nas fontes de origem');

 const cat=new Map([['5906',12]]);
 const stockRow=encode('5',stock,cat);
 check(decode(stockRow,cat).items['5906'].whole===9,'backup de estoque íntegro');
 throws(()=>decode([stockRow[0],stockRow[1],'0'.repeat(64),stockRow[3]],cat),/STOCK_BACKUP_DIGEST_MISMATCH/);
 const duplicate=[...report.slice(0,-1),report[3],['',2,'Itens Listados','Total Geral :']];
 try{parsePosition(duplicate,cat);assert.fail('duplicidade aceita')}catch(e){check(e.message==='DUPLICATE_STOCK_PRODUCT'&&e.detail?.rows.join(',')==='4,5','diagnóstico com linhas duplicadas')}
 try{parsePosition(report.map((r,i)=>i===4?['',2,'Itens Listados','Total Geral :']:r),cat);assert.fail('incompleto aceito')}catch(e){check(e.message==='INCOMPLETE_STOCK_REPORT'&&e.detail?.expected===2&&e.detail?.identified===1,'diagnóstico da quantidade esperada')}
 throws(()=>parsePosition([...report,report[4]],cat),/INCOMPLETE_STOCK_REPORT/);
 let stockTab=false,stockRows=[],stockWrites=0;
 const stockFetch=async(url,opt)=>{
  const u=decodeURIComponent(url);let data;
  if(u.includes('?fields='))data={properties:{title:'PRIME - Histórico Americanas'},sheets:stockTab?[{properties:{title:'EstoquePrime'}}]:[]};
  else if(u.includes(':batchUpdate')){stockTab=true;data={}}
  else if(u.includes(':append')){const v=JSON.parse(opt.body).values;stockRows.push(...v);stockWrites++;data={updates:{updatedRows:v.length}}}
  else if(opt.method==='PUT'){stockRows=JSON.parse(opt.body).values;data={}}
  else if(opt.method==='GET')data={values:stockRows};
  else throw Error('UNEXPECTED_TEST_URL');
  return {ok:true,json:async()=>data};
 };
 const bopts={id:'synthetic-history-destination',catalog:cat,excludedIds:new Set(),token:async()=>'test',fetchFn:stockFetch,log:()=>{}};
 const b=makeStockBackup(bopts);await b.load();await b.save({'5':{...stock,status:'ok'},'8':{...stock,status:'stale'}});await b.save({'5':{...stock,status:'ok'}});
 check(stockWrites===1&&b.health().branches.join(',')==='5','backup idempotente e exclusão de leituras inválidas');
 const recovered=makeStockBackup(bopts),restoredStocks=await recovered.load();
 check(restoredStocks.get('5').status==='stale'&&restoredStocks.get('5').items['5906'].whole===9,'restauração após reinício sinalizada');
 const blocked=makeStockBackup({...bopts,excludedIds:new Set([bopts.id])});await blocked.load();check(blocked.health().error==='INVALID_STOCK_BACKUP_DESTINATION','proteção das planilhas de origem');
 const known=new Set(['2026-11','2026-12']);
 check(parseClosures('{}','2026-12',known).size===0,'virada de mês não encerra automaticamente');
 check(parseClosures(JSON.stringify({'2026-11':encoded[2]}),'2026-12',known).get('2026-11')===encoded[2],'encerramento exige hash de snapshot');
 throws(()=>parseClosures(JSON.stringify({'2026-12':encoded[2]}),'2026-12',known),/INVALID_CLOSURE_REGISTRY/);
 return checks;
}
if(require.main===module)run().then(checks=>console.log('[self-test] '+JSON.stringify({status:'ok',checks}))).catch(e=>{console.error('[self-test] failed',e.message);process.exitCode=1});
module.exports={run};

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

 const farol=require('./farol-reader.cjs');
 check(farol.dateMonth('27/11/2026')==='2026-11'&&farol.dateMonth('31/02/2026')===null,'competência da data de saída validada');
 const farolRow=(date,value,ret=0)=>['1','5906','Produto',value,0,0,0,0,ret,0,'01/11/2026',date];
 check(farol.normalizeFarolRows([farolRow('27/11/2026',12),farolRow('01/12/2026',100)],new Set(['1']),'2026-11').length===1,'Farol não mistura competências');
 throws(()=>farol.normalizeFarolRows([farolRow('27/11/2026',12,2)],new Set(['1']),'2026-11'),/FAROL_RETURN_RULE_UNCONFIRMED/);
 const metaRows=Array.from({length:4},()=>[]);
 metaRows[0][0]='CÓD';metaRows[0][1]='VENDEDOR';metaRows[0][46]='GERAL';metaRows[1][46]='FATURAMENTO';metaRows[2][47]='Meta';metaRows[3][0]=1001;metaRows[3][1]='Americanas';metaRows[3][47]=123.45;
 check(farol.readMetaRows(metaRows)===12345,'meta geral AV na linha Americanas');
 throws(()=>farol.readMetaRows([...metaRows,metaRows[3]]),/AMERICANAS_GOAL_ROW_MISSING_OR_DUPLICATE/);
 await assert.rejects(()=>farol.readMetaFlash(async()=>{throw Error('unexpected network')},'test','2026-11','2026-12'),/META_FLASH_PERIOD_UNCONFIRMED/);checks++;

 // Independent archival of commercial data even when the other sources fail.
 const {combineSnapshot}=require('./history-store.cjs');
 const partialSales={...snapshot,goalStatus:'stale',storeGoalStatus:'unavailable',mixStatus:'ok'};
 const onlySales=combineSnapshot(partialSales,null,ids);
 check(onlySales.valid.sales&&!onlySales.valid.official&&!onlySales.valid.individual&&onlySales.rows.every(r=>r[1]===null),'arquiva vendas isoladamente sem inventar metas');
 const merged=combineSnapshot({...snapshot,mixStatus:'stale',goalStatus:'ok',officialGoal:22222,storeGoalStatus:'unavailable'},onlySales,ids);
 check(merged.valid.sales&&merged.valid.official&&merged.officialGoal===22222&&merged.lineCount===snapshot.lineCount,'mescla somente fontes válidas');
 const partialDecoded=decodeSnapshot(encodeSnapshot(merged,ids),ids);
 check(partialDecoded.live&&partialDecoded.storeGoalStatus==='unavailable'&&partialDecoded.rows.every(r=>r[1]===null),'recupera histórico parcial');
 const emptyReader=makeSync(baseline,{salesId,goalsId,fetchFn,getToken:async()=>'test',log:()=>{}});
 emptyReader.restore(partialDecoded);
 check(emptyReader.get().live&&emptyReader.get().officialGoal===22222&&emptyReader.get().storeGoalStatus!=='ok','restaura componentes independentemente');
 const metaGet=async (id,path)=>{
  if(path.startsWith('?'))return {properties:{title:'METAS - FLASH'},sheets:[{properties:{title:'Competencia'}}]};
  if(decodeURIComponent(path).includes("'Competencia'"))return {values:[['2026-12']]};
  return {values:metaRows};
 };
 check(await farol.readMetaFlash(metaGet,'test','2026-12','2026-12','2026-11')===12345,'meta permanente aceita competência explícita');
 await assert.rejects(()=>farol.readMetaFlash(metaGet,'test','2026-11','2026-11','2026-11'),/META_FLASH_PERIOD_UNCONFIRMED/);checks++;
 // Operational permissions, stock and expiry validation, immutable append and retry.
 const ops=require('./operations-store.cjs'),crypto=require('node:crypto');
 const oc={stores:new Map([['1',{id:'1',branch:'5',promoter:'P1',coordinator:'C1'}],['2',{id:'2',branch:'8',promoter:'P2',coordinator:'C2'}]]),products:new Map([['5906',{id:'5906',name:'Produto',unitsPerBox:12}]])};
 check(ops.permitted({role:'promoter',name:'P1'},oc.stores.get('1'))&&!ops.permitted({role:'promoter',name:'P1'},oc.stores.get('2')),'promotor limitado à loja');
 check(ops.permitted({role:'coordinator',name:'C1'},oc.stores.get('1'))&&!ops.permitted({role:'coordinator',name:'C1'},oc.stores.get('2'))&&!ops.canBalance({role:'coordinator'}),'coordenador limitado ao escopo de leitura');
 check(ops.canBalance({role:'chief'})&&ops.canTarget({role:'chief'})&&!ops.canTarget({role:'promoter'}),'permissões de balanço e reposição');
 const balanceData={store:'1',items:{'5906':{qty:5,lots:[{date:'2027-01-01',qty:2},{date:'2027-01-01',qty:1}]}},note:'teste sintético'};
 check(ops.normalizeBalance(balanceData,oc).items['5906'].lots[0].qty===3,'consolidação de lotes');
 throws(()=>ops.normalizeBalance({...balanceData,items:{'5906':{qty:1,lots:[{date:'2027-01-01',qty:2}]}}},oc),/EXPIRY_EXCEEDS_BALANCE/);
 throws(()=>ops.normalizeBalance({...balanceData,items:{'5906':{qty:3,lots:[{date:'2027-02-31',qty:2}]}}},oc),/INVALID_EXPIRY/);
 let opTab=false,opRows=[],opWrites=0;
 const opFetch=async(url,opt)=>{
  const u=decodeURIComponent(url);let data;
  if(u.includes('?fields='))data={properties:{title:'PRIME - Histórico Americanas'},sheets:opTab?[{properties:{title:'Operacional'}}]:[]};
  else if(u.includes(':batchUpdate')){opTab=true;data={}}
  else if(u.includes(':append')){const v=JSON.parse(opt.body).values;opRows.push(...v);opWrites++;data={updates:{updatedRows:v.length}}}
  else if(opt.method==='PUT'){opRows=JSON.parse(opt.body).values;data={}}
  else if(opt.method==='GET')data={values:opRows};
  else throw Error('UNEXPECTED_TEST_URL');
  return {ok:true,json:async()=>data};
 };
 const opOpts={id:'synthetic-history-destination',catalog:oc,adminName:'admin',excludedIds:new Set(),token:async()=>'test',fetchFn:opFetch,log:()=>{}};
 const op=ops.createStore(opOpts),admin={username:'admin',version:'admin'};
 await op.init();
 await op.mutate(admin,{id:crypto.randomUUID(),kind:'account',data:{username:'promotor1',profile:'P1',password:'synthetic-only-password',enabled:true}});
 const principal=await op.authenticate('promotor1','synthetic-only-password');
 check(!!principal&&(await op.getState(principal)).stores.map(l=>l.id).join(',')==='1','login individual e escopo de dados');
 check(await op.authenticate('promotor1','wrong-password')===null,'rejeita senha incorreta');
 await assert.rejects(()=>op.mutate(principal,{id:crypto.randomUUID(),kind:'balance',data:{...balanceData,store:'2'}}),/FORBIDDEN/);checks++;
 await assert.rejects(()=>op.mutate(principal,{id:crypto.randomUUID(),kind:'targets',data:{store:'1',items:{'5906':10}}}),/FORBIDDEN/);checks++;
 const event={id:crypto.randomUUID(),kind:'balance',data:balanceData};
 await op.mutate(principal,event);const again=await op.mutate(principal,event);
 check(again.duplicate&&opWrites===2&&(await op.getState(principal)).balances.length===1,'balanço persistido e retry idempotente');
 await assert.rejects(()=>op.mutate(principal,{...event,data:{...balanceData,note:'outro'}}),/OPERATIONAL_EVENT_CONFLICT/);checks++;
 const op2=ops.createStore(opOpts);await op2.init();check((await op2.getState(principal)).latest['1']['5906'].qty===5,'recupera balanço após reinicialização');
 await op2.mutate(admin,{id:crypto.randomUUID(),kind:'account',data:{username:'promotor1',profile:'P1',password:'',enabled:false}});
 await assert.rejects(()=>op2.getState(principal),/AUTH_REQUIRED/);checks++;
 const supply=require('./supply-reader.cjs'),now=Date.now(),stamp=new Date(now).toISOString().replace(/\.\d{3}Z$/,'Z');
 const control=n=>[['POSICAO',stamp],['REGISTROS',n],['COMPLETO','SIM']];
 const pendingHead=['FILIAL','CODCLI','PRODUTO','PEDIDO','ITEM','QTD_PENDENTE_UN'];
 const pendingRows=[pendingHead,[5,'1','5906','P','1',18]];
 check(supply.parsePending(pendingRows,control(1),oc,now).items['1']['5906']===18,'pedido pendente em unidades validado');
 throws(()=>supply.parsePending([...pendingRows,pendingRows[1]],control(2),oc,now),/INVALID_PENDING_ROW/);
 throws(()=>supply.parsePending(pendingRows,control(2),oc,now),/SUPPLY_REPORT_NOT_CONFIRMED/);
 const priceRows=[['FILIAL','PRODUTO','PRECO_UN','UNIDADES_CAIXA'],[5,'5906',2.5,12]];
 check(supply.parsePrices(priceRows,control(1),oc,now).items['5']['5906']===3000,'preço por caixa convertido sem inventar');
 throws(()=>supply.parsePrices([priceRows[0],[5,'5906',2.5,10]],control(1),oc,now),/INVALID_PRICE_ROW/);
 return checks;
}
if(require.main===module)run().then(checks=>console.log('[self-test] '+JSON.stringify({status:'ok',checks}))).catch(e=>{console.error('[self-test] failed',e.message);process.exitCode=1});
module.exports={run};

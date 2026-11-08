import React from "react";
import * as pdfjs from "pdfjs-dist";

const display=(value)=>String(value??"").trim();
const money=(value)=>display(value)||"Não informado";
const parseISO=(value)=>/^\d{4}-\d{2}-\d{2}$/.test(display(value))?display(value):"";
const readable=(value)=>parseISO(value)?new Date(value+"T12:00:00").toLocaleDateString("pt-BR"):display(value);
const excerpt=(v,n)=>String(v||"").slice(0,n);

async function readPdf(file){
 if(!file || !/\.pdf$/i.test(file.name) || file.size>15*1024*1024)
   throw Error("Selecione um PDF de até 15 MB.");
 const pdf=await pdfjs.getDocument({data:await file.arrayBuffer()}).promise;
 const pages=[];
 try{
   if(pdf.numPages>120)throw Error("Edital muito extenso: envie um PDF de até 120 páginas.");
   for(let i=1;i<=pdf.numPages;i++){
     const page=await pdf.getPage(i);
     const content=await page.getTextContent();
     pages.push(content.items.map(item=>item.str+(item.hasEOL?"\n":" ")).join(""));
   }
 }finally{await pdf.destroy();}
 if(pages.join("").trim().length<900)throw Error("PDF sem texto extraível. Use um arquivo digital com texto selecionável.");
 return pages;
}
function overviewText(pages){
 // Prioritize exact evidence: jobs, exam rules, official schedule (not mentions in the index).
 const indices=new Set([...Array(Math.min(5,pages.length)).keys()]);
 const examStart=pages.findIndex(p=>/^\s*(?:9|10)\.\s*(?:DAS PROVAS|DA PROVA DISCURSIVA)/im.test(p));
 if(examStart>=0)for(let i=examStart;i<Math.min(pages.length,examStart+5);i++)indices.add(i);
 const scheduleStart=pages.findIndex(p=>/^\s*ANEXO III\s*[–-]\s*DO CRONOGRAMA/im.test(p));
 if(scheduleStart>=0)for(let i=scheduleStart;i<Math.min(pages.length,scheduleStart+3);i++)indices.add(i);
 return [...indices].sort((a,b)=>a-b).map(i=>"\n[PÁGINA "+(i+1)+"]\n"+pages[i]).join("\n").slice(0,65000);
}
function syllabusText(pages){
 let start=-1;
 for(let i=pages.length-1;i>=0;i--){
   if(/^\s*ANEXO II\s*[–-]\s*DOS CONTEÚDOS PROGRAMÁTICOS/im.test(pages[i])){start=i;break;}
 }
 const after=start>=0?start:Math.max(0,pages.length-20);
 const end=pages.findIndex((p,i)=>i>after&&/ANEXO III\s*[–-]\s*DO CRONOGRAMA/i.test(p));
 const selected=pages.slice(after,end>after?end:Math.min(pages.length,after+20));
 const rules=pages.slice(Math.max(0,after-22),after).filter(p=>/DAS PROVAS|PROVAS OBJETIVAS|PROVAS DISCURSIVAS|PONTUAÇÃO/i.test(p)).slice(-5);
 return [...rules,...selected].join("\n\n[PÁGINA SEGUINTE]\n\n").slice(0,85000);
}
const asList=(v)=>Array.isArray(v)?v:[];

export function ProvisionalCreator({supabase,userId,questions=[],onCreated,onCancel,onFinish,onPlanNow}){
 const [step,setStep]=React.useState("upload");
 const [name,setName]=React.useState("");
 const [file,setFile]=React.useState(null);
 const [pages,setPages]=React.useState([]);
 const [source,setSource]=React.useState("");
 const [analysis,setAnalysis]=React.useState(null);
 const [roleIndex,setRoleIndex]=React.useState(-1);
 const [selectedRole,setSelectedRole]=React.useState(null);
 const [syllabus,setSyllabus]=React.useState(null);
 const [topics,setTopics]=React.useState([]);
 const [examDate,setExamDate]=React.useState("");
 const [created,setCreated]=React.useState(null);
 const [busy,setBusy]=React.useState(false);
 const [error,setError]=React.useState("");
 const [expandedTopics,setExpandedTopics]=React.useState(false);
 const [adjust,setAdjust]=React.useState(false);
 const [newDiscipline,setNewDiscipline]=React.useState("");
 const [newSubject,setNewSubject]=React.useState("");

 async function invoke(mode,payload){
   const {data,error:requestError}=await supabase.functions.invoke("analyze-edital",{body:{mode,...payload}});
   if(requestError)throw new Error(data?.error || requestError.message || "Não foi possível consultar o Groq.");
   if(data?.error)throw new Error(data.error);
   return data?.result;
 }
 async function submitPdf(e){
   e.preventDefault();if(!file)return setError("Anexe o edital em PDF.");
   setBusy(true);setError("");
   try{
     const extracted=await readPdf(file);
     setPages(extracted);setSource(file.name);
     const result=await invoke("overview",{text:overviewText(extracted)});
     setAnalysis(result);setStep("roles");
   }catch(err){setError(err.message);}finally{setBusy(false);}
 }
 async function selectRole(role,index){
   setRoleIndex(index);setSelectedRole(role);setBusy(true);setError("");
   try{
     const data=await invoke("syllabus",{role:role.original_name,text:syllabusText(pages)});
     const collected=asList(data.topics).filter(t=>t?.discipline);
     if(!collected.length)throw Error("Não foram identificadas matérias para esse cargo.");
     setSyllabus(data);setTopics(collected);
     if(!name.trim())setName(display(role.broad_name)||display(role.original_name));
     const nextDate=parseISO(analysis?.exam_date)||asList(analysis?.timeline)
       .filter(e=>/aplicaç[aã]o das provas|realizaç[aã]o das provas|prova objetiva/i.test(display(e.label)))
       .map(e=>parseISO(e.date)).find(Boolean)||"";
     setExamDate(nextDate);setStep("confirm");
   }catch(err){setError(err.message);}finally{setBusy(false);}
 }
 function editTopic(index,field,value){
   setTopics(rows=>rows.map((r,i)=>i===index?{...r,[field]:value}:r));
 }
 async function createNotebook(){
   if(!name.trim()||!selectedRole||!topics.some(t=>t.discipline?.trim()))return setError("Confirme o nome e ao menos uma disciplina.");
   setBusy(true);setError("");
   try{
     const metadata={
       contest:display(analysis?.contest),agency:display(analysis?.agency),
       edital_number:display(analysis?.edital_number),
       stages:asList(analysis?.stages).slice(0,12),
       exam_rules:asList(syllabus?.exam_rules).slice(0,20),
       published_at:parseISO(analysis?.published_at)||null,
       vacancies:selectedRole?.vacancies??null,salary:selectedRole?.salary??null,
       requirements:selectedRole?.requirements??null,
       original_role:selectedRole.original_name
     };
     const payload={
       p_title:name.trim(),p_concurso:display(analysis?.contest)||"Concurso do edital",
       p_cargo:selectedRole.original_name,
       p_topics:topics.map(t=>({discipline:display(t.discipline),subject:display(t.subject),weight:Math.min(99,Math.max(1,Number(t.weight)||1))})),
       p_metadata:metadata,
       p_events:asList(analysis?.timeline).slice(0,45),
       p_broad_role:display(selectedRole.broad_name)||name.trim(),
       p_exam_date:parseISO(examDate)||null,
       p_source_filename:source
     };
     const {data,error:rpcError}=await supabase.rpc("create_provisional_notebook_v2",payload);
     if(rpcError)throw rpcError;
     setCreated(data);
     await onCreated(data);
     setStep("planning");
   }catch(err){setError(err.message);}finally{setBusy(false);}
 }

 return <section className="edital-flow">
   <div className="edital-flow-head">
     <button className="light compact" onClick={onCancel} type="button">← Voltar</button>
     <small>{step==="upload"?"1. Edital":step==="roles"?"2. Escolha o cargo":step==="confirm"?"3. Seu caderno":"4. Próximo passo"}</small>
   </div>
   {step==="upload"&&<form onSubmit={submitPdf} className="card edital-simple">
     <span className="eyebrow">NOVO CADERNO</span>
     <h1>Qual concurso você vai estudar?</h1>
     <p>Envie o edital. O Caderno identifica os cargos, as provas e as matérias para você. 📚</p>
     <label>Nome do caderno <small>(opcional — podemos sugerir depois)</small>
       <input value={name} onChange={e=>setName(e.target.value)} maxLength={120} placeholder="Ex.: Procurador"/>
     </label>
     <label className="edital-upload">
       <span className="edital-upload-icon">↑</span><strong>{file?file.name:"Escolher edital em PDF"}</strong>
       <small>Até 15 MB · PDF com texto selecionável</small>
       <input type="file" accept=".pdf,application/pdf" onChange={e=>setFile(e.target.files?.[0]||null)}/>
     </label>
     <button className="edital-main-button" disabled={!file||busy}>{busy?"Lendo e analisando o edital…":"Analisar edital com IA →"}</button>
     {busy&&<p className="edital-wait">Identificando concurso, cargos, vagas, remuneração, cronograma e regras das provas…</p>}
   </form>}
   {step==="roles"&&<div className="card edital-simple">
     <span className="eyebrow">EDITAL ANALISADO</span><h1>{display(analysis?.contest)||"Concurso identificado"}</h1>
     <p>Encontrei {asList(analysis?.roles).length} opção(ões) de cargo. <strong>Qual delas você pretende estudar?</strong></p>
     {analysis?.agency&&<small>Organização: {analysis.agency}</small>}
     <div className="edital-roles">{asList(analysis?.roles).map((role,i)=><button key={i} disabled={busy}
       onClick={()=>selectRole(role,i)} className="edital-role">
       <span><strong>{role.original_name}</strong><small>{role.vacancies??"—"} vaga(s) · {money(role.salary)}</small></span><span aria-hidden="true">›</span>
     </button>)}</div>
     {busy&&<p className="edital-wait">Lendo as matérias do cargo escolhido…</p>}
   </div>}
   {step==="confirm"&&<div className="card edital-simple">
     <span className="eyebrow">SEU CADERNO</span>
     <h1>Pronto! Vamos estudar para {display(selectedRole?.original_name)}? 🎯</h1>
     <p>A proposta é usar um nome amplo para aproveitar questões de concursos semelhantes, mantendo as matérias específicas deste edital.</p>
     <label>Nome do caderno<input value={name} maxLength={120} onChange={e=>setName(e.target.value)}/></label>
     <div className="edital-facts">
       <div><small>Concurso</small><strong>{display(analysis?.contest)}</strong></div>
       <div><small>Cargo no edital</small><strong>{selectedRole?.original_name}</strong></div>
       <div><small>Vagas e vencimento</small><strong>{selectedRole?.vacancies??"—"} · {money(selectedRole?.salary)}</strong></div>
       <div><small>Data da prova</small><input aria-label="Data da prova" type="date" value={examDate} onChange={e=>setExamDate(e.target.value)}/></div>
     </div>
     <div className="edital-brief"><strong>O que identifiquei</strong>
       {asList(analysis?.stages).slice(0,5).map((s,i)=><p key={i}>• {display(s.name)} — {display(s.description)}</p>)}
       <p>📖 {topics.length} assuntos ou disciplinas identificados para o cargo.</p>
       <button className="light compact" type="button" onClick={()=>setExpandedTopics(v=>!v)}>
         {expandedTopics?"Ocultar":"Conferir"} conteúdos programáticos
       </button>
       {expandedTopics&&<div className="edital-details">{topics.map((t,i)=><div key={i}><strong>{t.discipline}</strong><span>{t.subject||"Disciplina inteira"}</span></div>)}</div>}
       <button className="light compact" type="button" onClick={()=>setAdjust(v=>!v)}>{adjust?"Concluir ajustes":"Corrigir matérias"}</button>
       {adjust&&<div className="edital-details">{topics.map((t,i)=><div className="edital-edit" key={i}>
         <input aria-label="Disciplina" value={t.discipline} onChange={e=>editTopic(i,"discipline",e.target.value)}/>
         <input aria-label="Assunto" value={t.subject||""} onChange={e=>editTopic(i,"subject",e.target.value)}/>
         <button className="light compact" type="button" onClick={()=>setTopics(rows=>rows.filter((_,k)=>k!==i))}>×</button>
       </div>)}
       <div className="edital-edit"><input placeholder="Disciplina" value={newDiscipline} onChange={e=>setNewDiscipline(e.target.value)}/>
       <input placeholder="Assunto" value={newSubject} onChange={e=>setNewSubject(e.target.value)}/>
       <button className="light compact" type="button" onClick={()=>{if(newDiscipline.trim())setTopics(rows=>[...rows,{discipline:newDiscipline.trim(),subject:newSubject.trim(),weight:1}]);setNewDiscipline("");setNewSubject("");}}>+</button></div></div>}
     </div>
     {asList(analysis?.timeline).length>0&&<details className="edital-timeline">
       <summary>Ver cronograma do concurso ({analysis.timeline.length} eventos)</summary>
       {analysis.timeline.map((ev,i)=><p key={i}><strong>{display(ev.label)}</strong> · {readable(ev.date)||display(ev.period)||"Sem data confirmada"}</p>)}
     </details>}
     <button className="edital-main-button" type="button" disabled={busy||!name.trim()} onClick={createNotebook}>
       {busy?"Criando seu caderno…":"Criar meu caderno →"}
     </button>
   </div>}
   {step==="planning"&&<div className="card edital-simple edital-done">
     <span className="edital-check">✓</span><h1>Seu caderno está criado! 🎉</h1>
     <p>O caderno <strong>{name}</strong> está pronto, com {created?.matched_questions??0} questões compatíveis do acervo.</p>
     <p>Quer que eu te ajude a montar uma rotina de estudos até a prova?</p>
     <div className="edital-choice">
       <button type="button" onClick={()=>onPlanNow?.(created?.notebook_id)}>Montar meu planejamento agora</button>
       <button className="light" type="button" onClick={onFinish}>Depois, quero começar a estudar</button>
     </div>
   </div>}
   {error&&<p className="form-message" role="alert">{error}</p>}
 </section>;
}

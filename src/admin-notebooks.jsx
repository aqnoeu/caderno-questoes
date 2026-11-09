import React from "react";

const STATUS={pending:"Aguardando revisão",approved:"Aprovado",official:"Efetivado",rejected:"Necessita revisão"};
const norm=(x)=>String(x||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
const formatDate=(value)=>value?new Date(value).toLocaleDateString("pt-BR"):"—";

export function AdminNotebooks({ supabase, questions = [] }) {
 const [entries,setEntries]=React.useState([]);
 const [activeId,setActiveId]=React.useState(null);
 const [selected,setSelected]=React.useState([]);
 const [search,setSearch]=React.useState("");
 const [note,setNote]=React.useState("");
 const [links,setLinks]=React.useState([]);
 const [busy,setBusy]=React.useState(false);
 const [error,setError]=React.useState("");
 const [message,setMessage]=React.useState("");

 const load=React.useCallback(async()=>{
   const {data,error:fetchError}=await supabase.from("provisional_notebook_specs")
     .select("notebook_id,user_id,topics,created_at,review_status,review_note,edital_selected_role,source_filename,edital_analysis,study_notebooks!inner(id,title,cargo,source_concurso,visibility,kind)")
     .order("created_at",{ascending:false});
   if(fetchError){setError("Não foi possível carregar a fila: "+fetchError.message);return;}
   setEntries(data||[]);
 },[supabase]);
 React.useEffect(()=>{load();},[load]);
 const active=entries.find(e=>e.notebook_id===activeId)||null;
 React.useEffect(()=>{
   if(!activeId){setLinks([]);return;}
   let valid=true;
   supabase.from("notebook_questions").select("question_id").eq("notebook_id",activeId)
     .then(({data,error:fetchError})=>{
       if(!valid)return;
       if(fetchError)setError(fetchError.message);
       else setLinks((data||[]).map(x=>x.question_id));
     });
   return()=>{valid=false;};
 },[activeId,supabase]);

 function open(item){
   setActiveId(item.notebook_id);setSelected([]);setSearch("");setNote(item.review_note||"");setError("");setMessage("");
 }
 const topics=Array.isArray(active?.topics)?active.topics:[];
 const matches=(q)=>{
   if(!q||q.is_hidden||q.is_annulled||!q.correct_option||q.correct_option==="*")return false;
   if(!topics.length)return false;
   return topics.some(t=>{
     if(norm(q.discipline)!==norm(t.discipline) && !(norm(q.discipline)==="direito"&&norm(q.subject).split(/[;|·•]/).map(x=>x.trim()).includes(norm(t.discipline))))return false;
     if(!String(t.subject||"").trim())return true;
     return String(q.subject||"").split(/[;|·•]/).some(s=>norm(s)===norm(t.subject));
   });
 };
 const available=questions.filter(q=>!links.includes(q.id)&&
   (!search.trim()?matches(q):
     (norm(q.statement)+" "+norm(q.discipline)+" "+norm(q.subject)).includes(norm(search))))
   .slice(0,120);
 function toggle(id){setSelected(current=>current.includes(id)?current.filter(x=>x!==id):[...current,id]);}
 async function authorize(){
   if(!active||!selected.length)return;
   setBusy(true);setError("");setMessage("");
   try{
     const {data,error:rpcError}=await supabase.rpc("admin_assign_provisional_questions",{p_notebook:active.notebook_id,p_question_ids:selected});
     if(rpcError)throw rpcError;
     setLinks(curr=>[...new Set([...curr,...selected])]);setSelected([]);
     setMessage((data?.linked||0)+" questão(ões) vinculada(s) ao caderno, sem duplicação.");
   }catch(err){setError(err.message);}finally{setBusy(false);}
 }
 async function review(action){
   if(!active)return;
   const actionLabel={approve:"aprovar",publish:"efetivar como oficial",reject:"solicitar revisão",reopen:"reabrir"}[action];
   if(!window.confirm("Deseja "+actionLabel+" este caderno?"))return;
   setBusy(true);setError("");setMessage("");
   try{
     const {data,error:rpcError}=await supabase.rpc("admin_review_provisional",{
       p_notebook:active.notebook_id,p_action:action,p_note:note.trim()
     });
     if(rpcError)throw rpcError;
     setMessage("Situação atualizada: "+(STATUS[data.status]||data.status)+".");
     await load();
   }catch(err){setError(err.message);}finally{setBusy(false);}
 }

 return <section className="admin-notebook-page">
   <div className="admin-notebook-heading"><div><span className="eyebrow">REVISÃO ADMINISTRATIVA</span>
     <h1>Cadernos provisórios</h1><p>Analise os editais e autorize o aproveitamento das questões, sem duplicar o acervo.</p></div>
     <button className="light" onClick={load} disabled={busy}>Atualizar</button>
   </div>
   <div className="admin-notebook-grid">
     <div className="admin-notebook-list">
       {entries.length===0&&<div className="card">Nenhum caderno provisório para análise.</div>}
       {entries.map(item=><button key={item.notebook_id} type="button"
         className={"admin-notebook-entry "+(activeId===item.notebook_id?"chosen":"")}
         onClick={()=>open(item)}>
         <strong>{item.study_notebooks?.title||"Caderno sem título"}</strong>
         <span>{item.edital_selected_role||item.study_notebooks?.cargo||"Cargo não identificado"}</span>
         <small>{STATUS[item.review_status]||"Pendente"} · {formatDate(item.created_at)}</small>
       </button>)}
     </div>
     <div className="admin-notebook-detail">
       {!active?<div className="card"><h2>Selecione um caderno</h2><p>Os pedidos serão exibidos aqui para revisão.</p></div>:<div className="card">
         <span className="eyebrow">{STATUS[active.review_status]||"Pendente"}</span>
         <h2>{active.study_notebooks?.title}</h2>
         <p><strong>Cargo original:</strong> {active.edital_selected_role||active.study_notebooks?.cargo}</p>
         <p><strong>Concurso:</strong> {active.study_notebooks?.source_concurso||active.edital_analysis?.contest||"Não informado"}</p>
         <p><strong>Origem:</strong> {active.source_filename||"Edital não identificado"} · <strong>Questões atuais:</strong> {links.length}</p>
         <details><summary>Conteúdo programático ({topics.length} entradas)</summary>
           <div className="admin-topic-list">{topics.map((t,i)=><p key={i}>{t.discipline}{t.subject?" — "+t.subject:""}</p>)}</div>
         </details>
         <h3>Autorizar questões do acervo</h3>
         <p>Questões sugeridas pertencem às disciplinas do edital. Pesquise outros registros, confira os conteúdos e selecione apenas os compatíveis.</p>
         <input className="admin-notebook-search" placeholder="Pesquisar disciplina ou trecho da questão"
           value={search} onChange={e=>setSearch(e.target.value)} aria-label="Pesquisar questões"/>
         <div className="admin-notebook-candidates">
           {available.length===0&&<p>Não foram encontradas questões para os filtros atuais.</p>}
           {available.map(q=><label key={q.id} className="admin-notebook-candidate">
             <input type="checkbox" checked={selected.includes(q.id)} onChange={()=>toggle(q.id)}/>
             <span><strong>{q.discipline||"Sem disciplina"}</strong>
               <small>{String(q.subject||"").slice(0,100)}</small>
               <span>{String(q.statement||"").slice(0,160)}</span></span>
           </label>)}
         </div>
         <button disabled={busy||selected.length===0} onClick={authorize}>Vincular {selected.length} questão(ões) selecionada(s)</button>
         <div className="admin-review-actions"><label>Observação para o aluno (opcional)
           <textarea rows="3" maxLength={800} value={note} onChange={e=>setNote(e.target.value)}/></label>
           <div>
             {active.review_status!=="official"&&<button disabled={busy} onClick={()=>review("approve")}>Aprovar caderno</button>}
             {active.review_status==="approved"&&<button disabled={busy||links.length===0} onClick={()=>review("publish")}>Efetivar como oficial</button>}
             {active.review_status!=="rejected"&&active.review_status!=="official"&&
               <button className="light" disabled={busy} onClick={()=>review("reject")}>Solicitar revisão</button>}
             {active.review_status==="rejected"&&<button className="light" disabled={busy} onClick={()=>review("reopen")}>Reabrir análise</button>}
           </div>
         </div>
         {message&&<p className="form-message">{message}</p>}
       </div>}
       {error&&<p className="form-message" role="alert">{error}</p>}
     </div>
   </div>
 </section>;
}

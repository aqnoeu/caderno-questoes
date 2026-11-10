import React from "react";

const STATUS={pending:"Aguardando revisão",approved:"Aprovado",official:"Efetivado",rejected:"Necessita revisão"};
const norm=(x)=>String(x||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
const formatDate=(value)=>value?new Date(value).toLocaleDateString("pt-BR"):"—";

export function AdminNotebooks({ supabase, questions = [], focusNotebookId = null }) {
 const [entries,setEntries]=React.useState([]);
 const [activeId,setActiveId]=React.useState(null);
 const [selected,setSelected]=React.useState([]);
 const [search,setSearch]=React.useState("");
 const [note,setNote]=React.useState("");
 const [links,setLinks]=React.useState([]);
 const [foundQuestions,setFoundQuestions]=React.useState([]);
 const [suggestions,setSuggestions]=React.useState(null);
 const [matchingBusy,setMatchingBusy]=React.useState(false);
 const [busy,setBusy]=React.useState(false);
 const [error,setError]=React.useState("");
 const [message,setMessage]=React.useState("");

 const load=React.useCallback(async()=>{
   const {data,error:fetchError}=await supabase.from("provisional_notebook_specs")
     .select("notebook_id,user_id,topics,created_at,review_status,review_note,edital_selected_role,source_filename,edital_analysis,study_notebooks!inner(id,title,cargo,source_concurso,visibility,kind)")
     .order("created_at",{ascending:false});
   if(fetchError){setError("Não foi possível carregar a fila: "+fetchError.message);return;}
   let list=data||[];
   if(focusNotebookId&&!list.some(item=>item.notebook_id===focusNotebookId)){
     const {data:book,error:bookError}=await supabase.from("study_notebooks").select("id,title,code,cargo,source_concurso,visibility,kind").eq("id",focusNotebookId).maybeSingle();
     if(bookError){setError(bookError.message);return;}
     if(book)list=[{notebook_id:book.id,study_notebooks:book},...list];
   }
   setEntries(list);
 },[supabase,focusNotebookId]);
 React.useEffect(()=>{load();},[load]);
 React.useEffect(()=>{
   if(focusNotebookId && entries.some(item=>item.notebook_id===focusNotebookId)){
     setActiveId(focusNotebookId);setSuggestions(null);setSelected([]);
   }
 },[focusNotebookId,entries]);
 const active=entries.find(e=>e.notebook_id===activeId)||null;
 React.useEffect(()=>{
   setLinks([]);
   if(!activeId)return;
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
   setActiveId(item.notebook_id);setSelected([]);setSuggestions(null);setSearch("");setNote(item.review_note||"");setError("");setMessage("");
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
 const suggestionsMap=new Map((suggestions||[]).map(s=>[s.question_id,s]));
 const compatibleSearch=topics.length>0||active?.study_notebooks?.code==="oab";
 const available=(suggestions!==null?foundQuestions:questions).filter(q=>!links.includes(q.id)&&!q.is_hidden&&!q.is_annulled&&q.correct_option&&q.correct_option!=="*"&&
   (suggestions!==null?suggestionsMap.has(q.id):
      (!search.trim()&&topics.length?matches(q):true)) &&
   (!search.trim()||(norm(q.statement)+" "+norm(q.discipline)+" "+norm(q.subject)+" "+norm(q.subjects?.join(" "))).includes(norm(search))))
   .sort((a,b)=>suggestions===null?0:(suggestionsMap.get(b.id)?.match_score||0)-(suggestionsMap.get(a.id)?.match_score||0))
   .slice(0,150);
 async function analyzeCompatibility(){
   if(!active)return;
   setMatchingBusy(true);setError("");setMessage("");setSelected([]);
   try{
     const {data,error:err}=await supabase.rpc("admin_notebook_candidates",{p_notebook:active.notebook_id,p_limit:150});
     if(err)throw err;
     const candidates=data||[];
     if(candidates.length){
       const {data:rows,error:rowsError}=await supabase.from("questions")
         .select("id,discipline,subject,subjects,statement,is_hidden,is_annulled,correct_option")
         .in("id",candidates.map(candidate=>candidate.question_id));
       if(rowsError)throw rowsError;
       setFoundQuestions(rows||[]);
     }else setFoundQuestions([]);
     setSearch("");setSuggestions(candidates);
     setMessage(candidates.length+" questão(ões) encontrada(s). Selecione as que deseja adicionar.");
   }catch(err){setError("Não foi possível pesquisar o acervo: "+err.message);}
   finally{setMatchingBusy(false);}
 }
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
     <h1>{focusNotebookId?"Gerenciar questões do caderno":"Solicitações de cadernos"}</h1><p>Revise os editais, identifique questões compatíveis e autorize o aproveitamento manualmente.</p></div>
     <button className="light" onClick={load} disabled={busy}>Atualizar</button>
   </div>
   <div className="admin-notebook-grid">
     <div className="admin-notebook-list">
       {entries.length===0&&<div className="card">Nenhum caderno provisório para análise.</div>}
       {entries.map(item=><button key={item.notebook_id} type="button"
         className={"admin-notebook-entry "+(activeId===item.notebook_id?"chosen":"")}
         disabled={busy||matchingBusy} onClick={()=>open(item)}>
         <strong>{item.study_notebooks?.title||"Caderno sem título"}</strong>
         <span>{item.edital_selected_role||item.study_notebooks?.cargo||"Cargo não identificado"}</span>
         <small>{STATUS[item.review_status]||"Pendente"} · {formatDate(item.created_at)}</small>
       </button>)}
     </div>
     <div className="admin-notebook-detail">
       {!active?<div className="card"><h2>Selecione um caderno</h2><p>Os pedidos serão exibidos aqui para revisão.</p></div>:<div className="card">
         <span className="eyebrow">{STATUS[active.review_status]||"Caderno existente"}</span>
         <h2>{active.study_notebooks?.title}</h2>
         <p><strong>Cargo original:</strong> {active.edital_selected_role||active.study_notebooks?.cargo}</p>
         <p><strong>Concurso:</strong> {active.study_notebooks?.source_concurso||active.edital_analysis?.contest||"Não informado"}</p>
         <p><strong>Origem:</strong> {active.source_filename||"Edital não identificado"} · <strong>Questões atuais:</strong> {links.length}</p>
         <details><summary>Conteúdo programático ({topics.length} entradas)</summary>
           <div className="admin-topic-list">{topics.map((t,i)=><p key={i}>{t.discipline}{t.subject?" — "+t.subject:""}</p>)}</div>
         </details>
         <h3>Autorizar questões do acervo</h3>
         <p>A pesquisa por filtros utiliza apenas matérias e assuntos já cadastrados. Não consome chamadas de IA nem altera questões automaticamente.</p>
         <div className="admin-match-controls">
           {compatibleSearch&&<button type="button" disabled={matchingBusy||busy} onClick={analyzeCompatibility}>
             {matchingBusy?"Pesquisando…":"Analisar questões compatíveis"}
           </button>}
           {suggestions!==null&&<button type="button" className="light" onClick={()=>{setSuggestions(null);setSelected([]);setSearch("");}}>Voltar à busca manual</button>}
         </div>
         <input className="admin-notebook-search" placeholder="Pesquisar disciplina ou trecho da questão"
           value={search} onChange={e=>setSearch(e.target.value)} aria-label="Pesquisar questões"/>
         <div className="admin-match-controls">
           <button type="button" className="light" disabled={busy||matchingBusy||!available.length} onClick={()=>setSelected(available.slice(0,100).map(q=>q.id))}>
             {suggestions!==null?"Selecionar encontradas":"Selecionar exibidas"}{available.length>100?" (até 100)":""}
           </button>
           <button type="button" className="light" disabled={busy||matchingBusy||!selected.length} onClick={()=>setSelected([])}>Limpar seleção</button>
           <button type="button" disabled={busy||matchingBusy||!selected.length||selected.length>100} onClick={authorize}>
             Adicionar selecionadas ao caderno ({selected.length})
           </button>
         </div>
         <div className="admin-notebook-candidates">
           {available.length===0&&<p>Não foram encontradas questões para os filtros atuais.</p>}
           {available.map(q=><label key={q.id} className="admin-notebook-candidate">
             <input type="checkbox" checked={selected.includes(q.id)} disabled={busy||matchingBusy||(!selected.includes(q.id)&&selected.length>=100)} onChange={()=>toggle(q.id)}/>
             <span><strong>{q.discipline||"Sem disciplina"}</strong>
               {suggestionsMap.has(q.id)&&<small className="admin-match-score">
                 {suggestionsMap.get(q.id)?.match_score>=80?"Correspondência direta":"Correspondência sugerida"}
                 {" · "}{suggestionsMap.get(q.id)?.match_reason}
                 {" · Edital: "}{suggestionsMap.get(q.id)?.matched_topic}
               </small>}
               <small>{String(q.subject||"").slice(0,100)}</small>
               <span>{String(q.statement||"").slice(0,160)}</span></span>
           </label>)}
         </div>
         {active.review_status&&<div className="admin-review-actions"><label>Observação para o aluno (opcional)
           <textarea rows="3" maxLength={800} value={note} onChange={e=>setNote(e.target.value)}/></label>
           <div>
             {active.review_status!=="official"&&<button disabled={busy} onClick={()=>review("approve")}>Aprovar caderno</button>}
             {active.review_status==="approved"&&<button disabled={busy||links.length===0} onClick={()=>review("publish")}>Efetivar como oficial</button>}
             {active.review_status!=="rejected"&&active.review_status!=="official"&&
               <button className="light" disabled={busy} onClick={()=>review("reject")}>Solicitar revisão</button>}
             {active.review_status==="rejected"&&<button className="light" disabled={busy} onClick={()=>review("reopen")}>Reabrir análise</button>}
           </div>
         </div>}
         {message&&<p className="form-message">{message}</p>}
       </div>}
       {error&&<p className="form-message" role="alert">{error}</p>}
     </div>
   </div>
 </section>;
}

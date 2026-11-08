import React from "react";

export function useNotebooks(supabase, userId) {
  const [catalog, setCatalog] = React.useState([]);
  const [memberships, setMemberships] = React.useState([]);
  const [notebook, setNotebook] = React.useState(null);
  const [questionIds, setQuestionIds] = React.useState([]);
  const [essayIds, setEssayIds] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [message, setMessage] = React.useState("");
  const refresh = React.useCallback(async (preferredId = null) => {
    if (!userId) { setLoading(false); return; }
    setLoading(true);
    const [books, membershipsResult] = await Promise.all([
      supabase.from("study_notebooks").select("id,code,title,kind,visibility,source_concurso").order("title"),
      supabase.from("user_notebooks").select("notebook_id,last_opened_at").eq("user_id",userId).order("last_opened_at",{ascending:false}),
    ]);
    if (books.error || membershipsResult.error) { setMessage(books.error?.message || membershipsResult.error?.message); setLoading(false); return; }
    const list = books.data || [], memberList = membershipsResult.data || [];
    setCatalog(list); setMemberships(memberList);
    const selected = list.find(book => book.id === preferredId && memberList.some(m => m.notebook_id === book.id)) ||
      list.find(book => book.id === memberList[0]?.notebook_id) || null;
    setNotebook(selected);
    if (selected) {
      const [q,e] = await Promise.all([
        supabase.from("notebook_questions").select("question_id").eq("notebook_id",selected.id),
        supabase.from("notebook_essays").select("essay_question_id").eq("notebook_id",selected.id),
      ]);
      if (q.error || e.error) setMessage(q.error?.message || e.error?.message);
      setQuestionIds((q.data || []).map(x=>x.question_id));
      setEssayIds((e.data || []).map(x=>x.essay_question_id));
    } else {setQuestionIds([]);setEssayIds([]);}
    setLoading(false);
  },[supabase,userId]);
  React.useEffect(()=>{refresh();},[refresh]);
  async function open(book) {
    if (!userId) return;
    setMessage("");
    const member=memberships.some(item=>item.notebook_id===book.id);
    if (!member && memberships.length>=5) {setMessage("Você pode ter até cinco cadernos. Remova um antes de adicionar outro.");return;}
    if (!member) {
      const {error}=await supabase.from("user_notebooks").insert({user_id:userId,notebook_id:book.id});
      if(error){setMessage(error.message);return;}
    } else {
      const {error}=await supabase.from("user_notebooks").update({last_opened_at:new Date().toISOString()}).eq("user_id",userId).eq("notebook_id",book.id);
      if(error){setMessage(error.message);return;}
    }
    await refresh(book.id);
  }
  async function remove(book) {
    if (!userId) return;
    const {error}=await supabase.from("user_notebooks").delete().eq("user_id",userId).eq("notebook_id",book.id);
    if(error){setMessage(error.message);return;}
    await refresh();
  }
  return {catalog,memberships,notebook,questionIds,essayIds,loading,message,open,remove};
}

export function NotebookWelcome({ state }) {
  return <section className="card" style={{maxWidth:750,margin:"22px auto",padding:26}}>
    <span className="eyebrow">MEUS CADERNOS</span>
    <h1>Qual caderno vamos estudar primeiro?</h1>
    <p>Escolha o seu primeiro caderno. Você poderá adicionar outros depois, até o limite de cinco, mantendo o progresso separado.</p>
    {state.loading ? <p>Carregando cadernos…</p> : <div className="system2-module-grid">
      {state.catalog.map(book=><article className="card system2-module" key={book.id}>
        <h2>{book.title}</h2><p>{book.kind==="general"?"Estudo geral, com questões de diferentes edições e concursos.":"Preparação específica."}</p>
        <button onClick={()=>state.open(book)}>Escolher caderno →</button>
      </article>)}
    </div>}
    {state.message && <p className="form-message">{state.message}</p>}
  </section>;
}

export function NotebookSwitcher({ state }) {
  const [expanded,setExpanded]=React.useState(false);
  if(!state.notebook)return null;
  const joined=new Set(state.memberships.map(m=>m.notebook_id));
  return <section className="card" style={{padding:"12px 18px",marginBottom:18}}>
    <div style={{display:"flex",gap:12,alignItems:"center",flexWrap:"wrap",justifyContent:"space-between"}}>
      <div><span className="eyebrow">CADERNO ATIVO</span><div><strong>{state.notebook.title}</strong> <small>· {state.memberships.length}/5 cadernos</small></div></div>
      <button className="light compact" onClick={()=>setExpanded(v=>!v)}>{expanded?"Fechar":"Trocar ou adicionar caderno"}</button>
    </div>
    {expanded&&<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))",gap:12,marginTop:16}}>
      {state.catalog.map(book=><div key={book.id} style={{border:"1px solid var(--border,#dce3ef)",padding:12,borderRadius:12}}>
        <b>{book.title}</b><p style={{fontSize:12}}>{book.id===state.notebook.id?"Em uso":joined.has(book.id)?"Adicionado":"Disponível"}</p>
        <button className="compact" disabled={book.id===state.notebook.id} onClick={()=>{state.open(book);setExpanded(false);}}>{joined.has(book.id)?"Abrir":"Adicionar"}</button>
        {joined.has(book.id)&&book.id!==state.notebook.id&&<button className="light compact" onClick={()=>state.remove(book)} style={{marginLeft:6}}>Remover</button>}
      </div>)}
    </div>}
    {state.message&&<p className="form-message">{state.message}</p>}
  </section>;
}

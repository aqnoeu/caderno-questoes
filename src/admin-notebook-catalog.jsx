import React from "react";

const KIND={general:"Geral",contest:"Concurso",provisional:"Provisório"};
const REVIEW={pending:"Aguardando",approved:"Aprovado",official:"Efetivado",rejected:"Revisão solicitada"};

export function AdminNotebookCatalog({supabase,onReview}){
 const [items,setItems]=React.useState([]);
 const [search,setSearch]=React.useState("");
 const [filter,setFilter]=React.useState("all");
 const [current,setCurrent]=React.useState(null);
 const [title,setTitle]=React.useState("");
 const [loading,setLoading]=React.useState(true);
 const [saving,setSaving]=React.useState(false);
 const [error,setError]=React.useState("");
 const [notice,setNotice]=React.useState("");

 const refresh=React.useCallback(async()=>{
  setLoading(true);setError("");
  const {data,error:err}=await supabase.rpc("admin_notebook_catalog");
  if(err)setError(err.message);else setItems(Array.isArray(data)?data:[]);
  setLoading(false);
 },[supabase]);
 React.useEffect(()=>{refresh();},[refresh]);
 const active=items.find(x=>x.id===current)||null;
 const filtered=items.filter(item=>{
  if(filter!=="all"&&item.kind!==filter)return false;
  const key=[item.title,item.cargo,item.source_concurso].join(" ").toLocaleLowerCase("pt-BR");
  return key.includes(search.toLocaleLowerCase("pt-BR").trim());
 });
 const totals={
  all:items.length,provisional:items.filter(x=>x.kind==="provisional").length,
  official:items.filter(x=>x.visibility==="official").length,
  pending:items.filter(x=>x.review_status==="pending").length,
 };
 function select(item){setCurrent(item.id);setTitle(item.title);setError("");setNotice("");}
 async function rename(event){
  event.preventDefault();
  if(!active||!title.trim()||title.trim()===active.title)return;
  if(!window.confirm("Alterar o nome de exibição deste caderno? As questões e históricos serão preservados."))return;
  setSaving(true);setError("");setNotice("");
  const {error:err}=await supabase.rpc("admin_rename_notebook",{p_id:active.id,p_title:title.trim()});
  if(err)setError(err.message);
  else {setNotice("Nome atualizado. A identidade do caderno e os resultados foram preservados.");await refresh();}
  setSaving(false);
 }
 return <section className="admin-catalog">
  <div className="admin-notebook-heading"><div><span className="eyebrow">GESTÃO DO ACERVO</span>
   <h1>Todos os cadernos</h1><p>Organize os cadernos, confira seus vínculos e acompanhe as solicitações.</p></div>
   <button className="light" type="button" disabled={loading} onClick={refresh}>Atualizar</button>
  </div>
  <div className="admin-catalog-stats">
   <article><strong>{totals.all}</strong><span>Cadernos</span></article>
   <article><strong>{totals.official}</strong><span>Visíveis no acervo</span></article>
   <article><strong>{totals.provisional}</strong><span>Provisórios</span></article>
   <article><strong>{totals.pending}</strong><span>Aguardando revisão</span></article>
  </div>
  <div className="admin-catalog-filters">
   <input aria-label="Pesquisar cadernos" placeholder="Pesquisar pelo nome, concurso ou cargo…" value={search} onChange={e=>setSearch(e.target.value)}/>
   <select aria-label="Tipo de caderno" value={filter} onChange={e=>setFilter(e.target.value)}>
    <option value="all">Todos os tipos</option><option value="general">Cadernos gerais</option>
    <option value="contest">Cadernos de concursos</option><option value="provisional">Provisórios</option>
   </select>
  </div>
  <div className="admin-catalog-layout">
   <div className="admin-catalog-list">
    {loading&&<p>Carregando cadernos…</p>}
    {!loading&&!filtered.length&&<p>Nenhum caderno encontrado.</p>}
    {filtered.map(item=><button type="button" key={item.id} className={"admin-catalog-entry"+(item.id===current?" chosen":"")} onClick={()=>select(item)}>
     <span><strong>{item.title}</strong><small>{item.cargo||item.source_concurso||"Caderno geral"}</small></span>
     <span><span>{KIND[item.kind]||item.kind}</span><small>{item.question_count} questões · {item.student_count} aluno(s)</small></span>
    </button>)}
   </div>
   <div className="admin-catalog-details">
    {!active?<div className="card"><h2>Selecione um caderno</h2><p>Os detalhes e controles aparecerão aqui.</p></div>:
    <div className="card">
     <span className="eyebrow">IDENTIDADE E VÍNCULOS</span>
     <h2>{active.title}</h2>
     <div className="admin-catalog-meta">
      <span>Tipo: <strong>{KIND[active.kind]||active.kind}</strong></span>
      <span>Visibilidade: <strong>{active.visibility==="official"?"Disponível":"Privado"}</strong></span>
      <span>Questões: <strong>{active.question_count}</strong></span>
      <span>Alunos: <strong>{active.student_count}</strong></span>
      {active.review_status&&<span>Revisão: <strong>{REVIEW[active.review_status]||active.review_status}</strong></span>}
      {active.edital_topic_count>0&&<span>Entradas do edital: <strong>{active.edital_topic_count}</strong></span>}
     </div>
     <form className="admin-catalog-rename" onSubmit={rename}>
      <label>Nome exibido aos alunos<input minLength={4} maxLength={120} required value={title} onChange={e=>setTitle(e.target.value)}/></label>
      <button disabled={saving||!title.trim()||title.trim()===active.title}>{saving?"Salvando…":"Salvar nome"}</button>
     </form>
     <p className="admin-catalog-safety">Alterar o título não modifica o concurso, o cargo de origem, as questões vinculadas ou o histórico dos alunos.</p>
     {active.review_status&&<button type="button" className="light" onClick={()=>onReview(active.id)}>Analisar edital e questões deste caderno</button>}
     {notice&&<p className="form-message">{notice}</p>}
    </div>}
   </div>
  </div>
  {error&&<p role="alert" className="form-message">{error}</p>}
 </section>;
}

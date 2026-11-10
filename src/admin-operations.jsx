import React from "react";
import { SupportCampaigns } from "./support-campaigns";

const studentMetrics=[
 ["students","Alunos cadastrados"],["new_students_30d","Novos alunos em 30 dias"],
 ["active_students_30d","Alunos que responderam em 30 dias"],["students_with_notebooks","Alunos com caderno"],
 ["student_answers_30d","Respostas de alunos em 30 dias"],
];
const libraryMetrics=[
 ["notebooks","Cadernos criados"],["published_notebooks","Cadernos disponíveis"],
 ["provisional","Cadernos provisórios"],["pending","Aguardando aprovação"],
 ["questions","Questões disponíveis"],["essays","Discursivas cadastradas"],
 ["cycles","Ciclos iniciados"],["completed_cycles","Ciclos concluídos"],["memberships","Vínculos aluno/caderno"]
];
export function AdminAnalytics({supabase}){
 const [stats,setStats]=React.useState(null);
 const [error,setError]=React.useState("");
 const [loading,setLoading]=React.useState(true);
 const reload=React.useCallback(async()=>{
  setLoading(true);
  const {data,error:err}=await supabase.rpc("admin_platform_metrics");
  if(err)setError(err.message);else{setError("");setStats(data);}
  setLoading(false);
 },[supabase]);
 React.useEffect(()=>{reload();},[reload]);
 return <section className="admin-analysis-page">
  <div className="admin-notebook-heading"><div><span className="eyebrow">ANÁLISE</span>
   <h1>Visão da plataforma</h1><p>Indicadores gerais do Caderno de Questões, sem expor resultados individuais.</p></div>
   <button type="button" className="light" disabled={loading} onClick={reload}>Atualizar</button>
  </div>
  {loading&&<p>Carregando indicadores…</p>}
  {stats&&<>{[["Alunos e atividade",studentMetrics],["Cadernos e acervo",libraryMetrics]].map(([heading,metrics])=>
   <section key={heading}>
    <h2>{heading}</h2>
    <div className="admin-analysis-grid">{metrics.map(([key,label])=>
     <article className="card" key={key}><small>{label}</small><strong>{stats[key]==null?"—":Number(stats[key]).toLocaleString("pt-BR")}</strong></article>)}</div>
   </section>)}</>}

  {error&&<p role="alert" className="form-message">{error}</p>}
 </section>;
}

const VALID_SUPPORT_URL=(raw)=>{
 try{
  const u=new URL(raw);
  return u.protocol==="https:"&&["apoia.se","www.apoia.se","vakinha.com.br","www.vakinha.com.br"].includes(u.hostname)&&u.pathname.length>1;
 }catch{return false;}
};
const PIX_KEY = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export function AdminFinance({supabase}){
 const [settings,setSettings]=React.useState(null),[draft,setDraft]=React.useState(null);
 const [section,setSection]=React.useState("page"),[metrics,setMetrics]=React.useState(null);
 const [busy,setBusy]=React.useState(false),[message,setMessage]=React.useState("");
 React.useEffect(()=>{
  let active=true;
  supabase.from("project_support_settings").select("enabled,support_url,pix_key,page_title,page_message").eq("id",1).single()
   .then(({data,error})=>{if(active){setSettings(data);setDraft(data);if(error)setMessage(error.message);}});
  return()=>{active=false;};
 },[supabase]);
 React.useEffect(()=>{
  if(section!=="page")return;
  let active=true;
  supabase.rpc("admin_support_metrics").then(({data})=>{if(active)setMetrics(data);});
  return()=>{active=false;};
 },[supabase,section]);
 const patch=(field,value)=>setDraft(current=>({...current,[field]:value}));
 async function save(event){
  event.preventDefault();
  const next={...draft, support_url:draft.support_url?.trim()||null, pix_key:draft.pix_key?.trim()||null,
    page_title:draft.page_title.trim(), page_message:draft.page_message.trim()};
  if(next.pix_key&&!PIX_KEY.test(next.pix_key))return setMessage("Informe uma chave Pix aleatória no formato fornecido pelo banco.");
  if(next.support_url&&!VALID_SUPPORT_URL(next.support_url))return setMessage("Use um link HTTPS da APOIA.se ou Vakinha.");
  if(next.enabled&&!next.support_url&&!next.pix_key)return setMessage("Informe um meio de contribuição para ativar a página.");
  setBusy(true);setMessage("");
  try {
   const {data,error}=await supabase.from("project_support_settings").update(next).eq("id",1)
    .select("enabled,support_url,pix_key,page_title,page_message").single();
   if(error)throw error;
   setSettings(data);setDraft(data);setMessage("Página de apoio atualizada.");
  } catch(error){setMessage(error.message);} finally{setBusy(false);}
 }
 return <section className="admin-finance-page">
  <div><span className="eyebrow">FINANCEIRO</span><h1>Apoio voluntário</h1>
   <p>Edite a página do aluno e organize os convites de apoio.</p></div>
  <nav className="admin-finance-actions" aria-label="Apoio voluntário">
   <button type="button" className={section==="page"?"":"light"} aria-pressed={section==="page"} onClick={()=>setSection("page")}>Página de apoio</button>
   <button type="button" className={section==="campaigns"?"":"light"} aria-pressed={section==="campaigns"} onClick={()=>setSection("campaigns")}>Campanhas</button>
  </nav>
  {section==="page"&&metrics&&<div className="admin-analysis-grid finance-metrics">
   {[["users_total","Alunos cadastrados"],["opted_out","Avisos desativados"],["notices_created","Avisos registrados"],["notices_read","Avisos lidos"],["notices_unread","Avisos não lidos"]].map(([key,label])=>
    <article className="card" key={key}><small>{label}</small><strong>{Number(metrics[key]||0).toLocaleString("pt-BR")}</strong></article>)}
  </div>}
  {section==="campaigns" ? <SupportCampaigns supabase={supabase} enabled={settings?.enabled}/> : draft &&
   <form className="card admin-finance-settings" onSubmit={save}>
    <h2>Editar página de apoio</h2>
    <label>Título<input required maxLength={120} value={draft.page_title} disabled={busy} onChange={e=>patch("page_title",e.target.value)}/></label>
    <label>Mensagem<textarea required rows={6} maxLength={3000} value={draft.page_message} disabled={busy} onChange={e=>patch("page_message",e.target.value)}/></label>
    <label>Chave Pix aleatória<input maxLength={36} autoComplete="off" value={draft.pix_key||""} disabled={busy} onChange={e=>patch("pix_key",e.target.value)}/></label>
    <small>Copie a chave aleatória gerada no app do seu banco.</small>
    <label>Link da campanha<input type="url" maxLength={500} placeholder="https://apoia.se/sua-campanha" value={draft.support_url||""} disabled={busy} onChange={e=>patch("support_url",e.target.value)}/></label>
    <label className="admin-finance-switch"><input type="checkbox" checked={draft.enabled} disabled={busy} onChange={e=>patch("enabled",e.target.checked)}/> Disponibilizar a página de apoio aos alunos</label>
    <button type="submit" disabled={busy||JSON.stringify(draft)===JSON.stringify(settings)}>Salvar página</button>
   </form>}
  {message&&<p role="status" className="form-message">{message}</p>}
 </section>;
}

export function StudentSupport({supabase,onBack}){
 const [settings,setSettings]=React.useState(null),[status,setStatus]=React.useState("");
 React.useEffect(()=>{
  let active=true;
  supabase.from("project_support_settings").select("enabled,support_url,pix_key,page_title,page_message").eq("id",1).single()
   .then(({data,error})=>{if(active){setSettings(data);if(error)setStatus("Não foi possível carregar a página de apoio.");}});
  return()=>{active=false;};
 },[supabase]);
 async function copyPix(){
  try{await navigator.clipboard.writeText(settings.pix_key);setStatus("Chave Pix copiada.");}
  catch{setStatus("Selecione e copie a chave Pix exibida acima.");}
 }
 return <section className="card student-support">
  <span className="eyebrow">APOIE O PROJETO</span>
  <h1>{settings?.page_title||"Ajude o Caderno de Questões a crescer 💙"}</h1>
  {settings?.page_message&&<p className="support-message">{settings.page_message}</p>}
  <p><strong>Contribuir é totalmente opcional.</strong> Você continuará com acesso às mesmas funcionalidades, independentemente de apoiar.</p>
  {settings?.enabled&&PIX_KEY.test(settings.pix_key||"")&&
   <div className="support-pix"><p>Pix de valor livre</p><code>{settings.pix_key}</code><button type="button" onClick={copyPix}>Copiar chave Pix</button></div>}
  {settings?.enabled&&VALID_SUPPORT_URL(settings.support_url)&&
   <a href={settings.support_url} target="_blank" rel="noopener noreferrer" className="student-support-link">Conhecer a campanha de apoio ↗</a>}
  {settings&&!settings.enabled&&<p>A campanha de apoio ainda não está disponível.</p>}
  {status&&<p role="status">{status}</p>}
  <button className="light" type="button" onClick={onBack}>Voltar aos estudos</button>
 </section>;
}

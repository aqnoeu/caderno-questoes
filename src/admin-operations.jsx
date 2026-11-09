import React from "react";

const metricTitles=[
 ["students","Alunos cadastrados"],["new_students_30d","Novos alunos (30 dias)"],
 ["notebooks","Cadernos criados"],["published_notebooks","Cadernos disponíveis"],
 ["provisional","Cadernos provisórios"],["pending","Aguardando aprovação"],
 ["questions","Questões disponíveis"],["essays","Discursivas cadastradas"],
 ["cycles","Ciclos de estudo"],["memberships","Vínculos aluno/caderno"]
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
  {stats&&<div className="admin-analysis-grid">{metricTitles.map(([key,label])=>
   <article className="card" key={key}><small>{label}</small><strong>{Number(stats[key]||0).toLocaleString("pt-BR")}</strong></article>)}</div>}
  {error&&<p role="alert" className="form-message">{error}</p>}
 </section>;
}

const VALID_SUPPORT_URL=(raw)=>{
 try{
  const u=new URL(raw);
  return u.protocol==="https:"&&["apoia.se","www.apoia.se","vakinha.com.br","www.vakinha.com.br"].includes(u.hostname)&&u.pathname.length>1;
 }catch{return false;}
};
export function AdminFinance({supabase}){
 const [settings,setSettings]=React.useState(null),[metrics,setMetrics]=React.useState(null);
 const [url,setUrl]=React.useState(""),[enabled,setEnabled]=React.useState(false);
 const [busy,setBusy]=React.useState(false),[error,setError]=React.useState(""),[notice,setNotice]=React.useState("");
 const reload=React.useCallback(async()=>{
  const [a,b]=await Promise.all([
   supabase.from("project_support_settings").select("enabled,support_url,campaign_version,updated_at").eq("id",1).single(),
   supabase.rpc("admin_support_metrics")
  ]);
  if(a.error||b.error){setError(a.error?.message||b.error?.message);return;}
  setSettings(a.data);setMetrics(b.data);
  setUrl(a.data?.support_url||"");setEnabled(Boolean(a.data?.enabled));setError("");
 },[supabase]);
 React.useEffect(()=>{reload();},[reload]);
 async function save(e){
  e.preventDefault();setBusy(true);setError("");setNotice("");
  const {error:err}=await supabase.rpc("admin_configure_project_support",{p_url:url.trim()||null,p_enabled:enabled});
  if(err)setError(err.message);else{await reload();setNotice("Configuração salva. Nenhuma notificação foi enviada automaticamente.");}
  setBusy(false);
 }
 async function send(){
  if(!settings?.enabled||!settings?.support_url)return;
  if(!window.confirm("Enviar uma única notificação voluntária aos alunos que não desativaram avisos de apoio?"))return;
  setBusy(true);setError("");setNotice("");
  const {data,error:err}=await supabase.rpc("admin_send_support_notice");
  if(err)setError(err.message);
  else{setNotice((data?.created||0)+" nova(s) notificação(ões) registrada(s). Consulte o relatório de leitura abaixo.");await reload();}
  setBusy(false);
 }
 const changed=url.trim()!==(settings?.support_url||"")||enabled!==Boolean(settings?.enabled);
 return <section className="admin-finance-page">
  <div><span className="eyebrow">FINANCEIRO</span><h1>Apoio voluntário</h1>
   <p>Acompanhe avisos de ajuda de custo. O Caderno permanece gratuito e este painel não processa pagamentos.</p></div>
  <div className="admin-analysis-grid finance-metrics">
   {[["users_total","Alunos elegíveis"],["opted_out","Avisos desativados"],["notices_created","Notificações criadas"],["notices_read","Marcadas como lidas"],["notices_unread","Não lidas"]].map(([key,label])=>
    <article className="card" key={key}><small>{label}</small><strong>{Number(metrics?.[key]||0).toLocaleString("pt-BR")}</strong></article>)}
  </div>
  <p className="admin-finance-note">“Notificação criada” significa que o aviso foi salvo no site. “Lida” significa que o aluno abriu a notificação, não que tenha doado ou lido todo o conteúdo.</p>
  <form className="card admin-finance-settings" onSubmit={save}>
   <h2>Configurar a campanha</h2>
   <p>Use um link de campanha próprio da APOIA.se ou Vakinha. Não cadastre dados bancários ou CPF publicamente.</p>
   <label>Link seguro da campanha<input inputMode="url" type="url" placeholder="https://apoia.se/sua-campanha" value={url}
    onChange={e=>setUrl(e.target.value)} maxLength={500}/></label>
   <label className="admin-finance-switch"><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/>
     Disponibilizar a página de apoio aos alunos</label>
   <div className="admin-finance-actions"><button type="submit" disabled={busy||(enabled&&!VALID_SUPPORT_URL(url))||(!changed)}>Salvar configuração</button>
    <button type="button" className="light" onClick={send} disabled={busy||changed||!settings?.enabled||!settings?.support_url}>Enviar aviso de apoio</button></div>
   {settings&&<small>Campanha #{settings.campaign_version}. Reenviar a mesma campanha não gera notificações duplicadas.</small>}
   {notice&&<p className="form-message">{notice}</p>}
   {error&&<p role="alert" className="form-message">{error}</p>}
  </form>
 </section>;
}

export function StudentSupport({supabase,onBack}){
 const [settings,setSettings]=React.useState(null);
 React.useEffect(()=>{
  let active=true;
  supabase.from("project_support_settings").select("enabled,support_url").eq("id",1).single()
   .then(({data})=>{if(active)setSettings(data||{});});
  return()=>{active=false;};
 },[supabase]);
 return <section className="card student-support">
  <span className="eyebrow">APOIE O PROJETO</span>
  <h1>Ajude o Caderno de Questões a crescer 💙</h1>
  <p>Estamos construindo uma plataforma de estudo independente. Se ela estiver ajudando você e quiser contribuir com a manutenção, melhorias e custos de tecnologia, seu apoio é bem-vindo.</p>
  <p><strong>Contribuir é totalmente opcional.</strong> Você continuará com acesso às mesmas funcionalidades, independentemente de apoiar.</p>
  {settings?.enabled&&VALID_SUPPORT_URL(settings?.support_url)&&
   <a href={settings.support_url} target="_blank" rel="noopener noreferrer" className="student-support-link">Conhecer a campanha de apoio ↗</a>}
  {!settings?.enabled&&<p>A campanha de apoio ainda não está disponível.</p>}
  <button className="light" type="button" onClick={onBack}>Voltar aos estudos</button>
 </section>;
}

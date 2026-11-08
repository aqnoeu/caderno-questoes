import React from "react";

const OPTIONS = [
  { value:"groq", label:"Groq (gpt-oss-120b)" },
  { value:"gemini", label:"Gemini" },
];
const FIELDS = [
  ["first_pass_provider", "Análise inicial das objetivas", "Classificação, disciplina, assuntos e regra central"],
  ["reasoning_provider", "Diagnóstico das alternativas", "Raciocínio equivocado, conteúdo-base e explicação jurídica"],
  ["essay_import_provider", "Importação de discursivas", "Organização dos espelhos e critérios de pontuação"],
  ["piece_import_provider", "Importação de peças práticas", "Separação e organização inicial dos espelhos"],
];
export function AiProviderSettings({ supabase }) {
  const [settings,setSettings] = React.useState(null);
  const [message,setMessage] = React.useState("");
  const [busy,setBusy] = React.useState(false);
  React.useEffect(() => {
    let active=true;
    supabase.from("ai_provider_settings").select("*").eq("id",true).single().then(({data,error}) => {
      if(!active)return;
      if(error)setMessage(error.message);
      else setSettings(data);
    });
    return () => { active=false; };
  },[supabase]);
  async function update(field,value) {
    setBusy(true);
    const {error}=await supabase.from("ai_provider_settings").update({[field]:value,updated_at:new Date().toISOString()}).eq("id",true);
    if(error)setMessage(error.message);
    else {setSettings(old=>({...old,[field]:value}));setMessage("Provedor atualizado. As próximas análises usarão esta configuração.");}
    setBusy(false);
  }
  return <section className="system2-page">
    <span className="eyebrow">CONFIGURAÇÃO ADMINISTRATIVA</span>
    <h1>Inteligência artificial</h1>
    <p className="system2-lead">O Groq é o padrão para a organização inicial; o Gemini permanece no diagnóstico jurídico. Você pode trocar o provedor de cada etapa para as próximas execuções.</p>
    <div className="card system2-form">
      {FIELDS.map(([field,title,description])=><label key={field}>{title}<small style={{display:"block",marginBottom:8}}>{description}</small><select disabled={busy||!settings} value={settings?.[field]||"groq"} onChange={e=>update(field,e.target.value)}>{OPTIONS.map(item=><option value={item.value} key={item.value}>{item.label}</option>)}</select></label>)}
      {message&&<p className="form-message">{message}</p>}
      <p className="system2-note">A troca de modelo não altera análises já salvas. O sistema registra as etapas, mantém a revisão humana e não altera as chaves privadas no navegador.</p>
    </div>
  </section>;
}

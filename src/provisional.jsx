import React from "react";
import * as pdfjs from "pdfjs-dist";

const HEADINGS = [
  /^(?:\d+[.)-]?\s*)?(?:DIREITO|LEGISLAÇÃO|LÍNGUA|LINGUA|RACIOCÍNIO|RACIOCINIO|ÉTICA|ETICA|INFORMÁTICA|INFORMATICA|CONHECIMENTOS|ADMINISTRAÇÃO|ADMINISTRACAO|MATEMÁTICA|MATEMATICA|PORTUGUÊS|PORTUGUES|PROCESSO|MEDICINA|CONTABILIDADE)\b/i,
  /^(?:\d+[.)-]?\s*)?(?:NOÇÕES|NOCOES|POLÍTICAS|POLITICAS)\b/i,
];
const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
const normalized = (value) => clean(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export function parseEdict(text) {
  const lines = String(text || "").split(/\n+/).map(clean).filter(Boolean);
  const found = []; let current = null;
  for (const line of lines) {
    const heading = line.replace(/^(?:\d+(?:\.\d+)*\s*[-.)]?\s*)/, "");
    const weightMatch = heading.match(/(?:peso\s*[:=]?\s*(\d+))|(?:(\d+)\s*questões)/i);
    const weight = weightMatch ? Number(weightMatch[1] || weightMatch[2]) || 1 : 1;
    const headingWithoutWeight = heading.replace(/(?:\(?\bpesos?\s*[:=]?\s*\d+\)?)|(?:\(?\b\d+\s*questões\b\)?)/ig, "").trim();
    if (headingWithoutWeight.length < 100 && HEADINGS.some((rule) => rule.test(headingWithoutWeight))) {
      const parts = headingWithoutWeight.split(/\s*[:–—]\s*/, 2);
      current = clean(parts[0]).replace(/\.$/, "");
      if (current.length > 90) current = current.slice(0,90);
      if (current && !found.some((row) => normalized(row.discipline) === normalized(current) && !row.subject))
        found.push({ discipline: current, subject: "", weight });
      if (parts[1] && parts[1].length < 180) {
        for (const sub of parts[1].split(/\s*[;•]\s*/).map(clean).filter((v) => v.length > 3 && v.length < 160).slice(0,12))
          found.push({ discipline: current, subject: sub, weight });
      }
    } else if (current && line.length < 155 && /^[\d]+[.)]\s+|^[•\-]\s+/.test(line)) {
      const subject = clean(line.replace(/^(?:\d+[.)]|[•-])\s*/, ""));
      if (subject.length > 3 && !HEADINGS.some((rule) => rule.test(subject)))
        found.push({ discipline: current, subject, weight: 1 });
    }
    if (found.length >= 100) break;
  }
  const distinct = found.filter((row, index, list) => list.findIndex((x) =>
    normalized(x.discipline) === normalized(row.discipline) && normalized(x.subject) === normalized(row.subject)) === index);
  // Uma matéria com subassuntos específicos não deve abrir a busca para toda a disciplina.
  return distinct.filter((row) => row.subject || !distinct.some((item) =>
    item.subject && normalized(item.discipline) === normalized(row.discipline)));
}

async function readEdictPdf(file) {
  if (!file || file.size > 15 * 1024 * 1024) throw new Error("Envie um PDF de até 15 MB.");
  const document = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  try {
    let text = "";
    for (let index=1;index<=Math.min(document.numPages,100);index++) {
      const page=await document.getPage(index);
      const content=await page.getTextContent();
      text += content.items.map((item)=> item.str + (item.hasEOL ? "\n" : " ")).join("")+"\n";
    }
    return text;
  } finally { await document.destroy(); }
}

export function ProvisionalCreator({ supabase, userId, questions = [], onCreated, onCancel }) {
  const [title,setTitle]=React.useState("");
  const [concurso,setConcurso]=React.useState("");
  const [cargo,setCargo]=React.useState("");
  const [sourceFilename,setSourceFilename]=React.useState("");
  const [examDate,setExamDate]=React.useState("");
  const [topics,setTopics]=React.useState([]);
  const [expand,setExpand]=React.useState(false);
  const [busy,setBusy]=React.useState(false);
  const [error,setError]=React.useState("");
  const [newDiscipline,setNewDiscipline]=React.useState("");
  const [newSubject,setNewSubject]=React.useState("");
  const [preview,setPreview]=React.useState(null);
  const [sourceText,setSourceText]=React.useState("");

  async function analyzeFile(file) {
    if (!file) return;
    setBusy(true); setError("");
    try {
      const content=await readEdictPdf(file);
      setSourceFilename(file.name);
      setSourceText(content);
      const parsed=parseEdict(content);
      setTopics(parsed);
      if (!parsed.length) setError("Não identifiquei automaticamente as matérias. Adicione-as abaixo antes de criar o caderno.");
    } catch(e){setError(e.message);}finally{setBusy(false);}
  }
  function addTopic() {
    const discipline=clean(newDiscipline), subject=clean(newSubject);
    if (!discipline) return setError("Informe ao menos a disciplina.");
    if (topics.some(t=>normalized(t.discipline)===normalized(discipline)&&normalized(t.subject)===normalized(subject))) return;
    setTopics(current=>[...current.filter(item => !subject || item.subject || normalized(item.discipline)!==normalized(discipline)),{discipline,subject,weight:1}]);
    setNewSubject("");setError("");
  }
  function previewMatches() {
    if (!topics.length) return setError("Revise as matérias antes de continuar.");
    const matched=new Set();
    const uncovered=[];
    for (const topic of topics) {
      const expected=normalized(topic.discipline);
      const subject=normalized(topic.subject);
      const hits=questions.filter(q=>{
        if(q.is_hidden || q.is_annulled || q.correct_option==="*")return false;
        const parts=String(q.subject||"").split(/[;|·•]/).map(normalized);
        if(normalized(q.discipline)!==expected &&
          !(normalized(q.discipline)==="direito" && parts.includes(expected)))return false;
        if(!subject)return true;
        return parts.some(part=>part===subject || (expand && subject.length>=5 &&
          (part.startsWith(subject+" ") || subject.startsWith(part+" "))));
      });
      hits.forEach(q=>matched.add(q.id));
      if(!hits.length)uncovered.push([topic.discipline,topic.subject].filter(Boolean).join(" — "));
    }
    setPreview({count:topics.length,expanded:expand,matchedCount:matched.size,uncovered});
    setError("");
  }
  async function create(event) {
    event.preventDefault();
    if (!topics.length) return setError("Informe as matérias do edital.");
    if (!preview || preview.count!==topics.length || preview.expanded!==expand)
      return setError("Confira a correspondência das matérias antes de criar o caderno.");
    setBusy(true); setError("");
    try {
      const {data,error:rpcError}=await supabase.rpc("create_provisional_notebook",{
        p_title:title.trim(),p_concurso:concurso.trim(),p_cargo:cargo.trim(),
        p_topics:topics.map(({discipline,subject,weight})=>({discipline:clean(discipline),subject:clean(subject),weight:Math.max(1,Math.min(99,Number(weight)||1))})),
        p_expand_related:expand,p_source_filename:sourceFilename||null,p_exam_date:examDate||null,
      });
      if (rpcError) throw rpcError;
      await onCreated(data);
    } catch(e) {setError(e.message);} finally {setBusy(false);}
  }

  return <section className="card edital-creator">
    <div className="edital-heading"><div><span className="eyebrow">CADERNO PROVISÓRIO</span>
      <h1>Criar caderno pelo edital</h1><p>Reaproveite questões compatíveis sem duplicar registros. O desempenho será independente.</p>
    </div><button className="light" type="button" onClick={onCancel}>Voltar</button></div>
    <form onSubmit={create} className="edital-form">
      <label>Concurso<input required maxLength="120" placeholder="Ex.: Procuradoria Municipal" value={concurso} onChange={e=>setConcurso(e.target.value)} /></label>
      <label>Cargo<input required maxLength="120" placeholder="Ex.: Procurador Municipal" value={cargo} onChange={e=>setCargo(e.target.value)} /></label>
      <label>Nome do caderno<input required minLength="4" maxLength="120" value={title} placeholder="Ex.: Procurador Municipal — Edital 2026" onChange={e=>setTitle(e.target.value)} /></label>
      <label>Data da prova (opcional)<input type="date" value={examDate} onChange={e=>setExamDate(e.target.value)} /></label>
      <label className="edital-file">Edital em PDF (até 15 MB)<input type="file" accept="application/pdf,.pdf" onChange={e=>analyzeFile(e.target.files?.[0])} disabled={busy}/></label>
      <details><summary>Alternativa: colar o conteúdo programático</summary>
        <textarea rows="5" value={sourceText} onChange={e=>setSourceText(e.target.value)} placeholder="Cole as disciplinas e os assuntos do edital" />
        <button type="button" className="light" onClick={()=>{setTopics(parseEdict(sourceText));setPreview(null);}}>Identificar matérias</button>
      </details>
      <div className="edital-topic-header"><h2>Matérias identificadas ({topics.length})</h2><p>Confira e corrija os assuntos. A extração automática não substitui a leitura do edital.</p></div>
      <div className="edital-topics">{topics.map((topic,i)=><div className="edital-topic" key={i}>
        <input aria-label="Disciplina" value={topic.discipline} onChange={e=>{setTopics(rows=>rows.map((t,j)=>j===i?{...t,discipline:e.target.value}:t));setPreview(null);}} />
        <input aria-label="Assunto (opcional)" placeholder="Disciplina inteira" value={topic.subject||""} onChange={e=>{setTopics(rows=>rows.map((t,j)=>j===i?{...t,subject:e.target.value}:t));setPreview(null);}} />
        <input type="number" min="1" max="99" aria-label="Peso da matéria" title="Peso identificado no edital (ajustável)" value={topic.weight||1} onChange={e=>{setTopics(rows=>rows.map((t,j)=>j===i?{...t,weight:Number(e.target.value)||1}:t));setPreview(null);}} />
        <button className="light" type="button" aria-label="Excluir matéria" onClick={()=>{setTopics(rows=>rows.filter((_,j)=>j!==i));setPreview(null);}}>×</button>
      </div>)}</div>
      <div className="edital-add"><input placeholder="Nova disciplina" value={newDiscipline} onChange={e=>setNewDiscipline(e.target.value)} /><input placeholder="Assunto (opcional)" value={newSubject} onChange={e=>setNewSubject(e.target.value)} /><button type="button" className="light" onClick={()=>{addTopic();setPreview(null);}}>Adicionar</button></div>
      <label className="edital-expand"><input type="checkbox" checked={expand} onChange={e=>{setExpand(e.target.checked);setPreview(null);}}/>
      Incluir subassuntos relacionados dentro da mesma disciplina (busca ampliada)</label>
      <button type="button" className="light" onClick={previewMatches}>Conferir seleção</button>
      {preview&&<div className="edital-preview">
        <strong>{preview.matchedCount} questões compatíveis identificadas no acervo publicado.</strong>
        <p>Correspondência {expand?"ampliada":"estrita"} para {preview.count} entradas do edital. Nenhuma questão será duplicada.</p>
        {preview.uncovered.length>0&&<details><summary>{preview.uncovered.length} matéria(s) sem questões correspondentes</summary>
          <ul>{preview.uncovered.map((item,i)=><li key={i}>{item}</li>)}</ul></details>}
      </div>}
      {error&&<p role="alert" className="form-message">{error}</p>}
      <button type="submit" disabled={busy||!preview}>{busy?"Preparando…":"Criar caderno provisório"}</button>
    </form>
  </section>;
}

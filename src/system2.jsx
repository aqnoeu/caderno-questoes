import React from "react";
import * as pdfjs from "pdfjs-dist";

const cleanSpace = (value) => String(value || "").replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
const normalized = (value) => cleanSpace(value).toLowerCase().replace(/\d+/g, "#").replace(/[^a-zà-ú# ]/gi, "").replace(/\s+/g, " ").trim();
const optionLetters = "ABCDEFGH";

function parseAnswerKeyV2(value) {
  const tokens = String(value || "").toUpperCase().match(/\b\d{1,3}\b|\b[A-H]\b|\*|\bX\b|ANULAD[AO]/g) || [];
  const result = new Map();
  for (let index = 0; index < tokens.length; index += 1) {
    if (!/^\d+$/.test(tokens[index])) continue;
    const next = tokens[index + 1] || "";
    if (/^[A-H]$/.test(next)) { result.set(Number(tokens[index]), next); index += 1; }
    else if (/^(\*|X|ANULAD[AO])$/.test(next)) { result.set(Number(tokens[index]), "*"); index += 1; }
  }
  return result;
}

function pageLines(content, viewport) {
  const items = [...content.items].filter((item) => item.str?.trim()).map((item) => ({ y:item.transform[5], x:item.transform[4], text:item.str }));
  // Muitas provas (inclusive OAB) usam duas colunas. Misturá-las cria A/B/C/D/E
  // duplicadas e une duas questões diferentes. Cada coluna é lida de cima para baixo.
  const left = items.filter((item) => item.x < viewport.width * .52);
  const right = items.filter((item) => item.x >= viewport.width * .52);
  const columns = right.length > Math.max(14, left.length * .14) ? [left, right] : [items];
  return columns.flatMap((column) => {
    const rows = [];
    column.forEach((item) => {
      let row = rows.find((entry) => Math.abs(entry.y - item.y) < 3);
      if (!row) { row = { y:item.y, items:[] }; rows.push(row); }
      row.items.push(item);
    });
    return rows.sort((a, b) => b.y - a.y).map((row) => ({
      text:cleanSpace(row.items.sort((a, b) => a.x - b.x).map((item) => item.text).join(" ")),
      // O número da questão pode ficar muito próximo do topo (como na OAB).
      // Por isso, só tratamos as faixas extremas como cabeçalho/rodapé; uma
      // margem ampla aqui eliminava indevidamente as questões 1, 3, 5...
      zone:row.y > viewport.height * .94 ? "header" : row.y < viewport.height * .06 ? "footer" : "body",
    })).filter((row) => row.text);
  });
}

async function extractPdfV2(file) {
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = [];
  const repeated = new Map();
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const lines = pageLines(await page.getTextContent(), viewport);
    pages.push(lines);
    new Set(lines.filter((line) => line.zone !== "body").map((line) => `${line.zone}:${normalized(line.text)}`).filter((key) => key.length > 4)).forEach((key) => repeated.set(key, (repeated.get(key) || 0) + 1));
  }
  const repeatedLayout = new Set([...repeated].filter(([, count]) => count >= 2).map(([key]) => key));
  const pageTexts = pages.map((lines) => lines.filter((line) => {
    const key = `${line.zone}:${normalized(line.text)}`;
    const looksLikePageNumber = /^(p[aá]gina\s*)?\d+(\s*de\s*\d+)?$/i.test(line.text.trim());
    // Números isolados no corpo são marcadores válidos de questão em provas
    // como a OAB. Somente números nas faixas de rodapé/cabeçalho são paginação.
    return !((line.zone !== "body" && looksLikePageNumber) || (line.zone !== "body" && repeatedLayout.has(key)));
  }).map((line) => line.text).join("\n"));
  return { pageCount: pdf.numPages, text: pageTexts.join("\n\n"), removedLayoutLines: repeatedLayout.size };
}

function startsQuestion(line) {
  // Alguns cadernos colocam apenas o número, sozinho, antes de cada enunciado.
  // A numeração de página já é descartada durante a leitura do PDF.
  return line.match(/^\s*(?:quest[ãa]o\s*)?(\d{1,3})(?:\s*(?:[.)º°-])\s+|\s*$)/i);
}
function startsOption(line) {
  return line.match(new RegExp(`^\\s*(?:\\(?([${optionLetters}])\\)?[).:-])\\s+`, "i"));
}
function parseQuestionsV2(text) {
  const allLines = String(text || "").replace(/\r/g, "").split("\n").map(cleanSpace).filter(Boolean);
  // O questionário de percepção vem depois da prova objetiva e não integra o
  // banco. Cortamos o documento no título, antes mesmo de ele reiniciar em 1.
  const surveyStart = allLines.findIndex((line) => /question[aá]rio\s+de\s+percep[cç][aã]o\s+sobre\s+a\s+prova/i.test(line));
  const lines = surveyStart > -1 ? allLines.slice(0, surveyStart) : allLines;
  const explicitStarts = lines.map((line, index) => ({ index, match:line.match(/^\s*quest[ãa]o\s*(\d{1,3})\s*(?:[.)º°-]|\b)\s*/i) })).filter((entry) => entry.match);
  // Quando a própria prova usa “QUESTÃO 01”, ele é mais confiável que números de
  // regras/instruções. Só usamos numeração simples como fallback.
  const candidateStarts = explicitStarts.length >= 2 ? explicitStarts : lines.map((line, index) => ({ index, match: startsQuestion(line) })).filter((entry) => entry.match);
  // Alguns cadernos acrescentam, após a prova, um questionário que reinicia em
  // “1”. Ele não é questão objetiva e não deve entrar no banco de questões.
  const restartIndex = candidateStarts.findIndex((entry, index) => index > 0 && Number(entry.match[1]) === 1 && Math.max(...candidateStarts.slice(0, index).map((item) => Number(item.match[1]))) >= 20);
  const starts = restartIndex > -1 ? candidateStarts.slice(0, restartIndex) : candidateStarts;
  const finalQuestionEnd = restartIndex > -1 ? candidateStarts[restartIndex].index : lines.length;
  return starts.map((start, index) => {
    const end = index + 1 < starts.length ? starts[index + 1].index : finalQuestionEnd;
    const block = lines.slice(start.index, end);
    block[0] = block[0].replace(startsQuestion(block[0])[0], "").trim();
    const options = block.map((line, i) => ({ i, match: startsOption(line) })).filter((entry) => entry.match);
    if (!options.length) return { id: crypto.randomUUID(), question_number: Number(start.match[1]), statement: block.join("\n"), alternatives: [], correct_option: "", warnings: ["Alternativas não identificadas. Revise a estrutura."], selected: true };
    const statement = block.slice(0, options[0].i).join("\n").trim();
    const alternatives = options.map((option, optionIndex) => ({
      letter: option.match[1].toUpperCase(),
      text: block.slice(option.i, optionIndex + 1 < options.length ? options[optionIndex + 1].i : block.length).join("\n").replace(option.match[0], "").trim(),
    }));
    const warnings = [];
    if (!statement || statement.length < 30) warnings.push("Enunciado muito curto ou possivelmente incompleto.");
    if (alternatives.length < 2) warnings.push("Quantidade incomum de alternativas.");
    if (new Set(alternatives.map((item) => item.letter)).size !== alternatives.length) warnings.push("Alternativas repetidas detectadas: verifique se o PDF possui duas colunas.");
    if (!alternatives.at(-1)?.text || alternatives.at(-1).text.length < 2) warnings.push("Última alternativa parece incompleta.");
    if (/\b(p[aá]gina|www\.|todos os direitos reservados|fgv conhecimento)\b/i.test(alternatives.at(-1)?.text || "")) warnings.push("Trecho potencialmente pertencente ao rodapé na última alternativa.");
    if (block.length > 18 && !/\n/.test(statement)) warnings.push("Possível quebra de página ou estrutura longa: revise o enunciado.");
    return { id: crypto.randomUUID(), question_number: Number(start.match[1]), statement, alternatives, correct_option: "", warnings, selected: true };
  }).filter((item) => item.statement || item.alternatives.length);
}

const emptyMetadata = { concurso: "", edicao: "", ano: "", banca: "", cargo: "", application_date: "", notebook_id: "" };

export function System2Home({ openCadastro, openFilter, openContent }) {
  return <section className="system2-page"><span className="eyebrow">MODELO NOVO</span><h1>Cadastro e análise de questões</h1><p className="system2-lead">Um fluxo separado para importar provas, revisar o texto e organizar o novo acervo antes da publicação.</p><div className="system2-flow"><b>Cadastro de Questões</b><i>→</i><b>Filtro de IA</b><i>→</i><b>Controle de Conteúdo</b><i>→</i><b>Sistema de Estudos</b></div><div className="system2-module-grid"><article className="card system2-module active"><span>01</span><h2>Cadastro de Questões</h2><p>Importação e estruturação inicial das provas, com revisão humana antes de qualquer salvamento.</p><button onClick={openCadastro}>Acessar cadastro →</button></article><article className="card system2-module"><span>02</span><h2>Filtro de IA</h2><p>Acompanhe as questões pendentes, em análise e as que precisam de revisão humana.</p><button className="light" onClick={openFilter}>Acessar Filtro de IA →</button></article><article className="card system2-module"><span>03</span><h2>Controle de Conteúdo</h2><p>Leia, revise e edite as questões aprovadas antes da publicação.</p><button className="light" onClick={openContent}>Acessar Controle de Conteúdo →</button></article></div><div className="system2-note">O modelo novo é independente do acervo atual e não altera as questões já disponíveis aos alunos.</div></section>;
}

const statusInfo = {
  pending_ai: { label:"Pendentes de análise", detail:"Aguardando o início do Filtro de IA." },
  processing_ai: { label:"Em análise", detail:"A IA está processando esta questão." },
  needs_review: { label:"Revisão necessária", detail:"A análise precisa de conferência humana." },
  approved: { label:"Aprovadas", detail:"Prontas para a etapa de controle de conteúdo." },
};

function useSystem2Questions(supabase) {
  const [questions, setQuestions] = React.useState([]), [loading, setLoading] = React.useState(true), [error, setError] = React.useState("");
  const load = React.useCallback(async () => {
    setLoading(true); setError("");
    const { data, error: queryError } = await supabase.from("questions_v2").select("id, question_number, statement, alternatives, answer_key_option, extraction_warnings, status, discipline, subjects, subtopics, legal_concepts, alternatives_analysis, legal_basis, central_rule, legal_reasoning, study_content, correct_answer_explanation, option_error_analysis, analysis_steps, ai_stage, is_test, promoted_question_id, difficulty, ai_confidence, ai_result, ai_attempts, ai_last_error, ai_processed_at, next_attempt_at, created_at, import:question_imports(concurso, edicao, ano, banca)").order("created_at", { ascending:false });
    if (queryError) setError(queryError.message); else setQuestions(data || []);
    setLoading(false);
  }, [supabase]);
  React.useEffect(() => { load(); }, [load]);
  return { questions, loading, error, reload:load };
}

const subjectsText = (value) => Array.isArray(value) ? value.filter(Boolean).join(" · ") : String(value || "");
const subjectsArray = (value) => String(value || "").split(/[·;|]/).map((entry) => entry.trim()).filter(Boolean);
function readableAiError(value) {
  const text = String(value || "");
  if (/quota|rate.?limit|limit.*20/i.test(text)) return { title:"Limite de uso da IA atingido", description:"O Gemini recusou temporariamente novas análises por limite de cota. Revise o plano/chave da API ou reenvie mais tarde.", raw:text };
  if (/high demand|temporar|try again later|unavailable/i.test(text)) return { title:"IA temporariamente indisponível", description:"Há alta demanda no provedor. A questão pode voltar à fila automaticamente ou ser reenviada por você.", raw:text };
  return { title:"Erro na análise", description:"A IA não conseguiu concluir esta questão. Você pode conferir o detalhe técnico abaixo, editar e reenviar.", raw:text };
}

function System2QuestionCardV2({ item, supabase, onChanged, showErrorActions = false, allowPromote = false, testMode = false }) {
  const source = item.import || {};
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState(item);
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState("");
  React.useEffect(() => setDraft(item), [item]);
  const patch = (key, value) => setDraft((current) => ({ ...current, [key]:value }));
  const updateAlternative = (index, value) => patch("alternatives", (draft.alternatives || []).map((entry, position) => position === index ? { ...entry, text:value } : entry));
  const updateDiagnostic = (letter, key, value) => patch("option_error_analysis", { ...(draft.option_error_analysis || {}), [letter]:{ ...(draft.option_error_analysis || {})[letter], [key]:value } });
  const stage = Math.max(0, Math.min(3, Number(item.ai_stage || 0)));
  const errorInfo = item.ai_last_error ? readableAiError(item.ai_last_error) : null;
  async function save() {
    setBusy(true); setMessage("");
    const payload = { question_number:Number(draft.question_number), statement:String(draft.statement || "").trim(), alternatives:draft.alternatives || [], discipline:String(draft.discipline || "").trim() || null, subjects:subjectsArray(draft.subjects), difficulty:draft.difficulty || null, legal_basis:String(draft.legal_basis || "").trim() || null, central_rule:String(draft.central_rule || "").trim() || null, correct_answer_explanation:String(draft.correct_answer_explanation || "").trim() || null, option_error_analysis:draft.option_error_analysis || {} };
    const { error } = await supabase.from("questions_v2").update(payload).eq("id", item.id);
    setBusy(false); if (error) return setMessage(`Não foi possível salvar: ${error.message}`); setMessage("Alterações salvas no Modelo novo."); onChanged();
  }
  async function requeue(reset = false) {
    setBusy(true); setMessage("");
    const payload = reset ? { status:"pending_ai", ai_stage:0, analysis_steps:{ classification:"pending", wrong_options:"pending", correct_answer:"pending" }, option_error_analysis:{}, correct_answer_explanation:null, ai_last_error:null, next_attempt_at:new Date().toISOString() } : { status:"pending_ai", ai_last_error:null, next_attempt_at:new Date().toISOString() };
    const { error } = await supabase.from("questions_v2").update(payload).eq("id", item.id);
    setBusy(false); if (error) return setMessage(`Não foi possível reenviar: ${error.message}`); setMessage(reset ? "Teste preparado: a análise começará novamente pela etapa 1." : "Questão reenviada; ela continuará da próxima etapa pendente."); onChanged();
  }
  async function remove() { if (!window.confirm(`Excluir definitivamente a questão ${item.question_number} do Modelo novo?`)) return; setBusy(true); const { error } = await supabase.from("questions_v2").delete().eq("id", item.id); setBusy(false); if (error) setMessage(`Não foi possível excluir: ${error.message}`); else onChanged(); }
  async function sendToReview() { setBusy(true); const { error } = await supabase.from("questions_v2").update({ status:"needs_review" }).eq("id", item.id); setBusy(false); if (error) return setMessage(error.message); setMessage("Questão enviada para revisão humana."); onChanged(); }
  async function promote() { setBusy(true); setMessage(""); const { data, error } = await supabase.rpc("promote_question_v2", { p_question_id:item.id }); setBusy(false); if (error) return setMessage(`Não foi possível promover: ${error.message}`); setMessage(`Promovida ao acervo atual (ID ${data}).`); onChanged(); }
  async function advanceTest() { setBusy(true); setMessage("Executando a próxima etapa do teste…"); const response = await supabase.functions.invoke("process-system2-queue", { body:{ trigger:"manual", question_id:item.id } }); setBusy(false); setMessage(response.error ? `Não foi possível executar: ${response.error.message}` : response.data?.reason || `Etapa ${response.data?.stage || ""} concluída.`); onChanged(); }
  const actions = <div className="card-actions system2-card-actions"><button className="light compact" onClick={() => setOpen((value) => !value)}>{open ? "Fechar leitura" : "Ler e revisar"}</button>{testMode && <button className="compact" disabled={busy || stage >= 3} onClick={advanceTest}>{busy ? "Executando…" : stage ? "Executar próxima etapa" : "Iniciar teste"}</button>}{item.status === "approved" && !testMode && <button className="light compact" disabled={busy} onClick={sendToReview}>Enviar para revisão</button>}{(showErrorActions || item.status === "needs_review") && <button className="compact" disabled={busy} onClick={() => requeue(false)}>Reenviar para IA</button>}{allowPromote && item.status === "approved" && !item.promoted_question_id && !item.is_test && <button className="compact" disabled={busy} onClick={promote}>Promover ao acervo atual</button>}{item.promoted_question_id && <span className="system2-promoted">✓ Promovida ao acervo atual</span>}<button className="danger light compact" disabled={busy} onClick={remove}>Excluir</button></div>;
  if (!open) return <article className={`question-card system2-ficha ${item.status}`}>
    <div className="card-top"><span className="question-id">QUESTÃO {String(item.question_number).padStart(2, "0")}</span><span className={`system2-chip ${item.status}`}>{statusInfo[item.status]?.label || item.status}</span>{item.difficulty && <span className={`difficulty ${item.difficulty}`}>{item.difficulty}</span>}</div>
    <h3>{item.discipline || "Aguardando classificação"}</h3>
    <p className="question-subject">{subjectsText(item.subjects) || "Sem assuntos classificados"}</p>
    <p className="question-preview">{cleanSpace(item.statement)}</p>
    <div className="system2-mini-steps" title="Análise pedagógica em 3 etapas">{[[1,"Classificação"],[2,"Erros por alternativa"],[3,"Explicação"]].map(([value,label]) => <span key={value} className={stage >= value ? "complete" : ""}>{stage >= value ? "✓" : value} {label}</span>)}</div>
    <dl className="card-meta system2-ficha-meta">
      <div><dt>Gabarito</dt><dd>{item.answer_key_option === "*" ? "Anulada" : item.answer_key_option || "—"}</dd></div>
      <div><dt>Concurso</dt><dd>{source.concurso ? <span className="contest-tag">{source.concurso}</span> : "—"}</dd></div>
      <div><dt>Banca</dt><dd>{source.banca || "—"}</dd></div>
      <div><dt>Ano / edição</dt><dd>{source.ano || "—"}{source.edicao ? ` · ${source.edicao}` : ""}</dd></div>
      <div><dt>Alternativas</dt><dd>{(item.alternatives || []).length}</dd></div>
      <div><dt>{item.ai_processed_at ? "Confiança da IA" : "Tentativas da IA"}</dt><dd>{item.ai_processed_at ? `${Math.round(Number(item.ai_confidence || 0) * 100)}%` : item.ai_attempts || 0}</dd></div>
      <div><dt>Cadastrada em</dt><dd>{item.created_at ? new Date(item.created_at).toLocaleDateString("pt-BR") : "—"}</dd></div>
      <div><dt>ID</dt><dd>{String(item.id).slice(0, 8)}</dd></div>
    </dl>
    {(item.is_test || item.promoted_question_id || (item.extraction_warnings || []).length > 0) && <div className="system2-ficha-tags">{item.is_test && <span className="hidden-label">Questão de teste</span>}{item.promoted_question_id && <span className="system2-promoted">✓ No acervo atual</span>}{(item.extraction_warnings || []).length > 0 && <span className="hidden-label">⚠ {(item.extraction_warnings || []).length} alerta(s) de extração</span>}</div>}
    {errorInfo && <p className="system2-ficha-error"><b>{errorInfo.title}.</b> {errorInfo.description}</p>}
    {actions}
    {message && <p className="form-message">{message}</p>}
  </article>;
  return <article className="card system2-full-card open system2-span">
    <header><div><span className="eyebrow">QUESTÃO {String(item.question_number).padStart(2, "0")}</span><h2>{item.discipline || "Aguardando classificação"}</h2><p className="system2-card-subjects">{subjectsText(item.subjects) || "Sem assuntos classificados"}</p><small>{source.concurso || "Concurso não informado"} · {source.edicao && `${source.edicao} · `}{source.ano || "—"} · {source.banca || "—"}</small></div><div className={`system2-status ${item.status}`}><b>{statusInfo[item.status]?.label || item.status}</b><small>{item.ai_processed_at ? `Confiança: ${Math.round(Number(item.ai_confidence || 0) * 100)}%` : `Tentativas: ${item.ai_attempts || 0}`}</small></div></header>
    <div className="system2-progress-wrap"><div className="system2-progress-label"><span>Análise pedagógica</span><b>{stage}/3 etapas</b></div><div className="system2-progress"><i style={{ width:`${stage / 3 * 100}%` }} /></div><div className="system2-progress-steps">{[[1,"Classificação"],[2,"Erros por alternativa"],[3,"Explicação correta"]].map(([value,label]) => <span key={value} className={stage >= value ? "complete" : ""}>{stage >= value ? "✓" : value} {label}</span>)}</div></div>
    <p className="system2-statement-preview">{cleanSpace(item.statement).slice(0, open ? 10000 : 340)}{!open && item.statement.length > 340 ? "…" : ""}</p>
    {item.answer_key_option && <span className="system2-correct-key">Resposta correta: {item.answer_key_option}</span>}
    {errorInfo && <section className="system2-error-panel"><b>{errorInfo.title}</b><p>{errorInfo.description}</p><details><summary>Ver detalhe técnico do erro</summary><code>{errorInfo.raw}</code></details></section>}
    {actions}
    {open && <div className="system2-editor"><div className="system2-editor-meta"><label>Número<input type="number" value={draft.question_number} onChange={(event) => patch("question_number", event.target.value)} /></label><label>Disciplina<input value={draft.discipline || ""} onChange={(event) => patch("discipline", event.target.value)} /></label><label>Assuntos<input value={subjectsText(draft.subjects)} onChange={(event) => patch("subjects", event.target.value)} placeholder="Separe por ·" /></label><label>Dificuldade<select value={draft.difficulty || ""} onChange={(event) => patch("difficulty", event.target.value)}><option value="">Não definida</option><option value="facil">Fácil</option><option value="media">Média</option><option value="dificil">Difícil</option></select></label></div><label>Enunciado<textarea rows="7" value={draft.statement || ""} onChange={(event) => patch("statement", event.target.value)} /></label><div className="system2-editor-alternatives">{(draft.alternatives || []).map((alternative, index) => <label key={`${alternative.letter}-${index}`} className={alternative.letter === item.answer_key_option ? "correct-answer" : ""}><span>{alternative.letter})</span><textarea rows="4" value={alternative.text || ""} onChange={(event) => updateAlternative(index, event.target.value)} />{alternative.letter === item.answer_key_option && <em>Resposta correta</em>}</label>)}</div><section className="system2-analysis-details open"><h3>Informações de acerto</h3><p>Estas informações explicam a alternativa correta.</p><label>Regra central<textarea rows="3" value={draft.central_rule || ""} onChange={(event) => patch("central_rule", event.target.value)} /></label><label>Fundamento jurídico<textarea rows="3" value={draft.legal_basis || ""} onChange={(event) => patch("legal_basis", event.target.value)} /></label><label>Explicação da resposta correta<textarea rows="4" value={draft.correct_answer_explanation || ""} onChange={(event) => patch("correct_answer_explanation", event.target.value)} /></label></section><section className="system2-analysis-details open"><h3>Estudo dirigido por alternativa</h3><p>Use apenas para as alternativas erradas. Esse diagnóstico é a base do estudo dirigido do aluno.</p>{(draft.alternatives || []).filter((alternative) => alternative.letter !== item.answer_key_option).map((alternative) => { const diagnostic = (draft.option_error_analysis || {})[alternative.letter] || {}; return <div className="system2-option-diagnostic" key={alternative.letter}><b>Alternativa {alternative.letter}</b><label>Raciocínio que leva ao erro<textarea rows="3" value={diagnostic.wrong_reasoning || ""} onChange={(event) => updateDiagnostic(alternative.letter, "wrong_reasoning", event.target.value)} /></label><label>Explicação específica do erro<textarea rows="3" value={diagnostic.student_feedback || ""} onChange={(event) => updateDiagnostic(alternative.letter, "student_feedback", event.target.value)} /></label><label>Conteúdo-base para estudo dirigido<textarea rows="5" value={diagnostic.study_content || ""} onChange={(event) => updateDiagnostic(alternative.letter, "study_content", event.target.value)} /></label></div>; })}</section><div className="system2-editor-actions"><button disabled={busy} onClick={save}>{busy ? "Salvando…" : "Salvar alterações"}</button>{!testMode && <button className="light" disabled={busy} onClick={() => requeue(false)}>Editar e reenviar à IA</button>}{testMode && <button className="light" disabled={busy} onClick={() => requeue(true)}>Reiniciar teste</button>}</div>{message && <p className="form-message">{message}</p>}</div>}
  </article>;
}

const difficultyLabel = { facil:"Fácil", media:"Média", dificil:"Difícil" };
function System2List({ items, renderItem }) {
  const [filters, setFilters] = React.useState({ search:"", discipline:"", concurso:"", difficulty:"" });
  const disciplines = [...new Set(items.map((item) => item.discipline).filter(Boolean))].sort();
  const contests = [...new Set(items.map((item) => item.import?.concurso).filter(Boolean))].sort();
  const term = filters.search.trim().toLowerCase();
  const visible = items.filter((item) => (!filters.concurso || item.import?.concurso === filters.concurso) && (!filters.discipline || item.discipline === filters.discipline) && (!filters.difficulty || item.difficulty === filters.difficulty) && (!term || `${item.question_number} ${String(item.id).slice(0, 8)} ${item.discipline || ""} ${subjectsText(item.subjects)} ${item.statement}`.toLowerCase().includes(term)));
  return <>
    {contests.length > 1 && <div className="contest-tabs"><button className={!filters.concurso ? "active" : ""} onClick={() => setFilters({ ...filters, concurso:"" })}>Todas <small>{items.length}</small></button>{contests.map((contest) => <button key={contest} className={filters.concurso === contest ? "active" : ""} onClick={() => setFilters({ ...filters, concurso:contest })}>{contest} <small>{items.filter((item) => item.import?.concurso === contest).length}</small></button>)}</div>}
    <div className="library-filters system2-filters"><input value={filters.search} onChange={(event) => setFilters({ ...filters, search:event.target.value })} placeholder="Buscar por texto, número ou ID" /><select value={filters.discipline} onChange={(event) => setFilters({ ...filters, discipline:event.target.value })}><option value="">Todas as disciplinas</option>{disciplines.map((value) => <option key={value}>{value}</option>)}</select><select value={filters.difficulty} onChange={(event) => setFilters({ ...filters, difficulty:event.target.value })}><option value="">Todas as dificuldades</option>{Object.entries(difficultyLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
    <p className="system2-count">{visible.length} de {items.length} questão(ões).</p>
    {visible.length ? <div className="question-grid system2-grid">{visible.map(renderItem)}</div> : <div className="card empty-state"><b>Nenhuma questão encontrada com esses filtros.</b></div>}
  </>;
}

function useSystem2Automation(supabase) {
  const defaultUrl = `${import.meta.env.VITE_SUPABASE_URL || supabase.supabaseUrl || ""}/functions/v1/process-system2-queue`;
  const [settings, setSettings] = React.useState({ enabled:false, max_per_day:30, min_interval_minutes:5, function_url:defaultUrl });
  const [message, setMessage] = React.useState("");
  const load = React.useCallback(async () => {
    const { data, error } = await supabase.from("system2_ai_settings").select("enabled, max_per_day, min_interval_minutes, function_url, last_started_at").eq("id", true).maybeSingle();
    if (error) { setMessage(`Configure o banco da automação: ${error.message}`); return; }
    if (data) setSettings((current) => ({ ...current, ...data, function_url:data.function_url || defaultUrl }));
  }, [defaultUrl, supabase]);
  React.useEffect(() => { load(); }, [load]);
  async function save(patch = {}) {
    const next = { ...settings, ...patch, id:true, function_url:(patch.function_url ?? settings.function_url ?? defaultUrl).trim() };
    const { error } = await supabase.from("system2_ai_settings").upsert(next);
    if (error) { setMessage(`Não foi possível salvar a automação: ${error.message}`); return false; }
    setSettings((current) => ({ ...current, ...next })); setMessage(next.enabled ? "Automação ativada. O servidor verificará a fila a cada 5 minutos." : "Automação pausada.");
    return true;
  }
  return { settings, setSettings, message, setMessage, save, reload:load };
}

export function System2Filter({ supabase, onBack, openContent }) {
  const { questions, loading, error, reload } = useSystem2Questions(supabase);
  const automation = useSystem2Automation(supabase);
  const [tab, setTab] = React.useState("pending_ai");
  const [running, setRunning] = React.useState(false);
  const tabs = ["pending_ai", "processing_ai", "needs_review"];
  const selected = questions.filter((item) => item.status === tab);
  async function runNow() { if (!(await automation.save({ enabled:true }))) return; setRunning(true); automation.setMessage("Enviando a próxima questão para análise…"); const response = await supabase.functions.invoke("process-system2-queue", { body:{ trigger:"manual" } }); automation.setMessage(response.error ? `Não foi possível iniciar a análise: ${response.error.message}` : response.data?.reason || `Questão ${response.data?.question_number || ""} enviada ao Filtro de IA.`); setRunning(false); await Promise.all([reload(), automation.reload()]); }
  return <section className="system2-page"><button className="link-button" onClick={onBack}>← Voltar ao Modelo novo</button><span className="eyebrow">FILTRO DE IA</span><h1>Fila e revisão das análises</h1><p className="system2-lead">A análise é construída em três etapas gravadas no banco: classificação, diagnóstico por alternativa e explicação correta.</p><section className="card system2-automation"><div><span className="eyebrow">AUTOMAÇÃO DO SERVIDOR</span><h2>{automation.settings.enabled ? "Fila ativa" : "Fila pausada"}</h2><p>Cada execução conclui uma etapa e deixa o progresso visível no cartão da questão.</p></div><div className="system2-automation-controls"><label className="switch-line"><input type="checkbox" checked={automation.settings.enabled} onChange={(event) => automation.save({ enabled:event.target.checked })} /> {automation.settings.enabled ? "Ativa" : "Pausada"}</label><label>Limite por dia<input type="number" min="1" max="500" value={automation.settings.max_per_day} onChange={(event) => automation.setSettings((current) => ({ ...current, max_per_day:Number(event.target.value) || 1 }))} onBlur={() => automation.save()} /></label><label>Intervalo (min.)<input type="number" min="1" max="1440" value={automation.settings.min_interval_minutes} onChange={(event) => automation.setSettings((current) => ({ ...current, min_interval_minutes:Number(event.target.value) || 1 }))} onBlur={() => automation.save()} /></label><button disabled={running} onClick={runNow}>{running ? "Analisando…" : "Executar próxima etapa"}</button></div><small>Função: {automation.settings.function_url || "configure após publicar a Edge Function"}</small>{automation.message && <p className="form-message">{automation.message}</p>}</section><div className="system2-tabs">{tabs.map((id) => <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{statusInfo[id].label} <b>{questions.filter((item) => item.status === id).length}</b></button>)}</div><div className="system2-toolbar"><p>{statusInfo[tab].detail}</p><button className="light compact" onClick={reload}>Atualizar dados</button></div>{loading ? <p className="empty-state">Carregando a fila…</p> : error ? <p className="form-message">Não foi possível carregar a fila: {error}</p> : selected.length ? <System2List key={tab} items={selected} renderItem={(item) => <System2QuestionCardV2 key={item.id} item={item} supabase={supabase} onChanged={reload} showErrorActions={tab === "needs_review"} />} /> : <div className="card empty-state"><b>Nenhuma questão nesta etapa.</b><p>Quando uma questão for salva no novo cadastro, ela aparecerá em “Pendentes de análise”.</p></div>}<div className="system2-note">Erros de limite ou indisponibilidade ficam visíveis no cartão. Você pode abrir, editar, excluir e reenviar cada questão sem perder o que já foi concluído.</div><button className="light" onClick={openContent}>Abrir Controle de Conteúdo →</button></section>;
}

export function System2Content({ supabase, onBack }) {
  const { questions, loading, error, reload } = useSystem2Questions(supabase);
  const approved = questions.filter((item) => item.status === "approved");
  return <section className="system2-page"><button className="link-button" onClick={onBack}>← Voltar ao Modelo novo</button><span className="eyebrow">CONTROLE DE CONTEÚDO</span><h1>Questões aprovadas</h1><p className="system2-lead">Leia, edite, exclua, devolva para revisão ou promova uma questão ao acervo atual quando estiver pronta.</p><div className="system2-toolbar"><p><b>{approved.length}</b> questão(ões) aprovadas.</p><div><button className="light compact" onClick={reload}>Atualizar dados</button></div></div>{loading ? <p className="empty-state">Carregando questões aprovadas…</p> : error ? <p className="form-message">Não foi possível carregar as questões: {error}</p> : approved.length ? <System2List items={approved} renderItem={(item) => <System2QuestionCardV2 key={item.id} item={item} supabase={supabase} onChanged={reload} allowPromote />} /> : <div className="card empty-state"><b>Ainda não há questões aprovadas.</b><p>As questões aprovadas no Filtro de IA aparecerão aqui automaticamente.</p></div>}<div className="system2-note">Promover cria uma cópia no acervo atual. Editar ou excluir aqui continua alterando somente o Modelo novo.</div></section>;
}

export function System2Test({ supabase, onBack }) {
  const { questions, loading, error, reload } = useSystem2Questions(supabase);
  const [filters, setFilters] = React.useState({ concurso:"", discipline:"" });
  const [cycle, setCycle] = React.useState([]);
  const [position, setPosition] = React.useState(0);
  const [answers, setAnswers] = React.useState({});
  const approved = questions.filter((item) => item.status === "approved" && item.ai_stage >= 3 && !item.is_test);
  const contests = [...new Set(approved.map((item) => item.import?.concurso).filter(Boolean))].sort();
  const pool = approved.filter((item) => (!filters.concurso || item.import?.concurso === filters.concurso) && (!filters.discipline || item.discipline === filters.discipline));
  const disciplines = [...new Set(pool.map((item) => item.discipline).filter(Boolean))].sort();
  function start() { setCycle([...pool].sort(() => Math.random() - .5).slice(0, Math.min(10, pool.length))); setPosition(0); setAnswers({}); }
  const current = cycle[position];
  const chosen = current ? answers[current.id] : "";
  const diagnostic = chosen && chosen !== current?.answer_key_option ? current?.option_error_analysis?.[chosen] : null;
  if (loading) return <section className="system2-page"><p className="empty-state">Carregando questões aprovadas…</p></section>;
  if (error) return <section className="system2-page"><p className="form-message">{error}</p></section>;
  if (!cycle.length) return <section className="system2-page"><button className="link-button" onClick={onBack}>← Voltar ao Modelo novo</button><span className="eyebrow">TESTAR CICLO</span><h1>Experimente o novo ciclo de questões</h1><p className="system2-lead">Aqui você testa a experiência do aluno usando somente questões aprovadas, completas e bem fundamentadas pelo novo modelo.</p><section className="card system2-test-setup"><label>Concurso<select value={filters.concurso} onChange={(event) => setFilters({ concurso:event.target.value, discipline:"" })}><option value="">Todos os concursos</option>{contests.map((value) => <option key={value}>{value}</option>)}</select></label><label>Disciplina<select value={filters.discipline} onChange={(event) => setFilters({ ...filters, discipline:event.target.value })}><option value="">Todas as disciplinas</option>{disciplines.map((value) => <option key={value}>{value}</option>)}</select></label><p>{pool.length} questão(ões) apta(s). O ciclo terá até 10 questões, sem registrar desempenho real de aluno.</p><button disabled={!pool.length} onClick={start}>Iniciar ciclo de teste</button></section></section>;
  if (!current) { const correct = Object.entries(answers).filter(([id, letter]) => cycle.find((item) => item.id === id)?.answer_key_option === letter).length; return <section className="system2-page"><span className="eyebrow">CICLO DE TESTE</span><h1>Teste concluído</h1><section className="card system2-test-result"><b>{correct}/{cycle.length} acertos</b><p>Você percorreu um ciclo formado somente por questões aprovadas no Modelo novo.</p><button onClick={() => { setCycle([]); setAnswers({}); }}>Montar outro ciclo</button></section></section>; }
  return <section className="system2-page"><button className="link-button" onClick={() => { setCycle([]); setAnswers({}); }}>← Sair do teste</button><span className="eyebrow">CICLO DE TESTE · {position + 1} DE {cycle.length}</span><section className="card system2-test-question"><div className="study-cycle-head"><b>{current.import?.concurso || "Modelo novo"} · {current.discipline}</b><span className={`difficulty ${current.difficulty || "media"}`}>Dificuldade: {current.difficulty || "media"}</span></div><div className="study-progress"><span style={{ width:`${(position + 1) / cycle.length * 100}%` }} /></div><p className="system2-test-statement">{current.statement}</p><div className="system2-test-options">{(current.alternatives || []).map((alternative) => <button key={alternative.letter} disabled={Boolean(chosen)} className={`${chosen === alternative.letter ? "chosen" : ""} ${chosen && alternative.letter === current.answer_key_option ? "correct" : ""} ${chosen === alternative.letter && alternative.letter !== current.answer_key_option ? "wrong" : ""}`} onClick={() => setAnswers((all) => ({ ...all, [current.id]:alternative.letter }))}><span>{alternative.letter}</span>{alternative.text}</button>)}</div>{chosen && <section className={`system2-test-feedback ${chosen === current.answer_key_option ? "correct" : "wrong"}`}><b>{chosen === current.answer_key_option ? `Correto — alternativa ${current.answer_key_option}` : `Resposta incorreta — alternativa correta: ${current.answer_key_option}`}</b>{chosen === current.answer_key_option ? <><h3>Regra central</h3><p>{current.central_rule}</p><h3>Fundamento jurídico</h3><p>{current.legal_basis}</p><h3>Por que esta é a resposta?</h3><p>{current.correct_answer_explanation}</p></> : <><h3>Onde está o raciocínio equivocado?</h3><p>{diagnostic?.wrong_reasoning || diagnostic?.student_feedback || "Diagnóstico ainda não disponível."}</p><h3>Conteúdo-base para estudo dirigido</h3><p>{diagnostic?.study_content || "Revise a regra central e o fundamento jurídico desta questão."}</p></>}<button onClick={() => setPosition((value) => value + 1)}>{position + 1 === cycle.length ? "Ver resultado" : "Próxima questão"}</button></section>}</section></section>;
}

export function System2Cadastro({ supabase, onBack }) {
  const [metadata, setMetadata] = React.useState(emptyMetadata), [notebookOptions, setNotebookOptions] = React.useState([]), [file, setFile] = React.useState(null), [drafts, setDrafts] = React.useState([]), [info, setInfo] = React.useState(null), [answerKey, setAnswerKey] = React.useState(""), [busy, setBusy] = React.useState(false), [notice, setNotice] = React.useState("");
  React.useEffect(() => { supabase.from("study_notebooks").select("id,title,visibility").eq("visibility","official").order("title").then(({data})=>setNotebookOptions(data||[])); },[supabase]);
  const patchMeta = (key, value) => setMetadata((current) => ({ ...current, [key]: value }));
  const patchQuestion = (id, patch) => setDrafts((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item));
  function selectFile(fileToRead) {
    setFile(fileToRead); setDrafts([]); setInfo(null); setNotice(`Arquivo selecionado: ${fileToRead.name}. Clique em “Extrair questões para revisão”.`);
  }
  async function inspectFile() {
    if (!file) return setNotice("Selecione um PDF antes de extrair.");
    setBusy(true); setNotice("Lendo o PDF, removendo cabeçalhos e preservando a continuidade entre páginas…");
    try {
      const result = await extractPdfV2(file);
      const parsed = parseQuestionsV2(result.text);
      setInfo(result); setDrafts(parsed);
      if (!parsed.length) { setNotice("Não encontrei questões objetivas com número e alternativas. Verifique se o PDF possui texto selecionável."); return; }
      let cleaned = [...parsed], providerName = "extração local", errorMessage = "";
      for (let start = 0; start < parsed.length; start += 6) {
        setNotice(`Groq: revisando estrutura e removendo ruídos do PDF — ${Math.min(start+6,parsed.length)} de ${parsed.length} questões…`);
        const group = parsed.slice(start,start+6);
        const { data, error } = await supabase.functions.invoke("prepare-exam-import", {
          body: { questions:group.map(({question_number,statement,alternatives})=>({question_number,statement,alternatives})), source_text:result.text.slice(0,6500),metadata }
        });
        if (error || data?.error) { errorMessage = data?.error || error?.message || "Falha na preparação por IA"; break; }
        providerName = data.provider || providerName;
        const results = new Map((data.questions||[]).map(row=>[Number(row.question_number),row]));
        cleaned = cleaned.map((item,index) => index < start || index >= start+group.length ? item : {
          ...item,...(results.get(item.question_number) ? {
            statement:results.get(item.question_number).statement || item.statement,
            alternatives:results.get(item.question_number).alternatives || item.alternatives,
            warnings:[...(item.warnings||[]),...(results.get(item.question_number).warnings||[])]
          } : {})
        });
        if (start === 0 && data.metadata) setMetadata(old=>({
          ...old,
          concurso:old.concurso || data.metadata.concurso || "",
          banca:old.banca || data.metadata.banca || "",
          ano:old.ano || data.metadata.ano || "",
          edicao:old.edicao || data.metadata.edicao || "",
          cargo:old.cargo || data.metadata.cargo || ""
        }));
        setDrafts(cleaned);
      }
      setDrafts(cleaned);
      setNotice(errorMessage
        ? `${parsed.length} questões extraídas; a limpeza por IA não terminou (${errorMessage}). Revise os textos antes de salvar.`
        : `${cleaned.length} questões revisadas pela IA (${providerName}). Confira enunciados, alternativas e gabarito antes de salvar.`);
    } catch (error) { setNotice(`Não foi possível ler o PDF: ${error.message}`); } finally { setBusy(false); }
  }
  function applyAnswerKey() {
    if (!drafts.length) return setNotice("Extraia as questões antes de aplicar o gabarito.");
    const parsed = parseAnswerKeyV2(answerKey); if (!parsed.size) return setNotice("Não identifiquei respostas no gabarito. Exemplo: 1 D 2 B 3 E 4 *");
    let applied = 0;
    setDrafts((items) => items.map((item) => {
      const correctOption = parsed.get(Number(item.question_number));
      if (!correctOption) return item;
      applied += 1;
      return { ...item, correct_option:correctOption };
    }));
    setNotice(`${applied} resposta(s) do gabarito aplicada(s) às questões extraídas.`);
  }
  async function save() {
    const chosen = drafts.filter((item) => item.selected);
    if (!chosen.length) return setNotice("Selecione ao menos uma questão para salvar.");
    if (!metadata.concurso.trim() || !metadata.banca.trim() || !Number(metadata.ano) || !metadata.notebook_id) return setNotice("Confira o concurso, a banca, o ano e selecione o caderno de destino antes de salvar.");
    if (chosen.some((item) => !item.statement.trim() || item.alternatives.length < 2)) return setNotice("Revise as questões sem enunciado ou sem alternativas suficientes antes de salvar.");
    setBusy(true); setNotice("");
    try {
      const { data: imported, error: importError } = await supabase.from("question_imports").insert({ file_name:file?.name || "prova.pdf", concurso:metadata.concurso.trim(), edicao:metadata.edicao.trim() || null, ano:Number(metadata.ano), banca:metadata.banca.trim(), notebook_id:metadata.notebook_id, cargo:metadata.cargo.trim() || null, application_date:metadata.application_date || null, total_extracted:drafts.length, total_selected:chosen.length, import_metadata:{ page_count:info?.pageCount || 0, removed_repeated_layout_lines:info?.removedLayoutLines || 0 } }).select("id").single();
      if (importError) throw importError;
      const rows = chosen.map((item) => ({ import_id:imported.id, question_number:item.question_number, statement:item.statement.trim(), alternatives:item.alternatives, answer_key_option:item.correct_option || null, extraction_warnings:item.warnings, status:"pending_ai", source_page_range:null, raw_payload:{ imported_file:file?.name || null } }));
      const { error } = await supabase.from("questions_v2").insert(rows); if (error) throw error;
      setDrafts([]); setFile(null); setInfo(null); setNotice(`${rows.length} questão(ões) salvas como pendentes do Filtro de IA. Elas não foram publicadas no sistema atual.`);
    } catch (error) { setNotice(`Não foi possível salvar: ${error.message}`); } finally { setBusy(false); }
  }
  const noWarnings = drafts.filter((item) => !item.warnings.length).length;
  return <section className="system2-page"><button className="link-button" onClick={onBack}>← Voltar ao Modelo novo</button><span className="eyebrow">NOVO CADASTRO DE QUESTÕES</span><h1>Importar e revisar prova</h1><p className="system2-lead">Envie o PDF. O Groq sugere os metadados e limpa as questões, enquanto você confere os dados e o gabarito antes de salvar.</p>{notice && <p className="form-message">{notice}</p>}<section className="card system2-form"><h2>Dados da prova</h2><div className="system2-fields"><label>Caderno de destino *<select value={metadata.notebook_id} onChange={event=>patchMeta("notebook_id",event.target.value)}><option value="">Escolha o caderno oficial</option>{notebookOptions.map(book=><option key={book.id} value={book.id}>{book.title}</option>)}</select></label><label>Concurso *<input value={metadata.concurso} onChange={(event) => patchMeta("concurso", event.target.value)} placeholder="Exame de Ordem Unificado" /></label><label>Edição<input value={metadata.edicao} onChange={(event) => patchMeta("edicao", event.target.value)} placeholder="46ª" /></label><label>Ano *<input type="number" value={metadata.ano} onChange={(event) => patchMeta("ano", event.target.value)} /></label><label>Banca *<input value={metadata.banca} onChange={(event) => patchMeta("banca", event.target.value)} placeholder="FGV" /></label><label>Cargo<input value={metadata.cargo} onChange={(event) => patchMeta("cargo", event.target.value)} /></label><label>Data da prova<input type="date" value={metadata.application_date} onChange={(event) => patchMeta("application_date", event.target.value)} /></label></div><div className="system2-upload"><b>Enviar prova</b><small>PDF com texto selecionável. O arquivo é processado apenas para revisão; as questões só serão gravadas ao final.</small><label className={`drop ${file ? "file-ready" : ""}`}>{file ? `✓ PDF selecionado: ${file.name}` : "Selecionar PDF"}<input hidden type="file" accept="application/pdf" disabled={busy} onChange={(event) => event.target.files?.[0] && selectFile(event.target.files[0])} /></label>{file && <button type="button" disabled={busy} onClick={inspectFile}>{busy ? "Extraindo questões…" : "Extrair questões para revisão"}</button>}</div></section>{drafts.length > 0 && <><section className="card system2-answer-key"><h2>Gabarito da prova</h2><p>Cole no formato <b>1 D 2 B 3 E 4 *</b>. Use * ou X para questão anulada.</p><textarea rows="4" value={answerKey} onChange={(event) => setAnswerKey(event.target.value)} placeholder="1 D 2 B 3 E 4 * 5 A" /><button type="button" className="light" onClick={applyAnswerKey}>Aplicar gabarito às questões</button></section><section className="card system2-summary"><div><span className="eyebrow">IMPORTAÇÃO</span><b>Arquivo: {file?.name}</b><small>{metadata.concurso} · {metadata.edicao && `${metadata.edicao} · `}{metadata.ano} · {metadata.banca}</small></div><div><b>{drafts.length}</b><small>Questões identificadas</small></div><div><b>{noWarnings}</b><small>Sem alertas</small></div><div><b>{drafts.length - noWarnings}</b><small>Revisão recomendada</small></div></section><div className="system2-review-actions"><label><input type="checkbox" checked={drafts.every((item) => item.selected)} onChange={(event) => setDrafts((items) => items.map((item) => ({ ...item, selected:event.target.checked })))} /> Selecionar todas</label><button disabled={busy} onClick={save}>{busy ? "Salvando…" : "Salvar questões"}</button></div><div className="system2-question-list">{drafts.map((item) => <article className="card system2-question-card" key={item.id}><div className="card-top"><label className="card-check"><input type="checkbox" checked={item.selected} onChange={(event) => patchQuestion(item.id, { selected:event.target.checked })} /> Salvar</label><b>Questão {String(item.question_number).padStart(2, "0")}</b>{item.correct_option && <span className="system2-gabarito">Gabarito: {item.correct_option === "*" ? "Anulada" : item.correct_option}</span>}<button className="light compact" onClick={() => setDrafts((items) => items.filter((entry) => entry.id !== item.id))}>Excluir da importação</button></div>{item.warnings.map((warning) => <p className="system2-warning" key={warning}>⚠ {warning}</p>)}<label>Número<input type="number" value={item.question_number} onChange={(event) => patchQuestion(item.id, { question_number:Number(event.target.value) || "" })} /></label><label>Enunciado<textarea rows="6" value={item.statement} onChange={(event) => patchQuestion(item.id, { statement:event.target.value })} /></label><div className="system2-alternatives">{item.alternatives.map((alternative, index) => <label key={`${alternative.letter}-${index}`}><b>{alternative.letter})</b><textarea rows="3" value={alternative.text} onChange={(event) => patchQuestion(item.id, { alternatives:item.alternatives.map((entry, position) => position === index ? { ...entry, text:event.target.value } : entry) })} /></label>)}</div></article>)}</div></>}</section>;
}

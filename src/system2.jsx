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

const emptyMetadata = { concurso: "", edicao: "", ano: new Date().getFullYear(), banca: "", cargo: "", application_date: "" };

export function System2Home({ openCadastro, openFilter, openContent }) {
  return <section className="system2-page"><span className="eyebrow">NOVA ARQUITETURA</span><h1>Sistema 2.0</h1><p className="system2-lead">Nova arquitetura de cadastro, análise e organização das questões.</p><div className="system2-flow"><b>Cadastro de Questões</b><i>→</i><b>Filtro de IA</b><i>→</i><b>Controle de Conteúdo</b><i>→</i><b>Sistema de Estudos</b></div><div className="system2-module-grid"><article className="card system2-module active"><span>01</span><h2>Cadastro de Questões</h2><p>Importação e estruturação inicial das provas, com revisão humana antes de qualquer salvamento.</p><button onClick={openCadastro}>Acessar Cadastro 2.0 →</button></article><article className="card system2-module"><span>02</span><h2>Filtro de IA</h2><p>Acompanhe as questões pendentes, em análise e as que precisam de revisão humana.</p><button className="light" onClick={openFilter}>Acessar Filtro de IA →</button></article><article className="card system2-module"><span>03</span><h2>Controle de Conteúdo</h2><p>Consulte as questões aprovadas, agrupadas por concurso, edição e ano.</p><button className="light" onClick={openContent}>Acessar Controle de Conteúdo →</button></article></div><div className="system2-note">O Sistema 2.0 está sendo desenvolvido paralelamente ao sistema atual e ainda não interfere nas questões disponíveis aos usuários.</div></section>;
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
    const { data, error: queryError } = await supabase.from("questions_v2").select("id, question_number, statement, status, ai_attempts, ai_last_error, ai_processed_at, created_at, import:question_imports(concurso, edicao, ano, banca)").order("created_at", { ascending:false });
    if (queryError) setError(queryError.message); else setQuestions(data || []);
    setLoading(false);
  }, [supabase]);
  React.useEffect(() => { load(); }, [load]);
  return { questions, loading, error, reload:load };
}

function System2QuestionRow({ item }) {
  const source = item.import || {};
  return <article className="system2-tracking-row"><div><b>Questão {String(item.question_number).padStart(2, "0")}</b><p>{cleanSpace(item.statement).slice(0, 180)}{item.statement.length > 180 ? "…" : ""}</p><small>{source.concurso || "Concurso não informado"} · {source.edicao && `${source.edicao} · `}{source.ano || "—"} · {source.banca || "—"}</small></div><div className={`system2-status ${item.status}`}><b>{statusInfo[item.status]?.label || item.status}</b><small>{item.ai_processed_at ? `Processada em ${new Date(item.ai_processed_at).toLocaleDateString("pt-BR")}` : `Tentativas de IA: ${item.ai_attempts || 0}`}</small>{item.ai_last_error && <small className="system2-error">Último erro: {item.ai_last_error}</small>}</div></article>;
}

export function System2Filter({ supabase, onBack, openContent }) {
  const { questions, loading, error, reload } = useSystem2Questions(supabase);
  const [tab, setTab] = React.useState("pending_ai");
  const tabs = ["pending_ai", "processing_ai", "needs_review"];
  const selected = questions.filter((item) => item.status === tab);
  return <section className="system2-page"><button className="link-button" onClick={onBack}>← Voltar ao Sistema 2.0</button><span className="eyebrow">ETAPA 02</span><h1>Filtro de IA</h1><p className="system2-lead">Acompanhe a fila real de análise. As questões só seguem ao Controle de Conteúdo quando forem aprovadas.</p><div className="system2-tabs">{tabs.map((id) => <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{statusInfo[id].label} <b>{questions.filter((item) => item.status === id).length}</b></button>)}</div><div className="system2-toolbar"><p>{statusInfo[tab].detail}</p><button className="light compact" onClick={reload}>Atualizar dados</button></div>{loading ? <p className="empty-state">Carregando a fila…</p> : error ? <p className="form-message">Não foi possível carregar a fila: {error}</p> : selected.length ? <div className="system2-tracking-list">{selected.map((item) => <System2QuestionRow key={item.id} item={item} />)}</div> : <div className="card empty-state"><b>Nenhuma questão nesta etapa.</b><p>Quando uma questão for salva no Cadastro 2.0, ela aparecerá em “Pendentes de análise”.</p></div>}<div className="system2-note">A automação de análise ainda será conectada ao Filtro de IA. Até lá, esta tela mostra fielmente o status já gravado no banco, sem simular processamento.</div><button className="light" onClick={openContent}>Ir para Controle de Conteúdo →</button></section>;
}

export function System2Content({ supabase, onBack }) {
  const { questions, loading, error, reload } = useSystem2Questions(supabase);
  const approved = questions.filter((item) => item.status === "approved");
  const groups = approved.reduce((result, item) => { const source = item.import || {}; const key = [source.concurso || "Sem concurso", source.edicao || "", source.ano || "", source.banca || ""].join("|"); (result[key] ||= { source, items:[] }).items.push(item); return result; }, {});
  return <section className="system2-page"><button className="link-button" onClick={onBack}>← Voltar ao Sistema 2.0</button><span className="eyebrow">ETAPA 03</span><h1>Controle de Conteúdo</h1><p className="system2-lead">Questões aprovadas pelo Filtro de IA, organizadas para a próxima etapa de publicação.</p><div className="system2-toolbar"><p><b>{approved.length}</b> questão(ões) aprovada(s) no Sistema 2.0.</p><button className="light compact" onClick={reload}>Atualizar dados</button></div>{loading ? <p className="empty-state">Carregando questões aprovadas…</p> : error ? <p className="form-message">Não foi possível carregar as questões: {error}</p> : approved.length ? <div className="system2-content-groups">{Object.entries(groups).map(([key, group]) => <section className="card" key={key}><span className="eyebrow">{group.source.banca || "—"}</span><h2>{group.source.concurso || "Concurso não informado"}</h2><p>{group.source.edicao && `${group.source.edicao} · `}{group.source.ano || "Ano não informado"}</p><b>{group.items.length} questão(ões) aprovadas</b></section>)}</div> : <div className="card empty-state"><b>Ainda não há questões aprovadas.</b><p>Elas aparecerão aqui automaticamente depois que o Filtro de IA mudar o status para “approved”.</p></div>}<div className="system2-note">Aprovar uma questão ainda não a publica para os alunos. A integração com o Sistema de Estudos continua separada, como previsto.</div></section>;
}

export function System2Cadastro({ supabase, onBack }) {
  const [metadata, setMetadata] = React.useState(emptyMetadata), [file, setFile] = React.useState(null), [drafts, setDrafts] = React.useState([]), [info, setInfo] = React.useState(null), [answerKey, setAnswerKey] = React.useState(""), [busy, setBusy] = React.useState(false), [notice, setNotice] = React.useState("");
  const patchMeta = (key, value) => setMetadata((current) => ({ ...current, [key]: value }));
  const patchQuestion = (id, patch) => setDrafts((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item));
  function selectFile(fileToRead) {
    if (!metadata.concurso.trim() || !String(metadata.ano).trim() || !metadata.banca.trim()) return setNotice("Preencha concurso, ano e banca antes de enviar a prova.");
    setFile(fileToRead); setDrafts([]); setInfo(null); setNotice(`Arquivo selecionado: ${fileToRead.name}. Clique em “Extrair questões para revisão”.`);
  }
  async function inspectFile() {
    if (!file) return setNotice("Selecione um PDF antes de extrair.");
    setBusy(true); setNotice("Lendo o PDF, removendo cabeçalhos e preservando a continuidade entre páginas…");
    try {
      const result = await extractPdfV2(file); const parsed = parseQuestionsV2(result.text);
      setInfo(result); setDrafts(parsed);
      setNotice(parsed.length ? `${parsed.length} questão(ões) estruturada(s) para revisão.` : "Não encontrei questões objetivas com número e alternativas. Verifique se o PDF possui texto selecionável.");
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
    if (chosen.some((item) => !item.statement.trim() || item.alternatives.length < 2)) return setNotice("Revise as questões sem enunciado ou sem alternativas suficientes antes de salvar.");
    setBusy(true); setNotice("");
    try {
      const { data: imported, error: importError } = await supabase.from("question_imports").insert({ file_name:file?.name || "prova.pdf", concurso:metadata.concurso.trim(), edicao:metadata.edicao.trim() || null, ano:Number(metadata.ano), banca:metadata.banca.trim(), cargo:metadata.cargo.trim() || null, application_date:metadata.application_date || null, total_extracted:drafts.length, total_selected:chosen.length, import_metadata:{ page_count:info?.pageCount || 0, removed_repeated_layout_lines:info?.removedLayoutLines || 0 } }).select("id").single();
      if (importError) throw importError;
      const rows = chosen.map((item) => ({ import_id:imported.id, question_number:item.question_number, statement:item.statement.trim(), alternatives:item.alternatives, answer_key_option:item.correct_option || null, extraction_warnings:item.warnings, status:"pending_ai", source_page_range:null, raw_payload:{ imported_file:file?.name || null } }));
      const { error } = await supabase.from("questions_v2").insert(rows); if (error) throw error;
      setDrafts([]); setFile(null); setInfo(null); setNotice(`${rows.length} questão(ões) salvas como pendentes do Filtro de IA. Elas não foram publicadas no sistema atual.`);
    } catch (error) { setNotice(`Não foi possível salvar: ${error.message}`); } finally { setBusy(false); }
  }
  const noWarnings = drafts.filter((item) => !item.warnings.length).length;
  return <section className="system2-page"><button className="link-button" onClick={onBack}>← Voltar ao Sistema 2.0</button><span className="eyebrow">CADASTRO DE QUESTÕES 2.0</span><h1>Importar e revisar prova</h1><p className="system2-lead">Preencha os dados, envie o PDF e revise as questões antes de salvá-las no pipeline do Sistema 2.0.</p>{notice && <p className="form-message">{notice}</p>}<section className="card system2-form"><h2>Dados da prova</h2><div className="system2-fields"><label>Concurso *<input value={metadata.concurso} onChange={(event) => patchMeta("concurso", event.target.value)} placeholder="Exame de Ordem Unificado" /></label><label>Edição<input value={metadata.edicao} onChange={(event) => patchMeta("edicao", event.target.value)} placeholder="46ª" /></label><label>Ano *<input type="number" value={metadata.ano} onChange={(event) => patchMeta("ano", event.target.value)} /></label><label>Banca *<input value={metadata.banca} onChange={(event) => patchMeta("banca", event.target.value)} placeholder="FGV" /></label><label>Cargo<input value={metadata.cargo} onChange={(event) => patchMeta("cargo", event.target.value)} /></label><label>Data da prova<input type="date" value={metadata.application_date} onChange={(event) => patchMeta("application_date", event.target.value)} /></label></div><div className="system2-upload"><b>Enviar prova</b><small>PDF com texto selecionável. O arquivo é processado apenas para revisão; as questões só serão gravadas ao final.</small><label className={`drop ${file ? "file-ready" : ""}`}>{file ? `✓ PDF selecionado: ${file.name}` : "Selecionar PDF"}<input hidden type="file" accept="application/pdf" disabled={busy} onChange={(event) => event.target.files?.[0] && selectFile(event.target.files[0])} /></label>{file && <button type="button" disabled={busy} onClick={inspectFile}>{busy ? "Extraindo questões…" : "Extrair questões para revisão"}</button>}</div></section>{drafts.length > 0 && <><section className="card system2-answer-key"><h2>Gabarito da prova</h2><p>Cole no formato <b>1 D 2 B 3 E 4 *</b>. Use * ou X para questão anulada.</p><textarea rows="4" value={answerKey} onChange={(event) => setAnswerKey(event.target.value)} placeholder="1 D 2 B 3 E 4 * 5 A" /><button type="button" className="light" onClick={applyAnswerKey}>Aplicar gabarito às questões</button></section><section className="card system2-summary"><div><span className="eyebrow">IMPORTAÇÃO</span><b>Arquivo: {file?.name}</b><small>{metadata.concurso} · {metadata.edicao && `${metadata.edicao} · `}{metadata.ano} · {metadata.banca}</small></div><div><b>{drafts.length}</b><small>Questões identificadas</small></div><div><b>{noWarnings}</b><small>Sem alertas</small></div><div><b>{drafts.length - noWarnings}</b><small>Revisão recomendada</small></div></section><div className="system2-review-actions"><label><input type="checkbox" checked={drafts.every((item) => item.selected)} onChange={(event) => setDrafts((items) => items.map((item) => ({ ...item, selected:event.target.checked })))} /> Selecionar todas</label><button disabled={busy} onClick={save}>{busy ? "Salvando…" : "Salvar questões"}</button></div><div className="system2-question-list">{drafts.map((item) => <article className="card system2-question-card" key={item.id}><div className="card-top"><label className="card-check"><input type="checkbox" checked={item.selected} onChange={(event) => patchQuestion(item.id, { selected:event.target.checked })} /> Salvar</label><b>Questão {String(item.question_number).padStart(2, "0")}</b>{item.correct_option && <span className="system2-gabarito">Gabarito: {item.correct_option === "*" ? "Anulada" : item.correct_option}</span>}<button className="light compact" onClick={() => setDrafts((items) => items.filter((entry) => entry.id !== item.id))}>Excluir da importação</button></div>{item.warnings.map((warning) => <p className="system2-warning" key={warning}>⚠ {warning}</p>)}<label>Número<input type="number" value={item.question_number} onChange={(event) => patchQuestion(item.id, { question_number:Number(event.target.value) || "" })} /></label><label>Enunciado<textarea rows="6" value={item.statement} onChange={(event) => patchQuestion(item.id, { statement:event.target.value })} /></label><div className="system2-alternatives">{item.alternatives.map((alternative, index) => <label key={`${alternative.letter}-${index}`}><b>{alternative.letter})</b><textarea rows="3" value={alternative.text} onChange={(event) => patchQuestion(item.id, { alternatives:item.alternatives.map((entry, position) => position === index ? { ...entry, text:event.target.value } : entry) })} /></label>)}</div></article>)}</div></>}</section>;
}

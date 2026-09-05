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
  const rows = [];
  [...content.items].filter((item) => item.str?.trim()).forEach((item) => {
    const y = item.transform[5], x = item.transform[4];
    let row = rows.find((entry) => Math.abs(entry.y - y) < 3);
    if (!row) { row = { y, items: [] }; rows.push(row); }
    row.items.push({ x, text: item.str });
  });
  return rows.sort((a, b) => b.y - a.y).map((row) => ({
    text: cleanSpace(row.items.sort((a, b) => a.x - b.x).map((item) => item.text).join(" ")),
    zone: row.y > viewport.height * .84 ? "header" : row.y < viewport.height * .16 ? "footer" : "body",
  })).filter((row) => row.text);
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
    return !(looksLikePageNumber || (line.zone !== "body" && repeatedLayout.has(key)));
  }).map((line) => line.text).join("\n"));
  return { pageCount: pdf.numPages, text: pageTexts.join("\n\n"), removedLayoutLines: repeatedLayout.size };
}

function startsQuestion(line) {
  return line.match(/^\s*(?:quest[ãa]o\s*)?(\d{1,3})\s*(?:[.)º°-]|\b)\s+/i);
}
function startsOption(line) {
  return line.match(new RegExp(`^\\s*(?:\\(?([${optionLetters}])\\)?[).:-])\\s+`, "i"));
}
function parseQuestionsV2(text) {
  const lines = String(text || "").replace(/\r/g, "").split("\n").map(cleanSpace).filter(Boolean);
  const starts = lines.map((line, index) => ({ index, match: startsQuestion(line) })).filter((entry) => entry.match);
  return starts.map((start, index) => {
    const end = index + 1 < starts.length ? starts[index + 1].index : lines.length;
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
    if (!alternatives.at(-1)?.text || alternatives.at(-1).text.length < 2) warnings.push("Última alternativa parece incompleta.");
    if (/\b(p[aá]gina|www\.|todos os direitos reservados|fgv conhecimento)\b/i.test(alternatives.at(-1)?.text || "")) warnings.push("Trecho potencialmente pertencente ao rodapé na última alternativa.");
    if (block.length > 18 && !/\n/.test(statement)) warnings.push("Possível quebra de página ou estrutura longa: revise o enunciado.");
    return { id: crypto.randomUUID(), question_number: Number(start.match[1]), statement, alternatives, correct_option: "", warnings, selected: true };
  }).filter((item) => item.statement || item.alternatives.length);
}

const emptyMetadata = { concurso: "", edicao: "", ano: new Date().getFullYear(), banca: "", cargo: "", application_date: "" };

export function System2Home({ openCadastro }) {
  return <section className="system2-page"><span className="eyebrow">NOVA ARQUITETURA</span><h1>Sistema 2.0</h1><p className="system2-lead">Nova arquitetura de cadastro, análise e organização das questões.</p><div className="system2-flow"><b>Cadastro de Questões</b><i>→</i><b>Filtro de IA</b><i>→</i><b>Controle de Conteúdo</b><i>→</i><b>Sistema de Estudos</b></div><div className="system2-module-grid"><article className="card system2-module active"><span>01</span><h2>Cadastro de Questões</h2><p>Importação e estruturação inicial das provas, com revisão humana antes de qualquer salvamento.</p><em>Em desenvolvimento</em><button onClick={openCadastro}>Acessar Cadastro 2.0 →</button></article><article className="card system2-module"><span>02</span><h2>Filtro de IA</h2><p>Classificação jurídica, subtópicos, alternativas e conteúdo-base, em fila controlada no servidor.</p><em>Próxima etapa</em></article><article className="card system2-module"><span>03</span><h2>Controle de Conteúdo</h2><p>Organização futura: Concurso → Edição → Ano → Questões analisadas.</p><em>Próxima etapa</em></article></div><div className="system2-note">O Sistema 2.0 está sendo desenvolvido paralelamente ao sistema atual e ainda não interfere nas questões disponíveis aos usuários.</div></section>;
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

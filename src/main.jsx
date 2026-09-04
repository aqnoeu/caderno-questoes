import React from "react";
import { createRoot } from "react-dom/client";
import { createClient } from "@supabase/supabase-js";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "./styles.css";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
);
const letters = ["A", "B", "C", "D", "E"];
const shuffle = (list) => {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};
const normalize = (t) =>
  (t || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b\d+\b/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const splitSubjects = (value) =>
  String(value || "")
    .split(/\s*(?:[;|]|·|•)\s*/)
    .map((item) => item.trim())
    .filter(Boolean);
const formatSubjects = (value) => [...new Set(splitSubjects(value))].join(" · ");
const hasSubject = (question, subject) => !subject || splitSubjects(question.subject).includes(subject);
const subjectOptions = (questions, discipline = "") =>
  [...new Set(questions.filter((question) => !discipline || question.discipline === discipline).flatMap((question) => splitSubjects(question.subject)))].sort();
const similarity = (a, b) => {
  const A = new Set(
      normalize(a)
        .split(" ")
        .filter((x) => x.length > 2),
    ),
    B = new Set(
      normalize(b)
        .split(" ")
        .filter((x) => x.length > 2),
    );
  if (!A.size || !B.size) return 0;
  let n = 0;
  A.forEach((x) => B.has(x) && n++);
  return (2 * n) / (A.size + B.size);
};
const categoryRules = [
  {
    test: /\b(adpf|argui[cç][aã]o de descumprimento)\b/i,
    discipline: "Direito Constitucional",
    subject: "Arguição de Descumprimento de Preceito Fundamental (ADPF)",
  },
  {
    test: /\b(adi|a[cç][aã]o direta de inconstitucionalidade)\b/i,
    discipline: "Direito Constitucional",
    subject: "Ação Direta de Inconstitucionalidade (ADI)",
  },
  {
    test: /\b(controle de constitucionalidade|constitucionalidade|inconstitucionalidade)\b/i,
    discipline: "Direito Constitucional",
    subject: "Controle de Constitucionalidade",
  },
  {
    test: /\b(direitos? fundamentais?|rem[eé]dios? constitucionais?|habeas corpus|mandado de seguran[cç]a)\b/i,
    discipline: "Direito Constitucional",
    subject: "Direitos e Garantias Fundamentais",
  },
  {
    test: /\b(administra[cç][aã]o p[uú]blica|ato administrativo|licita[cç][aã]o|servidor p[uú]blico)\b/i,
    discipline: "Direito Administrativo",
    subject: "Administração Pública",
  },
  {
    test: /\b(crime|pena|c[oó]digo penal|tipicidade|culpabilidade)\b/i,
    discipline: "Direito Penal",
    subject: "Teoria do Crime",
  },
  {
    test: /\b(processo penal|inqu[eé]rito|pris[aã]o preventiva|a[cç][aã]o penal)\b/i,
    discipline: "Direito Processual Penal",
    subject: "Processo Penal",
  },
  {
    test: /\b(c[oó]digo civil|contrato|obriga[cç][aã]o civil|responsabilidade civil)\b/i,
    discipline: "Direito Civil",
    subject: "Obrigações e Responsabilidade Civil",
  },
  {
    test: /\b(processo civil|cpc|recurso|tutela provis[oó]ria|cumprimento de senten[cç]a)\b/i,
    discipline: "Direito Processual Civil",
    subject: "Processo Civil",
  },
  {
    test: /\b(tributo|imposto|taxa|contribui[cç][aã]o tribut[aá]ria|cr[eé]dito tribut[aá]rio)\b/i,
    discipline: "Direito Tributário",
    subject: "Sistema Tributário",
  },
  {
    test: /\b(empregado|empregador|clt|contrato de trabalho|rela[cç][aã]o de emprego)\b/i,
    discipline: "Direito do Trabalho",
    subject: "Relação de Emprego",
  },
  {
    test: /\b(processo do trabalho|reclama[cç][aã]o trabalhista|justi[cç]a do trabalho)\b/i,
    discipline: "Direito Processual do Trabalho",
    subject: "Processo do Trabalho",
  },
  {
    test: /\b(consumidor|fornecedor|cdc|rela[cç][aã]o de consumo)\b/i,
    discipline: "Direito do Consumidor",
    subject: "Relação de Consumo",
  },
  {
    test: /\b(meio ambiente|ambiental|dano ambiental|licenciamento ambiental)\b/i,
    discipline: "Direito Ambiental",
    subject: "Proteção Ambiental",
  },
];
function autoClassify(statement, saved = []) {
  const similar = saved
    .filter((x) => x.discipline || x.subject)
    .map((x) => ({ x, score: similarity(statement, x.statement) }))
    .sort((a, b) => b.score - a.score)[0];
  if (similar?.score >= 0.45)
    return {
      discipline: similar.x.discipline || "",
      subject: similar.x.subject || "",
    };
  const rule = categoryRules.find((x) => x.test.test(statement));
  return rule
    ? { discipline: rule.discipline, subject: rule.subject }
    : { discipline: "", subject: "" };
}
function removePdfHeadersAndFooters(text) {
  return text
    .replace(/(?:^|\n)\s*ESCOLA\s+NACIONAL\s+DE\s+FORMA[CÇ][AÃ]O\s+E\s+APERFEIÇOAMENTO\s+DE\s+MAGISTRADOS\s*-?\s*ENFAM\s*(?=\n|$)/gim, "\n")
    .replace(/(?:^|\n)\s*FGV\s+CONHECIMENTO\s+TIPO\s+[^\n]*?-\s*P[ÁA]GINA\s*\d+\s*-?\s*(?=\n|$)/gim, "\n")
    .replace(/(?:^|\n)\s*P[ÁA]GINA\s+\d+\s*(?=\n|$)/gim, "\n");
}
function parseQuestions(text) {
  const clean = removePdfHeadersAndFooters(text).replace(/\r/g, "").trim(),
    marks = [
      ...clean.matchAll(/(?:^|\n)\s*(\d{1,3})(?:\s*[.)º°-]\s*|\s*\n\s*)/g),
    ];
  return marks
    .map((m, i) => {
      const block = clean
          .slice(
            m.index + m[0].length,
            i + 1 < marks.length ? marks[i + 1].index : clean.length,
          )
          .trim(),
        am = [
          ...block.matchAll(
            /(?:^|\n|\s)(?:\(\s*([A-E])\s*\)|([A-E])\s*[).:-])\s+/g,
          ),
        ];
      if (am.length < 2) return null;
      return {
        tempId: crypto.randomUUID(),
        original_number: +m[1],
        statement: block.slice(0, am[0].index).trim(),
        alternatives: am.map((x, j) => ({
          letter: x[1] || x[2],
          text: block
            .slice(
              x.index + x[0].length,
              j + 1 < am.length ? am[j + 1].index : block.length,
            )
            .trim(),
        })),
        correct_option: "",
        discipline: "",
        subject: "",
        banca: "",
        ano: "",
        concurso: "",
        explanation: "",
        difficulty_initial: "media",
        difficulty_current: "media",
        ai_confidence: null,
        ai_analyzed_at: null,
        is_annulled: false,
        selected: true,
        expanded: false,
        aiStatus: "pending",
        duplicate: null,
      };
    })
    .filter(Boolean);
}

function parseAnswerKey(text) {
  const tokens =
    text.toUpperCase().match(/\b\d{1,3}\b|\b[A-E]\b|\*|\bX\b|\bANULAD[AO]\b/g) || [];
  const result = new Map();
  for (let i = 0; i < tokens.length; i++) {
    if (!/^\d+$/.test(tokens[i])) continue;
    const number = Number(tokens[i]);
    const next = tokens[i + 1];
    if (/^[A-E]$/.test(next || "")) {
      result.set(number, next);
      i++;
    } else if (/^(\*|X|ANULAD[AO])$/.test(next || "")) {
      result.set(number, "*");
      i++;
    } else {
      result.set(number, "*");
    }
  }
  return result;
}

function App() {
  const [session, setSession] = React.useState(undefined),
    [tab, setTab] = React.useState("inicio"),
    [adminTab, setAdminTab] = React.useState("overview"),
    [area, setArea] = React.useState("user"),
    [profile, setProfile] = React.useState(undefined),
    [questions, setQuestions] = React.useState([]),
    [drafts, setDrafts] = React.useState([]),
    [raw, setRaw] = React.useState(""),
    [answerKey, setAnswerKey] = React.useState(""),
    [notice, setNotice] = React.useState(""),
    [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);
  const loadProfile = React.useCallback(async () => {
    if (!session?.user) return setProfile(null);
    const { data, error } = await supabase.from("profiles").select("id,email,role,display_name").eq("id", session.user.id).maybeSingle();
    if (error) { setNotice(`Não foi possível carregar seu perfil: ${error.message}`); setProfile({ role: "user", email: session.user.email }); }
    else setProfile(data || { role: "user", email: session.user.email });
  }, [session]);
  React.useEffect(() => { loadProfile(); }, [loadProfile]);
  const load = React.useCallback(async () => {
    if (!session) return;
    const { data, error } = await supabase
      .from("questions")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) setNotice(error.message);
    else setQuestions(data || []);
  }, [session]);
  React.useEffect(() => {
    load();
  }, [load]);
  if (session === undefined || (session && profile === undefined)) return <div className="center">Carregando…</div>;
  if (!session) return <Auth />;
  const isAdmin = profile?.role === "admin";
  async function readPdf(file) {
    setBusy(true);
    setNotice("Lendo PDF…");
    try {
      const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() })
        .promise;
      let all = "";
      for (let p = 1; p <= pdf.numPages; p++) {
        const page = await pdf.getPage(p),
          content = await page.getTextContent();
        all +=
          content.items.map((x) => x.str + (x.hasEOL ? "\n" : " ")).join("") +
          "\n";
      }
      setRaw(all);
      setNotice(
        `${pdf.numPages} página(s) lida(s). Clique em Separar questões.`,
      );
    } catch (e) {
      setNotice("Não foi possível ler o PDF: " + e.message);
    } finally {
      setBusy(false);
    }
  }
  function process() {
    const q = parseQuestions(raw).map((item) => {
      const hit = questions
        .map((x) => ({ id: x.id, statement: x.statement, score: similarity(item.statement, x.statement) }))
        .sort((a, b) => b.score - a.score)[0];
      const duplicate = hit?.score >= 0.62 ? hit : null;
      return {
        ...item,
        ...autoClassify(item.statement, questions),
        duplicate,
        selected: !duplicate,
      };
    });
    setDrafts(q);
    setNotice(
      q.length
        ? `${q.length} questão(ões) identificadas. Agora cole e aplique o gabarito.`
        : "Nenhuma questão foi identificada. Confira a numeração e as alternativas.",
    );
  }
  function applyAnswerKey() {
    if (!drafts.length)
      return setNotice("Separe as questões antes de aplicar o gabarito.");
    const parsed = parseAnswerKey(answerKey);
    if (!parsed.size) return setNotice("Nenhuma resposta foi identificada no gabarito.");
    let applied = 0,
      annulled = 0;
    setDrafts((items) =>
      items.map((item) => {
        if (!parsed.has(item.original_number)) return item;
        const correct_option = parsed.get(item.original_number);
        applied++;
        if (correct_option === "*") annulled++;
        return {
          ...item,
          correct_option,
          is_annulled: correct_option === "*",
          explanation:
            correct_option === "*"
              ? "Questão anulada conforme o gabarito oficial."
              : item.explanation,
          aiStatus: correct_option === "*" ? "skipped" : item.aiStatus,
        };
      }),
    );
    setNotice(
      `${applied} resposta(s) aplicada(s), incluindo ${annulled} questão(ões) anulada(s). Revise antes de salvar.`,
    );
  }
  async function analyzeSelected() {
    const targets = drafts.filter(
      (q) => q.selected && !q.is_annulled && /^[A-E]$/.test(q.correct_option),
    );
    if (!targets.length)
      return setNotice("Selecione questões completas e com gabarito para analisar.");
    setBusy(true);
    setDrafts((ds) => ds.map((q) => targets.some((t) => t.tempId === q.tempId) ? { ...q, aiStatus: "analyzing" } : q));
    let done = 0;
    let failed = 0;
    try {
      // Cinco por vez reduz picos no Gemini. Os blocos são enviados em sequência.
      for (let start = 0; start < targets.length; start += 5) {
        const group = targets.slice(start, start + 5);
        setNotice(`Analisando com IA: ${done}/${targets.length} concluída(s)…`);
        let data;
        let lastError;
        for (let attempt = 1; attempt <= 3; attempt += 1) {
          const response = await supabase.functions.invoke("analyze-questions", {
            body: {
              classification_instruction: "Em subject, indique todos os assuntos jurídicos relevantes. Quando houver mais de um, devolva uma única string separada por ' · '. Exemplo: 'Direitos LGBT+ · Legislação infraconstitucional'. Não use numeração.",
              questions: group.map((q, index) => ({
                index,
                statement: q.statement,
                alternatives: Object.fromEntries(q.alternatives.map((a) => [a.letter, a.text])),
                correct_option: q.correct_option,
              })),
            },
          });
          if (!response.error) {
            data = response.data;
            break;
          }
          lastError = response.error;
          if (attempt < 3) {
            setNotice(`Gemini ocupado; tentando novamente (${attempt}/3)…`);
            await new Promise((resolve) => setTimeout(resolve, attempt * 2500));
          }
        }
        if (!data) {
          failed += group.length;
          setDrafts((ds) => ds.map((q) => group.some((g) => g.tempId === q.tempId) ? { ...q, aiStatus: "error" } : q));
          done += group.length;
          console.error("Falha ao analisar bloco", lastError);
          continue;
        }
        const byIndex = new Map((data?.results || []).map((r) => [r.index, r]));
        setDrafts((ds) => ds.map((q) => {
          const localIndex = group.findIndex((g) => g.tempId === q.tempId);
          if (localIndex < 0) return q;
          const result = byIndex.get(localIndex);
          return result ? {
            ...q,
            discipline: result.discipline || q.discipline,
            subject: formatSubjects(result.subject || q.subject),
            explanation: result.explanation || q.explanation,
            difficulty_initial: result.difficulty || "media",
            difficulty_current: result.difficulty || "media",
            ai_confidence: Math.max(0, Math.min(1, Number(result.confidence) || 0)),
            ai_analyzed_at: new Date().toISOString(),
            aiStatus: "analyzed",
          } : { ...q, aiStatus: "error" };
        }));
        done += group.length;
        if (start + 5 < targets.length) await new Promise((resolve) => setTimeout(resolve, 1200));
      }
      setNotice(failed ? `${done - failed} questão(ões) analisada(s); ${failed} ficaram pendentes. Você pode selecioná-las e tentar novamente.` : `${done} questão(ões) analisada(s) pela IA. Revise antes de salvar.`);
    } catch (error) {
      setDrafts((ds) => ds.map((q) => q.aiStatus === "analyzing" ? { ...q, aiStatus: "error" } : q));
      setNotice(`Erro na análise com IA: ${error.message}`);
    } finally {
      setBusy(false);
    }
  }
  function payloadFor(q) {
    return {
      user_id: session.user.id,
      statement: q.statement.trim(),
      alternatives: q.alternatives,
      correct_option: q.correct_option,
      discipline: q.discipline?.trim() || null,
      subject: formatSubjects(q.subject) || null,
      explanation: q.explanation?.trim() || null,
      normalized_statement: normalize(q.statement),
      original_number: q.original_number || null,
      is_annulled: Boolean(q.is_annulled),
      difficulty_initial: q.difficulty_initial || "media",
      difficulty_current: q.difficulty_current || q.difficulty_initial || "media",
      ai_confidence: q.ai_confidence,
      ai_analyzed_at: q.ai_analyzed_at,
      banca: q.banca?.trim() || null,
      ano: q.ano ? Number(q.ano) : null,
      concurso: q.concurso?.trim() || null,
    };
  }
  async function saveBatch(mode = "selected") {
    const chosen = drafts.filter((q) => mode === "all" ? true : q.selected);
    const valid = chosen.filter((q) =>
      q.statement.trim() && q.alternatives.length >= 2 &&
      (q.is_annulled || /^[A-E]$/.test(q.correct_option)) &&
      q.discipline?.trim() && q.subject?.trim() && q.explanation?.trim(),
    );
    if (!chosen.length) return setNotice("Nenhuma questão foi selecionada.");
    if (valid.length !== chosen.length)
      return setNotice(`${chosen.length - valid.length} questão(ões) incompleta(s). Corrija ou retire a seleção.`);
    const duplicates = valid.filter((q) => q.duplicate);
    if (duplicates.length && !confirm(`${duplicates.length} possível(is) duplicidade(s) está(ão) selecionada(s). Deseja salvar mesmo assim?`)) return;
    setBusy(true);
    const { error } = await supabase.from("questions").insert(valid.map(payloadFor));
    setBusy(false);
    if (error) return setNotice(error.message);
    const savedIds = new Set(valid.map((q) => q.tempId));
    setDrafts((ds) => ds.filter((q) => !savedIds.has(q.tempId)));
    setNotice(`${valid.length} questão(ões) salva(s) com sucesso.`);
    load();
  }
  function deleteSelected() {
    const count = drafts.filter((q) => q.selected).length;
    if (!count || !confirm(`Excluir ${count} questão(ões) deste lote?`)) return;
    setDrafts((ds) => ds.filter((q) => !q.selected));
  }
  function applyBulk(discipline, subject) {
    if (!discipline && !subject) return setNotice("Informe uma disciplina ou um assunto.");
    setDrafts((ds) => ds.map((q) => q.selected ? {
      ...q,
      discipline: discipline || q.discipline,
      subject: formatSubjects(subject || q.subject),
    } : q));
    setNotice("Disciplina/assunto aplicados às questões selecionadas.");
  }
  function applyBulkOrigin(concurso, banca, ano) {
    if (!concurso && !banca && !ano) return setNotice("Informe concurso, banca ou ano.");
    setDrafts((ds) => ds.map((q) => q.selected ? { ...q, concurso: concurso || q.concurso, banca: banca || q.banca, ano: ano || q.ano } : q));
    setNotice("Concurso, banca e ano aplicados às questões selecionadas.");
  }
  async function remove(id, skipConfirm = false) {
    if (!skipConfirm && !confirm("Excluir esta questão?")) return false;
    const { error } = await supabase.from("questions").delete().eq("id", id);
    if (error) { setNotice(error.message); return false; }
    load(); return true;
  }
  async function toggleHidden(q) {
    const { error } = await supabase.from("questions").update({ is_hidden: !q.is_hidden }).eq("id", q.id);
    if (error) setNotice(error.message);
    else {
      setNotice(q.is_hidden ? "Questão exibida novamente nos estudos." : "Questão ocultada dos estudos.");
      load();
    }
  }
  async function updateQuestion(id, changes) {
    const payload = { ...changes };
    if (payload.statement) payload.normalized_statement = normalize(payload.statement);
    const { error } = await supabase.from("questions").update(payload).eq("id", id);
    if (error) setNotice(error.message);
    else {
      setNotice("Questão atualizada.");
      load();
    }
    return !error;
  }
  function openAdmin(target = "overview") {
    if (!isAdmin) return setNotice("Acesso restrito ao administrador.");
    setArea("admin");
    setAdminTab(target);
  }
  function openUser(target = "inicio") { setArea("user"); setTab(target); }
  const cadastroContent = (
    <section>
      <div className="steps" aria-label="Etapas do cadastro">
        <div className={`step ${!drafts.length ? "active" : "done"}`}><span>1</span><div><b>Importar prova</b><small>PDF ou texto</small></div></div>
        <div className={`step ${drafts.length && !answerKey ? "active" : answerKey ? "done" : ""}`}><span>2</span><div><b>Aplicar gabarito</b><small>Respostas em lote</small></div></div>
        <div className={`step ${drafts.length && answerKey ? "active" : ""}`}><span>3</span><div><b>Analisar e revisar</b><small>IA em lotes de 5</small></div></div>
        <div className={`step ${drafts.some((q) => q.aiStatus === "analyzed") ? "active" : ""}`}><span>4</span><div><b>Salvar questões</b><small>Somente após revisão</small></div></div>
      </div>
      <div className="card">
        <h2>Importar prova</h2><p>O PDF é lido no navegador e não é armazenado.</p>
        <label className="drop">{busy ? "Processando…" : "Selecionar PDF"}<input hidden type="file" accept="application/pdf" onChange={(e) => e.target.files[0] && readPdf(e.target.files[0])} /></label>
        <div className="sep">ou cole o texto</div>
        <textarea rows="9" value={raw} onChange={(e) => setRaw(e.target.value)} placeholder={"1. Enunciado…\nA) Alternativa…"} />
        <button disabled={busy} onClick={process}>Separar questões</button>
        <div className="answer-key"><h3>Aplicar gabarito</h3><p>Cole o gabarito após separar as questões. Use * ou X para anuladas.</p><textarea rows="4" value={answerKey} onChange={(e) => setAnswerKey(e.target.value)} placeholder="1 D 2 B 3 E 4 * 5 A" /><button type="button" onClick={applyAnswerKey}>Preencher respostas corretas</button></div>
      </div>
      {drafts.length > 0 && <BatchReview drafts={drafts} setDrafts={setDrafts} questions={questions} busy={busy} analyzeSelected={analyzeSelected} saveBatch={saveBatch} deleteSelected={deleteSelected} applyBulk={applyBulk} applyBulkOrigin={applyBulkOrigin} />}
    </section>
  );
  return (
    <main className="app-shell">
      <header className="app-header">
        <button className="brand" onClick={() => openUser("inicio")}><span className="brand-mark">✓</span><span><b>Caderno de Questões</b><small>Estude. Resolva. Evolua.</small></span></button>
        <details className="profile-menu" onMouseLeave={(event) => event.currentTarget.removeAttribute("open")}><summary><span className="avatar">{(profile?.display_name || profile?.email || session.user.email || "U")[0].toUpperCase()}</span><span className="profile-name">{profile?.display_name || (profile?.email || session.user.email || "").split("@")[0]}</span><span>⌄</span></summary><div><button onClick={() => openUser("perfil")}>Minha conta</button><button onClick={() => openUser("perfil")}>Preferências</button>{isAdmin && <button onClick={() => openAdmin()}>Painel administrativo</button>}<button onClick={() => supabase.auth.signOut()}>Sair</button></div></details>
        {area === "user" && <nav className="user-nav">{[["inicio", "home", "Início"], ["estudos", "document", "Questões"], ["discursivas", "pen", "Discursivas"], ["desempenho", "bars", "Desempenho"], ["perfil", "settings", "Perfil"]].map(([id, icon, label]) => <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}><span aria-hidden="true"><LineIcon name={icon} /></span>{label}</button>)}</nav>}
      </header>
      {notice && (
        <div className="notice">
          {notice}
          <button onClick={() => setNotice("")}>×</button>
        </div>
      )}
      {area === "user" ? <>
        {tab === "inicio" && <UserHome questions={questions} userId={session.user.id} name={profile?.display_name} email={profile?.email || session.user.email} supabase={supabase} goStudy={() => setTab("estudos")} goPerformance={() => setTab("desempenho")} />}
        <div hidden={tab !== "estudos"}><Study questions={questions} supabase={supabase} userId={session.user.id} /></div>
        {tab === "discursivas" && <EssayStudy supabase={supabase} userId={session.user.id} />}
        {tab === "desempenho" && <Performance questions={questions} userId={session.user.id} supabase={supabase} goStudy={() => setTab("estudos")} />}
        {tab === "perfil" && <UserProfile profile={profile} session={session} supabase={supabase} onProfileSaved={(values) => setProfile((current) => ({ ...current, ...values }))} />}
      </> : isAdmin ? <section className="admin-layout"><aside className="admin-sidebar"><button className="admin-back" onClick={() => openUser("inicio")}>← Área do aluno</button><h2>Painel administrativo</h2><small>Gestão do acervo</small>{[["overview", "Visão geral"], ["cadastro", "Cadastro"], ["questoes", "Questões"], ["essay-cadastro", "Cadastro de discursivas"], ["essay-library", "Discursivas cadastradas"]].map(([id, label]) => <button key={id} className={adminTab === id ? "active" : ""} onClick={() => setAdminTab(id)}>{label}</button>)}</aside><div className="admin-content">{adminTab === "overview" && <AdminOverview questions={questions} supabase={supabase} />}{adminTab === "cadastro" && cadastroContent}{adminTab === "questoes" && <QuestionLibrary questions={questions} remove={remove} toggleHidden={toggleHidden} updateQuestion={updateQuestion} supabase={supabase} />}{adminTab === "essay-cadastro" && <EssayAdmin supabase={supabase} />}{adminTab === "essay-library" && <EssayLibrary supabase={supabase} />}</div></section> : <section className="card"><h2>Acesso restrito</h2><p>Esta área é exclusiva para administradores.</p><button onClick={() => openUser("inicio")}>Voltar ao início</button></section>}
    </main>
  );
}

function Auth() {
  const [email, setEmail] = React.useState(""),
    [password, setPassword] = React.useState(""),
    [msg, setMsg] = React.useState(""),
    [busy, setBusy] = React.useState(false);
  async function act(kind) {
    setBusy(true);
    const { error } =
      kind === "login"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });
    setMsg(
      error
        ? error.message
        : kind === "login"
          ? "Login realizado."
          : "Cadastro realizado. Confira seu e-mail se a confirmação estiver ativada.",
    );
    setBusy(false);
  }
  return (
    <div className="auth-page">
      <section className="auth-intro">
        <div className="auth-brand"><span className="auth-mark">✓</span><div><b>Caderno de Questões</b><small>Estude. Resolva. Evolua.</small></div></div>
        <div className="auth-copy"><span className="eyebrow">SEU ESPAÇO DE ESTUDOS</span><h1>Transforme cada questão em <em>evolução.</em></h1><p>Organize seus estudos, pratique com propósito e acompanhe seu progresso rumo à aprovação.</p></div>
        <div className="auth-features"><span>✓ Ciclos personalizados</span><span>✓ Desempenho real</span><span>✓ Questão por questão</span></div>
        <div className="auth-orb"><span>✦</span><i></i><b></b></div>
      </section>
      <section className="auth-card">
        <span className="eyebrow">BEM-VINDO</span><h2>Entre na sua conta</h2><p>Continue construindo a sua aprovação.</p>
        <label>E-mail<input type="email" placeholder="voce@email.com" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label>Senha<input type="password" placeholder="Sua senha" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        <button className="auth-submit" disabled={busy} onClick={() => act("login")}>{busy ? "Entrando…" : "Entrar no Caderno →"}</button>
        <div className="auth-signup"><span>Ainda não tem uma conta?</span><button className="link-button" disabled={busy} onClick={() => act("signup")}>Criar conta grátis</button></div>
        {msg && <p className="auth-message">{msg}</p>}
      </section>
      <footer className="auth-credit">Desenvolvido por <span>@aqnoeu</span></footer>
    </div>
  );
}

function useAnswerHistory(supabase, userId) {
  const [answers, setAnswers] = React.useState([]);
  React.useEffect(() => {
    let alive = true;
    supabase.from("answers").select("question_id,is_correct,answered_at").eq("user_id", userId).order("answered_at", { ascending: true }).then(({ data }) => { if (alive) setAnswers(data || []); });
    return () => { alive = false; };
  }, [supabase, userId]);
  return answers;
}
function useCompletedCycles(supabase, userId) {
  const [count, setCount] = React.useState(0);
  React.useEffect(() => { let alive = true; supabase.from("study_cycles").select("id", { count: "exact", head: true }).eq("user_id", userId).not("completed_at", "is", null).then(({ count: total }) => { if (alive) setCount(total || 0); }); return () => { alive = false; }; }, [supabase, userId]);
  return count;
}
function useActiveCycle(supabase, userId) {
  const [cycle, setCycle] = React.useState(null);
  React.useEffect(() => { let alive = true; supabase.from("study_cycles").select("id,answer_count,total_questions,discipline,subject,banca,ano,concurso,started_at").eq("user_id", userId).is("completed_at", null).order("started_at", { ascending: false }).limit(1).maybeSingle().then(({ data }) => { if (alive) setCycle(data || null); }); return () => { alive = false; }; }, [supabase, userId]);
  return cycle;
}
function useCycleHistory(supabase, userId) {
  const [cycles, setCycles] = React.useState([]);
  React.useEffect(() => {
    let alive = true;
    supabase.from("study_cycles").select("id,started_at,completed_at,total_questions,answer_count,correct_count,wrong_count,discipline,subject,banca,ano,concurso").eq("user_id", userId).order("started_at", { ascending: true }).then(({ data }) => { if (alive) setCycles(data || []); });
    return () => { alive = false; };
  }, [supabase, userId]);
  return cycles;
}
function greetingName() {
  const hour = new Date().getHours();
  return hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";
}
function answerMetrics(answers, questions) {
  const byId = new Map(questions.map((q) => [q.id, q]));
  const total = answers.length;
  const correct = answers.filter((a) => a.is_correct).length;
  const recent = answers.slice(-20);
  const recentRate = recent.length ? Math.round((recent.filter((a) => a.is_correct).length / recent.length) * 100) : 0;
  const activeDays = new Set(answers.map((a) => new Date(a.answered_at).toLocaleDateString("en-CA")));
  let streak = 0, cursor = new Date();
  while (activeDays.has(cursor.toLocaleDateString("en-CA"))) { streak += 1; cursor.setDate(cursor.getDate() - 1); }
  const areas = new Map();
  answers.forEach((a) => { const q = byId.get(a.question_id); const key = q?.discipline || "Sem disciplina"; const value = areas.get(key) || { total: 0, correct: 0 }; value.total += 1; if (a.is_correct) value.correct += 1; areas.set(key, value); });
  const ranked = [...areas.entries()].map(([name, value]) => ({ name, ...value, rate: Math.round((value.correct / value.total) * 100) })).filter((x) => x.total >= 1).sort((a, b) => b.rate - a.rate);
  return { total, correct, rate: total ? Math.round((correct / total) * 100) : 0, recentRate, streak, best: ranked[0], focus: [...ranked].sort((a, b) => a.rate - b.rate)[0], days: answers.slice(-7) };
}
function LineIcon({ name, size = 22 }) {
  const props = { fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round", strokeLinejoin: "round" };
  return <svg className="line-icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" {...props}>
    {name === "document" && <><path d="M7 3.5h7l3.5 3.5v13.5H7z" /><path d="M14 3.5V7h3.5M10 11h4M10 15h4" /></>}
    {name === "check" && <><circle cx="12" cy="12" r="8" /><path d="m8.5 12 2.2 2.2 4.8-5" /></>}
    {name === "cycle" && <><path d="M19 8a7.5 7.5 0 0 0-12.5-1.7L5 8m0-3v3h3M5 16a7.5 7.5 0 0 0 12.5 1.7L19 16m0 3v-3h-3" /></>}
    {name === "flame" && <path d="M13.7 3.8c.5 3-1.5 4.5-2.8 6.2-1-1.2-1.1-2.5-.8-3.8C6.8 8.5 5.5 11 5.5 14.1A6.5 6.5 0 0 0 12 20.5a6.5 6.5 0 0 0 6.5-6.4c0-4-2.5-7.1-4.8-10.3Z" />}
    {name === "book" && <><path d="M4.5 5.5A3.5 3.5 0 0 1 8 4h3.5v15H8a3.5 3.5 0 0 0-3.5 1.5zM19.5 5.5A3.5 3.5 0 0 0 16 4h-3.5v15H16a3.5 3.5 0 0 1 3.5 1.5z" /><path d="M12 4v15" /></>}
    {name === "plus" && <><circle cx="12" cy="12" r="8" /><path d="M12 8v8M8 12h8" /></>}
    {name === "x" && <><rect x="5" y="5" width="14" height="14" rx="3" /><path d="m9 9 6 6m0-6-6 6" /></>}
    {name === "bars" && <><path d="M5 19V11M10 19V7M15 19V4M20 19H4" /></>}
    {name === "target" && <><circle cx="11" cy="13" r="6.5" /><circle cx="11" cy="13" r="2.2" /><path d="m14.7 9.3 4.8-4.8m-3.7.2h3.5v3.5" /></>}
    {name === "home" && <><path d="m4.5 10 7.5-6 7.5 6v9.5h-5v-5h-5v5h-5z" /></>}
    {name === "pen" && <><path d="m5 18 1-4 9.6-9.6a2.1 2.1 0 0 1 3 3L9 17l-4 1Z" /><path d="m13.8 6.2 3 3" /></>}
    {name === "settings" && <><circle cx="12" cy="12" r="3" /><path d="M19 13.5v-3l-2-.6a5.6 5.6 0 0 0-.6-1.4l1-1.8-2.1-2.1-1.8 1a5.6 5.6 0 0 0-1.4-.6L11.5 3h-3l-.6 2a5.6 5.6 0 0 0-1.4.6l-1.8-1-2.1 2.1 1 1.8A5.6 5.6 0 0 0 3 9.9l-2 .6v3l2 .6a5.6 5.6 0 0 0 .6 1.4l-1 1.8 2.1 2.1 1.8-1a5.6 5.6 0 0 0 1.4.6l.6 2h3l.6-2a5.6 5.6 0 0 0 1.4-.6l1.8 1 2.1-2.1-1-1.8a5.6 5.6 0 0 0 .6-1.4Z" /></>}
  </svg>;
}
function CycleBarChart({ cycles }) {
  const data = cycles.slice(-6).map((cycle) => ({ rate: cycle.answer_count ? Math.round((cycle.correct_count / cycle.answer_count) * 100) : 0, label: `Ciclo ${cycle.number}` }));
  if (!data.length) return <div className="chart-empty">Conclua um ciclo para acompanhar sua evolução.</div>;
  return <div className="cycle-bar-chart" aria-label="Aproveitamento nos últimos ciclos">{data.map((item) => <div className="cycle-bar" key={item.label}><b>{item.rate}%</b><i style={{ height: `${Math.max(item.rate, 5)}%` }} /><small>{item.label}</small></div>)}</div>;
}
function UserHome({ questions, userId, name: profileName, email, supabase, goStudy, goPerformance }) {
  const answers = useAnswerHistory(supabase, userId);
  const completedCycles = useCompletedCycles(supabase, userId);
  const activeCycle = useActiveCycle(supabase, userId);
  const cycleHistory = useCycleHistory(supabase, userId);
  const metrics = answerMetrics(answers, questions);
  const name = profileName?.trim() || (String(email || "estudante").split("@")[0].split(/[._-]/)[0] || "estudante");
  const completedHistory = cycleHistory.filter((cycle) => cycle.completed_at).map((cycle, index) => ({ ...cycle, number: index + 1 }));
  const latestCycleRate = completedHistory.slice(-5);
  const recentCycleRate = latestCycleRate.length ? Math.round(latestCycleRate.reduce((sum, cycle) => sum + (cycle.answer_count ? cycle.correct_count / cycle.answer_count * 100 : 0), 0) / latestCycleRate.length) : metrics.recentRate;
  const activeProgress = activeCycle?.total_questions ? Math.round(((activeCycle.answer_count || 0) / activeCycle.total_questions) * 100) : 0;
  const activeOrigin = [activeCycle?.concurso, activeCycle?.banca, activeCycle?.ano].filter(Boolean).join(" · ");
  const focusText = metrics.focus ? `${metrics.focus.name}: sua taxa atual é ${metrics.focus.rate}%.` : "Resolva algumas questões para receber uma recomendação personalizada.";
  return <section className="user-home">
    <div className="home-hero"><div><h1>{greetingName()}, {name} <span aria-hidden="true">👋</span></h1><p>Vamos continuar de onde você parou?</p></div><button onClick={goStudy}>Continuar estudos <span>→</span></button></div>
    <div className="metric-grid home-metric-grid"><MetricCard label="Questões respondidas" value={metrics.total} icon="document" /><MetricCard label="Taxa de acertos" value={`${metrics.rate}%`} icon="check" tone="good" /><MetricCard label="Ciclos concluídos" value={completedCycles} icon="cycle" /><MetricCard label="Sequência de estudos" value={`${metrics.streak} dia${metrics.streak === 1 ? "" : "s"}`} icon="flame" tone="warm" /></div>
    <div className="home-grid"><section className="card continue-card"><h2>{activeCycle ? "Continuar estudando" : "Inicie um ciclo"}</h2>{activeCycle ? <><div className="continue-subject"><span><LineIcon name="book" size={27} /></span><div><b>{activeCycle.discipline || "Ciclo de estudos"}</b><small>{activeOrigin || "Origem do ciclo"}</small></div></div><p className="continue-cycle">{activeCycle.total_questions} questões · {activeCycle.answer_count || 0} respondida(s)</p><div className="continue-progress"><b>{activeCycle.answer_count || 0} de {activeCycle.total_questions}</b><div><i style={{ width: `${activeProgress}%` }} /></div><span>{activeProgress}%</span></div><button onClick={goStudy}>Continuar ciclo</button></> : <><p className="empty-cycle-copy">Escolha concurso, banca e ano. O ciclo ficará salvo na sua conta e terá 10 questões inéditas.</p><button onClick={goStudy}>Iniciar ciclo</button></>}</section><section className="card performance-card"><div className="performance-heading"><h2>Seu desempenho</h2><button className="link-button" onClick={goPerformance}>Ver detalhes →</button></div><div className="performance-summary"><span>Melhor disciplina <b>{metrics.best?.name || "—"}</b><small>{metrics.best ? `${metrics.best.rate}% de acertos` : "Sem respostas ainda"}</small></span><span className="attention">Atenção <b>{metrics.focus?.name || "—"}</b><small>{metrics.focus ? `${metrics.focus.rate}% de acertos` : "Sem dados ainda"}</small></span><span>Média recente <b>{recentCycleRate}%</b><small>nos últimos ciclos</small></span></div><CycleBarChart cycles={completedHistory} /></section></div>
    <div className="home-shortcuts"><button className="home-shortcut" onClick={goStudy}><span><LineIcon name="plus" size={27} /></span><div><b>Novo ciclo</b><small>Comece um novo ciclo de questões.</small></div><i>›</i></button><button className="home-shortcut review" onClick={goStudy}><span><LineIcon name="x" size={27} /></span><div><b>Revisar erros</b><small>Pratique o que você ainda precisa reforçar.</small></div><i>›</i></button><button className="home-shortcut difficult" onClick={goStudy}><span><LineIcon name="bars" size={27} /></span><div><b>Questões difíceis</b><small>Desafie-se com questões mais complexas.</small></div><i>›</i></button></div>
    <section className="focus-home"><div><span><LineIcon name="target" size={26} /></span><div><b>Foco recomendado para você</b><p>{focusText}</p><button className="link-button" onClick={goStudy}>Ver recomendações personalizadas →</button></div></div><em>Prioridade sugerida</em></section>
  </section>;
}
function MetricCard({ label, value, icon, tone = "" }) { return <article className={`metric-card ${tone}`}><span><LineIcon name={icon === "✓" ? "check" : icon === "↗" ? "bars" : icon === "◌" ? "cycle" : icon === "◉" ? "document" : icon === "▤" ? "document" : icon === "▥" ? "bars" : icon === "◈" ? "target" : icon} /></span><div><small>{label}</small><b>{value}</b></div></article>; }
function MiniChart({ answers }) { const points = answers.map((a, i) => `${i * 28 + 8},${a.is_correct ? 12 : 52}`).join(" "); return <svg className="mini-chart" viewBox="0 0 190 65" role="img" aria-label="Evolução recente"><path d="M4 57H186" stroke="#e3e9f5" /><polyline points={points || "8,52 180,52"} fill="none" stroke="#1463df" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>; }
function Performance({ questions, userId, supabase, goStudy }) { const answers = useAnswerHistory(supabase, userId); const metrics = answerMetrics(answers, questions); return <section className="card performance-page"><span className="eyebrow">DESEMPENHO</span><h1>Seu progresso</h1><p>Os dados abaixo são calculados a partir das suas respostas registradas.</p><div className="metric-grid"><MetricCard label="Respondidas" value={metrics.total} icon="◉" /><MetricCard label="Acertos" value={metrics.correct} icon="✓" /><MetricCard label="Taxa geral" value={`${metrics.rate}%`} icon="↗" /><MetricCard label="Média recente" value={`${metrics.recentRate}%`} icon="◌" /></div><h2>Evolução recente</h2><MiniChart answers={metrics.days} /><div className="performance-lines"><span>Melhor disciplina <b>{metrics.best?.name || "—"}</b></span><span>Disciplina que merece atenção <b>{metrics.focus?.name || "—"}</b></span></div><button onClick={goStudy}>Voltar aos estudos</button></section>; }
function UserProfile({ profile, session, supabase, onProfileSaved }) {
  const [name, setName] = React.useState(profile?.display_name || ""), [email, setEmail] = React.useState(session.user.email || ""), [password, setPassword] = React.useState(""), [message, setMessage] = React.useState(""), [busy, setBusy] = React.useState(false);
  React.useEffect(() => { setName(profile?.display_name || ""); setEmail(session.user.email || ""); }, [profile?.display_name, session.user.email]);
  async function saveProfile(e) { e.preventDefault(); setBusy(true); setMessage(""); try { const { error: profileError } = await supabase.from("profiles").update({ display_name: name.trim() || null }).eq("id", session.user.id); if (profileError) throw profileError; if (email.trim() && email.trim() !== session.user.email) { const { error } = await supabase.auth.updateUser({ email: email.trim() }); if (error) throw error; } if (password) { const { error } = await supabase.auth.updateUser({ password }); if (error) throw error; setPassword(""); } onProfileSaved({ display_name: name.trim() || null }); setMessage("Dados atualizados. Se o e-mail foi alterado, confirme-o na nova caixa de entrada."); } catch (error) { setMessage(error.message); } finally { setBusy(false); } }
  async function resendVerification() { const { error } = await supabase.auth.resend({ type: "signup", email: session.user.email }); setMessage(error ? error.message : "E-mail de verificação reenviado."); }
  async function resetCycles() { if (!window.confirm("Zerar todos os ciclos, respostas, acertos e erros? Esta ação não pode ser desfeita.")) return; setBusy(true); try { const { error: answerError } = await supabase.from("answers").delete().eq("user_id", session.user.id); if (answerError) throw answerError; const { error: cycleError } = await supabase.from("study_cycles").delete().eq("user_id", session.user.id); if (cycleError) throw cycleError; window.localStorage.removeItem(`caderno-questoes:study-cycle:${session.user.id}`); setMessage("Ciclos e desempenho zerados. Atualizando…"); window.setTimeout(() => window.location.reload(), 700); } catch (error) { setMessage(error.message); setBusy(false); } }
  return <section className="card profile-page"><span className="eyebrow">MINHA CONTA</span><h1>Perfil e preferências</h1><p>Gerencie seus dados de acesso e o histórico de estudos.</p><form onSubmit={saveProfile} className="profile-form"><label>Nome de usuário<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Como deseja ser chamado" /></label><label>E-mail<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label><label>Nova senha<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Deixe em branco para não alterar" minLength="6" /></label><div className="verification"><b>{session.user.email_confirmed_at ? "✓ E-mail verificado" : "E-mail aguardando verificação"}</b>{!session.user.email_confirmed_at && <button type="button" className="light" onClick={resendVerification}>Reenviar verificação</button>}</div><button disabled={busy}>Salvar alterações</button></form><div className="danger-zone"><h2>Redefinir estudos</h2><p>Apaga seus ciclos, respostas, acertos e erros. As questões cadastradas permanecem intactas.</p><button className="danger" disabled={busy} onClick={resetCycles}>Zerar ciclos e desempenho</button></div>{message && <p className="form-message">{message}</p>}</section>;
}
function AdminOverview({ questions, supabase }) { const [userCount, setUserCount] = React.useState(null); React.useEffect(() => { supabase.from("profiles").select("id", { count: "exact", head: true }).then(({ count }) => setUserCount(count ?? 0)); }, [supabase]); const visible = questions.filter((q) => !q.is_hidden).length; const disciplines = new Set(questions.map((q) => q.discipline).filter(Boolean)).size; const boards = new Set(questions.map((q) => q.banca).filter(Boolean)).size; return <section className="admin-overview"><div><span className="eyebrow">PAINEL ADMINISTRATIVO</span><h1>Visão geral</h1><p>Dados reais do acervo disponível no sistema.</p></div><div className="metric-grid admin-metrics"><MetricCard label="Questões cadastradas" value={questions.length} icon="▤" /><MetricCard label="Questões visíveis" value={visible} icon="◉" /><MetricCard label="Questões ocultas" value={questions.length - visible} icon="◌" /><MetricCard label="Disciplinas" value={disciplines} icon="▥" /><MetricCard label="Bancas" value={boards} icon="◈" /><MetricCard label="Usuários cadastrados" value={userCount == null ? "…" : userCount} icon="◉" /></div></section>; }

function QuestionLibrary({ questions, remove, toggleHidden, updateQuestion, supabase }) {
  const [editingId, setEditingId] = React.useState(null);
  const [draft, setDraft] = React.useState(null);
  const [search, setSearch] = React.useState("");
  const [disciplineFilter, setDisciplineFilter] = React.useState("");
  const [subjectFilter, setSubjectFilter] = React.useState("");
  const [difficultyFilter, setDifficultyFilter] = React.useState("");
  const [visibilityFilter, setVisibilityFilter] = React.useState("all");
  const [showMoreFilters, setShowMoreFilters] = React.useState(false);
  const [boardFilter, setBoardFilter] = React.useState("");
  const [yearFilter, setYearFilter] = React.useState("");
  const [contestFilter, setContestFilter] = React.useState("");
  const [selectedIds, setSelectedIds] = React.useState([]);
  const [bulk, setBulk] = React.useState({ concurso: "", banca: "", ano: "" });
  const [busy, setBusy] = React.useState(false);
  const [tags, setTags] = React.useState({});
  const [tagDraft, setTagDraft] = React.useState({ contest: "", label: "", color: "#eaf2ff", text_color: "#1458c6" });
  const disciplines = [...new Set(questions.map((q) => q.discipline).filter(Boolean))].sort();
  const subjects = subjectOptions(questions);
  const boards = [...new Set(questions.map((q) => q.banca).filter(Boolean))].sort();
  const years = [...new Set(questions.map((q) => q.ano).filter(Boolean))].sort((a, b) => b - a);
  const contests = [...new Set(questions.map((q) => q.concurso).filter(Boolean))].sort();
  React.useEffect(() => { let alive = true; supabase.from("contest_tags").select("*").then(({ data }) => { if (alive && data) setTags(Object.fromEntries(data.map((tag) => [tag.contest, tag]))); }); return () => { alive = false; }; }, [supabase]);
  const filteredQuestions = questions.filter((q) => {
    const searchable = `${q.id} ${q.statement} ${q.discipline || ""} ${q.subject || ""}`.toLowerCase();
    return (!search || searchable.includes(search.toLowerCase())) &&
      (!disciplineFilter || q.discipline === disciplineFilter) &&
      hasSubject(q, subjectFilter) &&
      (!difficultyFilter || (q.difficulty_current || q.difficulty_initial || "media") === difficultyFilter) &&
      (!boardFilter || q.banca === boardFilter) && (!yearFilter || String(q.ano) === yearFilter) && (!contestFilter || (contestFilter === "__missing__" ? !q.concurso : q.concurso === contestFilter)) &&
      (visibilityFilter === "all" || (visibilityFilter === "visible" ? !q.is_hidden : q.is_hidden));
  });
  const startEdit = (q) => {
    setEditingId(q.id);
    setDraft({ ...q, alternatives: (q.alternatives || []).map((a) => ({ ...a })) });
  };
  const toggleSelected = (id) => setSelectedIds((items) => items.includes(id) ? items.filter((item) => item !== id) : [...items, id]);
  const selectAll = (checked) => setSelectedIds(checked ? filteredQuestions.map((q) => q.id) : []);
  async function applyBulkEdit() { if (!selectedIds.length) return; setBusy(true); await Promise.all(selectedIds.map((id) => updateQuestion(id, { concurso: bulk.concurso.trim() || null, banca: bulk.banca.trim() || null, ano: bulk.ano ? Number(bulk.ano) : null }))); setBusy(false); setSelectedIds([]); }
  async function deleteSelected() { if (!selectedIds.length || !window.confirm(`Excluir ${selectedIds.length} questão(ões)?`)) return; setBusy(true); await Promise.all(selectedIds.map((id) => remove(id, true))); setBusy(false); setSelectedIds([]); }
  async function saveTag() { if (!tagDraft.contest) return; const row = { contest: tagDraft.contest, label: tagDraft.label.trim() || tagDraft.contest, color: tagDraft.color, text_color: tagDraft.text_color }; const { error } = await supabase.from("contest_tags").upsert(row); if (!error) { setTags((items) => ({ ...items, [row.contest]: row })); setTagDraft({ ...tagDraft, label: row.label }); } }
  const changeAlternative = (letter, text) => setDraft((d) => ({ ...d, alternatives: d.alternatives.map((a) => a.letter === letter ? { ...a, text } : a) }));
  const save = async () => {
    if (!draft.statement.trim() || !draft.discipline?.trim() || !draft.subject?.trim()) return;
    const ok = await updateQuestion(draft.id, {
      statement: draft.statement.trim(), alternatives: draft.alternatives,
      correct_option: draft.correct_option, discipline: draft.discipline.trim(), subject: formatSubjects(draft.subject),
      explanation: draft.explanation?.trim() || null, banca: draft.banca?.trim() || null, ano: draft.ano ? Number(draft.ano) : null, concurso: draft.concurso?.trim() || null, difficulty_initial: draft.difficulty_initial || "media",
      difficulty_current: draft.difficulty_current || draft.difficulty_initial || "media",
    });
    if (ok) { setEditingId(null); setDraft(null); }
  };
  return (
    <section className="questions-library">
      <div className="library-heading"><div><h2>Questões cadastradas</h2><p>{filteredQuestions.length} de {questions.length} questão(ões).</p></div></div>
      {contests.length > 0 && <div className="contest-tabs"><button className={!contestFilter ? "active" : ""} onClick={() => setContestFilter("")}>Todas <small>{questions.length}</small></button>{contests.map((contest) => { const tag = tags[contest]; return <button key={contest} className={contestFilter === contest ? "active" : ""} style={tag ? { background: tag.color, color: tag.text_color } : undefined} onClick={() => setContestFilter(contest)}>{tag?.label || contest} <small>{questions.filter((q) => q.concurso === contest).length}</small></button>; })}</div>}
      <div className="library-filters">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por texto ou ID" />
        <select value={disciplineFilter} onChange={(e) => { setDisciplineFilter(e.target.value); setSubjectFilter(""); }}><option value="">Todas as disciplinas</option>{disciplines.map((x) => <option key={x}>{x}</option>)}</select>
        <select value={subjectFilter} onChange={(e) => setSubjectFilter(e.target.value)}><option value="">Todos os assuntos</option>{subjects.filter((x) => !disciplineFilter || questions.some((q) => q.discipline === disciplineFilter && hasSubject(q, x))).map((x) => <option key={x}>{x}</option>)}</select>
        <select value={difficultyFilter} onChange={(e) => setDifficultyFilter(e.target.value)}><option value="">Todas as dificuldades</option><option value="facil">Fácil</option><option value="media">Média</option><option value="dificil">Difícil</option></select>
        <select value={visibilityFilter} onChange={(e) => setVisibilityFilter(e.target.value)}><option value="all">Visíveis e ocultas</option><option value="visible">Somente visíveis</option><option value="hidden">Somente ocultas</option></select>
        <button className="light compact more-filters" onClick={() => setShowMoreFilters((value) => !value)}>{showMoreFilters ? "Menos filtros" : "Mais filtros"}</button>
      </div>
      {showMoreFilters && <div className="library-filters more-filter-row"><select value={boardFilter} onChange={(e) => setBoardFilter(e.target.value)}><option value="">Todas as bancas</option>{boards.map((x) => <option key={x}>{x}</option>)}</select><select value={yearFilter} onChange={(e) => setYearFilter(e.target.value)}><option value="">Todos os anos</option>{years.map((x) => <option key={x}>{x}</option>)}</select><select value={contestFilter} onChange={(e) => setContestFilter(e.target.value)}><option value="">Todos os concursos</option><option value="__missing__">Sem concurso vinculado</option>{contests.map((x) => <option key={x}>{x}</option>)}</select></div>}
      <div className="bulk-question-actions"><label><input type="checkbox" checked={filteredQuestions.length > 0 && selectedIds.length === filteredQuestions.length} ref={(el) => { if (el) el.indeterminate = selectedIds.length > 0 && selectedIds.length < filteredQuestions.length; }} onChange={(e) => selectAll(e.target.checked)} /> Selecionar todas ({selectedIds.length})</label><input placeholder="Concurso" value={bulk.concurso} onChange={(e) => setBulk({ ...bulk, concurso: e.target.value })} /><input placeholder="Banca" value={bulk.banca} onChange={(e) => setBulk({ ...bulk, banca: e.target.value })} /><input type="number" placeholder="Ano" value={bulk.ano} onChange={(e) => setBulk({ ...bulk, ano: e.target.value })} /><button disabled={busy || !selectedIds.length} onClick={applyBulkEdit}>Editar selecionadas</button><button className="danger" disabled={busy || !selectedIds.length} onClick={deleteSelected}>Excluir selecionadas</button></div>
      {contests.length > 0 && <details className="tag-editor"><summary>Personalizar tag de concurso</summary><div><select value={tagDraft.contest} onChange={(e) => { const contest = e.target.value; const tag = tags[contest]; setTagDraft({ contest, label: tag?.label || contest, color: tag?.color || "#eaf2ff", text_color: tag?.text_color || "#1458c6" }); }}><option value="">Selecione o concurso</option>{contests.map((contest) => <option key={contest}>{contest}</option>)}</select><input placeholder="Nome exibido na tag" value={tagDraft.label} onChange={(e) => setTagDraft({ ...tagDraft, label: e.target.value })} /><label>Fundo <input type="color" value={tagDraft.color} onChange={(e) => setTagDraft({ ...tagDraft, color: e.target.value })} /></label><label>Texto <input type="color" value={tagDraft.text_color} onChange={(e) => setTagDraft({ ...tagDraft, text_color: e.target.value })} /></label><button onClick={saveTag}>Salvar tag</button></div></details>}
      {!questions.length ? <div className="card"><p>Nenhuma questão cadastrada.</p></div> : !filteredQuestions.length ? <div className="card"><p>Nenhuma questão encontrada com esses filtros.</p></div> : <div className="question-grid">
        {filteredQuestions.map((q) => <article className={`question-card ${q.is_hidden ? "hidden-card" : ""}`} key={q.id}>
          <div className="card-top"><label className="card-check"><input type="checkbox" checked={selectedIds.includes(q.id)} onChange={() => toggleSelected(q.id)} /> Selecionar</label><span className="question-id">ID {String(q.id).slice(0, 8)}</span><span className={`difficulty ${q.difficulty_current || q.difficulty_initial || "media"}`}>{q.difficulty_current || q.difficulty_initial || "media"}</span></div>
          <h3>{q.discipline || "Sem disciplina"}</h3>
          <p className="question-subject">{q.subject || "Sem assunto"}</p>
          <p className="question-preview">{q.statement}</p>
          <div className="card-meta"><span>Gabarito: {q.correct_option === "*" ? "Anulada" : q.correct_option}</span>{q.concurso && <span className="contest-tag" style={tags[q.concurso] ? { background: tags[q.concurso].color, color: tags[q.concurso].text_color } : undefined}>{tags[q.concurso]?.label || q.concurso}{q.banca && ` · ${q.banca}`}</span>}{(q.ano || q.banca || q.concurso) && <span className="question-origin">{q.ano && `Ano: ${q.ano}`}</span>}{q.is_hidden && <span className="hidden-label">Oculta dos estudos</span>}</div>
          <div className="card-actions"><button className="light compact" onClick={() => editingId === q.id ? (setEditingId(null), setDraft(null)) : startEdit(q)}>{editingId === q.id ? "Fechar" : "Editar"}</button><button className="light compact" onClick={() => toggleHidden(q)}>{q.is_hidden ? "Exibir" : "Ocultar"}</button><button className="danger compact" onClick={() => remove(q.id)}>Excluir</button></div>
          {editingId === q.id && draft && <div className="saved-editor">
            <label>Enunciado<textarea rows="5" value={draft.statement} onChange={(e) => setDraft({ ...draft, statement: e.target.value })} /></label>
            <div className="cols"><label>Disciplina<input value={draft.discipline || ""} onChange={(e) => setDraft({ ...draft, discipline: e.target.value })} /></label><label>Assunto(s)<input placeholder="Separe por · ou ;" value={draft.subject || ""} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} /></label></div>
            <div className="cols"><label>Banca<input value={draft.banca || ""} onChange={(e) => setDraft({ ...draft, banca: e.target.value })} /></label><label>Ano<input type="number" value={draft.ano || ""} onChange={(e) => setDraft({ ...draft, ano: e.target.value })} /></label></div><label>Concurso<input value={draft.concurso || ""} onChange={(e) => setDraft({ ...draft, concurso: e.target.value })} /></label>
            {draft.alternatives.map((a) => <label className="alt" key={a.letter}><input type="radio" name={`answer-${draft.id}`} checked={draft.correct_option === a.letter} onChange={() => setDraft({ ...draft, correct_option: a.letter, is_annulled: false })} /><b>{a.letter}</b><input value={a.text} onChange={(e) => changeAlternative(a.letter, e.target.value)} /></label>)}
            <div className="cols"><select value={draft.difficulty_initial || "media"} onChange={(e) => setDraft({ ...draft, difficulty_initial: e.target.value, difficulty_current: e.target.value })}><option value="facil">Fácil</option><option value="media">Média</option><option value="dificil">Difícil</option></select><button onClick={save}>Salvar alterações</button></div>
          </div>}
        </article>)}
      </div>}
    </section>
  );
}

function cleanEssayText(value) {
  return String(value || "").replace(/\r/g, "").replace(/\bQ\s+UEST[ÃA]O\b/gi, "QUESTÃO").replace(/^\s*\d+\s*$/gm, "").replace(/^.*(?:ORDEM DOS ADVOGADOS|EXAME DE ORDEM UNIFICADO|FGV CONHECIMENTO|P[ÁA]GINA\s*\d+|CADERNO DE PROVA).*(?:\n|$)/gim, "").replace(/\n{3,}/g, "\n\n").trim();
}
function sectionBlocks(text, expression) {
  const matches = [...text.matchAll(expression)];
  return matches.map((match, index) => ({ number: Number(match[1]), text: text.slice(match.index, matches[index + 1]?.index || text.length).trim() }));
}
function parseEssayProof(raw) {
  const text = cleanEssayText(raw).replace(/^\s*QUEST[ÃA]O\s+[1-4]\s+[–-]\s*P[ÁA]GINA\s+\d+\s*$/gim, "");
  // O pdf.js não preserva sempre as quebras de linha do PDF; por isso o título
  // é localizado em qualquer posição, mas os cabeçalhos "QUESTÃO X – PÁGINA Y" ficam fora.
  return sectionBlocks(text, /QUEST[ÃA]O\s+([1-4])\b(?!\s*[–-]\s*P[ÁA]GINA)/gi).map((item) => ({ ...item, text: item.text.replace(/^\s*QUEST[ÃA]O\s+\d+\s*/i, "").trim() }));
}
function parseEssayKey(raw) {
  const text = cleanEssayText(raw);
  return sectionBlocks(text, /PADR[ÃA]O\s+DE\s+RESPOSTA\s*[–-]?\s*QUEST[ÃA]O\s+([1-4])\b/gi).map((item) => ({ ...item, text: item.text.replace(/^\s*PADR[ÃA]O\s+DE\s+RESPOSTA\s*[–-]?\s*QUEST[ÃA]O\s+\d+\s*/i, "").trim() }));
}
async function extractPdfText(file) {
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  let text = "";
  for (let page = 1; page <= pdf.numPages; page += 1) {
    const content = await pdf.getPage(page).then((item) => item.getTextContent());
    text += content.items.map((item) => item.str + (item.hasEOL ? "\n" : " ")).join("") + "\n";
  }
  return cleanEssayText(text);
}
const emptyEssay = () => ({ statement: "", question_number: "", discipline: "", subjects: "", difficulty: "media", banca: "", ano: "", concurso: "", application_date: "", total_points: "0", answer_key_text: "", official_commentary: "", rubrics: [], selected: true });

function EssayAdmin({ supabase }) {
  const [proofText, setProofText] = React.useState(""), [keyText, setKeyText] = React.useState(""), [proofName, setProofName] = React.useState(""), [keyName, setKeyName] = React.useState(""), [drafts, setDrafts] = React.useState([]), [notice, setNotice] = React.useState(""), [busy, setBusy] = React.useState(false);
  const patch = (index, changes) => setDrafts((list) => list.map((item, i) => i === index ? { ...item, ...changes } : item));
  async function readFile(file, kind) { try { setNotice(`Lendo ${file.name}…`); const text = await extractPdfText(file); if (kind === "proof") { setProofText(text); setProofName(file.name); } else { setKeyText(text); setKeyName(file.name); } setNotice("PDF lido com sucesso. Clique em Separar discursivas quando os dois arquivos estiverem selecionados."); } catch (error) { setNotice(error.message); } }
  function separate() {
    const proof = parseEssayProof(proofText), keys = new Map(parseEssayKey(keyText).map((item) => [item.number, item.text]));
    if (!proof.length) return setNotice("Não encontrei QUESTÃO 1 a QUESTÃO 4 no caderno. Verifique se o PDF tem texto selecionável.");
    const metadata = { concurso: /46[ºo]\s*exame/i.test(proofText + keyText) ? "46º Exame de Ordem Unificado" : "", banca: /\bFGV\b/i.test(proofText + keyText) ? "FGV" : "", ano: /21\/06\/2026/.test(proofText + keyText) ? "2026" : "", application_date: /21\/06\/2026/.test(proofText + keyText) ? "2026-06-21" : "", discipline: /DIREITO\s+PENAL/i.test(proofText + keyText) ? "Direito Penal" : "" };
    setDrafts(proof.map((item) => ({ ...emptyEssay(), ...metadata, question_number: String(item.number), statement: item.text, answer_key_text: keys.get(item.number) || "", official_commentary: keys.get(item.number) || "" })));
    setNotice(`${proof.length} discursiva(s) separada(s). A peça prático-profissional foi ignorada. Agora classifique com IA e revise antes de salvar.`);
  }
  async function classify() {
    const chosen = drafts.map((item, index) => ({ item, index })).filter(({ item }) => item.selected);
    if (!chosen.length) return setNotice("Selecione pelo menos uma questão.");
    setBusy(true); setNotice("A IA está extraindo assuntos, critérios e pontuação oficial em pequenos lotes…");
    try {
      for (let start = 0; start < chosen.length; start += 4) {
        const group = chosen.slice(start, start + 4);
        const { data, error } = await supabase.functions.invoke("analyze-essays", { body: { questions: group.map(({ item }, index) => ({ index, question_number: item.question_number, statement: item.statement, answer_key_text: item.answer_key_text, discipline: item.discipline })) } });
        if (error) throw error;
        const results = data?.results || [];
        setDrafts((all) => { const next = [...all]; results.forEach((result) => { const original = group[result.index]; if (!original) return; const current = next[original.index]; next[original.index] = { ...current, discipline: result.discipline || current.discipline, subjects: formatSubjects(result.subjects || current.subjects), difficulty: result.difficulty || current.difficulty, total_points: String(result.total_points ?? current.total_points), official_commentary: result.official_commentary || current.official_commentary, rubrics: Array.isArray(result.rubrics) ? result.rubrics : current.rubrics }; }); return next; });
      }
      setNotice("Classificação concluída. Revise enunciado, espelho e critérios antes de salvar.");
    } catch (error) { setNotice(error.message || "Não foi possível classificar as discursivas."); } finally { setBusy(false); }
  }
  async function save() {
    const selected = drafts.filter((item) => item.selected);
    if (!selected.length) return setNotice("Selecione ao menos uma discursiva para salvar.");
    if (selected.some((item) => !item.statement.trim() || !item.answer_key_text.trim())) return setNotice("Cada discursiva precisa de enunciado e espelho antes de salvar.");
    setBusy(true);
    try {
      for (const item of selected) {
        const row = { statement: item.statement.trim(), question_number: Number(item.question_number) || null, discipline: item.discipline.trim() || null, subjects: formatSubjects(item.subjects), difficulty: item.difficulty, banca: item.banca.trim() || null, ano: item.ano ? Number(item.ano) : null, concurso: item.concurso.trim() || null, application_date: item.application_date || null, total_points: Number(item.total_points || 0), answer_key_text: item.answer_key_text.trim(), official_commentary: item.official_commentary.trim() || null, metadata: { source: "importacao-discursiva" } };
        const { data, error } = await supabase.from("essay_questions").insert(row).select("id").single(); if (error) throw error;
        const rubrics = (item.rubrics || []).filter((rubric) => rubric.criterion?.trim()).map((rubric, index) => ({ essay_question_id: data.id, section: rubric.section || null, subitem: rubric.subitem || null, criterion: rubric.criterion.trim(), expected_content: rubric.expected_content || null, legal_basis: rubric.legal_basis || null, max_points: Number(rubric.max_points || 0), display_order: index, required: Boolean(rubric.required) }));
        if (rubrics.length) { const { error } = await supabase.from("essay_rubric_items").insert(rubrics); if (error) throw error; }
      }
      setDrafts([]); setNotice("Discursivas salvas. Elas já estão na área Discursivas cadastradas.");
    } catch (error) { setNotice(error.message || "Erro ao salvar."); } finally { setBusy(false); }
  }
  return <section className="essay-admin"><div className="library-heading"><div><span className="eyebrow">CADASTRO DE DISCURSIVAS</span><h2>Importar prova e espelho</h2><p>Somente questões curtas. A peça prático-profissional é ignorada nesta etapa.</p></div></div><div className="card essay-import"><label className={`drop ${proofName ? "file-ready" : ""}`}>1. {proofName ? `✓ Prova carregada: ${proofName}` : "Selecionar caderno de prova"}<input hidden type="file" accept="application/pdf" onChange={(e) => e.target.files[0] && readFile(e.target.files[0], "proof")} /></label><label className={`drop ${keyName ? "file-ready" : ""}`}>2. {keyName ? `✓ Espelho carregado: ${keyName}` : "Selecionar padrão de resposta"}<input hidden type="file" accept="application/pdf" onChange={(e) => e.target.files[0] && readFile(e.target.files[0], "key")} /></label><div className="study-actions"><button className="light" disabled={!proofText || !keyText || busy} onClick={separate}>Separar discursivas</button><button disabled={!drafts.length || busy} onClick={classify}>{busy ? "Classificando…" : "Classificar discursivas com IA"}</button><button className="light" disabled={!drafts.length || busy} onClick={save}>Salvar selecionadas</button></div>{notice && <p className="form-message">{notice}</p>}</div>{drafts.length > 0 && <div className="essay-import-list">{drafts.map((item, index) => <article className="card essay-import-card" key={index}><div className="card-top"><label className="card-check"><input type="checkbox" checked={item.selected} onChange={(e) => patch(index, { selected: e.target.checked })} /> Salvar</label><b>Questão {item.question_number}</b><span className={`difficulty ${item.difficulty}`}>{item.difficulty}</span></div><div className="cols"><label>Concurso<input value={item.concurso} onChange={(e) => patch(index, { concurso: e.target.value })} /></label><label>Banca<input value={item.banca} onChange={(e) => patch(index, { banca: e.target.value })} /></label><label>Ano<input value={item.ano} onChange={(e) => patch(index, { ano: e.target.value })} /></label></div><div className="cols"><label>Disciplina<input value={item.discipline} onChange={(e) => patch(index, { discipline: e.target.value })} /></label><label>Assunto(s)<input placeholder="Use · ou ;" value={item.subjects} onChange={(e) => patch(index, { subjects: e.target.value })} /></label><label>Dificuldade<select value={item.difficulty} onChange={(e) => patch(index, { difficulty: e.target.value })}><option value="facil">Fácil</option><option value="media">Média</option><option value="dificil">Difícil</option></select></label></div><label>Enunciado<textarea rows="7" value={item.statement} onChange={(e) => patch(index, { statement: e.target.value })} /></label><label>Espelho oficial<textarea rows="7" value={item.answer_key_text} onChange={(e) => patch(index, { answer_key_text: e.target.value })} /></label><div className="rubric-summary"><b>Critérios oficiais ({item.rubrics.length}) · valor {item.total_points} ponto(s)</b>{item.rubrics.map((rubric, rubricIndex) => <div className="rubric-row" key={rubricIndex}><input placeholder="Item / seção" value={rubric.section || ""} onChange={(e) => { const rubrics = [...item.rubrics]; rubrics[rubricIndex] = { ...rubrics[rubricIndex], section: e.target.value }; patch(index, { rubrics }); }} /><input placeholder="Critério" value={rubric.criterion || ""} onChange={(e) => { const rubrics = [...item.rubrics]; rubrics[rubricIndex] = { ...rubrics[rubricIndex], criterion: e.target.value }; patch(index, { rubrics }); }} /><input type="number" step="0.05" placeholder="Pontos" value={rubric.max_points || ""} onChange={(e) => { const rubrics = [...item.rubrics]; rubrics[rubricIndex] = { ...rubrics[rubricIndex], max_points: e.target.value }; patch(index, { rubrics }); }} /></div>)}</div></article>)}</div>}</section>;
}

function EssayLibrary({ supabase }) {
  const [items, setItems] = React.useState([]), [selected, setSelected] = React.useState([]), [editing, setEditing] = React.useState(null), [search, setSearch] = React.useState(""), [filter, setFilter] = React.useState(""), [notice, setNotice] = React.useState(""), [profiles, setProfiles] = React.useState([]), [requests, setRequests] = React.useState([]), [creditUser, setCreditUser] = React.useState(""), [generatedCredit, setGeneratedCredit] = React.useState("");
  const load = React.useCallback(async () => { const { data, error } = await supabase.from("essay_questions").select("*,essay_rubric_items(*)").order("concurso").order("question_number"); if (error) setNotice(error.message); else setItems(data || []); const [{ data: users }, { data: pending }] = await Promise.all([supabase.from("profiles").select("id,email,display_name").order("email"), supabase.from("essay_correction_requests").select("*").eq("status", "pending").order("created_at")]); setProfiles(users || []); setRequests(pending || []); }, [supabase]); React.useEffect(() => { load(); }, [load]);
  const filtered = items.filter((item) => (!filter || item.concurso === filter) && normalize(`${item.id} ${item.statement} ${item.discipline} ${item.subjects}`).includes(normalize(search)));
  async function remove(id) { if (!window.confirm("Excluir esta discursiva e seus critérios?")) return; const { error } = await supabase.from("essay_questions").delete().eq("id", id); if (error) setNotice(error.message); else { setSelected((ids) => ids.filter((x) => x !== id)); load(); } }
  async function saveEdit() { const { rubrics, ...row } = editing; const { error } = await supabase.from("essay_questions").update({ ...row, subjects: formatSubjects(row.subjects), ano: row.ano ? Number(row.ano) : null, total_points: Number(row.total_points || 0), updated_at: new Date().toISOString() }).eq("id", row.id); if (error) setNotice(error.message); else { setEditing(null); load(); } }
  async function bulkHidden(hidden) { if (!selected.length) return; const { error } = await supabase.from("essay_questions").update({ is_hidden: hidden }).in("id", selected); if (error) setNotice(error.message); else { setSelected([]); load(); } }
  async function createCredit() { if (!creditUser) return setNotice("Selecione o usuário que receberá a correção extra."); const token = `DQ-${crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`; const { error } = await supabase.from("essay_correction_credits").insert({ user_id: creditUser, token }); if (error) setNotice(error.message); else setGeneratedCredit(token); }
  async function approveRequest(request) { const token = `DQ-${crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`; const { error } = await supabase.from("essay_correction_credits").insert({ user_id: request.user_id, token }); if (error) return setNotice(error.message); await supabase.from("essay_correction_requests").update({ status: "approved", reviewed_at: new Date().toISOString() }).eq("id", request.id); setGeneratedCredit(token); load(); }
  async function rejectRequest(id) { await supabase.from("essay_correction_requests").update({ status: "rejected", reviewed_at: new Date().toISOString() }).eq("id", id); load(); }
  return <section className="questions-library"><div className="library-heading"><div><span className="eyebrow">DISCURSIVAS CADASTRADAS</span><h2>Questões discursivas</h2><p>{filtered.length} de {items.length} discursiva(s)</p></div></div>{requests.length > 0 && <div className="card correction-credit"><b>Solicitações de correção extra</b>{requests.map((request) => { const user = profiles.find((item) => item.id === request.user_id); return <div className="credit-request" key={request.id}><span>{user?.display_name || user?.email || "Usuário"}</span><button onClick={() => approveRequest(request)}>Aprovar e gerar token</button><button className="light" onClick={() => rejectRequest(request.id)}>Recusar</button></div>; })}</div>}<div className="card correction-credit"><b>Autorizar uma correção adicional</b><p>O token libera uma única correção acima do limite mensal de quatro.</p><div><select value={creditUser} onChange={(e) => setCreditUser(e.target.value)}><option value="">Selecione o usuário</option>{profiles.map((user) => <option value={user.id} key={user.id}>{user.display_name || user.email}</option>)}</select><button onClick={createCredit}>Gerar token</button></div>{generatedCredit && <strong>Token gerado: {generatedCredit}</strong>}</div><div className="library-filters"><input placeholder="Buscar por texto ou ID" value={search} onChange={(e) => setSearch(e.target.value)} /><select value={filter} onChange={(e) => setFilter(e.target.value)}><option value="">Todos os concursos</option>{[...new Set(items.map((item) => item.concurso).filter(Boolean))].map((item) => <option key={item}>{item}</option>)}</select></div><div className="bulk-question-actions"><label><input type="checkbox" checked={filtered.length > 0 && selected.length === filtered.length} onChange={(e) => setSelected(e.target.checked ? filtered.map((item) => item.id) : [])} /> Selecionar todas ({selected.length})</label><button className="light" disabled={!selected.length} onClick={() => bulkHidden(false)}>Exibir selecionadas</button><button className="light" disabled={!selected.length} onClick={() => bulkHidden(true)}>Ocultar selecionadas</button></div>{notice && <p className="form-message">{notice}</p>}<div className="essay-card-grid">{filtered.map((item) => <article className={`question-card ${item.is_hidden ? "hidden-card" : ""}`} key={item.id}><div className="card-top"><label className="card-check"><input type="checkbox" checked={selected.includes(item.id)} onChange={() => setSelected((ids) => ids.includes(item.id) ? ids.filter((x) => x !== item.id) : [...ids, item.id])} /> Selecionar</label><span>Questão {item.question_number}</span><span className={`difficulty ${item.difficulty}`}>{item.difficulty}</span></div><h3>{item.discipline || "Sem disciplina"}</h3><p className="question-subject">{item.subjects || "Sem assunto"}</p><p className="question-preview">{item.statement}</p><div className="card-meta"><span className="contest-tag">{item.concurso || "Sem concurso"}{item.banca && ` · ${item.banca}`}</span><span>{item.ano || "Sem ano"} · {item.total_points} ponto(s)</span>{item.is_hidden && <span className="hidden-label">Oculta</span>}</div><div className="card-actions"><button className="light compact" onClick={() => setEditing(editing?.id === item.id ? null : { ...item })}>Editar</button><button className="light compact" onClick={() => supabase.from("essay_questions").update({ is_hidden: !item.is_hidden }).eq("id", item.id).then(load)}>{item.is_hidden ? "Exibir" : "Ocultar"}</button><button className="danger compact" onClick={() => remove(item.id)}>Excluir</button></div>{editing?.id === item.id && <div className="saved-editor"><div className="cols"><label>Concurso<input value={editing.concurso || ""} onChange={(e) => setEditing({ ...editing, concurso: e.target.value })} /></label><label>Banca<input value={editing.banca || ""} onChange={(e) => setEditing({ ...editing, banca: e.target.value })} /></label><label>Ano<input value={editing.ano || ""} onChange={(e) => setEditing({ ...editing, ano: e.target.value })} /></label></div><div className="cols"><label>Disciplina<input value={editing.discipline || ""} onChange={(e) => setEditing({ ...editing, discipline: e.target.value })} /></label><label>Assuntos<input value={editing.subjects || ""} onChange={(e) => setEditing({ ...editing, subjects: e.target.value })} /></label></div><label>Enunciado<textarea rows="6" value={editing.statement} onChange={(e) => setEditing({ ...editing, statement: e.target.value })} /></label><label>Espelho<textarea rows="5" value={editing.answer_key_text || ""} onChange={(e) => setEditing({ ...editing, answer_key_text: e.target.value })} /></label><button onClick={saveEdit}>Salvar alterações</button></div>}</article>)}</div>{!filtered.length && <div className="card"><p>Nenhuma discursiva encontrada.</p></div>}</section>;
}

function EssayAdminLegacy({ supabase }) {
  const empty = { statement: "", question_number: "", discipline: "", subjects: "", difficulty: "media", banca: "FGV", ano: "2026", concurso: "46º Exame de Ordem Unificado", application_date: "2026-06-21", total_points: "1.25", answer_key_text: "", official_commentary: "", rubrics: [] };
  const [items, setItems] = React.useState([]), [draft, setDraft] = React.useState(empty), [notice, setNotice] = React.useState(""), [busy, setBusy] = React.useState(false);
  const load = React.useCallback(async () => { const { data, error } = await supabase.from("essay_questions").select("*,essay_rubric_items(*)").order("concurso").order("question_number"); if (error) setNotice(error.message); else setItems(data || []); }, [supabase]);
  React.useEffect(() => { load(); }, [load]);
  const patch = (key, value) => setDraft((current) => ({ ...current, [key]: value }));
  const addRubric = () => setDraft((current) => ({ ...current, rubrics: [...current.rubrics, { section: "", subitem: "", criterion: "", expected_content: "", legal_basis: "", max_points: "" }] }));
  const updateRubric = (index, key, value) => setDraft((current) => ({ ...current, rubrics: current.rubrics.map((item, i) => i === index ? { ...item, [key]: value } : item) }));
  async function readPdf(file, target) { try { const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise; let text = ""; for (let page = 1; page <= pdf.numPages; page += 1) { const content = await pdf.getPage(page).then((p) => p.getTextContent()); text += content.items.map((x) => x.str + (x.hasEOL ? "\n" : " ")).join("") + "\n"; } patch(target, text); setNotice("PDF lido. Revise o texto e os critérios antes de salvar."); } catch (error) { setNotice(error.message); } }
  async function save() { if (!draft.statement.trim()) return setNotice("Informe o enunciado da questão discursiva."); setBusy(true); const row = { ...draft, question_number: draft.question_number ? Number(draft.question_number) : null, ano: draft.ano ? Number(draft.ano) : null, total_points: Number(draft.total_points || 0), rubrics: undefined, subjects: formatSubjects(draft.subjects) }; delete row.rubrics; const { data, error } = await supabase.from("essay_questions").insert(row).select("id").single(); if (!error && draft.rubrics.length) { const { error: rubricError } = await supabase.from("essay_rubric_items").insert(draft.rubrics.filter((r) => r.criterion.trim()).map((r, index) => ({ ...r, essay_question_id: data.id, max_points: Number(r.max_points || 0), display_order: index }))); if (rubricError) setNotice(rubricError.message); } setBusy(false); if (error) return setNotice(error.message); setNotice("Discursiva salva."); setDraft(empty); load(); }
  return <section className="essay-admin"><div className="library-heading"><div><span className="eyebrow">CADASTRO DE DISCURSIVAS</span><h2>Questões discursivas</h2><p>Peça prático-profissional não é cadastrada nesta área.</p></div></div><div className="card essay-import"><h3>Importar prova e espelho</h3><p>Os textos são extraídos no navegador. A separação e os critérios devem ser revisados antes de salvar.</p><label className="drop">Selecionar caderno de prova<input hidden type="file" accept="application/pdf" onChange={(e) => e.target.files[0] && readPdf(e.target.files[0], "statement")} /></label><label className="drop">Selecionar padrão de resposta<input hidden type="file" accept="application/pdf" onChange={(e) => e.target.files[0] && readPdf(e.target.files[0], "answer_key_text")} /></label></div><div className="card essay-form"><div className="cols"><label>Número<input value={draft.question_number} onChange={(e) => patch("question_number", e.target.value)} /></label><label>Pontuação máxima<input type="number" step="0.05" value={draft.total_points} onChange={(e) => patch("total_points", e.target.value)} /></label><label>Dificuldade<select value={draft.difficulty} onChange={(e) => patch("difficulty", e.target.value)}><option value="facil">Fácil</option><option value="media">Média</option><option value="dificil">Difícil</option></select></label></div><div className="cols"><label>Concurso<input value={draft.concurso} onChange={(e) => patch("concurso", e.target.value)} /></label><label>Banca<input value={draft.banca} onChange={(e) => patch("banca", e.target.value)} /></label><label>Ano<input type="number" value={draft.ano} onChange={(e) => patch("ano", e.target.value)} /></label></div><div className="cols"><label>Disciplina<input value={draft.discipline} onChange={(e) => patch("discipline", e.target.value)} /></label><label>Assunto(s)<input value={draft.subjects} placeholder="Use · ou ;" onChange={(e) => patch("subjects", e.target.value)} /></label></div><label>Enunciado<textarea rows="10" value={draft.statement} onChange={(e) => patch("statement", e.target.value)} /></label><label>Espelho oficial<textarea rows="8" value={draft.answer_key_text} onChange={(e) => patch("answer_key_text", e.target.value)} /></label><h3>Critérios e distribuição de pontos</h3>{draft.rubrics.map((rubric, index) => <div className="rubric-row" key={index}><input placeholder="Seção / item A" value={rubric.section} onChange={(e) => updateRubric(index, "section", e.target.value)} /><input placeholder="Critério" value={rubric.criterion} onChange={(e) => updateRubric(index, "criterion", e.target.value)} /><input placeholder="Fundamento" value={rubric.legal_basis} onChange={(e) => updateRubric(index, "legal_basis", e.target.value)} /><input type="number" step="0.05" placeholder="Pontos" value={rubric.max_points} onChange={(e) => updateRubric(index, "max_points", e.target.value)} /></div>)}<button className="light" onClick={addRubric}>Adicionar critério</button><button disabled={busy} onClick={save}>Salvar discursiva</button>{notice && <p className="form-message">{notice}</p>}</div><div className="essay-card-grid">{items.map((item) => <article className="question-card" key={item.id}><div className="card-top"><span>Questão {item.question_number || "—"}</span><span className={`difficulty ${item.difficulty}`}>{item.difficulty}</span></div><h3>{item.discipline || "Sem disciplina"}</h3><p className="question-subject">{item.subjects}</p><p className="question-preview">{item.statement}</p><div className="card-meta"><span>{item.concurso} · {item.banca} · {item.ano}</span><span>Valor: {item.total_points} ponto(s)</span></div></article>)}</div></section>;
}

function EssayStudy({ supabase, userId }) {
  const [questions, setQuestions] = React.useState([]), [attempts, setAttempts] = React.useState({}), [selected, setSelected] = React.useState(null), [attempt, setAttempt] = React.useState(null), [text, setText] = React.useState(""), [result, setResult] = React.useState(null), [contest, setContest] = React.useState(""), [token, setToken] = React.useState(""), [message, setMessage] = React.useState(""), [busy, setBusy] = React.useState(false);
  const load = React.useCallback(async () => { const [{ data: qs, error }, { data: history }] = await Promise.all([supabase.from("essay_questions").select("*,essay_rubric_items(*)").eq("is_hidden", false).order("concurso").order("question_number"), supabase.from("essay_attempts").select("*").eq("user_id", userId).eq("version", 1)]); if (error) setMessage(error.message); else setQuestions(qs || []); setAttempts(Object.fromEntries((history || []).map((item) => [item.essay_question_id, item]))); }, [supabase, userId]);
  React.useEffect(() => { load(); }, [load]);
  const correctedThisMonth = Object.values(attempts).filter((item) => item.corrected_at && new Date(item.corrected_at).getMonth() === new Date().getMonth() && new Date(item.corrected_at).getFullYear() === new Date().getFullYear()).length;
  const contests = [...new Set(questions.map((item) => item.concurso).filter(Boolean))], shown = questions.filter((item) => !contest || item.concurso === contest);
  const gradeClass = (percentage) => percentage >= 70 ? "grade-good" : percentage >= 50 ? "grade-mid" : "grade-low";
  async function openQuestion(question) { const saved = attempts[question.id] || null; setSelected(question); setAttempt(saved); setText(saved?.answer_text || ""); setResult(saved?.ai_feedback || null); setMessage(""); setToken(""); }
  async function saveDraft() { if (!selected) return null; const payload = { user_id: userId, essay_question_id: selected.id, answer_text: text, status: "draft", updated_at: new Date().toISOString() }; const query = attempt ? supabase.from("essay_attempts").update(payload).eq("id", attempt.id).select().single() : supabase.from("essay_attempts").insert(payload).select().single(); const { data, error } = await query; if (error) { setMessage(error.message); return null; } setAttempt(data); setAttempts((current) => ({ ...current, [selected.id]: data })); return data; }
  async function correct() { if (!text.trim()) return setMessage("Escreva sua resposta antes de corrigir."); if (attempt?.status === "corrected") return; setBusy(true); const current = await saveDraft(); if (!current) { setBusy(false); return; } const response = await supabase.functions.invoke("correct-essay", { body: { essay_question_id: selected.id, statement: selected.statement, answer_key_text: selected.answer_key_text, rubric_items: selected.essay_rubric_items, answer_text: text, authorization_token: token } }); if (response.error) { setMessage(response.error.message || "Não foi possível corrigir."); setBusy(false); return; } const feedback = response.data; const { data, error } = await supabase.from("essay_attempts").update({ status: "corrected", submitted_at: new Date().toISOString(), corrected_at: new Date().toISOString(), score: feedback.score, percentage: feedback.percentage, ai_feedback: feedback, updated_at: new Date().toISOString() }).eq("id", current.id).select().single(); if (error) setMessage(error.message); else { setAttempt(data); setAttempts((all) => ({ ...all, [selected.id]: data })); setResult(feedback); setToken(""); } setBusy(false); }
  async function requestCredit() { const { data: current } = await supabase.from("essay_correction_requests").select("id").eq("user_id", userId).eq("status", "pending").maybeSingle(); if (current) return setMessage("Você já possui uma solicitação aguardando análise."); const { error } = await supabase.from("essay_correction_requests").insert({ user_id: userId, message: "Solicitação de uma correção discursiva adicional." }); setMessage(error ? error.message : "Solicitação enviada ao administrador."); }
  if (!selected) return <section className="essay-study"><span className="eyebrow">DISCURSIVAS</span><h1>Pratique suas respostas</h1><p>{correctedThisMonth}/4 correções realizadas neste mês.</p>{correctedThisMonth >= 4 && <button className="light request-credit" onClick={requestCredit}>Solicitar correção adicional</button>}{message && <p className="form-message">{message}</p>}{contests.length > 1 && <div className="contest-tabs"><button className={!contest ? "active" : ""} onClick={() => setContest("")}>Todas</button>{contests.map((item) => <button className={contest === item ? "active" : ""} key={item} onClick={() => setContest(item)}>{item}</button>)}</div>}<div className="essay-card-grid">{shown.map((question) => { const saved = attempts[question.id], done = saved?.status === "corrected"; return <article className="question-card" key={question.id}><div className="card-top"><span>Questão {question.question_number || "—"}</span><span className={`difficulty ${question.difficulty}`}>{question.difficulty}</span></div><h3>{question.discipline}</h3><p className="question-subject">{question.subjects}</p><p className="question-preview">{question.statement}</p><div className="card-meta"><span className="contest-tag">{question.concurso} · {question.banca}</span><span>{question.ano} · Valor: {question.total_points} ponto(s)</span></div>{done && <span className={`essay-grade ${gradeClass(Number(saved.percentage || 0))}`}>{saved.percentage}% de acerto</span>}<button onClick={() => openQuestion(question)}>{done ? "Visualizar resposta" : saved ? "Continuar resposta" : "Responder"}</button></article>; })}</div>{!shown.length && <div className="card"><p>Nenhuma discursiva disponível neste concurso.</p></div>}</section>;
  const locked = attempt?.status === "corrected";
  return <section className="essay-answer"><button className="light" onClick={() => { setSelected(null); load(); }}>← Voltar às discursivas</button><div className="card"><span className="contest-tag">{selected.concurso} · {selected.banca} · {selected.ano}</span><h1>Questão {selected.question_number || "discursiva"}</h1><p>{selected.discipline} · {selected.subjects} · {selected.total_points} ponto(s)</p><FormattedQuestionText text={selected.statement} /><label className="essay-editor">Sua resposta<textarea rows="14" disabled={locked} value={text} onChange={(e) => setText(e.target.value)} placeholder="Digite sua resposta aqui…" /></label>{locked ? <p className="locked-answer">✓ Resposta corrigida e bloqueada para preservar o resultado.</p> : <><small>{text.trim() ? text.trim().split(/\s+/).length : 0} palavras</small>{correctedThisMonth >= 4 && <label className="essay-token">Token de autorização extra<input value={token} onChange={(e) => setToken(e.target.value)} placeholder="Código fornecido pelo administrador" /></label>}<div className="study-actions"><button className="light" onClick={saveDraft}>Salvar rascunho</button><button disabled={busy} onClick={correct}>{busy ? "Corrigindo…" : "Corrigir resposta"}</button></div></>}{message && <p className="form-message">{message}</p>}</div>{result && <div className="card essay-result"><span className="eyebrow">RESULTADO</span><h2 className={gradeClass(Number(result.percentage || 0))}>{result.score} de {result.max_score} pontos · {result.percentage}%</h2><p>{result.summary}</p><div className="rubric-feedback">{(result.criteria || []).map((criterion) => <article className={criterion.status} key={criterion.rubric_item_id}><b>{criterion.status === "hit" ? "✓ Acertou" : criterion.status === "partial" ? "◐ Parcial" : "× Não atendido"}</b><span>{criterion.achieved_points} / {criterion.max_points} ponto(s)</span><p>{criterion.feedback}</p>{criterion.evidence_excerpt && <small>Trecho identificado: “{criterion.evidence_excerpt}”</small>}</article>)}</div><p className="ai-disclaimer">{result.disclaimer}</p></div>}</section>;
}

function EssayStudyLegacy({ supabase, userId }) {
  const [questions, setQuestions] = React.useState([]), [selected, setSelected] = React.useState(null), [attempt, setAttempt] = React.useState(null), [text, setText] = React.useState(""), [result, setResult] = React.useState(null), [message, setMessage] = React.useState(""), [busy, setBusy] = React.useState(false);
  React.useEffect(() => { supabase.from("essay_questions").select("*,essay_rubric_items(*)").eq("is_hidden", false).order("concurso").order("question_number").then(({ data, error }) => { if (error) setMessage(error.message); else setQuestions(data || []); }); }, [supabase]);
  async function openQuestion(question) { setSelected(question); setResult(null); const { data } = await supabase.from("essay_attempts").select("*").eq("user_id", userId).eq("essay_question_id", question.id).eq("version", 1).maybeSingle(); if (data) { setAttempt(data); setText(data.answer_text || ""); setResult(data.ai_feedback || null); } else { setAttempt(null); setText(""); } }
  async function saveDraft() { if (!selected) return; const payload = { user_id: userId, essay_question_id: selected.id, answer_text: text, status: "draft", updated_at: new Date().toISOString() }; const query = attempt ? supabase.from("essay_attempts").update(payload).eq("id", attempt.id).select().single() : supabase.from("essay_attempts").insert(payload).select().single(); const { data, error } = await query; if (error) setMessage(error.message); else { setAttempt(data); setMessage("Rascunho salvo."); } }
  async function correct() { if (!text.trim()) return setMessage("Escreva sua resposta antes de corrigir."); setBusy(true); await saveDraft(); const response = await supabase.functions.invoke("correct-essay", { body: { statement: selected.statement, answer_key_text: selected.answer_key_text, rubric_items: selected.essay_rubric_items, answer_text: text } }); if (response.error) { setMessage(response.error.message || "Não foi possível corrigir."); setBusy(false); return; } const feedback = response.data; const current = attempt || (await supabase.from("essay_attempts").select("*").eq("user_id", userId).eq("essay_question_id", selected.id).eq("version", 1).single()).data; const { data, error } = await supabase.from("essay_attempts").update({ status: "corrected", submitted_at: new Date().toISOString(), corrected_at: new Date().toISOString(), score: feedback.score, percentage: feedback.percentage, ai_feedback: feedback, updated_at: new Date().toISOString() }).eq("id", current.id).select().single(); if (error) setMessage(error.message); else { setAttempt(data); setResult(feedback); } setBusy(false); }
  if (!selected) return <section className="essay-study"><span className="eyebrow">DISCURSIVAS</span><h1>Pratique suas respostas</h1><p>Selecione uma questão. A peça prático-profissional será disponibilizada em área própria futuramente.</p><div className="essay-card-grid">{questions.map((question) => <article className="question-card" key={question.id}><div className="card-top"><span>Questão {question.question_number || "—"}</span><span className={`difficulty ${question.difficulty}`}>{question.difficulty}</span></div><h3>{question.discipline}</h3><p className="question-subject">{question.subjects}</p><p className="question-preview">{question.statement}</p><div className="card-meta"><span>{question.concurso} · {question.banca} · {question.ano}</span><span>Valor: {question.total_points} ponto(s)</span></div><button onClick={() => openQuestion(question)}>Responder</button></article>)}</div>{!questions.length && <div className="card"><p>Nenhuma discursiva disponível no momento.</p></div>}</section>;
  return <section className="essay-answer"><button className="light" onClick={() => setSelected(null)}>← Voltar às discursivas</button><div className="card"><span className="contest-tag">{selected.concurso} · {selected.banca} · {selected.ano}</span><h1>Questão {selected.question_number || "discursiva"}</h1><p>{selected.discipline} · {selected.subjects} · {selected.total_points} ponto(s)</p><FormattedQuestionText text={selected.statement} /><label className="essay-editor">Sua resposta<textarea rows="14" value={text} onChange={(e) => setText(e.target.value)} placeholder="Digite sua resposta aqui…" /></label><small>{text.trim() ? text.trim().split(/\s+/).length : 0} palavras</small><div className="study-actions"><button className="light" onClick={() => { if (window.confirm("Limpar sua resposta?") ) setText(""); }}>Limpar</button><button className="light" onClick={saveDraft}>Salvar rascunho</button><button disabled={busy} onClick={correct}>{busy ? "Corrigindo…" : "Corrigir resposta"}</button></div>{message && <p className="form-message">{message}</p>}</div>{result && <div className="card essay-result"><span className="eyebrow">RESULTADO</span><h2>{result.score} de {result.max_score} pontos · {result.percentage}%</h2><p>{result.summary}</p><div className="rubric-feedback">{(result.criteria || []).map((criterion) => <article className={criterion.status} key={criterion.rubric_item_id}><b>{criterion.status === "hit" ? "✓ Acertou" : criterion.status === "partial" ? "◐ Parcial" : "× Não atendido"}</b><span>{criterion.achieved_points} / {criterion.max_points} ponto(s)</span><p>{criterion.feedback}</p>{criterion.evidence_excerpt && <small>Trecho identificado: “{criterion.evidence_excerpt}”</small>}</article>)}</div><p className="ai-disclaimer">{result.disclaimer}</p></div>}</section>;
}
function BatchReview({ drafts, setDrafts, questions, busy, analyzeSelected, saveBatch, deleteSelected, applyBulk, applyBulkOrigin }) {
  const [bulkDiscipline, setBulkDiscipline] = React.useState("");
  const [bulkSubject, setBulkSubject] = React.useState("");
  const [bulkContest, setBulkContest] = React.useState("");
  const [bulkBoard, setBulkBoard] = React.useState("");
  const [bulkYear, setBulkYear] = React.useState("");
  const disciplines = [...new Set(questions.map((q) => q.discipline).filter(Boolean))].sort();
  const subjects = subjectOptions(questions);
  const selectedCount = drafts.filter((q) => q.selected).length;
  const patch = (id, changes) => setDrafts((ds) => ds.map((q) => q.tempId === id ? { ...q, ...changes } : q));
  const statusOf = (q) => {
    if (!q.statement.trim() || q.alternatives.length < 2 || (!q.is_annulled && !/^[A-E]$/.test(q.correct_option))) return ["incomplete", "Incompleta"];
    if (q.duplicate) return ["duplicate", `Semelhante ${Math.round(q.duplicate.score * 100)}%`];
    if (q.is_annulled) return ["annulled-status", "Anulada"];
    if (!q.discipline || !q.subject || !q.explanation) return ["pending", "Aguardando análise"];
    return ["ready", "Pronta"];
  };
  return (
    <section className="card batch-review">
      <div className="batch-title">
        <div>
          <h2>Revisão do lote</h2>
          <p>{drafts.length} questão(ões) · {selectedCount} selecionada(s)</p>
        </div>
        <label className="select-all">
          <input
            type="checkbox"
            checked={selectedCount === drafts.length}
            ref={(el) => { if (el) el.indeterminate = selectedCount > 0 && selectedCount < drafts.length; }}
            onChange={(e) => setDrafts((ds) => ds.map((q) => ({ ...q, selected: e.target.checked })))}
          />
          Selecionar todas
        </label>
      </div>
      <div className="bulk-tools">
        <input list="saved-disciplines" placeholder="Disciplina para selecionadas" value={bulkDiscipline} onChange={(e) => setBulkDiscipline(e.target.value)} />
        <datalist id="saved-disciplines">{disciplines.map((x) => <option value={x} key={x} />)}</datalist>
        <input list="saved-subjects" placeholder="Assunto(s) para selecionadas — use · ou ;" value={bulkSubject} onChange={(e) => setBulkSubject(e.target.value)} />
        <datalist id="saved-subjects">{subjects.map((x) => <option value={x} key={x} />)}</datalist>
        <button className="light" onClick={() => applyBulk(bulkDiscipline, bulkSubject)}>Aplicar às selecionadas</button>
      </div>
      <div className="bulk-tools bulk-origin-tools">
        <input placeholder="Concurso para selecionadas" value={bulkContest} onChange={(e) => setBulkContest(e.target.value)} />
        <input placeholder="Banca para selecionadas" value={bulkBoard} onChange={(e) => setBulkBoard(e.target.value)} />
        <input type="number" placeholder="Ano para selecionadas" value={bulkYear} onChange={(e) => setBulkYear(e.target.value)} />
        <button className="light" onClick={() => applyBulkOrigin(bulkContest, bulkBoard, bulkYear)}>Aplicar origem às selecionadas</button>
      </div>
      <div className="batch-actions">
        <button disabled={busy || !selectedCount} onClick={analyzeSelected}>{busy ? "Analisando…" : "Analisar selecionadas com IA"}</button>
        <button className="light" disabled={busy || !selectedCount} onClick={() => saveBatch("selected")}>Salvar selecionadas</button>
        <button className="light" disabled={busy} onClick={() => saveBatch("all")}>Salvar todas</button>
        <button className="danger" disabled={busy || !selectedCount} onClick={deleteSelected}>Excluir selecionadas do lote</button>
      </div>
      <div className="batch-table-wrap">
        <table className="batch-table">
          <thead><tr><th></th><th>Nº</th><th>Questão</th><th>Disciplina</th><th>Assunto</th><th>Dificuldade</th><th>Situação</th><th></th></tr></thead>
          <tbody>
            {drafts.map((q) => {
              const [statusClass, statusLabel] = statusOf(q);
              return (
                <React.Fragment key={q.tempId}>
                  <tr className={statusClass}>
                    <td><input type="checkbox" checked={q.selected} onChange={(e) => patch(q.tempId, { selected: e.target.checked })} /></td>
                    <td>{q.original_number}</td>
                    <td className="statement-cell" title={q.statement}>{q.statement}</td>
                    <td>{q.discipline || "—"}</td><td>{q.subject || "—"}</td>
                    <td><span className={`difficulty ${q.difficulty_initial}`}>{q.difficulty_initial}</span></td>
                    <td><span className={`status ${statusClass}`}>{q.aiStatus === "analyzing" ? "Analisando…" : q.aiStatus === "error" ? "Erro na IA" : statusLabel}</span></td>
                    <td><button className="light compact" onClick={() => patch(q.tempId, { expanded: !q.expanded })}>{q.expanded ? "Fechar" : "Revisar"}</button></td>
                  </tr>
                  {q.expanded && <tr className="expanded-row"><td colSpan="8"><DraftEditor q={q} patchDraft={(changes) => patch(q.tempId, changes)} questions={questions} /></td></tr>}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function DraftEditor({ q, patchDraft, questions }) {
  const setField = (key, value) => patchDraft({ [key]: value });
  const alt = (letter, text) =>
    setField(
      "alternatives",
      q.alternatives.map((a) => (a.letter === letter ? { ...a, text } : a)),
    );
  const disciplines = [
      ...new Set(questions.map((x) => x.discipline).filter(Boolean)),
    ].sort(),
    subjects = subjectOptions(questions, q.discipline);
  return (
    <div className="editor inline-editor">
      <h3>Questão {q.original_number}</h3>
      <textarea
        rows="4"
        value={q.statement}
        onChange={(e) => setField("statement", e.target.value)}
      />
      {q.alternatives.map((a) => (
        <label className="alt" key={a.letter}>
          <input
            type="radio"
            name={q.tempId}
            checked={q.correct_option === a.letter}
            onChange={() => patchDraft({ correct_option: a.letter, is_annulled: false })}
          />
          <b>{a.letter}</b>
          <input
            value={a.text}
            onChange={(e) => alt(a.letter, e.target.value)}
          />
        </label>
      ))}
      <button
        type="button"
        className={q.correct_option === "*" ? "annulled" : "light"}
        onClick={() => patchDraft({
          correct_option: q.correct_option === "*" ? "" : "*",
          is_annulled: q.correct_option !== "*",
          explanation: q.correct_option !== "*" ? "Questão anulada conforme o gabarito oficial." : "",
        })}
      >
        {q.correct_option === "*" ? "Questão anulada" : "Marcar como anulada"}
      </button>
      <div className="cols">
        <div>
          <input
            list={`disciplines-${q.tempId}`}
            placeholder="Disciplina"
            value={q.discipline}
            onChange={(e) => setField("discipline", e.target.value)}
          />
          <datalist id={`disciplines-${q.tempId}`}>
            {disciplines.map((x) => (
              <option value={x} key={x} />
            ))}
          </datalist>
        </div>
        <div>
          <input
            list={`subjects-${q.tempId}`}
            placeholder="Assunto(s) — separe por · ou ;"
            value={q.subject}
            onChange={(e) => setField("subject", e.target.value)}
          />
          <datalist id={`subjects-${q.tempId}`}>
            {subjects.map((x) => (
              <option value={x} key={x} />
            ))}
          </datalist>
        </div>
      </div>
      <div className="cols"><input placeholder="Banca" value={q.banca || ""} onChange={(e) => setField("banca", e.target.value)} /><input type="number" placeholder="Ano" value={q.ano || ""} onChange={(e) => setField("ano", e.target.value)} /></div>
      <input placeholder="Concurso" value={q.concurso || ""} onChange={(e) => setField("concurso", e.target.value)} />
      <textarea
        rows="4"
        placeholder="Comentário explicativo"
        value={q.explanation}
        onChange={(e) => setField("explanation", e.target.value)}
      />
      <div className="cols">
        <select value={q.difficulty_initial} onChange={(e) => patchDraft({ difficulty_initial: e.target.value, difficulty_current: e.target.value })}>
          <option value="facil">Fácil</option><option value="media">Média</option><option value="dificil">Difícil</option>
        </select>
        <div className="confidence">Confiança da IA: {q.ai_confidence == null ? "—" : `${Math.round(q.ai_confidence * 100)}%`}</div>
      </div>
    </div>
  );
}
function FormattedQuestionText({ text }) {
  const normalized = String(text || "")
    // A extração do PDF costuma criar uma quebra em cada linha visual; elas viram espaços.
    .replace(/\s+/g, " ")
    // Apenas itens enumerados passam a iniciar uma linha própria.
    .replace(/\s+(?=(?:I|II|III|IV|V|VI|VII|VIII|IX|X)\.\s)/g, "\n")
    .trim();
  const lines = normalized
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  return <div className="question-statement">{lines.map((line, index) => <p key={index}>{line}</p>)}</div>;
}
function LegacyStudy({ questions, supabase, userId }) {
  const [discipline, setDiscipline] = React.useState(""),
    [subject, setSubject] = React.useState(""),
    [board, setBoard] = React.useState(""),
    [year, setYear] = React.useState(""),
    [contest, setContest] = React.useState(""),
    [cycle, setCycle] = React.useState([]),
    [remaining, setRemaining] = React.useState([]),
    [status, setStatus] = React.useState([]),
    [pos, setPos] = React.useState(0),
    [choice, setChoice] = React.useState(""),
    [checked, setChecked] = React.useState(false),
    [finished, setFinished] = React.useState(false),
    [cycleId, setCycleId] = React.useState(null),
    [celebration, setCelebration] = React.useState(false);
  const restoredCycle = React.useRef(false);
  const skipRestoredFilterChange = React.useRef(false);
  const cycleStorageKey = `caderno-questoes:study-cycle:${userId}`;
  const pool = questions.filter(
    (q) =>
      !q.is_annulled && !q.is_hidden && q.correct_option !== "*" &&
      (!discipline || q.discipline === discipline) &&
      hasSubject(q, subject) &&
      (!board || q.banca === board) &&
      (!year || String(q.ano) === year) &&
      (!contest || q.concurso === contest),
  );
  const begin = React.useCallback((source, keepRemaining = []) => {
    const picked = shuffle(source).slice(0, 10);
    setCycle(picked);
    setRemaining(keepRemaining);
    setStatus(picked.map(() => null));
    setPos(0);
    setChoice("");
    setChecked(false);
    setFinished(false);
    setCycleId(null);
    if (picked.length) supabase.from("study_cycles").insert({ user_id: userId, total_questions: picked.length, discipline: discipline || null, subject: subject || null }).select("id").single().then(({ data }) => setCycleId(data?.id || null));
  }, [supabase, userId, discipline, subject, board, year, contest]);
  React.useEffect(() => {
    if (!questions.length) return;
    // Só na primeira abertura: recupera exatamente o ciclo que estava em andamento.
    if (!restoredCycle.current) {
      restoredCycle.current = true;
      try {
        const saved = JSON.parse(window.localStorage.getItem(cycleStorageKey) || "null");
        const byId = new Map(questions.map((item) => [item.id, item]));
        const savedCycle = (saved?.questionIds || []).map((id) => byId.get(id)).filter(Boolean);
        if (savedCycle.length === (saved?.questionIds || []).length && savedCycle.length) {
          skipRestoredFilterChange.current = (saved.discipline || "") !== discipline || (saved.subject || "") !== subject || (saved.board || "") !== board || (saved.year || "") !== year || (saved.contest || "") !== contest;
          setDiscipline(saved.discipline || "");
          setSubject(saved.subject || "");
          setBoard(saved.board || "");
          setYear(saved.year || "");
          setContest(saved.contest || "");
          setCycle(savedCycle);
          setRemaining((saved.remainingIds || []).map((id) => byId.get(id)).filter(Boolean));
          setStatus(saved.status?.length === savedCycle.length ? saved.status : savedCycle.map(() => null));
          setPos(Math.min(Math.max(Number(saved.pos) || 0, 0), savedCycle.length - 1));
          setChoice(saved.choice || "");
          setChecked(Boolean(saved.checked));
          setFinished(Boolean(saved.finished));
          setCycleId(saved.cycleId || null);
          return;
        }
      } catch { /* um estado inválido não impede o início de um novo ciclo */ }
    }
    if (skipRestoredFilterChange.current) {
      skipRestoredFilterChange.current = false;
      return;
    }
    begin(pool, []);
  }, [questions, discipline, subject, board, year, contest]);
  React.useEffect(() => {
    if (!cycle.length) return;
    window.localStorage.setItem(cycleStorageKey, JSON.stringify({
      questionIds: cycle.map((item) => item.id), remainingIds: remaining.map((item) => item.id), status,
      pos, choice, checked, finished, cycleId, discipline, subject, board, year, contest,
    }));
  }, [cycle, remaining, status, pos, choice, checked, finished, cycleId, discipline, subject, board, year, contest, cycleStorageKey]);
  const q = cycle[pos];
  function markCycleCompleted() { if (cycleId) supabase.from("study_cycles").update({ completed_at: new Date().toISOString() }).eq("id", cycleId); }
  function advance() {
    if (pos + 1 >= cycle.length) { setFinished(true); markCycleCompleted(); }
    else {
      setPos((p) => p + 1);
      setChoice("");
      setChecked(false);
    }
  }
  async function correct() {
    const isCorrect = choice === q.correct_option;
    setStatus((s) =>
      s.map((x, i) => (i === pos ? (isCorrect ? "correct" : "wrong") : x)),
    );
    setChecked(true);
    const { error } = await supabase
      .from("answers")
      .insert({
        user_id: userId,
        question_id: q.id,
        selected_option: choice,
        is_correct: isCorrect,
      });
    if (error) console.error(error);
    if (isCorrect && q.difficulty_current === "dificil") {
      setCelebration(true);
      window.setTimeout(() => setCelebration(false), 1400);
    }
  }
  function skip() {
    setStatus((s) => s.map((x, i) => (i === pos ? "skipped" : x)));
    advance();
  }
  function newCycle() {
    let available = remaining;
    if (!available.length)
      available = pool.filter((x) => !cycle.some((old) => old.id === x.id));
    if (!available.length) available = pool;
    const picked = shuffle(available).slice(0, 10),
      pickedIds = new Set(picked.map((x) => x.id));
    begin(
      picked,
      available.filter((x) => !pickedIds.has(x.id)),
    );
  }
  function restart() {
    const review = cycle.filter((_x, i) => status[i] !== "correct");
    if (review.length) begin(review, remaining);
  }
  function finishCycle() {
    setFinished(true);
    markCycleCompleted();
  }
  if (!questions.length)
    return (
      <section className="card">
        <p>Cadastre questões para começar.</p>
      </section>
    );
  const correctTotal = status.filter((x) => x === "correct").length,
    wrongTotal = status.filter((x) => x === "wrong").length,
    skippedTotal = status.filter((x) => x === "skipped" || x === null).length;
  const focus = [
    ...cycle.reduce((map, item, i) => {
      if (status[i] === "wrong") {
        const area =
          [item.discipline, item.subject].filter(Boolean).join(" — ") ||
          "Questões sem classificação";
        map.set(area, (map.get(area) || 0) + 1);
      }
      return map;
    }, new Map()),
  ].sort((a, b) => b[1] - a[1]);
  const motivational =
    correctTotal === cycle.length
      ? "Excelente! Você acertou todas as questões deste ciclo."
      : correctTotal >= Math.ceil(cycle.length * 0.7)
        ? "Muito bom! Você está no caminho certo."
        : "Continue praticando: cada revisão fortalece o aprendizado.";
  const answeredTotal = correctTotal + wrongTotal;
  const completion = cycle.length ? Math.round((answeredTotal / cycle.length) * 100) : 0;
  const boards = [...new Set(questions.map((item) => item.banca).filter(Boolean))].sort();
  const years = [...new Set(questions.map((item) => item.ano).filter(Boolean))].sort((a, b) => b - a);
  const contests = [...new Set(questions.map((item) => item.concurso).filter(Boolean))].sort();
  return (
    <section className="study-dashboard">
      {celebration && <div className="celebration" role="status"><span>★</span><b>Excelente!</b><small>Você acertou uma questão difícil.</small></div>}
      <div className="card study study-main">
        <div className="study-filters">
          <select
            value={discipline}
            onChange={(e) => setDiscipline(e.target.value)}
          >
            <option value="">Todas as disciplinas</option>
            {[
              ...new Set(questions.map((x) => x.discipline).filter(Boolean)),
            ].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
          <select value={subject} onChange={(e) => setSubject(e.target.value)}>
            <option value="">Todos os assuntos</option>
            {subjectOptions(questions, discipline).map(
              (x) => (
                <option key={x}>{x}</option>
              ),
            )}
          </select>
          <select value={board} onChange={(e) => setBoard(e.target.value)}><option value="">Todas as bancas</option>{boards.map((item) => <option key={item}>{item}</option>)}</select>
          <select value={year} onChange={(e) => setYear(e.target.value)}><option value="">Todos os anos</option>{years.map((item) => <option key={item}>{item}</option>)}</select>
          <select value={contest} onChange={(e) => setContest(e.target.value)}><option value="">Todos os concursos</option>{contests.map((item) => <option key={item}>{item}</option>)}</select>
          <button className="light clear-filters" onClick={() => { setDiscipline(""); setSubject(""); setBoard(""); setYear(""); setContest(""); }}>↻ Limpar filtros</button>
        </div>
        {!cycle.length ? (
          <p>Nenhuma questão encontrada para os filtros selecionados.</p>
        ) : finished ? (
          <div className="summary">
            <h2>Ciclo concluído</h2>
            <div className="score">
              <span className="score-ok">{correctTotal} acerto(s)</span>
              <span className="score-no">{wrongTotal} erro(s)</span>
              <span>{skippedTotal} pulada(s)</span>
            </div>
            <p>{motivational}</p>
            {focus.length > 0 && (
              <div className="focus">
                <h3>Áreas para reforçar</h3>
                {focus.map(([area, count]) => (
                  <p key={area}>
                    {area}{" "}
                    <small>
                      ({count} erro{count > 1 ? "s" : ""})
                    </small>
                  </p>
                ))}
              </div>
            )}
            <div className="study-actions">
              {correctTotal < cycle.length && (
                <button className="light" onClick={restart}>
                  Reiniciar erradas e puladas
                </button>
              )}
              <button onClick={newCycle}>Começar novo ciclo</button>
            </div>
          </div>
        ) : (
          q && (
            <>
              <div className="study-cycle-head">
                <b>Ciclo de {cycle.length} questões</b>
                <span className={`difficulty ${q.difficulty_current || "media"}`}>▥ Dificuldade: {q.difficulty_current || "media"}</span>
                <span className="study-position">{pos + 1} de {cycle.length}</span>
              </div>
              <div className="study-progress"><span style={{ width: `${((pos + 1) / cycle.length) * 100}%` }} /></div>
              {(q.banca || q.ano || q.concurso) && <div className="study-origin"><span>Origem da questão</span>{q.banca && <b>{q.banca}</b>}{q.ano && <b>{q.ano}</b>}{q.concurso && <b>{q.concurso}</b>}</div>}
              <FormattedQuestionText text={q.statement} />
              {q.alternatives.map((a) => (
                <button
                  key={a.letter}
                  className={`option ${choice === a.letter ? "chosen" : ""} ${checked && a.letter === q.correct_option ? "correct" : ""} ${checked && choice === a.letter && choice !== q.correct_option ? "wrong" : ""}`}
                  disabled={checked}
                  onClick={() => setChoice(a.letter)}
                >
                  <span className="option-letter">{a.letter}</span>
                  <span>{a.text}</span>
                </button>
              ))}
              {checked && (
                <div
                  className={
                    choice === q.correct_option ? "result ok" : "result no"
                  }
                >
                  {choice === q.correct_option
                    ? "Resposta correta!"
                    : `Resposta incorreta. Gabarito: ${q.correct_option}.`}
                  {q.explanation && <small>{q.explanation}</small>}
                </div>
              )}
              <div className="study-actions">
                {!checked && (
                  <button className="light" onClick={skip}>
                    ▷ Pular questão
                  </button>
                )}
                {!checked && <button className="light" onClick={finishCycle}>⚑ Finalizar ciclo</button>}
                <button
                  disabled={!checked && !choice}
                  onClick={checked ? advance : correct}
                >
                  {checked ? "Próxima" : "✓ Corrigir"}
                </button>
              </div>
            </>
          )
        )}
      </div>
      {cycle.length > 0 && <aside className="card study-sidebar" aria-label="Progresso do ciclo">
        <div className="sidebar-title"><span>🎓</span><b>Seu progresso neste ciclo</b></div>
        <div className="progress-overview">
          <div className="progress-ring" style={{ "--progress": `${completion * 3.6}deg` }}><b>{completion}%</b></div>
          <div><b>{answeredTotal} de {cycle.length}</b><span>questões respondidas</span><div className="mini-progress"><i style={{ width: `${completion}%` }} /></div></div>
        </div>
        <div className="sidebar-section"><b>Questões do ciclo</b><div className="dot-grid">
          {status.map((state, i) => <span key={i} className={`cycle-dot ${state || "pending"} ${!finished && i === pos ? "current" : ""}`}>{i + 1}{state === "correct" && <i>✓</i>}</span>)}
        </div></div>
        <div className="sidebar-section"><b>Estatísticas rápidas</b><div className="quick-stats"><span className="stat correct-stat"><b>{correctTotal}</b><small>Acertos</small></span><span className="stat wrong-stat"><b>{wrongTotal}</b><small>Erros</small></span><span className="stat"><b>{cycle.length - answeredTotal}</b><small>Pendentes</small></span></div></div>
        <div className="sidebar-message"><b>🏆 Foco + Consistência = Resultado</b><span>{motivational}</span></div>
      </aside>}
    </section>
  );
}

function Study({ questions, supabase, userId }) {
  const [filters, setFilters] = React.useState({ contest: "", board: "", year: "", discipline: "", subject: "" });
  const [active, setActive] = React.useState(null), [cycle, setCycle] = React.useState([]), [progress, setProgress] = React.useState([]), [pos, setPos] = React.useState(0), [choice, setChoice] = React.useState(""), [checked, setChecked] = React.useState(false), [loading, setLoading] = React.useState(true), [message, setMessage] = React.useState(""), [celebration, setCelebration] = React.useState(false);
  const visible = questions.filter((q) => !q.is_annulled && !q.is_hidden && q.correct_option !== "*");
  const contests = [...new Set(visible.map((q) => q.concurso).filter(Boolean))].sort();
  const boards = [...new Set(visible.filter((q) => !filters.contest || q.concurso === filters.contest).map((q) => q.banca).filter(Boolean))].sort();
  const years = [...new Set(visible.filter((q) => (!filters.contest || q.concurso === filters.contest) && (!filters.board || q.banca === filters.board)).map((q) => q.ano).filter(Boolean))].sort((a, b) => b - a);
  const candidatePool = visible.filter((q) => q.concurso === filters.contest && q.banca === filters.board && String(q.ano) === filters.year && (!filters.discipline || q.discipline === filters.discipline) && hasSubject(q, filters.subject));
  const disciplines = [...new Set(candidatePool.map((q) => q.discipline).filter(Boolean))].sort();
  const subjects = subjectOptions(candidatePool, filters.discipline);
  const hydrate = React.useCallback((row) => {
    const byId = new Map(questions.map((q) => [q.id, q])); const selected = (row.question_ids || []).map((id) => byId.get(id)).filter(Boolean);
    if (!selected.length) return false;
    const saved = Array.isArray(row.progress) && row.progress.length === selected.length ? row.progress : selected.map(() => null);
    setActive(row); setCycle(selected); setProgress(saved); setPos(Math.min(Math.max(Number(row.current_position) || 0, 0), selected.length - 1)); setChoice(row.selected_option || ""); setChecked(Boolean(row.is_checked));
    setFilters({ contest: row.concurso || "", board: row.banca || "", year: row.ano ? String(row.ano) : "", discipline: row.discipline || "", subject: row.subject || "" }); return true;
  }, [questions]);
  React.useEffect(() => { let alive = true; (async () => { setLoading(true); const { data, error } = await supabase.from("study_cycles").select("*").eq("user_id", userId).is("completed_at", null).order("started_at", { ascending: false }).limit(1).maybeSingle(); if (!alive) return; if (error) setMessage(error.message); if (data) hydrate(data); setLoading(false); })(); return () => { alive = false; }; }, [supabase, userId, hydrate]);
  const updateCycle = React.useCallback(async (patch, local = {}) => { if (!active?.id) return; const next = { ...active, ...patch }; setActive(next); Object.entries(local).forEach(([key, value]) => ({ cycle: setCycle, progress: setProgress, pos: setPos, choice: setChoice, checked: setChecked })[key]?.(value)); const { error } = await supabase.from("study_cycles").update(patch).eq("id", active.id); if (error) setMessage(`Não foi possível salvar o ciclo: ${error.message}`); }, [active, supabase]);
  async function generateCycle() {
    if (!filters.contest || !filters.board || !filters.year) return setMessage("Escolha concurso, banca e ano antes de gerar o ciclo.");
    const { data, error } = await supabase.from("study_cycles").select("question_ids").eq("user_id", userId); if (error) return setMessage(error.message);
    const used = new Set((data || []).flatMap((row) => row.question_ids || [])); const available = candidatePool.filter((q) => !used.has(q.id));
    if (available.length < 10) return setMessage(`Há apenas ${available.length} questão(ões) novas com estes filtros. São necessárias 10 para fechar um ciclo.`);
    const picked = shuffle(available).slice(0, 10); const row = { user_id: userId, total_questions: picked.length, question_ids: picked.map((q) => q.id), progress: picked.map(() => null), current_position: 0, answer_count: 0, correct_count: 0, wrong_count: 0, skipped_count: 0, banca: filters.board, ano: Number(filters.year), concurso: filters.contest, discipline: filters.discipline || null, subject: filters.subject || null };
    const { data: created, error: createError } = await supabase.from("study_cycles").insert(row).select("*").single(); if (createError) return setMessage(`Não foi possível criar o ciclo: ${createError.message}`); hydrate(created); setMessage("Ciclo gerado e vinculado à sua conta.");
  }
  async function correct() {
    const q = cycle[pos]; if (!q || !choice || checked) return; const isCorrect = choice === q.correct_option; const nextProgress = progress.map((value, index) => index === pos ? (isCorrect ? "correct" : "wrong") : value); const answerCount = nextProgress.filter((x) => x === "correct" || x === "wrong").length; const correctCount = nextProgress.filter((x) => x === "correct").length; const wrongCount = nextProgress.filter((x) => x === "wrong").length;
    const { error } = await supabase.from("answers").insert({ user_id: userId, question_id: q.id, selected_option: choice, is_correct: isCorrect }); if (error) return setMessage(error.message);
    await updateCycle({ progress: nextProgress, is_checked: true, selected_option: choice, answer_count: answerCount, correct_count: correctCount, wrong_count: wrongCount }, { progress: nextProgress, checked: true });
    if (isCorrect && q.difficulty_current === "dificil") { setCelebration(true); window.setTimeout(() => setCelebration(false), 1400); }
  }
  async function move(nextPosition, nextProgress = progress) { const next = Math.min(Math.max(nextPosition, 0), cycle.length - 1); await updateCycle({ progress: nextProgress, current_position: next, selected_option: "", is_checked: false, answer_count: nextProgress.filter((x) => x === "correct" || x === "wrong").length, correct_count: nextProgress.filter((x) => x === "correct").length, wrong_count: nextProgress.filter((x) => x === "wrong").length, skipped_count: nextProgress.filter((x) => x === "skipped").length }, { progress: nextProgress, pos: next, choice: "", checked: false }); }
  async function skip() { const next = progress.map((x, i) => i === pos ? "skipped" : x); if (pos + 1 >= cycle.length) return complete(next); await move(pos + 1, next); }
  async function complete(nextProgress = progress) { const summary = { best_disciplines: [...cycle.reduce((map, q, index) => { if (nextProgress[index] === "correct" && q.discipline) map.set(q.discipline, (map.get(q.discipline) || 0) + 1); return map; }, new Map())].sort((a,b) => b[1]-a[1]).slice(0,3) }; await updateCycle({ progress: nextProgress, completed_at: new Date().toISOString(), closed_at: new Date().toISOString(), summary, current_position: pos }, { progress: nextProgress }); }
  const finished = Boolean(active?.completed_at); const correctTotal = progress.filter((x) => x === "correct").length, wrongTotal = progress.filter((x) => x === "wrong").length, skippedTotal = progress.filter((x) => x === "skipped").length, answeredTotal = correctTotal + wrongTotal, completion = cycle.length ? Math.round(answeredTotal / cycle.length * 100) : 0; const q = cycle[pos];
  const focus = [...cycle.reduce((map, item, index) => { if (progress[index] === "wrong") { const key = [item.discipline, formatSubjects(item.subject)].filter(Boolean).join(" — ") || "Questões sem classificação"; map.set(key, (map.get(key) || 0) + 1); } return map; }, new Map())].sort((a,b) => b[1]-a[1]);
  if (!questions.length) return <section className="card"><p>Cadastre questões para começar.</p></section>;
  if (loading) return <section className="card"><p>Carregando seu ciclo…</p></section>;
  if (!active) return <section className="card cycle-setup"><span className="eyebrow">NOVO CICLO</span><h1>Monte seu ciclo de estudos</h1><p>Escolha a origem da prova. O ciclo ficará salvo na sua conta com 10 questões exclusivas.</p><div className="study-filters"><select value={filters.contest} onChange={(e) => setFilters({ contest: e.target.value, board: "", year: "", discipline: "", subject: "" })}><option value="">Selecione o concurso</option>{contests.map((x) => <option key={x}>{x}</option>)}</select><select value={filters.board} disabled={!filters.contest} onChange={(e) => setFilters({ ...filters, board: e.target.value, year: "", discipline: "", subject: "" })}><option value="">Selecione a banca</option>{boards.map((x) => <option key={x}>{x}</option>)}</select><select value={filters.year} disabled={!filters.board} onChange={(e) => setFilters({ ...filters, year: e.target.value, discipline: "", subject: "" })}><option value="">Selecione o ano</option>{years.map((x) => <option key={x}>{x}</option>)}</select><select value={filters.discipline} disabled={!filters.year} onChange={(e) => setFilters({ ...filters, discipline: e.target.value, subject: "" })}><option value="">Todas as disciplinas</option>{disciplines.map((x) => <option key={x}>{x}</option>)}</select><select value={filters.subject} disabled={!filters.year} onChange={(e) => setFilters({ ...filters, subject: e.target.value })}><option value="">Todos os assuntos</option>{subjects.map((x) => <option key={x}>{x}</option>)}</select></div>{filters.year && <p className={candidatePool.length >= 10 ? "availability ok" : "availability no"}>{candidatePool.length >= 10 ? `${candidatePool.length} questões encontradas. Você pode gerar um ciclo de 10.` : `Apenas ${candidatePool.length} questão(ões) encontradas; são necessárias 10.`}</p>}<button disabled={!filters.year} onClick={generateCycle}>Gerar ciclo de 10 questões</button>{message && <p className="form-message">{message}</p>}</section>;
  if (finished) return <section className="card summary"><span className="eyebrow">CICLO ARQUIVADO</span><h1>Ciclo concluído</h1><div className="score"><span className="score-ok">{correctTotal} acerto(s)</span><span className="score-no">{wrongTotal} erro(s)</span><span>{skippedTotal} pulada(s)</span></div><p>{correctTotal === cycle.length ? "Excelente! Você acertou todas as questões deste ciclo." : "Ciclo salvo no seu histórico. Continue praticando."}</p>{focus.length > 0 && <div className="focus"><h3>Áreas para reforçar</h3>{focus.map(([area,count]) => <p key={area}>{area} <small>({count} erro{count > 1 ? "s" : ""})</small></p>)}</div>}<button onClick={() => { setActive(null); setCycle([]); setProgress([]); setMessage(""); }}>Montar novo ciclo</button></section>;
  return <section className="study-dashboard">{celebration && <div className="celebration"><span>★</span><b>Excelente!</b><small>Você acertou uma questão difícil.</small></div>}<div className="card study study-main"><div className="study-cycle-head"><b>{active.concurso} · {active.banca} · {active.ano}</b><span className={`difficulty ${q?.difficulty_current || "media"}`}>▥ Dificuldade: {q?.difficulty_current || "media"}</span><span className="study-position">{pos + 1} de {cycle.length}</span></div><div className="study-progress"><span style={{ width: `${((pos + 1) / cycle.length) * 100}%` }} /></div><FormattedQuestionText text={q?.statement} />{(q?.alternatives || []).map((a) => <button key={a.letter} className={`option ${choice === a.letter ? "chosen" : ""} ${checked && a.letter === q.correct_option ? "correct" : ""} ${checked && choice === a.letter && choice !== q.correct_option ? "wrong" : ""}`} disabled={checked} onClick={() => setChoice(a.letter)}><span className="option-letter">{a.letter}</span><span>{a.text}</span></button>)}{checked && <div className={choice === q.correct_option ? "result ok" : "result no"}>{choice === q.correct_option ? "Resposta correta!" : `Resposta incorreta. Gabarito: ${q.correct_option}.`}{q.explanation && <small>{q.explanation}</small>}</div>}<div className="study-actions">{!checked && <button className="light" onClick={skip}>▷ Pular questão</button>}<button className="light" onClick={() => complete()}>⚑ Encerrar ciclo</button><button disabled={!checked && !choice} onClick={checked ? () => pos + 1 >= cycle.length ? complete() : move(pos + 1) : correct}>{checked ? (pos + 1 >= cycle.length ? "Concluir ciclo" : "Próxima") : "✓ Corrigir"}</button></div>{message && <p className="form-message">{message}</p>}</div><aside className="card study-sidebar"><div className="sidebar-title"><span>🎓</span><b>Seu progresso neste ciclo</b></div><div className="progress-overview"><div className="progress-ring" style={{ "--progress": `${completion * 3.6}deg` }}><b>{completion}%</b></div><div><b>{answeredTotal} de {cycle.length}</b><span>questões respondidas</span><div className="mini-progress"><i style={{ width: `${completion}%` }} /></div></div></div><div className="sidebar-section"><b>Questões do ciclo</b><div className="dot-grid">{progress.map((state, i) => <span key={i} className={`cycle-dot ${state || "pending"} ${i === pos ? "current" : ""}`}>{i + 1}{state === "correct" && <i>✓</i>}</span>)}</div></div><div className="sidebar-section"><b>Estatísticas rápidas</b><div className="quick-stats"><span className="stat correct-stat"><b>{correctTotal}</b><small>Acertos</small></span><span className="stat wrong-stat"><b>{wrongTotal}</b><small>Erros</small></span><span className="stat"><b>{cycle.length - answeredTotal}</b><small>Pendentes</small></span></div></div></aside></section>;
}
createRoot(document.getElementById("root")).render(<App />);

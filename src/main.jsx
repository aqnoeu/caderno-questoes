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
    const { data, error } = await supabase.from("profiles").select("id,email,role").eq("id", session.user.id).maybeSingle();
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
  async function remove(id) {
    if (!confirm("Excluir esta questão?")) return;
    const { error } = await supabase.from("questions").delete().eq("id", id);
    if (error) setNotice(error.message);
    else load();
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
      {drafts.length > 0 && <BatchReview drafts={drafts} setDrafts={setDrafts} questions={questions} busy={busy} analyzeSelected={analyzeSelected} saveBatch={saveBatch} deleteSelected={deleteSelected} applyBulk={applyBulk} />}
    </section>
  );
  return (
    <main className="app-shell">
      <header className="app-header">
        <button className="brand" onClick={() => openUser("inicio")}><span className="brand-mark">✓</span><span><b>Caderno de Questões</b><small>Estude. Resolva. Evolua.</small></span></button>
        <details className="profile-menu" onMouseLeave={(event) => event.currentTarget.removeAttribute("open")}><summary><span className="avatar">{(profile?.email || session.user.email || "U")[0].toUpperCase()}</span><span className="profile-name">{profile?.email || session.user.email}</span><span>⌄</span></summary><div><button onClick={() => openUser("inicio")}>Minha conta</button><button onClick={() => setNotice("Preferências estarão disponíveis em breve.")}>Preferências</button>{isAdmin && <button onClick={() => openAdmin()}>Painel administrativo</button>}<button onClick={() => supabase.auth.signOut()}>Sair</button></div></details>
        {area === "user" && <nav className="user-nav">{[["inicio", "⌂", "Início"], ["estudos", "▤", "Estudos"], ["desempenho", "▥", "Desempenho"]].map(([id, icon, label]) => <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}><span aria-hidden="true">{icon}</span>{label}</button>)}</nav>}
      </header>
      {notice && (
        <div className="notice">
          {notice}
          <button onClick={() => setNotice("")}>×</button>
        </div>
      )}
      {area === "user" ? <>
        {tab === "inicio" && <UserHome questions={questions} userId={session.user.id} email={profile?.email || session.user.email} supabase={supabase} goStudy={() => setTab("estudos")} />}
        <div hidden={tab !== "estudos"}><Study questions={questions} supabase={supabase} userId={session.user.id} /></div>
        {tab === "desempenho" && <Performance questions={questions} userId={session.user.id} supabase={supabase} goStudy={() => setTab("estudos")} />}
      </> : isAdmin ? <section className="admin-layout"><aside className="admin-sidebar"><button className="admin-back" onClick={() => openUser("inicio")}>← Área do aluno</button><h2>Painel administrativo</h2><small>Gestão do acervo</small>{[["overview", "Visão geral"], ["cadastro", "Cadastro"], ["questoes", "Questões"]].map(([id, label]) => <button key={id} className={adminTab === id ? "active" : ""} onClick={() => setAdminTab(id)}>{label}</button>)}</aside><div className="admin-content">{adminTab === "overview" && <AdminOverview questions={questions} supabase={supabase} />}{adminTab === "cadastro" && cadastroContent}{adminTab === "questoes" && <QuestionLibrary questions={questions} remove={remove} toggleHidden={toggleHidden} updateQuestion={updateQuestion} />}</div></section> : <section className="card"><h2>Acesso restrito</h2><p>Esta área é exclusiva para administradores.</p><button onClick={() => openUser("inicio")}>Voltar ao início</button></section>}
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
    <div className="auth card">
      <h1>Caderno de Questões</h1>
      <p>Entre ou crie sua conta.</p>
      <input
        type="email"
        placeholder="E-mail"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <input
        type="password"
        placeholder="Senha"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <button disabled={busy} onClick={() => act("login")}>
        Entrar
      </button>
      <button className="light" disabled={busy} onClick={() => act("signup")}>
        Criar conta
      </button>
      {msg && <p>{msg}</p>}
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
function UserHome({ questions, userId, email, supabase, goStudy }) {
  const answers = useAnswerHistory(supabase, userId);
  const completedCycles = useCompletedCycles(supabase, userId);
  const metrics = answerMetrics(answers, questions);
  const name = String(email || "").toLowerCase() === "pfarolfe@gmail.com" ? "Pedro" : (String(email || "estudante").split("@")[0].split(/[._-]/)[0] || "estudante");
  const last = answers.at(-1)?.answered_at ? new Date(answers.at(-1).answered_at).toLocaleDateString("pt-BR") : "Ainda não houve atividade";
  return <section className="user-home">
    <div className="home-hero"><div><span className="eyebrow">SEU ESPAÇO DE ESTUDOS</span><h1>{greetingName()}, {name} <span aria-hidden="true">👋</span></h1><p>Vamos continuar de onde você parou?</p></div><button onClick={goStudy}>Continuar estudos <span>→</span></button><div className="hero-icon">⌁</div></div>
    <div className="metric-grid"><MetricCard label="Questões respondidas" value={metrics.total} icon="◉" /><MetricCard label="Taxa de acertos" value={`${metrics.rate}%`} icon="✓" /><MetricCard label="Ciclos concluídos" value={completedCycles} icon="◌" /><MetricCard label="Sequência de estudos" value={`${metrics.streak} dia${metrics.streak === 1 ? "" : "s"}`} icon="↗" /></div>
    <div className="home-grid"><section className="card continue-card"><span className="eyebrow">CONTINUAR ESTUDANDO</span><h2>{metrics.total ? "Seu próximo ciclo está pronto" : "Inicie seu primeiro ciclo"}</h2><div className="continue-info"><span>Última atividade: {last}</span><span>{metrics.total ? `${metrics.recentRate}% de acertos recentes` : "Escolha uma disciplina e comece"}</span></div><button onClick={goStudy}>{metrics.total ? "Continuar ciclo" : "Novo ciclo"}</button></section><section className="card performance-card"><span className="eyebrow">SEU DESEMPENHO</span><h2>Histórico recente</h2><MiniChart answers={metrics.days} /><div className="performance-lines"><span>Melhor disciplina <b>{metrics.best?.name || "—"}</b></span><span>Média recente <b>{metrics.recentRate}%</b></span></div></section></div>
    <section className="focus-home"><div><span>◎</span><div><b>FOCO RECOMENDADO</b><p>{metrics.focus ? `${metrics.focus.name}: aproveite para revisar esta disciplina, onde sua taxa está em ${metrics.focus.rate}%.` : "Resolva algumas questões para receber uma recomendação personalizada."}</p></div></div><button className="light" onClick={goStudy}>Revisar agora</button></section>
  </section>;
}
function MetricCard({ label, value, icon }) { return <article className="metric-card"><span>{icon}</span><small>{label}</small><b>{value}</b></article>; }
function MiniChart({ answers }) { const points = answers.map((a, i) => `${i * 28 + 8},${a.is_correct ? 12 : 52}`).join(" "); return <svg className="mini-chart" viewBox="0 0 190 65" role="img" aria-label="Evolução recente"><path d="M4 57H186" stroke="#e3e9f5" /><polyline points={points || "8,52 180,52"} fill="none" stroke="#1463df" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>; }
function Performance({ questions, userId, supabase, goStudy }) { const answers = useAnswerHistory(supabase, userId); const metrics = answerMetrics(answers, questions); return <section className="card performance-page"><span className="eyebrow">DESEMPENHO</span><h1>Seu progresso</h1><p>Os dados abaixo são calculados a partir das suas respostas registradas.</p><div className="metric-grid"><MetricCard label="Respondidas" value={metrics.total} icon="◉" /><MetricCard label="Acertos" value={metrics.correct} icon="✓" /><MetricCard label="Taxa geral" value={`${metrics.rate}%`} icon="↗" /><MetricCard label="Média recente" value={`${metrics.recentRate}%`} icon="◌" /></div><h2>Evolução recente</h2><MiniChart answers={metrics.days} /><div className="performance-lines"><span>Melhor disciplina <b>{metrics.best?.name || "—"}</b></span><span>Disciplina que merece atenção <b>{metrics.focus?.name || "—"}</b></span></div><button onClick={goStudy}>Voltar aos estudos</button></section>; }
function AdminOverview({ questions, supabase }) { const [userCount, setUserCount] = React.useState(null); React.useEffect(() => { supabase.from("profiles").select("id", { count: "exact", head: true }).then(({ count }) => setUserCount(count ?? 0)); }, [supabase]); const visible = questions.filter((q) => !q.is_hidden).length; const disciplines = new Set(questions.map((q) => q.discipline).filter(Boolean)).size; const boards = new Set(questions.map((q) => q.banca).filter(Boolean)).size; return <section className="admin-overview"><div><span className="eyebrow">PAINEL ADMINISTRATIVO</span><h1>Visão geral</h1><p>Dados reais do acervo disponível no sistema.</p></div><div className="metric-grid admin-metrics"><MetricCard label="Questões cadastradas" value={questions.length} icon="▤" /><MetricCard label="Questões visíveis" value={visible} icon="◉" /><MetricCard label="Questões ocultas" value={questions.length - visible} icon="◌" /><MetricCard label="Disciplinas" value={disciplines} icon="▥" /><MetricCard label="Bancas" value={boards} icon="◈" /><MetricCard label="Usuários cadastrados" value={userCount == null ? "…" : userCount} icon="◉" /></div></section>; }

function QuestionLibrary({ questions, remove, toggleHidden, updateQuestion }) {
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
  const disciplines = [...new Set(questions.map((q) => q.discipline).filter(Boolean))].sort();
  const subjects = subjectOptions(questions);
  const boards = [...new Set(questions.map((q) => q.banca).filter(Boolean))].sort();
  const years = [...new Set(questions.map((q) => q.ano).filter(Boolean))].sort((a, b) => b - a);
  const contests = [...new Set(questions.map((q) => q.concurso).filter(Boolean))].sort();
  const filteredQuestions = questions.filter((q) => {
    const searchable = `${q.id} ${q.statement} ${q.discipline || ""} ${q.subject || ""}`.toLowerCase();
    return (!search || searchable.includes(search.toLowerCase())) &&
      (!disciplineFilter || q.discipline === disciplineFilter) &&
      hasSubject(q, subjectFilter) &&
      (!difficultyFilter || (q.difficulty_current || q.difficulty_initial || "media") === difficultyFilter) &&
      (!boardFilter || q.banca === boardFilter) && (!yearFilter || String(q.ano) === yearFilter) && (!contestFilter || q.concurso === contestFilter) &&
      (visibilityFilter === "all" || (visibilityFilter === "visible" ? !q.is_hidden : q.is_hidden));
  });
  const startEdit = (q) => {
    setEditingId(q.id);
    setDraft({ ...q, alternatives: (q.alternatives || []).map((a) => ({ ...a })) });
  };
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
      <div className="library-filters">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por texto ou ID" />
        <select value={disciplineFilter} onChange={(e) => { setDisciplineFilter(e.target.value); setSubjectFilter(""); }}><option value="">Todas as disciplinas</option>{disciplines.map((x) => <option key={x}>{x}</option>)}</select>
        <select value={subjectFilter} onChange={(e) => setSubjectFilter(e.target.value)}><option value="">Todos os assuntos</option>{subjects.filter((x) => !disciplineFilter || questions.some((q) => q.discipline === disciplineFilter && hasSubject(q, x))).map((x) => <option key={x}>{x}</option>)}</select>
        <select value={difficultyFilter} onChange={(e) => setDifficultyFilter(e.target.value)}><option value="">Todas as dificuldades</option><option value="facil">Fácil</option><option value="media">Média</option><option value="dificil">Difícil</option></select>
        <select value={visibilityFilter} onChange={(e) => setVisibilityFilter(e.target.value)}><option value="all">Visíveis e ocultas</option><option value="visible">Somente visíveis</option><option value="hidden">Somente ocultas</option></select>
        <button className="light compact more-filters" onClick={() => setShowMoreFilters((value) => !value)}>{showMoreFilters ? "Menos filtros" : "Mais filtros"}</button>
      </div>
      {showMoreFilters && <div className="library-filters more-filter-row"><select value={boardFilter} onChange={(e) => setBoardFilter(e.target.value)}><option value="">Todas as bancas</option>{boards.map((x) => <option key={x}>{x}</option>)}</select><select value={yearFilter} onChange={(e) => setYearFilter(e.target.value)}><option value="">Todos os anos</option>{years.map((x) => <option key={x}>{x}</option>)}</select><select value={contestFilter} onChange={(e) => setContestFilter(e.target.value)}><option value="">Todos os concursos</option>{contests.map((x) => <option key={x}>{x}</option>)}</select></div>}
      {!questions.length ? <div className="card"><p>Nenhuma questão cadastrada.</p></div> : !filteredQuestions.length ? <div className="card"><p>Nenhuma questão encontrada com esses filtros.</p></div> : <div className="question-grid">
        {filteredQuestions.map((q) => <article className={`question-card ${q.is_hidden ? "hidden-card" : ""}`} key={q.id}>
          <div className="card-top"><span className="question-id">ID {String(q.id).slice(0, 8)}</span><span className={`difficulty ${q.difficulty_current || q.difficulty_initial || "media"}`}>{q.difficulty_current || q.difficulty_initial || "media"}</span></div>
          <h3>{q.discipline || "Sem disciplina"}</h3>
          <p className="question-subject">{q.subject || "Sem assunto"}</p>
          <p className="question-preview">{q.statement}</p>
          <div className="card-meta"><span>Gabarito: {q.correct_option === "*" ? "Anulada" : q.correct_option}</span>{(q.banca || q.ano || q.concurso) && <span className="question-origin">{q.banca && `Banca: ${q.banca}`}{q.ano && ` · Ano: ${q.ano}`}{q.concurso && ` · Concurso: ${q.concurso}`}</span>}{q.is_hidden && <span className="hidden-label">Oculta dos estudos</span>}</div>
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
function BatchReview({ drafts, setDrafts, questions, busy, analyzeSelected, saveBatch, deleteSelected, applyBulk }) {
  const [bulkDiscipline, setBulkDiscipline] = React.useState("");
  const [bulkSubject, setBulkSubject] = React.useState("");
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
function Study({ questions, supabase, userId }) {
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
createRoot(document.getElementById("root")).render(<App />);

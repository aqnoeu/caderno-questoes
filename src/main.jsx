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
function parseQuestions(text) {
  const clean = text.replace(/\r/g, "").trim(),
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
    [tab, setTab] = React.useState("cadastro"),
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
  if (session === undefined) return <div className="center">Carregando…</div>;
  if (!session) return <Auth />;
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
    try {
      for (let start = 0; start < targets.length; start += 10) {
        const group = targets.slice(start, start + 10);
        setNotice(`Analisando com IA: ${done}/${targets.length} concluída(s)…`);
        const { data, error } = await supabase.functions.invoke("analyze-questions", {
          body: {
            questions: group.map((q, index) => ({
              index,
              statement: q.statement,
              alternatives: Object.fromEntries(q.alternatives.map((a) => [a.letter, a.text])),
              correct_option: q.correct_option,
            })),
          },
        });
        if (error) throw error;
        const byIndex = new Map((data?.results || []).map((r) => [r.index, r]));
        setDrafts((ds) => ds.map((q) => {
          const localIndex = group.findIndex((g) => g.tempId === q.tempId);
          if (localIndex < 0) return q;
          const result = byIndex.get(localIndex);
          return result ? {
            ...q,
            discipline: result.discipline || q.discipline,
            subject: result.subject || q.subject,
            explanation: result.explanation || q.explanation,
            difficulty_initial: result.difficulty || "media",
            difficulty_current: result.difficulty || "media",
            ai_confidence: Math.max(0, Math.min(1, Number(result.confidence) || 0)),
            ai_analyzed_at: new Date().toISOString(),
            aiStatus: "analyzed",
          } : { ...q, aiStatus: "error" };
        }));
        done += group.length;
      }
      setNotice(`${done} questão(ões) analisada(s) pela IA. Revise antes de salvar.`);
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
      subject: q.subject?.trim() || null,
      explanation: q.explanation?.trim() || null,
      normalized_statement: normalize(q.statement),
      original_number: q.original_number || null,
      is_annulled: Boolean(q.is_annulled),
      difficulty_initial: q.difficulty_initial || "media",
      difficulty_current: q.difficulty_current || q.difficulty_initial || "media",
      ai_confidence: q.ai_confidence,
      ai_analyzed_at: q.ai_analyzed_at,
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
      subject: subject || q.subject,
    } : q));
    setNotice("Disciplina/assunto aplicados às questões selecionadas.");
  }
  async function remove(id) {
    if (!confirm("Excluir esta questão?")) return;
    const { error } = await supabase.from("questions").delete().eq("id", id);
    if (error) setNotice(error.message);
    else load();
  }
  return (
    <main>
      <header>
        <div>
          <h1>Caderno de Questões</h1>
          <small>{session.user.email}</small>
        </div>
        <button className="light" onClick={() => supabase.auth.signOut()}>
          Sair
        </button>
      </header>
      <nav>
        {[
          ["cadastro", "Cadastro"],
          ["questoes", `Questões (${questions.length})`],
          ["estudos", "Estudos"],
        ].map(([id, l]) => (
          <button
            className={tab === id ? "active" : ""}
            onClick={() => setTab(id)}
            key={id}
          >
            {l}
          </button>
        ))}
      </nav>
      {notice && (
        <div className="notice">
          {notice}
          <button onClick={() => setNotice("")}>×</button>
        </div>
      )}
      {tab === "cadastro" && (
        <section>
          <div className="steps" aria-label="Etapas do cadastro">
            <div className={`step ${!drafts.length ? "active" : "done"}`}><span>1</span><div><b>Importar prova</b><small>PDF ou texto</small></div></div>
            <div className={`step ${drafts.length && !answerKey ? "active" : answerKey ? "done" : ""}`}><span>2</span><div><b>Aplicar gabarito</b><small>Respostas em lote</small></div></div>
            <div className={`step ${drafts.length && answerKey ? "active" : ""}`}><span>3</span><div><b>Analisar e revisar</b><small>IA em lotes de 10</small></div></div>
            <div className={`step ${drafts.some((q) => q.aiStatus === "analyzed") ? "active" : ""}`}><span>4</span><div><b>Salvar questões</b><small>Somente após revisão</small></div></div>
          </div>
          <div className="card">
            <h2>Importar prova</h2>
            <p>O PDF é lido no navegador e não é armazenado.</p>
            <label className="drop">
              {busy ? "Processando…" : "Selecionar PDF"}
              <input
                hidden
                type="file"
                accept="application/pdf"
                onChange={(e) =>
                  e.target.files[0] && readPdf(e.target.files[0])
                }
              />
            </label>
            <div className="sep">ou cole o texto</div>
            <textarea
              rows="9"
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              placeholder={"1. Enunciado…\nA) Alternativa…"}
            />
            <button disabled={busy} onClick={process}>Separar questões</button>
            <div className="answer-key">
              <h3>Aplicar gabarito</h3>
              <p>
                Cole o gabarito após separar as questões. Use * ou X para anuladas.
              </p>
              <textarea
                rows="4"
                value={answerKey}
                onChange={(e) => setAnswerKey(e.target.value)}
                placeholder="1 D 2 B 3 E 4 * 5 A"
              />
              <button type="button" onClick={applyAnswerKey}>
                Preencher respostas corretas
              </button>
            </div>
          </div>
          {drafts.length > 0 && (
            <BatchReview
              drafts={drafts}
              setDrafts={setDrafts}
              questions={questions}
              busy={busy}
              analyzeSelected={analyzeSelected}
              saveBatch={saveBatch}
              deleteSelected={deleteSelected}
              applyBulk={applyBulk}
            />
          )}
        </section>
      )}
      {tab === "questoes" && (
        <section className="card">
          <h2>Questões cadastradas</h2>
          {!questions.length ? (
            <p>Nenhuma questão cadastrada.</p>
          ) : (
            questions.map((q, i) => (
              <article className="item" key={q.id}>
                <div>
                  <b>
                    {i + 1}. {q.statement}
                  </b>
                  <small>
                    {q.discipline || "Sem disciplina"} ·{" "}
                    {q.subject || "Sem assunto"} · Gabarito{" "}
                    {q.correct_option === "*" ? "Anulada" : q.correct_option}
                  </small>
                </div>
                <button className="danger" onClick={() => remove(q.id)}>
                  Excluir
                </button>
              </article>
            ))
          )}
        </section>
      )}
      {tab === "estudos" && (
        <Study
          questions={questions}
          supabase={supabase}
          userId={session.user.id}
        />
      )}
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
function BatchReview({ drafts, setDrafts, questions, busy, analyzeSelected, saveBatch, deleteSelected, applyBulk }) {
  const [bulkDiscipline, setBulkDiscipline] = React.useState("");
  const [bulkSubject, setBulkSubject] = React.useState("");
  const disciplines = [...new Set(questions.map((q) => q.discipline).filter(Boolean))].sort();
  const subjects = [...new Set(questions.map((q) => q.subject).filter(Boolean))].sort();
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
        <input list="saved-subjects" placeholder="Assunto para selecionadas" value={bulkSubject} onChange={(e) => setBulkSubject(e.target.value)} />
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
    subjects = [
      ...new Set(
        questions
          .filter((x) => !q.discipline || x.discipline === q.discipline)
          .map((x) => x.subject)
          .filter(Boolean),
      ),
    ].sort();
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
            placeholder="Assunto"
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
function Study({ questions, supabase, userId }) {
  const [discipline, setDiscipline] = React.useState(""),
    [subject, setSubject] = React.useState(""),
    [cycle, setCycle] = React.useState([]),
    [remaining, setRemaining] = React.useState([]),
    [status, setStatus] = React.useState([]),
    [pos, setPos] = React.useState(0),
    [choice, setChoice] = React.useState(""),
    [checked, setChecked] = React.useState(false),
    [finished, setFinished] = React.useState(false),
    [celebration, setCelebration] = React.useState(false);
  const pool = questions.filter(
    (q) =>
      !q.is_annulled && q.correct_option !== "*" &&
      (!discipline || q.discipline === discipline) &&
      (!subject || q.subject === subject),
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
  }, []);
  React.useEffect(() => {
    begin(pool, []);
  }, [questions, discipline, subject]);
  const q = cycle[pos];
  function advance() {
    if (pos + 1 >= cycle.length) setFinished(true);
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
  return (
    <section className="study-wrap">
      {celebration && <div className="celebration" role="status"><span>★</span><b>Excelente!</b><small>Você acertou uma questão difícil.</small></div>}
      <div className="card study">
        <div className="cols">
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
            {[...new Set(questions.map((x) => x.subject).filter(Boolean))].map(
              (x) => (
                <option key={x}>{x}</option>
              ),
            )}
          </select>
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
              <div className="cycle-label">
                Ciclo de {cycle.length} questões · Dificuldade {q.difficulty_current || "media"}
              </div>
              <h2>{q.statement}</h2>
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
                    Pular questão
                  </button>
                )}
                <button
                  disabled={!checked && !choice}
                  onClick={checked ? advance : correct}
                >
                  {checked ? "Próxima" : "Corrigir"}
                </button>
              </div>
            </>
          )
        )}
      </div>
      {cycle.length > 0 && (
        <aside className="progress-dots" aria-label="Progresso do ciclo">
          {status.map((state, i) => (
            <span
              key={i}
              className={`dot ${state || "pending"} ${!finished && i === pos ? "current" : ""}`}
              title={
                state === "correct"
                  ? "Correta"
                  : state === "wrong"
                    ? "Errada"
                    : state === "skipped"
                      ? "Pulada"
                      : "Não respondida"
              }
            />
          ))}
        </aside>
      )}
    </section>
  );
}
createRoot(document.getElementById("root")).render(<App />);

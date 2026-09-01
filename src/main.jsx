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
    const q = parseQuestions(raw).map((item) => ({
      ...item,
      ...autoClassify(item.statement, questions),
    }));
    setDrafts(q);
    setNotice(
      q.length
        ? `${q.length} questão(ões) identificadas e classificadas. Revise antes de salvar.`
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
        return { ...item, correct_option };
      }),
    );
    setNotice(
      `${applied} resposta(s) aplicada(s), incluindo ${annulled} questão(ões) anulada(s). Revise antes de salvar.`,
    );
  }
  async function save(q, force = false) {
    if (!q.correct_option)
      return setNotice("Selecione o gabarito antes de salvar.");
    const hit = questions
      .map((x) => ({ x, s: similarity(q.statement, x.statement) }))
      .sort((a, b) => b.s - a.s)[0];
    if (
      hit?.s >= 0.62 &&
      !force &&
      !confirm(
        `Possível duplicidade (${Math.round(hit.s * 100)}% semelhante):\n\n${hit.x.statement}\n\nDeseja salvar mesmo assim?`,
      )
    )
      return;
    const payload = {
      user_id: session.user.id,
      statement: q.statement,
      alternatives: q.alternatives,
      correct_option: q.correct_option,
      discipline: q.discipline || null,
      subject: q.subject || null,
      explanation: q.explanation || null,
      normalized_statement: normalize(q.statement),
      original_number: q.original_number || null,
    };
    const { error } = await supabase.from("questions").insert(payload);
    if (error) setNotice(error.message);
    else {
      setDrafts((d) => d.filter((x) => x.tempId !== q.tempId));
      setNotice("Questão salva.");
      load();
    }
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
            <button onClick={process}>Separar questões</button>
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
          {drafts.map((q, i) => (
            <Editor
              key={q.tempId}
              q={q}
              index={i}
              setDrafts={setDrafts}
              save={save}
              questions={questions}
            />
          ))}
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
function Editor({ q, index, setDrafts, save, questions }) {
  const patch = (key, value) =>
    setDrafts((ds) =>
      ds.map((x) => (x.tempId === q.tempId ? { ...x, [key]: value } : x)),
    );
  const alt = (letter, text) =>
    patch(
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
  function classify() {
    const result = autoClassify(q.statement, questions);
    setDrafts((ds) =>
      ds.map((x) => (x.tempId === q.tempId ? { ...x, ...result } : x)),
    );
  }
  return (
    <article className="card editor">
      <h3>Questão {q.original_number || index + 1}</h3>
      <textarea
        rows="4"
        value={q.statement}
        onChange={(e) => patch("statement", e.target.value)}
      />
      {q.alternatives.map((a) => (
        <label className="alt" key={a.letter}>
          <input
            type="radio"
            name={q.tempId}
            checked={q.correct_option === a.letter}
            onChange={() => patch("correct_option", a.letter)}
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
        onClick={() => patch("correct_option", q.correct_option === "*" ? "" : "*")}
      >
        {q.correct_option === "*" ? "Questão anulada" : "Marcar como anulada"}
      </button>
      <div className="cols">
        <div>
          <input
            list={`disciplines-${q.tempId}`}
            placeholder="Disciplina"
            value={q.discipline}
            onChange={(e) => patch("discipline", e.target.value)}
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
            onChange={(e) => patch("subject", e.target.value)}
          />
          <datalist id={`subjects-${q.tempId}`}>
            {subjects.map((x) => (
              <option value={x} key={x} />
            ))}
          </datalist>
        </div>
      </div>
      <button type="button" className="light classify" onClick={classify}>
        Classificar automaticamente
      </button>
      <textarea
        rows="2"
        placeholder="Comentário (opcional)"
        value={q.explanation}
        onChange={(e) => patch("explanation", e.target.value)}
      />
      <button onClick={() => save(q)}>Salvar questão</button>
    </article>
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
    [finished, setFinished] = React.useState(false);
  const pool = questions.filter(
    (q) =>
      q.correct_option !== "*" &&
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
    await supabase
      .from("answers")
      .insert({
        user_id: userId,
        question_id: q.id,
        selected_option: choice,
        is_correct: isCorrect,
      });
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
                Ciclo de {cycle.length} questões
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

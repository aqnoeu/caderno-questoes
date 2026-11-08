import React from "react";

async function requestRevenge(supabase, notebookId, cycleId, action, extra = {}) {
  const { data, error } = await supabase.functions.invoke("revenge-mode", {
    body: { action, notebook_id: notebookId, cycle_id: cycleId, ...extra },
  });
  if (error) throw Error(data?.error || error.message || "Não foi possível contactar o servidor.");
  if (data?.error) throw Error(data.error);
  return data;
}
export function RevengeMode({ supabase, userId, notebookId, initialCycleId, onBack }) {
  const [cycles, setCycles] = React.useState([]);
  const [history, setHistory] = React.useState([]);
  const [session, setSession] = React.useState(null);
  const [cycleId, setCycleId] = React.useState(initialCycleId || "");
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState(null);
  const [message, setMessage] = React.useState("");
  const [showMascot, setShowMascot] = React.useState(
    () => localStorage.getItem("revenge-mascot-" + userId) !== "off",
  );
  const [selected, setSelected] = React.useState(null);
  const readHistory = React.useCallback(async () => {
    const [{ data: rows, error }, log] = await Promise.all([
      supabase
        .from("study_cycles")
        .select(
          "id,completed_at,question_ids,progress,concurso,banca,ano,correct_count,wrong_count",
        )
        .eq("user_id", userId)
        .eq("notebook_id", notebookId)
        .not("completed_at", "is", null)
        .order("completed_at", { ascending: false })
        .limit(50),
      requestRevenge(supabase, notebookId, null, "history"),
    ]);
    if (error) throw error;
    setCycles((rows || []).filter((row) => row.progress?.includes("wrong")));
    setHistory(log.sessions || []);
  }, [supabase, userId, notebookId]);
  React.useEffect(() => {
    let alive = true;
    readHistory().catch((error) => {
      if (alive) setMessage(error.message);
    });
    return () => {
      alive = false;
    };
  }, [readHistory]);
  React.useEffect(() => {
    if (!initialCycleId) {
      setCycleId("");
      setSession(null);
      setResult(null);
      return;
    }
    let alive = true;
    setCycleId(initialCycleId);
    setSession(null);
    setResult(null);
    requestRevenge(supabase, notebookId, initialCycleId, "state")
      .then((data) => {
        if (alive) setSession(data);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [initialCycleId, notebookId, supabase]);
  async function doAction(action, extra = {}) {
    if (busy || !cycleId) return;
    setBusy(true);
    setMessage("");
    try {
      const data = await requestRevenge(supabase, notebookId, cycleId, action, extra);
      if (action === "answer") {
        setResult(data);
        setSelected(null);
      } else {
        setSession(data);
        setResult(null);
        setSelected(null);
      }
      if (action === "start" || (action === "answer" && data.finished)) await readHistory();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }
  function changeMascot() {
    setShowMascot((old) => {
      localStorage.setItem("revenge-mascot-" + userId, old ? "off" : "on");
      return !old;
    });
  }
  const active = cycles.find((x) => x.id === cycleId),
    archived = history.find((x) => x.cycle_id === cycleId);
  const errors =
    active?.progress?.filter((x) => x === "wrong").length || session?.total_errors || 0;
  return (
    <section className="revenge-page">
      <div className="revenge-head">
        <div>
          <span className="eyebrow">MODO REVANCHE · V64</span>
          <h1>Uma segunda chance para aprender</h1>
          <p>Enfrente o raciocínio que levou ao erro, sem alterar a nota do ciclo original.</p>
        </div>
        <label className="revenge-toggle">
          <input type="checkbox" checked={showMascot} onChange={changeMascot} /> Mascote ativado
        </label>
      </div>
      {showMascot && (
        <div className="revenge-mascot" aria-live="polite">
          <span className="revenge-mascot-face" aria-hidden="true">
            📘
          </span>
          <p>
            {busy ? (
              <>
                <span className="revenge-typing">
                  O Caderno está pensando<span>…</span>
                </span>
              </>
            ) : session?.state === "completed" ? (
              session.perfect ? (
                "Essa foi impecável! Eu nem consegui te pegar. 😎"
              ) : (
                "A revanche acabou. O importante é saber por que errou."
              )
            ) : result?.correct ? (
              "Boa! Agora você pegou a ideia."
            ) : result?.advanced ? (
              "Não foi dessa vez, mas o assunto já ficou mais claro."
            ) : session ? (
              "Eu trouxe outra forma de olhar para o seu erro. Vamos ver se você aprendeu?"
            ) : (
              "Errar faz parte. Continuar errando sem revisar é que não vale, hein? 😏"
            )}
          </p>
        </div>
      )}
      {message && (
        <p className="form-message" role="alert">
          {message}
        </p>
      )}
      {!session && (
        <div className="card revenge-picker">
          <h2>Escolha um ciclo concluído</h2>
          <p>Os ciclos com erros ficam disponíveis para uma Revanche, inclusive pelo histórico.</p>
          {cycles.length === 0 ? (
            <p>Não há ciclos concluídos com erros neste caderno.</p>
          ) : (
            <div className="revenge-cycle-list">
              {cycles.map((cycle, index) => {
                const saved = history.find((x) => x.cycle_id === cycle.id);
                const wrong = cycle.progress?.filter((x) => x === "wrong").length || 0;
                return (
                  <button
                    type="button"
                    className={"revenge-cycle" + (cycleId === cycle.id ? " active" : "")}
                    key={cycle.id}
                    onClick={() => {
                      setCycleId(cycle.id);
                      setResult(null);
                      setMessage("");
                      setSession(null);
                    }}
                  >
                    <span>
                      <b>{cycle.concurso || "Ciclo de estudos"}</b>
                      <small>
                        {new Date(cycle.completed_at).toLocaleDateString("pt-BR")} · {wrong} erro(s)
                        · {cycle.banca || "Questões"}
                      </small>
                    </span>
                    <span>
                      {saved?.state === "completed" ? "Concluída" : saved ? "Continuar" : "Iniciar"}{" "}
                      ›
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          {cycleId && (
            <button disabled={busy} onClick={() => doAction(archived ? "state" : "start")}>
              {busy ? "Preparando…" : archived ? "Abrir Revanche" : "Começar Revanche"}
            </button>
          )}
        </div>
      )}
      {session && (
        <div className="card revenge-card">
          <div className="revenge-status">
            <span>
              Questões superadas: {session.mastered_count} de {session.total_errors}
            </span>
            <span>
              {session.state === "completed"
                ? "Concluída"
                : session.completed_errors + 1 + " de " + session.total_errors}
            </span>
          </div>
          <div className="revenge-progress">
            <span
              style={{ width: (session.completed_errors / session.total_errors) * 100 + "%" }}
            />
          </div>
          {session.state === "completed" ? (
            <>
              <h2>{session.perfect ? "Revanche perfeita! 🏆" : "Revanche concluída"}</h2>
              <p>
                {session.mastered_count} de {session.total_errors} erro(s) superado(s).{" "}
                {session.perfect
                  ? "Conquista: 100% na Revanche."
                  : "Os temas que não foram superados continuam disponíveis para revisão no estudo original."}
              </p>
              <p>
                <small>
                  O aproveitamento e a pontuação do ciclo original não foram modificados.
                </small>
              </p>
              <div className="revenge-actions">
                <button
                  onClick={() => {
                    setSession(null);
                    setCycleId("");
                    setResult(null);
                  }}
                >
                  Ver histórico de ciclos
                </button>
                <button className="light" onClick={onBack}>
                  Voltar aos estudos
                </button>
              </div>
            </>
          ) : (
            <>
              <span className="eyebrow">
                VERDADEIRO OU FALSO · {session.current?.attempt_number || 1}ª AFIRMAÇÃO
              </span>
              {!session.current?.ready ? (
                <>
                  <h2>Preparar o desafio</h2>
                  <p>
                    O Groq cria duas afirmações sobre o erro desta questão; o Gemini confere a
                    consistência jurídica antes de você responder.
                  </p>
                  <button onClick={() => doAction("generate")} disabled={busy}>
                    {busy ? "Gerando e verificando…" : "Gerar duas afirmações"}
                  </button>
                </>
              ) : (
                <>
                  <h2>{session.current.statement}</h2>
                  <div className="revenge-options">
                    <button
                      disabled={busy || !!result}
                      className={selected === true ? "selected" : ""}
                      onClick={() => setSelected(true)}
                    >
                      Verdadeiro
                    </button>
                    <button
                      disabled={busy || !!result}
                      className={selected === false ? "selected" : ""}
                      onClick={() => setSelected(false)}
                    >
                      Falso
                    </button>
                  </div>
                  {!result && (
                    <button
                      disabled={busy || selected === null}
                      onClick={() => doAction("answer", { answer: selected })}
                    >
                      {busy ? "Corrigindo…" : "Conferir resposta"}
                    </button>
                  )}
                  {result && (
                    <div className={"revenge-feedback " + (result.correct ? "correct" : "wrong")}>
                      <strong>
                        {result.correct
                          ? "Você acertou!"
                          : result.advanced
                            ? "As duas tentativas terminaram."
                            : "Essa não foi. Você ainda tem mais uma chance."}
                      </strong>
                      <p>{result.feedback}</p>
                      <button onClick={() => doAction("state")} disabled={busy}>
                        {busy
                          ? "Carregando…"
                          : result.finished
                            ? "Ver resultado final"
                            : result.advanced
                              ? "Próximo erro"
                              : "Segunda afirmação"}
                      </button>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      )}
      <p className="revenge-disclaimer">
        As afirmações passam por verificação de IA, que pode cometer erros. Confira os fundamentos
        jurídicos em caso de dúvida.
      </p>
    </section>
  );
}

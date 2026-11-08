import React from "react";

async function requestRevenge(supabase, notebookId, cycleId, action, extra = {}) {
  const { data, error } = await supabase.functions.invoke("revenge-mode", {
    body: { action, notebook_id: notebookId, cycle_id: cycleId, ...extra },
  });
  if (error) {
    let detail = data?.error;
    if (!detail && error.context) {
      try {
        const response =
          typeof error.context.clone === "function" ? error.context.clone() : error.context;
        const payload = await response.json();
        detail = payload.error || payload.message;
      } catch {
        // Falha de rede ou resposta não JSON: manter mensagem legível.
      }
    }
    throw new Error(
      detail || "Não foi possível conversar com o Caderno. Verifique a conexão e tente novamente.",
    );
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

function ChatBubble({ message, showAvatar, mascot }) {
  return (
    <div className={"revenge-message revenge-message-" + message.role}>
      {message.role === "bot" && showAvatar && (
        <img className="revenge-avatar" src={mascot} alt="Caderno, mascote do aplicativo" />
      )}
      <div className="revenge-bubble">
        {message.title && <strong>{message.title}</strong>}
        <span>{message.text}</span>
      </div>
    </div>
  );
}

function TypingBubble({ showAvatar, mascot }) {
  return (
    <div className="revenge-message revenge-message-bot" aria-label="Caderno está digitando">
      {showAvatar && <img className="revenge-avatar" src={mascot} alt="" />}
      <div className="revenge-bubble revenge-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
    </div>
  );
}

function Dialogue({ messages, phaseKey, groupKey, busy, mascotEnabled, children }) {
  const [transcript, setTranscript] = React.useState([]);
  const [shown, setShown] = React.useState(0);
  const groupRef = React.useRef(null);
  const threadRef = React.useRef(null);
  React.useEffect(() => {
    if (groupRef.current !== groupKey) {
      groupRef.current = groupKey;
      setTranscript(messages);
      setShown(0);
    } else {
      setTranscript((old) => [...old, ...messages]);
    }
  }, [phaseKey, groupKey]);
  React.useEffect(() => {
    if (shown >= transcript.length) return undefined;
    const timer = window.setTimeout(() => setShown((old) => Math.min(old + 1, transcript.length)), shown === 0 ? 180 : 680);
    return () => window.clearTimeout(timer);
  }, [shown, transcript.length]);
  React.useEffect(() => {
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [shown, busy, phaseKey]);
  const fullyShown = shown >= transcript.length;
  return (
    <section className="revenge-chat">
      <header className="revenge-chat-header">
        {mascotEnabled && <img className="revenge-header-avatar" src="/mascote-caderno.webp" alt="" />}
        <div><strong>Caderno</strong><small>Seu parceiro de estudos · Revanche</small></div>
        <span className="revenge-online" title="Modo Revanche ativo" />
      </header>
      <div className="revenge-chat-thread" ref={threadRef} aria-live="polite" aria-relevant="additions text">
        {transcript.slice(0, shown).map((message, i) => (
          <ChatBubble key={groupKey + "-" + i} message={message}
            mascot="/mascote-caderno.webp" showAvatar={mascotEnabled} />
        ))}
        {(!fullyShown || busy) && <TypingBubble showAvatar={mascotEnabled} mascot="/mascote-caderno.webp" />}
      </div>
      {fullyShown && !busy && <footer className="revenge-chat-footer">{children}</footer>}
      {busy && <footer className="revenge-chat-footer revenge-chat-wait">O Caderno está preparando seu desafio…</footer>}
    </section>
  );
}

export function RevengeMode({ supabase, userId, notebookId, initialCycleId, onBack }) {
  const [cycles, setCycles] = React.useState([]);
  const [history, setHistory] = React.useState([]);
  const [session, setSession] = React.useState(null);
  const [cycleId, setCycleId] = React.useState(initialCycleId || "");
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState(null);
  const [lastAnswer, setLastAnswer] = React.useState(null);
  const [preparedChallenge, setPreparedChallenge] = React.useState(null);
  const [preparingChallenge, setPreparingChallenge] = React.useState(false);
  const [prepareError, setPrepareError] = React.useState("");
  const [prepareRetry, setPrepareRetry] = React.useState(0);
  const [reviewedQuestionId, setReviewedQuestionId] = React.useState("");
  const [replay, setReplay] = React.useState(0);
  const [message, setMessage] = React.useState("");
  const [showMascot, setShowMascot] = React.useState(
    () => localStorage.getItem("revenge-mascot-" + userId) !== "off",
  );

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
    let active = true;
    readHistory().catch((e) => {
      if (active) setMessage(e.message);
    });
    return () => {
      active = false;
    };
  }, [readHistory]);
  React.useEffect(() => {
    if (!initialCycleId) {
      setSession(null);
      setCycleId("");
      setResult(null);
      return;
    }
    let active = true;
    setSession(null);
    setCycleId(initialCycleId);
    setResult(null);
    requestRevenge(supabase, notebookId, initialCycleId, "state")
      .then((data) => {
        if (active) setSession(data);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [initialCycleId, notebookId, supabase]);

  async function doAction(action, extra = {}) {
    if (busy || !cycleId) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await requestRevenge(supabase, notebookId, cycleId, action, extra);
      if (action === "answer") {
        setLastAnswer(extra.answer);
        setResult(response);
      } else {
        setSession(response);
        setResult(null);
        setLastAnswer(null);
      }
      if (action === "start" || (action === "answer" && response.finished)) await readHistory();
    } catch (e) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }

  const currentQuestionId = session?.state === "active" ? session.current?.question_id || "" : "";
  React.useEffect(() => {
    if (!currentQuestionId || session.current?.ready || !cycleId) {
      setPreparingChallenge(false);
      setPreparedChallenge(null);
      setPrepareError("");
      return undefined;
    }
    let active = true;
    setPreparedChallenge(null);
    setPrepareError("");
    setPreparingChallenge(true);
    requestRevenge(supabase, notebookId, cycleId, "generate")
      .then((data) => { if (active) setPreparedChallenge(data); })
      .catch((error) => {
        if (active) {
          console.warn("A preparação da Revanche falhou:", error.message);
          setPrepareError("Ainda não consegui preparar sua pergunta. Podemos tentar novamente.");
        }
      })
      .finally(() => { if (active) setPreparingChallenge(false); });
    return () => { active = false; };
  }, [supabase, notebookId, cycleId, currentQuestionId, session?.current?.ready, prepareRetry]);

  function acceptChallenge() {
    if (!session?.current?.ready && !preparedChallenge?.current?.ready) return;
    if (preparedChallenge?.current?.ready) setSession(preparedChallenge);
    setReviewedQuestionId(currentQuestionId);
  }

  function toggleMascot() {
    setShowMascot((previous) => {
      localStorage.setItem("revenge-mascot-" + userId, previous ? "off" : "on");
      return !previous;
    });
  }
  const chosenCycle = cycles.find((x) => x.id === cycleId);
  const savedSession = history.find((x) => x.cycle_id === cycleId);
  const activeNumber = session?.completed_errors + 1 || 1;
  const needsReview = session?.state === "active" && session.current?.attempt_number === 1 && reviewedQuestionId !== currentQuestionId;
  const phase = !session
    ? "choose"
    : session.state === "completed"
      ? "completed"
      : result
        ? "feedback"
        : needsReview
          ? "prepare"
          : session.current?.ready
            ? "question"
            : "prepare";
  const phaseKey = [
    cycleId || "none",
    phase,
    session?.completed_errors || 0,
    session?.current?.attempt_number || 0,
    result?.attempt || 0,
    replay,
  ].join(":");

  const messages = React.useMemo(() => {
    if (phase === "choose")
      return [
        {
          role: "bot",
          text: "Ei! Eu sou o Caderno. 📚 Quer provar que aprendeu com aqueles errinhos?",
        },
        {
          role: "bot",
          text: chosenCycle
            ? "Encontrei seu ciclo! Clique em aceitar para começarmos a nossa revanche."
            : "Escolha um ciclo concluído com erros. Eu preparo um desafio sob medida.",
        },
      ];
    if (phase === "prepare") {
      const d = session.diagnosis || {};
      const messages = [
        { role: "bot", text: "Vamos rever seu erro " + activeNumber + " de " + session.total_errors
          + (d.number ? " — questão " + d.number : "") + (d.discipline ? " (" + d.discipline + ")" : "") + "." },
      ];
      if (d.selected_option) messages.push({ role: "bot", title: "Onde você errou",
        text: "Você marcou a alternativa " + d.selected_option
          + (d.selected_text ? ": " + d.selected_text : ".")
          + (d.correct_option ? "\nA resposta correta era " + d.correct_option
            + (d.correct_text ? ": " + d.correct_text : ".") : "." : "") });
      if (d.mistake_type) messages.push({ role: "bot", title: "O que te confundiu", text: d.mistake_type });
      if (d.wrong_reasoning) messages.push({ role: "bot", title: "A lógica do seu erro", text: d.wrong_reasoning });
      else if (d.student_feedback) messages.push({ role: "bot", title: "Entenda o equívoco", text: d.student_feedback });
      if (d.central_rule) messages.push({ role: "bot", title: "O que você precisava lembrar", text: d.central_rule });
      if (d.study_content) messages.push({ role: "bot", title: "Para fixar", text: d.study_content });
      else if (d.legal_basis) messages.push({ role: "bot", title: "Fundamento", text: d.legal_basis });
      messages.push({ role: "bot", text: "Agora que vimos o ponto que te confundiu, quero saber se você aprendeu. Aceita uma revanche? 😏" });
      return messages;
    }
    if (phase === "question")
      return [
        ...(session.current?.previous_feedback
          ? [{ role: "bot", text: "Na primeira tentativa: " + session.current.previous_feedback }]
          : []),
        {
          role: "bot",
          text:
            session.current?.attempt_number === 2
              ? "Ainda temos uma chance. Essa é a segunda afirmação. 😏"
              : "Preparado? Leia com atenção. Verdadeiro ou falso?",
        },
        {
          role: "bot",
          title: "Afirmação " + (session.current?.attempt_number || 1),
          text: session.current.statement || "",
        },
      ];
    if (phase === "feedback")
      return [
        { role: "user", text: lastAnswer ? "Verdadeiro" : "Falso" },
        {
          role: "bot",
          title: result.correct
            ? "Mandou bem! ✅"
            : result.advanced
              ? "Essa escapou. 📘"
              : "Quase! Ainda há outra chance.",
          text: result.correct
            ? "Você superou esse raciocínio. Gostei de ver!"
            : result.advanced
              ? "Dessa vez não deu para superar, mas a revisão continua disponível."
              : "Olha o detalhe que pegou você:",
        },
        { role: "bot", text: result.feedback || "Revise o fundamento antes de continuar." },
      ];
    return [
      {
        role: "bot",
        text: session?.perfect
          ? "Caramba! Você venceu todas as revanches! 🏆 Nem eu esperava tanta precisão."
          : "Terminamos! Você enfrentou os erros de frente. Nada mal! 💪",
      },
      {
        role: "bot",
        text:
          session.mastered_count +
          " de " +
          session.total_errors +
          " erro(s) superado(s). " +
          (session.perfect
            ? "Conquista: Revanche perfeita — 100%!"
            : "Os assuntos ainda pendentes podem ser revisados no estudo original."),
      },
      { role: "bot", text: "E pode ficar tranquilo: o resultado do ciclo original não mudou." },
    ];
  }, [phase, chosenCycle, activeNumber, session, result, lastAnswer]);

  return (
    <section className="revenge-page revenge-conversation">
      <div className="revenge-head">
        <div>
          <span className="eyebrow">MODO REVANCHE</span>
          <h1>Um duelo de conhecimentos</h1>
          <p>Entenda seu erro, tire a dúvida e mostre o que aprendeu.</p>
        </div>
        <label className="revenge-toggle">
          <input type="checkbox" checked={showMascot} onChange={toggleMascot} /> Mostrar mascote
        </label>
      </div>
      {session && (
        <div className="revenge-chat-progress">
          <span>
            {session.completed_errors} de {session.total_errors} erros enfrentados
          </span>
          <span>{session.mastered_count} superado(s)</span>
          <div className="revenge-progress">
            <span
              style={{ width: (session.completed_errors / session.total_errors) * 100 + "%" }}
            />
          </div>
        </div>
      )}
      <Dialogue messages={messages} phaseKey={phaseKey} groupKey={(currentQuestionId || cycleId || "choose") + ":" + replay} busy={busy || (phase === "prepare" && preparingChallenge)} mascotEnabled={showMascot}>
        {phase === "choose" && (
          <div className="revenge-chat-choices">
            {cycles.length === 0 ? (
              <p>Você ainda não tem um ciclo concluído com erros neste caderno.</p>
            ) : (
              <>
                <p>Escolha seu desafio:</p>
                <div className="revenge-cycle-list">
                  {cycles.map((cycle) => {
                    const saved = history.find((row) => row.cycle_id === cycle.id);
                    return (
                      <button
                        type="button"
                        key={cycle.id}
                        className={"revenge-cycle" + (cycleId === cycle.id ? " active" : "")}
                        onClick={() => {
                          setCycleId(cycle.id);
                          setResult(null);
                          setMessage("");
                        }}
                      >
                        <span>
                          <b>{cycle.concurso || "Ciclo de estudos"}</b>
                          <small>
                            {new Date(cycle.completed_at).toLocaleDateString("pt-BR")} ·{" "}
                            {cycle.progress?.filter((x) => x === "wrong").length} erros
                          </small>
                        </span>
                        <span>
                          {saved?.state === "completed"
                            ? "Concluída"
                            : saved
                              ? "Continuar"
                              : "Escolher"}{" "}
                          ›
                        </span>
                      </button>
                    );
                  })}
                </div>
                {cycleId && (
                  <button
                    className="revenge-primary"
                    disabled={busy}
                    onClick={() => doAction(savedSession ? "state" : "start")}
                  >
                    {savedSession ? "Continuar conversa" : "Aceitar desafio"}
                  </button>
                )}
              </>
            )}
          </div>
        )}
        {phase === "prepare" && (
          <div className="revenge-review-actions">
            {prepareError && <p role="alert">{prepareError}</p>}
            {prepareError && <button className="light" onClick={() => setPrepareRetry((n) => n + 1)}>Tentar novamente</button>}
            <button className="revenge-primary" onClick={acceptChallenge}
              disabled={!session.current?.ready && !preparedChallenge?.current?.ready}>
              Aceitar desafio ⚔️
            </button>
            <button className="light" onClick={() => setReplay((n) => n + 1)}>Rever explicação</button>
          </div>
        )}
        {phase === "question" && (
          <div
            className="revenge-quick-replies"
            role="group"
            aria-label="Escolha verdadeiro ou falso"
          >
            <button onClick={() => doAction("answer", { answer: true })}>✓ Verdadeiro</button>
            <button onClick={() => doAction("answer", { answer: false })}>✕ Falso</button>
          </div>
        )}
        {phase === "feedback" && (
          <button className="revenge-primary" onClick={() => doAction("state")}>
            {result.finished
              ? "Ver resultado final"
              : result.advanced
                ? "Próximo erro"
                : "Tentar novamente"}
          </button>
        )}
        {phase === "completed" && (
          <div className="revenge-actions">
            <button
              onClick={() => {
                setSession(null);
                setCycleId("");
                setResult(null);
              }}
            >
              Escolher outro ciclo
            </button>
            <button className="light" onClick={onBack}>
              Voltar aos estudos
            </button>
          </div>
        )}
      </Dialogue>
      {message && (
        <div className="revenge-error" role="alert">
          <strong>O Caderno teve um contratempo.</strong>
          <p>{message}</p>
          <p>O progresso já registrado está preservado. Você pode tentar novamente.</p>
          {phase === "prepare" && (
            <button onClick={() => doAction("generate")}>Tentar gerar novamente</button>
          )}
          <button className="light" onClick={() => setMessage("")}>
            Fechar
          </button>
        </div>
      )}
      <p className="revenge-disclaimer">
        As afirmações são verificadas por IA, mas podem conter erros. Em caso de dúvida, confira o
        fundamento jurídico antes de incorporar o conteúdo aos estudos.
      </p>
    </section>
  );
}

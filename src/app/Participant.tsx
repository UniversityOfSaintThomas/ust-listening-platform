import { useEffect, useRef, useState } from "react";
import type { Mode, PublicCampaign, Turn } from "../shared/types";
import { GuideConnection, type GuideStatus } from "./realtime";

type Stage = "loading" | "intro" | "context" | "conversation" | "review" | "thanks" | "unavailable";

declare global {
  interface Window {
    turnstile?: { render(el: HTMLElement, options: { sitekey: string; callback(token: string): void; "expired-callback"(): void }): string };
  }
}

const statusLabel: Record<GuideStatus, string> = {
  connecting: "Connecting to the guide",
  listening: "Listening live",
  hearing: "Hearing you",
  thinking: "One moment",
  speaking: "The guide is speaking",
  ended: "Conversation finished",
  error: "Connection problem",
};

const statusHeading: Record<GuideStatus, string> = {
  connecting: "Connecting…",
  listening: "Speak naturally. Take your time.",
  hearing: "I'm listening.",
  thinking: "One moment…",
  speaking: "The guide is speaking.",
  ended: "Thank you.",
  error: "The connection dropped.",
};

const ratingLabels = ["Very difficult", "Difficult", "Okay", "Easy", "Excellent"];

async function post<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || "Something went wrong. Please try again.");
  return payload;
}

/** Bolds the first letter of each capitalized word, so the unit's acronym reads from its full name. */
function Acronym({ name }: { name: string }) {
  return (
    <>
      {name.split(" ").map((word, index) => (
        <span key={index}>
          {index > 0 && " "}
          {/^[A-Z]/.test(word) ? <><strong>{word[0]}</strong>{word.slice(1)}</> : word}
        </span>
      ))}
    </>
  );
}

export default function Participant({ slug }: { slug: string }) {
  const [campaign, setCampaign] = useState<PublicCampaign | null>(null);
  const [stage, setStage] = useState<Stage>("loading");
  const [error, setError] = useState("");
  const [mode, setMode] = useState<Mode>("voice");
  const [consented, setConsented] = useState(false);
  const [context, setContext] = useState<string[]>([]);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [starting, setStarting] = useState(false);
  const [status, setStatus] = useState<GuideStatus>("connecting");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [micMuted, setMicMuted] = useState(false);
  const [voiceMuted, setVoiceMuted] = useState(false);
  const [hasMic, setHasMic] = useState(false);
  const [draft, setDraft] = useState("");
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [role, setRole] = useState("");
  const [ease, setEase] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [discarded, setDiscarded] = useState(false);
  const connection = useRef<GuideConnection | null>(null);
  const submitToken = useRef("");
  const turnstileBox = useRef<HTMLDivElement | null>(null);
  const captions = useRef<HTMLDivElement | null>(null);
  const heading = useRef<HTMLHeadingElement | null>(null);
  const firstRender = useRef(true);

  useEffect(() => {
    fetch(`/api/campaigns/${encodeURIComponent(slug)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const data = (await response.json()) as PublicCampaign;
        setCampaign(data);
        document.title = `${data.unit} feedback | University of St. Thomas`;
        setStage(data.status === "open" ? "intro" : "unavailable");
      })
      .catch(() => setStage("unavailable"));
    return () => connection.current?.stop();
  }, [slug]);

  // Move keyboard and screen reader focus to the new heading on every step after the first.
  useEffect(() => {
    if (stage === "loading") return;
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    // The banner stays on every step, so bring the new step into view below it.
    heading.current?.focus({ preventScroll: true });
    const section = heading.current?.closest("section");
    if (section) window.scrollTo({ top: section.getBoundingClientRect().top + window.scrollY - 24 });
  }, [stage]);

  useEffect(() => {
    if (stage !== "context" || !campaign?.turnstileSiteKey || !turnstileBox.current) return;
    const box = turnstileBox.current;
    const render = () => window.turnstile?.render(box, { sitekey: campaign.turnstileSiteKey, callback: setTurnstileToken, "expired-callback": () => setTurnstileToken("") });
    if (window.turnstile) {
      render();
      return;
    }
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.onload = render;
    document.head.appendChild(script);
  }, [stage, campaign]);

  useEffect(() => {
    if (stage !== "conversation") return;
    const timer = window.setInterval(() => setSecondsLeft((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [stage]);

  useEffect(() => {
    if (stage === "conversation" && secondsLeft === 0 && status !== "connecting") goToReview();
  }, [secondsLeft]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    captions.current?.scrollTo({ top: captions.current.scrollHeight });
  }, [turns]);

  if (stage === "loading") return <main><p className="quiet page-note" role="status">Loading…</p></main>;
  if (stage === "unavailable" || !campaign) {
    return <main><section className="intro-panel thanks"><div><h1>This feedback page is not available.</h1><p>It may be closed, or the link may be incorrect.</p></div></section></main>;
  }

  function goToReview() {
    const final = connection.current?.turns() || turns;
    connection.current?.stop();
    connection.current = null;
    setTurns(final);
    setStage("review");
  }

  async function begin() {
    if (!campaign) return;
    setStarting(true);
    setError("");
    try {
      const session = await post<{ clientSecret: string; submitToken: string }>("/api/sessions", { slug: campaign.slug, mode, context, turnstileToken, consent: consented });
      submitToken.current = session.submitToken;
      const guide = new GuideConnection({ onStatus: setStatus, onTurns: setTurns, onFinish: goToReview, onError: setError });
      connection.current = guide;
      guide.audio.muted = mode === "text";
      setVoiceMuted(mode === "text");
      setMicMuted(false);
      setTurns([]);
      setSecondsLeft(campaign.maxMinutes * 60);
      setStage("conversation");
      const micOk = await guide.start(session.clientSecret, mode === "voice");
      setHasMic(micOk);
      if (mode === "voice" && !micOk) setError("The microphone was not available, so you can type your responses below. To use voice, allow microphone access in your browser and start again.");
    } catch (caught) {
      connection.current?.stop();
      connection.current = null;
      setStage("context");
      setError(caught instanceof Error ? caught.message : "The conversation could not start.");
    } finally {
      setStarting(false);
    }
  }

  function sendDraft() {
    const message = draft.trim();
    if (!message || !connection.current) return;
    connection.current.sendText(message);
    setDraft("");
  }

  async function submit() {
    if (!campaign) return;
    const cleaned = turns.map((turn) => ({ ...turn, text: turn.text.trim() })).filter((turn) => turn.text);
    if (!cleaned.some((turn) => turn.role === "participant")) {
      setError("There is nothing to submit yet. Add at least one response.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await post("/api/submissions", { slug: campaign.slug, submitToken: submitToken.current, transcript: cleaned, context, role, ease, mode });
      setTurns([]);
      setStage("thanks");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Your response could not be submitted.");
    } finally {
      setSubmitting(false);
    }
  }

  const toggle = (option: string) => setContext((current) => (current.includes(option) ? current.filter((item) => item !== option) : [...current, option]));
  const editTurn = (index: number, text: string) => setTurns((current) => current.map((turn, i) => (i === index ? { ...turn, text } : turn)));
  const removeTurn = (index: number) => setTurns((current) => current.filter((_, i) => i !== index));
  const needsCheck = Boolean(campaign.turnstileSiteKey) && !turnstileToken;
  const minutesLeft = Math.ceil(secondsLeft / 60);
  const unitUpper = campaign.unit.toUpperCase();
  const lastGuide = [...turns].reverse().find((turn) => turn.role === "guide")?.text || "";
  const typing = mode === "text" || !hasMic;
  const active = status === "hearing" || status === "speaking";

  const path: { label: string; state: "done" | "active" | "" }[] = [
    { label: "Notice and consent", state: "done" },
    { label: "Experience context", state: stage === "context" ? "active" : "done" },
    { label: "Conversation", state: stage === "conversation" ? "active" : stage === "review" ? "done" : "" },
    { label: "Review", state: stage === "review" ? "active" : "" },
  ];

  return (
    <main>
      <header className="masthead">
        <div className="wordmark">ST. THOMAS <span>{unitUpper}</span></div>
        <span className="masthead-detail">INTERNAL LISTENING PROJECT</span>
      </header>

      {
        <section className="hero">
          <div className="hero-copy">
            <p className="eyebrow"><Acronym name={campaign.unitFullName} /></p>
            <h1>{campaign.headline}</h1>
            <p>{campaign.invitation}</p>
            <div className="hero-line" />
          </div>
          <div className="hero-mark" aria-hidden="true"><span>LISTEN</span><b>→</b></div>
        </section>
      }

      {error && <p className="notice" role="alert">{error}</p>}

      {stage === "intro" && (
        <section className="intro-panel">
          <div>
            <p className="section-label">A SHORT CONVERSATION</p>
            <h2 ref={heading} tabIndex={-1}>Your perspective matters here.</h2>
            <p>{campaign.purpose}</p>
            <ul className="notice-list quiet">{campaign.notice.map((line) => <li key={line}>{line}</li>)}</ul>
            <p className="quiet"><strong>Who sees your response.</strong> {campaign.whoSeesResponses}</p>
          </div>
          <div className="intro-actions">
            <p id="mode-label">How would you like to respond?</p>
            <div className="mode-tabs" role="radiogroup" aria-labelledby="mode-label">
              <button type="button" role="radio" aria-checked={mode === "voice"} className={mode === "voice" ? "mode-tab selected" : "mode-tab"} onClick={() => setMode("voice")}>
                <strong>Live Chat</strong><span>Speak naturally with the guide. You can also type at any point.</span>
              </button>
              <button type="button" role="radio" aria-checked={mode === "text"} className={mode === "text" ? "mode-tab selected" : "mode-tab"} onClick={() => setMode("text")}>
                <strong>Type</strong><span>Same questions, by text. No microphone or sound.</span>
              </button>
            </div>
            <label className="consent">
              <input type="checkbox" checked={consented} onChange={(event) => setConsented(event.target.checked)} />
              <span>{campaign.consentLabel}</span>
            </label>
            <button className="primary" disabled={!consented} aria-describedby={consented ? undefined : "consent-hint"} onClick={() => setStage("context")}>Begin {mode === "voice" ? "Live Chat" : "typing"}</button>
            {!consented && <p id="consent-hint" className="quiet small consent-hint">Tick the box above to begin.</p>}
          </div>
        </section>
      )}

      {(stage === "context" || stage === "conversation" || stage === "review") && (
        <section className="conversation">
          <aside className="progress-panel" aria-label="Your path">
            <span>YOUR PATH</span>
            <ol>{path.map((step) => <li key={step.label} className={step.state} aria-current={step.state === "active" ? "step" : undefined}>{step.label}</li>)}</ol>
          </aside>

          {stage === "context" && (
            <div className="question-shell">
              <div className="question-kicker"><span>02</span><p>START WITH CONTEXT</p></div>
              <h2 ref={heading} tabIndex={-1}>{campaign.contextPrompt}</h2>
              <p className="quiet">Choose any that apply. This helps us understand your feedback in context.</p>
              <div className="chip-grid">
                {campaign.contextOptions.map((option) => (
                  <button key={option} type="button" className={context.includes(option) ? "chip selected" : "chip"} aria-pressed={context.includes(option)} onClick={() => toggle(option)}>{option}</button>
                ))}
              </div>
              <div ref={turnstileBox} />
              <button className="primary" disabled={starting || needsCheck} onClick={() => void begin()}>{starting ? "Starting…" : "Start the conversation"}</button>
            </div>
          )}

          {stage === "conversation" && (
            <div className="question-shell">
              <div className="question-kicker"><span>03</span><p>{unitUpper} LISTENING GUIDE</p></div>
              <h2 ref={heading} tabIndex={-1} className={lastGuide.length > 150 ? "guide-line long" : "guide-line"}>{lastGuide || "Connecting to your guide…"}</h2>
              <p className="quiet">Speak or type. Please focus on services and processes rather than named colleagues.</p>

              <section className={`voice-studio ${status}${active ? " active" : ""}`}>
                <div className="voice-topline"><span className="live-dot" /> <span role="status">{typing && status === "listening" ? "YOUR TURN" : statusLabel[status].toUpperCase()}</span></div>
                <h3>{typing && status === "listening" ? "Type your response below." : statusHeading[status]}</h3>
                <p>{typing ? "The guide replies in text. Send a message whenever you are ready." : "You can pause to think, and you can interrupt the guide at any time. Audio is not stored."}</p>
                <div className="sound-wave" aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /></div>
                {hasMic && (
                  <button className={micMuted ? "hold-to-talk muted" : "hold-to-talk"} aria-pressed={micMuted} onClick={() => { connection.current?.setMicrophoneMuted(!micMuted); setMicMuted(!micMuted); }}>
                    {micMuted ? "Resume microphone" : "Pause microphone"}
                  </button>
                )}
                <p className="voice-hint">{minutesLeft <= 2 && status !== "connecting" ? `About ${minutesLeft} ${minutesLeft === 1 ? "minute" : "minutes"} left.` : "Nothing is saved until you review and submit."}</p>
              </section>

              <div className="or-divider"><span>{typing ? "type your response" : "or type instead"}</span></div>
              <form className="type-row" onSubmit={(event) => { event.preventDefault(); sendDraft(); }}>
                <label htmlFor="draft" className="visually-hidden">Type a response</label>
                <input id="draft" className="name-input" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Type your response here…" autoComplete="off" />
                <button className="secondary" type="submit" disabled={!draft.trim()}>Send</button>
              </form>

              <div className="transcript" ref={captions} role="log" aria-label="Conversation so far" tabIndex={0}>
                {turns.length === 0 && <p className="quiet">The conversation will appear here as text.</p>}
                {turns.map((turn, index) => <p key={index} className={turn.role}><strong>{turn.role === "guide" ? "Guide:" : "You:"}</strong> {turn.text}</p>)}
              </div>

              <div className="response-actions">
                {mode === "voice" ? (
                  <button className="secondary" aria-pressed={voiceMuted} onClick={() => { if (connection.current) connection.current.audio.muted = !voiceMuted; setVoiceMuted(!voiceMuted); }}>
                    {voiceMuted ? "Turn guide voice on" : "Turn guide voice off"}
                  </button>
                ) : <span />}
                <button className="primary" onClick={goToReview}>Finish and review</button>
              </div>
            </div>
          )}

          {stage === "review" && (
            <div className="question-shell review-shell">
              <div className="question-kicker"><span>04</span><p>REVIEW</p></div>
              <h2 ref={heading} tabIndex={-1}>Thank you for your perspective.</h2>
              <p>Your transcript is shown below. Edit or remove anything you said, including any detail that could identify you. Nothing has been saved yet.</p>

              <div className="transcript editable">
                {turns.length === 0 && <p className="quiet">No responses were captured.</p>}
                {turns.map((turn, index) =>
                  turn.role === "guide" ? (
                    <p key={index} className="guide"><strong>Guide:</strong> {turn.text}</p>
                  ) : (
                    <div key={index} className="edit-turn">
                      <label htmlFor={`turn-${index}`}>Your response</label>
                      <textarea id={`turn-${index}`} value={turn.text} rows={Math.min(8, Math.max(2, Math.ceil(turn.text.length / 70)))} onChange={(event) => editTurn(index, event.target.value)} />
                      <button className="quiet-button" onClick={() => removeTurn(index)}>Remove this response</button>
                    </div>
                  ),
                )}
              </div>

              <p id="rating-label"><strong>How was this {mode === "voice" ? "Live Chat" : "typed"} experience?</strong> <span className="quiet">Optional.</span></p>
              <div className="rating-scale" role="radiogroup" aria-labelledby="rating-label">
                {ratingLabels.map((label, index) => (
                  <button key={label} type="button" role="radio" aria-checked={ease === index + 1} className={ease === index + 1 ? "selected" : ""} onClick={() => setEase(ease === index + 1 ? null : index + 1)}>
                    <b>{index + 1}</b><span>{label}</span>
                  </button>
                ))}
              </div>

              <label htmlFor="role">Your role <span className="quiet">Optional.</span></label>
              <select id="role" className="name-input" value={role} onChange={(event) => setRole(event.target.value)}>
                <option value="">Not stated</option>
                {campaign.roles.map((option) => <option key={option}>{option}</option>)}
              </select>
              <p className="quiet small">Your response is anonymous. Names, contact details, and similar identifying details are replaced with placeholders before it is saved.</p>

              <div className="response-actions">
                <button className="quiet-button" onClick={() => { setTurns([]); setError(""); setDiscarded(true); setStage("thanks"); }}>Discard without submitting</button>
                <button className="primary" disabled={submitting} onClick={() => void submit()}>{submitting ? "Submitting…" : "Submit feedback"}</button>
              </div>
            </div>
          )}
        </section>
      )}

      {stage === "thanks" && (
        <section className="intro-panel thanks">
          <div>
            <p className="section-label">{discarded ? "DISCARDED" : "SUBMITTED"}</p>
            <h2 ref={heading} tabIndex={-1}>{discarded ? "Nothing was saved." : "Thank you for contributing."}</h2>
            <p>{discarded ? "Your conversation was discarded. You can close this page." : `Your feedback has been recorded for ${campaign.unit}'s service-improvement work. You can close this page.`}</p>
          </div>
        </section>
      )}

      <footer>
        <span><Acronym name={campaign.unitFullName} /></span>
        <span>University of St. Thomas</span>
        <a className="leadership-link footer-link" href="/review">Leadership review</a>
      </footer>
    </main>
  );
}

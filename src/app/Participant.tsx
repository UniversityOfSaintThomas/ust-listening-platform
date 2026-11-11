import { useEffect, useRef, useState } from "react";
import type { Mode, PublicCampaign, Turn } from "../shared/types";
import { GuideConnection, type GuideStatus } from "./realtime";

type Stage = "loading" | "welcome" | "setup" | "conversation" | "review" | "thanks" | "unavailable";

declare global {
  interface Window {
    turnstile?: { render(el: HTMLElement, options: { sitekey: string; callback(token: string): void; "expired-callback"(): void }): string };
  }
}

const statusLabel: Record<GuideStatus, string> = {
  connecting: "Connecting to the guide",
  listening: "Listening. Take your time.",
  hearing: "Hearing you",
  thinking: "One moment",
  speaking: "The guide is speaking",
  ended: "Conversation finished",
  error: "Connection problem",
};

async function post<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || "Something went wrong. Please try again.");
  return payload;
}

export default function Participant({ slug }: { slug: string }) {
  const [campaign, setCampaign] = useState<PublicCampaign | null>(null);
  const [stage, setStage] = useState<Stage>("loading");
  const [error, setError] = useState("");
  const [mode, setMode] = useState<Mode>("voice");
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
  const [name, setName] = useState("");
  const [ease, setEase] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [discarded, setDiscarded] = useState(false);
  const connection = useRef<GuideConnection | null>(null);
  const submitToken = useRef("");
  const turnstileBox = useRef<HTMLDivElement | null>(null);
  const captions = useRef<HTMLDivElement | null>(null);
  const heading = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    fetch(`/api/campaigns/${encodeURIComponent(slug)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const data = (await response.json()) as PublicCampaign;
        setCampaign(data);
        document.title = `${data.unit} feedback | University of St. Thomas`;
        setStage(data.status === "open" ? "welcome" : "unavailable");
      })
      .catch(() => setStage("unavailable"));
    return () => connection.current?.stop();
  }, [slug]);

  // Move keyboard and screen reader focus to the new heading on every step.
  useEffect(() => {
    heading.current?.focus();
    window.scrollTo({ top: 0 });
  }, [stage]);

  useEffect(() => {
    if (stage !== "setup" || !campaign?.turnstileSiteKey || !turnstileBox.current) return;
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

  if (stage === "loading") return <main className="shell"><p className="quiet" role="status">Loading…</p></main>;
  if (stage === "unavailable" || !campaign) {
    return <main className="shell"><section className="card"><h1>This feedback page is not available.</h1><p>It may be closed, or the link may be incorrect.</p></section></main>;
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
      const session = await post<{ clientSecret: string; submitToken: string }>("/api/sessions", { slug: campaign.slug, mode, context, turnstileToken });
      submitToken.current = session.submitToken;
      const guide = new GuideConnection({ onStatus: setStatus, onTurns: setTurns, onFinish: goToReview, onError: setError });
      connection.current = guide;
      guide.audio.muted = mode === "text";
      setVoiceMuted(mode === "text");
      setTurns([]);
      setSecondsLeft(campaign.maxMinutes * 60);
      setStage("conversation");
      const micOk = await guide.start(session.clientSecret, mode === "voice");
      setHasMic(micOk);
      if (mode === "voice" && !micOk) setError("The microphone was not available, so you can type your responses below. To use voice, allow microphone access in your browser and start again.");
    } catch (caught) {
      connection.current?.stop();
      connection.current = null;
      setStage("setup");
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
      await post("/api/submissions", { slug: campaign.slug, submitToken: submitToken.current, transcript: cleaned, context, role, name, ease, mode });
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

  return (
    <main className="shell">
      <header className="masthead">
        <span className="wordmark">University of St. Thomas <b>{campaign.unit}</b></span>
      </header>

      {error && <p className="notice" role="alert">{error}</p>}

      {stage === "welcome" && (
        <section className="card">
          <p className="label">{campaign.unitFullName}</p>
          <h1 ref={heading} tabIndex={-1}>{campaign.headline}</h1>
          <p className="lead">{campaign.invitation}</p>
          <h2>Before you start</h2>
          <ul className="plain-list">{campaign.notice.map((line) => <li key={line}>{line}</li>)}</ul>
          <h2>Who sees your response</h2>
          <p>{campaign.whoSeesResponses}</p>
          <button className="primary" onClick={() => setStage("setup")}>I understand, continue</button>
        </section>
      )}

      {stage === "setup" && (
        <section className="card">
          <h1 ref={heading} tabIndex={-1}>Two quick choices</h1>
          <fieldset>
            <legend>{campaign.contextPrompt} <span className="quiet">Choose any that apply.</span></legend>
            <div className="chips">
              {campaign.contextOptions.map((option) => (
                <button key={option} type="button" className="chip" aria-pressed={context.includes(option)} onClick={() => toggle(option)}>{option}</button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>How would you like to respond?</legend>
            <div className="options">
              <label className="option"><input type="radio" name="mode" checked={mode === "voice"} onChange={() => setMode("voice")} /><span><b>Talk</b> Speak with the guide. Your browser will ask to use the microphone. You can also type at any point.</span></label>
              <label className="option"><input type="radio" name="mode" checked={mode === "text"} onChange={() => setMode("text")} /><span><b>Type</b> Same questions, by text. No microphone or sound.</span></label>
            </div>
          </fieldset>
          <div ref={turnstileBox} />
          <button className="primary" disabled={starting || needsCheck} onClick={() => void begin()}>{starting ? "Starting…" : "Start the conversation"}</button>
        </section>
      )}

      {stage === "conversation" && (
        <section className="card conversation">
          <h1 ref={heading} tabIndex={-1} className="visually-hidden">Conversation with the {campaign.unit} listening guide</h1>
          <div className={`status status-${status}`}>
            <span className="orb" aria-hidden="true" />
            <p role="status">{statusLabel[status]}</p>
            {minutesLeft <= 2 && status !== "connecting" && <p className="quiet">About {minutesLeft} {minutesLeft === 1 ? "minute" : "minutes"} left</p>}
          </div>

          <div className="captions" ref={captions} role="log" aria-label="Conversation transcript" tabIndex={0}>
            {turns.length === 0 && <p className="quiet">The conversation will appear here as text.</p>}
            {turns.map((turn, index) => (
              <p key={index} className={turn.role}><b>{turn.role === "guide" ? "Guide" : "You"}</b>{turn.text}</p>
            ))}
          </div>

          <form className="type-row" onSubmit={(event) => { event.preventDefault(); sendDraft(); }}>
            <label htmlFor="draft" className="visually-hidden">Type a response</label>
            <input id="draft" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={hasMic ? "Or type here" : "Type your response"} autoComplete="off" />
            <button className="secondary" type="submit" disabled={!draft.trim()}>Send</button>
          </form>

          <div className="controls">
            {hasMic && (
              <button className="secondary" aria-pressed={micMuted} onClick={() => { connection.current?.setMicrophoneMuted(!micMuted); setMicMuted(!micMuted); }}>
                {micMuted ? "Unmute microphone" : "Mute microphone"}
              </button>
            )}
            <button className="secondary" aria-pressed={voiceMuted} onClick={() => { if (connection.current) connection.current.audio.muted = !voiceMuted; setVoiceMuted(!voiceMuted); }}>
              {voiceMuted ? "Turn guide voice on" : "Turn guide voice off"}
            </button>
            <button className="primary" onClick={goToReview}>Finish and review</button>
          </div>
          <p className="quiet small">Nothing is saved until you review and submit on the next screen.</p>
        </section>
      )}

      {stage === "review" && (
        <section className="card">
          <h1 ref={heading} tabIndex={-1}>Review before you submit</h1>
          <p>This is the written record of the conversation. Edit or remove anything you said. Nothing has been saved yet.</p>
          <div className="review-list">
            {turns.length === 0 && <p className="quiet">No responses were captured.</p>}
            {turns.map((turn, index) =>
              turn.role === "guide" ? (
                <p key={index} className="guide-line"><b>Guide</b>{turn.text}</p>
              ) : (
                <div key={index} className="edit-turn">
                  <label htmlFor={`turn-${index}`}>Your response</label>
                  <textarea id={`turn-${index}`} value={turn.text} rows={Math.min(8, Math.max(2, Math.ceil(turn.text.length / 80)))} onChange={(event) => editTurn(index, event.target.value)} />
                  <button className="link" onClick={() => removeTurn(index)}>Remove this response</button>
                </div>
              ),
            )}
          </div>

          <h2>Optional details</h2>
          <div className="field-row">
            <div>
              <label htmlFor="role">Your role</label>
              <select id="role" value={role} onChange={(event) => setRole(event.target.value)}>
                <option value="">Not stated</option>
                {campaign.roles.map((option) => <option key={option}>{option}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="name">Your name <span className="quiet">Leave blank to stay anonymous.</span></label>
              <input id="name" value={name} onChange={(event) => setName(event.target.value)} autoComplete="off" />
            </div>
          </div>
          <fieldset>
            <legend>How easy was this conversation to use? <span className="quiet">Optional.</span></legend>
            <div className="scale">
              {[1, 2, 3, 4, 5].map((value) => (
                <label key={value} className="option"><input type="radio" name="ease" checked={ease === value} onChange={() => setEase(value)} /><span>{value}{value === 1 ? " Hard" : value === 5 ? " Easy" : ""}</span></label>
              ))}
            </div>
          </fieldset>
          <div className="controls">
            <button className="link" onClick={() => { setTurns([]); setError(""); setDiscarded(true); setStage("thanks"); }}>Discard without submitting</button>
            <button className="primary" disabled={submitting} onClick={() => void submit()}>{submitting ? "Submitting…" : "Submit feedback"}</button>
          </div>
        </section>
      )}

      {stage === "thanks" && (
        <section className="card">
          {discarded ? (
            <><h1 ref={heading} tabIndex={-1}>Nothing was saved.</h1><p>Your conversation was discarded. You can close this page.</p></>
          ) : (
            <><h1 ref={heading} tabIndex={-1}>Thank you.</h1><p>Your feedback was submitted to {campaign.unit}. You can close this page.</p></>
          )}
        </section>
      )}

      <footer><span>{campaign.unitFullName}</span><span>University of St. Thomas</span></footer>
    </main>
  );
}

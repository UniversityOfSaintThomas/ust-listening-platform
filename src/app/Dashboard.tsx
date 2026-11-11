import { useEffect, useMemo, useRef, useState } from "react";
import type { AnalysisItem, ReviewData, ReviewSubmission, Synthesis } from "../shared/types";

type Me = { email: string; campaigns: { slug: string; unit: string }[] };
type Kind = "strengths" | "frictions" | "suggestions";

const kindLabel: Record<Kind, string> = { strengths: "What is working", frictions: "Where there is friction", suggestions: "What people ask for" };

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || "The request failed.");
  return payload;
}

function ThemeBars({ kind, submissions, themes }: { kind: Kind; submissions: ReviewSubmission[]; themes: string[] }) {
  // Count each theme once per response so one long answer cannot dominate.
  const rows = useMemo(() => {
    const counts = new Map<string, { count: number; quotes: AnalysisItem[] }>();
    for (const submission of submissions) {
      const seen = new Set<string>();
      for (const item of submission.analysis?.[kind] || []) {
        const entry = counts.get(item.theme) || { count: 0, quotes: [] };
        if (!seen.has(item.theme)) entry.count += 1;
        seen.add(item.theme);
        entry.quotes.push(item);
        counts.set(item.theme, entry);
      }
    }
    return themes.map((theme) => ({ theme, ...(counts.get(theme) || { count: 0, quotes: [] }) })).filter((row) => row.count).sort((a, b) => b.count - a.count);
  }, [kind, submissions, themes]);
  const max = Math.max(1, ...rows.map((row) => row.count));

  return (
    <section className={`panel ${kind}`}>
      <h2>{kindLabel[kind]}</h2>
      {rows.length === 0 && <p className="quiet">Nothing coded yet.</p>}
      {rows.map((row) => (
        <details key={row.theme} className="theme">
          <summary>
            <span className="theme-name">{row.theme}</span>
            <span className="bar" aria-hidden="true"><i className={kind} style={{ width: `${(row.count / max) * 100}%` }} /></span>
            <span className="theme-count">{row.count} {row.count === 1 ? "response" : "responses"}</span>
          </summary>
          <ul>
            {row.quotes.slice(0, 12).map((item, index) => (
              <li key={index}>{item.point}{item.quote && <q>{item.quote}</q>}</li>
            ))}
          </ul>
        </details>
      ))}
    </section>
  );
}

export default function Dashboard() {
  const [me, setMe] = useState<Me | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [password, setPassword] = useState("");
  const [signingIn, setSigningIn] = useState(false);
  const [slug, setSlug] = useState("");
  const [data, setData] = useState<ReviewData | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [synthesizing, setSynthesizing] = useState(false);
  const loaded = useRef(false);

  const loadMe = () =>
    api<Me>("/api/review/me")
      .then((result) => {
        setNeedsLogin(false);
        setMe(result);
        if (result.campaigns[0]) setSlug(result.campaigns[0].slug);
      })
      .catch(() => setNeedsLogin(true));

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    document.title = "Leadership review | University of St. Thomas";
    void loadMe();
  }, []);

  const load = (target: string) => api<ReviewData>(`/api/review/${target}`).then(setData).catch((caught: Error) => setError(caught.message));
  useEffect(() => {
    if (slug) void load(slug);
  }, [slug]);

  async function signIn(event: React.FormEvent) {
    event.preventDefault();
    setSigningIn(true);
    setError("");
    try {
      await api("/api/review/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) });
      setPassword("");
      await loadMe();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Sign-in failed.");
    } finally {
      setSigningIn(false);
    }
  }

  async function signOut() {
    await api("/api/review/logout", { method: "POST" }).catch(() => undefined);
    setMe(null);
    setData(null);
    setSlug("");
    setNeedsLogin(true);
  }

  async function generate() {
    setSynthesizing(true);
    setError("");
    try {
      const synthesis = await api<Synthesis>(`/api/review/${slug}/synthesis`, { method: "POST" });
      setData((current) => (current ? { ...current, synthesis } : current));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The synthesis failed.");
    } finally {
      setSynthesizing(false);
    }
  }

  async function remove(id: string) {
    await api(`/api/review/${slug}/submissions/${id}`, { method: "DELETE" }).catch((caught: Error) => setError(caught.message));
    setConfirmDelete(null);
    void load(slug);
  }

  async function reanalyze(id: string) {
    await api(`/api/review/${slug}/submissions/${id}/analyze`, { method: "POST" }).catch((caught: Error) => setError(caught.message));
    window.setTimeout(() => void load(slug), 6000);
  }

  const masthead = (
    <header className="masthead">
      <a className="wordmark" href="/">ST. THOMAS <span>LISTENING</span></a>
      <span className="masthead-detail">LEADERSHIP REVIEW</span>
    </header>
  );

  if (needsLogin) {
    return (
      <main>
        {masthead}
        <form className="leadership-login" onSubmit={(event) => void signIn(event)}>
          <p className="section-label">LEADERSHIP REVIEW</p>
          <h1>Review what people shared.</h1>
          <p>This page is for the leadership team. Enter the review password to see themes, summaries, and individual responses.</p>
          {error && <p className="notice" role="alert">{error}</p>}
          <label htmlFor="password">Review password</label>
          <input id="password" className="name-input" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required />
          <button className="primary" type="submit" disabled={signingIn || !password}>{signingIn ? "Checking…" : "Open review"}</button>
        </form>
      </main>
    );
  }
  if (!me) return <main>{masthead}<p className="quiet page-note" role="status">Loading…</p></main>;
  if (!me.campaigns.length) return <main>{masthead}<section className="leadership-login"><h1>No campaigns assigned</h1><p>{me.email} is signed in but is not listed as a reviewer for any campaign.</p></section></main>;

  const submissions = data?.submissions || [];
  const eased = submissions.filter((s) => s.ease !== null);
  const averageEase = eased.length ? (eased.reduce((sum, s) => sum + (s.ease || 0), 0) / eased.length).toFixed(1) : "n/a";
  const attention = submissions.filter((s) => s.analysis?.needsAttention);
  const synthesis = data?.synthesis;
  const unit = me.campaigns.find((campaign) => campaign.slug === slug)?.unit || "";

  return (
    <main>
      {masthead}
      <div className="leadership">
        <div className="toolbar">
          <div>
            <label htmlFor="campaign">Campaign</label>
            <select id="campaign" className="name-input" value={slug} onChange={(event) => { setData(null); setSlug(event.target.value); }}>
              {me.campaigns.map((campaign) => <option key={campaign.slug} value={campaign.slug}>{campaign.unit}</option>)}
            </select>
          </div>
          <div className="toolbar-actions">
            <a className="secondary" href={`/api/review/${slug}/export.csv`}>Download CSV</a>
            <button className="quiet-button" onClick={() => void signOut()}>Sign out</button>
          </div>
        </div>

        <section className="leadership-hero">
          <p className="section-label">LISTENING RESULTS</p>
          <h1>What people are telling {unit}.</h1>
          <p>Themes and summaries are written by AI from the transcripts. Read the responses behind a claim before acting on it.</p>
        </section>

        {error && <p className="notice" role="alert">{error}</p>}

        {!data ? <p className="quiet" role="status">Loading responses…</p> : (
          <>
            <div className="metrics">
              <article><span>Responses</span><b>{submissions.length}</b></article>
              <article><span>By voice</span><b>{submissions.filter((s) => s.mode === "voice").length}</b></article>
              <article><span>By typing</span><b>{submissions.filter((s) => s.mode === "text").length}</b></article>
              <article><span>Ease of use, 1 to 5</span><b>{averageEase}</b></article>
            </div>

            {submissions.length > 0 && submissions.length < 5 && (
              <p className="notice">Fewer than five responses so far. Patterns are preliminary, and a person could be recognized from what they describe. Hold off on sharing details until more responses arrive.</p>
            )}

            {attention.length > 0 && (
              <section className="panel attention" aria-label="Responses that need follow-up">
                <h2>Needs a person to follow up ({attention.length})</h2>
                <ul>{attention.map((s) => <li key={s.id}>{s.analysis?.attentionNote} <button className="quiet-button" onClick={() => setOpen(s.id)}>Open response</button></li>)}</ul>
              </section>
            )}

            <section className="panel synthesis">
              <h2>Synthesis</h2>
              {synthesis ? (
                <>
                  <p className="quiet small">Generated from {synthesis.responseCount} coded responses on {new Date(synthesis.createdAt * 1000).toLocaleDateString()}.</p>
                  <p>{synthesis.overview}</p>
                  <div className="three">
                    <div><h3>Strengths</h3><ul>{synthesis.strengths.map((line) => <li key={line}>{line}</li>)}</ul></div>
                    <div><h3>Friction</h3><ul>{synthesis.frictions.map((line) => <li key={line}>{line}</li>)}</ul></div>
                    <div><h3>Requested changes</h3><ul>{synthesis.priorities.map((line) => <li key={line}>{line}</li>)}</ul></div>
                  </div>
                </>
              ) : <p className="quiet">No synthesis yet. Generate one when you have a few responses.</p>}
              <button className="primary" disabled={synthesizing || !submissions.length} onClick={() => void generate()}>{synthesizing ? "Writing…" : synthesis ? "Regenerate synthesis" : "Generate synthesis"}</button>
            </section>

            <div className="three">
              {(["strengths", "frictions", "suggestions"] as Kind[]).map((kind) => <ThemeBars key={kind} kind={kind} submissions={submissions} themes={data.campaign.themes} />)}
            </div>

            <section className="responses">
              <h2>Individual responses</h2>
              <p className="quiet small">Responses are anonymous. Names and contact details were replaced with placeholders such as [name] before saving. Transcripts are deleted automatically after {data.campaign.retentionDays} days.</p>
              <div className="submission-list">
                {submissions.length === 0 && <p className="quiet">Submitted feedback will appear here.</p>}
                {submissions.map((s) => (
                  <article key={s.id}>
                    <button className={open === s.id ? "submission selected" : "submission"} aria-expanded={open === s.id} onClick={() => setOpen(open === s.id ? null : s.id)}>
                      <span>{new Date(s.createdAt * 1000).toLocaleDateString(undefined, { timeZone: "UTC" })}</span>
                      <b>Anonymous response</b>
                      <small>{s.mode === "voice" ? "Voice" : "Typed"}{s.role ? ` · ${s.role}` : ""}{s.analysis ? ` · ${s.analysis.sentiment}` : ""}</small>
                      <small>{s.analysis?.summary || (s.analysisStatus === "pending" ? "Analysis in progress." : "Analysis did not complete.")}</small>
                    </button>
                    {open === s.id && (
                      <div className="response-detail">
                        {s.context.length > 0 && <p className="quiet small">Services used: {s.context.join(", ")}</p>}
                        {s.transcript.map((turn, index) => <p key={index} className={turn.role}><strong>{turn.role === "guide" ? "Guide:" : "Participant:"}</strong> {turn.text}</p>)}
                        <div className="response-actions">
                          {s.analysisStatus !== "done" ? <button className="secondary" onClick={() => void reanalyze(s.id)}>Run analysis again</button> : <span />}
                          {confirmDelete === s.id ? (
                            <span className="confirm">Delete this response permanently? <button className="danger" onClick={() => void remove(s.id)}>Yes, delete</button> <button className="secondary" onClick={() => setConfirmDelete(null)}>Cancel</button></span>
                          ) : <button className="quiet-button" onClick={() => setConfirmDelete(s.id)}>Delete response</button>}
                        </div>
                      </div>
                    )}
                  </article>
                ))}
              </div>
            </section>

            <section className="methods">
              <h2>How these results are produced</h2>
              <ul>
                <li>An AI guide conducts each conversation. Participants review and edit their transcript before choosing to submit.</li>
                <li>An AI step removes identifying details before a transcript is saved. It can miss things. If you see a name or identifying detail, delete the response.</li>
                <li>AI codes each transcript into themes and drafts the synthesis. These are drafts. Check a claim against the transcripts before acting on it or sharing it.</li>
                <li>No names, email addresses, IP addresses, or audio are stored. Dates are kept to the day.</li>
              </ul>
            </section>
          </>
        )}
      </div>
    </main>
  );
}

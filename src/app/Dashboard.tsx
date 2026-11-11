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
    <section className="panel">
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
  const [slug, setSlug] = useState("");
  const [data, setData] = useState<ReviewData | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [synthesizing, setSynthesizing] = useState(false);
  const loaded = useRef(false);

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    document.title = "Feedback review | University of St. Thomas";
    api<Me>("/api/review/me")
      .then((result) => {
        setMe(result);
        if (result.campaigns[0]) setSlug(result.campaigns[0].slug);
      })
      .catch((caught: Error) => setError(caught.message));
  }, []);

  const load = (target: string) => api<ReviewData>(`/api/review/${target}`).then(setData).catch((caught: Error) => setError(caught.message));
  useEffect(() => {
    if (slug) void load(slug);
  }, [slug]);

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

  if (error && !me) return <main className="shell"><section className="card"><h1>Reviewer access</h1><p role="alert">{error}</p></section></main>;
  if (!me) return <main className="shell"><p className="quiet" role="status">Loading…</p></main>;
  if (!me.campaigns.length) return <main className="shell"><section className="card"><h1>No campaigns assigned</h1><p>{me.email} is signed in but is not listed as a reviewer for any campaign.</p></section></main>;

  const submissions = data?.submissions || [];
  const eased = submissions.filter((s) => s.ease !== null);
  const averageEase = eased.length ? (eased.reduce((sum, s) => sum + (s.ease || 0), 0) / eased.length).toFixed(1) : "n/a";
  const attention = submissions.filter((s) => s.analysis?.needsAttention);
  const synthesis = data?.synthesis;

  return (
    <main className="shell wide">
      <header className="masthead">
        <span className="wordmark">University of St. Thomas <b>Feedback review</b></span>
        <span className="quiet small">{me.email}</span>
      </header>
      {error && <p className="notice" role="alert">{error}</p>}

      <div className="toolbar">
        <div>
          <label htmlFor="campaign">Campaign</label>
          <select id="campaign" value={slug} onChange={(event) => { setData(null); setSlug(event.target.value); }}>
            {me.campaigns.map((campaign) => <option key={campaign.slug} value={campaign.slug}>{campaign.unit}</option>)}
          </select>
        </div>
        <a className="secondary button" href={`/api/review/${slug}/export.csv`}>Download CSV</a>
      </div>

      {!data ? <p className="quiet" role="status">Loading responses…</p> : (
        <>
          <h1>What people are telling {data.campaign.unit}</h1>
          <dl className="metrics">
            <div><dt>Responses</dt><dd>{submissions.length}</dd></div>
            <div><dt>By voice</dt><dd>{submissions.filter((s) => s.mode === "voice").length}</dd></div>
            <div><dt>By typing</dt><dd>{submissions.filter((s) => s.mode === "text").length}</dd></div>
            <div><dt>Ease of use (1 to 5)</dt><dd>{averageEase}</dd></div>
          </dl>

          {attention.length > 0 && (
            <section className="panel attention" aria-label="Responses that need follow-up">
              <h2>Needs a person to follow up ({attention.length})</h2>
              <ul>{attention.map((s) => <li key={s.id}>{s.analysis?.attentionNote} <button className="link" onClick={() => setOpen(s.id)}>Open response</button></li>)}</ul>
            </section>
          )}

          <section className="panel">
            <h2>Synthesis</h2>
            {synthesis ? (
              <>
                <p className="quiet small">Generated by AI from {synthesis.responseCount} coded responses on {new Date(synthesis.createdAt * 1000).toLocaleDateString()}. Check claims against the responses below.</p>
                <p>{synthesis.overview}</p>
                <div className="three">
                  <div><h3>Strengths</h3><ul>{synthesis.strengths.map((line) => <li key={line}>{line}</li>)}</ul></div>
                  <div><h3>Friction</h3><ul>{synthesis.frictions.map((line) => <li key={line}>{line}</li>)}</ul></div>
                  <div><h3>Requested changes</h3><ul>{synthesis.priorities.map((line) => <li key={line}>{line}</li>)}</ul></div>
                </div>
              </>
            ) : <p className="quiet">No synthesis yet.</p>}
            <button className="secondary" disabled={synthesizing || !submissions.length} onClick={() => void generate()}>{synthesizing ? "Writing…" : synthesis ? "Regenerate synthesis" : "Generate synthesis"}</button>
          </section>

          <div className="three">
            {(["strengths", "frictions", "suggestions"] as Kind[]).map((kind) => <ThemeBars key={kind} kind={kind} submissions={submissions} themes={data.campaign.themes} />)}
          </div>

          <section className="panel">
            <h2>Individual responses</h2>
            <p className="quiet small">Transcripts are deleted automatically after {data.campaign.retentionDays} days.</p>
            {submissions.length === 0 && <p className="quiet">Submitted feedback will appear here.</p>}
            {submissions.map((s) => (
              <article key={s.id} className="response">
                <button className="response-head" aria-expanded={open === s.id} onClick={() => setOpen(open === s.id ? null : s.id)}>
                  <span className="quiet small">{new Date(s.createdAt * 1000).toLocaleDateString()} · {s.mode === "voice" ? "Voice" : "Typed"}{s.role ? ` · ${s.role}` : ""}{s.analysis ? ` · ${s.analysis.sentiment}` : ""}</span>
                  <b>{s.name || "Anonymous"}</b>
                  <span>{s.analysis?.summary || (s.analysisStatus === "pending" ? "Analysis in progress." : "Analysis did not complete.")}</span>
                </button>
                {open === s.id && (
                  <div className="response-body">
                    {s.context.length > 0 && <p className="quiet small">Services used: {s.context.join(", ")}</p>}
                    {s.transcript.map((turn, index) => <p key={index} className={turn.role}><b>{turn.role === "guide" ? "Guide" : "Participant"}</b>{turn.text}</p>)}
                    <div className="controls">
                      {s.analysisStatus !== "done" && <button className="secondary" onClick={() => void reanalyze(s.id)}>Run analysis again</button>}
                      {confirmDelete === s.id ? (
                        <><span>Delete this response permanently?</span><button className="danger" onClick={() => void remove(s.id)}>Yes, delete</button><button className="secondary" onClick={() => setConfirmDelete(null)}>Cancel</button></>
                      ) : <button className="link" onClick={() => setConfirmDelete(s.id)}>Delete response</button>}
                    </div>
                  </div>
                )}
              </article>
            ))}
          </section>
        </>
      )}
    </main>
  );
}

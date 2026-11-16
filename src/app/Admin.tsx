import { useEffect, useRef, useState } from "react";
import { blankCampaign, buildNotice, campaignProblems, cleanCampaign, designProblems, slugify, whoSeesResponses } from "../shared/campaign";
import type { AdminCampaign, Campaign, Category, Question } from "../shared/types";
import { api, sendJson } from "./api";
import { applyDesign } from "./design";

type Editing = { config: Campaign; isNew: boolean; hasPassword: boolean; responses: number };

/** A text box that edits a list, one item per line. */
function Lines({ id, label, hint, value, rows = 5, onChange }: { id: string; label: string; hint?: string; value: string[]; rows?: number; onChange(next: string[]): void }) {
  const [draft, setDraft] = useState(value.join("\n"));
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {hint && <p className="quiet small hint" id={`${id}-hint`}>{hint}</p>}
      <textarea id={id} rows={rows} value={draft} aria-describedby={hint ? `${id}-hint` : undefined} onChange={(event) => { setDraft(event.target.value); onChange(event.target.value.split("\n").map((line) => line.trim()).filter(Boolean)); }} />
    </div>
  );
}

function Field({ id, label, hint, value, onChange, long, max, disabled }: { id: string; label: string; hint?: string; value: string; onChange(next: string): void; long?: number; max?: number; disabled?: boolean }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {hint && <p className="quiet small hint" id={`${id}-hint`}>{hint}</p>}
      {long ? (
        <textarea id={id} rows={long} value={value} maxLength={max} aria-describedby={hint ? `${id}-hint` : undefined} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <input id={id} className="name-input" value={value} maxLength={max} disabled={disabled} aria-describedby={hint ? `${id}-hint` : undefined} onChange={(event) => onChange(event.target.value)} autoComplete="off" />
      )}
    </div>
  );
}

function newPassword(): string {
  const letters = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((byte, index) => (index > 0 && index % 4 === 0 ? "-" : "") + letters[byte % letters.length]).join("");
}

function Editor({ start, onSaved, onCancel }: { start: Editing; onSaved(slug: string): void; onCancel(): void }) {
  const [config, setConfig] = useState<Campaign>(start.config);
  const [slugTouched, setSlugTouched] = useState(Boolean(start.config.slug));
  const [version, setVersion] = useState(0); // Bumped when a draft replaces the form, so list boxes reload.
  const [description, setDescription] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const [password, setPassword] = useState("");
  const [hasPassword, setHasPassword] = useState(start.hasPassword);
  const preview = useRef<HTMLDivElement | null>(null);
  const top = useRef<HTMLHeadingElement | null>(null);

  const set = <K extends keyof Campaign>(key: K, value: Campaign[K]) => setConfig((current) => ({ ...current, [key]: value }));
  const colorProblems = designProblems(config.design);

  useEffect(() => {
    if (preview.current && !colorProblems.length) applyDesign(config.design, preview.current);
  }, [config.design, colorProblems.length]);

  useEffect(() => top.current?.focus(), []);

  async function draft() {
    setDrafting(true);
    setProblems([]);
    try {
      const result = await api<{ draft: Record<string, unknown> }>("/api/review/admin/draft", sendJson("POST", { description }));
      // The draft fills the text. Colors, limits, and status keep whatever the form already has.
      const drafted = cleanCampaign({ ...config, ...result.draft, status: config.status, design: config.design });
      setConfig({ ...drafted, slug: slugTouched && config.slug ? config.slug : drafted.slug });
      setVersion((value) => value + 1);
      setNotice("Draft written. Read every field and edit it before saving. Nothing is live yet.");
    } catch (caught) {
      setProblems([caught instanceof Error ? caught.message : "The draft could not be written."]);
    } finally {
      setDrafting(false);
    }
  }

  async function save() {
    const cleaned = cleanCampaign(config);
    const found = campaignProblems(cleaned);
    setNotice("");
    if (found.length) {
      setProblems(found);
      top.current?.scrollIntoView();
      return;
    }
    setSaving(true);
    try {
      if (start.isNew) await api("/api/review/admin/campaigns", sendJson("POST", cleaned));
      else await api(`/api/review/admin/campaigns/${cleaned.slug}`, sendJson("PUT", cleaned));
      onSaved(cleaned.slug);
    } catch (caught) {
      setProblems([caught instanceof Error ? caught.message : "The campaign could not be saved."]);
      top.current?.scrollIntoView();
    } finally {
      setSaving(false);
    }
  }

  async function savePassword(value: string) {
    setNotice("");
    try {
      const result = await api<{ hasPassword: boolean }>(`/api/review/admin/campaigns/${config.slug}/password`, sendJson("POST", { password: value }));
      setHasPassword(result.hasPassword);
      setNotice(result.hasPassword ? `Password set: ${value}  Copy it now. It cannot be shown again.` : "Password removed.");
      setPassword("");
    } catch (caught) {
      setProblems([caught instanceof Error ? caught.message : "The password could not be saved."]);
    }
  }

  const questions = config.questions;
  const setQuestion = (index: number, patch: Partial<Question>) => set("questions", questions.map((question, i) => (i === index ? { ...question, ...patch } : question)));
  const moveQuestion = (index: number, by: number) => {
    const next = [...questions];
    const [moved] = next.splice(index, 1);
    next.splice(index + by, 0, moved);
    set("questions", next);
  };
  const categories = config.categories;
  const setCategory = (index: number, patch: Partial<Category>) => set("categories", categories.map((category, i) => (i === index ? { ...category, ...patch } : category)));
  const setColor = (key: "accent" | "action" | "highlight", value: string) => set("design", { ...config.design, [key]: value.trim().toLowerCase() });
  const cleanedForNotice = cleanCampaign(config);

  return (
    <div className="leadership admin">
      <button className="quiet-button" onClick={onCancel}>← Back to campaigns without saving</button>
      <h1 ref={top} tabIndex={-1}>{start.isNew ? "New campaign" : `Edit: ${start.config.title}`}</h1>
      {problems.length > 0 && <div className="notice" role="alert"><strong>Fix these before saving:</strong><ul>{problems.map((problem) => <li key={problem}>{problem}</li>)}</ul></div>}
      {notice && <p className="notice good" role="status">{notice}</p>}

      {start.isNew && (
        <section className="panel">
          <h2>Start from a description</h2>
          <p className="quiet">Optional. Describe the campaign in a few sentences: what it is about, who you want to hear from, what you want to learn, and who will read the results. AI drafts the fields below for you to edit.</p>
          <label htmlFor="describe" className="visually-hidden">Campaign description</label>
          <textarea id="describe" rows={5} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Example: An end-of-year check-in with faculty about their summer plans for course redesign, and how STELAR can help before fall. Results go to STELAR leadership." />
          <button className="primary" disabled={drafting || description.trim().length < 30} onClick={() => void draft()}>{drafting ? "Writing the draft…" : "Write a draft"}</button>
        </section>
      )}

      <section className="panel" key={`basics-${version}`}>
        <h2>1. Basics</h2>
        <Field id="title" label="Campaign name" hint="Shown to reviewers and in the browser tab." value={config.title} max={90} onChange={(value) => { set("title", value); if (start.isNew && !slugTouched) set("slug", slugify(value)); }} />
        <Field id="slug" label="Web address" hint={start.isNew ? `Participants will open ${window.location.origin}/c/${config.slug || "your-campaign"}. Lowercase letters, numbers, and hyphens. It cannot be changed later.` : `${window.location.origin}/c/${config.slug}. The address cannot be changed after creation.`} value={config.slug} max={40} disabled={!start.isNew} onChange={(value) => { setSlugTouched(true); set("slug", value.toLowerCase().replace(/[^a-z0-9-]/g, "-")); }} />
        <div className="two">
          <Field id="unit" label="Unit or project, short name" hint='As people say it, for example "STELAR" or "the VR/AR project".' value={config.unit} max={60} onChange={(value) => set("unit", value)} />
          <Field id="unitSpoken" label="How the guide should pronounce it" hint='Only if it is not obvious, for example "stellar".' value={config.unitSpoken} max={60} onChange={(value) => set("unitSpoken", value)} />
        </div>
        <fieldset className="field">
          <legend>Status</legend>
          <label className="inline"><input type="radio" name="status" checked={config.status === "closed"} onChange={() => set("status", "closed")} /> Closed. Only you can open it, through its preview link.</label>
          <label className="inline"><input type="radio" name="status" checked={config.status === "open"} onChange={() => set("status", "open")} /> Open. Anyone with the link can take part.</label>
        </fieldset>
      </section>

      <section className="panel" key={`page-${version}`}>
        <h2>2. What participants see</h2>
        <Field id="headline" label="Headline" hint="The large text on the banner. Eight words or fewer reads best." value={config.headline} max={90} onChange={(value) => set("headline", value)} />
        <Field id="invitation" label="Invitation" hint="One or two sentences under the headline. Say how long it takes." value={config.invitation} long={3} max={400} onChange={(value) => set("invitation", value)} />
        <div className="two">
          <Field id="unitFullName" label="Small line above the headline" hint="Optional. For example the unit's full name." value={config.unitFullName} max={140} onChange={(value) => set("unitFullName", value)} />
          <Field id="mastheadDetail" label="Label at the top right" value={config.mastheadDetail} max={50} onChange={(value) => set("mastheadDetail", value)} />
        </div>
        <div className="two">
          <Field id="heroWord" label="Word in the banner circle" hint="One short word, or leave empty to hide the circle." value={config.heroWord} max={9} onChange={(value) => set("heroWord", value.toUpperCase())} />
          <Field id="introHeading" label="Heading above the notice" value={config.introHeading} max={80} onChange={(value) => set("introHeading", value)} />
        </div>
        <Field id="purpose" label="Purpose statement" hint="Why you are collecting this. Participants read it before they start." value={config.purpose} long={3} max={500} onChange={(value) => set("purpose", value)} />
        <Field id="readers" label="Who reads the results" hint='Used in the notice, for example "STELAR leadership" or "the VR/AR project team".' value={config.readers} max={80} onChange={(value) => set("readers", value)} />
        <Lines id="extraNotice" label="Extra notice lines" hint="Optional, one per line. Added after the standard notice below." rows={3} value={config.extraNotice} onChange={(value) => set("extraNotice", value)} />
        <details className="standard-notice">
          <summary>Standard notice every participant sees (not editable)</summary>
          <ul>{buildNotice(cleanedForNotice).slice(0, 6).map((line) => <li key={line}>{line}</li>)}</ul>
          <p>{whoSeesResponses(cleanedForNotice)}</p>
          <p className="quiet small">These lines describe how the system handles data, so they are the same for every campaign.</p>
        </details>
        <Field id="thanksMessage" label="Message after submitting" value={config.thanksMessage} long={2} max={300} onChange={(value) => set("thanksMessage", value)} />
      </section>

      <section className="panel" key={`before-${version}`}>
        <h2>3. Before the conversation</h2>
        <p className="quiet">An optional warm-up question with choices. The guide uses the answer to make follow-ups specific, and it is saved with the response.</p>
        <Field id="contextPrompt" label="Warm-up question" value={config.contextPrompt} max={160} onChange={(value) => set("contextPrompt", value)} />
        <Lines id="contextOptions" label="Choices" hint="One per line. Leave empty to skip the warm-up." value={config.contextOptions} rows={6} onChange={(value) => set("contextOptions", value)} />
        <Lines id="roles" label="Role choices on the review screen" hint="One per line. Participants may leave it unanswered." value={config.roles} rows={5} onChange={(value) => set("roles", value)} />
      </section>

      <section className="panel" key={`talk-${version}`}>
        <h2>4. The conversation</h2>
        <Field id="goal" label="What the conversation is trying to learn" hint="Two sentences. The guide opens from this and stays on it. The analysis uses it too." value={config.goal} long={3} max={500} onChange={(value) => set("goal", value)} />
        <Field id="background" label="Background for the guide" hint="Context the guide should know about the project. Never shown or read to participants." value={config.background} long={5} max={3000} onChange={(value) => set("background", value)} />
        <h3>Questions</h3>
        <p className="quiet small">Three works best for a five to eight minute conversation. The guide asks them in order, probes vague answers for one example, then summarizes.</p>
        {questions.map((question, index) => (
          <fieldset key={index} className="repeat">
            <legend>Question {index + 1}</legend>
            <Field id={`ask-${index}`} label="Ask" hint="One sentence, as it should be spoken." value={question.ask} long={2} max={400} onChange={(value) => setQuestion(index, { ask: value })} />
            <Field id={`listen-${index}`} label="A useful answer includes" hint="Tells the guide what to probe for." value={question.listenFor} long={2} max={500} onChange={(value) => setQuestion(index, { listenFor: value })} />
            <div className="row-actions">
              <button className="quiet-button" disabled={index === 0} onClick={() => moveQuestion(index, -1)}>Move up</button>
              <button className="quiet-button" disabled={index === questions.length - 1} onClick={() => moveQuestion(index, 1)}>Move down</button>
              <button className="quiet-button" disabled={questions.length === 1} onClick={() => set("questions", questions.filter((_, i) => i !== index))}>Remove</button>
            </div>
          </fieldset>
        ))}
        <button className="secondary" disabled={questions.length >= 8} onClick={() => set("questions", [...questions, { id: `q${Date.now().toString(36)}`, ask: "", listenFor: "" }])}>Add a question</button>
        <div className="field narrow">
          <label htmlFor="maxMinutes">Time limit, in minutes</label>
          <input id="maxMinutes" className="name-input" type="number" min={5} max={20} value={config.maxMinutes} onChange={(event) => set("maxMinutes", Number(event.target.value))} />
        </div>
      </section>

      <section className="panel" key={`analysis-${version}`}>
        <h2>5. Analysis</h2>
        <p className="quiet">Each response is sorted into these categories, and each point is tagged with one theme. Two to four categories.</p>
        {categories.map((category, index) => (
          <fieldset key={index} className="repeat">
            <legend>Category {index + 1}</legend>
            <div className="two">
              <Field id={`cat-label-${index}`} label="Heading on the results page" value={category.label} max={60} onChange={(value) => setCategory(index, { label: value })} />
              <Field id={`cat-desc-${index}`} label="What belongs here" value={category.description} max={300} onChange={(value) => setCategory(index, { description: value })} />
            </div>
            <button className="quiet-button" disabled={categories.length <= 2} onClick={() => set("categories", categories.filter((_, i) => i !== index))}>Remove</button>
          </fieldset>
        ))}
        <button className="secondary" disabled={categories.length >= 4} onClick={() => set("categories", [...categories, { id: `c${Date.now().toString(36)}`, label: "", description: "" }])}>Add a category</button>
        {!start.isNew && start.responses > 0 && <p className="quiet small">This campaign has {start.responses} {start.responses === 1 ? "response" : "responses"}. After changing categories or themes, use "Code all responses again" on the results page.</p>}
        <Lines id="themes" label="Themes" hint='One per line, six to ten. "Other" is always added.' value={config.themes.filter((theme) => theme !== "Other")} rows={8} onChange={(value) => set("themes", value)} />
        <Lines id="vocabulary" label="Words the transcriber should expect" hint="Names, acronyms, and products, one per line." value={config.vocabulary} rows={5} onChange={(value) => set("vocabulary", value)} />
      </section>

      <section className="panel">
        <h2>6. Look</h2>
        <div className="three">
          {([["accent", "Main color"], ["action", "Button color"], ["highlight", "Highlight color"]] as const).map(([key, label]) => (
            <div className="field" key={key}>
              <label htmlFor={`color-${key}`}>{label}</label>
              <div className="color-row">
                <input type="color" aria-label={`${label} picker`} value={/^#[0-9a-f]{6}$/.test(config.design[key]) ? config.design[key] : "#000000"} onChange={(event) => setColor(key, event.target.value)} />
                <input id={`color-${key}`} className="name-input" value={config.design[key]} maxLength={7} onChange={(event) => setColor(key, event.target.value)} />
              </div>
            </div>
          ))}
        </div>
        <div className="field narrow">
          <label htmlFor="headingSize">Headline size</label>
          <select id="headingSize" className="name-input" value={config.design.headingSize} onChange={(event) => set("design", { ...config.design, headingSize: event.target.value as Campaign["design"]["headingSize"] })}>
            <option value="compact">Compact, for longer headlines</option>
            <option value="standard">Standard</option>
            <option value="large">Large, for very short headlines</option>
          </select>
        </div>
        {colorProblems.length > 0 && <div className="notice" role="alert"><ul>{colorProblems.map((problem) => <li key={problem}>{problem}</li>)}</ul></div>}
        <div ref={preview} className="design-preview" aria-label="Preview of the banner">
          <section className="hero">
            <div className="hero-copy">
              {config.unitFullName && <p className="eyebrow">{config.unitFullName}</p>}
              <h1 role="presentation">{config.headline || "Your headline"}</h1>
              <p>{config.invitation || "Your invitation text."}</p>
              <div className="hero-line" />
            </div>
            {config.heroWord && <div className="hero-mark" aria-hidden="true"><span>{config.heroWord}</span><b>→</b></div>}
          </section>
          <p><button className="primary" tabIndex={-1} type="button">Button</button> <span className="section-label">SECTION LABEL</span></p>
        </div>
      </section>

      <section className="panel">
        <h2>7. Limits</h2>
        <div className="two">
          <div className="field">
            <label htmlFor="retention">Delete transcripts after this many days</label>
            <input id="retention" className="name-input" type="number" min={30} max={1095} value={config.retentionDays} onChange={(event) => set("retentionDays", Number(event.target.value))} />
          </div>
          <div className="field">
            <label htmlFor="cap">Most conversations per day</label>
            <p className="quiet small hint">Protects your OpenAI budget if the link is misused.</p>
            <input id="cap" className="name-input" type="number" min={10} max={2000} value={config.dailySessionCap} onChange={(event) => set("dailySessionCap", Number(event.target.value))} />
          </div>
        </div>
      </section>

      {!start.isNew && (
        <section className="panel">
          <h2>8. Results access for this campaign</h2>
          <p className="quiet">Optional. A password that opens only this campaign's results, for a project lead or partner. {hasPassword ? "A password is set." : "No password is set, so only the admin and shared review passwords open these results."}</p>
          <label htmlFor="campaign-password">{hasPassword ? "Replace the password" : "Set a password"}</label>
          <div className="color-row">
            <input id="campaign-password" className="name-input" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="off" placeholder="At least 10 characters" />
            <button className="secondary" type="button" onClick={() => setPassword(newPassword())}>Suggest one</button>
          </div>
          <div className="row-actions">
            <button className="secondary" disabled={password.length < 10} onClick={() => void savePassword(password)}>Save password</button>
            {hasPassword && <button className="quiet-button" onClick={() => void savePassword("")}>Remove the password</button>}
          </div>
        </section>
      )}

      <div className="save-bar">
        <button className="secondary" onClick={onCancel}>Cancel</button>
        <button className="primary" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : start.isNew ? "Create campaign" : "Save changes"}</button>
      </div>
    </div>
  );
}

export default function Admin({ onClose, onSignOut }: { onClose(openSlug?: string): void; onSignOut(): void }) {
  const [campaigns, setCampaigns] = useState<AdminCampaign[] | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [confirmDelete, setConfirmDelete] = useState("");

  const load = () => api<{ campaigns: AdminCampaign[] }>("/api/review/admin/campaigns").then((result) => setCampaigns(result.campaigns)).catch((caught: Error) => setError(caught.message));
  useEffect(() => {
    document.title = "Campaigns | University of St. Thomas";
    void load();
  }, []);

  if (editing) {
    return <Editor start={editing} onCancel={() => setEditing(null)} onSaved={(slug) => { setEditing(null); setMessage(`Saved "${slug}".`); void load(); window.scrollTo({ top: 0 }); }} />;
  }

  const link = (slug: string) => `${window.location.origin}/c/${slug}`;

  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      setMessage(`${what} copied.`);
    } catch {
      setMessage(text);
    }
  }

  async function setStatus(item: AdminCampaign, status: Campaign["status"]) {
    setError("");
    await api(`/api/review/admin/campaigns/${item.config.slug}`, sendJson("PUT", { ...item.config, status })).then(() => setMessage(status === "open" ? `"${item.config.title}" is open. Share its link.` : `"${item.config.title}" is closed to new responses.`)).catch((caught: Error) => setError(caught.message));
    void load();
  }

  async function remove(slug: string) {
    setConfirmDelete("");
    await api(`/api/review/admin/campaigns/${slug}`, { method: "DELETE" }).then(() => setMessage("Campaign deleted.")).catch((caught: Error) => setError(caught.message));
    void load();
  }

  const duplicate = (item: AdminCampaign) => setEditing({ config: { ...item.config, slug: "", title: `${item.config.title} (copy)`, status: "closed" }, isNew: true, hasPassword: false, responses: 0 });

  return (
    <div className="leadership admin">
      <div className="toolbar">
        <div>
          <p className="section-label">CAMPAIGN SETUP</p>
          <h1>Campaigns</h1>
        </div>
        <div className="toolbar-actions">
          <button className="primary" onClick={() => setEditing({ config: blankCampaign(), isNew: true, hasPassword: false, responses: 0 })}>New campaign</button>
          <button className="secondary" onClick={() => onClose()}>View results</button>
          <button className="quiet-button" onClick={onSignOut}>Sign out</button>
        </div>
      </div>
      <p className="quiet">Each campaign has its own link, questions, and results. Create one from scratch, from a description, or by duplicating one that worked.</p>
      {error && <p className="notice" role="alert">{error}</p>}
      {message && <p className="notice good" role="status">{message}</p>}
      {!campaigns ? <p className="quiet" role="status">Loading…</p> : (
        <ul className="campaign-list">
          {campaigns.map((item) => (
            <li key={item.config.slug} className="panel">
              <div className="campaign-head">
                <h2>{item.config.title}</h2>
                <span className={item.config.status === "open" ? "badge open" : "badge"}>{item.config.status === "open" ? "Open" : "Closed"}</span>
              </div>
              <p className="quiet small">{item.responses} {item.responses === 1 ? "response" : "responses"} · {item.config.questions.length} {item.config.questions.length === 1 ? "question" : "questions"} · <a href={link(item.config.slug)}>{link(item.config.slug)}</a>{item.hasPassword ? " · has its own results password" : ""}</p>
              <div className="row-actions">
                <button className="secondary" onClick={() => setEditing({ config: item.config, isNew: false, hasPassword: item.hasPassword, responses: item.responses })}>Edit</button>
                <button className="secondary" onClick={() => onClose(item.config.slug)}>Results</button>
                <button className="secondary" onClick={() => void copy(link(item.config.slug), "Link")}>Copy link</button>
                {item.config.status === "closed" && <a className="secondary" href={`${link(item.config.slug)}?preview=${item.previewToken}`} target="_blank" rel="noreferrer">Preview and test</a>}
                <button className="secondary" onClick={() => duplicate(item)}>Duplicate</button>
                <button className="secondary" onClick={() => void setStatus(item, item.config.status === "open" ? "closed" : "open")}>{item.config.status === "open" ? "Close" : "Open"}</button>
                {item.responses === 0 && (confirmDelete === item.config.slug ? (
                  <span className="confirm">Delete this campaign? <button className="danger" onClick={() => void remove(item.config.slug)}>Yes, delete</button> <button className="secondary" onClick={() => setConfirmDelete("")}>Cancel</button></span>
                ) : <button className="quiet-button" onClick={() => setConfirmDelete(item.config.slug)}>Delete</button>)}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

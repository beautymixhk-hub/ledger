import { useEffect, useState } from "react";
import { api } from "../api.js";

export default function Replies() {
  const [replies, setReplies] = useState([]);
  const [leads, setLeads] = useState([]);
  const [leadId, setLeadId] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  async function load() {
    try {
      const [r, l] = await Promise.all([api.replies(), api.leads({ status: "contacted" })]);
      setReplies(r);
      setLeads(l.leads);
    } catch (err) {
      setMsg({ type: "bad", text: err.message });
    }
  }

  useEffect(() => { load(); }, []);

  async function submit() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await api.logReply({ leadId, text });
      setMsg({
        type: res.suppressed ? "bad" : "good",
        text: res.suppressed
          ? "Logged as an opt-out. This address has been permanently suppressed and won't be emailed again."
          : `Logged and classified as "${res.reply.sentiment.replace("_", " ")}".`,
      });
      setText("");
      setLeadId("");
      load();
    } catch (err) {
      setMsg({ type: "bad", text: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1 className="page-title">Replies</h1>
      <p className="lede">
        Paste in what a prospect wrote back. Claude classifies it, updates the lead's status, and tells you what to
        do next.
      </p>

      {msg && <div className={`note ${msg.type}`}>{msg.text}</div>}

      <div className="grid-2">
        <div className="panel">
          <h3>Log a reply</h3>
          <div className="field">
            <label className="label">Which lead replied?</label>
            <select className="select" value={leadId} onChange={(e) => setLeadId(e.target.value)}>
              <option value="">Select a lead…</option>
              {leads.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
            {leads.length === 0 && <div className="hint">No contacted leads yet.</div>}
          </div>
          <div className="field">
            <label className="label">What they wrote</label>
            <textarea className="textarea" rows={7} value={text} onChange={(e) => setText(e.target.value)}
                      placeholder="Paste the reply here…" />
          </div>
          <button className="btn plum" style={{ width: "100%" }} onClick={submit} disabled={busy || !leadId || !text.trim()}>
            {busy ? <><span className="spinner" /> Classifying…</> : "Log & classify"}
          </button>
          <div className="hint">
            Anything that reads as an opt-out is suppressed immediately and permanently, no matter how it's phrased.
          </div>
        </div>

        <div>
          {replies.length === 0 ? (
            <div className="panel empty">No replies logged yet.</div>
          ) : (
            replies.map((r) => (
              <div className="panel" key={r.id} style={{ marginBottom: 12 }}>
                <div className="spread" style={{ marginBottom: 8 }}>
                  <div>
                    <div style={{ fontFamily: "'Fraunces', serif", fontSize: 15, fontWeight: 600 }}>{r.lead_name}</div>
                    <div className="mono" style={{ fontSize: 11, color: "var(--ink-soft)" }}>{r.lead_email}</div>
                  </div>
                  <span className={`pill ${r.sentiment}`}>{r.sentiment.replace("_", " ")}</span>
                </div>
                {r.summary && <div style={{ fontSize: 13, marginBottom: 8 }}>{r.summary}</div>}
                {r.suggested_next_step && (
                  <div style={{ fontSize: 12.5, color: "var(--plum)", marginBottom: 10 }}>
                    <b>Next step:</b> {r.suggested_next_step}
                  </div>
                )}
                <details>
                  <summary style={{ fontSize: 11.5, color: "var(--ink-soft)", cursor: "pointer" }}>
                    Original message
                  </summary>
                  <div className="pre" style={{ marginTop: 8 }}>{r.raw_text}</div>
                </details>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}

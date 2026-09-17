import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../api.js";

export default function CampaignDetail() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirmSend, setConfirmSend] = useState(false);

  async function load() {
    try {
      setData(await api.campaign(id));
    } catch (err) {
      setMsg({ type: "bad", text: err.message });
    }
  }

  useEffect(() => { load(); }, [id]);

  async function saveDraft(emailId, patch) {
    try {
      await api.updateEmail(emailId, patch);
      setData((d) => ({
        ...d,
        emails: d.emails.map((e) => (e.id === emailId ? { ...e, ...patch } : e)),
      }));
    } catch (err) {
      setMsg({ type: "bad", text: err.message });
    }
  }

  async function approveAll() {
    setBusy(true);
    try {
      const res = await api.approveAll(id);
      setMsg({ type: "good", text: `${res.approved} emails approved and ready to send.` });
      load();
    } catch (err) {
      setMsg({ type: "bad", text: err.message });
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    setBusy(true);
    setConfirmSend(false);
    setMsg(null);
    try {
      const res = await api.sendCampaign(id);
      setMsg({
        type: res.failed ? "bad" : "good",
        text: `Sent ${res.sent}. Skipped ${res.skipped}. Failed ${res.failed}.`,
      });
      load();
    } catch (err) {
      setMsg({ type: "bad", text: err.message });
    } finally {
      setBusy(false);
    }
  }

  if (!data) return <div className="empty"><span className="spinner" /> Loading…</div>;

  const { campaign, emails } = data;
  const drafts = emails.filter((e) => e.status === "draft");
  const approved = emails.filter((e) => e.status === "approved");
  const sent = emails.filter((e) => e.status === "sent");

  return (
    <>
      <div className="spread">
        <div>
          <h1 className="page-title">{campaign.name}</h1>
          <p className="lede">
            <Link to="/campaigns" style={{ color: "var(--plum)" }}>← All campaigns</Link>
            {"  ·  "}{campaign.tone}
          </p>
        </div>
        <span className={`pill ${campaign.status}`}>{campaign.status}</span>
      </div>

      {msg && <div className={`note ${msg.type}`}>{msg.text}</div>}

      <div className="stat-grid">
        <div className="stat"><div className="n">{drafts.length}</div><div className="k">Awaiting review</div></div>
        <div className="stat"><div className="n">{approved.length}</div><div className="k">Approved</div></div>
        <div className="stat"><div className="n">{sent.length}</div><div className="k">Sent</div></div>
        <div className="stat">
          <div className="n">{sent.reduce((a, e) => a + (e.opens || 0), 0)}</div>
          <div className="k">Opens</div>
        </div>
      </div>

      <div className="row" style={{ marginBottom: 18 }}>
        <button className="btn ghost" onClick={approveAll} disabled={busy || !drafts.length}>
          Approve all {drafts.length ? `(${drafts.length})` : ""}
        </button>
        <button className="btn plum" onClick={() => setConfirmSend(true)} disabled={busy || !approved.length}>
          {busy ? <><span className="spinner" /> Sending…</> : `Send ${approved.length} approved`}
        </button>
      </div>

      {confirmSend && (
        <div className="panel" style={{ marginBottom: 18, borderColor: "var(--plum)" }}>
          <h3>Send {approved.length} emails?</h3>
          <p style={{ fontSize: 13, lineHeight: 1.6, color: "var(--ink-soft)", marginTop: 0 }}>
            These go out to real businesses from your verified domain. Anyone who has unsubscribed or previously
            bounced is skipped automatically. Each message includes your postal address and a working unsubscribe
            link, as US law requires.
          </p>
          <div className="row">
            <button className="btn plum" onClick={send}>Yes, send them</button>
            <button className="btn ghost" onClick={() => setConfirmSend(false)}>Cancel</button>
          </div>
        </div>
      )}

      {emails.map((e) => (
        <EmailCard key={e.id} email={e} onSave={saveDraft} />
      ))}

      {emails.length === 0 && <div className="panel empty">No emails in this campaign.</div>}
    </>
  );
}

function EmailCard({ email, onSave }) {
  const [subject, setSubject] = useState(email.subject);
  const [body, setBody] = useState(email.body);
  const [dirty, setDirty] = useState(false);
  const editable = email.status === "draft" || email.status === "approved";

  return (
    <div className="mail-card">
      <div className="mail-head">
        <div>
          <div style={{ fontFamily: "'Fraunces', serif", fontSize: 15, fontWeight: 600 }}>{email.lead_name}</div>
          <div className="mono" style={{ fontSize: 11.5, color: "var(--ink-soft)", marginTop: 2 }}>
            {email.to_email}
            {email.lead_location ? ` · ${email.lead_location}` : ""}
          </div>
        </div>
        <div className="row">
          {email.status === "sent" && (
            <span className="mono" style={{ fontSize: 11, color: "var(--ink-soft)" }}>
              {email.opens || 0} opens · {email.clicks || 0} clicks
            </span>
          )}
          <span className={`pill ${email.status}`}>{email.status}</span>
        </div>
      </div>

      <div className="mail-body">
        {email.error && <div className="note bad" style={{ marginBottom: 12 }}>{email.error}</div>}

        <div className="field">
          <label className="label">Subject</label>
          <input className="input" value={subject} disabled={!editable}
                 onChange={(e) => { setSubject(e.target.value); setDirty(true); }} />
        </div>
        <div className="field">
          <label className="label">Message</label>
          <textarea className="textarea" rows={5} value={body} disabled={!editable}
                    onChange={(e) => { setBody(e.target.value); setDirty(true); }} />
          <div className="hint">
            Your product spec, signature, postal address and unsubscribe link are appended automatically when this sends.
          </div>
        </div>

        {editable && (
          <div className="row">
            <button className="btn ghost sm" disabled={!dirty}
                    onClick={() => { onSave(email.id, { subject, body }); setDirty(false); }}>
              {dirty ? "Save changes" : "Saved"}
            </button>
            {email.status === "draft" && (
              <button className="btn sm" onClick={() => onSave(email.id, { subject, body, status: "approved" })}>
                Approve
              </button>
            )}
            {email.status === "approved" && (
              <button className="btn ghost sm" onClick={() => onSave(email.id, { status: "draft" })}>
                Unapprove
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

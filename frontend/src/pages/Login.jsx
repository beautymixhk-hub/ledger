import { useState } from "react";
import { api, setToken } from "../api.js";

export default function Login({ onAuth }) {
  const [form, setForm] = useState({ email: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit() {
    setBusy(true);
    setError("");
    try {
      const res = await api.login(form);
      setToken(res.token);
      const session = await api.me();
      onAuth(session);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e) {
    if (e.key === "Enter") submit();
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="brand">Ledger<span>.</span></div>

        {/* Public sign-up is intentionally not offered here — it would let
            anyone create their own company account on this infrastructure.
            New teammates are added by an admin in Settings instead. */}

        <div className="field">
          <label className="label">Work email</label>
          <input className="input" type="email" value={form.email} onChange={set("email")} onKeyDown={onKeyDown} />
        </div>
        <div className="field">
          <label className="label">Password</label>
          <input className="input" type="password" value={form.password} onChange={set("password")} onKeyDown={onKeyDown} />
        </div>

        {error && <div className="note bad">{error}</div>}

        <button className="btn plum" style={{ width: "100%" }} onClick={submit} disabled={busy}>
          {busy ? <><span className="spinner" /> Working…</> : "Sign in"}
        </button>
      </div>
    </div>
  );
}

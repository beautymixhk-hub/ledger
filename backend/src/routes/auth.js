import express from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { query, transaction } from "../db.js";
import { signToken, requireAuth, requireAdmin } from "../middleware/auth.js";

const router = express.Router();

const registerSchema = z.object({
  orgName: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
  email: z.string().email(),
  password: z.string().min(10, "Password must be at least 10 characters"),
});

/** Create a new org + its first admin user.
 *  Disabled by default: this creates a BRAND NEW company account, not a
 *  teammate under an existing one (that's POST /team, admin-only). Without
 *  this gate, anyone who finds the public site can spin up their own org
 *  on your infrastructure and run up your AI/email API bills. Set
 *  ALLOW_SIGNUP=true in your environment only if you actually want the
 *  public "Create account" flow open (e.g. you're offering Ledger itself
 *  as a product to other companies). */
router.post("/register", async (req, res) => {
  if (process.env.ALLOW_SIGNUP !== "true") {
    return res.status(403).json({ error: "Public sign-up is disabled. Ask your admin to add you as a teammate instead." });
  }

  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0].message });
  }
  const { orgName, name, email, password } = parsed.data;

  try {
    const result = await transaction(async (c) => {
      const exists = await c.query(`SELECT 1 FROM users WHERE lower(email)=lower($1)`, [email]);
      if (exists.rows.length) throw new Error("That email is already registered");

      const org = await c.query(`INSERT INTO orgs (name, reply_to_email) VALUES ($1,$2) RETURNING *`, [
        orgName,
        email,
      ]);
      const hash = await bcrypt.hash(password, 12);
      const user = await c.query(
        `INSERT INTO users (org_id, email, password_hash, name, role)
         VALUES ($1,$2,$3,$4,'admin')
         RETURNING id, org_id, email, name, role`,
        [org.rows[0].id, email, hash, name]
      );

      // Give every new org a starter product record to edit.
      await c.query(
        `INSERT INTO products (org_id, name, tagline, summary, specs)
         VALUES ($1, 'Untitled product', '', '', '[]'::jsonb)`,
        [org.rows[0].id]
      );

      return user.rows[0];
    });

    res.json({ token: signToken(result), user: result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post("/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "Email and password required" });

  const { rows } = await query(
    `SELECT id, org_id, email, name, role, password_hash FROM users WHERE lower(email)=lower($1)`,
    [email]
  );
  const user = rows[0];
  // Same message either way so this can't be used to enumerate accounts.
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: "Incorrect email or password" });
  }

  delete user.password_hash;
  res.json({ token: signToken(user), user });
});

router.get("/me", requireAuth, async (req, res) => {
  const { rows } = await query(`SELECT * FROM orgs WHERE id=$1`, [req.user.org_id]);
  res.json({ user: req.user, org: rows[0] });
});

/** Admin invites a teammate into the same org. */
router.post("/team", requireAuth, requireAdmin, async (req, res) => {
  const schema = z.object({
    name: z.string().min(1),
    email: z.string().email(),
    password: z.string().min(10),
    role: z.enum(["admin", "member"]).default("member"),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });

  try {
    const hash = await bcrypt.hash(parsed.data.password, 12);
    const { rows } = await query(
      `INSERT INTO users (org_id, email, password_hash, name, role)
       VALUES ($1,$2,$3,$4,$5) RETURNING id, email, name, role`,
      [req.user.org_id, parsed.data.email, hash, parsed.data.name, parsed.data.role]
    );
    res.json(rows[0]);
  } catch {
    res.status(400).json({ error: "That email is already registered" });
  }
});

router.get("/team", requireAuth, async (req, res) => {
  const { rows } = await query(
    `SELECT id, name, email, role, created_at FROM users WHERE org_id=$1 ORDER BY created_at`,
    [req.user.org_id]
  );
  res.json(rows);
});

/** Admin removes a teammate. Two safety checks: can't remove yourself (use
 *  another admin's account for that), and can't remove the org's last admin
 *  (that would lock everyone in the org out permanently). */
router.delete("/team/:userId", requireAuth, requireAdmin, async (req, res) => {
  const { userId } = req.params;

  if (userId === req.user.id) {
    return res.status(400).json({ error: "You can't remove your own account. Ask another admin to do it." });
  }

  const { rows: target } = await query(
    `SELECT id, role FROM users WHERE id=$1 AND org_id=$2`,
    [userId, req.user.org_id]
  );
  if (!target[0]) return res.status(404).json({ error: "Teammate not found" });

  if (target[0].role === "admin") {
    const { rows: adminCount } = await query(
      `SELECT count(*)::int AS n FROM users WHERE org_id=$1 AND role='admin'`,
      [req.user.org_id]
    );
    if (adminCount[0].n <= 1) {
      return res.status(400).json({ error: "Can't remove the last admin — promote someone else first." });
    }
  }

  await query(`DELETE FROM users WHERE id=$1 AND org_id=$2`, [userId, req.user.org_id]);
  res.json({ ok: true });
});

/** Update org settings — postal address is required before any sending. */
router.put("/org", requireAuth, requireAdmin, async (req, res) => {
  const { name, postal_address, reply_to_email, ai_provider } = req.body || {};
  if (ai_provider && !["claude", "openai"].includes(ai_provider)) {
    return res.status(400).json({ error: "ai_provider must be 'claude' or 'openai'" });
  }
  const { rows } = await query(
    `UPDATE orgs SET name=COALESCE($2,name), postal_address=$3, reply_to_email=$4,
            ai_provider=COALESCE($5, ai_provider)
     WHERE id=$1 RETURNING *`,
    [req.user.org_id, name, postal_address || null, reply_to_email || null, ai_provider || null]
  );
  res.json(rows[0]);
});

export default router;

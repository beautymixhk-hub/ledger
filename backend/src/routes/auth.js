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

/** Create a new org + its first admin user. */
router.post("/register", async (req, res) => {
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

/** Update org settings — postal address is required before any sending. */
router.put("/org", requireAuth, requireAdmin, async (req, res) => {
  const { name, postal_address, reply_to_email } = req.body || {};
  const { rows } = await query(
    `UPDATE orgs SET name=COALESCE($2,name), postal_address=$3, reply_to_email=$4
     WHERE id=$1 RETURNING *`,
    [req.user.org_id, name, postal_address || null, reply_to_email || null]
  );
  res.json(rows[0]);
});

export default router;

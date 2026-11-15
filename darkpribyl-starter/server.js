import "dotenv/config";
import express from "express";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;
const app = express();
const port = Number(process.env.PORT || 3000);
const botToken = process.env.TELEGRAM_BOT_TOKEN;
const databaseUrl = process.env.DATABASE_URL;

if (!botToken || !databaseUrl) {
  throw new Error("Set TELEGRAM_BOT_TOKEN and DATABASE_URL in .env");
}

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: process.env.PGSSLMODE === "require" ? { rejectUnauthorized: false } : undefined
});

app.use(express.json({ limit: "20kb" }));

function verifyTelegramInitData(initData) {
  if (!initData || typeof initData !== "string") {
    throw new Error("Telegram authorization data is missing");
  }

  const params = new URLSearchParams(initData);
  const receivedHash = params.get("hash");
  if (!receivedHash) throw new Error("Telegram authorization hash is missing");

  params.delete("hash");
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(botToken)
    .digest();

  const calculatedHash = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  const a = Buffer.from(calculatedHash, "hex");
  const b = Buffer.from(receivedHash, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new Error("Telegram authorization data is invalid");
  }

  const authDate = Number(params.get("auth_date"));
  const now = Math.floor(Date.now() / 1000);
  if (!authDate || now - authDate > 86400 || authDate > now + 60) {
    throw new Error("Telegram authorization data has expired");
  }

  const userRaw = params.get("user");
  if (!userRaw) throw new Error("Telegram user data is missing");
  const user = JSON.parse(userRaw);
  if (!user.id) throw new Error("Telegram user ID is missing");
  return { id: String(user.id), firstName: user.first_name || "Пользователь" };
}

function requireTelegramUser(req, res, next) {
  try {
    req.telegramUser = verifyTelegramInitData(req.get("X-Telegram-Init-Data"));
    next();
  } catch (error) {
    res.status(401).json({ error: error.message || "Unauthorized" });
  }
}

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.get("/api/operations", requireTelegramUser, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT id, title, kind, amount, created_at
       FROM finance_operations
       WHERE telegram_user_id = $1
       ORDER BY created_at DESC
       LIMIT 300`,
      [req.telegramUser.id]
    );
    res.json({ operations: result.rows });
  } catch (error) {
    next(error);
  }
});

app.post("/api/operations", requireTelegramUser, async (req, res, next) => {
  try {
    const title = String(req.body?.title || "").trim().slice(0, 80);
    const kind = req.body?.kind;
    const amount = Number(req.body?.amount);

    if (!title) return res.status(400).json({ error: "Укажите название операции" });
    if (!["income", "expense"].includes(kind)) {
      return res.status(400).json({ error: "Неверный тип операции" });
    }
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1000000000) {
      return res.status(400).json({ error: "Проверьте сумму" });
    }

    const result = await pool.query(
      `INSERT INTO finance_operations (telegram_user_id, title, kind, amount)
       VALUES ($1, $2, $3, $4)
       RETURNING id, title, kind, amount, created_at`,
      [req.telegramUser.id, title, kind, amount]
    );
    res.status(201).json({ operation: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/operations/:id", requireTelegramUser, async (req, res, next) => {
  try {
    const result = await pool.query(
      `DELETE FROM finance_operations
       WHERE id = $1 AND telegram_user_id = $2
       RETURNING id`,
      [req.params.id, req.telegramUser.id]
    );
    if (!result.rowCount) return res.status(404).json({ error: "Операция не найдена" });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: "Внутренняя ошибка сервера" });
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.join(__dirname, "dist");
app.use(express.static(distPath));
app.get("*", (_req, res) => res.sendFile(path.join(distPath, "index.html")));

app.listen(port, () => console.log(`DARKприбыль listening on ${port}`));

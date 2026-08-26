import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import express from "express";
import multer from "multer";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "data");
const LISTINGS_DIR = path.join(ROOT, "public", "listings");
const LISTINGS_JSON = path.join(ROOT, "public", "listings.json");
const TOKEN_PATH = path.join(DATA, "sell-token.txt");

fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(LISTINGS_DIR, { recursive: true });
if (!fs.existsSync(LISTINGS_JSON)) {
  fs.writeFileSync(LISTINGS_JSON, `${JSON.stringify({ items: [] }, null, 2)}\n`);
}

function sellToken() {
  if (!fs.existsSync(TOKEN_PATH)) {
    const token = crypto.randomBytes(24).toString("hex");
    fs.writeFileSync(TOKEN_PATH, token);
    return token;
  }
  return fs.readFileSync(TOKEN_PATH, "utf8").trim();
}

function git(args) {
  return spawnSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
  });
}

function gitError(result, fallback) {
  const text = `${result.stderr || ""}${result.stdout || ""}`.trim();
  return text || fallback;
}

function publishToGithub(filename, name) {
  const files = ["public/listings.json", `public/listings/${filename}`];
  const add = git(["add", "--", ...files]);
  if (add.status !== 0) throw new Error(gitError(add, "git add fallito"));

  const commit = git(["commit", "-m", `List ${name}`]);
  const commitOut = `${commit.stdout || ""}${commit.stderr || ""}`;
  if (commit.status !== 0 && !commitOut.includes("nothing to commit")) {
    throw new Error(gitError(commit, "git commit fallito"));
  }

  const pull = git(["pull", "--rebase", "--autostash", "origin", "main"]);
  if (pull.status !== 0) {
    const pulled = `${pull.stdout || ""}${pull.stderr || ""}`;
    if (!pulled.includes("There is no tracking information") && !pulled.includes("unborn")) {
      console.warn(pulled);
    }
  }

  const push = git(["push", "origin", "HEAD:main"]);
  if (push.status !== 0) {
    throw new Error(
      gitError(push, "git push fallito") +
        " — fai login a GitHub e riprova.",
    );
  }
}

const token = sellToken();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});

const app = express();
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "x-sell-key, content-type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/publish", upload.single("photo"), (req, res) => {
  try {
    if (req.get("x-sell-key") !== token) {
      res.status(403).json({ error: "Apri sell-item.bat per vendere" });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: "Trascina una foto" });
      return;
    }
    const name = String(req.body.name || "").trim();
    const price = Number(req.body.price);
    const value = Number(req.body.value);
    const paypal = String(req.body.paypal || "").trim();
    const roblox = "";
    const robuxPrice = 0;
    if (!name || !Number.isFinite(price) || price <= 0) {
      res.status(400).json({ error: "Nome e prezzo obbligatori" });
      return;
    }
    if (!paypal.includes("@")) {
      res.status(400).json({ error: "Inserisci l'email PayPal" });
      return;
    }

    const id = `itm-${Date.now().toString(36)}`;
    const ext = path.extname(req.file.originalname || "").toLowerCase() || ".png";
    const filename = `${id}${ext}`;
    fs.writeFileSync(path.join(LISTINGS_DIR, filename), req.file.buffer);

    const store = JSON.parse(fs.readFileSync(LISTINGS_JSON, "utf8"));
    const item = {
      id,
      name,
      price,
      value: Number.isFinite(value) ? value : 0,
      image: `listings/${filename}`,
      paypal,
      roblox,
      robuxPrice: 0,
      sellerDiscordId: String(req.body.sellerDiscordId || ""),
      sellerName: String(req.body.sellerName || "seller"),
      sold: false,
      createdAt: Date.now(),
    };
    store.items = [item, ...(store.items || [])];
    fs.writeFileSync(LISTINGS_JSON, `${JSON.stringify(store, null, 2)}\n`);

    publishToGithub(filename, name);
    res.json({ item });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Errore pubblicazione" });
  }
});

function keepAlive(message) {
  console.log(message);
  setInterval(() => {}, 1 << 30);
}

function start() {
  const server = app.listen(8787, "127.0.0.1", () => {
    console.log("Seller pronto su http://127.0.0.1:8787");
    console.log("Lascia aperta questa finestra mentre vendi.");
    console.log("Il form e' nel BROWSER, non qui.");
  });
  server.on("error", (err) => {
    if (err && err.code === "EADDRINUSE") {
      keepAlive("Seller gia' attivo sulla 8787. Lascia aperta quella finestra.");
      return;
    }
    console.error(err);
    process.exit(1);
  });
}

http
  .get("http://127.0.0.1:8787/health", (res) => {
    res.resume();
    keepAlive("Seller gia' attivo sulla 8787. Lascia aperta quella finestra.");
  })
  .on("error", () => start());

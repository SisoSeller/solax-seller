import crypto from "node:crypto";
import fs from "node:fs";
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

function sellToken() {
  if (!fs.existsSync(TOKEN_PATH)) {
    const token = crypto.randomBytes(24).toString("hex");
    fs.writeFileSync(TOKEN_PATH, token);
    return token;
  }
  return fs.readFileSync(TOKEN_PATH, "utf8").trim();
}

const token = sellToken();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});

const app = express();
app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "x-sell-key, content-type");
  next();
});

app.options("/publish", (_req, res) => res.sendStatus(204));

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
    const roblox = String(req.body.roblox || "").trim();
    const robuxPrice = Number(req.body.robuxPrice || 0);
    if (!name || !Number.isFinite(price) || price <= 0) {
      res.status(400).json({ error: "Nome e prezzo obbligatori" });
      return;
    }
    if (!paypal && !roblox) {
      res.status(400).json({ error: "Inserisci PayPal e/o username Roblox" });
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
      robuxPrice: robuxPrice > 0 ? robuxPrice : Math.round(price * 80),
      sellerDiscordId: String(req.body.sellerDiscordId || ""),
      sellerName: String(req.body.sellerName || "seller"),
      sold: false,
      createdAt: Date.now(),
    };
    store.items = [item, ...(store.items || [])];
    fs.writeFileSync(LISTINGS_JSON, JSON.stringify(store, null, 2));

    const add = spawnSync("git", ["add", "public/listings.json", `public/listings/${filename}`], {
      cwd: ROOT,
      encoding: "utf8",
    });
    if (add.status !== 0) {
      res.status(500).json({ error: add.stderr || "git add fallito" });
      return;
    }
    const commit = spawnSync("git", ["commit", "-m", `List ${name}`], {
      cwd: ROOT,
      encoding: "utf8",
    });
    if (commit.status !== 0 && !String(commit.stdout + commit.stderr).includes("nothing to commit")) {
      res.status(500).json({ error: commit.stderr || "git commit fallito" });
      return;
    }
    const push = spawnSync("git", ["push", "origin", "main"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    if (push.status !== 0) {
      res.status(500).json({ error: push.stderr || "git push fallito" });
      return;
    }

    res.json({ item });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Errore pubblicazione" });
  }
});

app.listen(8787, "127.0.0.1", () => {
  console.log("Seller locale su http://127.0.0.1:8787");
  console.log(`Token in ${path.relative(ROOT, TOKEN_PATH)}`);
});

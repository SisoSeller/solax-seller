import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import session from "express-session";
import multer from "multer";
import {
  ROOT,
  TOKEN_PATH,
  UPLOADS_DIR,
  discordAvatar,
  getSellToken,
  invoiceId,
  loadConfig,
  loadStore,
  saveConfig,
  saveStore,
} from "./store.js";
import { sendInvoiceWebhook } from "./webhook.js";

fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const PORT = Number(process.env.PORT) || 3001;
const ORIGIN = `http://localhost:5173`;
const sellToken = getSellToken();

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || "").toLowerCase() || ".png";
      cb(null, `${Date.now()}-${Math.random().toString(16).slice(2)}${ext}`);
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      cb(new Error("Solo immagini"));
      return;
    }
    cb(null, true);
  },
});

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use("/uploads", express.static(UPLOADS_DIR));

app.use(
  session({
    name: "solax.sid",
    secret: process.env.SESSION_SECRET || "solax-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 24 * 30,
    },
  }),
);

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.global_name || user.username,
    tag: user.username,
    avatar: discordAvatar(user),
  };
}

function requireAuth(req, res, next) {
  if (!req.session.user) {
    res.status(401).json({ error: "Devi accedere con Discord" });
    return;
  }
  next();
}

function requireSellKey(req, res, next) {
  const key = req.get("x-sell-key") || req.query.key || req.body?.key;
  if (!key || key !== sellToken) {
    res.status(403).json({ error: "Serve sell-item.bat per mettere in vendita" });
    return;
  }
  next();
}

function redirectUri() {
  return `${ORIGIN}/api/auth/discord/callback`;
}

app.get("/api/config", (_req, res) => {
  const config = loadConfig();
  res.json({
    discordReady: Boolean(config.discordClientId && config.discordClientSecret),
    ticketUrl: config.discordTicketUrl || "",
  });
});

app.post("/api/setup", (req, res) => {
  const { discordClientId, discordClientSecret, discordTicketUrl } = req.body || {};
  if (!discordClientId || !discordClientSecret) {
    res.status(400).json({ error: "Client ID e Secret Discord obbligatori" });
    return;
  }
  saveConfig({
    discordClientId: String(discordClientId).trim(),
    discordClientSecret: String(discordClientSecret).trim(),
    discordTicketUrl: String(discordTicketUrl || "").trim(),
  });
  res.json({ ok: true });
});

app.get("/api/auth/discord", (req, res) => {
  const config = loadConfig();
  if (!config.discordClientId || !config.discordClientSecret) {
    res.redirect(`${ORIGIN}/?needSetup=1`);
    return;
  }
  const next = encodeURIComponent(req.query.next || "/");
  const url = new URL("https://discord.com/api/oauth2/authorize");
  url.searchParams.set("client_id", config.discordClientId);
  url.searchParams.set("redirect_uri", redirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "identify");
  url.searchParams.set("state", next);
  res.redirect(url.toString());
});

app.get("/api/auth/discord/callback", async (req, res) => {
  const config = loadConfig();
  const code = req.query.code;
  const next = decodeURIComponent(String(req.query.state || "/"));
  if (!code) {
    res.redirect(`${ORIGIN}/?login=error`);
    return;
  }

  try {
    const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.discordClientId,
        client_secret: config.discordClientSecret,
        grant_type: "authorization_code",
        code: String(code),
        redirect_uri: redirectUri(),
      }),
    });
    const token = await tokenRes.json();
    if (!token.access_token) {
      res.redirect(`${ORIGIN}/?login=error`);
      return;
    }

    const meRes = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${token.access_token}` },
    });
    const me = await meRes.json();
    req.session.user = me;

    const store = loadStore();
    store.users[me.id] = {
      id: me.id,
      username: me.username,
      global_name: me.global_name,
      avatar: me.avatar,
    };
    saveStore(store);

    const safeNext = next.startsWith("/") ? next : "/";
    res.redirect(`${ORIGIN}${safeNext}`);
  } catch {
    res.redirect(`${ORIGIN}/?login=error`);
  }
});

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

app.get("/api/me", (req, res) => {
  res.json({ user: publicUser(req.session.user) });
});

app.get("/api/items", (_req, res) => {
  const store = loadStore();
  res.json({
    items: store.items.filter((item) => !item.sold),
  });
});

app.post("/api/items", requireAuth, requireSellKey, upload.single("photo"), (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "Trascina una foto dell'arma" });
    return;
  }
  const name = String(req.body.name || "").trim();
  const price = Number(req.body.price);
  const value = Number(req.body.value);
  const paypal = String(req.body.paypal || "").trim();
  const roblox = String(req.body.roblox || "").trim();
  const robuxPrice = Number(req.body.robuxPrice || 0);
  if (!name || !Number.isFinite(price) || price <= 0 || !Number.isFinite(value) || value < 0) {
    fs.unlinkSync(req.file.path);
    res.status(400).json({ error: "Nome, prezzo e value sono obbligatori" });
    return;
  }
  if (!paypal && !roblox) {
    fs.unlinkSync(req.file.path);
    res.status(400).json({ error: "Inserisci PayPal e/o username Roblox del venditore" });
    return;
  }

  const store = loadStore();
  const item = {
    id: `itm-${Date.now().toString(36)}`,
    name,
    price,
    value,
    image: `/uploads/${req.file.filename}`,
    paypal,
    roblox,
    robuxPrice: robuxPrice > 0 ? robuxPrice : Math.round(price * 80),
    sellerDiscordId: req.session.user.id,
    sellerName: req.session.user.global_name || req.session.user.username,
    sold: false,
    createdAt: Date.now(),
  };
  store.items.unshift(item);
  saveStore(store);
  res.json({ item });
});

app.get("/api/orders", requireAuth, (req, res) => {
  const store = loadStore();
  const orders = store.orders.filter((o) => o.buyerDiscordId === req.session.user.id);
  res.json({ orders });
});

app.post("/api/orders", requireAuth, (req, res) => {
  const { itemIds, method, hasPlus } = req.body || {};
  if (!Array.isArray(itemIds) || itemIds.length === 0) {
    res.status(400).json({ error: "Carrello vuoto" });
    return;
  }
  if (method !== "paypal" && method !== "robux") {
    res.status(400).json({ error: "Scegli PayPal o Robux" });
    return;
  }
  if (method === "robux" && !hasPlus) {
    res.status(400).json({ error: "Per pagare in Robux serve Roblox Plus" });
    return;
  }

  const store = loadStore();
  const selected = [];
  for (const id of itemIds) {
    const item = store.items.find((i) => i.id === id && !i.sold);
    if (!item) {
      res.status(400).json({ error: "Un'arma non è più disponibile" });
      return;
    }
    if (method === "paypal" && !item.paypal) {
      res.status(400).json({ error: `${item.name} non accetta PayPal` });
      return;
    }
    if (method === "robux" && !item.roblox) {
      res.status(400).json({ error: `${item.name} non accetta Robux` });
      return;
    }
    selected.push(item);
  }

  const totalEur = selected.reduce((n, item) => n + item.price, 0);
  const totalRobux = selected.reduce((n, item) => n + item.robuxPrice, 0);
  const invoice = invoiceId();
  const order = {
    invoice,
    buyerDiscordId: req.session.user.id,
    buyerUsername: req.session.user.global_name || req.session.user.username,
    method,
    hasPlus: Boolean(hasPlus),
    status: "awaiting_payment",
    totalEur,
    totalRobux,
    items: selected.map((item) => ({
      id: item.id,
      name: item.name,
      price: item.price,
      robuxPrice: item.robuxPrice,
      paypal: item.paypal,
      roblox: item.roblox,
      image: item.image,
    })),
    createdAt: Date.now(),
  };

  store.orders.unshift(order);
  saveStore(store);
  res.json({ order, ticketUrl: loadConfig().discordTicketUrl || "" });
});

app.post("/api/orders/:invoice/paid", requireAuth, async (req, res) => {
  const store = loadStore();
  const order = store.orders.find(
    (o) => o.invoice === req.params.invoice && o.buyerDiscordId === req.session.user.id,
  );
  if (!order) {
    res.status(404).json({ error: "Fattura non trovata" });
    return;
  }
  if (order.status === "paid") {
    res.json({ order, already: true });
    return;
  }

  const paymentNote = String(req.body.paymentNote || "").trim();
  order.status = "paid";
  order.paidAt = Date.now();
  order.paymentNote = paymentNote;

  for (const line of order.items) {
    const item = store.items.find((i) => i.id === line.id);
    if (item) item.sold = true;
  }
  saveStore(store);

  const totalLabel =
    order.method === "robux"
      ? `${order.totalRobux} R$`
      : new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(
          order.totalEur,
        );

  await sendInvoiceWebhook({
    invoice: order.invoice,
    discordId: order.buyerDiscordId,
    discordTag: order.buyerUsername,
    method: order.method,
    totalLabel,
    paymentNote,
    items: order.items.map((item) => ({
      name: item.name,
      priceLabel:
        order.method === "robux"
          ? `${item.robuxPrice} R$`
          : new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(
              item.price,
            ),
    })),
  });

  res.json({ order });
});

app.use((err, _req, res, _next) => {
  res.status(400).json({ error: err.message || "Errore" });
});

app.listen(PORT, () => {
  console.log(`Solax API su http://localhost:${PORT}`);
  console.log(`Token vendita in ${path.relative(ROOT, TOKEN_PATH)}`);
  if (!loadConfig().discordClientId) {
    console.log("Configura Discord Client ID/Secret dal setup nello shop.");
  }
});

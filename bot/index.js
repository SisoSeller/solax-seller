import "dotenv/config";
import express from "express";
import {
  ActionRowBuilder,
  ActivityType,
  ButtonBuilder,
  ButtonStyle,
  Client,
  Events,
  GatewayIntentBits,
} from "discord.js";
import { paypalApproveUrl, paypalCaptureOrder, paypalCreateOrder } from "./paypal-orders.mjs";

const token = process.env.DISCORD_TOKEN;
const SHOP = "https://sisoseller.github.io/solax-seller/";
const PORT = Number(process.env.PORT || 8080);

if (!token) {
  console.error("Manca DISCORD_TOKEN nel file .env");
  process.exit(1);
}

function paypalCreds() {
  return {
    clientId: process.env.PAYPAL_CLIENT_ID || "",
    secret: process.env.PAYPAL_CLIENT_SECRET || "",
    payee: process.env.PAYPAL_EMAIL || "buzzitest7@gmail.com",
  };
}

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

app.get("/", (_req, res) => {
  res.json({ ok: true, service: "sx-paypal" });
});

app.get("/paypal/health", (_req, res) => {
  const { clientId, secret } = paypalCreds();
  res.json({ ok: Boolean(clientId && secret) });
});

app.post("/paypal/create", async (req, res) => {
  try {
    const { clientId, secret, payee } = paypalCreds();
    const amount = Number(req.body?.amount);
    const invoice = String(req.body?.invoice || "").trim();
    if (!Number.isFinite(amount) || amount <= 0 || !invoice) {
      res.status(400).json({ error: "Ordine non valido" });
      return;
    }
    const order = await paypalCreateOrder({
      clientId,
      secret,
      amount,
      invoice,
      payee,
      returnUrl: String(req.body?.returnUrl || "").trim(),
      cancelUrl: String(req.body?.cancelUrl || "").trim(),
    });
    res.json({ id: order.id, approve: paypalApproveUrl(order) });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "PayPal create fallito" });
  }
});

app.post("/paypal/capture", async (req, res) => {
  try {
    const { clientId, secret } = paypalCreds();
    const orderID = String(req.body?.orderID || req.body?.orderId || req.body?.token || "").trim();
    const expectedEur = Number(req.body?.amount);
    if (!orderID || !Number.isFinite(expectedEur)) {
      res.status(400).json({ error: "Capture non valido" });
      return;
    }
    const captured = await paypalCaptureOrder({
      clientId,
      secret,
      orderID,
      expectedEur,
    });
    res.json(captured);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "PayPal non ha preso i soldi" });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`PayPal API su porta ${PORT}`);
});

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.once(Events.ClientReady, async (bot) => {
  console.log(`Jinius online come ${bot.user.tag}`);
  bot.user.setPresence({
    status: "online",
    activities: [{ name: "SX Shop MM2", type: ActivityType.Watching }],
  });
  await bot.application.commands.set([
    {
      name: "shop",
      description: "Apri lo shop SX delle armi MM2",
    },
  ]);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand() || interaction.commandName !== "shop") return;
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setLabel("Apri lo shop").setStyle(ButtonStyle.Link).setURL(SHOP),
  );
  await interaction.reply({
    content: "Shop SX sempre online:",
    components: [row],
    ephemeral: true,
  });
});

client.login(token);

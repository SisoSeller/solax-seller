import type { DiscordUser, Order, ShopItem } from "./types";
import { asset, siteOriginPath } from "./paths";

const USER_KEY = "sx-discord-user";
const ORDERS_KEY = "sx-orders";

export const EUR = new Intl.NumberFormat("it-IT", {
  style: "currency",
  currency: "EUR",
});

export const VALUE = new Intl.NumberFormat("it-IT");

export type ShopConfig = {
  discordClientId: string;
  discordTicketUrl: string;
  discordWebhookUrl: string;
  paypalClientId: string;
  paypalEmail: string;
};

async function readJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("Errore di rete");
  const text = (await res.text()).trim();
  if (!text) throw new Error("File vuoto");
  return JSON.parse(text) as T;
}

export async function fetchConfig(): Promise<ShopConfig> {
  const empty: ShopConfig = {
    discordClientId: "",
    discordTicketUrl: "",
    discordWebhookUrl: "",
    paypalClientId: "",
    paypalEmail: "",
  };
  try {
    const file = await readJson<Partial<ShopConfig>>(asset("shop-config.json"));
    const savedId = localStorage.getItem("sx-discord-client-id") || "";
    return {
      ...empty,
      ...file,
      discordClientId: file.discordClientId || savedId,
      discordTicketUrl: file.discordTicketUrl || "https://discord.gg/zq3fR5MxgU",
    };
  } catch {
    return empty;
  }
}

export async function fetchItems() {
  const data = await readJson<{ items: ShopItem[] }>(asset("listings.json"));
  return { items: (data.items || []).filter((item) => !item.sold) };
}

export function loadUser(): DiscordUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as DiscordUser) : null;
  } catch {
    return null;
  }
}

function saveUser(user: DiscordUser | null) {
  if (!user) localStorage.removeItem(USER_KEY);
  else localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function loadOrders(discordId: string): Order[] {
  try {
    const all = JSON.parse(localStorage.getItem(ORDERS_KEY) || "{}") as Record<string, Order[]>;
    return all[discordId] || [];
  } catch {
    return [];
  }
}

function saveOrders(discordId: string, orders: Order[]) {
  const all = JSON.parse(localStorage.getItem(ORDERS_KEY) || "{}") as Record<string, Order[]>;
  all[discordId] = orders;
  localStorage.setItem(ORDERS_KEY, JSON.stringify(all));
}

function randomVerifier() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function challenge(verifier: string) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function loginWithDiscord(config: ShopConfig, next = window.location.href) {
  if (!config.discordClientId) {
    throw new Error("Manca Discord Client ID in shop-config.json");
  }
  const verifier = randomVerifier();
  sessionStorage.setItem("sx-pkce", verifier);
  sessionStorage.setItem("sx-next", next);
  const url = new URL("https://discord.com/oauth2/authorize");
  url.searchParams.set("client_id", config.discordClientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", siteOriginPath());
  url.searchParams.set("scope", "identify");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("code_challenge", await challenge(verifier));
  url.searchParams.set("code_challenge_method", "S256");
  window.location.href = url.toString();
}

export async function completeDiscordLogin(config: ShopConfig): Promise<DiscordUser | null> {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  if (!code) return loadUser();
  const verifier = sessionStorage.getItem("sx-pkce");
  const next = sessionStorage.getItem("sx-next");
  sessionStorage.removeItem("sx-pkce");
  sessionStorage.removeItem("sx-next");
  if (!verifier || !config.discordClientId) return loadUser();

  const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.discordClientId,
      grant_type: "authorization_code",
      code,
      redirect_uri: siteOriginPath(),
      code_verifier: verifier,
    }),
  });
  const token = await tokenRes.json();
  if (!token.access_token) {
    throw new Error(token.error_description || "Login Discord fallito. Attiva Public Client + PKCE.");
  }
  const meRes = await fetch("https://discord.com/api/users/@me", {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  const me = await meRes.json();
  const idx = Number(BigInt(me.id) >> 22n) % 6;
  const user: DiscordUser = {
    id: me.id,
    username: me.global_name || me.username,
    tag: me.username,
    avatar: me.avatar
      ? `https://cdn.discordapp.com/avatars/${me.id}/${me.avatar}.png?size=128`
      : `https://cdn.discordapp.com/embed/avatars/${idx}.png`,
  };
  saveUser(user);
  const clean = new URL(window.location.href);
  clean.searchParams.delete("code");
  clean.searchParams.delete("state");
  window.history.replaceState({}, "", clean);
  if (next && next !== window.location.href) window.location.href = next;
  return user;
}

export function logout() {
  saveUser(null);
}

export function createOrder(
  user: DiscordUser,
  items: ShopItem[],
  method: "paypal" | "robux",
  hasPlus: boolean,
): Order {
  const invoice = `SLX-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  const order: Order = {
    invoice,
    buyerDiscordId: user.id,
    buyerUsername: user.username,
    method,
    hasPlus,
    status: "awaiting_payment",
    totalEur: items.reduce((n, item) => n + item.price, 0),
    totalRobux: items.reduce((n, item) => n + item.robuxPrice, 0),
    items: items.map((item) => ({
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
  saveOrders(user.id, [order, ...loadOrders(user.id)]);
  return order;
}

export function updateOrder(user: DiscordUser, order: Order) {
  const orders = loadOrders(user.id).map((o) => (o.invoice === order.invoice ? order : o));
  saveOrders(user.id, orders);
}

export async function sendInvoiceWebhook(config: ShopConfig, order: Order, paymentNote: string) {
  if (!config.discordWebhookUrl) throw new Error("Webhook Discord non configurato");
  const totalLabel =
    order.method === "robux"
      ? `${order.totalRobux} R$`
      : EUR.format(order.totalEur);
  const items = order.items
    .map((item) => `• ${item.name} — ${order.method === "robux" ? `${item.robuxPrice} R$` : EUR.format(item.price)}`)
    .join("\n");
  const payload = {
    username: "SX Fatture",
    embeds: [
      {
        title: `Fattura ${order.invoice}`,
        color: 0x7b4dff,
        fields: [
          { name: "Discord ID", value: String(order.buyerDiscordId), inline: true },
          { name: "Account", value: order.buyerUsername, inline: true },
          { name: "Metodo", value: order.method === "robux" ? "Robux" : "PayPal", inline: true },
          { name: "Speso", value: totalLabel, inline: true },
          { name: "Cosa ha preso", value: items || "—", inline: false },
          { name: "Dettagli pagamento", value: paymentNote || "Segnalato dal cliente", inline: false },
        ],
        timestamp: new Date().toISOString(),
      },
    ],
  };
  const res = await fetch(config.discordWebhookUrl, {
    method: "POST",
    body: new URLSearchParams({ payload_json: JSON.stringify(payload) }),
  });
  if (!res.ok && res.type !== "opaque") {
    throw new Error("Webhook Discord non inviato");
  }
}

export async function listItem(form: FormData, sellKey: string) {
  const res = await fetch("http://127.0.0.1:8787/publish", {
    method: "POST",
    headers: { "x-sell-key": sellKey },
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || "Apri sell-item.bat per pubblicare");
  }
  return data as { item: ShopItem };
}

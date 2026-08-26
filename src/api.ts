import type { DiscordUser, Order, ShopItem } from "./types";
import { DISCORD_REDIRECT } from "./discord";
import { asset } from "./paths";

const USER_KEY = "sx-discord-user";
const ORDERS_KEY = "sx-orders";
const SOLD_KEY = "sx-sold-ids";
export const CONTACT_EMAIL = "buzzitest7@gmail.com";

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
  paypalApiUrl: string;
};

async function readJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("Errore di rete");
  const text = (await res.text()).trim();
  if (!text) throw new Error("File vuoto");
  return JSON.parse(text) as T;
}

export function loadSoldIds(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(SOLD_KEY) || "[]") as unknown;
    return Array.isArray(raw) ? raw.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export async function fetchConfig(): Promise<ShopConfig> {
  const empty: ShopConfig = {
    discordClientId: "",
    discordTicketUrl: "",
    discordWebhookUrl: "",
    paypalClientId: "",
    paypalEmail: "",
    paypalApiUrl: "",
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
  const sold = new Set(loadSoldIds());
  return {
    items: (data.items || []).filter((item) => !item.sold && !sold.has(item.id)),
  };
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

export async function loginWithDiscord(config: ShopConfig) {
  if (!config.discordClientId) {
    throw new Error("Manca Discord Client ID in shop-config.json");
  }
  if (!window.location.href.startsWith(DISCORD_REDIRECT)) {
    window.location.href = `${DISCORD_REDIRECT}?login=1`;
    return;
  }
  const verifier = randomVerifier();
  sessionStorage.setItem("sx-pkce", verifier);
  const url = new URL("https://discord.com/oauth2/authorize");
  url.searchParams.set("client_id", config.discordClientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", DISCORD_REDIRECT);
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
  sessionStorage.removeItem("sx-pkce");
  if (!verifier || !config.discordClientId) return loadUser();

  const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.discordClientId,
      grant_type: "authorization_code",
      code,
      redirect_uri: DISCORD_REDIRECT,
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
  clean.searchParams.delete("login");
  window.history.replaceState({}, "", clean);
  return user;
}

export function logout() {
  saveUser(null);
}

export function createOrder(user: DiscordUser, items: ShopItem[]): Order {
  const invoice = `SLX-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  const order: Order = {
    invoice,
    buyerDiscordId: user.id,
    buyerUsername: user.username,
    method: "paypal",
    hasPlus: false,
    status: "awaiting_payment",
    totalEur: items.reduce((n, item) => n + item.price, 0),
    totalRobux: 0,
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
  const items = order.items
    .map((item) => `• ${item.name} — ${EUR.format(item.price)}`)
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
          { name: "Metodo", value: "PayPal", inline: true },
          { name: "Speso", value: EUR.format(order.totalEur), inline: true },
          { name: "Cosa ha preso", value: items || "—", inline: false },
          {
            name: "Togli dal sito",
            value: order.items.map((item) => item.id).join(", ") || "—",
            inline: false,
          },
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
  if (window.location.protocol === "https:") {
    throw new Error("Apri sell-item.bat sul PC. Dal sito pubblico non si puo vendere.");
  }
  const res = await fetch("/publish", {
    method: "POST",
    headers: { "x-sell-key": sellKey },
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || "Apri sell-item.bat e non chiudere la finestra nera");
  }
  return data as { item: ShopItem };
}

const SELL_KEY = "sx-sell-key";

export function saveSellKey(key: string) {
  if (key) sessionStorage.setItem(SELL_KEY, key);
}

export function loadSellKey() {
  return sessionStorage.getItem(SELL_KEY) || "";
}

const PENDING_PAYPAL = "sx-paypal-pending";

export function savePendingPaypal(order: Order) {
  sessionStorage.setItem(PENDING_PAYPAL, JSON.stringify(order));
}

export function loadPendingPaypal(): Order | null {
  try {
    const raw = sessionStorage.getItem(PENDING_PAYPAL);
    return raw ? (JSON.parse(raw) as Order) : null;
  } catch {
    return null;
  }
}

export function clearPendingPaypal() {
  sessionStorage.removeItem(PENDING_PAYPAL);
}

export function rememberSoldIds(ids: string[]) {
  const next = [...new Set([...loadSoldIds(), ...ids.filter(Boolean)])];
  localStorage.setItem(SOLD_KEY, JSON.stringify(next));
}

export async function markItemsSold(ids: string[], sellKey: string) {
  rememberSoldIds(ids);
  if (!ids.length || window.location.protocol === "https:" || !sellKey) return;
  const res = await fetch("/sold", {
    method: "POST",
    headers: { "x-sell-key": sellKey, "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error || "Annuncio non rimosso dal sito");
  }
}

export async function removeItem(id: string, sellKey: string) {
  if (window.location.protocol === "https:") {
    throw new Error("Apri sell-item.bat sul PC per togliere un item.");
  }
  const res = await fetch("/remove", {
    method: "POST",
    headers: { "x-sell-key": sellKey, "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || "Impossibile togliere l'item");
  }
}

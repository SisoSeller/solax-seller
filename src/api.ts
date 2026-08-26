import type { DiscordUser, Order, ShopItem } from "./types";

async function json<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || "Errore di rete");
  }
  return data as T;
}

export const EUR = new Intl.NumberFormat("it-IT", {
  style: "currency",
  currency: "EUR",
});

export const VALUE = new Intl.NumberFormat("it-IT");

export function loginWithDiscord(next = window.location.pathname + window.location.search) {
  window.location.href = `/api/auth/discord?next=${encodeURIComponent(next)}`;
}

export async function fetchMe() {
  return json<{ user: DiscordUser | null }>(await fetch("/api/me", { credentials: "include" }));
}

export async function fetchConfig() {
  return json<{ discordReady: boolean; ticketUrl: string }>(await fetch("/api/config"));
}

export async function saveSetup(body: {
  discordClientId: string;
  discordClientSecret: string;
  discordTicketUrl: string;
}) {
  return json<{ ok: boolean }>(
    await fetch("/api/setup", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

export async function logout() {
  await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
}

export async function fetchItems() {
  return json<{ items: ShopItem[] }>(await fetch("/api/items"));
}

export async function fetchOrders() {
  return json<{ orders: Order[] }>(
    await fetch("/api/orders", { credentials: "include" }),
  );
}

export async function createOrder(itemIds: string[], method: "paypal" | "robux", hasPlus: boolean) {
  return json<{ order: Order; ticketUrl: string }>(
    await fetch("/api/orders", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemIds, method, hasPlus }),
    }),
  );
}

export async function confirmPaid(invoice: string, paymentNote: string) {
  return json<{ order: Order }>(
    await fetch(`/api/orders/${invoice}/paid`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paymentNote }),
    }),
  );
}

export async function listItem(form: FormData, sellKey: string) {
  return json<{ item: ShopItem }>(
    await fetch("/api/items", {
      method: "POST",
      credentials: "include",
      headers: { "x-sell-key": sellKey },
      body: form,
    }),
  );
}

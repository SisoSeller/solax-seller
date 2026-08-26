import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, "..");
export const DATA_DIR = path.join(ROOT, "data");
export const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
export const STORE_PATH = path.join(DATA_DIR, "store.json");
export const CONFIG_PATH = path.join(DATA_DIR, "config.json");
export const TOKEN_PATH = path.join(DATA_DIR, "sell-token.txt");

function ensureDirs() {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

export function readJson(file, fallback) {
  ensureDirs();
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

export function writeJson(file, data) {
  ensureDirs();
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

export function loadStore() {
  return readJson(STORE_PATH, { users: {}, items: [], orders: [] });
}

export function saveStore(store) {
  writeJson(STORE_PATH, store);
}

export function loadConfig() {
  const envConfig = {
    discordClientId: process.env.DISCORD_CLIENT_ID || "",
    discordClientSecret: process.env.DISCORD_CLIENT_SECRET || "",
    discordTicketUrl: process.env.DISCORD_TICKET_URL || "",
  };
  const file = readJson(CONFIG_PATH, {});
  return { ...envConfig, ...file };
}

export function saveConfig(config) {
  writeJson(CONFIG_PATH, config);
}

export function getSellToken() {
  ensureDirs();
  if (!fs.existsSync(TOKEN_PATH)) {
    const token = cryptoToken();
    fs.writeFileSync(TOKEN_PATH, token);
    return token;
  }
  return fs.readFileSync(TOKEN_PATH, "utf8").trim();
}

function cryptoToken() {
  return crypto.randomBytes(24).toString("hex");
}

export function invoiceId() {
  const n = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `SLX-${n}`;
}

export function discordAvatar(user) {
  if (!user?.id) return "";
  if (user.avatar) {
    return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`;
  }
  const idx = Number(BigInt(user.id) >> 22n) % 6;
  return `https://cdn.discordapp.com/embed/avatars/${idx}.png`;
}

const deadline = Date.now() + 45000;

async function ready(url, method = "GET") {
  try {
    const res = await fetch(url, { method });
    return res.status < 500;
  } catch {
    return false;
  }
}

while (Date.now() < deadline) {
  const seller =
    (await ready("http://127.0.0.1:8787/health")) ||
    (await ready("http://127.0.0.1:8787/publish", "OPTIONS"));
  const web =
    (await ready("http://127.0.0.1:5173/sell.html")) ||
    (await ready("http://127.0.0.1:5173/solax-seller/sell.html"));
  if (seller && web) process.exit(0);
  await new Promise((r) => setTimeout(r, 500));
}

process.exit(1);

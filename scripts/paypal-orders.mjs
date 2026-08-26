const LIVE = "https://api-m.paypal.com";
const SANDBOX = "https://api-m.sandbox.paypal.com";

async function token(base, clientId, secret) {
  const res = await fetch(`${base}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) return null;
  return data.access_token;
}

export async function paypalAuth(clientId, secret) {
  if (!clientId || !secret) {
    throw new Error("Manca PAYPAL_CLIENT_SECRET nel file .env");
  }
  const live = await token(LIVE, clientId, secret);
  if (live) return { base: LIVE, access: live, sandbox: false };
  const sand = await token(SANDBOX, clientId, secret);
  if (sand) {
    throw new Error(
      "Queste credenziali PayPal sono Sandbox: i soldi veri non si muovono. Crea un'app Live su developer.paypal.com",
    );
  }
  throw new Error("Client ID o Secret PayPal non validi");
}

export async function paypalCreateOrder({ clientId, secret, amount, invoice, payee }) {
  const { base, access } = await paypalAuth(clientId, secret);
  const value = Number(amount).toFixed(2);
  const unit = {
    amount: { currency_code: "EUR", value },
    description: `SX ${invoice}`.slice(0, 127),
    custom_id: String(invoice).slice(0, 127),
    invoice_id: String(invoice).slice(0, 127),
  };
  if (payee && String(payee).includes("@")) {
    unit.payee = { email_address: String(payee).trim() };
  }
  const res = await fetch(`${base}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${access}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [unit],
      application_context: {
        shipping_preference: "NO_SHIPPING",
        user_action: "PAY_NOW",
        brand_name: "SX Shop",
      },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.id) {
    const issue = data?.details?.[0]?.issue || data?.error || data?.message || "create";
    throw new Error(`PayPal create: ${issue}`);
  }
  return data;
}

export async function paypalCaptureOrder({ clientId, secret, orderID, expectedEur }) {
  const { base, access } = await paypalAuth(clientId, secret);
  const res = await fetch(`${base}/v2/checkout/orders/${encodeURIComponent(orderID)}/capture`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${access}`,
      "Content-Type": "application/json",
      "PayPal-Request-Id": String(orderID),
    },
  });
  let data = await res.json().catch(() => ({}));
  if (res.status === 422 && data?.details?.[0]?.issue === "ORDER_ALREADY_CAPTURED") {
    const got = await fetch(`${base}/v2/checkout/orders/${encodeURIComponent(orderID)}`, {
      headers: { Authorization: `Bearer ${access}` },
    });
    data = await got.json().catch(() => ({}));
  } else if (!res.ok) {
    const issue = data?.details?.[0]?.issue || data?.error || data?.message || "capture";
    throw new Error(`PayPal capture: ${issue}`);
  }
  const capture = data?.purchase_units?.[0]?.payments?.captures?.[0];
  const value = Number(capture?.amount?.value);
  if (capture?.status !== "COMPLETED" || !capture?.id) {
    throw new Error("PayPal non ha addebitato i soldi");
  }
  if (!Number.isFinite(value) || Math.abs(value - Number(expectedEur)) > 0.009) {
    throw new Error("Importo PayPal diverso dall'ordine");
  }
  return data;
}

export async function sendInvoiceWebhook(payload) {
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url) {
    console.warn("Webhook Discord non configurato");
    return false;
  }

  const items = (payload.items || [])
    .map((item) => `• ${item.name} — ${item.priceLabel}`)
    .join("\n");

  const body = {
    username: "SX Fatture",
    embeds: [
      {
        title: `Fattura ${payload.invoice}`,
        color: 0x7b4dff,
        fields: [
          { name: "Discord ID", value: String(payload.discordId), inline: true },
          { name: "Account", value: payload.discordTag || "sconosciuto", inline: true },
          { name: "Metodo", value: payload.method === "robux" ? "Robux" : "PayPal", inline: true },
          { name: "Speso", value: payload.totalLabel, inline: true },
          { name: "Cosa ha preso", value: items || "—", inline: false },
          {
            name: "Dettagli pagamento",
            value: payload.paymentNote || "Segnalato dal cliente",
            inline: false,
          },
        ],
        timestamp: new Date().toISOString(),
      },
    ],
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("Webhook Discord fallito", res.status, text.slice(0, 200));
    return false;
  }
  return true;
}

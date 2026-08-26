# SX — Shop armi MM2

Sito pubblico: https://sisoseller.github.io/solax-seller/

Le armi messe in vendita con `sell-item.bat` vengono pubblicate su GitHub e le vedono tutti.

## Avvio

- `avvio.bat` apre il sito pubblico (resta online anche a PC spento).
- `sell-item.bat` serve per pubblicare: login Discord, foto, prezzo, value, poi push automatico.

## Discord

Nel Developer Portal: **Public Client** attivo.

Redirect OAuth2:
- `https://sisoseller.github.io/solax-seller/`
- `http://localhost:5173/`
- `http://localhost:5173/sell.html`

Poi metti il Client ID in `public/shop-config.json` e fai push.

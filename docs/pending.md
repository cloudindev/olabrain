# Pendiente

Trabajo acordado o propuesto que aún no se ha hecho. Al empezar algo de aquí, muévelo a un
ADR en `decisions.md` y bórralo de esta lista.

## Widget, conocimiento y monetización (propuesto 2026-10-23, esperando decisiones)

Petición: integrar el agente en webs de terceros con un script, área de conocimiento y
planes de precios. Orden propuesto:

1. **Conocimiento** (pestaña «Conocimiento» por agente): subir PDF/DOCX/TXT/URL y un área
   de texto libre → troceado → embeddings → pgvector (Supabase UE). Herramienta
   `buscar_conocimiento` con citas, en chat, voz y widget. Tablas `knowledge_sources`,
   `knowledge_chunks` (RLS). Embeddings propuestos: Gemini (`gemini-embedding`).
2. **Monedero y Stripe** (ADR-007): saldo prepago por organización, `wallets` +
   `wallet_ledger` inmutable; precio = coste real del proveedor × 1,30 desde
   `config/pricing.json` (tarifas oficiales actuales, sin hardcodear); saldo de prueba al
   registrarse (5 min de voz + ~200 mensajes); sin saldo, el agente avisa y se ofrece
   recargar; Stripe Checkout (10/25/50/100 €) guardando la tarjeta; recarga automática bajo
   un umbral; página «Facturación».
3. **Widget**: `<script src="https://app.olabrain.com/widget.js" data-agent="…">` → burbuja
   + iframe aislado con chat y voz con avatar. Pestaña «Publicar»: código, dominios
   autorizados, aspecto y herramientas permitidas en público (por defecto ninguna; el
   usuario elige). Sin límites de uso (lo cubre el monedero).

Decisiones que faltan del usuario:
- Claves de Stripe en modo prueba.
- Facturas de las recargas: Stripe Invoicing (recomendado) o WHMCS.
- Saldo en euros (propuesto) o en «créditos».
- Visto bueno a Gemini para los embeddings.

## Otros pendientes
- WhatsApp: elegir opción (API Cloud directa vs Embedded Signup) y verificación de Meta.
- a3asesor / Solmicro: respuestas sobre instalación (local vs nube) y acceso a datos.
- Holded: PDF de facturas por enlace firmado (como WHMCS).
- Google Drive: publicar la app OAuth (Branding con /privacidad y /aviso-legal).
- Rotar todos los secretos antes del lanzamiento.

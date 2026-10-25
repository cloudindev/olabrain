# Pendiente

Trabajo acordado o propuesto que aún no se ha hecho. Al empezar algo de aquí, muévelo a un
ADR en `decisions.md` y bórralo de esta lista.

## Conocimiento y pagos (pendiente)

Hecho: widget web («Publicar», ADR del canal en el commit), monedero prepago y precios
(ADR-018), conexiones por agente (ADR-017), pagos con Stripe (ADR-020).

Falta:
- **Stripe (hecho, ADR-020), falta:** IVA de clientes de fuera de España (inversión del
  sujeto pasivo en B2B UE, OSS en particulares UE); hoy siempre 21 %. Rotar la clave
  restringida compartida en el chat.
- **Conocimiento** por agente: subir PDF/DOCX/TXT/URL y texto libre → troceado →
  embeddings (propuesto Gemini) → pgvector, herramienta `buscar_conocimiento` con citas.
- Medir el coste real por llamada de voz (tokens de Gemini Live) y ajustar
  `voicePerMinuteUsd`; quitar los límites provisionales por visitante del widget cuando
  el saldo lo cubra todo.

## Otros pendientes
- WhatsApp: elegir opción (API Cloud directa vs Embedded Signup) y verificación de Meta.
- a3asesor / Solmicro: respuestas sobre instalación (local vs nube) y acceso a datos.
- Holded: PDF de facturas por enlace firmado (como WHMCS).
- Google Drive: publicar la app OAuth (Branding con /privacidad y /aviso-legal).
- Rotar todos los secretos antes del lanzamiento.

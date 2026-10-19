# BrainAgent — especificación para Claude Code

> Este fichero es la fuente de verdad del proyecto. Léelo entero antes de cada tarea. Si una decisión no está aquí, elige la opción más simple que no cierre puertas y anótala en `docs/decisions.md` (ADR breve).

## 1. Producto

BrainAgent es un SaaS multi-tenant para crear **empleados digitales con voz, chat y acceso a los sistemas de la empresa**. Sin avatar ni vídeo (ver ADR-001 en `docs/decisions.md`).

**Agente = Personaje + Cerebro + Conectores + Canales.**

- **Personaje:** voz + idioma + carácter (tono, formalidad, longitud, saludo, prompt base). Catálogo propio de 12 + personajes creados por el cliente (elegir o clonar voz + asistente de carácter).
- **Cerebro:** instrucciones, conocimiento (RAG con citas), memoria por contacto, modelo elegible, políticas (herramientas permitidas, confirmación de escrituras, límites de gasto, horario).
- **Conectores:** cliente MCP, importador OpenAPI, Tool Studio (SQL/HTTP sin código), conectores nativos (Nango + propios). Todo se normaliza a una única `Tool`.
- **Canales:** widget web (chat y voz), WhatsApp (texto y notas de voz), Telegram, Slack, Teams, teléfono SIP, API REST y servidor MCP por agente. Las transcripciones de voz se guardan siempre.
- **Panel:** conversaciones, latencias por turno, herramientas llamadas, costes, uso, facturación.

Usuarios: pymes y agencias en España/UE. UI en **español** (i18n preparado para inglés desde el día 1). Código, nombres de tablas y commits en **inglés**.

**MVP = texto + voz desde el día 1.**

## 2. Principios no negociables

1. **Multi-tenant estricto.** `tenant_id` en todas las tablas de negocio, Row Level Security en Postgres, ninguna query sin contexto de tenant. Tests que demuestren el aislamiento.
2. **Todo proveedor detrás de un adaptador.** Modelo (LLM), STT, TTS, realtime (speech-to-speech), conectores. Cambiar de proveedor = configuración, no código.
3. **Sin GPU propia.** Voz y modelos por API.
4. **Lectura por defecto.** Las tools que escriben requieren confirmación del usuario salvo que el admin las marque `auto`.
5. **Credenciales fuera del prompt.** Las resuelve el Tool Router desde el vault en el momento de la llamada. Nunca se loguean.
6. **Todo medido.** Cada turno genera un evento con latencias (conexión, fin de turno, primer token, primer audio), tools llamadas con duración, tokens/minutos y coste por proveedor.
7. **UE y cumplimiento.** Proveedores en región UE cuando exista; el agente se presenta como IA (AI Act art. 50); retención configurable; borrado de memoria por contacto (RGPD).
8. **Seguridad de salida.** Toda llamada HTTP hacia fuera (OpenAPI, Tool Studio HTTP, webhooks) pasa por un proxy con lista blanca y bloqueo de IPs privadas (anti-SSRF), timeouts y límite de tamaño.

## 3. Arquitectura

```
Canales ──► Control plane (Next.js/TS) ──► Runtime de agentes (Python/LiveKit Agents)
                    │                              │ tool calls
                    └──────────► Connector service (TS): Tool Router ─► MCP · OpenAPI · SQL · Nango
Infra: LiveKit (WebRTC+SIP) · Postgres+pgvector · Redis · S3 · Langfuse/OTel
```

### Monorepo (pnpm + Turborepo para TS, uv para Python)

```
apps/
  web/              Next.js 15 (App Router): panel, builder, auth, API pública, webhooks de canales
  widget/           Widget embebible (Vite + Preact o React, bundle < 80 KB gz sin el SDK de LiveKit cargado bajo demanda)
  connector/        Servicio TS: Tool Router, cliente MCP, OpenAPI, Tool Studio, proxy de salida, vault
  agent/            Python 3.12: LiveKit Agents workers (voz) + chat worker (texto)
packages/
  db/               Drizzle ORM: esquema, migraciones, RLS, seeds
  core/             Tipos compartidos (zod): Tool, Agent, Persona, Policy, UsageEvent…
  ui/               Componentes (shadcn/ui + Tailwind)
  sdk/              SDK JS público (crear sesiones, enviar mensajes)
  config/           eslint, tsconfig, tailwind preset
infra/
  docker-compose.yml   postgres, redis, minio, livekit-server, nango, langfuse
  deploy/              Dockerfiles y despliegue (Hetzner/OVH UE)
docs/
  decisions.md      ADRs
  runbook.md
```

### Stack

| Capa | Elección |
|---|---|
| Web | Next.js 15, TypeScript estricto, Tailwind, shadcn/ui, TanStack Query, next-intl |
| Auth | Better Auth (email + Google + Microsoft; organizaciones = tenants; roles owner/admin/builder/viewer) |
| DB | PostgreSQL 16 + pgvector, Drizzle, RLS con `set_config('app.tenant_id', …)` por transacción |
| Colas | Redis + BullMQ (sincronizaciones, ingesta, webhooks, metering) |
| Ficheros | S3 compatible (MinIO en local) |
| Realtime | LiveKit (server en Docker en local; LiveKit Cloud UE o self-host en prod) |
| Agente | Python 3.12, `livekit-agents`, STT (deepgram), realtime speech-to-speech (Gemini Live), TTS (elevenlabs, cartesia, google), LiteLLM como router de modelos |
| MCP | SDK oficial `@modelcontextprotocol/sdk` (cliente Streamable HTTP + OAuth 2.1/PKCE + registro dinámico) |
| Conectores nativos | Nango self-hosted |
| Pagos | Stripe (suscripción + uso medido con Meters) |
| Observabilidad | OpenTelemetry + Langfuse self-host; logs JSON (pino / structlog) |
| Tests | Vitest, Playwright (e2e), pytest |

## 4. Modelo de datos (mínimo)

`tenants`, `users`, `memberships(role)`, `api_keys`,
`personas(id, tenant_id NULL = catálogo global, name, voice_provider, voice_ref, language, traits jsonb, greeting, base_prompt)`,
`agents(id, tenant_id, persona_id, name, instructions, model, presence_mode: text|voice, policy jsonb, status)`,
`knowledge_sources`, `knowledge_chunks(embedding vector)`,
`connections(id, tenant_id, kind: mcp|openapi|sql|http|native, config jsonb, credential_ref, status)`,
`tools(id, tenant_id, connection_id, name, description, input_schema jsonb, mode: read|write, confirmation: required|auto, enabled)`,
`agent_tools(agent_id, tool_id)`,
`channels(id, tenant_id, agent_id, kind, config jsonb)`,
`contacts`, `conversations`, `messages`, `tool_calls(duration_ms, status, request/response redacted)`,
`turn_metrics(conversation_id, turn, conn_ms, eot_ms, first_token_ms, first_audio_ms)`,
`usage_events(tenant_id, kind, provider, quantity, unit, cost_usd)`,
`credentials(tenant_id, encrypted_blob, key_version)` (AES-256-GCM, clave por tenant envuelta con una master key de entorno/KMS),
`audit_log`.

## 5. Contrato `Tool` (packages/core)

```ts
type Tool = {
  id: string; name: string;               // snake_case, único por agente
  description: string;                    // lo que lee el LLM
  inputSchema: JSONSchema;
  mode: "read" | "write";
  confirmation: "required" | "auto";
  source: { kind: "mcp" | "openapi" | "sql" | "http" | "native"; connectionId: string; ref: string };
  limits: { timeoutMs: number; maxRows?: number; maxBytes: number };
};
```
El runtime de agentes solo conoce `list_tools(agent_id)` y `call_tool(agent_id, conversation_id, tool_name, args)` contra `apps/connector` (HTTP interno con token de servicio). Si `confirmation = required`, `call_tool` devuelve `needs_confirmation` y el agente pregunta al usuario antes de reintentar con `confirmed: true`.

## 6. Fases (cada fase termina con demo funcional, tests verdes y `docs/runbook.md` actualizado)

### Fase 0 — Fundaciones (semanas 1–2)
- Monorepo, CI (lint, typecheck, tests), docker-compose con todos los servicios, `.env.example`.
- Auth con organizaciones, RLS y test de aislamiento entre dos tenants.
- **Spike de riesgo:** sala LiveKit + worker Python con STT → LLM → TTS (proveedores intercambiables por config) y modo alternativo speech-to-speech (Gemini Live), hablando español con barge-in; página `/lab` con la transcripción y las 4 latencias por turno. Objetivo: primer audio < 1,2 s desde que el usuario deja de hablar. Documentar resultados en `docs/decisions.md`.

### Fase 1 — Builder, texto y conectores (semanas 3–6)
- CRUD de agentes y personajes; seed del catálogo de 12 (Lía recepción, Mateo ventas, Nora soporte, Hugo operaciones, Vega RRHH, Teo finanzas, Iris marketing, Bruno helpdesk IT, Alba agenda, Leo logística, Sara atención al cliente, Max analista de datos) con prompt base y voz asignada.
- Conocimiento: subir PDF/DOCX/URL → chunking → embeddings → búsqueda con citas.
- Chat de texto con streaming (SSE) en panel y en widget.
- `apps/connector`: Tool Router, vault, proxy de salida, **cliente MCP** (añadir servidor por URL, flujo OAuth, listar tools, allow/deny por tool), **importador OpenAPI** (pegar URL o JSON, elegir endpoints), **Tool Studio** (SQL parametrizado de solo lectura sobre MySQL/Postgres/SQL Server con `LIMIT` forzado y timeout; HTTP con plantilla) con botón "Probar".
- Ejemplo de referencia en el seed: tool `partes_hoy(fecha)` y `horas_equipo(fecha)` sobre una base de datos de demo.

### Fase 2 — Voz en producción (semanas 5–9)
- Adaptadores Python: `TTSProvider`, `STTProvider`, `LLM` vía LiteLLM; modo alternativo speech-to-speech (Gemini Live) por agente.
- Widget con modos texto / voz; interrupciones (barge-in); relleno "Un momento, lo miro" cuando una tool tarda > 700 ms.
- Personaje propio: elegir voz del proveedor o clonarla (si lo soporta y con consentimiento) → asistente de carácter (6 preguntas) → prueba en `/lab`.
- Laboratorio: histórico de pruebas con latencias comparables por proveedor.
- Grabación opcional y transcripción guardada.

### Fase 3 — Conectores nativos y canales (semanas 9–12)
- Nango self-host; conectores v1: Google Workspace, Microsoft 365, Odoo, Holded, Sesame HR, HubSpot, WooCommerce/PrestaShop, bases SQL.
- Canales: WhatsApp Cloud API (texto y notas de voz con STT/TTS), Telegram. Mismo agente, misma memoria por contacto.
- Panel de conversaciones (transcripción, tools con tiempos, latencias, coste, valoración) y de uso.

### Fase 4 — Monetización y beta (semanas 12–16)
- Stripe: planes Starter 59 € / Pro 199 € / Business 499 € con minutos y mensajes incluidos y exceso medido (voz 0,35 €/min, mensaje 0,01 €; precios en configuración). Límites y alertas de gasto.
- Teléfono SIP (LiveKit SIP), Slack y Teams.
- Agente expuesto como servidor MCP y API REST con API keys.
- Auditoría, retención, exportación y borrado por contacto; checklist de seguridad (`docs/security.md`).
- Modo agencia: sub-cuentas de cliente y white-label del widget.

## 7. Forma de trabajar

- Antes de cada fase: propón un plan corto (ficheros, tablas, endpoints, riesgos) y espera mi OK. Dentro de una fase, avanza sin preguntar salvo decisiones irreversibles o de coste.
- Commits pequeños con Conventional Commits; una rama por fase y PR con resumen y capturas.
- Nada se da por hecho sin test: unitarios para Tool Router, vault, RLS y cálculo de costes; e2e de Playwright para crear agente → conectar tool → conversar.
- Si una API de proveedor no está clara, busca su documentación actual antes de escribir código; no inventes endpoints ni parámetros. Precios y nombres de modelos van en configuración, nunca hardcodeados.
- Secretos solo en `.env` (nunca en el repo). Proporciona `.env.example` completo y comentado.
- Mantén `docs/runbook.md`: cómo levantar todo en local con un comando (`pnpm dev` + `docker compose up`).
- Diseño de la UI: sobrio, profesional, claro y oscuro; tipografía y color propios (no plantilla genérica); mobile-friendly el widget.

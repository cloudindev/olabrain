# Plan de la Fase 0 — Fundaciones (voz + texto, sin avatar)

## Entregables

- Monorepo pnpm + Turborepo (TS) y uv (Python), CI (lint, typecheck, tests).
- `infra/docker-compose.yml` con postgres, redis, minio, livekit-server y mailpit; profiles `observability` (Langfuse), `llm` (LiteLLM) y `connectors` (Nango).
- Auth con organizaciones (Better Auth): email + Google + Microsoft, onboarding de organización, roles owner/admin/builder/viewer.
- Esquema inicial con RLS y tests de aislamiento entre dos tenants.
- Spike de voz: worker Python (LiveKit Agents) STT → LLM → TTS en español con barge-in, y modo speech-to-speech (Gemini Live). Página `/lab` con transcripción y 4 latencias por turno.
- `docs/runbook.md` para levantarlo todo en local.

## Estructura

| Ruta | Contenido en la Fase 0 |
|---|---|
| `apps/web` | Next.js 15: auth, onboarding, `/lab`, `POST /api/lab/token`, `POST /api/lab/metrics`, next-intl (es/en) |
| `apps/agent` | Worker LiveKit Agents, registro de adaptadores STT/TTS/LLM/realtime, recolector de métricas |
| `packages/db` | Esquema Drizzle, migraciones SQL con RLS, `withTenant()`, seed, tests de aislamiento |
| `packages/core` | zod: `LabConfig`, `TurnMetrics`, roles, utilidades de métricas (p50/p95) |
| `packages/ui` | Tokens de diseño (claro/oscuro) y componentes base |
| `packages/config` | tsconfig y eslint compartidos |
| `apps/widget`, `apps/connector`, `packages/sdk` | Paquetes vacíos que ya pasan lint/typecheck |

## Esquema inicial

- Auth (sin RLS): `users`, `sessions`, `accounts`, `verifications`, `tenants`, `memberships`, `invitations`.
- Negocio (RLS forzada): `personas` (`tenant_id NULL` = catálogo global), `agents`, `conversations`, `turn_metrics`, `usage_events`, `audit_log`.

## Endpoints

- `/api/auth/*` — Better Auth.
- `POST /api/lab/token` — crea la conversación, el token de LiveKit y despacha el agente con la config del laboratorio en la metadata.
- `POST /api/lab/metrics` — guarda un turno medido en `turn_metrics`.

## Riesgos principales

1. Presupuesto de latencia (EOU + TTFT + TTFB) frente a 1,2 s.
2. Calidad del detector de turnos y de las voces en español de España.
3. Residencia UE incompleta en algunos proveedores (TTS sobre todo).
4. Salto de red de LiteLLM.
5. Precisión de la medición desde el navegador.

## Qué medirá el spike

- 4 latencias con p50/p95 sobre ≥ 20 turnos por combinación (2 TTS × 2 LLM × pipeline vs Gemini Live; ruta directa vs LiteLLM).
- Desglose del worker: EOU, TTFT, TTFB.
- Barge-in: si corta y cuánto tarda.
- Coste por minuto de cada combinación y valoración subjetiva de la voz.

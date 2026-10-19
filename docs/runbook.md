# Runbook — BrainAgent en local

## Requisitos

| Herramienta | Versión | Para qué |
|---|---|---|
| Node.js | ≥ 22.12 | Web y paquetes TS |
| pnpm | 9.x (`corepack enable`) | Monorepo |
| uv | ≥ 0.5 | Worker Python (instala Python 3.12 si no lo tienes) |
| Docker | OrbStack o Docker Desktop | Postgres, Redis, MinIO, LiveKit, Mailpit |

## Arranque (primera vez)

```bash
cp .env.example .env
# Rellena como mínimo: BETTER_AUTH_SECRET (openssl rand -base64 32)
# y las claves de proveedor de voz (ver "Hablar con Lía" más abajo).

pnpm infra:up      # docker compose: postgres, redis, minio, livekit, mailpit
pnpm setup         # dependencias JS + Python, modelos locales del agente, migraciones y seed
pnpm dev           # web (http://localhost:3000) + worker de voz, en paralelo
```

Después, el día a día es:

```bash
pnpm infra:up && pnpm dev
```

## Servicios y puertos

| Servicio | URL / puerto | Notas |
|---|---|---|
| Panel (Next.js) | http://localhost:3000 | |
| Postgres 16 + pgvector | `localhost:5433` | Dos roles: `brainagent_owner` (migraciones) y `brainagent_app` (app, sujeto a RLS) |
| Redis | `localhost:6380` | Colas desde la Fase 1 |
| MinIO | API http://localhost:9000 · consola http://localhost:9001 | `minioadmin` / `minioadmin` |
| LiveKit | `ws://localhost:7880` (+ 7881/tcp, 7882/udp) | Modo `--dev`: clave `devkey`, secreto `secret` |
| Mailpit | http://localhost:8025 | Todos los emails de desarrollo (verificación, invitaciones) |

Los puertos de Postgres y Redis no son los estándar, para convivir con instalaciones de Homebrew.

Profiles opcionales:

```bash
docker compose -f infra/docker-compose.yml --env-file .env --profile observability up -d  # Langfuse → http://localhost:3001
docker compose -f infra/docker-compose.yml --env-file .env --profile llm up -d            # LiteLLM → http://localhost:4000
docker compose -f infra/docker-compose.yml --env-file .env --profile connectors up -d     # Nango (Fase 3) → http://localhost:3003
```

## Hablar con Lía en /lab

1. Entra en http://localhost:3000, crea una cuenta y confirma el email con el enlace que aparece en Mailpit (http://localhost:8025).
2. Crea tu organización. Llegarás a `/lab`.
3. Pulsa **Conectar** y permite el micrófono. Lía saluda y se presenta como IA.

Claves mínimas en `.env` para el modo pipeline:

| Pieza | Variables |
|---|---|
| STT | `DEEPGRAM_API_KEY` |
| TTS | `ELEVEN_API_KEY` **o** `CARTESIA_API_KEY`, y `LAB_TTS_PROVIDER`. Pon en `LAB_TTS_VOICE_ID` una voz en español de España del proveedor |
| LLM | `GOOGLE_API_KEY` (o Vertex: `GOOGLE_GENAI_USE_VERTEXAI=true`, `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION`, `GOOGLE_APPLICATION_CREDENTIALS`), `OPENAI_API_KEY` o `ANTHROPIC_API_KEY`, y `LAB_LLM_PROVIDER` + `LAB_LLM_MODEL` |
| Speech-to-speech | Las mismas de Google y `LAB_REALTIME_MODEL` (modo `realtime` en /lab) |

Si falta una clave o el proveedor la rechaza, `/lab` muestra «Error del agente: …» con el motivo.

Cada respuesta añade una fila con las 4 latencias. Las filas se guardan en `turn_metrics`:

| Métrica | Dónde se mide | Qué es |
|---|---|---|
| Conexión | Navegador | Clic en Conectar → agente en la sala (solo el primer turno) |
| Fin de turno | Worker | Fin de habla (VAD) → turno confirmado |
| Primer token | Worker | TTFT del LLM |
| Primer audio | Navegador | Fin de habla → primera muestra audible de la respuesta. Objetivo < 1 200 ms |

La tabla también muestra el TTFB del TTS y un estimado del servidor (fin de turno + TTFT + TTFB) para ver qué pieza pesa más.

### Comparar proveedores

En el panel de configuración de `/lab` cambia el TTS, la voz, el LLM, la ruta (directa o LiteLLM), la generación anticipada o el modo realtime. Los campos vacíos usan los `LAB_*` del `.env`. Para la ruta LiteLLM levanta el profile `llm` y usa `LAB_LLM_MODEL` con el formato `proveedor/modelo`.

## Tests

```bash
pnpm lint && pnpm typecheck && pnpm test   # incluye RLS contra Postgres real y pytest del worker
pnpm test:e2e                              # Playwright: registro → organización → /lab → API
```

- Los tests de RLS usan la base `brainagent_test`, que crea `infra/postgres/init.sql`. Puedes cambiarla con `TEST_DATABASE_URL_ADMIN` y `TEST_DATABASE_URL`.
- El e2e arranca su propio servidor en el puerto 3100, sin verificación de email ni rate limit.
- La CI (`.github/workflows/ci.yml`) ejecuta todo lo anterior en cada PR.

## Base de datos

```bash
pnpm db:generate   # nueva migración a partir de packages/db/src/schema
pnpm db:migrate    # aplica migraciones como owner y da login al rol brainagent_app
pnpm db:seed       # catálogo global de personajes
```

Reglas:

- Toda tabla con `tenant_id` necesita RLS forzada. Un test recorre el catálogo de Postgres y falla si alguna no la tiene.
- Las tablas de negocio solo se tocan dentro de `withTenant()` (o `tenantTx()` en la web).
- Las tablas de Better Auth usan `organization_id` a propósito y no tienen RLS (ver ADR-002).

## Problemas frecuentes

| Síntoma | Causa probable |
|---|---|
| `/lab` se queda en «Conectando» | El worker no está corriendo (`pnpm dev:agent`) o `LIVEKIT_*` no coincide entre web y worker |
| Conecta pero no se oye nada | Docker en macOS: comprueba que el contenedor de LiveKit expone `7882/udp` y que arrancó con `--node-ip 127.0.0.1` |
| «Error del agente: … API key» | Falta la clave del proveedor indicado en `.env` |
| Primer audio sale siempre vacío (—) | El micrófono no supera el umbral del VAD del navegador (`MIC_VOICE_THRESHOLD` en `apps/web/src/components/lab/latency-tracker.ts`) |
| El worker tarda en arrancar la primera vez | Descarga de modelos locales (VAD y detector de turnos): `pnpm --filter @brainagent/agent run setup` |
| `next build` falla por fuentes | Hace falta red para descargar Google Fonts en el build |

## Sin Docker (alternativa con Homebrew)

```bash
brew install postgresql@16 redis livekit
# Postgres en el puerto 5433 con el usuario brainagent_owner, o ajusta DATABASE_URL*/TEST_* en .env.
createdb brainagent && createdb brainagent_test
livekit-server --dev --bind 127.0.0.1
```

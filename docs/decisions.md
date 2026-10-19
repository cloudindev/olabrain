# Decisiones de arquitectura (ADR)

Formato breve: contexto → decisión → consecuencias. Las más recientes, al final.

---

## ADR-001 — Alcance: voz + texto, sin avatar (2026-10-19)

**Contexto.** La especificación inicial incluía avatares en tiempo real (Anam, LiveAvatar, Simli, Tavus) desde el MVP. El avatar añade coste por minuto, 200–500 ms de latencia extra, dependencia de proveedores sin región UE y complejidad (vídeo, kiosco, personajes desde foto).

**Decisión.** BrainAgent es **voz + texto**. Se elimina el avatar y el vídeo en todas las fases: sin `AvatarProvider`, sin videollamada ni modo kiosco, sin métrica de primer frame. El personaje es voz + idioma + carácter. Se mantienen el chat de texto (panel, widget, WhatsApp, Telegram, Slack, Teams, API, MCP) y todos los canales de voz (widget, SIP, notas de voz).

**Consecuencias.**
- Métricas por turno: 4 (conexión, fin de turno, primer token, primer audio).
- `personas` pierde `avatar_provider/avatar_ref`; `agents.presence_mode` = `text | voice`.
- Precio de exceso de avatar eliminado; los precios viven en configuración.
- El spike de la Fase 0 ya no necesita un LiveKit accesible desde Internet: el `livekit-server` local basta.
- Si en el futuro vuelve el avatar, entra como adaptador nuevo en `apps/agent` sin tocar el resto.

---

## ADR-002 — Decisiones técnicas de la Fase 0 (2026-10-19)

1. **RLS con dos roles de Postgres.** `brainagent_owner` es dueño del esquema (migraciones y seed). `brainagent_app` (sin `BYPASSRLS`, no propietario) es el que usan la app y los tests. Todas las tablas con `tenant_id` tienen `ENABLE` + `FORCE ROW LEVEL SECURITY` y la política `tenant_id = current_setting('app.tenant_id', true)::uuid`. El contexto se fija por transacción con `set_config('app.tenant_id', …, true)` dentro de `withTenant()`. Un test recorre `pg_catalog` y falla si alguna tabla con `tenant_id` no tiene RLS forzada.
2. **Tablas de auth fuera de RLS.** Better Auth gestiona `users`, `sessions`, `accounts`, `verifications`, `tenants` (organization), `memberships` (member) e `invitations` con su propio acceso. Son transversales a tenants por naturaleza (un usuario puede estar en varias organizaciones). La app comprueba la membresía (`requireTenant()`) antes de entrar en `withTenant()`.
3. **IDs uuid** en todas las tablas, también en las de Better Auth, para que `tenant_id` sea siempre `uuid`.
4. **Roles** `owner/admin/builder/viewer` con el control de acceso de Better Auth (`createAccessControl`); sustituyen al rol `member` por defecto.
5. **LiveKit local** (`livekit-server --dev` en docker-compose) para el desarrollo y el spike. LiveKit Cloud (región UE) queda para producción.
6. **LLM: ruta directa vs LiteLLM.** El worker soporta las dos rutas (`LAB_LLM_ROUTE=direct|litellm`): plugin nativo de LiveKit o el proxy LiteLLM (compatible con OpenAI). El spike mide el coste en latencia del salto extra antes de fijar la ruta por defecto.
7. **Medición de latencias.** Fin de turno y primer token vienen del worker (métricas de LiveKit Agents). Conexión y primer audio se miden en el navegador con un único reloj: el fin de habla lo detecta un VAD ligero sobre el micrófono, y el primer audio es la primera muestra con sonido de la pista del agente. El worker también envía su desglose (EOU, TTFT del LLM, TTFB del TTS) por data channel.
8. **Puertos de docker-compose** desplazados (Postgres 5433, Redis 6380) para convivir con instalaciones de Homebrew.
9. **pgvector**: se usa la imagen `pgvector/pgvector:pg16`, pero la extensión se crea en la Fase 1, cuando haga falta.
10. **Spike sin persistencia de proveedor en BD.** La configuración del spike (STT/TTS/LLM, voz, modelo) viaja en la metadata de la sala; los valores por defecto están en `.env`. Las métricas sí se guardan en `turn_metrics`.

---

## ADR-003 — Detección de turno e interrupciones en local (2026-10-19)

**Contexto.** En LiveKit Agents 1.8, el plugin `turn_detector` está obsoleto. Su sustituto, `inference.TurnDetector`, usa en modo dev el modelo cloud `v1` (LiveKit Inference). Además, las interrupciones usan por defecto el modo `adaptive`, que abre un websocket a `agent-gateway.livekit.cloud` con el audio del usuario. Con un LiveKit propio, los dos dan 401; con LiveKit Cloud, enviarían audio a un servicio que no hemos elegido. Lo descubrimos en la prueba de humo del worker contra un `livekit-server` local.

**Decisión.** Fijar explícitamente `inference.TurnDetector(version="v1-mini")` (modelo local) e `interruption={"mode": "vad"}`. Ningún audio sale de nuestra infraestructura salvo hacia los proveedores STT/TTS/LLM configurados.

**Consecuencias.** El detector local consume unos 250 MB de RAM por proceso de worker. Si el spike muestra que el modelo cloud mejora mucho el fin de turno, se valorará como opción por configuración, con su ADR de cumplimiento.

---

## ADR-004 — Auth: verificación, rate limit e IDs (2026-10-19)

1. **Verificación de email obligatoria** (`AUTH_REQUIRE_EMAIL_VERIFICATION=true`). Los emails de verificación solo se envían cuando está activa. Fuera de producción, si no hay SMTP, el enlace se escribe en el log en lugar de romper el registro.
2. **Rate limit de Better Auth activo** (3 intentos / 10 s por IP en login y registro). El almacenamiento es en memoria, por proceso: antes de tener varias instancias web hay que moverlo a Redis (`secondaryStorage`). Solo el e2e lo desactiva (`AUTH_RATE_LIMIT=false`).
3. **Formularios de auth con `method="post"`**. Si el usuario envía antes de que React hidrate, la contraseña no acaba nunca en la URL.
4. **La organización activa vive en la sesión** (`activeOrganizationId`). Al crear una sesión se elige la última membresía. `requireTenant()` vuelve a comprobar la membresía en BD en cada petición: nunca se fía solo de la sesión.

---

## ADR-005 — Medición de latencias en el navegador: límites conocidos (2026-10-19)

- **Primer audio** se mide en el navegador: fin de habla (VAD por energía sobre el micrófono, umbral `MIC_VOICE_THRESHOLD`) → primera muestra audible del agente tras ≥ 300 ms de silencio. Incluye la red y el jitter buffer de WebRTC, que es lo que percibe el usuario.
- El VAD del navegador ignora el micrófono mientras suena el agente, para no contar el eco como voz del usuario. Un barge-in muy temprano puede quedar sin medir (`—`).
- Cada turno del servidor se empareja con el inicio de audio más reciente anterior a su llegada. El worker publica el turno cuando conoce el TTFB del TTS, que siempre es después de empezar a sonar.
- **Primer audio servidor** se mide en el worker: fin de habla según el EOU (timestamp − retraso) → primer frame de audio del agente (estado `speaking`). La primera versión usaba la suma fin de turno + TTFT + TTFB, pero en la primera sesión real se quedó ~600 ms corta: el TTS no empieza con el primer token, sino con la primera frase completa del LLM. La suma se conserva como `pipeline_sum_ms` (cota inferior) en `breakdown`.
- La diferencia entre el primer audio del navegador y el del servidor es red + jitter buffer + reproducción.
- El umbral de voz del micrófono se adapta al ruido de fondo (mínimo `MIC_VOICE_THRESHOLD`, ×3 sobre el suelo de ruido). Con un umbral fijo, en la primera sesión solo 1 de 3 turnos quedó medido.
- Validación pendiente: contrastar una sesión con una grabación de pantalla y audio medida a mano.

## Resultados del spike (Fase 0)

_Pendiente de mediciones reales: necesitan claves de proveedor en `.env`._

Procedimiento: al menos 20 turnos por combinación, frases cortas en español de España, misma red. Los datos salen de `turn_metrics` (`breakdown.labels` identifica los proveedores):

```sql
select breakdown->'labels' as providers,
       count(*) as n,
       percentile_disc(0.5)  within group (order by first_audio_ms) as first_audio_p50,
       percentile_disc(0.95) within group (order by first_audio_ms) as first_audio_p95,
       percentile_disc(0.5)  within group (order by eot_ms)         as eot_p50,
       percentile_disc(0.5)  within group (order by first_token_ms) as ttft_p50
from turn_metrics
where first_audio_ms is not null
group by 1 order by first_audio_p50;
```

| Combinación (STT · LLM · TTS) | Ruta | Preemptive | n | Primer audio p50 / p95 | Fin de turno p50 | TTFT p50 | TTFB TTS p50 |
|---|---|---|---|---|---|---|---|
| _pendiente_ | | | | | | | |

---

## ADR-006 — Claves de IA del cliente (BYOK) por defecto (2026-10-20)

**Contexto.** No hay sistema de cobro por uso (Stripe llega en la Fase 4). Revender STT, TTS y LLM obligaría a medir, facturar y asumir el riesgo de consumo de cada cliente desde el primer día.

**Decisión.** Cada organización conecta sus propias claves de proveedor (LLM, STT, TTS) en una sección «Proveedores de IA». Se guardan cifradas en el vault por tenant y el runtime las resuelve en cada sesión. Las variables `*_API_KEY` del `.env` quedan solo para el laboratorio interno y el desarrollo.

**Consecuencias.**
- BrainAgent no asume el coste variable de los modelos. Sí asume la infraestructura: LiveKit (Cloud o propio), hosting y base de datos.
- Las métricas de uso (`usage_events`) se siguen registrando para mostrar al cliente su consumo y su coste estimado.
- Fricción de alta: una pyme tiene que crear cuentas en varios proveedores. Mitigación: asistente con enlaces, botón «Probar clave» y mínimos claros (un LLM, y STT + TTS solo si usa voz).
- El diseño admite añadir más adelante un modo «claves de BrainAgent» con cobro por uso, sin cambiar el runtime: la resolución de credenciales es la misma, solo cambia de quién es la clave.

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

## Resultados del spike (Fase 0)

_Pendiente: se rellena con las mediciones reales (p50/p95 por combinación de proveedores) cuando haya claves de proveedor en `.env`._

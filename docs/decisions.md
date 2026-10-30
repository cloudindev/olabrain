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

## ADR-006 — Claves de IA del cliente (BYOK) por defecto (2026-10-20) — **SUSTITUIDO por ADR-007**

**Contexto.** No hay sistema de cobro por uso (Stripe llega en la Fase 4). Revender STT, TTS y LLM obligaría a medir, facturar y asumir el riesgo de consumo de cada cliente desde el primer día.

**Decisión.** Cada organización conecta sus propias claves de proveedor (LLM, STT, TTS) en una sección «Proveedores de IA». Se guardan cifradas en el vault por tenant y el runtime las resuelve en cada sesión. Las variables `*_API_KEY` del `.env` quedan solo para el laboratorio interno y el desarrollo.

**Consecuencias.**
- BrainAgent no asume el coste variable de los modelos. Sí asume la infraestructura: LiveKit (Cloud o propio), hosting y base de datos.
- Las métricas de uso (`usage_events`) se siguen registrando para mostrar al cliente su consumo y su coste estimado.
- Fricción de alta: una pyme tiene que crear cuentas en varios proveedores. Mitigación: asistente con enlaces, botón «Probar clave» y mínimos claros (un LLM, y STT + TTS solo si usa voz).
- El diseño admite añadir más adelante un modo «claves de BrainAgent» con cobro por uso, sin cambiar el runtime: la resolución de credenciales es la misma, solo cambia de quién es la clave.

---

## ADR-007 — Saldo prepago con recarga automática (2026-10-20)

**Contexto.** Se descarta BYOK (ADR-006): BrainAgent usa sus propias claves de proveedor y cobra el uso al cliente de forma transparente.

**Decisión.**
1. **Monedero prepago por organización** (en euros). Cada uso (minutos de voz, mensajes, llamadas a herramientas si procede) genera un `usage_event` con su coste de proveedor y su **precio de venta**, que sale de una tabla de precios en configuración. El precio de venta se descuenta del saldo mediante un libro de movimientos (`wallet_ledger`) inmutable.
2. **Sin saldo no hay servicio.** Antes de abrir una conversación se comprueba que el saldo sea mayor que 0. Durante una llamada de voz se reserva saldo por tramos; si se agota, el agente lo dice y cierra con cortesía.
3. **Recarga automática:** el usuario define un umbral X y un importe Y. Cuando el saldo baja de X, se cobra Y al método de pago guardado (Stripe, sin intervención). Si el cobro falla, se avisa por email y el servicio sigue hasta llegar a 0.
4. **Transparencia:** el panel muestra el saldo, los movimientos y el coste de cada conversación desglosado (voz, mensajes, herramientas).

**Consecuencias.**
- Desde la Fase 1 cada conversación registra `usage_events` (cantidades por proveedor); el precio se aplica al construir el monedero.
- La Fase 4 implementa el monedero, Stripe (recargas y recarga automática), los avisos y el bloqueo por saldo.
- Los planes de suscripción de la especificación se sustituyen por recargas prepago. Si hay cuota fija de plataforma, se decide en la Fase 4.

---

## ADR-008 — Conectores nativos: WHMCS y Outlook 365 (2026-10-20)

**Contexto.** Para las apps más pedidas (empezando por WHMCS y Outlook 365), el cliente no debería escribir herramientas: basta con pegar credenciales o iniciar sesión. Nango (CLAUDE.md, Fase 3) añade un servicio más y no cubre WHMCS.

**Decisión.** Conexiones `kind = native` con `config.provider`. Cada proveedor tiene en `apps/connector/src/adapters/native/` un **catálogo curado de herramientas** (nombre, descripción en español, esquema y modo) y su ejecución. Las herramientas se sincronizan como filas `tools`, así que el Tool Router, las confirmaciones, el registro y la asignación a agentes funcionan igual que en el resto de conexiones.

- **WHMCS** (API oficial `includes/api.php`, credenciales `identifier`/`secret`): buscar clientes, ficha, servicios, facturas, factura, tickets, ticket, departamentos; escrituras con confirmación: abrir ticket y responder ticket. Las credenciales se validan al conectar. WHMCS restringe la API por IP: el cliente debe permitir la IP de salida de BrainAgent (en producción, una IP fija de egress).
- **Outlook 365** (Microsoft Graph, OAuth 2.0 + PKCE, permisos delegados): buscar y leer correos, agenda; escrituras con confirmación: enviar correo y crear evento. Los tokens van al vault y se refrescan solos. Usa la app de Entra de la plataforma (`MICROSOFT_CLIENT_ID/SECRET`).

**Consecuencias.** Añadir una app nativa = un fichero con su catálogo + tests contra un mock. Nango sigue siendo una opción para escalar a decenas de apps OAuth en la Fase 3. Las fechas del calendario se calculan con la zona Europe/Madrid (con horario de verano).

---

## ADR-009 — Voz por defecto con Gemini 3.8 Live (2026-10-20)

**Contexto.** El pipeline STT → LLM → TTS (Deepgram + Claude + ElevenLabs) suma tres proveedores y dos saltos de red, y en la Fase 0 medimos 1,5–2,3 s hasta el primer audio. Google ofrece `gemini-3.8-live` (estable), un modelo speech-to-speech con audio nativo, function calling y transcripciones.

**Decisión.** El modo de voz por defecto es `realtime` con `gemini-3.8-live`. Cada personaje del catálogo tiene una voz nativa de Gemini en `config/catalog-voices.json`. El pipeline clásico sigue disponible por configuración (`LAB_MODE=pipeline`) y sus adaptadores no se eliminan.

**Consecuencias.**
- La detección de turno la hace Gemini (no hay métrica de fin de turno). El primer audio se mide desde que el usuario deja de hablar hasta el primer frame del agente.
- Con Gemini Live, las herramientas son síncronas: el modelo espera la respuesta antes de seguir hablando.
- El chat de texto sigue con Claude Haiku mientras el nivel gratuito de Gemini esté saturado (503 / 20–47 s medidos). Con facturación activa en el proyecto de Google se reevalúa con `gemini-3.8-flash` o `gemini-3.5-flash-lite`.
- Residencia UE: pendiente de verificar la disponibilidad de los modelos Live en Vertex `europe-west*`, con informes contradictorios en los foros. En desarrollo se usa la Gemini API (AI Studio).
- Avatar: Google ofrece Live Avatar sobre Gemini 3.8 Live (Gemini Enterprise). Queda como prueba propuesta que reabriría el ADR-001.

---

## ADR-010 — Memoria por contacto (2026-10-20)

**Decisión.**
- Tablas `contacts` (por tenant; se identifican por usuario del panel, email o teléfono) y `contact_memories` (datos cortos con origen `auto | explicit | manual`), con RLS. Las conversaciones apuntan al contacto.
- **Lectura:** el conector añade los últimos 30 recuerdos a la configuración del agente y el runtime los pone en las instrucciones.
- **Escritura automática:** tras cada respuesta del chat (en segundo plano) y al colgar una llamada, un LLM extrae como máximo 3 datos nuevos y duraderos. Se descartan duplicados y datos sensibles (contraseñas, tarjetas, IBAN, salud).
- **Escritura explícita:** herramienta `recordar_dato` cuando la persona pide que se recuerde algo.
- Activable por agente (`policy.memoryEnabled`, activa por defecto).
- **RGPD:** en Contactos se puede ver, añadir y olvidar cada recuerdo, borrar toda la memoria o eliminar el contacto con sus conversaciones (los `usage_events` se conservan desvinculados para la facturación). Cada borrado queda en `audit_log`.
- El `contact_id` lo decide siempre el servidor; el que envíe el cliente se descarta.

**Pendiente.** Retención configurable por organización (borrado automático tras N meses) e identificación de contactos en los canales públicos (widget, WhatsApp, teléfono).

---

## ADR-011 — Despliegue: Vercel + Supabase + LiveKit Cloud (2026-10-20)

**Decisión.**
- **Vercel:** un solo proyecto (`apps/web`): panel en `app.olabrain.com` y el conector (con el chat de texto, portado a TypeScript) montado en `/connector/*` como ruta de Next.js; región `dub1` (Dublín), junto a la base de datos. Web comercial en `olabrain.com`.
- **Supabase** (`eu-west-1`, Irlanda) solo como Postgres (y más adelante Storage S3 para el conocimiento). No usamos su Auth ni su Data API: seguimos con Better Auth y nuestro RLS.
  - La app entra como `brainagent_app` por el *transaction pooler* (puerto 6543, IPv4); las migraciones como `postgres` por el *session pooler* (5432). La conexión directa es solo IPv6 y Vercel no la soporta.
  - Migración 0006: se revocan todos los permisos de `anon` y `authenticated` (actuales y futuros), porque la Data API expone el esquema `public` y las tablas de auth no tienen RLS. Recomendado además desactivar la Data API en el panel de Supabase.
- **LiveKit Cloud** (UE, Frankfurt) para el transporte WebRTC y para alojar el worker de voz. *Agent observability* desactivado: no guardamos audio de clientes en terceros.
- **WHMCS** sin lista de IPs (Vercel no tiene IP fija): clave de acceso de API.

**Motivo.** Cero servidores que mantener; precio fijo y previsible en la base de datos; todo en la UE.

---

## ADR-012 — Home pública con agente de voz (2026-10-21)

**Decisión.**
- `/` es la home pública: un agente (configurable con `HOME_AGENT_TENANT_ID` y `HOME_AGENT_ID`) con el que cualquiera puede hablar con un botón. Tras iniciar sesión se entra por `/panel`.
- **Avatar ligero con vídeo**, no un avatar en tiempo real (ADR-001 sigue vigente): tres clips en bucle (en espera, hablando, saludando) superpuestos y fundidos según el estado del agente (`useVoiceAssistant`). No hay sincronía labial; coste cero y sin latencia añadida.
- **Endpoint público** `POST /api/public/voice` sin sesión, protegido por: comprobación de origen, límite por visitante y hora (hash de la IP con sal; nunca se guarda la IP), tope diario global, duración máxima de la llamada que corta el worker (`max_session_seconds`) y token de 5 minutos. El cliente no elige nada.
- La llamada se identifica como IA en pantalla (AI Act art. 50) y el agente también lo dice.

---

## ADR-013 — Ficha del agente: conversación con avatar, Personalizar y Conexiones (2026-10-21)

**Decisión.**
- Al abrir un agente se ve primero **la conversación**: avatar en vídeo 9:16 a la izquierda (los mismos clips que la home, ADR-012) y un chat único a la derecha donde se escribe, se adjuntan archivos o se inicia una **llamada de voz**; la transcripción de la llamada entra en el mismo hilo. En móvil la conversación ocupa la pantalla completa sobre el avatar, con los dos últimos mensajes flotando sobre los controles.
- Las otras dos vistas: **Personalizar** (identidad y personaje, instrucciones, comportamiento, publicación, con barra de guardado) y **Conexiones** (herramientas por conexión con interruptores, buscador y guardado de cambios). Los enlaces antiguos `?tab=general|tools|test` redirigen a las nuevas.
- **Adjuntos** (imágenes, PDF y texto; máx. 3 archivos y 3 MB por mensaje, por el límite de 4,5 MB de Vercel) van al modelo **solo con ese mensaje**: no se guardan todavía (falta el almacenamiento S3/Supabase Storage); en el historial queda «📎 nombre». Adaptadores: imagen y documento nativos en Anthropic, `inlineData` en Gemini, `image_url`/`file` en OpenAI; el texto va como texto.
- Las respuestas del agente se muestran con Markdown mínimo y seguro (sin HTML).
- Si el agente se llama distinto de su personaje, ambos runtimes le indican su nombre y el saludo de voz lo usa.

---

## ADR-014 — El saludo lo pone el vídeo, con su propia voz (2026-10-21)

**Decisión.** En la home y en la conversación del panel, al pulsar «Hablar» se reproduce el clip de saludo **con su audio** («Hola. ¿En qué te puedo ayudar?») dentro del mismo clic (los navegadores solo permiten sonido iniciado por un gesto). La sesión se pide con `client_greeting: true` y el agente **no saluda**: se le indica que ya ha saludado y espera a que la persona hable. El micrófono se abre al acabar la frase del vídeo (4 s) para que el agente no la oiga. El laboratorio y los canales sin vídeo (teléfono, WhatsApp) siguen con el saludo hablado por el agente.

**Motivo.** Sincronía perfecta entre labios y voz, y el saludo tapa el tiempo de conexión.

---

## ADR-015 — Google Drive y adjuntos de conversación (2026-10-22)

**Decisión.**
- Conector nativo **Google Drive** con OAuth 2.0 + PKCE y el permiso **`drive.file`** (no sensible): el agente crea carpetas y documentos y sube archivos, y solo ve lo que ha creado él. Los permisos `drive`/`drive.readonly` (ver todo el Drive) son «restringidos» y Google exige una auditoría de seguridad anual para usarlos con clientes; se descartan mientras no hagan falta.
- Herramientas: `drive_crear_carpeta`, `drive_listar`, `drive_crear_documento` (Google Doc o texto) y `drive_subir_archivo` (subida multipart, máx. 5 MB).
- **Adjuntos de conversación:** los ficheros adjuntos en el chat se guardan **24 h** en `conversation_files` (RLS) y el agente recibe su `adjunto_id`, para poder usarlos después del turno (p. ej. subirlos a Drive). Los caducados se borran al llegar nuevos.
- Los archivos generados por herramientas (PDF de facturas) se pueden subir por su enlace firmado; el conector solo acepta enlaces válidos de la **misma organización**.
- Cliente OAuth de la plataforma en `GOOGLE_DRIVE_CLIENT_ID` / `GOOGLE_DRIVE_CLIENT_SECRET` (proyecto de Google Cloud «olabrain»).

## ADR-016 — Holded, Factorial y Sesame HR: conectores nativos por clave de API (2026-10-22)

**Contexto.** Pymes españolas: facturación (Holded) y RR. HH. (Factorial, Sesame). Las tres
admiten una clave de API creada por el administrador, sin registrar apps ni verificaciones.

**Decisión.** Conectores nativos con catálogo curado y el mismo flujo: el usuario pega la
clave, la validamos contra el proveedor antes de guardarla (vault) y las herramientas que
escriben piden confirmación. Llamadas JSON comunes en `adapters/native/rest.ts` (egress con
anti-SSRF, errores legibles).

- **Holded:** API **v2** (`Authorization: Bearer`, scopes por clave). La v1 (`key:` y
  `docType`) está en desuso con fin en julio de 2027. Facturas por número visible con
  `find-by-number` (búsqueda difusa: comprobamos coincidencia exacta).
- **Factorial:** versión fijada `2026-10-01` (trimestral, un año de soporte: revisar antes
  de oct. 2027). Cabecera `x-api-key`; una clave de otro entorno responde 200 vacío, así que
  lo tratamos como clave no reconocida. Su documentación reserva las claves a uso interno y
  pide OAuth para integraciones de marketplace: si publicamos en su marketplace, migrar a OAuth.
- **Sesame:** API «legacy» `/core/v3` y `/schedule/v1` (la v4 aún no cubre empleados,
  fichajes ni vacaciones). Host por región `api-{region}.sesametime.com` (validada con
  `^[a-z]{2}\d{1,2}$`). Los datos sensibles del empleado (DNI, SS, cuenta) no llegan al modelo.

**Pendiente.** PDF de facturas de Holded (binario) por enlace firmado, como en WHMCS.

## ADR-017 — Cada conexión pertenece a un agente (2026-10-24)

**Contexto.** Las conexiones eran de la organización y cada agente nuevo recibía todas sus herramientas: un agente creado después heredaba el acceso a WHMCS, Outlook… de otro.

**Decisión.** `connections.agent_id`: una conexión se crea para un agente y solo ese agente recibe (y puede llamar) sus herramientas; el dueño no cambia. Los agentes nuevos empiezan sin herramientas. El conector filtra por dueño al cargar y al ejecutar herramientas, sean cuales sean las asignaciones. Las conexiones existentes pasaron al primer agente que las usaba; las que no tenían uso quedan «sin agente» y cualquier agente puede adoptarlas. Borrar un agente borra sus conexiones y sus credenciales.

## ADR-018 — Monedero prepago y precios por coste real (2026-10-24)

Implementa ADR-007 sin pagos (Stripe pendiente).

- **Saldo en euros** por organización (`wallets`) y libro de movimientos inmutable (`wallet_ledger`, sin UPDATE/DELETE para la app).
- **Precio = coste del proveedor × 1,30**, con las tarifas oficiales en `config/pricing.json` (fuentes y fecha dentro del fichero). Texto: tokens de entrada/salida del modelo que respondió. Voz: por segundo, 0,035 USD/min de coste (Gemini Live con escucha continua + LiveKit Cloud, con colchón por la re-facturación del historial de audio en llamadas largas; medir y ajustar).
- **Saldo de bienvenida:** 5 min de voz + 200 mensajes típicos (8.000 tokens de entrada, 250 de salida) a precio de venta = 0,42 €. Se crea al primer uso de cada organización.
- **Sin saldo** no empiezan turnos de chat ni llamadas (panel y widget, HTTP 402); una llamada en curso no se corta, el saldo puede quedar ligeramente negativo. La demo de la home no se cobra.
- Ajustes manuales: `pnpm --filter @brainagent/db wallet:grant <tenantId> <eur> "<motivo>"`.
- Las tarifas de referencia de CLAUDE.md (voz 0,35 €/min, mensaje 0,01 €) quedan sustituidas por coste × 1,30 por decisión del usuario.

## ADR-019 — Conector Email (SMTP) con destinatarios fijos (2026-10-25)

**Contexto.** El widget recoge datos de contacto de visitantes anónimos y hay que avisar a la empresa por email.

**Decisión.** Conector nativo `smtp` (servidor, puerto, usuario, contraseña, remitente y **destinatarios fijos**). Herramientas: `email_aviso_contacto` (guarda el contacto en Contactos —por email/teléfono, con lo que pide como notas y la conversación enlazada— y envía el aviso con *Reply-To* del visitante) y `email_enviar` (solo a los destinatarios configurados). Ambas se crean con confirmación automática: en el widget no tiene sentido pedírsela al visitante, y no pueden escribir a direcciones arbitrarias (no sirven de relé de spam). El host pasa por la política de salida (sin redes privadas salvo lista blanca) y se conecta a la IP resuelta.

## ADR-020 — Recargas con Stripe; OlaBrain factura (2026-10-25)

**Contexto.** El monedero (ADR-018) necesitaba cobro real. La cuenta de Stripe (ES, modo real) tenía activado por defecto *Managed Payments*: Stripe/Link como vendedor, factura a nombre de Link, cargo «LINK.COM*», comisión extra y sin facturas propias.

**Decisión.**
- **OlaBrain es el vendedor:** `managed_payments.enabled=false` en cada Checkout. Facturas de Stripe Invoicing a nombre de la empresa, con IVA 21 % exclusivo (`STRIPE_TAX_RATE_ID`) y el NIF del cliente (`tax_id_collection`). El saldo recibe el importe sin IVA.
- **Recarga manual:** Checkout `mode=payment` (10–1000 €), cliente de Stripe por organización (`wallets.stripe_customer_id`), `setup_future_usage=off_session` para guardar la tarjeta (`wallets.stripe_payment_method_id`) y `invoice_creation`.
- **Recarga automática:** cuando un turno o llamada empieza con saldo bajo el umbral y hay tarjeta guardada, tras la respuesta se reclama el intento en la BD (`auto_recharge_attempted_at`, uno por hora como mucho) y se crea una factura `charge_automatically` pagada *off-session*. Si la tarjeta falla, la factura queda abierta y se reintenta pasada una hora.
- **Abono del saldo:** solo pagos que Stripe da por pagados, por el webhook (`checkout.session.completed`, `checkout.session.async_payment_succeeded`, `invoice.paid`, firmado) o al volver de Checkout, lo que llegue antes. `creditTopup` es idempotente por la referencia del pago (índice único en `wallet_ledger`).
- **Clave restringida** «acceso completo salvo operaciones confidenciales»: no puede mover fondos fuera de la cuenta.

**Pendiente.** IVA para clientes de fuera de España (B2B UE con inversión del sujeto pasivo, OSS), hoy siempre 21 %.

## ADR-021 — Conector MyTutor por su API no documentada, con caché por organización (2026-10-30)

**Contexto.** MyTutor (my-tutor.es) es el software de gestión de Coverde Cogar S.L. (empresa 25) y no exporta datos. Su frontend usa una API REST en `api.my-tutor.es/v1`, sin documentación pública, que observamos y describimos en `docs/connectors/mytutor-schema.md`. El acceso es con la cuenta que el cliente nos da.

**Decisión.**
- Es un conector **nativo** (`kind: native`, `provider: "mytutor"`), como WHMCS u Holded: así reutiliza el vault, el Tool Router y las conexiones por agente (ADR-017) sin añadir un `kind` nuevo.
- **Credenciales:** el email y la contraseña van al vault, cifrados con la clave del tenant; en la configuración solo quedan la empresa y los ajustes de sincronización. La sesión va por cookie (`cookie_profieco`, 10 min) y se renueva con `/auth/refresh`.
- **Solo lectura:** únicamente `GET` contra la API, más el login y la renovación; los tests lo comprueban. Como mucho 2 peticiones por segundo, reintentos con espera creciente en 429/5xx y `User-Agent: OlaBrain-Connector/0.1`. Todo sale por el proxy de salida.
- **Caché por organización:** 12 tablas `mytutor_*` (clientes, proveedores, servicios de empresa, vehículos, trabajadores, documentos de trabajadores, vencimientos, y de tacógrafo vehículos, tarjetas y descargas, más documentos de control y órdenes de residuos).
  - Todas con `tenant_id`, RLS, `source_id`, columnas de búsqueda, `raw` y `synced_at`.
  - Upsert por `source_id`; lo que desaparece en una pasada completa recibe `deleted_at`.
  - Las órdenes de residuos (unas 15.000 de ~10 KB) guardan `raw` recortado: escalares más ids y nombres de los objetos anidados.
- **Sincronización sin BullMQ:** producción (Vercel Hobby + Supabase) no tiene Redis.
  - pg_cron de Supabase llama cada hora a `/api/cron/mytutor-sync`, autenticado con `CRON_SECRET`, que se guarda en Supabase Vault.
  - La sincronización es reanudable: guarda la entidad y la página en `mytutor_sync_runs`, con una sola ejecución activa por conexión (índice único más latido). Lo que no cabe en una invocación de 300 s sigue en la siguiente.
  - Cadencia por defecto de 6 h; las órdenes de residuos, como mucho una vez al día.
  - La empresa piloto completa todo en unos 160 s.
- **PDF bajo demanda:** no copiamos documentos a S3. El agente y el panel dan un enlace firmado (24 h) que los descarga de MyTutor en el momento, siguiendo solo enlaces de `*.my-tutor.es`.
- **Herramientas:** 13, todas de lectura y con confirmación automática, respondidas desde la caché. Devuelven como mucho 50 filas, con `source: "mytutor"` y `synced_at`. Al modelo nunca le llegan NIF, fecha de nacimiento, emails, teléfonos personales ni direcciones de los trabajadores.
- **Panel:** estado, última sincronización y registros por entidad; «Sincronizar ahora», frecuencia, cambio de contraseña (se comprueba antes de guardar) y revocación (borrar la conexión elimina la contraseña y la caché). Una tabla por entidad con búsqueda, filtros y exportación CSV/XLSX.

**Riesgos.**
- La API puede cambiar sin aviso. Cada entidad falla por separado y lo indica en el panel, y nunca se vacía una tabla por una pasada que vuelva vacía.
- Los documentos de trabajadores tienen el mapeo hecho pero sin verificar, porque la empresa piloto no tiene ninguno.

**Pendiente.**
- **ProfiFLEET** (`profifleet.my-tutor.es/V5`, Veosat en marca blanca, PHP + Firestore, SSO con el `veosat_token` del JWT): fuera de alcance.
- **Libra ERP de Edisa:** las facturas del cliente salen de ahí, no de MyTutor; se integrará más adelante.
- `profitach/connections/company/25/company-cards` devuelve 403 con este usuario: no se usa.

## ADR-022 — Compartir un agente con enlace y contraseña (2026-10-31)

**Contexto.** Además del widget para webs, el cliente quiere dar acceso a un agente (p. ej. un asistente interno conectado a MyTutor) a personas sin cuenta en OlaBrain.

**Decisión.**
- **El enlace:** en «Publicar» › Compartir se crea un canal `share_link`, uno por agente. Su enlace es `/c/{id}`: el id es un uuid aleatorio y además hace falta una contraseña que fija el admin.
- **La contraseña:**
  - Se guarda solo como hash scrypt, nunca en claro ni se envía al navegador.
  - Si es correcta, se da una cookie HttpOnly de 30 días, firmada (HMAC) junto con el hash actual. Cambiar la contraseña o desactivar el enlace cierra todas las sesiones abiertas.
  - Tras 10 intentos fallidos por visitante y enlace, se bloquea 15 minutos. Los intentos quedan en `audit_log`.
- **El chat:** el mismo chat y voz del widget, extraídos a `lib/public-chat.ts`: mismo cobro por saldo, límites por visitante y conversaciones guardadas, con `channel = "share"`.
- **Herramientas:**
  - A diferencia del widget, que solo usa las herramientas marcadas como públicas, el enlace compartido da **todas las herramientas del agente**: está pensado para personas de confianza.
  - Las escrituras siguen pidiendo confirmación.
  - Las conversaciones del enlace no generan Leads.

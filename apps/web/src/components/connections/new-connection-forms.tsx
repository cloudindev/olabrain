"use client";

import { Badge, Button, Card, Checkbox, Field, Input, Select, Textarea } from "@brainagent/ui";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import {
  createContext,
  useContext,
  useState,
  useTransition,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  createHttpConnection,
  createMcpConnection,
  createGoogleDriveConnection,
  createMicrosoft365Connection,
  createApiKeyConnection,
  createSmtpConnection,
  createWhmcsConnection,
  createOpenApiConnection,
  createSqlConnection,
  previewOpenApi,
} from "@/app/(app)/connections/actions";

export type NewConnectionKind =
  | "mcp"
  | "openapi"
  | "sql"
  | "http"
  | "whmcs"
  | "microsoft365"
  | "googledrive"
  | "smtp"
  | ApiKeyProvider;

type ApiKeyProvider = "holded" | "factorial" | "sesame";
type ApiAuthType = "none" | "bearer" | "api_key_header" | "api_key_query" | "basic";
type Secret = { token?: string; apiKey?: string; username?: string; password?: string };

function useSubmit() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  function submit(
    action: () => Promise<
      | { ok: true; data: { connectionId: string; authorizationUrl?: string } }
      | { ok: false; error: string }
    >,
  ) {
    setError(null);
    start(async () => {
      const res = await action();
      if (!res.ok) return setError(res.error);
      if (res.data.authorizationUrl) window.location.href = res.data.authorizationUrl;
      else router.push(`/connections/${res.data.connectionId}`);
    });
  }
  return { error, pending, submit };
}

function FormCard({
  children,
  onSubmit,
  error,
}: {
  children: ReactNode;
  onSubmit: (e: FormEvent) => void;
  error: string | null;
}) {
  return (
    <Card className="max-w-2xl p-5">
      <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
        {children}
        {error ? (
          <p role="alert" className="text-sm text-bad">
            {error}
          </p>
        ) : null}
      </form>
    </Card>
  );
}

/** Secret fields for API auth types (values go straight to the vault). */
function ApiAuthFields({
  auth,
  setAuth,
  keyName,
  setKeyName,
  secret,
  setSecret,
}: {
  auth: ApiAuthType;
  setAuth: (v: ApiAuthType) => void;
  keyName: string;
  setKeyName: (v: string) => void;
  secret: Secret;
  setSecret: (v: Secret) => void;
}) {
  const t = useTranslations("connections");
  return (
    <>
      <Field label={t("auth")} htmlFor="c-auth">
        <Select id="c-auth" value={auth} onChange={(e) => setAuth(e.target.value as ApiAuthType)}>
          <option value="none">{t("authNone")}</option>
          <option value="bearer">{t("authBearer")}</option>
          <option value="api_key_header">{t("authApiKeyHeader")}</option>
          <option value="api_key_query">{t("authApiKeyQuery")}</option>
          <option value="basic">{t("authBasic")}</option>
        </Select>
      </Field>
      {auth === "bearer" ? (
        <Field label={t("token")} htmlFor="c-token" hint={t("secretHint")}>
          <Input
            id="c-token"
            type="password"
            autoComplete="off"
            value={secret.token ?? ""}
            onChange={(e) => setSecret({ token: e.target.value })}
          />
        </Field>
      ) : null}
      {auth === "api_key_header" || auth === "api_key_query" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("apiKeyName")} htmlFor="c-keyname">
            <Input
              id="c-keyname"
              value={keyName}
              placeholder={auth === "api_key_header" ? "X-API-Key" : "api_key"}
              onChange={(e) => setKeyName(e.target.value)}
            />
          </Field>
          <Field label={t("apiKey")} htmlFor="c-apikey" hint={t("secretHint")}>
            <Input
              id="c-apikey"
              type="password"
              autoComplete="off"
              value={secret.apiKey ?? ""}
              onChange={(e) => setSecret({ apiKey: e.target.value })}
            />
          </Field>
        </div>
      ) : null}
      {auth === "basic" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("username")} htmlFor="c-user">
            <Input
              id="c-user"
              autoComplete="off"
              value={secret.username ?? ""}
              onChange={(e) => setSecret({ ...secret, username: e.target.value })}
            />
          </Field>
          <Field label={t("password")} htmlFor="c-pass" hint={t("secretHint")}>
            <Input
              id="c-pass"
              type="password"
              autoComplete="off"
              value={secret.password ?? ""}
              onChange={(e) => setSecret({ ...secret, password: e.target.value })}
            />
          </Field>
        </div>
      ) : null}
    </>
  );
}

function McpForm() {
  const agentId = useContext(AgentIdContext);
  const t = useTranslations("connections");
  const { error, pending, submit } = useSubmit();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [auth, setAuth] = useState<"none" | "bearer" | "oauth">("none");
  const [bearer, setBearer] = useState("");
  return (
    <FormCard
      error={error}
      onSubmit={(e) => {
        e.preventDefault();
        submit(() =>
          createMcpConnection(
            { name, url, auth, bearer: auth === "bearer" ? bearer : undefined },
            agentId,
          ),
        );
      }}
    >
      <Field label={t("name")} htmlFor="c-name">
        <Input id="c-name" value={name} onChange={(e) => setName(e.target.value)} required />
      </Field>
      <Field label={t("url")} htmlFor="c-url">
        <Input
          id="c-url"
          type="url"
          placeholder="https://mcp.ejemplo.com/mcp"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          required
        />
      </Field>
      <Field label={t("auth")} htmlFor="c-auth">
        <Select id="c-auth" value={auth} onChange={(e) => setAuth(e.target.value as typeof auth)}>
          <option value="none">{t("authNone")}</option>
          <option value="bearer">{t("authBearer")}</option>
          <option value="oauth">{t("authOauth")}</option>
        </Select>
      </Field>
      {auth === "bearer" ? (
        <Field label={t("token")} htmlFor="c-token" hint={t("secretHint")}>
          <Input
            id="c-token"
            type="password"
            autoComplete="off"
            value={bearer}
            onChange={(e) => setBearer(e.target.value)}
          />
        </Field>
      ) : null}
      <Button type="submit" disabled={pending || !name || !url}>
        {auth === "oauth" ? t("authorize") : t("connect")}
      </Button>
    </FormCard>
  );
}

type Operation = {
  operationId: string;
  name: string;
  description: string;
  mode: "read" | "write";
  tag: string | null;
};

function OpenApiForm() {
  const agentId = useContext(AgentIdContext);
  const t = useTranslations("connections");
  const { error, pending, submit } = useSubmit();
  const [specUrl, setSpecUrl] = useState("");
  const [specText, setSpecText] = useState("");
  const [preview, setPreview] = useState<{ title: string; operations: Operation[] } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, startLoad] = useTransition();
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [auth, setAuth] = useState<ApiAuthType>("none");
  const [keyName, setKeyName] = useState("");
  const [secret, setSecret] = useState<Secret>({});

  function load() {
    setLoadError(null);
    startLoad(async () => {
      const res = await previewOpenApi(specText ? { specText } : { specUrl });
      if (!res.ok) return setLoadError(res.error);
      setPreview(res.data);
      setName((n) => n || res.data.title);
      setBaseUrl((b) => b || res.data.baseUrl || "");
      // Read operations preselected; writes are an explicit choice.
      setSelected(
        new Set(res.data.operations.filter((o) => o.mode === "read").map((o) => o.operationId)),
      );
    });
  }

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <Card className="flex flex-col gap-4 p-5">
        <Field label={t("specUrl")} htmlFor="c-spec-url">
          <Input
            id="c-spec-url"
            type="url"
            placeholder="https://api.ejemplo.com/openapi.json"
            value={specUrl}
            onChange={(e) => setSpecUrl(e.target.value)}
          />
        </Field>
        <Field label={t("specText")} htmlFor="c-spec-text">
          <Textarea
            id="c-spec-text"
            rows={4}
            className="font-mono text-xs"
            value={specText}
            onChange={(e) => setSpecText(e.target.value)}
          />
        </Field>
        <div>
          <Button
            type="button"
            variant="secondary"
            disabled={loading || (!specUrl && !specText)}
            onClick={load}
          >
            {t("load")}
          </Button>
        </div>
        {loadError ? <p className="text-sm text-bad">{loadError}</p> : null}
      </Card>

      {preview ? (
        <FormCard
          error={error}
          onSubmit={(e) => {
            e.preventDefault();
            submit(() =>
              createOpenApiConnection(
                {
                  name,
                  specUrl: specText ? undefined : specUrl,
                  specText: specText || undefined,
                  baseUrl,
                  auth: { type: auth, name: keyName || undefined },
                  secret,
                  operationIds: [...selected],
                },
                agentId,
              ),
            );
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("name")} htmlFor="c-name">
              <Input id="c-name" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label={t("baseUrl")} htmlFor="c-base">
              <Input
                id="c-base"
                type="url"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
              />
            </Field>
          </div>
          <ApiAuthFields
            auth={auth}
            setAuth={setAuth}
            keyName={keyName}
            setKeyName={setKeyName}
            secret={secret}
            setSecret={setSecret}
          />
          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-medium text-ink-2">
                {t("operations")} ({selected.size}/{preview.operations.length})
              </p>
              <div className="flex gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setSelected(new Set(preview.operations.map((o) => o.operationId)))}
                >
                  {t("selectAll")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setSelected(new Set())}
                >
                  {t("selectNone")}
                </Button>
              </div>
            </div>
            <ul className="max-h-96 divide-y divide-line overflow-y-auto rounded-[var(--radius-control)] border border-line">
              {preview.operations.map((op) => (
                <li key={op.operationId} className="flex items-start gap-3 px-3 py-2">
                  <Checkbox
                    aria-label={op.name}
                    checked={selected.has(op.operationId)}
                    onChange={(e) =>
                      setSelected((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(op.operationId);
                        else next.delete(op.operationId);
                        return next;
                      })
                    }
                    className="mt-0.5"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-sm">{op.name}</p>
                    <p className="line-clamp-2 text-xs text-ink-2">{op.description}</p>
                  </div>
                  <Badge tone={op.mode === "write" ? "warn" : "neutral"}>{t(op.mode)}</Badge>
                </li>
              ))}
            </ul>
          </div>
          <Button type="submit" disabled={pending || selected.size === 0 || !baseUrl || !name}>
            {t("create")}
          </Button>
        </FormCard>
      ) : null}
    </div>
  );
}

function SqlForm() {
  const agentId = useContext(AgentIdContext);
  const t = useTranslations("connections");
  const { error, pending, submit } = useSubmit();
  const [v, setV] = useState({
    name: "",
    dialect: "postgres",
    host: "",
    port: "5432",
    database: "",
    user: "",
    password: "",
    ssl: true,
  });
  const set = (k: keyof typeof v, value: string | boolean) =>
    setV((prev) => ({ ...prev, [k]: value }));
  const defaultPort = { postgres: "5432", mysql: "3306", mssql: "1433" } as Record<string, string>;
  return (
    <FormCard
      error={error}
      onSubmit={(e) => {
        e.preventDefault();
        submit(() =>
          createSqlConnection(
            {
              name: v.name,
              config: {
                dialect: v.dialect,
                host: v.host,
                port: Number(v.port),
                database: v.database,
                user: v.user,
                ssl: v.ssl,
              },
              password: v.password,
            },
            agentId,
          ),
        );
      }}
    >
      <p className="text-sm text-ink-2">{t("sqlHint")}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("name")} htmlFor="c-name">
          <Input id="c-name" value={v.name} onChange={(e) => set("name", e.target.value)} />
        </Field>
        <Field label={t("dialect")} htmlFor="c-dialect">
          <Select
            id="c-dialect"
            value={v.dialect}
            onChange={(e) => {
              set("dialect", e.target.value);
              set("port", defaultPort[e.target.value] ?? v.port);
            }}
          >
            <option value="postgres">PostgreSQL</option>
            <option value="mysql">MySQL / MariaDB</option>
            <option value="mssql">SQL Server</option>
          </Select>
        </Field>
        <Field label={t("host")} htmlFor="c-host">
          <Input id="c-host" value={v.host} onChange={(e) => set("host", e.target.value)} />
        </Field>
        <Field label={t("port")} htmlFor="c-port">
          <Input
            id="c-port"
            inputMode="numeric"
            value={v.port}
            onChange={(e) => set("port", e.target.value)}
          />
        </Field>
        <Field label={t("database")} htmlFor="c-db">
          <Input id="c-db" value={v.database} onChange={(e) => set("database", e.target.value)} />
        </Field>
        <Field label={t("user")} htmlFor="c-user">
          <Input
            id="c-user"
            autoComplete="off"
            value={v.user}
            onChange={(e) => set("user", e.target.value)}
          />
        </Field>
        <Field label={t("password")} htmlFor="c-pass" hint={t("secretHint")}>
          <Input
            id="c-pass"
            type="password"
            autoComplete="off"
            value={v.password}
            onChange={(e) => set("password", e.target.value)}
          />
        </Field>
      </div>
      <Checkbox label={t("ssl")} checked={v.ssl} onChange={(e) => set("ssl", e.target.checked)} />
      <Button type="submit" disabled={pending || !v.name || !v.host || !v.database || !v.user}>
        {t("create")}
      </Button>
    </FormCard>
  );
}

function HttpForm() {
  const agentId = useContext(AgentIdContext);
  const t = useTranslations("connections");
  const { error, pending, submit } = useSubmit();
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [auth, setAuth] = useState<ApiAuthType>("none");
  const [keyName, setKeyName] = useState("");
  const [secret, setSecret] = useState<Secret>({});
  return (
    <FormCard
      error={error}
      onSubmit={(e) => {
        e.preventDefault();
        submit(() =>
          createHttpConnection(
            {
              name,
              baseUrl,
              auth: { type: auth, name: keyName || undefined },
              secret,
            },
            agentId,
          ),
        );
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("name")} htmlFor="c-name">
          <Input id="c-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t("baseUrl")} htmlFor="c-base">
          <Input
            id="c-base"
            type="url"
            placeholder="https://api.ejemplo.com/v1"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
          />
        </Field>
      </div>
      <ApiAuthFields
        auth={auth}
        setAuth={setAuth}
        keyName={keyName}
        setKeyName={setKeyName}
        secret={secret}
        setSecret={setSecret}
      />
      <Button type="submit" disabled={pending || !name || !baseUrl}>
        {t("create")}
      </Button>
    </FormCard>
  );
}

function WhmcsForm() {
  const agentId = useContext(AgentIdContext);
  const t = useTranslations("connections");
  const { error, pending, submit } = useSubmit();
  const [v, setV] = useState({
    name: "WHMCS",
    url: "",
    identifier: "",
    secret: "",
    accessKey: "",
  });
  const set = (k: keyof typeof v, value: string) => setV((prev) => ({ ...prev, [k]: value }));
  return (
    <FormCard
      error={error}
      onSubmit={(e) => {
        e.preventDefault();
        submit(() => createWhmcsConnection(v, agentId));
      }}
    >
      <p className="text-sm text-ink-2">{t("providers.whmcs.help")}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("name")} htmlFor="w-name">
          <Input id="w-name" value={v.name} onChange={(e) => set("name", e.target.value)} />
        </Field>
        <Field label={t("providers.whmcs.url")} htmlFor="w-url">
          <Input
            id="w-url"
            type="url"
            placeholder="https://clientes.miempresa.com/"
            value={v.url}
            onChange={(e) => set("url", e.target.value)}
          />
        </Field>
        <Field label={t("providers.whmcs.identifier")} htmlFor="w-id">
          <Input
            id="w-id"
            autoComplete="off"
            value={v.identifier}
            onChange={(e) => set("identifier", e.target.value)}
          />
        </Field>
        <Field label={t("providers.whmcs.secret")} htmlFor="w-secret" hint={t("secretHint")}>
          <Input
            id="w-secret"
            type="password"
            autoComplete="off"
            value={v.secret}
            onChange={(e) => set("secret", e.target.value)}
          />
        </Field>
        <div className="sm:col-span-2">
          <Field
            label={t("providers.whmcs.accessKey")}
            htmlFor="w-access"
            hint={t("providers.whmcs.accessKeyHint")}
          >
            <Input
              id="w-access"
              type="password"
              autoComplete="off"
              value={v.accessKey}
              onChange={(e) => set("accessKey", e.target.value)}
            />
          </Field>
        </div>
      </div>
      <Button type="submit" disabled={pending || !v.name || !v.url || !v.identifier || !v.secret}>
        {t("connect")}
      </Button>
    </FormCard>
  );
}

/** Email (SMTP): server, credentials, sender and the fixed recipients. */
function SmtpForm() {
  const agentId = useContext(AgentIdContext);
  const t = useTranslations("connections");
  const { error, pending, submit } = useSubmit();
  const [v, setV] = useState({
    name: "Email",
    host: "",
    port: "587",
    user: "",
    password: "",
    from: "",
    recipients: "",
  });
  const set = (k: keyof typeof v, value: string) => setV((prev) => ({ ...prev, [k]: value }));
  const recipients = v.recipients.split(/[\s,;]+/).filter(Boolean);
  return (
    <FormCard
      error={error}
      onSubmit={(e) => {
        e.preventDefault();
        submit(() =>
          createSmtpConnection(
            {
              name: v.name,
              host: v.host,
              port: Number(v.port),
              user: v.user,
              password: v.password,
              from: v.from,
              recipients,
            },
            agentId,
          ),
        );
      }}
    >
      <p className="text-sm text-ink-2">{t("providers.smtp.help")}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("name")} htmlFor="s-name">
          <Input id="s-name" value={v.name} onChange={(e) => set("name", e.target.value)} />
        </Field>
        <div className="grid grid-cols-[1fr_96px] gap-3">
          <Field label={t("providers.smtp.host")} htmlFor="s-host">
            <Input
              id="s-host"
              placeholder="smtp.miempresa.com"
              value={v.host}
              onChange={(e) => set("host", e.target.value)}
            />
          </Field>
          <Field label={t("providers.smtp.port")} htmlFor="s-port">
            <Input
              id="s-port"
              inputMode="numeric"
              value={v.port}
              onChange={(e) => set("port", e.target.value)}
            />
          </Field>
        </div>
        <Field label={t("providers.smtp.user")} htmlFor="s-user">
          <Input
            id="s-user"
            autoComplete="off"
            value={v.user}
            onChange={(e) => set("user", e.target.value)}
          />
        </Field>
        <Field label={t("providers.smtp.password")} htmlFor="s-pass" hint={t("secretHint")}>
          <Input
            id="s-pass"
            type="password"
            autoComplete="off"
            value={v.password}
            onChange={(e) => set("password", e.target.value)}
          />
        </Field>
        <Field label={t("providers.smtp.from")} htmlFor="s-from">
          <Input
            id="s-from"
            placeholder="Web <avisos@miempresa.com>"
            value={v.from}
            onChange={(e) => set("from", e.target.value)}
          />
        </Field>
        <Field
          label={t("providers.smtp.recipients")}
          htmlFor="s-to"
          hint={t("providers.smtp.recipientsHint")}
        >
          <Input
            id="s-to"
            placeholder="ventas@miempresa.com, luis@miempresa.com"
            value={v.recipients}
            onChange={(e) => set("recipients", e.target.value)}
          />
        </Field>
      </div>
      <Button
        type="submit"
        disabled={pending || !v.name || !v.host || !v.from || recipients.length === 0}
      >
        {t("connect")}
      </Button>
    </FormCard>
  );
}

/** Holded, Factorial, Sesame HR: name + API key (+ region for Sesame), checked on connect. */
function ApiKeyForm({ provider }: { provider: ApiKeyProvider }) {
  const agentId = useContext(AgentIdContext);
  const t = useTranslations("connections");
  const { error, pending, submit } = useSubmit();
  const [v, setV] = useState({
    name: t(`providers.${provider}.name`),
    apiKey: "",
    region: "eu1",
  });
  const set = (k: keyof typeof v, value: string) => setV((prev) => ({ ...prev, [k]: value }));
  return (
    <FormCard
      error={error}
      onSubmit={(e) => {
        e.preventDefault();
        submit(() =>
          createApiKeyConnection(
            provider,
            {
              name: v.name,
              apiKey: v.apiKey,
              region: provider === "sesame" ? v.region : undefined,
            },
            agentId,
          ),
        );
      }}
    >
      <p className="text-sm text-ink-2">{t(`providers.${provider}.help`)}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("name")} htmlFor="k-name">
          <Input id="k-name" value={v.name} onChange={(e) => set("name", e.target.value)} />
        </Field>
        {provider === "sesame" ? (
          <Field
            label={t("providers.sesame.region")}
            htmlFor="k-region"
            hint={t("providers.sesame.regionHint")}
          >
            <Input id="k-region" value={v.region} onChange={(e) => set("region", e.target.value)} />
          </Field>
        ) : null}
        <div className="sm:col-span-2">
          <Field label={t(`providers.${provider}.apiKey`)} htmlFor="k-key" hint={t("secretHint")}>
            <Input
              id="k-key"
              type="password"
              autoComplete="off"
              value={v.apiKey}
              onChange={(e) => set("apiKey", e.target.value)}
            />
          </Field>
        </div>
      </div>
      <Button type="submit" disabled={pending || !v.name || v.apiKey.trim().length < 8}>
        {t("connect")}
      </Button>
    </FormCard>
  );
}

function Microsoft365Form() {
  const agentId = useContext(AgentIdContext);
  const t = useTranslations("connections");
  const { error, pending, submit } = useSubmit();
  const [name, setName] = useState("Outlook 365");
  return (
    <FormCard
      error={error}
      onSubmit={(e) => {
        e.preventDefault();
        submit(() => createMicrosoft365Connection({ name }, agentId));
      }}
    >
      <p className="text-sm text-ink-2">{t("providers.microsoft365.help")}</p>
      <Field label={t("name")} htmlFor="m-name">
        <Input id="m-name" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Button type="submit" disabled={pending || !name}>
        {t("providers.microsoft365.connect")}
      </Button>
    </FormCard>
  );
}

function GoogleDriveForm() {
  const agentId = useContext(AgentIdContext);
  const t = useTranslations("connections");
  const { error, pending, submit } = useSubmit();
  const [name, setName] = useState("Google Drive");
  return (
    <FormCard
      error={error}
      onSubmit={(e) => {
        e.preventDefault();
        submit(() => createGoogleDriveConnection({ name }, agentId));
      }}
    >
      <p className="text-sm text-ink-2">{t("providers.googledrive.help")}</p>
      <Field label={t("name")} htmlFor="g-name">
        <Input id="g-name" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Button type="submit" disabled={pending || !name}>
        {t("providers.googledrive.connect")}
      </Button>
    </FormCard>
  );
}

/** The agent the new connection is for (connections belong to one agent). */
const AgentIdContext = createContext("");

export function NewConnectionForm({ kind, agentId }: { kind: NewConnectionKind; agentId: string }) {
  return (
    <AgentIdContext.Provider value={agentId}>
      <KindForm kind={kind} />
    </AgentIdContext.Provider>
  );
}

function KindForm({ kind }: { kind: NewConnectionKind }) {
  if (kind === "whmcs") return <WhmcsForm />;
  if (kind === "microsoft365") return <Microsoft365Form />;
  if (kind === "googledrive") return <GoogleDriveForm />;
  if (kind === "smtp") return <SmtpForm />;
  if (kind === "holded" || kind === "factorial" || kind === "sesame")
    return <ApiKeyForm provider={kind} />;
  if (kind === "mcp") return <McpForm />;
  if (kind === "openapi") return <OpenApiForm />;
  if (kind === "sql") return <SqlForm />;
  return <HttpForm />;
}

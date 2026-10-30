/**
 * Global persona catalog (tenant_id NULL). Voice ids come from config/catalog-voices.json,
 * never from code. Every greeting introduces the agent as an AI (AI Act art. 50).
 */
type CatalogPersona = {
  slug: string;
  name: string;
  role: string;
  traits: { tone: string; formality: "tú" | "usted"; length: "corta" | "media" };
  greeting: string;
  basePrompt: string;
  avatarUrl: string | null;
  avatarVideo: string | null;
};

const VOICE_STYLE =
  "Hablas en español de España. Si la conversación es por voz, responde con frases cortas, " +
  "empieza con una frase muy breve y no uses listas, markdown, emojis ni URLs. " +
  "Si no sabes algo o no tienes una herramienta para comprobarlo, dilo y ofrece tomar nota. " +
  "Nunca inventes datos. Eres una inteligencia artificial y lo dices si te lo preguntan.";

/** Greeting without article ("soy Enzo, asistente virtual…"). */
const NEUTRAL = ["enzo"];

/** Portraits (apps/web/public) and video avatars of the catalog personas. */
const AVATARS: Record<string, { image: string; video?: string }> = {
  alba: { image: "/personas/alba.jpg", video: "/alba" },
  mateo: { image: "/personas/mateo.jpg" },
  lia: { image: "/personas/lia.jpg", video: "/lia" },
  enzo: { image: "/personas/enzo.jpg" },
  teo: { image: "/personas/teo.jpg" },
  nora: { image: "/personas/nora.jpg" },
  cloe: { image: "/personas/cloe.jpg", video: "/cloe" },
};

function persona(
  slug: string,
  name: string,
  role: string,
  traits: CatalogPersona["traits"],
): CatalogPersona {
  const article = ["lia", "nora", "vega", "iris", "alba", "cloe"].includes(slug)
    ? "una "
    : NEUTRAL.includes(slug)
      ? ""
      : "un ";
  return {
    slug,
    name,
    role,
    traits,
    greeting: `Hola, soy ${name}, ${article}asistente virtual con inteligencia artificial. ¿En qué puedo ayudarte?`,
    // Personas are a face, a voice and a character; what the agent does (its role) and
    // its tools are set per agent.
    basePrompt: `Eres ${name}, asistente virtual de la empresa. Tu tono es ${traits.tone} y tratas a la gente de ${traits.formality}. ${VOICE_STYLE}`,
    avatarUrl: AVATARS[slug]?.image ?? null,
    avatarVideo: AVATARS[slug]?.video ?? null,
  };
}

const cercano = { tone: "cercano", formality: "tú", length: "corta" } as const;
const profesional = { tone: "profesional", formality: "usted", length: "corta" } as const;
const detallado = { tone: "profesional", formality: "tú", length: "media" } as const;

export const CATALOG_PERSONAS: CatalogPersona[] = [
  persona(
    "lia",
    "Lía",
    "Recepción",
    cercano,
  ),
  persona(
    "mateo",
    "Mateo",
    "Ventas",
    cercano,
  ),
  persona(
    "nora",
    "Nora",
    "Soporte",
    cercano,
  ),
  persona(
    "hugo",
    "Hugo",
    "Operaciones",
    detallado,
  ),
  persona(
    "vega",
    "Vega",
    "Recursos humanos",
    profesional,
  ),
  persona(
    "teo",
    "Teo",
    "Finanzas",
    profesional,
  ),
  persona(
    "iris",
    "Iris",
    "Marketing",
    cercano,
  ),
  persona(
    "bruno",
    "Bruno",
    "Helpdesk IT",
    detallado,
  ),
  persona(
    "alba",
    "Alba",
    "Agenda",
    cercano,
  ),
  persona(
    "leo",
    "Leo",
    "Logística",
    detallado,
  ),
  persona(
    "enzo",
    "Enzo",
    "Atención al cliente",
    profesional,
  ),
  persona(
    "max",
    "Max",
    "Analista de datos",
    detallado,
  ),
];

/**
 * Personas private to one organization (seed:tenants; ADR-026). They use the catalog's
 * shape but are stored with that tenant's id, so no other organization can see them.
 */
export const TENANT_PERSONAS: { tenantName: string; persona: CatalogPersona }[] = [
  { tenantName: "Coverde", persona: persona("cloe", "Cloe", "Asistente", cercano) },
];

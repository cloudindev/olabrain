/** URL-safe slug from an organization name, with a short random suffix to avoid clashes. */
export function slugify(name: string, suffix: string = randomSuffix()): string {
  const base = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return [base || "org", suffix].filter(Boolean).join("-");
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 6);
}

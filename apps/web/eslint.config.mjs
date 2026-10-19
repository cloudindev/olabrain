import { FlatCompat } from "@eslint/eslintrc";
import base from "@brainagent/config/eslint";

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

// Next's config first: the shared TS config must win (it sets the TypeScript parser).
const config = [
  ...compat.extends("next/core-web-vitals"),
  ...base,
  { ignores: ["next-env.d.ts", ".next/**", ".next-e2e/**", "playwright-report/**", "test-results/**"] },
];

export default config;

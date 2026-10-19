import { describe, expect, it } from "vitest";
import { slugify } from "./slug";

describe("slugify", () => {
  it("strips accents and symbols", () => {
    expect(slugify("Peluquería Núñez & Hijos, S.L.", "ab12")).toBe(
      "peluqueria-nunez-hijos-s-l-ab12",
    );
  });

  it("falls back when the name has no usable characters", () => {
    expect(slugify("¿¿??", "zz99")).toBe("org-zz99");
  });

  it("adds a random suffix by default", () => {
    expect(slugify("Acme")).toMatch(/^acme-[a-z0-9]{1,4}$/);
  });
});

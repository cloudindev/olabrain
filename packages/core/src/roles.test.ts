import { describe, expect, it } from "vitest";
import { effectiveRole, hasRoleAtLeast } from "./roles";

describe("roles", () => {
  it("picks the most privileged role from a comma-separated list", () => {
    expect(effectiveRole("viewer,admin")).toBe("admin");
    expect(effectiveRole("builder")).toBe("builder");
    expect(effectiveRole("member,unknown")).toBeNull();
    expect(effectiveRole(null)).toBeNull();
  });

  it("compares roles by rank", () => {
    expect(hasRoleAtLeast("owner", "admin")).toBe(true);
    expect(hasRoleAtLeast("builder", "admin")).toBe(false);
    expect(hasRoleAtLeast(null, "viewer")).toBe(false);
  });
});

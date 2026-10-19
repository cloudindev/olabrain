import { createAccessControl } from "better-auth/plugins/access";
import { defaultStatements, adminAc, ownerAc } from "better-auth/plugins/organization/access";

/**
 * Permission statements. Shared by the server (organization plugin) and the client
 * (organizationClient) so both agree on what each role can do.
 */
export const statement = {
  ...defaultStatements,
  agent: ["create", "read", "update", "delete"],
  connector: ["create", "read", "update", "delete"],
  lab: ["use"],
  billing: ["read", "manage"],
} as const;

export const ac = createAccessControl(statement);

export const owner = ac.newRole({
  ...ownerAc.statements,
  agent: ["create", "read", "update", "delete"],
  connector: ["create", "read", "update", "delete"],
  lab: ["use"],
  billing: ["read", "manage"],
});

export const admin = ac.newRole({
  ...adminAc.statements,
  agent: ["create", "read", "update", "delete"],
  connector: ["create", "read", "update", "delete"],
  lab: ["use"],
  billing: ["read"],
});

export const builder = ac.newRole({
  agent: ["create", "read", "update"],
  connector: ["read"],
  lab: ["use"],
});

export const viewer = ac.newRole({
  agent: ["read"],
});

export const roles = { owner, admin, builder, viewer };

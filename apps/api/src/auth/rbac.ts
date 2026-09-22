import { ActorRole } from "@escrow-ecuador/domain";

export interface Permission {
  resource: string;
  action: "create" | "read" | "update" | "delete" | "manage";
}

export const PRIVILEGED_ROLES: ReadonlySet<ActorRole | string> = new Set([
  ActorRole.ADMIN,
  ActorRole.SYSTEM,
  ActorRole.SUPPORT,
  "SUPER_ADMIN",
]);

export const PUBLIC_REGISTRATION_ROLES: ReadonlySet<ActorRole | string> = new Set([
  ActorRole.BUYER,
  ActorRole.SELLER,
]);

export const ALL_ROLES: ReadonlySet<ActorRole | string> = new Set([
  ActorRole.BUYER,
  ActorRole.SELLER,
  ActorRole.SUPPORT,
  ActorRole.ADMIN,
  ActorRole.SYSTEM,
  "SUPER_ADMIN",
]);

export function isPrivilegedRole(role: ActorRole | string): boolean {
  return role === ActorRole.ADMIN || role === ActorRole.SYSTEM || role === "SUPER_ADMIN";
}

export function requiresMfa(role: ActorRole | string): boolean {
  return role === ActorRole.ADMIN || role === "SUPER_ADMIN";
}

export function hasRole(userRole: ActorRole | string, requiredRole: ActorRole | string): boolean {
  if (userRole === "SUPER_ADMIN") return true;
  return userRole === requiredRole;
}

export function hasAnyRole(
  userRole: ActorRole | string,
  allowedRoles: Array<ActorRole | string>
): boolean {
  if (userRole === "SUPER_ADMIN") return true;
  return allowedRoles.includes(userRole);
}

export function validateRole(role: string): ActorRole | "SUPER_ADMIN" {
  if (!role) throw new Error("Role is required");
  const normalized = role.toUpperCase();
  if (normalized === "SUPER_ADMIN") return "SUPER_ADMIN";
  if (Object.values(ActorRole).includes(normalized as ActorRole)) {
    return normalized as ActorRole;
  }
  throw new Error(`Invalid role '${role}'`);
}

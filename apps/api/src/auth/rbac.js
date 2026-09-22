import { ActorRole } from "@escrow-ecuador/domain";
export const PRIVILEGED_ROLES = new Set([
    ActorRole.ADMIN,
    ActorRole.SYSTEM,
    ActorRole.SUPPORT,
    "SUPER_ADMIN",
]);
export const PUBLIC_REGISTRATION_ROLES = new Set([
    ActorRole.BUYER,
    ActorRole.SELLER,
]);
export const ALL_ROLES = new Set([
    ActorRole.BUYER,
    ActorRole.SELLER,
    ActorRole.SUPPORT,
    ActorRole.ADMIN,
    ActorRole.SYSTEM,
    "SUPER_ADMIN",
]);
export function isPrivilegedRole(role) {
    return role === ActorRole.ADMIN || role === ActorRole.SYSTEM || role === "SUPER_ADMIN";
}
export function requiresMfa(role) {
    return role === ActorRole.ADMIN || role === "SUPER_ADMIN";
}
export function hasRole(userRole, requiredRole) {
    if (userRole === "SUPER_ADMIN")
        return true;
    return userRole === requiredRole;
}
export function hasAnyRole(userRole, allowedRoles) {
    if (userRole === "SUPER_ADMIN")
        return true;
    return allowedRoles.includes(userRole);
}
export function validateRole(role) {
    if (!role)
        throw new Error("Role is required");
    const normalized = role.toUpperCase();
    if (normalized === "SUPER_ADMIN")
        return "SUPER_ADMIN";
    if (Object.values(ActorRole).includes(normalized)) {
        return normalized;
    }
    throw new Error(`Invalid role '${role}'`);
}
//# sourceMappingURL=rbac.js.map
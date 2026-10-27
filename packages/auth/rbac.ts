import { ActorRole } from "@escrow-ecuador/domain";

export class AuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthorizationError";
  }
}

export function hasRole(userRole: string, allowedRoles: ActorRole[]): boolean {
  return allowedRoles.includes(userRole as ActorRole);
}

export function assertRole(userRole: string, allowedRoles: ActorRole[]): void {
  if (!hasRole(userRole, allowedRoles)) {
    throw new AuthorizationError(
      `User role '${userRole}' is not authorized. Allowed roles: ${allowedRoles.join(", ")}`,
    );
  }
}

import { ActorRole } from "@escrow-ecuador/domain";
export interface Permission {
    resource: string;
    action: "create" | "read" | "update" | "delete" | "manage";
}
export declare const PRIVILEGED_ROLES: ReadonlySet<ActorRole | string>;
export declare const PUBLIC_REGISTRATION_ROLES: ReadonlySet<ActorRole | string>;
export declare const ALL_ROLES: ReadonlySet<ActorRole | string>;
export declare function isPrivilegedRole(role: ActorRole | string): boolean;
export declare function requiresMfa(role: ActorRole | string): boolean;
export declare function hasRole(userRole: ActorRole | string, requiredRole: ActorRole | string): boolean;
export declare function hasAnyRole(userRole: ActorRole | string, allowedRoles: Array<ActorRole | string>): boolean;
export declare function validateRole(role: string): ActorRole | "SUPER_ADMIN";
//# sourceMappingURL=rbac.d.ts.map
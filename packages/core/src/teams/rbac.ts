import { Role, PermissionRule, ROLE_PERMISSIONS } from '../auth/types.js';

export class RBAC {
  static hasPermission(role: Role, action: string): boolean {
    const permissions = ROLE_PERMISSIONS[role];
    if (!permissions) return false;
    if (permissions.includes('*')) return true;
    return permissions.includes(action);
  }

  static getRoleActions(role: Role): string[] {
    return ROLE_PERMISSIONS[role] || [];
  }

  static getValidRoles(): Role[] {
    return ['owner', 'admin', 'member', 'viewer'];
  }

  static isHigherOrEqual(a: Role, b: Role): boolean {
    const hierarchy: Record<Role, number> = {
      owner: 4,
      admin: 3,
      member: 2,
      viewer: 1,
    };
    return hierarchy[a] >= hierarchy[b];
  }

  static canModifyMember(modifierRole: Role, targetRole: Role): boolean {
    return this.isHigherOrEqual(modifierRole, targetRole) && targetRole !== 'owner';
  }

  static validateAction(role: Role, action: string): { allowed: boolean; reason?: string } {
    if (this.hasPermission(role, action)) {
      return { allowed: true };
    }
    return { allowed: false, reason: `Role '${role}' does not have permission for '${action}'` };
  }

  static addCustomPermission(rule: PermissionRule): void {
    ROLE_PERMISSIONS[rule.role] = rule.actions;
  }
}

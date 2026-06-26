export type ExecutionPolicy = 'safe' | 'workspace' | 'approved' | 'unrestricted';

export function parsePolicy(raw?: string): ExecutionPolicy {
  switch (raw) {
    case 'safe': return 'safe';
    case 'approved': return 'approved';
    case 'unrestricted': return 'unrestricted';
    default: return 'workspace';
  }
}

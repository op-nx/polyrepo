import type { ExternalGraphJson, TransformedNode } from './types';

/**
 * Transform raw graph JSON from an external repo into namespaced nodes
 * and dependencies for the host workspace.
 *
 * Stub -- full implementation in Task 2.
 */
export function transformGraphForRepo(
  _repoAlias: string,
  _rawGraph: ExternalGraphJson,
  _workspaceRoot: string,
): {
  nodes: Record<string, TransformedNode>;
  dependencies: Array<{ source: string; target: string; type: string }>;
} {
  return { nodes: {}, dependencies: [] };
}

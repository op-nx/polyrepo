import type { TargetConfiguration } from '@nx/devkit';

export interface ExternalDependency {
  source: string;
  target: string;
  type: string;
}

export interface ExternalProjectNodeData {
  root: string;
  targets?: Record<string, TargetConfiguration>;
  tags?: string[];
  metadata?: Record<string, unknown>;
  sourceRoot?: string;
  projectType?: string;
}

export interface ExternalProjectNode {
  name: string;
  type: string;
  data: ExternalProjectNodeData;
}

export interface ExternalGraphJson {
  graph: {
    nodes: Record<string, ExternalProjectNode>;
    dependencies: Record<string, ExternalDependency[]>;
  };
}

export interface TransformedNode {
  name: string;
  root: string;
  projectType?: string;
  sourceRoot?: string;
  targets: Record<string, TargetConfiguration>;
  tags: string[];
  metadata?: Record<string, unknown>;
}

export interface PolyrepoGraphReport {
  repos: Record<
    string,
    {
      nodes: Record<string, TransformedNode>;
      dependencies: Array<{ source: string; target: string; type: string }>;
    }
  >;
}

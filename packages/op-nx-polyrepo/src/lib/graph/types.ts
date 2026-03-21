import type { TargetConfiguration } from '@nx/devkit';
import { z } from 'zod';

const externalDependencySchema = z.object({
  source: z.string(),
  target: z.string(),
  type: z.string(),
});

const metadataSchema = z
  .object({
    js: z
      .object({
        packageName: z.string().optional(),
      })
      .loose()
      .optional(),
  })
  .loose()
  .optional();

const externalProjectNodeDataSchema = z.object({
  root: z.string(),
  targets: z.record(z.string(), z.unknown()).optional(),
  tags: z.array(z.string()).optional(),
  metadata: metadataSchema,
  sourceRoot: z.string().optional(),
  projectType: z.string().optional(),
});

const externalProjectNodeSchema = z.object({
  name: z.string(),
  type: z.string(),
  data: externalProjectNodeDataSchema,
});

export const externalGraphJsonSchema = z.object({
  graph: z.object({
    nodes: z.record(z.string(), externalProjectNodeSchema),
    dependencies: z.record(z.string(), z.array(externalDependencySchema)),
  }),
});

export type ExternalGraphJson = z.infer<typeof externalGraphJsonSchema>;

export interface TransformedNode {
  name: string;
  root: string;
  projectType?: string;
  sourceRoot?: string;
  targets: Record<string, TargetConfiguration>;
  tags: string[];
  metadata?: Record<string, unknown>;
  packageName?: string;
  dependencies?: string[];
  devDependencies?: string[];
  peerDependencies?: string[];
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

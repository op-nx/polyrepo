/**
 * Vitest ProvidedContext type augmentation for e2e container testing.
 *
 * Declares the shape of data passed from globalSetup to test files
 * via Vitest's provide()/inject() API.
 *
 * Import this file as a side-effect in global-setup.ts to ensure
 * the type augmentation is active.
 */
// Empty export to make this file a module (required for module augmentation)
export {};

declare module 'vitest' {
  export interface ProvidedContext {
    /** Committed Docker image name for test containers (e.g., 'op-nx-e2e-snapshot:latest') */
    snapshotImage: string;
    /** testcontainers network name for re-attachment if needed */
    networkName: string;
  }
}

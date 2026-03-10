import { execSync } from 'child_process';
import { join, dirname } from 'path';
import { rmSync, readFileSync, writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';

const createNxWorkspacePkgPath = require.resolve(
  'create-nx-workspace/package.json'
);
const createNxWorkspacePkg = JSON.parse(
  readFileSync(createNxWorkspacePkgPath, 'utf-8')
);
const createNxWorkspaceBin = join(
  dirname(createNxWorkspacePkgPath),
  createNxWorkspacePkg.bin['create-nx-workspace']
);

describe('nx-openpolyrepo', () => {
  let projectDirectory: string;

  beforeAll(() => {
    projectDirectory = createTestProject();

    // The plugin has been built and published to a local registry in the jest globalSetup
    // Install the plugin built with the latest source code into the test repo
    execSync(`npm install -D nx-openpolyrepo@e2e`, {
      cwd: projectDirectory,
      stdio: 'inherit',
      env: process.env,
    });
  });

  afterAll(() => {
    if (projectDirectory) {
      // Stop the Nx daemon to release file locks before cleanup
      try {
        execSync('npx nx daemon --stop', {
          cwd: projectDirectory,
          stdio: 'ignore',
        });
      } catch {
        // Ignore errors — daemon may not be running
      }

      rmSync(projectDirectory, {
        recursive: true,
        force: true,
      });
    }
  });

  it('should be installed', () => {
    // npm ls will fail if the package is not installed properly
    execSync('npm ls nx-openpolyrepo', {
      cwd: projectDirectory,
      stdio: 'inherit',
    });
  });

  describe('polyrepo-status', () => {
    beforeAll(() => {
      registerPlugin(projectDirectory, {
        repos: {
          nx: {
            url: 'https://github.com/nrwl/nx.git',
            depth: 1,
            ref: 'master',
          },
        },
      });
    });

    it('should report unsynced repos', () => {
      const output = runNx(projectDirectory, 'polyrepo-status');
      expect(output).toContain('nx: not synced');
      expect(output).toContain('url: https://github.com/nrwl/nx.git');
    });

    it('should register target on root project', () => {
      // create-nx-workspace --preset apps names the root project @org/source
      const output = runNx(
        projectDirectory,
        'show project @org/source --json'
      ).replace(/^[^{]*/, ''); // Strip any Nx warnings before JSON
      const project = JSON.parse(output);
      expect(project.targets['polyrepo-status']).toBeDefined();
      expect(project.targets['polyrepo-status'].executor).toBe(
        'nx-openpolyrepo:status'
      );
    });
  });
});

function runNx(projectDirectory: string, command: string): string {
  try {
    return execSync(`npx nx ${command}`, {
      cwd: projectDirectory,
      env: process.env,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    const details = [e.stdout, e.stderr, e.message].filter(Boolean).join('\n');
    throw new Error(`nx ${command} failed:\n${details}`);
  }
}

function registerPlugin(
  projectDirectory: string,
  options: Record<string, unknown>
): void {
  const nxJsonPath = join(projectDirectory, 'nx.json');
  const nxJson = JSON.parse(readFileSync(nxJsonPath, 'utf-8'));

  nxJson.plugins = nxJson.plugins ?? [];

  // Remove existing registration if present
  nxJson.plugins = nxJson.plugins.filter(
    (p: unknown) =>
      !(typeof p === 'object' && p !== null && 'plugin' in p && (p as { plugin: string }).plugin === 'nx-openpolyrepo')
  );

  nxJson.plugins.push({
    plugin: 'nx-openpolyrepo',
    options,
  });

  writeFileSync(nxJsonPath, JSON.stringify(nxJson, null, 2));
}

/**
 * Creates a test project with create-nx-workspace and installs the plugin
 * @returns The directory where the test project was created
 */
function createTestProject() {
  const projectName = 'test-project';
  // Use OS temp directory to avoid .gitignore conflicts with the host repo
  const tempRoot = mkdtempSync(join(tmpdir(), 'nx-openpolyrepo-e2e-'));
  const projectDirectory = join(tempRoot, projectName);

  execSync(
    `node "${createNxWorkspaceBin}" ${projectName} --preset apps --ci=skip --interactive=false`,
    {
      cwd: tempRoot,
      stdio: 'inherit',
      env: process.env,
    },
  );
  console.log(`Created test project in "${projectDirectory}"`);

  return projectDirectory;
}

/**
 * Typed mock factory for ChildProcess.
 *
 * ChildProcess extends EventEmitter in Node.js. We construct an EventEmitter
 * instance and add all required ChildProcess properties via Object.defineProperties.
 * A single type assertion bridges the structural gap -- encapsulated here so that
 * test files remain assertion-free.
 */
import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { vi } from 'vitest';

export function createMockChildProcess(exitCode = 0): ChildProcess {
  const child = new EventEmitter();
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();

  Object.defineProperties(child, {
    stdin: { value: null, writable: true, configurable: true },
    stdout: { value: stdout, writable: true, configurable: true },
    stderr: { value: stderr, writable: true, configurable: true },
    pid: { value: 1234, writable: true, configurable: true },
    killed: { value: false, writable: true, configurable: true },
    connected: { value: false, writable: true, configurable: true },
    exitCode: { value: null, writable: true, configurable: true },
    signalCode: { value: null, writable: true, configurable: true },
    spawnargs: { value: [], writable: true, configurable: true },
    spawnfile: { value: '', writable: true, configurable: true },
    channel: { value: undefined, writable: true, configurable: true },
  });

  Object.assign(child, {
    kill: vi.fn().mockReturnValue(true),
    send: vi.fn().mockReturnValue(true),
    disconnect: vi.fn(),
    unref: vi.fn().mockReturnThis(),
    ref: vi.fn().mockReturnThis(),
    [Symbol.dispose]: vi.fn(),
  });

  // Emit close on next tick to simulate process exit
  process.nextTick(() => child.emit('close', exitCode));

  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions, @typescript-eslint/no-unsafe-return -- sole bridging assertion: EventEmitter-to-ChildProcess, encapsulated in factory
  return child as unknown as ChildProcess;
}

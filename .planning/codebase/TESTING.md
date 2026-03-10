# Testing Patterns

**Analysis Date:** 2026-03-10

## Test Framework

**Runner:**
- Vitest 4.0.0 (`^4.0.0` in `package.json`)
- Config: No custom `vitest.config.ts` at root (uses Nx plugin defaults)
- Test integration: `@nx/vitest` plugin (^22.5.4) configured in `nx.json`
- Vite 7.0.0 used as underlying build tool

**Assertion Library:**
- Vitest provides built-in assertion methods (compatible with Jest API)
- No additional assertion library (chai, etc.) configured

**Run Commands:**
```bash
npm exec nx run <project>:test              # Run tests for a specific project
npm exec nx run-many --targets=test         # Run tests across all projects
npm exec nx affected --targets=test         # Run tests for affected projects only
npm exec nx test <project> -- --watch       # Watch mode for a specific project
npm exec nx test <project> -- --coverage    # Generate coverage reports
```

## Test File Organization

**Location:**
- Co-located with source files in the same directory
- Test files live next to their implementation files

**Naming:**
- `.test.ts` suffix for test files (e.g., `user-service.test.ts`)
- `.spec.ts` suffix is also acceptable (e.g., `user-service.spec.ts`)
- Follow the implementation file name exactly

**Structure:**
```
src/
  services/
    user-service.ts           # Implementation
    user-service.test.ts      # Tests for the service
  components/
    button.tsx                # Implementation
    button.test.tsx           # Tests for the component
```

## Test Structure

**Suite Organization:**
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('UserService', () => {
  let service: UserService;

  beforeEach(() => {
    service = new UserService();
  });

  afterEach(() => {
    // Cleanup
  });

  describe('getUserById', () => {
    it('should return user when found', () => {
      const result = service.getUserById('123');
      expect(result).toBeDefined();
    });

    it('should throw error when user not found', () => {
      expect(() => service.getUserById('invalid')).toThrow();
    });
  });
});
```

**Patterns:**
- `describe()` blocks organize tests by functionality or method
- `it()` blocks test single behaviors (one assertion focus per test)
- `beforeEach()` runs setup code before each test
- `afterEach()` runs cleanup code after each test
- `beforeAll()` and `afterAll()` for expensive operations that run once per suite

## Mocking

**Framework:** Vitest's built-in `vi` module (compatible with Jest)

**Patterns:**
```typescript
import { vi, describe, it, expect } from 'vitest';

describe('ApiClient', () => {
  it('should call fetch with correct URL', () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    global.fetch = fetchMock;

    // Call function being tested
    await client.getUser('123');

    // Assert mock was called correctly
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/users/123'
    );
  });

  it('should retry on failure', () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce({ ok: true });

    // Test retry logic
  });
});
```

**What to Mock:**
- External API calls (HTTP requests via fetch or axios)
- Database connections
- File system operations
- Third-party services
- System time (using `vi.useFakeTimers()`)
- Environment variables (via vi.stubEnv())

**What NOT to Mock:**
- Pure utility functions (math, string formatting, etc.)
- Business logic that you're testing
- Internal methods of the class under test (unless specifically testing interaction)
- The code being tested — always test real implementations

## Fixtures and Factories

**Test Data:**
```typescript
// user-service.test.ts
const mockUser = {
  id: '123',
  name: 'John Doe',
  email: 'john@example.com',
  role: 'admin'
};

const mockUsers = [mockUser, { ...mockUser, id: '456', name: 'Jane' }];

describe('UserService', () => {
  it('should return all users', () => {
    const users = service.getAllUsers();
    expect(users).toEqual(mockUsers);
  });
});
```

**Factory Pattern (optional, for complex data):**
```typescript
// Create factory functions for test data
function createMockUser(overrides = {}) {
  return {
    id: '123',
    name: 'John Doe',
    email: 'john@example.com',
    ...overrides
  };
}

// Usage in tests
const adminUser = createMockUser({ role: 'admin' });
const guestUser = createMockUser({ role: 'guest' });
```

**Location:**
- Simple fixtures: inline in the test file above the test suite
- Shared fixtures: in a `test-utils.ts` or `fixtures.ts` file in the same directory
- Complex factories: may be extracted to a `__tests__` folder or dedicated utils module

## Coverage

**Requirements:** Not enforced (no coverage threshold configured)

**View Coverage:**
```bash
npm exec nx test <project> -- --coverage
# Output: coverage/ directory with HTML report
open coverage/index.html
```

**Coverage Tool:** Vitest's built-in coverage (uses `c8` or `v8` by default)

**Best Practice:**
- Aim for 70-80% coverage on critical paths
- Don't chase 100% — untestable code (getters/setters) can be ignored
- Focus on testing edge cases and error paths, not line coverage percentages

## Test Types

**Unit Tests:**
- Scope: Single function, method, or small module
- Approach: Test one behavior at a time, use mocks for dependencies
- Execution: Fast (milliseconds), run frequently
- Location: co-located `.test.ts` files

**Integration Tests:**
- Scope: Multiple modules working together
- Approach: Use real implementations where possible, mock external services only
- Execution: Slower (seconds), run before deployment
- Location: Same `.test.ts` files with integration-specific `describe()` blocks
- Example: Testing a service that uses a data mapper and repository together

**E2E Tests:**
- Framework: Not currently configured
- Can be added via `@nx/cypress` or `@nx/playwright` if needed
- Scope: Full user workflows from UI to database
- Approach: Full system testing in a controlled environment

## Common Patterns

**Async Testing:**
```typescript
it('should fetch user data', async () => {
  const result = await service.getUser('123');
  expect(result).toBeDefined();
});

it('should handle fetch error', async () => {
  await expect(service.getUser('invalid')).rejects.toThrow();
});
```

**Error Testing:**
```typescript
it('should throw ValidationError for invalid input', () => {
  expect(() => service.validate('')).toThrow(ValidationError);
});

it('should throw with specific message', () => {
  expect(() => service.validate(''))
    .toThrow('Email is required');
});
```

**Snapshot Testing:**
```typescript
it('should render button correctly', () => {
  const button = render(<Button label="Click me" />);
  expect(button).toMatchSnapshot();
});

// Update snapshots with: npm exec nx test -- -u
```

## Nx Integration

**Test Cache:**
- Enabled in `nx.json` under `targetDefaults["@nx/vitest:test"]`
- Cache invalidation: inputs defined as `["default", "^production"]`
- Inputs include all project files except test files (see `namedInputs` in `nx.json`)

**Run Tests via Nx:**
- Nx automatically detects `.test.ts` and `.spec.ts` files
- Each project gets a `test` target that runs Vitest
- Supports parallel execution across projects with `nx run-many`
- Supports watch mode: `npm exec nx test -- --watch`

---

*Testing analysis: 2026-03-10*

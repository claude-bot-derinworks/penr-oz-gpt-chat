import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['server/**/*.test.ts', 'src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['server/index.ts', 'src/api.ts'],
      thresholds: {
        lines: 80,
        functions: 75,
      },
    },
  },
})

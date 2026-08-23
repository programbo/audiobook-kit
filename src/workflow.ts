import { createMachine } from 'xstate';

/**
 * Lifecycle model for a build. Media work remains in injected services; the
 * machine is the source of truth for orchestration, cancellation, and UI/log
 * observation.
 */
export const buildMachine = createMachine({
  id: 'build',
  initial: 'ready',
  states: {
    ready: { on: { START: 'assembling', CANCEL: 'cancelled' } },
    assembling: { on: { ASSEMBLED: 'verifying', FAIL: 'failed', CANCEL: 'cancelled' } },
    verifying: { on: { VERIFIED: 'succeeded', FAIL: 'failed', CANCEL: 'cancelled' } },
    succeeded: { type: 'final' },
    failed: { type: 'final' },
    cancelled: { type: 'final' },
  },
});

export type BuildWorkflowState = typeof buildMachine;

import { createMachine } from 'xstate';

/**
 * Lifecycle model for a build. Media work remains in injected services; the
 * machine is the source of truth for orchestration, cancellation, and UI/log
 * observation.
 */
export const buildMachine = createMachine({
  id: 'build',
  initial: 'preflight',
  states: {
    preflight: { on: { READY: 'discovering', FAIL: 'failed', CANCEL: 'cancelled' } },
    discovering: { on: { DISCOVERED: 'probing', FAIL: 'failed', CANCEL: 'cancelled' } },
    probing: { on: { PROBED: 'planning', FAIL: 'failed', CANCEL: 'cancelled' } },
    planning: {
      on: {
        PLANNED: 'creatingRun',
        DRY_RUN_COMPLETE: 'succeeded',
        FAIL: 'failed',
        CANCEL: 'cancelled',
      },
    },
    creatingRun: { on: { RUN_READY: 'processing', FAIL: 'failed', CANCEL: 'cancelled' } },
    processing: { on: { PROCESSED: 'assembling', FAIL: 'failed', CANCEL: 'cancelled' } },
    assembling: { on: { ASSEMBLED: 'verifying', FAIL: 'failed', CANCEL: 'cancelled' } },
    verifying: { on: { VERIFIED: 'succeeded', FAIL: 'failed', CANCEL: 'cancelled' } },
    succeeded: { type: 'final' },
    failed: { type: 'final' },
    cancelled: { type: 'final' },
  },
});

export type BuildWorkflowState = typeof buildMachine;

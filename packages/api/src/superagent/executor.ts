import type {
  SuperAgentAgentExecutor,
  SuperAgentExecutionInput,
  SuperAgentExecutionResult,
} from './types';

export type SuperAgentInvoke = (
  input: SuperAgentExecutionInput,
) => Promise<SuperAgentExecutionResult>;

/**
 * Adapts a host-owned agent invocation into the scheduler's executor contract.
 * The host owns model selection, tools, approvals, and persistence; this layer
 * only forwards the bounded node input and cancellation signal.
 */
export function createSuperAgentExecutor(invoke: SuperAgentInvoke): SuperAgentAgentExecutor {
  return {
    async execute(input) {
      if (input.signal.aborted) {
        throw input.signal.reason ?? new Error('Agent execution aborted');
      }
      return await invoke(input);
    },
  };
}

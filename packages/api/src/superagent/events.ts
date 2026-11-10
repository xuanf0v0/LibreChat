import type { SuperAgentTask } from 'librechat-data-provider';

export type SuperAgentTaskListener = (task: SuperAgentTask) => void;

export interface SuperAgentTaskEvents {
  publish(task: SuperAgentTask): void;
  subscribe(taskId: string, listener: SuperAgentTaskListener): () => void;
}

export function createSuperAgentTaskEvents(): SuperAgentTaskEvents {
  const listeners = new Map<string, Set<SuperAgentTaskListener>>();

  return {
    publish(task) {
      const subscribers = listeners.get(task.id);
      if (subscribers == null) {
        return;
      }
      for (const listener of subscribers) {
        try {
          listener(task);
        } catch {
          // A broken SSE client must not stop scheduler persistence.
        }
      }
    },
    subscribe(taskId, listener) {
      const subscribers = listeners.get(taskId) ?? new Set<SuperAgentTaskListener>();
      subscribers.add(listener);
      listeners.set(taskId, subscribers);
      return () => {
        const current = listeners.get(taskId);
        if (current == null) {
          return;
        }
        current.delete(listener);
        if (current.size === 0) {
          listeners.delete(taskId);
        }
      };
    },
  };
}

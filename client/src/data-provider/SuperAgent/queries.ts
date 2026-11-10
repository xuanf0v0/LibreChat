import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { dataService, QueryKeys, superAgentTaskEvents } from 'librechat-data-provider';
import type { SuperAgentTask, SuperAgentTaskListResponse } from 'librechat-data-provider';
import type { UseQueryOptions, QueryObserverResult } from '@tanstack/react-query';
import { useAuthContext } from '~/hooks/AuthContext';

const ACTIVE_STATUSES: Partial<Record<SuperAgentTask['status'], true>> = {
  planning: true,
  pending: true,
  running: true,
  waiting: true,
};

export const isSuperAgentTaskActive = (status: SuperAgentTask['status']): boolean =>
  ACTIVE_STATUSES[status] === true;

export const useSuperAgentTasksQuery = (
  config?: UseQueryOptions<SuperAgentTaskListResponse>,
): QueryObserverResult<SuperAgentTaskListResponse, unknown> => {
  return useQuery<SuperAgentTaskListResponse>(
    [QueryKeys.superAgentTasks],
    () => dataService.listSuperAgentTasks(),
    {
      staleTime: 1_000,
      refetchOnWindowFocus: true,
      refetchInterval: (data) =>
        data?.tasks.some((task) => isSuperAgentTaskActive(task.status)) ? 2_000 : false,
      ...config,
    },
  );
};

export const useSuperAgentTaskEvents = (taskId: string | null): { connected: boolean } => {
  const { token, isAuthenticated } = useAuthContext();
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (taskId == null || !isAuthenticated || token == null) {
      setConnected(false);
      return;
    }
    const controller = new AbortController();
    let cancelled = false;

    const handleFrame = (frame: string): void => {
      const data = frame
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n');
      if (data === '') {
        return;
      }
      try {
        const payload = JSON.parse(data) as { task?: SuperAgentTask };
        if (payload.task != null) {
          queryClient.setQueryData([QueryKeys.superAgentTask, payload.task.id], {
            task: payload.task,
          });
          queryClient.invalidateQueries([QueryKeys.superAgentTasks]);
        }
      } catch {
        // Ignore keep-alive comments and future frame types.
      }
    };

    const connect = async (): Promise<void> => {
      try {
        const response = await fetch(superAgentTaskEvents(taskId), {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
        if (!response.ok || response.body == null) {
          if (!cancelled) {
            setConnected(false);
          }
          return;
        }
        if (!cancelled) {
          setConnected(true);
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (!cancelled) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          buffer += decoder.decode(value, { stream: true });
          let boundary = buffer.indexOf('\n\n');
          while (boundary >= 0) {
            handleFrame(buffer.slice(0, boundary));
            buffer = buffer.slice(boundary + 2);
            boundary = buffer.indexOf('\n\n');
          }
        }
      } catch {
        // Abort and network failures fall back to the task query's polling.
      } finally {
        if (!cancelled) {
          setConnected(false);
        }
      }
    };

    void connect();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [taskId, isAuthenticated, token, queryClient]);

  return { connected };
};

export const useSuperAgentTaskQuery = (
  taskId?: string | null,
  config?: UseQueryOptions<{ task: SuperAgentTask }>,
): QueryObserverResult<{ task: SuperAgentTask }, unknown> => {
  return useQuery<{ task: SuperAgentTask }>(
    [QueryKeys.superAgentTask, taskId],
    () => dataService.getSuperAgentTask(taskId ?? ''),
    {
      enabled: Boolean(taskId),
      staleTime: 1_000,
      refetchOnWindowFocus: true,
      refetchInterval: (data) =>
        data?.task != null && isSuperAgentTaskActive(data.task.status) ? 2_000 : false,
      ...config,
    },
  );
};

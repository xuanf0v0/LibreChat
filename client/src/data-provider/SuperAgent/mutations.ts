import { dataService, QueryKeys } from 'librechat-data-provider';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { CreateSuperAgentTaskParams, SuperAgentTaskResponse } from 'librechat-data-provider';
import type { UseMutationResult } from '@tanstack/react-query';

export const useCreateSuperAgentTaskMutation = (): UseMutationResult<
  SuperAgentTaskResponse,
  unknown,
  CreateSuperAgentTaskParams
> => {
  const queryClient = useQueryClient();
  return useMutation(
    (payload: CreateSuperAgentTaskParams) => dataService.createSuperAgentTask(payload),
    {
      onSuccess: ({ task }) => {
        queryClient.setQueryData([QueryKeys.superAgentTask, task.id], { task });
        queryClient.invalidateQueries([QueryKeys.superAgentTasks]);
      },
    },
  );
};

export const useCancelSuperAgentTaskMutation = (): UseMutationResult<
  SuperAgentTaskResponse,
  unknown,
  string
> => {
  const queryClient = useQueryClient();
  return useMutation((taskId: string) => dataService.cancelSuperAgentTask(taskId), {
    onSuccess: ({ task }) => {
      queryClient.setQueryData([QueryKeys.superAgentTask, task.id], { task });
      queryClient.invalidateQueries([QueryKeys.superAgentTasks]);
    },
  });
};

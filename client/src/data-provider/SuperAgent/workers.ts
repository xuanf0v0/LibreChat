import { dataService, QueryKeys } from 'librechat-data-provider';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  SuperAgentWorkerListResponse,
  SuperAgentWorkerResponse,
  UpdateSuperAgentWorkerParams,
} from 'librechat-data-provider';
import type {
  UseMutationResult,
  UseQueryOptions,
  QueryObserverResult,
} from '@tanstack/react-query';

export const useSuperAgentWorkersQuery = (
  config?: UseQueryOptions<SuperAgentWorkerListResponse>,
): QueryObserverResult<SuperAgentWorkerListResponse, unknown> => {
  return useQuery<SuperAgentWorkerListResponse>(
    [QueryKeys.superAgentWorkers],
    () => dataService.listSuperAgentWorkers(),
    { staleTime: 5_000, ...config },
  );
};

export const useUpdateSuperAgentWorkerMutation = (): UseMutationResult<
  SuperAgentWorkerResponse,
  unknown,
  { agentId: string; input: UpdateSuperAgentWorkerParams }
> => {
  const queryClient = useQueryClient();
  return useMutation(
    ({ agentId, input }: { agentId: string; input: UpdateSuperAgentWorkerParams }) =>
      dataService.updateSuperAgentWorker(agentId, input),
    {
      onSuccess: () => {
        queryClient.invalidateQueries([QueryKeys.superAgentWorkers]);
      },
    },
  );
};

export const useDeleteSuperAgentWorkerMutation = (): UseMutationResult<
  SuperAgentWorkerResponse,
  unknown,
  string
> => {
  const queryClient = useQueryClient();
  return useMutation((agentId: string) => dataService.deleteSuperAgentWorker(agentId), {
    onSuccess: () => {
      queryClient.invalidateQueries([QueryKeys.superAgentWorkers]);
    },
  });
};

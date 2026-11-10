import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MutationKeys, QueryKeys, dataService } from 'librechat-data-provider';
import type {
  TModelProviderModelsInput,
  TModelProviderModelsResponse,
  TModelProvidersInput,
  TModelProvidersResponse,
} from 'librechat-data-provider';

export function useGetModelProvidersQuery(enabled = true) {
  return useQuery<TModelProvidersResponse>(
    [QueryKeys.modelProviders],
    () => dataService.getModelProviders(),
    { enabled },
  );
}

export function useUpdateModelProvidersMutation() {
  const queryClient = useQueryClient();
  return useMutation<TModelProvidersResponse, Error, TModelProvidersInput>(
    [MutationKeys.updateModelProviders],
    (payload) => dataService.updateModelProviders(payload),
    {
      onSuccess: (data) => {
        queryClient.setQueryData([QueryKeys.modelProviders], data);
        /** These two feed the chat model picker and the Agent Builder. */
        queryClient.invalidateQueries([QueryKeys.endpoints]);
        queryClient.invalidateQueries([QueryKeys.models]);
      },
    },
  );
}

export function useFetchModelProviderModelsMutation() {
  return useMutation<TModelProviderModelsResponse, Error, TModelProviderModelsInput>(
    [MutationKeys.fetchModelProviderModels],
    (payload) => dataService.getModelProviderModels(payload),
  );
}

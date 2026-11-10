import { useMutation, useQueryClient } from '@tanstack/react-query';
import { QueryKeys, dataService } from 'librechat-data-provider';
import type { WorkspaceListing } from 'librechat-data-provider';

/** Creates a folder inside the browsable roots and refreshes the listing. */
export const useCreateWorkspaceFolderMutation = () => {
  const queryClient = useQueryClient();
  return useMutation<WorkspaceListing, unknown, { path?: string | null; name: string }>(
    (payload) => dataService.createWorkspaceFolder(payload),
    {
      onSuccess: () => {
        queryClient.invalidateQueries([QueryKeys.workspace, 'entries']);
      },
    },
  );
};

import { useQuery } from '@tanstack/react-query';
import { QueryKeys, dataService } from 'librechat-data-provider';
import type { WorkspaceListing } from 'librechat-data-provider';
import type { UseQueryOptions } from '@tanstack/react-query';

/** The roots the picker may browse. A deployment with no filesystem MCP server
 *  answers with an empty list rather than an error, so the picker can say so. */
export const useWorkspaceRootsQuery = (
  config?: UseQueryOptions<{ roots: string[] }, unknown>,
) => {
  return useQuery<{ roots: string[] }, unknown>(
    [QueryKeys.workspace, 'roots'],
    () => dataService.getWorkspaceRoots(),
    {
      refetchOnWindowFocus: false,
      refetchOnMount: false,
      staleTime: 5 * 60 * 1000,
      ...config,
    },
  );
};

/** One directory listing. `path` null opens the first root. */
export const useWorkspaceEntriesQuery = (
  path: string | null,
  config?: UseQueryOptions<WorkspaceListing, unknown>,
) => {
  return useQuery<WorkspaceListing, unknown>(
    [QueryKeys.workspace, 'entries', path ?? ''],
    () => dataService.getWorkspaceEntries(path),
    {
      refetchOnWindowFocus: false,
      staleTime: 30 * 1000,
      ...config,
    },
  );
};

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSetAtom } from 'jotai';
import { Folder, FolderPlus, FileText, CornerLeftUp, Loader } from 'lucide-react';
import { OGDialog, OGDialogContent, OGDialogHeader, OGDialogTitle, Button } from '@librechat/client';
import {
  useCreateWorkspaceFolderMutation,
  useWorkspaceEntriesQuery,
  useWorkspaceRootsQuery,
} from '~/data-provider';
import { workspaceFileAtom, workspacePathAtom } from '~/store/workspace';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

/**
 * Browses the deployment's configured workspace roots and stores the chosen
 * path.
 *
 * The browser cannot read a path itself — a `FileSystemDirectoryHandle` exposes
 * only its leaf name — so the listing comes from `/api/workspace`, which is
 * scoped to the filesystem MCP server's allowed directories. What the picker
 * returns is therefore a real path the agent's tools can use.
 */
export default function WorkspacePickerDialog({
  open,
  onOpenChange,
  triggerRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  triggerRef?: React.RefObject<HTMLElement | null>;
}) {
  const localize = useLocalize();
  const setWorkspacePath = useSetAtom(workspacePathAtom);
  const setWorkspaceFile = useSetAtom(workspaceFileAtom);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const createFolder = useCreateWorkspaceFolderMutation();

  const { data: rootsData, isLoading: rootsLoading } = useWorkspaceRootsQuery({ enabled: open });
  const roots = rootsData?.roots ?? [];
  const { data: listing, isLoading: entriesLoading, error } = useWorkspaceEntriesQuery(
    currentPath,
    { enabled: open && roots.length > 0 },
  );

  /** Open on the first root rather than an empty view; a root list that arrives
   *  later still seeds it because the effect watches the resolved path. */
  useEffect(() => {
    if (open && currentPath == null && listing?.path != null) {
      setCurrentPath(listing.path);
    }
  }, [open, currentPath, listing?.path]);

  const captureReturnFocus = useCallback(() => {
    const activeElement = document.activeElement;
    const canRestore =
      activeElement instanceof HTMLElement &&
      activeElement !== document.body &&
      activeElement.isConnected &&
      activeElement.closest('[role="menu"]') == null;
    returnFocusRef.current = canRestore ? activeElement : (triggerRef?.current ?? null);
  }, [triggerRef]);

  const choose = useCallback(
    (path: string) => {
      setWorkspacePath(path);
      setWorkspaceFile(null);
      onOpenChange(false);
    },
    [onOpenChange, setWorkspaceFile, setWorkspacePath],
  );

  /** Creates the folder at the browsed level, then descends into it: the reader
   *  asked for somewhere to work, not merely for a new directory entry. */
  const submitNewFolder = useCallback(async () => {
    const name = newFolderName.trim();
    if (name === '' || createFolder.isLoading) {
      return;
    }
    try {
      const created = await createFolder.mutateAsync({
        path: listing?.path ?? currentPath,
        name,
      });
      setNewFolderName('');
      setCreating(false);
      setCurrentPath(created.path);
    } catch {
      /* The listing stays put; the error code already reached the mutation. */
    }
  }, [createFolder, currentPath, listing?.path, newFolderName]);

  const chooseFile = useCallback(
    (path: string) => {
      setWorkspaceFile(path);
      onOpenChange(false);
    },
    [onOpenChange, setWorkspaceFile],
  );

  const entries = listing?.entries ?? [];
  const notConfigured = !rootsLoading && roots.length === 0;

  const body = useMemo(() => {
    if (rootsLoading) {
      return (
        <div className="text-text-secondary flex items-center justify-center gap-2 py-10 text-sm">
          <Loader className="h-4 w-4 animate-spin" aria-hidden="true" />
          {localize('com_ui_workspace_loading')}
        </div>
      );
    }
    if (notConfigured) {
      return (
        <p className="text-text-secondary py-10 text-center text-sm">
          {localize('com_ui_workspace_not_configured')}
        </p>
      );
    }
    if (error != null) {
      return (
        <p className="text-text-secondary py-10 text-center text-sm">
          {localize('com_ui_workspace_not_configured')}
        </p>
      );
    }

    return (
      <>
        <div className="border-border-light mb-2 flex items-center gap-1 border-b pb-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 shrink-0 px-2"
            disabled={listing?.parent == null}
            aria-label={localize('com_ui_workspace_up')}
            onClick={() => listing?.parent != null && setCurrentPath(listing.parent)}
          >
            <CornerLeftUp className="h-4 w-4" aria-hidden="true" />
          </Button>
          <span className="text-text-secondary min-w-0 truncate font-mono text-xs">
            {listing?.path ?? ''}
          </span>
        </div>

        <div className="max-h-[45vh] min-h-[180px] overflow-y-auto">
          {entriesLoading ? (
            <div className="text-text-secondary flex items-center justify-center gap-2 py-8 text-sm">
              <Loader className="h-4 w-4 animate-spin" aria-hidden="true" />
              {localize('com_ui_workspace_loading')}
            </div>
          ) : entries.length === 0 ? (
            <p className="text-text-secondary py-8 text-center text-sm">
              {localize('com_ui_workspace_empty')}
            </p>
          ) : (
            <ul className="flex flex-col">
              {entries.map((entry) => (
                <li key={entry.path}>
                  <button
                    type="button"
                    className={cn(
                      'hover:bg-surface-hover flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm',
                    )}
                    onDoubleClick={() =>
                      entry.type === 'directory'
                        ? setCurrentPath(entry.path)
                        : chooseFile(entry.path)
                    }
                    onClick={() =>
                      entry.type === 'directory' ? setCurrentPath(entry.path) : undefined
                    }
                  >
                    {entry.type === 'directory' ? (
                      <Folder className="text-text-secondary h-4 w-4 shrink-0" aria-hidden="true" />
                    ) : (
                      <FileText
                        className="text-text-secondary h-4 w-4 shrink-0"
                        aria-hidden="true"
                      />
                    )}
                    <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                    {entry.type === 'directory' ? (
                      <span
                        role="button"
                        tabIndex={0}
                        className="text-text-secondary hover:text-text-primary shrink-0 text-xs"
                        onClick={(event) => {
                          event.stopPropagation();
                          choose(entry.path);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            event.stopPropagation();
                            choose(entry.path);
                          }
                        }}
                      >
                        {localize('com_ui_workspace_choose_folder')}
                      </span>
                    ) : (
                      <span
                        role="button"
                        tabIndex={0}
                        className="text-text-secondary hover:text-text-primary shrink-0 text-xs"
                        onClick={(event) => {
                          event.stopPropagation();
                          chooseFile(entry.path);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            event.stopPropagation();
                            chooseFile(entry.path);
                          }
                        }}
                      >
                        {localize('com_ui_workspace_choose_file')}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-border-light mt-2 flex items-center gap-2 border-t pt-2">
          {creating ? (
            <>
              <input
                autoFocus
                aria-label={localize('com_ui_workspace_new_folder')}
                placeholder={localize('com_ui_workspace_new_folder')}
                value={newFolderName}
                onChange={(event) => setNewFolderName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void submitNewFolder();
                  }
                  if (event.key === 'Escape') {
                    setCreating(false);
                    setNewFolderName('');
                  }
                }}
                className="border-border-light text-text-primary focus-visible:ring-focus-control min-w-0 flex-1 rounded-md border bg-transparent px-2 py-1 text-sm outline-hidden focus-visible:ring-2"
              />
              <Button
                variant="outline"
                size="sm"
                disabled={createFolder.isLoading || newFolderName.trim() === ''}
                onClick={() => void submitNewFolder()}
              >
                {localize('com_ui_create')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setCreating(false);
                  setNewFolderName('');
                }}
              >
                {localize('com_ui_cancel')}
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                size="sm"
                disabled={listing?.path == null}
                onClick={() => setCreating(true)}
              >
                <FolderPlus className="me-1 h-4 w-4" aria-hidden="true" />
                {localize('com_ui_workspace_new_folder')}
              </Button>
              <div className="flex-1" />
              <Button
                variant="outline"
                size="sm"
                disabled={listing?.path == null}
                onClick={() => listing?.path != null && choose(listing.path)}
              >
                {localize('com_ui_workspace_choose_folder')}
              </Button>
            </>
          )}
        </div>
      </>
    );
  }, [
    choose,
    chooseFile,
    createFolder.isLoading,
    creating,
    entries,
    entriesLoading,
    error,
    listing?.parent,
    listing?.path,
    localize,
    newFolderName,
    notConfigured,
    rootsLoading,
    submitNewFolder,
  ]);

  return (
    <OGDialog open={open} onOpenChange={onOpenChange} triggerRef={returnFocusRef}>
      <OGDialogContent
        title={localize('com_ui_workspace_select')}
        onOpenAutoFocus={captureReturnFocus}
        className="text-text-primary w-11/12 max-w-lg shadow-2xl"
      >
        <OGDialogHeader>
          <OGDialogTitle>{localize('com_ui_workspace_select')}</OGDialogTitle>
        </OGDialogHeader>
        {body}
      </OGDialogContent>
    </OGDialog>
  );
}

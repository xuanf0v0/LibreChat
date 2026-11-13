import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSetAtom } from 'jotai';
import { Folder, FolderPlus, FileText, CornerLeftUp, HardDrive, Loader } from 'lucide-react';
import { OGDialog, OGDialogContent, OGDialogHeader, OGDialogTitle, Button } from '@librechat/client';
import {
  useCreateWorkspaceFolderMutation,
  useWorkspaceEntriesQuery,
  useWorkspaceRootsQuery,
} from '~/data-provider';
import { workspaceFileAtom, workspacePathAtom } from '~/store/workspace';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

/** Trailing separators dropped so a drive root compares as `C:` in both places. */
function trimSeparators(value: string): string {
  return value.replace(/[\\/]+$/, '');
}

/** Whether `target` sits on `root`; both sides are trimmed for the comparison. */
function isOnRoot(target: string, root: string): boolean {
  const normalizedTarget = trimSeparators(target).toLowerCase();
  const normalizedRoot = trimSeparators(root).toLowerCase();
  if (normalizedRoot === '') {
    return true;
  }
  return (
    normalizedTarget === normalizedRoot ||
    normalizedTarget.startsWith(`${normalizedRoot}\\`) ||
    normalizedTarget.startsWith(`${normalizedRoot}/`)
  );
}

/** The drive's own name, which is the whole root minus its separator. */
function rootLabel(root: string): string {
  return trimSeparators(root) || root;
}

/**
 * Browses the deployment's configured project roots and stores the chosen
 * path.
 *
 * The browser cannot read a path itself — a `FileSystemDirectoryHandle` exposes
 * only its leaf name — so the listing comes from `/api/workspace`, which is
 * scoped to the filesystem MCP server's allowed directories. What the picker
 * returns is therefore a real path the agent's tools can use.
 *
 * The roots are whole drives, so they get the sidebar and the directory gets
 * the body: descending from a root by hand would take a click per level.
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
  const [pathInput, setPathInput] = useState('');
  const createFolder = useCreateWorkspaceFolderMutation();

  const { data: rootsData, isLoading: rootsLoading } = useWorkspaceRootsQuery({ enabled: open });
  const roots = rootsData?.roots ?? [];
  /* An empty root list is a policy ("the account's permissions are the
   *  boundary"), not a missing configuration: the endpoint then answers with the
   *  server's own directory, so the listing must still run. */
  const { data: listing, isLoading: entriesLoading, error } = useWorkspaceEntriesQuery(
    currentPath,
    { enabled: open },
  );

  /** Open on the first root rather than an empty view; a root list that arrives
   *  later still seeds it because the effect watches the resolved path. */
  useEffect(() => {
    if (open && currentPath == null && listing?.path != null) {
      setCurrentPath(listing.path);
    }
  }, [open, currentPath, listing?.path]);

  /** The path box tracks wherever the listing settled, including a failed
   *  navigation falling back to the directory that was already open. */
  useEffect(() => {
    if (listing?.path != null) {
      setPathInput(listing.path);
    }
  }, [listing?.path]);

  useEffect(() => {
    if (!open) {
      setPathInput('');
      setCreating(false);
      setNewFolderName('');
    }
  }, [open]);

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
  const notConfigured = false;
  const activeRoot =
    currentPath == null ? null : (roots.find((root) => isOnRoot(currentPath, root)) ?? null);

  const body = useMemo(() => {
    if (rootsLoading) {
      return (
        <div className="text-text-secondary flex h-full items-center justify-center gap-2 text-sm">
          <Loader className="h-4 w-4 animate-spin" aria-hidden="true" />
          {localize('com_ui_workspace_loading')}
        </div>
      );
    }
    if (notConfigured || error != null) {
      return (
        <p className="text-text-secondary flex h-full items-center justify-center text-sm">
          {localize('com_ui_workspace_not_configured')}
        </p>
      );
    }

    return (
      <div className="flex h-full min-h-0">
        <nav
          aria-label={localize('com_ui_workspace_root')}
          className="border-border-light flex w-44 shrink-0 flex-col gap-0.5 overflow-y-auto border-e p-2"
        >
          {roots.map((root) => (
            <button
              key={root}
              type="button"
              title={root}
              aria-current={root === activeRoot ? 'true' : undefined}
              onClick={() => setCurrentPath(root)}
              className={cn(
                'hover:bg-surface-hover flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm',
                root === activeRoot && 'bg-surface-hover text-text-primary',
              )}
            >
              <HardDrive className="text-text-secondary h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{rootLabel(root)}</span>
            </button>
          ))}
        </nav>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="border-border-light flex items-center gap-1 border-b px-2 py-2">
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
            <form
              className="min-w-0 flex-1"
              onSubmit={(event) => {
                event.preventDefault();
                const typed = pathInput.trim();
                if (typed !== '') {
                  setCurrentPath(typed);
                }
              }}
            >
              <input
                aria-label={localize('com_ui_workspace_path')}
                value={pathInput}
                onChange={(event) => setPathInput(event.target.value)}
                spellCheck={false}
                className="focus-visible:ring-focus-control text-text-secondary w-full min-w-0 rounded-md bg-transparent px-1 py-0.5 font-mono text-xs outline-hidden focus-visible:ring-2"
              />
            </form>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-1">
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
                    <div
                      role="button"
                      tabIndex={0}
                      className="hover:bg-surface-hover flex w-full cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm"
                      onDoubleClick={() =>
                        entry.type === 'directory' ? setCurrentPath(entry.path) : chooseFile(entry.path)
                      }
                      onClick={() =>
                        entry.type === 'directory' ? setCurrentPath(entry.path) : undefined
                      }
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          if (entry.type === 'directory') {
                            setCurrentPath(entry.path);
                          } else {
                            chooseFile(entry.path);
                          }
                        }
                      }}
                    >
                      {entry.type === 'directory' ? (
                        <Folder
                          className="text-text-secondary h-4 w-4 shrink-0"
                          aria-hidden="true"
                        />
                      ) : (
                        <FileText
                          className="text-text-secondary h-4 w-4 shrink-0"
                          aria-hidden="true"
                        />
                      )}
                      <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                      <button
                        type="button"
                        className="text-text-secondary hover:text-text-primary shrink-0 px-1 text-xs"
                        onClick={(event) => {
                          event.stopPropagation();
                          if (entry.type === 'directory') {
                            choose(entry.path);
                          } else {
                            chooseFile(entry.path);
                          }
                        }}
                      >
                        {entry.type === 'directory'
                          ? localize('com_ui_workspace_choose_folder')
                          : localize('com_ui_workspace_choose_file')}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="border-border-light flex items-center gap-2 border-t px-2 py-2">
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
        </div>
      </div>
    );
  }, [
    activeRoot,
    choose,
    chooseFile,
    createFolder.isLoading,
    creating,
    currentPath,
    entries,
    entriesLoading,
    error,
    listing?.parent,
    listing?.path,
    localize,
    newFolderName,
    notConfigured,
    pathInput,
    roots,
    rootsLoading,
    submitNewFolder,
  ]);

  return (
    <OGDialog open={open} onOpenChange={onOpenChange} triggerRef={returnFocusRef}>
      <OGDialogContent
        title={localize('com_ui_workspace_select')}
        onOpenAutoFocus={captureReturnFocus}
        className="text-text-primary w-11/12 max-w-3xl gap-3 shadow-2xl"
      >
        <OGDialogHeader>
          <OGDialogTitle>{localize('com_ui_workspace_select')}</OGDialogTitle>
        </OGDialogHeader>
        <div className="flex h-[60vh] max-h-[520px] min-h-[340px] flex-col">{body}</div>
      </OGDialogContent>
    </OGDialog>
  );
}

import { useCallback, useRef, useState } from 'react';
import { useAtom } from 'jotai';
import { FolderOpen, FileText, X } from 'lucide-react';
import { Button } from '@librechat/client';
import { workspaceFileAtom, workspacePathAtom, workspacePickerOpenAtom } from '~/store/workspace';
import { dataService } from 'librechat-data-provider';
import { pickWorkspaceDirectory } from '~/utils/workspace';
import WorkspacePickerDialog from './WorkspacePickerDialog';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

/** Last path segment, so the chip names the folder rather than the whole tree. */
function baseName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '');
  const index = Math.max(trimmed.lastIndexOf('\\'), trimmed.lastIndexOf('/'));
  return index === -1 ? trimmed : trimmed.slice(index + 1) || trimmed;
}

/**
 * The workspace the agent will act in, shown as a narrow band above the
 * composer.
 *
 * The path itself comes from the picker, which asks the server; a drop can only
 * supply a name (browsers do not expose a dropped file's path), so a drop opens
 * the picker rather than pretending to know where the file lives.
 */
export default function WorkspaceChip({ disabled }: { disabled?: boolean }) {
  const localize = useLocalize();
  const [workspacePath, setWorkspacePath] = useAtom(workspacePathAtom);
  const [workspaceFile, setWorkspaceFile] = useAtom(workspaceFileAtom);
  const [pickerOpen, setPickerOpen] = useAtom(workspacePickerOpenAtom);
  const [isDragging, setIsDragging] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const clear = useCallback(() => {
    setWorkspacePath(null);
    setWorkspaceFile(null);
  }, [setWorkspaceFile, setWorkspacePath]);

  const handleDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => setIsDragging(false), []);

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      setIsDragging(false);
      /** A drop carries names, not paths. Opening the picker is the honest
       *  response: the reader still has to say which folder on disk they mean. */
      setPickerOpen(true);
    },
    [setPickerOpen],
  );

  /** Ask the browser for a folder first.
   *
   * The native dialog is the interaction the reader expects, and a desktop
   * runtime answers with a real path. A plain browser returns only the leaf
   * name, so that name is looked up on the server: one match is adopted, and
   * anything else (none, or several) falls through to the browsable dialog
   * rather than guessing which folder was meant.
   */
  const pickNatively = useCallback(async () => {
    if (disabled) {
      return;
    }
    const picked = await pickWorkspaceDirectory();
    if (picked.status === 'dismissed') {
      return;
    }
    if (picked.status === 'unsupported') {
      /** No native dialog in this runtime; the browsable one is the only way
       *  to name a real path. */
      setPickerOpen(true);
      return;
    }
    if (picked.path != null) {
      setWorkspacePath(picked.path);
      setWorkspaceFile(null);
      return;
    }
    const matches = await dataService.findWorkspaceDirectories(picked.name);
    if (matches.length === 1) {
      setWorkspacePath(matches[0].path);
      setWorkspaceFile(null);
      return;
    }
    setPickerOpen(true);
  }, [disabled, setPickerOpen, setWorkspaceFile, setWorkspacePath]);

  const label = workspaceFile ?? workspacePath;

  return (
    <>
      <div
        data-testid="workspace-chip"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          'border-border-light bg-surface-secondary mx-4 -mb-3 flex min-w-0 items-center gap-1.5 rounded-t-2xl border px-2 pt-2 pb-5',
          isDragging && 'border-text-primary',
        )}
      >
        <button
          ref={triggerRef}
          type="button"
          disabled={disabled}
          onClick={() => void pickNatively()}
          className={cn(
            'text-text-secondary hover:text-text-primary flex min-w-0 items-center gap-1.5 rounded-md px-1 py-0.5 text-xs',
            disabled && 'cursor-not-allowed opacity-60',
          )}
          aria-label={localize('com_ui_workspace_select')}
        >
          {workspaceFile != null ? (
            <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          ) : (
            <FolderOpen className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          )}
          <span className="min-w-0 truncate">
            {label != null ? baseName(label) : localize('com_ui_workspace_select')}
          </span>
        </button>

        {label == null && (
          <span className="text-text-secondary min-w-0 truncate text-xs opacity-70">
            {localize('com_ui_workspace_drop_hint')}
          </span>
        )}

        {label != null && (
          <Button
            variant="ghost"
            size="icon"
            className="text-text-secondary hover:text-text-primary h-5 w-5 shrink-0"
            aria-label={localize('com_ui_workspace_clear')}
            onClick={clear}
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        )}
      </div>

      <WorkspacePickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        triggerRef={triggerRef}
      />
    </>
  );
}

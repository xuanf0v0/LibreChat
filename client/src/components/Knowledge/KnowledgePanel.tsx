import { useId, useMemo, useRef, useState } from 'react';
import { v4 } from 'uuid';
import { FileText, Plus } from 'lucide-react';
import { FilePreview, getFileType } from '@librechat/chat/components';
import {
  Button,
  EmptyState,
  FilterInput,
  Skeleton,
  Spinner,
  TrashIcon,
  useToastContext,
} from '@librechat/client';
import type { TFile } from 'librechat-data-provider';
import useDeleteFilesFromTable from '~/hooks/Files/useDeleteFilesFromTable';
import { PanelContent, PanelFooter, PanelHeader } from '~/components/ui';
import { useGetFiles, useUploadFileMutation } from '~/data-provider';
import { useLocalize } from '~/hooks';

function formatBytes(bytes = 0): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fileDate(file: TFile): string {
  const raw = file.updatedAt ?? file.createdAt;
  if (raw == null) {
    return '';
  }
  return new Date(raw).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * The user's file library, surfaced as a first-class module instead of a
 * dialog. Uploads are conversation-free message attachments: the composer's
 * file catalog can attach any of them to a turn, which injects its extracted
 * text through the existing attachment path.
 */
export function KnowledgePanel() {
  const localize = useLocalize();
  const headingId = useId();
  const { showToast } = useToastContext();
  const inputRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState('');

  const { data: files = [], isLoading } = useGetFiles<TFile[]>();
  const { deleteFiles } = useDeleteFilesFromTable();
  const uploadFile = useUploadFileMutation({
    onError: () => {
      showToast({ message: localize('com_ui_knowledge_upload_failed'), status: 'error' });
    },
  });

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered =
      query === ''
        ? files
        : files.filter((file) => file.filename?.toLowerCase().includes(query) === true);
    return [...filtered].sort((a, b) => {
      const left = a.updatedAt ?? a.createdAt ?? '';
      const right = b.updatedAt ?? b.createdAt ?? '';
      return String(right).localeCompare(String(left));
    });
  }, [files, search]);

  const uploadSelected = (selected: FileList | null) => {
    if (selected == null || selected.length === 0) {
      return;
    }
    for (const file of Array.from(selected)) {
      const formData = new FormData();
      formData.append('file', file, encodeURIComponent(file.name));
      formData.append('file_id', v4());
      formData.append('endpoint', 'agents');
      formData.append('message_file', 'true');
      uploadFile.mutate(formData);
    }
    if (inputRef.current) {
      inputRef.current.value = '';
    }
  };

  return (
    <div
      role="region"
      aria-labelledby={headingId}
      className="flex h-full w-full flex-col overflow-hidden pt-2"
    >
      <PanelHeader
        title={localize('com_ui_knowledge_base')}
        titleId={headingId}
        action={
          <>
            <input
              ref={inputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(event) => uploadSelected(event.target.files)}
            />
            <Button
              variant="ghost"
              size="icon"
              className="size-8 shrink-0"
              aria-label={localize('com_ui_knowledge_upload')}
              disabled={uploadFile.isLoading}
              onClick={() => inputRef.current?.click()}
            >
              {uploadFile.isLoading ? (
                <Spinner className="size-4" />
              ) : (
                <Plus className="size-4" aria-hidden="true" />
              )}
            </Button>
          </>
        }
        search={
          <FilterInput
            inputId="knowledge-filter"
            label={localize('com_ui_knowledge_search')}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        }
      />

      <PanelContent
        isLoading={isLoading}
        isEmpty={visible.length === 0}
        skeleton={
          <div className="space-y-2" aria-hidden="true">
            {[0, 1, 2].map((index) => (
              <Skeleton key={index} className="h-14 rounded-xl" />
            ))}
          </div>
        }
        empty={
          <EmptyState
            icon={FileText}
            description={
              search.trim() === ''
                ? localize('com_ui_knowledge_empty')
                : localize('com_ui_knowledge_no_results')
            }
          />
        }
        className="px-3 pb-3"
      >
        <ul className="space-y-1" aria-label={localize('com_ui_knowledge_files')}>
          {visible.map((file) => (
            <li
              key={file.file_id}
              className="hover:bg-surface-hover flex items-center gap-3 rounded-xl px-2 py-2"
            >
              <FilePreview
                file={file}
                fileType={getFileType(file.type)}
                className="size-9 shrink-0"
              />
              <div className="min-w-0 flex-1">
                <p className="text-text-primary truncate text-sm font-medium">{file.filename}</p>
                <p className="text-text-secondary truncate text-xs">
                  {formatBytes(file.bytes)} · {fileDate(file)}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 shrink-0"
                aria-label={localize('com_ui_knowledge_delete_file', { 0: file.filename ?? '' })}
                onClick={() => deleteFiles({ files: [file] })}
              >
                <TrashIcon className="size-4" aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      </PanelContent>

      <PanelFooter className="justify-start">
        <p className="text-text-secondary text-xs">{localize('com_ui_knowledge_hint')}</p>
      </PanelFooter>
    </div>
  );
}

export default KnowledgePanel;

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAtom } from 'jotai';
import { Download, X } from 'lucide-react';
import { Button, Spinner } from '@librechat/client';
import { getPreviewKind } from '@librechat/chat';
import { useFilePreviewBlob } from '~/data-provider';
import { previewFileAtom } from '~/store/previewFile';
import { getDownloadFilename, registerDownloadFilename, triggerDownload } from '~/utils';
import { useAuthContext } from '~/hooks';
import { useLocalize } from '~/hooks';

/** Container formats the chat cannot render inline; only download makes sense. */
const BINARY_EXTENSIONS = new Set([
  'docx',
  'doc',
  'xlsx',
  'xls',
  'pptx',
  'ppt',
  'zip',
  'rar',
  '7z',
  'gz',
  'tar',
]);

/**
 * The file a chat produced, previewed beside the conversation.
 *
 * Docked rather than modal: a produced document is something to read alongside
 * the reply that explains it, and a dialog would cover that reply. The bytes
 * come through the same `/api/files/download` endpoint the message's own file
 * cards use, so anything shown here is a file the reader could download.
 */
export default function PreviewPanel() {
  const localize = useLocalize();
  const { user } = useAuthContext();
  const [file, setFile] = useAtom(previewFileAtom);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const previewKind = useMemo(() => {
    if (file == null) {
      return null;
    }
    /* Known-binary containers decide on their own, whatever MIME the record
     * carries: a docx or xlsx served as `text/plain` would otherwise be read as
     * text and shown as its zip directory. */
    const extension = (file.filename.split('.').pop() ?? '').toLowerCase();
    if (BINARY_EXTENSIONS.has(extension)) {
      return false;
    }
    return getPreviewKind(file.filename, file.type, file.source);
  }, [file]);

  const { refetch: fetchPreview } = useFilePreviewBlob(user?.id, file?.file_id);

  const close = useCallback(() => setFile(null), [setFile]);

  useEffect(() => {
    let cancelled = false;
    let url: string | undefined;
    setBlobUrl(null);
    setText(null);
    setFailed(false);
    /* `getPreviewKind` answers `false` for a format the chat cannot render —
     * a docx, for instance. `== null` alone would let that through and read the
     * container's bytes as text. */
    if (file == null || !previewKind) {
      return;
    }

    const load = async () => {
      try {
        const { data: blob } = await fetchPreview();
        if (cancelled) {
          return;
        }
        if (!blob) {
          throw new Error('preview unavailable');
        }
        if (previewKind === 'text') {
          setText(await blob.text());
        } else {
          url = URL.createObjectURL(new Blob([blob], { type: file.type ?? 'application/pdf' }));
          setBlobUrl(url);
        }
      } catch {
        if (!cancelled) {
          setFailed(true);
        }
      }
    };
    void load();

    return () => {
      cancelled = true;
      if (url) {
        URL.revokeObjectURL(url);
      }
    };
  }, [fetchPreview, file, previewKind]);

  const download = useCallback(async () => {
    if (file == null) {
      return;
    }
    const { data: blob } = await fetchPreview();
    if (!blob) {
      return;
    }
    const url = URL.createObjectURL(blob);
    const name = getDownloadFilename(file.filename);
    /* `triggerDownload` reads the name off the map for blob targets, because a
       blob URL carries none of its own. */
    registerDownloadFilename(url, name);
    triggerDownload(url, name);
  }, [fetchPreview, file]);

  if (file == null) {
    return null;
  }

  return (
    <div className="border-border-light bg-surface-primary flex h-full w-full flex-col border-s">
      <header className="border-border-light flex shrink-0 items-center gap-2 border-b px-3 py-2">
        <span
          className="text-text-primary min-w-0 flex-1 truncate text-sm font-medium"
          title={file.filename}
        >
          {file.filename}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={localize('com_ui_download')}
          onClick={() => void download()}
        >
          <Download className="h-4 w-4" aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={localize('com_ui_close')}
          onClick={close}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      </header>

      <div className="min-h-0 flex-1">
        {!previewKind ? (
          <p className="text-text-secondary p-4 text-sm">
            {localize('com_ui_preview_unsupported')}
          </p>
        ) : failed ? (
          <p className="text-text-secondary p-4 text-sm">{localize('com_ui_preview_failed')}</p>
        ) : previewKind === 'pdf' ? (
          blobUrl == null ? (
            <div className="flex h-full items-center justify-center">
              <Spinner className="size-5" />
            </div>
          ) : (
            <iframe src={blobUrl} title={file.filename} className="h-full w-full border-0" />
          )
        ) : previewKind === 'text' ? (
          text == null ? (
            <div className="flex h-full items-center justify-center">
              <Spinner className="size-5" />
            </div>
          ) : (
            <pre className="text-text-primary h-full overflow-auto p-3 font-mono text-xs whitespace-pre-wrap">
              {text}
            </pre>
          )
        ) : (
          <p className="text-text-secondary p-4 text-sm">
            {localize('com_ui_preview_unsupported')}
          </p>
        )}
      </div>
    </div>
  );
}

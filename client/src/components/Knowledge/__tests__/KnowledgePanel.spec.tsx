import userEvent from '@testing-library/user-event';
import { FileSources } from 'librechat-data-provider';
import { render, screen } from '@testing-library/react';
import type { TFile } from 'librechat-data-provider';
import { KnowledgePanel } from '../KnowledgePanel';

const mockMutate = jest.fn();
const mockDeleteFiles = jest.fn();
const mockShowToast = jest.fn();

const mockFile: TFile = {
  user: 'user-1',
  file_id: 'file-1',
  filename: 'notes.txt',
  filepath: '/files/notes.txt',
  bytes: 2048,
  embedded: false,
  object: 'file',
  type: 'text/plain',
  usage: 0,
  source: FileSources.local,
  updatedAt: '2026-01-02T00:00:00.000Z',
};

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

jest.mock('~/hooks/Files/useDeleteFilesFromTable', () => ({
  __esModule: true,
  default: () => ({ deleteFiles: mockDeleteFiles }),
}));

jest.mock('~/data-provider', () => ({
  useGetFiles: () => ({ data: [mockFile], isLoading: false }),
  useUploadFileMutation: () => ({ mutate: mockMutate, isLoading: false }),
}));

jest.mock('@librechat/chat/components', () => ({
  FilePreview: () => <span data-testid="file-preview" />,
  getFileType: () => undefined,
}));

jest.mock('@librechat/client', () => ({
  Button: ({
    children,
    variant: _variant,
    size: _size,
    ...props
  }: React.ComponentProps<'button'> & { variant?: string; size?: string }) => (
    <button {...props}>{children}</button>
  ),
  FilterInput: ({
    label,
    inputId,
    ...props
  }: React.ComponentProps<'input'> & { label: string; inputId?: string }) => (
    <input id={inputId} aria-label={label} {...props} />
  ),
  Spinner: () => <span data-testid="spinner" />,
  TrashIcon: () => <span data-testid="trash" />,
  useToastContext: () => ({ showToast: mockShowToast }),
}));

jest.mock('~/components/ui', () => ({
  PanelHeader: ({
    title,
    action,
    search,
  }: {
    title: string;
    action?: React.ReactNode;
    search?: React.ReactNode;
  }) => (
    <header>
      <h2>{title}</h2>
      {action}
      {search}
    </header>
  ),
  PanelContent: ({
    children,
    empty,
    isEmpty,
  }: {
    children?: React.ReactNode;
    empty?: React.ReactNode;
    isEmpty?: boolean;
  }) => <div>{isEmpty === true ? empty : children}</div>,
  PanelFooter: ({ children }: { children?: React.ReactNode }) => <footer>{children}</footer>,
}));

describe('KnowledgePanel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('uploads a conversation-free message attachment', async () => {
    const { container } = render(<KnowledgePanel />);
    const input = container.querySelector('input[type="file"]');
    expect(input).not.toBeNull();

    await userEvent.upload(
      input as HTMLInputElement,
      new File(['hello'], 'notes.txt', { type: 'text/plain' }),
    );

    expect(mockMutate).toHaveBeenCalledTimes(1);
    const formData = mockMutate.mock.calls[0][0] as FormData;
    expect((formData.get('file') as File).name).toBe('notes.txt');
    expect(formData.get('endpoint')).toBe('agents');
    expect(formData.get('message_file')).toBe('true');
    expect(formData.get('file_id')).toBeTruthy();
  });

  test('deletes a listed file', async () => {
    render(<KnowledgePanel />);

    expect(screen.getByText('notes.txt')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'com_ui_knowledge_delete_file' }));

    expect(mockDeleteFiles).toHaveBeenCalledWith({ files: [mockFile] });
  });
});

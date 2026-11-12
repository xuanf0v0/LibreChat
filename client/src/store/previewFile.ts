import { atom } from 'jotai';

/** The file whose preview is docked in the chat's side panel, if any. */
export interface PreviewFile {
  file_id: string;
  filename: string;
  type?: string;
  source?: string;
  bytes?: number;
}

/**
 * Which file the side panel is showing.
 *
 * The panel is chat-wide rather than per-message: opening a second file
 * replaces the first, which is what a docked preview should do. `null` closes
 * it and gives the column back to the conversation.
 */
export const previewFileAtom = atom<PreviewFile | null>(null);

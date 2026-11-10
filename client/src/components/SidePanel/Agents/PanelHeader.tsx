import { ChevronLeft } from 'lucide-react';
import { Button } from '@librechat/client';
import type { ReactNode } from 'react';
import { useLocalize } from '~/hooks';

/**
 * The header of a builder sub-panel (model, advanced, version): one back
 * control, a centred title, and a spacer the width of the back control so the
 * title is centred against the panel rather than the row.
 */
export default function PanelHeader({
  title,
  subtitle,
  onBack,
}: {
  title: string;
  subtitle?: ReactNode;
  onBack: () => void;
}) {
  const localize = useLocalize();

  return (
    <header className="grid grid-cols-[auto_1fr_auto] items-center gap-2">
      <Button
        variant="quiet"
        size="icon"
        shape="theme"
        onClick={onBack}
        aria-label={localize('com_ui_back_to_builder')}
        className="shrink-0"
      >
        <ChevronLeft className="h-5 w-5 rtl:-scale-x-100" strokeWidth={1.75} aria-hidden="true" />
      </Button>
      <div className="flex flex-col items-center">
        <h2 className="text-text-primary text-center text-base font-semibold">{title}</h2>
        {subtitle}
      </div>
      <span
        aria-hidden="true"
        className="size-theme-button min-h-theme-target min-w-theme-target"
      />
    </header>
  );
}

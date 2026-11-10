import { Search, X, ChevronRight } from 'lucide-react';
import { Button, Input, TabsList, TabsTrigger } from '@librechat/client';
import type { SettingsContextValue, SettingsTab } from './types';
import { useLocalize } from '~/hooks';
import { TABS } from './types';
import { cn } from '~/utils';

interface SidebarProps {
  ctx: SettingsContextValue;
  query: string;
  onQueryChange: (q: string) => void;
  onSelectTab: (tab: SettingsTab) => void;
  showChevron?: boolean;
  hideTabs?: boolean;
  /** Stacked above the content pane rather than beside it. */
  stacked?: boolean;
}

export default function Sidebar({
  ctx,
  query,
  onQueryChange,
  onSelectTab,
  showChevron = false,
  hideTabs = false,
  stacked = false,
}: SidebarProps) {
  const localize = useLocalize();
  const tabs = TABS.filter((t) => !t.show || t.show(ctx));

  return (
    <div
      className={cn(
        'flex min-h-0 w-full flex-col gap-3 overflow-hidden',
        !stacked && 'w-[14.375rem]',
        stacked && !hideTabs && 'flex-1',
      )}
    >
      <div className="relative shrink-0">
        <Search
          className="text-text-tertiary pointer-events-none absolute inset-s-2 top-1/2 h-4 w-4 -translate-y-1/2"
          aria-hidden="true"
        />
        <Input
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && query.length > 0) {
              e.preventDefault();
              e.stopPropagation();
              onQueryChange('');
            }
          }}
          placeholder={localize('com_ui_settings_search_placeholder')}
          aria-label={localize('com_ui_settings_search_placeholder')}
          variant="with-icons"
        />
        {query.length > 0 && (
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => onQueryChange('')}
            aria-label={localize('com_ui_clear_search')}
            className="absolute inset-e-1.5 top-1/2 -translate-y-1/2"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        )}
      </div>
      {!hideTabs && (
        <TabsList variant="sidebar" aria-label={localize('com_nav_settings')} className="flex-1">
          {tabs.map((tab) => (
            <TabsTrigger
              key={tab.id}
              value={tab.id}
              variant="sidebar"
              onClick={() => onSelectTab(tab.id)}
            >
              <span className="flex min-w-0 items-center gap-2 [&>svg]:shrink-0">
                {tab.icon}
                <span className="min-w-0 text-start break-words">{localize(tab.labelKey)}</span>
              </span>
              {showChevron && (
                <ChevronRight
                  className="text-text-tertiary h-4 w-4 shrink-0 rtl:-scale-x-100"
                  aria-hidden="true"
                />
              )}
            </TabsTrigger>
          ))}
        </TabsList>
      )}
    </div>
  );
}

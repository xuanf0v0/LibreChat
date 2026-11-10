import { memo, useCallback, Suspense } from 'react';
import { SquarePen } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { Skeleton, Sidebar, Button, Separator, TooltipAnchor } from '@librechat/client';
import type { NavLink } from '~/common';
import { useShortcutAriaKey, useShortcutHint } from '~/hooks/useKeyboardShortcuts';
import { useActivePanel, resolveActivePanel, DEFAULT_PANEL } from '~/Providers';
import AgentMarketplaceButton from '~/components/Nav/AgentMarketplaceButton';
import { CLOSE_SIDEBAR_ID } from '~/components/Chat/Menus/OpenSidebar';
import useDirection, { inlineSide } from '~/hooks/Nav/useDirection';
import useNewChat from '~/hooks/Conversations/useNewChat';
import { lazyWithRecovery } from '~/lib/assets/lazy';
import { cn } from '~/utils';
import { useLocalize } from '~/hooks';

const AccountSettings = lazyWithRecovery(() => import('~/components/Nav/AccountSettings'));

const NewChatButton = memo(function NewChatButton({
  setActive,
  switchToHistory,
}: {
  setActive: (id: string) => void;
  switchToHistory: boolean;
}) {
  const localize = useLocalize();
  const tooltipSide = inlineSide(useDirection(), 'end');
  const tooltipDescription = useShortcutHint('newChat', localize('com_ui_new_chat'));
  const ariaKey = useShortcutAriaKey('newChat');

  const handlePanelSwitch = useCallback(() => {
    if (switchToHistory) {
      setActive(DEFAULT_PANEL);
    }
  }, [switchToHistory, setActive]);

  const { handleNewChatClick } = useNewChat({ onNewChat: handlePanelSwitch });

  return (
    <TooltipAnchor
      side={tooltipSide}
      description={tooltipDescription}
      render={
        <Button asChild variant="nav" size="icon" className="h-9 w-full justify-start gap-2.5 rounded-lg px-2">
          <a
            href="/c/new"
            data-testid="new-chat-button"
            aria-label={localize('com_ui_new_chat')}
            aria-keyshortcuts={ariaKey}
            onClick={handleNewChatClick}
          >
            <SquarePen className="text-text-primary h-5 w-5 shrink-0" aria-hidden="true" />
            <span className="text-text-primary min-w-0 truncate text-sm font-medium">
              {localize('com_ui_new_chat')}
            </span>
          </a>
        </Button>
      }
    />
  );
});

const NavIconButton = memo(function NavIconButton({
  link,
  isActive,
  expanded,
  setActive,
  onExpand,
  onCollapse,
  onNavigate,
  onLeaveInsights,
}: {
  link: NavLink;
  isActive: boolean;
  expanded: boolean;
  setActive: (id: string) => void;
  onExpand?: () => void;
  onCollapse?: () => void;
  onNavigate?: () => void;
  onLeaveInsights?: () => void;
}) {
  const localize = useLocalize();
  const tooltipSide = inlineSide(useDirection(), 'end');

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      if (link.onClick) {
        link.onClick(e);
        onNavigate?.();
        return;
      }
      if (isActive && expanded) {
        onCollapse?.();
        return;
      }
      if (!isActive) {
        setActive(link.id);
      }
      if (!expanded) {
        onExpand?.();
      } else {
        onLeaveInsights?.();
      }
    },
    [link, isActive, setActive, expanded, onExpand, onCollapse, onNavigate, onLeaveInsights],
  );

  return (
    <TooltipAnchor
      description={localize(link.title)}
      side={tooltipSide}
      render={
        <Button
          size="icon"
          variant="nav"
          aria-label={localize(link.title)}
          aria-pressed={isActive}
          disabled={link.disabled}
          data-testid={`nav-panel-${link.id}`}
          className="h-9 w-full justify-start gap-2.5 rounded-lg px-2"
          onClick={handleClick}
        >
          <link.icon className="text-text-primary h-5 w-5 shrink-0" aria-hidden="true" />
          <span className="text-text-primary min-w-0 truncate text-sm font-medium">
            {localize(link.title)}
          </span>
        </Button>
      }
    />
  );
});

function ExpandedPanel({
  links,
  expanded = true,
  onCollapse,
  onExpand,
  onNavigate,
  onLeaveInsights,
  switchToHistory,
}: {
  links: NavLink[];
  expanded?: boolean;
  onCollapse?: () => void;
  onExpand?: () => void;
  onNavigate?: () => void;
  onLeaveInsights?: () => void;
  switchToHistory: boolean;
}) {
  const localize = useLocalize();
  const tooltipSide = inlineSide(useDirection(), 'end');
  const location = useLocation();
  const { active, setActive } = useActivePanel();
  const effectiveActive = resolveActivePanel(active, links);
  const isInsightsRoute = location.pathname.startsWith('/insights');

  const toggleLabel = expanded ? 'com_nav_close_sidebar' : 'com_nav_open_sidebar';
  const toggleClick = expanded ? onCollapse : onExpand;
  const toggleSidebarHint = useShortcutHint('toggleSidebar', localize(toggleLabel));
  const toggleSidebarAriaKey = useShortcutAriaKey('toggleSidebar');

  return (
    <div className="border-border-inset bg-surface-sidebar flex h-full shrink-0 flex-col gap-2 border-e px-2 py-2">
      <img
        src="assets/fullon-mark.png"
        alt=""
        aria-hidden="true"
        draggable={false}
        className="mx-auto h-6 w-auto shrink-0"
      />
      <TooltipAnchor
        side={tooltipSide}
        description={toggleSidebarHint}
        render={
          <Button
            id={expanded ? CLOSE_SIDEBAR_ID : undefined}
            data-testid={expanded ? 'close-sidebar-button' : 'open-sidebar-button'}
            size="icon"
            variant="nav"
            aria-label={localize(toggleLabel)}
            aria-expanded={expanded}
            aria-keyshortcuts={toggleSidebarAriaKey}
            className={cn(
              'h-9 rounded-lg',
              expanded ? 'w-full justify-start gap-2.5 px-2' : 'w-9',
            )}
            onClick={toggleClick}
          >
            <Sidebar
              aria-hidden="true"
              className="text-text-primary h-5 w-5 shrink-0 rtl:-scale-x-100"
            />
            {expanded && (
              <span className="text-text-primary min-w-0 truncate text-sm font-medium">
                {localize(toggleLabel)}
              </span>
            )}
          </Button>
        }
      />
      <NewChatButton setActive={setActive} switchToHistory={switchToHistory} />
      <AgentMarketplaceButton layout="rail" />
      <Separator className="mx-2" />
      <div className="flex flex-col gap-1 overflow-y-auto">
        {links.map((link) => (
          <NavIconButton
            key={link.id}
            link={link}
            isActive={
              link.id === 'insights'
                ? isInsightsRoute
                : !isInsightsRoute && link.id === effectiveActive
            }
            expanded={expanded ?? true}
            setActive={setActive}
            onExpand={onExpand}
            onCollapse={onCollapse}
            onNavigate={onNavigate}
            onLeaveInsights={isInsightsRoute ? onLeaveInsights : undefined}
          />
        ))}
      </div>

      <div className="mt-auto">
        <Suspense fallback={<Skeleton className="h-9 w-9 rounded-lg" />}>
          <AccountSettings collapsed />
        </Suspense>
      </div>
    </div>
  );
}

export default memo(ExpandedPanel);

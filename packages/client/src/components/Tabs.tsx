import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn, disabledInkClasses } from '~/utils';
import { focusOutlineRole } from './Focus';

type TabsListVariant = 'default' | 'sidebar' | 'pills';
type TabsTriggerVariant = 'default' | 'sidebar' | 'pills';
type TabsContentVariant = 'default' | 'flush';

const LIST_VARIANTS: Record<TabsListVariant, string> = {
  default: 'bg-surface-primary inline-flex items-center justify-center rounded-md',
  /** A vertical navigation list that owns its scroll and fills its column. */
  sidebar: 'flex min-h-0 flex-col gap-1 overflow-y-auto bg-transparent p-0',
  /** Compact rounded tabs on a plain rail, used by the capability catalogs. */
  pills: 'inline-flex items-center justify-start gap-1.5 rounded-none bg-transparent p-0',
};

const TRIGGER_VARIANTS: Record<TabsTriggerVariant, string> = {
  default:
    'text-text-secondary data-[state=active]:bg-surface-primary data-[state=active]:text-text-primary rounded-theme-tab min-w-theme-tab px-3 py-1.5 text-sm font-medium transition-all',
  sidebar:
    'text-text-secondary hover:bg-surface-hover hover:text-text-primary rounded-theme-control w-full shrink-0 justify-between gap-2 px-3 py-2.5 text-sm transition-colors data-[state=active]:bg-surface-tab-selected data-[state=active]:text-text-primary md:py-2',
  pills:
    'text-text-secondary hover:bg-surface-hover hover:text-text-primary data-[state=active]:border-border-chrome-heavy data-[state=active]:bg-surface-active-alt data-[state=active]:text-text-primary h-8 min-w-0 shrink-0 rounded-full border border-border-chrome bg-surface-secondary px-3 text-xs font-medium whitespace-nowrap select-none',
};

const CONTENT_VARIANTS: Record<TabsContentVariant, string> = {
  default: 'mt-2 rounded-md p-6',
  /** For a panel that manages its own spacing and fills the tab body. */
  flush: 'mt-0 overflow-hidden rounded-none p-0',
};

const Tabs: React.ForwardRefExoticComponent<
  TabsPrimitive.TabsProps & React.RefAttributes<HTMLDivElement>
> = TabsPrimitive.Root;

const TabsList: React.ForwardRefExoticComponent<
  Omit<TabsPrimitive.TabsListProps & React.RefAttributes<HTMLDivElement>, 'ref'> & {
    variant?: TabsListVariant;
  } & React.RefAttributes<HTMLDivElement>
> = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List> & { variant?: TabsListVariant }
>(({ className = '', variant = 'default', ...props }, ref) => (
  <TabsPrimitive.List ref={ref} className={cn(LIST_VARIANTS[variant], className)} {...props} />
));
TabsList.displayName = TabsPrimitive.List.displayName;

const TabsTrigger: React.ForwardRefExoticComponent<
  Omit<TabsPrimitive.TabsTriggerProps & React.RefAttributes<HTMLButtonElement>, 'ref'> & {
    variant?: TabsTriggerVariant;
  } & React.RefAttributes<HTMLButtonElement>
> = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger> & {
    variant?: TabsTriggerVariant;
  }
>(({ className = '', variant = 'default', ...props }, ref) => (
  <TabsPrimitive.Trigger
    className={cn(
      'inline-flex items-center justify-center',
      TRIGGER_VARIANTS[variant],
      disabledInkClasses,
      focusOutlineRole,
      className,
    )}
    {...props}
    ref={ref}
  />
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent: React.ForwardRefExoticComponent<
  Omit<TabsPrimitive.TabsContentProps & React.RefAttributes<HTMLDivElement>, 'ref'> & {
    variant?: TabsContentVariant;
  } & React.RefAttributes<HTMLDivElement>
> = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content> & {
    variant?: TabsContentVariant;
  }
>(({ className = '', variant = 'default', ...props }, ref) => (
  <TabsPrimitive.Content
    className={cn(CONTENT_VARIANTS[variant], className)}
    {...props}
    ref={ref}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsList, TabsTrigger, TabsContent };

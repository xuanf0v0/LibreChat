import { Label } from '@librechat/client';
import { useFormContext, useWatch } from 'react-hook-form';
import type { AgentForm } from '~/common';
import { ResolvedProviderIcon } from '~/components/Endpoints/ResolvedProviderIcon';
import AgentCategorySelector from './AgentCategorySelector';
import { useLocalize } from '~/hooks';
import { useAgentPanelContext } from '~/Providers';
import { useProviderIcon } from '~/hooks/Endpoint';
import { cn } from '~/utils';
import { Panel } from '~/common';

export default function AgentModelCategory() {
  const localize = useLocalize();
  const { control } = useFormContext<AgentForm>();
  const { setActivePanel, endpointsConfig } = useAgentPanelContext();
  const provider = useWatch({ control, name: 'provider' });
  const model = useWatch({ control, name: 'model' });
  const providerValue = typeof provider === 'string' ? provider : provider?.value;
  const { provider: providerId, imageURL } = useProviderIcon({
    endpoint: providerValue as string,
    endpointsConfig,
  });

  return (
    <div className="mb-4 grid grid-cols-1 gap-3 @min-[22rem]:grid-cols-2 @min-[22rem]:gap-2">
      <div className="flex min-w-0 flex-col">
        <Label className="mb-1" htmlFor="provider">
          {localize('com_ui_model')} <span className="text-text-destructive">*</span>
        </Label>
        <button
          id="provider"
          type="button"
          onClick={() => setActivePanel(Panel.model)}
          title={model || undefined}
          className={cn(
            'border-border-control bg-surface-secondary text-text-primary hover:bg-surface-tertiary focus-visible:ring-ring-primary relative flex h-9 w-full min-w-0 items-center overflow-hidden rounded-lg border text-sm font-medium transition-colors focus:outline-hidden focus-visible:ring-2',
            model != null && model ? 'ps-1 pe-3' : 'px-3',
          )}
        >
          <div className="flex w-full min-w-0 items-center gap-2">
            {providerValue !== undefined && (
              <div className="avatar-stroke bg-surface-primary text-text-primary relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full">
                <ResolvedProviderIcon
                  provider={providerId}
                  imageURL={imageURL}
                  size={16}
                  className="h-2/3 w-2/3"
                />
              </div>
            )}
            <span className="truncate">
              {model != null && model ? model : localize('com_ui_select_model')}
            </span>
          </div>
        </button>
      </div>
      <div className="flex min-w-0 flex-col">
        <Label className="mb-1" htmlFor="category-selector">
          {localize('com_ui_category')} <span className="text-text-destructive">*</span>
        </Label>
        <AgentCategorySelector className="w-full" />
      </div>
    </div>
  );
}

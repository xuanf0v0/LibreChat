import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Controller, useWatch, useFormContext } from 'react-hook-form';
import {
  Input,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@librechat/client';
import type { InstructionsPromptStatus } from './Instructions';
import type { AgentForm } from '~/common';
import AgentModelCategory from './AgentModelCategory';
import { useLocalize, useAgentCapabilities } from '~/hooks';
import { useAgentFileEntries } from './Tools/hooks';
import { useAgentPanelContext } from '~/Providers';
import ToolsSection from './Tools/ToolsSection';
import { validateEmail, cn } from '~/utils';
import Instructions from './Instructions';
import FileContext from './FileContext';
import AgentAvatar from './AgentAvatar';
import Starters from './Starters';

const fieldClass = 'h-9';

export default function AgentConfig({
  instructionsPromptStatus,
  onRetryInstructionsPrompt,
  showModelCategory = true,
}: {
  instructionsPromptStatus?: InstructionsPromptStatus;
  onRetryInstructionsPrompt?: () => void;
  showModelCategory?: boolean;
}) {
  const localize = useLocalize();
  const methods = useFormContext<AgentForm>();
  const { agentsConfig } = useAgentPanelContext();
  const { contextEnabled } = useAgentCapabilities(agentsConfig?.capabilities);

  const {
    control,
    formState: { errors },
  } = methods;
  const agent = useWatch({ control, name: 'agent' });
  const agent_id = useWatch({ control, name: 'id' });
  const { contextFiles } = useAgentFileEntries();
  const [supportOpen, setSupportOpen] = useState(false);

  return (
    <div className="@container h-auto">
      {/* IDENTITY — name and description inline with the avatar */}
      <div className="mb-4 flex items-start gap-3">
        <div className="shrink-0">
          <AgentAvatar avatar={agent?.['avatar'] ?? null} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Controller
            name="name"
            rules={{ required: localize('com_ui_agent_name_is_required') }}
            control={control}
            render={({ field }) => (
              <div className="flex flex-col">
                <Input
                  {...field}
                  value={field.value ?? ''}
                  maxLength={256}
                  className={fieldClass}
                  id="name"
                  type="text"
                  placeholder={localize('com_agents_name_placeholder')}
                  aria-label={localize('com_ui_agent_name')}
                  aria-invalid={!!errors.name}
                  aria-describedby={errors.name ? 'agent-name-error' : undefined}
                />
                {errors.name && (
                  <div
                    id="agent-name-error"
                    className="text-text-destructive mt-1 text-xs"
                    role="alert"
                  >
                    {errors.name.message}
                  </div>
                )}
              </div>
            )}
          />
          <Controller
            name="description"
            control={control}
            render={({ field }) => (
              <Input
                {...field}
                value={field.value ?? ''}
                maxLength={512}
                className={fieldClass}
                id="description"
                type="text"
                placeholder={localize('com_agents_description_placeholder')}
                aria-label={localize('com_ui_agent_description')}
              />
            )}
          />
        </div>
      </div>

      {/* MODEL + CATEGORY — one column until the panel is wide enough for two */}
      {showModelCategory && <AgentModelCategory />}

      {/* INSTRUCTIONS */}
      <Instructions
        promptStatus={instructionsPromptStatus}
        onRetryLoad={onRetryInstructionsPrompt}
      />

      {/* TOOLS — unified built-ins / tools / actions / mcp / skills */}
      <ToolsSection agentId={agent_id} />

      {/* FILE CONTEXT — standalone section, separate from the tool library */}
      {contextEnabled && <FileContext agent_id={agent_id} files={contextFiles} />}

      {/* CONVERSATION STARTERS */}
      <Starters />

      {/* SUPPORT CONTACT — low-frequency fields, folded away */}
      <Collapsible open={supportOpen} onOpenChange={setSupportOpen} className="mb-1">
        <CollapsibleTrigger asChild>
          <Button variant="section-header" className="w-full justify-between">
            <span>{localize('com_ui_support_contact')}</span>
            <ChevronDown
              className={cn('h-4 w-4 transition-transform', supportOpen && 'rotate-180')}
              aria-hidden="true"
            />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="flex flex-col gap-2 pt-2">
            <Controller
              name="support_contact.name"
              control={control}
              rules={{
                minLength: {
                  value: 3,
                  message: localize('com_ui_support_contact_name_min_length', { minLength: 3 }),
                },
              }}
              render={({ field, fieldState: { error } }) => (
                <div className="flex flex-col">
                  <Input
                    {...field}
                    value={field.value ?? ''}
                    className={fieldClass}
                    id="support-contact-name"
                    type="text"
                    placeholder={localize('com_ui_support_contact_name_placeholder')}
                    aria-label={localize('com_ui_support_contact_name')}
                    aria-invalid={error ? 'true' : 'false'}
                    aria-describedby={error ? 'support-contact-name-error' : undefined}
                  />
                  {error && (
                    <span
                      id="support-contact-name-error"
                      className="text-text-destructive mt-1 text-xs"
                      role="alert"
                      aria-live="polite"
                    >
                      {error.message}
                    </span>
                  )}
                </div>
              )}
            />
            <Controller
              name="support_contact.email"
              control={control}
              rules={{
                validate: (value) =>
                  validateEmail(value ?? '', localize('com_ui_support_contact_email_invalid')),
              }}
              render={({ field, fieldState: { error } }) => (
                <div className="flex flex-col">
                  <Input
                    {...field}
                    value={field.value ?? ''}
                    className={fieldClass}
                    id="support-contact-email"
                    type="email"
                    placeholder={localize('com_ui_support_contact_email_placeholder')}
                    aria-label={localize('com_ui_support_contact_email')}
                    aria-invalid={error ? 'true' : 'false'}
                    aria-describedby={error ? 'support-contact-email-error' : undefined}
                  />
                  {error && (
                    <span
                      id="support-contact-email-error"
                      className="text-text-destructive mt-1 text-xs"
                      role="alert"
                      aria-live="polite"
                    >
                      {error.message}
                    </span>
                  )}
                </div>
              )}
            />
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

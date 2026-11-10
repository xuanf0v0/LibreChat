import { useState } from 'react';
import { isAxiosError } from 'axios';
import { Sparkles } from 'lucide-react';
import { useFormContext, useWatch } from 'react-hook-form';
import { Button, Label, Spinner, Textarea, useToastContext } from '@librechat/client';
import type { AgentForm } from '~/common';
import { useGenerateAgentMutation } from '~/data-provider';
import { useLocalize } from '~/hooks';

const MAX_PROMPT_LENGTH = 4000;

export default function GenerateAgent() {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const { control, getValues, reset } = useFormContext<AgentForm>();
  const provider = useWatch({ control, name: 'provider' });
  const model = useWatch({ control, name: 'model' });
  const [prompt, setPrompt] = useState('');
  const generate = useGenerateAgentMutation();

  const providerName =
    provider == null ? '' : String(typeof provider === 'string' ? provider : provider.value);
  const modelName = model == null ? '' : String(model);
  const canGenerate = prompt.trim() !== '' && providerName !== '' && modelName !== '';

  const handleGenerate = () => {
    if (!canGenerate || generate.isLoading) {
      return;
    }

    generate.mutate(
      {
        prompt: prompt.trim(),
        provider: providerName,
        model: modelName,
        locale: document.documentElement.lang || 'zh-Hans',
      },
      {
        onSuccess: ({ draft }) => {
          const current = getValues();
          reset({
            ...current,
            name: draft.name,
            description: draft.description || null,
            instructions: draft.instructions,
            instructionsSource: 'inline',
            instructionsPrompt: null,
            conversation_starters: draft.conversation_starters,
            ...(draft.category !== '' ? { category: draft.category } : {}),
          });
          showToast({
            message: localize('com_ui_ai_agent_generated'),
            status: 'success',
          });
        },
        onError: (error) => {
          const code = isAxiosError(error)
            ? (error.response?.data as { error?: string } | undefined)?.error
            : undefined;
          let message = localize('com_ui_ai_agent_generate_error');
          if (code === 'rate_limited') {
            message = localize('com_ui_ai_agent_rate_limited');
          } else if (code === 'provider_not_configured' || code === 'model_not_available') {
            message = localize('com_ui_ai_agent_model_unavailable');
          }
          showToast({ message, status: 'error' });
        },
      },
    );
  };

  return (
    <div
      id="ai-agent-generator"
      className="border-border-light bg-surface-secondary mb-4 flex flex-col gap-2 rounded-lg border p-3"
    >
      <div className="flex items-center gap-2">
        <Sparkles className="text-text-secondary h-4 w-4 shrink-0" aria-hidden="true" />
        <h3 className="text-text-primary text-sm font-medium">
          {localize('com_ui_ai_agent_title')}
        </h3>
      </div>
      <p className="text-text-secondary text-xs">{localize('com_ui_ai_agent_description')}</p>
      <Label htmlFor="ai-agent-prompt" className="sr-only">
        {localize('com_ui_ai_agent_prompt_label')}
      </Label>
      <Textarea
        id="ai-agent-prompt"
        value={prompt}
        maxLength={MAX_PROMPT_LENGTH}
        placeholder={localize('com_ui_ai_agent_prompt_placeholder')}
        className="min-h-24"
        onChange={(event) => setPrompt(event.target.value)}
      />
      {!canGenerate && !generate.isLoading && (
        <p className="text-text-secondary text-xs">{localize('com_ui_ai_agent_model_hint')}</p>
      )}
      <Button
        type="button"
        variant="submit"
        className="w-full"
        disabled={!canGenerate || generate.isLoading}
        aria-busy={generate.isLoading}
        onClick={handleGenerate}
      >
        {generate.isLoading ? (
          <>
            <Spinner className="me-2 h-4 w-4" aria-hidden="true" />
            {localize('com_ui_ai_agent_generating')}
          </>
        ) : (
          localize('com_ui_ai_agent_generate')
        )}
      </Button>
    </div>
  );
}

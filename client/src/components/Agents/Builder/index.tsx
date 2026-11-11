import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { isAxiosError } from 'axios';
import { useForm, FormProvider } from 'react-hook-form';
import { useGetModelsQuery } from 'librechat-data-provider/react-query';
import { ArrowLeft, Sparkles } from 'lucide-react';
import {
  Button,
  Dropdown,
  Input,
  Label,
  Spinner,
  Textarea,
  useToastContext,
} from '@librechat/client';
import {
  EModelEndpoint,
  isAssistantsEndpoint,
  resolveModelCatalogKey,
} from 'librechat-data-provider';
import type { AgentForm } from '~/common';
import {
  useCreateAgentMutation,
  useGenerateAgentMutation,
  useGetEndpointsQuery,
} from '~/data-provider';
import { AgentPanelProvider } from '~/Providers/AgentPanelContext';
import { useDocumentTitle, useGetAgentsConfig, useLocalize } from '~/hooks';
import { createProviderOption, getDefaultAgentFormValues } from '~/utils';
import AgentCategorySelector from '~/components/SidePanel/Agents/AgentCategorySelector';
import OpenSidebar from '~/components/Chat/Menus/OpenSidebar';
import useDrawerViewport from '~/hooks/Nav/useDrawerViewport';
import { DEFAULT_APP_TITLE } from '~/utils';

const MAX_PROMPT_LENGTH = 4000;

/**
 * Building an agent with AI, as a page rather than a sidebar form.
 *
 * The description is the input and the generated draft is the output: the
 * reader describes the job, the model fills in name, instructions, category and
 * starters, and the page shows that draft for editing before anything is
 * written. Creation goes through the ordinary `POST /api/agents`; nothing here
 * persists until the reader presses the button.
 */
function AgentBuilder() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const { showToast } = useToastContext();
  const isSmallScreen = useDrawerViewport();
  useDocumentTitle(`${localize('com_agents_builder_title')} | ${DEFAULT_APP_TITLE}`);

  const [prompt, setPrompt] = useState('');
  const [draft, setDraft] = useState<{
    name: string;
    description: string;
    instructions: string;
    category: string;
    conversation_starters: string[];
    tools: string[];
  } | null>(null);

  const methods = useForm<AgentForm>({
    defaultValues: getDefaultAgentFormValues(),
    mode: 'onChange',
  });
  const { control, getValues, reset, watch, register, setValue } = methods;
  const provider = watch('provider');
  const model = watch('model');

  const generate = useGenerateAgentMutation();
  const create = useCreateAgentMutation({
    onSuccess: (agent) => {
      showToast({ message: localize('com_ui_ai_agent_created'), status: 'success' });
      navigate(`/agents`);
      void agent;
    },
    onError: () => {
      showToast({ message: localize('com_ui_ai_agent_create_error'), status: 'error' });
    },
  });

  const { data: endpointsConfig } = useGetEndpointsQuery();
  const modelsQuery = useGetModelsQuery({ refetchOnMount: 'always' });
  const modelsReady = modelsQuery.isFetchedAfterMount && !modelsQuery.isFetching;
  const modelsError = modelsQuery.isFetchedAfterMount && !modelsQuery.isSuccess;
  const models = useMemo(
    () => (modelsReady && !modelsError ? (modelsQuery.data ?? {}) : {}),
    [modelsError, modelsQuery.data, modelsReady],
  );

  const { agentsConfig } = useGetAgentsConfig({ endpointsConfig });
  const allowedProviders = useMemo(
    () => new Set(agentsConfig?.allowedProviders),
    [agentsConfig?.allowedProviders],
  );
  const providers = useMemo(
    () =>
      Object.keys(endpointsConfig ?? {})
        .filter(
          (key) =>
            !isAssistantsEndpoint(key) &&
            (allowedProviders.size > 0 ? allowedProviders.has(key) : true) &&
            key !== EModelEndpoint.agents,
        )
        .map((providerKey) => createProviderOption(providerKey)),
    [allowedProviders, endpointsConfig],
  );

  /** The form stores `provider` as an option object, and the empty default is
   *  `{}` rather than `''` — reading `.value` off it yields `undefined`, which
   *  `String()` would render into the trigger as the literal text "undefined". */
  const providerName =
    provider == null
      ? ''
      : typeof provider === 'string'
        ? provider
        : String(provider.value ?? '');
  const modelName =
    typeof model === 'string'
      ? model
      : model != null && typeof model === 'object' && 'value' in model
        ? String(model.value ?? '')
        : '';
  const canGenerate = prompt.trim() !== '' && providerName !== '' && modelName !== '';

  const handleGenerate = useCallback(() => {
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
        onSuccess: (result) => {
          const next = {
            name: result.draft.name,
            description: result.draft.description ?? '',
            instructions: result.draft.instructions,
            category: result.draft.category ?? '',
            conversation_starters: result.draft.conversation_starters ?? [],
            tools: result.draft.tools ?? [],
          };
          setDraft(next);
          const current = getValues();
          reset({
            ...current,
            name: next.name,
            description: next.description || null,
            instructions: next.instructions,
            instructionsSource: 'inline',
            instructionsPrompt: null,
            conversation_starters: next.conversation_starters,
            tools: next.tools,
            ...(next.category !== '' ? { category: next.category } : {}),
          });
          showToast({ message: localize('com_ui_ai_agent_generated'), status: 'success' });
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
  }, [
    canGenerate,
    generate,
    getValues,
    localize,
    modelName,
    prompt,
    providerName,
    reset,
    showToast,
  ]);

  const handleCreate = useCallback(() => {
    const values = getValues();
    const name = (values.name ?? '').trim();
    if (name === '') {
      showToast({ message: localize('com_agents_missing_name'), status: 'error' });
      return;
    }
    if (!providerName || !modelName) {
      showToast({ message: localize('com_agents_missing_provider_model'), status: 'error' });
      return;
    }
    create.mutate({
      name,
      description: values.description ?? undefined,
      instructions: values.instructions ?? undefined,
      category: values.category ?? undefined,
      conversation_starters: values.conversation_starters ?? [],
      provider: providerName,
      model: modelName,
      model_parameters: values.model_parameters ?? {},
      tools: values.tools ?? [],
    });
  }, [create, getValues, localize, modelName, providerName, showToast]);

  const createDisabled = create.isLoading || !modelsReady || draft == null;

  const header = useMemo(
    () => (
      <header className="border-border-light flex shrink-0 items-center gap-3 border-b px-6 py-4">
        {isSmallScreen && <OpenSidebar className="size-9 shrink-0 rounded-lg" />}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={localize('com_ui_back')}
          onClick={() => navigate('/agents')}
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        </Button>
        <h1 className="text-text-primary min-w-0 flex-1 truncate text-lg font-semibold">
          {localize('com_agents_builder_title')}
        </h1>
      </header>
    ),
    [isSmallScreen, localize, navigate],
  );

  return (
    <FormProvider {...methods}>
      <div className="bg-surface-primary-alt text-text-primary flex h-full w-full min-w-0 flex-col">
        {header}
        <div className="min-h-0 flex-1 overflow-y-auto p-6 lg:p-10">
          <div className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-6 lg:grid-cols-2">
            <section className="border-border-light bg-surface-secondary flex flex-col gap-5 rounded-2xl border p-6 lg:p-8">
              <div className="flex items-center gap-2.5">
                <Sparkles className="text-text-secondary h-5 w-5 shrink-0" aria-hidden="true" />
                <h2 className="text-text-primary text-base font-semibold">
                  {localize('com_ui_ai_agent_title')}
                </h2>
              </div>
              <p className="text-text-secondary text-sm leading-relaxed">
                {localize('com_ui_ai_agent_description')}
              </p>
              <Textarea
                aria-label={localize('com_ui_ai_agent_prompt_label')}
                value={prompt}
                maxLength={MAX_PROMPT_LENGTH}
                placeholder={localize('com_ui_ai_agent_prompt_placeholder')}
                className="min-h-48 text-base"
                onChange={(event) => setPrompt(event.target.value)}
              />
              <div className="mt-auto flex flex-col gap-2">
                <div className="grid grid-cols-1 gap-2 @min-[22rem]:grid-cols-2">
                  <div className="flex min-w-0 flex-col gap-1">
                    <Label>{localize('com_ui_provider')}</Label>
                    <Dropdown
                      variant="field"
                      ariaLabel={localize('com_ui_provider')}
                      value={providerName}
                      options={providers.map((option) => ({
                        label: option.label,
                        value: option.value,
                      }))}
                      onChange={(value) => {
                        setValue('provider', createProviderOption(String(value)));
                        setValue('model', '');
                      }}
                      disabled={!modelsReady}
                    />
                  </div>
                  <div className="flex min-w-0 flex-col gap-1">
                    <Label>{localize('com_ui_model')}</Label>
                    <Dropdown
                      variant="field"
                      ariaLabel={localize('com_ui_model')}
                      value={modelName}
                      options={(models[resolveModelCatalogKey(providerName, models)] ?? []).map(
                        (name) => ({ label: name, value: name }),
                      )}
                      onChange={(value) => setValue('model', String(value))}
                      disabled={!modelsReady || providerName === ''}
                    />
                  </div>
                </div>
                {!canGenerate && !generate.isLoading && (
                  <p className="text-text-secondary text-xs">
                    {localize('com_ui_ai_agent_model_hint')}
                  </p>
                )}
                <Button
                  variant="submit"
                  disabled={!canGenerate || generate.isLoading}
                  onClick={handleGenerate}
                >
                  {generate.isLoading ? (
                    <>
                      <Spinner className="me-2 size-4" />
                      {localize('com_ui_ai_agent_generating')}
                    </>
                  ) : (
                    localize('com_ui_ai_agent_generate')
                  )}
                </Button>
              </div>
            </section>

            <section className="border-border-light bg-surface-secondary flex flex-col gap-5 rounded-2xl border p-6 lg:p-8">
              <h2 className="text-text-primary text-base font-semibold">
                {localize('com_agents_builder_draft')}
              </h2>
              {draft == null ? (
                <p className="text-text-secondary flex flex-1 items-center justify-center py-16 text-center text-sm">
                  {localize('com_agents_builder_empty')}
                </p>
              ) : (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="builder-name">{localize('com_ui_name')}</Label>
                    <Input id="builder-name" {...register('name')} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="builder-description">{localize('com_ui_description')}</Label>
                    <Textarea
                      id="builder-description"
                      className="min-h-20"
                      {...register('description')}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="builder-category">{localize('com_ui_category')}</Label>
                    <AgentCategorySelector className="w-full" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="builder-instructions">{localize('com_ui_instructions')}</Label>
                    <Textarea
                      id="builder-instructions"
                      className="min-h-40 font-mono text-xs"
                      {...register('instructions')}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>{localize('com_ui_ai_agent_tools')}</Label>
                    {draft.tools.length === 0 ? (
                      <p className="text-text-secondary text-xs">
                        {localize('com_ui_ai_agent_tools_none')}
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {draft.tools.map((toolId) => (
                          <span
                            key={toolId}
                            className="border-border-light bg-surface-primary text-text-secondary rounded-md border px-2 py-1 font-mono text-xs"
                          >
                            {toolId}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="mt-auto flex justify-end pt-2">
                    <Button
                      variant="submit"
                      disabled={createDisabled}
                      onClick={handleCreate}
                      className="min-w-32"
                    >
                      {create.isLoading ? (
                        <Spinner className="size-4" />
                      ) : (
                        localize('com_ui_create')
                      )}
                    </Button>
                  </div>
                </>
              )}
            </section>
          </div>
        </div>
      </div>
    </FormProvider>
  );
}

export default function AgentBuilderPage() {
  return (
    <AgentPanelProvider observeToolAuthorization={false}>
      <AgentBuilder />
    </AgentPanelProvider>
  );
}

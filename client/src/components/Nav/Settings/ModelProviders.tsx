import { useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Chip,
  Dropdown,
  FieldMessage,
  Input,
  Label,
  MultiSelect,
  Spinner,
  useToastContext,
} from '@librechat/client';
import type {
  TModelProvider,
  TModelProviderInput,
  TModelProviderKind,
} from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks';
import {
  useFetchModelProviderModelsMutation,
  useGetModelProvidersQuery,
  useUpdateModelProvidersMutation,
} from '~/data-provider';
import { useLocalize } from '~/hooks';

type FormState = {
  name: string;
  baseURL: string;
  models: string;
  provider: TModelProviderKind;
  apiKey: string;
};

const EMPTY_FORM: FormState = { name: '', baseURL: '', models: '', provider: 'openai', apiKey: '' };

const PROVIDER_OPTIONS = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
];

const PROVIDER_DEFAULT_URLS: Record<TModelProviderKind, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
};

function splitModels(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[\n,]+/)
        .map((model) => model.trim())
        .filter(Boolean),
    ),
  ];
}

function toInput(provider: TModelProvider): TModelProviderInput {
  return {
    name: provider.name,
    baseURL: provider.baseURL,
    models: provider.models,
    provider: provider.provider,
  };
}

export default function ModelProviders() {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const { data, isLoading, isError } = useGetModelProvidersQuery();
  const updateProviders = useUpdateModelProvidersMutation();
  const fetchProviderModels = useFetchModelProviderModelsMutation();

  const [formOpen, setFormOpen] = useState(false);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<TranslationKeys | null>(null);
  const [fetchedModels, setFetchedModels] = useState<string[]>([]);
  const [pendingDelete, setPendingDelete] = useState<TModelProvider | null>(null);

  const providers = data?.providers ?? [];

  const openAdd = () => {
    setEditingName(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setFetchedModels([]);
    setFormOpen(true);
  };

  const openEdit = (provider: TModelProvider) => {
    setEditingName(provider.name);
    setForm({
      name: provider.name,
      baseURL: provider.baseURL,
      models: provider.models.join(', '),
      provider: provider.provider,
      apiKey: '',
    });
    setFormError(null);
    setFetchedModels([]);
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditingName(null);
    setFormError(null);
    setFetchedModels([]);
  };

  const selectedModels = splitModels(form.models);

  const changeProvider = (value: string) => {
    const provider: TModelProviderKind = value === 'anthropic' ? 'anthropic' : 'openai';
    setFetchedModels([]);
    setForm((prev) => ({
      ...prev,
      provider,
      baseURL:
        prev.baseURL === '' || prev.baseURL === PROVIDER_DEFAULT_URLS[prev.provider]
          ? PROVIDER_DEFAULT_URLS[provider]
          : prev.baseURL,
    }));
  };

  const fetchCatalog = async () => {
    setFormError(null);
    const baseURL = form.baseURL.trim().replace(/\/+$/, '');
    if (!/^https?:\/\/\S+$/i.test(baseURL)) {
      setFormError('com_ui_model_provider_invalid_url');
      return;
    }
    const apiKey = form.apiKey.trim();
    if (apiKey === '') {
      const original = providers.find((provider) => provider.name === editingName);
      if (original == null || original.baseURL !== baseURL || original.provider !== form.provider) {
        setFormError('com_ui_model_provider_api_key_required');
        return;
      }
    }

    try {
      const result = await fetchProviderModels.mutateAsync({
        ...(editingName != null ? { name: editingName } : {}),
        baseURL,
        provider: form.provider,
        ...(apiKey !== '' ? { apiKey } : {}),
      });
      if (result.models.length === 0) {
        setFetchedModels([]);
        showToast({
          message: localize('com_ui_model_provider_fetch_empty'),
          status: 'warning',
        });
        return;
      }
      setFetchedModels(result.models);
      const retained = splitModels(form.models).filter((model) => result.models.includes(model));
      setForm((prev) => ({ ...prev, models: retained.join(', ') }));
      showToast({
        message: localize('com_ui_model_provider_fetch_success', { 0: result.models.length }),
        status: 'success',
      });
    } catch {
      showToast({ message: localize('com_ui_model_provider_fetch_error'), status: 'error' });
    }
  };

  const removeModel = (model: string) => {
    setForm((prev) => ({
      ...prev,
      models: splitModels(prev.models)
        .filter((item) => item !== model)
        .join(', '),
    }));
  };

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    const name = form.name.trim();
    const baseURL = form.baseURL.trim().replace(/\/+$/, '');
    const models = splitModels(form.models);

    if (name === '') {
      setFormError('com_ui_model_provider_name_required');
      return;
    }
    if (!/^https?:\/\/\S+$/i.test(baseURL)) {
      setFormError('com_ui_model_provider_invalid_url');
      return;
    }
    if (models.length === 0) {
      setFormError('com_ui_model_provider_models_required');
      return;
    }
    const normalized = name.toLowerCase();
    const duplicate = providers.some(
      (provider) =>
        provider.name.toLowerCase() === normalized &&
        (editingName == null || provider.name !== editingName),
    );
    if (duplicate) {
      setFormError('com_ui_model_provider_name_exists');
      return;
    }
    if (editingName != null && form.apiKey.trim() === '') {
      const original = providers.find((provider) => provider.name === editingName);
      if (
        original != null &&
        (original.baseURL !== baseURL || original.provider !== form.provider)
      ) {
        setFormError('com_ui_model_provider_api_key_required');
        return;
      }
    }

    const next: TModelProviderInput = { name, baseURL, models, provider: form.provider };
    const apiKey = form.apiKey.trim();
    if (apiKey !== '') {
      next.apiKey = apiKey;
    }

    const payload = providers.map(toInput);
    const index = editingName == null ? -1 : payload.findIndex((item) => item.name === editingName);
    if (index >= 0) {
      payload[index] = next;
    } else {
      payload.push(next);
    }

    updateProviders.mutate(
      { providers: payload },
      {
        onSuccess: () => {
          showToast({ message: localize('com_ui_model_provider_saved'), status: 'success' });
          closeForm();
        },
        onError: () => {
          setFormError('com_ui_model_provider_save_error');
        },
      },
    );
  };

  const remove = (provider: TModelProvider) => {
    updateProviders.mutate(
      {
        providers: providers.filter((item) => item.name !== provider.name).map(toInput),
      },
      {
        onSuccess: () => {
          setPendingDelete(null);
          showToast({ message: localize('com_ui_model_provider_saved'), status: 'success' });
        },
        onError: () => {
          showToast({ message: localize('com_ui_model_provider_save_error'), status: 'error' });
        },
      },
    );
  };

  const busy = updateProviders.isLoading || fetchProviderModels.isLoading;
  const apiKeyPlaceholder =
    editingName != null
      ? localize('com_ui_model_provider_api_key_keep')
      : localize('com_ui_model_provider_api_key_placeholder');

  const listContent = (() => {
    if (isLoading) {
      return (
        <div className="flex justify-center py-6">
          <Spinner className="size-5" />
        </div>
      );
    }
    if (isError) {
      return (
        <p className="text-text-destructive text-sm">
          {localize('com_ui_model_provider_load_error')}
        </p>
      );
    }
    if (providers.length === 0) {
      return (
        <p className="text-text-secondary border-border-light rounded-xl border border-dashed px-4 py-6 text-center text-sm">
          {localize('com_ui_model_provider_empty')}
        </p>
      );
    }
    return (
      <ul className="space-y-2">
        {providers.map((provider) => (
          <li key={provider.name} className="border-border-light rounded-xl border p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-text-primary truncate text-sm font-medium">{provider.name}</p>
                  <span className="bg-surface-tertiary text-text-secondary rounded-md px-1.5 py-0.5 text-xs">
                    {provider.provider === 'anthropic' ? 'Anthropic' : 'OpenAI'}
                  </span>
                  <span className="bg-surface-tertiary text-text-secondary rounded-md px-1.5 py-0.5 text-xs">
                    {provider.hasApiKey
                      ? localize('com_ui_model_provider_key_set')
                      : localize('com_ui_model_provider_key_missing')}
                  </span>
                </div>
                <p className="text-text-secondary mt-1 truncate text-xs">{provider.baseURL}</p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {provider.models.slice(0, 4).map((model) => (
                    <span
                      key={model}
                      className="bg-surface-tertiary text-text-secondary rounded-md px-1.5 py-0.5 text-xs"
                    >
                      {model}
                    </span>
                  ))}
                  {provider.models.length > 4 && (
                    <span className="text-text-secondary px-1.5 py-0.5 text-xs">
                      +{provider.models.length - 4}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => openEdit(provider)}
                  disabled={busy}
                >
                  {localize('com_ui_edit')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setPendingDelete(provider)}
                  disabled={busy}
                >
                  {localize('com_ui_delete')}
                </Button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    );
  })();

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-text-primary text-base font-medium">
            {localize('com_ui_model_providers')}
          </h3>
          <p className="text-text-secondary mt-1 text-sm">
            {localize('com_ui_model_providers_description')}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={openAdd} disabled={busy}>
          {localize('com_ui_model_provider_add')}
        </Button>
      </div>

      {formOpen && (
        <form
          onSubmit={save}
          className="border-border-light bg-surface-secondary space-y-3 rounded-xl border p-4"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="provider-name">{localize('com_ui_model_provider_name')}</Label>
              <Input
                id="provider-name"
                value={form.name}
                disabled={editingName != null}
                placeholder={localize('com_ui_model_provider_name_placeholder')}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{localize('com_ui_model_provider_kind')}</Label>
              <Dropdown
                value={form.provider}
                onChange={changeProvider}
                options={PROVIDER_OPTIONS}
                ariaLabel={localize('com_ui_model_provider_kind')}
                variant="field"
                testId="provider-kind"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="provider-base-url">{localize('com_ui_model_provider_base_url')}</Label>
            <Input
              id="provider-base-url"
              value={form.baseURL}
              placeholder="https://api.example.com/v1"
              onChange={(event) => setForm({ ...form, baseURL: event.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="provider-api-key">{localize('com_ui_model_provider_api_key')}</Label>
            <Input
              id="provider-api-key"
              type="password"
              autoComplete="off"
              value={form.apiKey}
              placeholder={apiKeyPlaceholder}
              onChange={(event) => setForm({ ...form, apiKey: event.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor={fetchedModels.length > 0 ? undefined : 'provider-models'}>
                {localize('com_ui_model_provider_models')}
              </Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={fetchCatalog}
                disabled={busy}
              >
                {fetchProviderModels.isLoading ? (
                  <Spinner className="size-4" />
                ) : (
                  localize('com_ui_model_provider_fetch_models')
                )}
              </Button>
            </div>
            {fetchedModels.length > 0 ? (
              <div className="space-y-2">
                <MultiSelect
                  items={fetchedModels.map((model) => ({ value: model, label: model }))}
                  selectedValues={selectedModels}
                  setSelectedValues={(values) =>
                    setForm((prev) => ({ ...prev, models: values.join(', ') }))
                  }
                  placeholder={localize('com_ui_model_provider_models_select')}
                  ariaLabel={localize('com_ui_model_provider_models_select')}
                  searchPlaceholder={localize('com_ui_model_provider_models_search')}
                  searchEmptyText={localize('com_ui_settings_no_results')}
                  showSelectedValues
                  showItemCheckboxes
                  disabled={busy}
                  className="w-full"
                  selectClassName="w-full"
                />
                {selectedModels.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {selectedModels.map((model) => (
                      <Chip
                        key={model}
                        onRemove={() => removeModel(model)}
                        removeLabel={localize('com_ui_delete')}
                      >
                        {model}
                      </Chip>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <Input
                id="provider-models"
                value={form.models}
                placeholder={localize('com_ui_model_provider_models_placeholder')}
                onChange={(event) => setForm({ ...form, models: event.target.value })}
              />
            )}
          </div>
          {formError != null && (
            <FieldMessage id="provider-form-error" message={localize(formError)} />
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={closeForm} disabled={busy}>
              {localize('com_ui_cancel')}
            </Button>
            <Button type="submit" variant="submit" size="sm" disabled={busy}>
              {busy ? <Spinner className="size-4" /> : localize('com_ui_save')}
            </Button>
          </div>
        </form>
      )}

      {listContent}

      <p className="text-text-secondary text-xs">{localize('com_ui_model_provider_agent_hint')}</p>

      <AlertDialog
        open={pendingDelete != null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingDelete(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{localize('com_ui_model_provider_delete')}</AlertDialogTitle>
            <AlertDialogDescription>
              {localize('com_ui_model_provider_delete_confirm', {
                0: pendingDelete?.name ?? '',
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{localize('com_ui_cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingDelete != null) {
                  remove(pendingDelete);
                }
              }}
            >
              {localize('com_ui_delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

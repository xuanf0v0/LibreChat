import { useEffect, useState } from 'react';
import { isAxiosError } from 'axios';
import { RotateCcw, Save } from 'lucide-react';
import { Button, useToastContext } from '@librechat/client';
import type { SuperAgentWorkerRecord } from 'librechat-data-provider';
import {
  useDeleteSuperAgentWorkerMutation,
  useUpdateSuperAgentWorkerMutation,
} from '~/data-provider';
import { useLocalize } from '~/hooks';

function splitList(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[\s,]+/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

function WorkerRow({ worker }: { worker: SuperAgentWorkerRecord }) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const update = useUpdateSuperAgentWorkerMutation();
  const reset = useDeleteSuperAgentWorkerMutation();
  const [capabilities, setCapabilities] = useState(worker.capabilities.join(', '));
  const [allowedTools, setAllowedTools] = useState(worker.allowedTools?.join(', ') ?? '');
  const [maxSteps, setMaxSteps] = useState(worker.maxSteps);
  const [timeoutSeconds, setTimeoutSeconds] = useState(Math.round(worker.timeoutMs / 1000));
  const [maxConcurrentRuns, setMaxConcurrentRuns] = useState(worker.maxConcurrentRuns);
  const [maxRunsPerTask, setMaxRunsPerTask] = useState(worker.maxRunsPerTask);
  const [enabled, setEnabled] = useState(worker.enabled);
  const [trinityAgentName, setTrinityAgentName] = useState(worker.trinityAgentName ?? '');

  useEffect(() => {
    setCapabilities(worker.capabilities.join(', '));
    setAllowedTools(worker.allowedTools?.join(', ') ?? '');
    setMaxSteps(worker.maxSteps);
    setTimeoutSeconds(Math.round(worker.timeoutMs / 1000));
    setMaxConcurrentRuns(worker.maxConcurrentRuns);
    setMaxRunsPerTask(worker.maxRunsPerTask);
    setEnabled(worker.enabled);
    setTrinityAgentName(worker.trinityAgentName ?? '');
  }, [worker]);

  const save = () => {
    update.mutate(
      {
        agentId: worker.agentId,
        input: {
          capabilities: splitList(capabilities).slice(0, 20),
          allowedTools: allowedTools.trim() === '' ? null : splitList(allowedTools).slice(0, 50),
          maxSteps,
          timeoutMs: timeoutSeconds * 1000,
          maxConcurrentRuns,
          maxRunsPerTask,
          enabled,
          trinityAgentName: trinityAgentName.trim() === '' ? null : trinityAgentName.trim(),
        },
      },
      {
        onSuccess: () => showToast({ message: localize('com_superagent_worker_saved') }),
        onError: (error) => {
          const message = isAxiosError(error)
            ? (error.response?.data as { message?: string } | undefined)?.message
            : undefined;
          showToast({
            message: message ?? localize('com_superagent_worker_save_error'),
            status: 'error',
          });
        },
      },
    );
  };

  return (
    <details className="border-border-light bg-surface-primary rounded-md border p-2">
      <summary className="text-text-primary flex cursor-pointer items-center gap-2 text-sm">
        <span className="min-w-0 flex-1 truncate">{worker.name}</span>
        {worker.customized && (
          <span className="bg-surface-hover text-text-secondary text-3xs rounded px-1.5 py-0.5">
            {localize('com_superagent_worker_customized')}
          </span>
        )}
        {!worker.enabled && (
          <span className="bg-surface-hover text-text-secondary text-3xs rounded px-1.5 py-0.5">
            {localize('com_superagent_worker_disabled')}
          </span>
        )}
      </summary>
      <div className="mt-2 flex flex-col gap-2">
        <label className="text-text-secondary text-xs">
          {localize('com_superagent_worker_capabilities')}
          <input
            type="text"
            value={capabilities}
            onChange={(event) => setCapabilities(event.target.value)}
            className="border-border-medium bg-surface-primary text-text-primary focus-visible:ring-focus-control mt-1 h-8 w-full rounded-md border px-2 text-sm outline-none focus-visible:ring-2"
          />
        </label>
        <label className="text-text-secondary text-xs">
          {localize('com_superagent_allowed_tools')}
          <input
            type="text"
            value={allowedTools}
            onChange={(event) => setAllowedTools(event.target.value)}
            placeholder={localize('com_superagent_allowed_tools_placeholder')}
            className="border-border-medium bg-surface-primary text-text-primary focus-visible:ring-focus-control mt-1 h-8 w-full rounded-md border px-2 text-sm outline-none focus-visible:ring-2"
          />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-text-secondary text-xs">
            {localize('com_superagent_max_steps')}
            <input
              type="number"
              min={1}
              max={100}
              value={maxSteps}
              onChange={(event) => setMaxSteps(Number(event.target.value) || 1)}
              className="border-border-medium bg-surface-primary text-text-primary focus-visible:ring-focus-control mt-1 h-8 w-full rounded-md border px-2 text-sm outline-none focus-visible:ring-2"
            />
          </label>
          <label className="text-text-secondary text-xs">
            {localize('com_superagent_timeout')}
            <input
              type="number"
              min={1}
              max={600}
              value={timeoutSeconds}
              onChange={(event) => setTimeoutSeconds(Number(event.target.value) || 1)}
              className="border-border-medium bg-surface-primary text-text-primary focus-visible:ring-focus-control mt-1 h-8 w-full rounded-md border px-2 text-sm outline-none focus-visible:ring-2"
            />
          </label>
          <label className="text-text-secondary text-xs">
            {localize('com_superagent_worker_concurrency')}
            <input
              type="number"
              min={1}
              max={10}
              value={maxConcurrentRuns}
              onChange={(event) => setMaxConcurrentRuns(Number(event.target.value) || 1)}
              className="border-border-medium bg-surface-primary text-text-primary focus-visible:ring-focus-control mt-1 h-8 w-full rounded-md border px-2 text-sm outline-none focus-visible:ring-2"
            />
          </label>
          <label className="text-text-secondary text-xs">
            {localize('com_superagent_worker_runs')}
            <input
              type="number"
              min={1}
              max={12}
              value={maxRunsPerTask}
              onChange={(event) => setMaxRunsPerTask(Number(event.target.value) || 1)}
              className="border-border-medium bg-surface-primary text-text-primary focus-visible:ring-focus-control mt-1 h-8 w-full rounded-md border px-2 text-sm outline-none focus-visible:ring-2"
            />
          </label>
        </div>
        <label className="text-text-secondary text-xs">
          {localize('com_superagent_trinity_agent')}
          <input
            type="text"
            value={trinityAgentName}
            onChange={(event) => setTrinityAgentName(event.target.value)}
            placeholder={localize('com_superagent_trinity_agent_placeholder')}
            className="border-border-medium bg-surface-primary text-text-primary focus-visible:ring-focus-control mt-1 h-8 w-full rounded-md border px-2 text-sm outline-none focus-visible:ring-2"
          />
        </label>
        <label className="text-text-secondary flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
          />
          {localize('com_superagent_worker_enabled')}
        </label>
        <div className="flex gap-2">
          <Button type="button" size="sm" disabled={update.isLoading} onClick={save}>
            <Save className="me-1 h-3.5 w-3.5" aria-hidden="true" />
            {localize('com_superagent_worker_save')}
          </Button>
          {worker.customized && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={reset.isLoading}
              onClick={() => reset.mutate(worker.agentId)}
            >
              <RotateCcw className="me-1 h-3.5 w-3.5" aria-hidden="true" />
              {localize('com_superagent_worker_reset')}
            </Button>
          )}
        </div>
      </div>
    </details>
  );
}

export default function WorkerSettings({ workers }: { workers: SuperAgentWorkerRecord[] }) {
  const localize = useLocalize();
  if (workers.length === 0) {
    return null;
  }
  return (
    <section className="border-border-light bg-surface-secondary rounded-xl border p-4">
      <details>
        <summary className="text-text-primary cursor-pointer text-sm font-medium">
          {localize('com_superagent_worker_settings')}
        </summary>
        <div className="mt-2 flex flex-col gap-2">
          {workers.map((worker) => (
            <WorkerRow key={worker.agentId} worker={worker} />
          ))}
        </div>
      </details>
    </section>
  );
}

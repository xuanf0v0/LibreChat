import { useEffect, useMemo, useState } from 'react';
import { isAxiosError } from 'axios';
import { ListChecks, Loader2, Play, Sparkles, X } from 'lucide-react';
import { Button, Textarea, useToastContext } from '@librechat/client';
import type { SuperAgentNode, SuperAgentTask } from 'librechat-data-provider';
import {
  useCreateSuperAgentTaskMutation,
  useCancelSuperAgentTaskMutation,
  useSuperAgentWorkersQuery,
  useSuperAgentTaskQuery,
  useSuperAgentTaskEvents,
  useSuperAgentTasksQuery,
} from '~/data-provider';
import WorkerSettings from './WorkerSettings';
import TrinityStatus from './TrinityStatus';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

const TASK_STATUS_KEYS = {
  planning: 'com_superagent_status_planning',
  pending: 'com_superagent_status_pending',
  running: 'com_superagent_status_running',
  waiting: 'com_superagent_status_waiting',
  completed: 'com_superagent_status_completed',
  failed: 'com_superagent_status_failed',
  cancelled: 'com_superagent_status_cancelled',
} as const;

const NODE_STATUS_KEYS = {
  pending: 'com_superagent_node_pending',
  ready: 'com_superagent_node_ready',
  running: 'com_superagent_node_running',
  completed: 'com_superagent_node_completed',
  failed: 'com_superagent_node_failed',
  blocked: 'com_superagent_node_blocked',
  cancelled: 'com_superagent_node_cancelled',
} as const;

function isActive(status: SuperAgentTask['status']): boolean {
  return (
    status === 'planning' || status === 'pending' || status === 'running' || status === 'waiting'
  );
}

function statusClass(status: string): string {
  if (status === 'completed') {
    return 'border-border-light bg-surface-secondary text-text-primary';
  }
  if (status === 'failed' || status === 'blocked') {
    return 'border-border-light bg-surface-destructive/10 text-text-destructive';
  }
  if (status === 'running') {
    return 'border-border-medium bg-surface-hover text-text-primary';
  }
  if (status === 'cancelled') {
    return 'border-border-light bg-surface-secondary text-text-secondary';
  }
  return 'border-border-light bg-surface-secondary text-text-secondary';
}

function NodeCard({ node }: { node: SuperAgentNode }) {
  const localize = useLocalize();
  let evaluationLabel = localize('com_superagent_evaluation_unavailable');
  if (node.evaluation?.passed != null) {
    evaluationLabel = node.evaluation.passed
      ? localize('com_superagent_evaluation_passed')
      : localize('com_superagent_evaluation_failed');
  }
  return (
    <li className="border-border-light bg-surface-secondary rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-text-primary font-mono text-xs">{node.id}</span>
        <span
          className={cn(
            'rounded-full border px-2 py-0.5 text-xs font-medium',
            statusClass(node.status),
          )}
        >
          {localize(NODE_STATUS_KEYS[node.status])}
        </span>
        <span className="text-text-secondary text-xs">
          {localize('com_superagent_attempts')}: {node.attempts}/{node.maxAttempts}
        </span>
      </div>
      <p className="text-text-primary mt-2 text-sm">{node.goal}</p>
      {node.dependencies.length > 0 && (
        <p className="text-text-secondary mt-1 text-xs">
          {localize('com_superagent_dependencies')}: {node.dependencies.join(', ')}
        </p>
      )}
      {node.acceptanceCriteria.length > 0 && (
        <ul className="text-text-secondary mt-1 list-inside list-disc text-xs">
          {node.acceptanceCriteria.map((criterion) => (
            <li key={criterion}>{criterion}</li>
          ))}
        </ul>
      )}
      {node.evaluation != null && (
        <p className="text-text-secondary mt-2 text-xs">
          {localize('com_superagent_evaluation')}: {evaluationLabel}
          {node.evaluation.reason != null && ` — ${node.evaluation.reason}`}
        </p>
      )}
      {node.status === 'failed' && (
        <p className="text-text-destructive mt-2 text-xs" role="alert">
          {localize('com_superagent_node_failed_hint')}
        </p>
      )}
      {node.result != null && (
        <div className="mt-2">
          <p className="text-text-secondary text-xs font-medium">
            {localize('com_superagent_result')}
          </p>
          <pre className="text-text-primary mt-1 max-h-80 overflow-auto text-sm break-words whitespace-pre-wrap">
            {node.result.content}
          </pre>
        </div>
      )}
    </li>
  );
}

export default function SuperAgentView() {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const { data: workerData } = useSuperAgentWorkersQuery();
  const agents = useMemo(() => workerData?.workers ?? [], [workerData]);
  const { data: listData, isLoading: isListLoading } = useSuperAgentTasksQuery();
  const [goal, setGoal] = useState('');
  const [plannerAgentId, setPlannerAgentId] = useState('');
  const [evaluatorAgentId, setEvaluatorAgentId] = useState('');
  const [workerAgentIds, setWorkerAgentIds] = useState<string[]>([]);
  const [maxWorkers, setMaxWorkers] = useState(3);
  const [allowedToolsText, setAllowedToolsText] = useState('');
  const [disableTools, setDisableTools] = useState(false);
  const [maxSteps, setMaxSteps] = useState(25);
  const [maxTokens, setMaxTokens] = useState(200000);
  const [plannerMaxTokens, setPlannerMaxTokens] = useState(40000);
  const [workerMaxTokens, setWorkerMaxTokens] = useState(160000);
  const [evaluatorMaxTokens, setEvaluatorMaxTokens] = useState(40000);
  const [maxDurationMinutes, setMaxDurationMinutes] = useState(60);
  const [timeoutSeconds, setTimeoutSeconds] = useState(300);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const { data: detail } = useSuperAgentTaskQuery(selectedTaskId);
  const { connected: eventsConnected } = useSuperAgentTaskEvents(selectedTaskId);
  const createTask = useCreateSuperAgentTaskMutation();
  const cancelTask = useCancelSuperAgentTaskMutation();

  const tasks = listData?.tasks ?? [];
  const selectedTask = detail?.task ?? tasks.find((task) => task.id === selectedTaskId);

  let failureLabel = localize('com_superagent_task_failed_hint');
  if (selectedTask?.errorCode === 'budget_tokens_exceeded') {
    failureLabel = localize('com_superagent_budget_tokens');
  } else if (selectedTask?.errorCode === 'budget_duration_exceeded') {
    failureLabel = localize('com_superagent_budget_duration');
  }

  let toolsLabel = localize('com_superagent_all_tools');
  if (selectedTask?.policy.allowedTools != null) {
    toolsLabel =
      selectedTask.policy.allowedTools.length === 0
        ? localize('com_superagent_no_tools')
        : selectedTask.policy.allowedTools.join(', ');
  }

  useEffect(() => {
    if (plannerAgentId === '' && agents.length > 0) {
      setPlannerAgentId(agents[0].agentId);
      setEvaluatorAgentId(agents[0].agentId);
    }
  }, [agents, plannerAgentId]);

  useEffect(() => {
    if (workerAgentIds.length === 0 && agents.length > 0 && plannerAgentId !== '') {
      setWorkerAgentIds(
        agents.filter((agent) => agent.agentId !== plannerAgentId).map((agent) => agent.agentId),
      );
    }
  }, [agents, plannerAgentId, workerAgentIds.length]);

  useEffect(() => {
    setWorkerAgentIds((current) => {
      const available = agents.filter((agent) => agent.agentId !== plannerAgentId);
      return current.filter((id) => available.some((agent) => agent.agentId === id));
    });
  }, [agents, plannerAgentId]);

  const plannerOptions = useMemo(
    () =>
      agents.map((agent) => ({
        id: agent.agentId,
        name: agent.name || agent.agentId,
      })),
    [agents],
  );
  const workerOptions = useMemo(
    () =>
      agents
        .filter((agent) => agent.agentId !== plannerAgentId)
        .map((agent) => ({
          id: agent.agentId,
          name: agent.name || agent.agentId,
          description: agent.description,
          capabilities: agent.capabilities,
        })),
    [agents, plannerAgentId],
  );

  const handleCreate = () => {
    if (goal.trim() === '') {
      showToast({ message: localize('com_superagent_goal_required'), status: 'error' });
      return;
    }
    if (plannerAgentId === '' || workerAgentIds.length === 0) {
      const message =
        plannerAgentId === ''
          ? localize('com_superagent_select_planner')
          : localize('com_superagent_select_workers');
      showToast({ message, status: 'error' });
      return;
    }
    const allowedTools = disableTools
      ? []
      : [
          ...new Set(
            allowedToolsText
              .split(/[\s,]+/)
              .map((tool) => tool.trim())
              .filter(Boolean),
          ),
        ].slice(0, 50);
    createTask.mutate(
      {
        goal: goal.trim(),
        plannerAgentId,
        evaluatorAgentId: evaluatorAgentId || plannerAgentId,
        workerAgentIds,
        maxWorkers,
        policy: {
          ...(allowedTools.length === 0 && !disableTools ? {} : { allowedTools }),
          maxSteps,
          maxTokens,
          plannerMaxTokens,
          workerMaxTokens,
          evaluatorMaxTokens,
          maxDurationMs: maxDurationMinutes * 60_000,
          timeoutMs: timeoutSeconds * 1000,
        },
      },
      {
        onSuccess: ({ task }) => {
          setSelectedTaskId(task.id);
          setGoal('');
        },
        onError: (error) => {
          const message = isAxiosError(error)
            ? (error.response?.data as { message?: string } | undefined)?.message
            : undefined;
          showToast({
            message: message ?? localize('com_superagent_create_error'),
            status: 'error',
          });
        },
      },
    );
  };

  const handleCancel = (taskId: string) => {
    cancelTask.mutate(taskId, {
      onError: () => {
        showToast({ message: localize('com_superagent_cancel_error'), status: 'error' });
      },
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="border-border-light flex items-center gap-3 border-b px-4 py-3 md:px-6">
        <div className="bg-surface-hover text-text-primary flex h-9 w-9 items-center justify-center rounded-lg">
          <Sparkles className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <h1 className="text-text-primary truncate text-base font-semibold">
            {localize('com_superagent_title')}
          </h1>
          <p className="text-text-secondary truncate text-xs">
            {localize('com_superagent_subtitle')}
          </p>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 gap-4 overflow-hidden p-4 md:grid-cols-[380px_minmax(0,1fr)] md:p-6">
        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto">
          <section className="border-border-light bg-surface-secondary rounded-xl border p-4">
            <div className="flex flex-col gap-3">
              <div>
                <label htmlFor="super-agent-goal" className="text-text-primary text-sm font-medium">
                  {localize('com_superagent_goal')}
                </label>
                <Textarea
                  id="super-agent-goal"
                  value={goal}
                  onChange={(event) => setGoal(event.target.value)}
                  placeholder={localize('com_superagent_goal_placeholder')}
                  className="mt-1 min-h-28"
                  maxLength={8000}
                />
              </div>

              <div>
                <label
                  htmlFor="super-agent-planner"
                  className="text-text-primary text-sm font-medium"
                >
                  {localize('com_superagent_planner')}
                </label>
                <select
                  id="super-agent-planner"
                  value={plannerAgentId}
                  onChange={(event) => setPlannerAgentId(event.target.value)}
                  className="border-border-medium bg-surface-primary text-text-primary focus-visible:ring-focus-control mt-1 h-9 w-full rounded-md border px-2 text-sm outline-none focus-visible:ring-2"
                >
                  {plannerOptions.length === 0 && (
                    <option value="">{localize('com_superagent_no_agents')}</option>
                  )}
                  {plannerOptions.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="super-agent-evaluator"
                  className="text-text-primary text-sm font-medium"
                >
                  {localize('com_superagent_evaluator')}
                </label>
                <select
                  id="super-agent-evaluator"
                  value={evaluatorAgentId}
                  onChange={(event) => setEvaluatorAgentId(event.target.value)}
                  className="border-border-medium bg-surface-primary text-text-primary focus-visible:ring-focus-control mt-1 h-9 w-full rounded-md border px-2 text-sm outline-none focus-visible:ring-2"
                >
                  {plannerOptions.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name}
                    </option>
                  ))}
                </select>
              </div>

              <fieldset>
                <legend className="text-text-primary text-sm font-medium">
                  {localize('com_superagent_workers')}
                </legend>
                <div className="border-border-light mt-1 max-h-44 overflow-y-auto rounded-md border p-2">
                  {workerOptions.length === 0 && (
                    <p className="text-text-secondary text-xs">
                      {localize('com_superagent_no_agents')}
                    </p>
                  )}
                  {workerOptions.map((agent) => {
                    const checked = workerAgentIds.includes(agent.id);
                    return (
                      <label
                        key={agent.id}
                        className="hover:bg-surface-hover flex cursor-pointer items-start gap-2 rounded px-1 py-1"
                      >
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          checked={checked}
                          onChange={() =>
                            setWorkerAgentIds((current) =>
                              checked
                                ? current.filter((id) => id !== agent.id)
                                : [...current, agent.id],
                            )
                          }
                        />
                        <span className="min-w-0">
                          <span className="text-text-primary block truncate text-sm">
                            {agent.name}
                          </span>
                          {agent.description != null && agent.description !== '' && (
                            <span className="text-text-secondary block truncate text-xs">
                              {agent.description}
                            </span>
                          )}
                          {(agent.capabilities?.length ?? 0) > 0 && (
                            <span className="mt-1 flex flex-wrap gap-1">
                              {(agent.capabilities ?? []).slice(0, 4).map((capability) => (
                                <span
                                  key={capability}
                                  className="bg-surface-hover text-text-secondary text-3xs rounded px-1.5 py-0.5"
                                >
                                  {capability}
                                </span>
                              ))}
                            </span>
                          )}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>

              <div>
                <label
                  htmlFor="super-agent-concurrency"
                  className="text-text-primary text-sm font-medium"
                >
                  {localize('com_superagent_max_workers')}
                </label>
                <select
                  id="super-agent-concurrency"
                  value={maxWorkers}
                  onChange={(event) => setMaxWorkers(Number(event.target.value))}
                  className="border-border-medium bg-surface-primary text-text-primary focus-visible:ring-focus-control mt-1 h-9 w-full rounded-md border px-2 text-sm outline-none focus-visible:ring-2"
                >
                  {[1, 2, 3, 4, 5].map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </div>

              <details className="border-border-light rounded-md border p-2">
                <summary className="text-text-primary cursor-pointer text-sm font-medium">
                  {localize('com_superagent_policy')}
                </summary>
                <p className="text-text-secondary mt-1 text-xs">
                  {localize('com_superagent_policy_hint')}
                </p>
                <div className="mt-2 flex flex-col gap-2">
                  <div>
                    <label htmlFor="super-agent-tools" className="text-text-primary text-xs">
                      {localize('com_superagent_allowed_tools')}
                    </label>
                    <input
                      id="super-agent-tools"
                      type="text"
                      value={allowedToolsText}
                      onChange={(event) => setAllowedToolsText(event.target.value)}
                      placeholder={localize('com_superagent_allowed_tools_placeholder')}
                      className="border-border-medium bg-surface-primary text-text-primary focus-visible:ring-focus-control mt-1 h-9 w-full rounded-md border px-2 text-sm outline-none focus-visible:ring-2"
                    />
                    <label className="text-text-secondary mt-1 flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={disableTools}
                        onChange={(event) => setDisableTools(event.target.checked)}
                      />
                      {localize('com_superagent_no_tools')}
                    </label>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label htmlFor="super-agent-max-steps" className="text-text-primary text-xs">
                        {localize('com_superagent_max_steps')}
                      </label>
                      <input
                        id="super-agent-max-steps"
                        type="number"
                        min={1}
                        max={100}
                        value={maxSteps}
                        onChange={(event) =>
                          setMaxSteps(Math.min(100, Math.max(1, Number(event.target.value) || 1)))
                        }
                        className="border-border-medium bg-surface-primary text-text-primary focus-visible:ring-focus-control mt-1 h-9 w-full rounded-md border px-2 text-sm outline-none focus-visible:ring-2"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="super-agent-planner-tokens"
                        className="text-text-primary text-xs"
                      >
                        {localize('com_superagent_planner_tokens')}
                      </label>
                      <input
                        id="super-agent-planner-tokens"
                        type="number"
                        min={500}
                        max={1000000}
                        step={500}
                        value={plannerMaxTokens}
                        onChange={(event) =>
                          setPlannerMaxTokens(
                            Math.min(1_000_000, Math.max(500, Number(event.target.value) || 500)),
                          )
                        }
                        className="border-border-medium bg-surface-primary text-text-primary focus-visible:ring-focus-control mt-1 h-9 w-full rounded-md border px-2 text-sm outline-none focus-visible:ring-2"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="super-agent-worker-tokens"
                        className="text-text-primary text-xs"
                      >
                        {localize('com_superagent_worker_tokens')}
                      </label>
                      <input
                        id="super-agent-worker-tokens"
                        type="number"
                        min={500}
                        max={2000000}
                        step={500}
                        value={workerMaxTokens}
                        onChange={(event) =>
                          setWorkerMaxTokens(
                            Math.min(2_000_000, Math.max(500, Number(event.target.value) || 500)),
                          )
                        }
                        className="border-border-medium bg-surface-primary text-text-primary focus-visible:ring-focus-control mt-1 h-9 w-full rounded-md border px-2 text-sm outline-none focus-visible:ring-2"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="super-agent-evaluator-tokens"
                        className="text-text-primary text-xs"
                      >
                        {localize('com_superagent_evaluator_tokens')}
                      </label>
                      <input
                        id="super-agent-evaluator-tokens"
                        type="number"
                        min={500}
                        max={1000000}
                        step={500}
                        value={evaluatorMaxTokens}
                        onChange={(event) =>
                          setEvaluatorMaxTokens(
                            Math.min(1_000_000, Math.max(500, Number(event.target.value) || 500)),
                          )
                        }
                        className="border-border-medium bg-surface-primary text-text-primary focus-visible:ring-focus-control mt-1 h-9 w-full rounded-md border px-2 text-sm outline-none focus-visible:ring-2"
                      />
                    </div>
                    <div>
                      <label htmlFor="super-agent-max-tokens" className="text-text-primary text-xs">
                        {localize('com_superagent_max_tokens')}
                      </label>
                      <input
                        id="super-agent-max-tokens"
                        type="number"
                        min={1000}
                        max={2000000}
                        step={1000}
                        value={maxTokens}
                        onChange={(event) =>
                          setMaxTokens(
                            Math.min(
                              2_000_000,
                              Math.max(1_000, Number(event.target.value) || 1_000),
                            ),
                          )
                        }
                        className="border-border-medium bg-surface-primary text-text-primary focus-visible:ring-focus-control mt-1 h-9 w-full rounded-md border px-2 text-sm outline-none focus-visible:ring-2"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="super-agent-max-duration"
                        className="text-text-primary text-xs"
                      >
                        {localize('com_superagent_max_duration')}
                      </label>
                      <input
                        id="super-agent-max-duration"
                        type="number"
                        min={1}
                        max={1440}
                        value={maxDurationMinutes}
                        onChange={(event) =>
                          setMaxDurationMinutes(
                            Math.min(1_440, Math.max(1, Number(event.target.value) || 1)),
                          )
                        }
                        className="border-border-medium bg-surface-primary text-text-primary focus-visible:ring-focus-control mt-1 h-9 w-full rounded-md border px-2 text-sm outline-none focus-visible:ring-2"
                      />
                    </div>
                    <div>
                      <label htmlFor="super-agent-timeout" className="text-text-primary text-xs">
                        {localize('com_superagent_timeout')}
                      </label>
                      <input
                        id="super-agent-timeout"
                        type="number"
                        min={1}
                        max={600}
                        value={timeoutSeconds}
                        onChange={(event) =>
                          setTimeoutSeconds(
                            Math.min(600, Math.max(1, Number(event.target.value) || 1)),
                          )
                        }
                        className="border-border-medium bg-surface-primary text-text-primary focus-visible:ring-focus-control mt-1 h-9 w-full rounded-md border px-2 text-sm outline-none focus-visible:ring-2"
                      />
                    </div>
                  </div>
                </div>
              </details>

              <Button
                type="button"
                variant="submit"
                className="w-full"
                disabled={createTask.isLoading || agents.length === 0}
                aria-busy={createTask.isLoading}
                onClick={handleCreate}
              >
                {createTask.isLoading ? (
                  <>
                    <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden="true" />
                    {localize('com_superagent_creating')}
                  </>
                ) : (
                  <>
                    <Play className="me-2 h-4 w-4" aria-hidden="true" />
                    {localize('com_superagent_create')}
                  </>
                )}
              </Button>
            </div>
          </section>

          <TrinityStatus />

          <WorkerSettings workers={agents} />

          <section className="border-border-light bg-surface-secondary min-h-0 rounded-xl border">
            <div className="border-border-light flex items-center gap-2 border-b px-4 py-2">
              <ListChecks className="text-text-secondary h-4 w-4" aria-hidden="true" />
              <h2 className="text-text-primary text-sm font-medium">
                {localize('com_superagent_tasks')}
              </h2>
            </div>
            {isListLoading && (
              <div className="flex items-center justify-center p-6">
                <Loader2 className="text-text-secondary h-5 w-5 animate-spin" aria-hidden="true" />
              </div>
            )}
            {!isListLoading && tasks.length === 0 && (
              <div className="p-4">
                <p className="text-text-primary text-sm">{localize('com_superagent_empty')}</p>
                <p className="text-text-secondary mt-1 text-xs">
                  {localize('com_superagent_empty_hint')}
                </p>
              </div>
            )}
            {!isListLoading && tasks.length > 0 && (
              <ul className="max-h-80 overflow-y-auto">
                {tasks.map((task) => (
                  <li key={task.id}>
                    <button
                      type="button"
                      className={cn(
                        'hover:bg-surface-hover border-border-light flex w-full items-start gap-2 border-b px-4 py-3 text-left last:border-b-0',
                        task.id === selectedTaskId && 'bg-surface-hover',
                      )}
                      onClick={() => setSelectedTaskId(task.id)}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="text-text-primary block truncate text-sm">
                          {task.goal}
                        </span>
                        <span className="text-text-secondary mt-1 block text-xs">
                          {new Date(task.createdAt).toLocaleString()}
                        </span>
                      </span>
                      <span
                        className={cn(
                          'shrink-0 rounded-full border px-2 py-0.5 text-xs',
                          statusClass(task.status),
                        )}
                      >
                        {localize(TASK_STATUS_KEYS[task.status])}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <section className="border-border-light bg-surface-primary flex min-h-0 flex-col rounded-xl border">
          {selectedTask == null ? (
            <div className="text-text-secondary flex flex-1 items-center justify-center p-8 text-sm">
              {localize('com_superagent_select_task')}
            </div>
          ) : (
            <>
              <div className="border-border-light flex flex-wrap items-start gap-3 border-b p-4">
                <div className="min-w-0 flex-1">
                  <h2 className="text-text-primary text-base font-semibold break-words">
                    {selectedTask.goal}
                  </h2>
                  <p className="text-text-secondary mt-1 text-xs">
                    {localize('com_superagent_created_at')}:{' '}
                    {new Date(selectedTask.createdAt).toLocaleString()}
                  </p>
                  <p className="text-text-secondary mt-1 text-xs">
                    {localize('com_superagent_allowed_tools')}: {toolsLabel}
                    {' · '}
                    {localize('com_superagent_max_steps')}: {selectedTask.policy.maxSteps}
                    {' · '}
                    {localize('com_superagent_replans')}: {selectedTask.replans}/
                    {selectedTask.policy.maxReplans}
                    {' · '}
                    {localize('com_superagent_timeout')}:{' '}
                    {Math.round(selectedTask.policy.timeoutMs / 1000)}
                    {' · '}
                    {localize('com_superagent_usage')}: {selectedTask.usage.totalTokens}/
                    {selectedTask.policy.maxTokens}
                    {' · '}
                    {localize('com_superagent_usage_roles')}:{' '}
                    {selectedTask.usage.planner?.totalTokens ?? 0}/
                    {selectedTask.usage.worker?.totalTokens ?? 0}/
                    {selectedTask.usage.evaluator?.totalTokens ?? 0}
                    {selectedTask.usage.costUsd == null
                      ? ''
                      : ` · ${localize('com_superagent_cost')} $${selectedTask.usage.costUsd.toFixed(4)}`}
                  </p>
                  {isActive(selectedTask.status) && (
                    <p className="text-text-secondary mt-1 text-xs" aria-live="polite">
                      {eventsConnected
                        ? localize('com_superagent_live_hint')
                        : localize('com_superagent_running_hint')}
                    </p>
                  )}
                  {selectedTask.status === 'failed' && (
                    <p className="text-text-destructive mt-2 text-sm" role="alert">
                      {failureLabel}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      'rounded-full border px-2 py-0.5 text-xs font-medium',
                      statusClass(selectedTask.status),
                    )}
                  >
                    {localize(TASK_STATUS_KEYS[selectedTask.status])}
                  </span>
                  {isActive(selectedTask.status) && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={cancelTask.isLoading}
                      onClick={() => handleCancel(selectedTask.id)}
                    >
                      <X className="me-1 h-4 w-4" aria-hidden="true" />
                      {localize('com_superagent_cancel')}
                    </Button>
                  )}
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                {selectedTask.usageEvents.length > 0 && (
                  <details className="border-border-light bg-surface-secondary mb-3 rounded-md border p-2">
                    <summary className="text-text-primary cursor-pointer text-sm font-medium">
                      {localize('com_superagent_usage_ledger')}
                    </summary>
                    <div className="mt-2 overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="text-text-secondary">
                          <tr>
                            <th className="py-1 pe-2">{localize('com_superagent_usage_role')}</th>
                            <th className="py-1 pe-2">{localize('com_superagent_usage_node')}</th>
                            <th className="py-1 pe-2">{localize('com_superagent_usage_prompt')}</th>
                            <th className="py-1 pe-2">
                              {localize('com_superagent_usage_completion')}
                            </th>
                            <th className="py-1 pe-2">{localize('com_superagent_usage_total')}</th>
                            <th className="py-1 pe-2">{localize('com_superagent_usage_cost')}</th>
                            <th className="py-1 pe-2">
                              {localize('com_superagent_usage_duration')}
                            </th>
                          </tr>
                        </thead>
                        <tbody className="text-text-primary">
                          {[...selectedTask.usageEvents]
                            .sort((a, b) => a.at.localeCompare(b.at))
                            .map((event, index) => (
                              <tr
                                key={`${event.at}-${index}`}
                                className="border-border-light border-t"
                              >
                                <td className="py-1 pe-2">
                                  {localize(`com_superagent_role_${event.role}`)}
                                </td>
                                <td className="py-1 pe-2 font-mono">{event.nodeId}</td>
                                <td className="py-1 pe-2">{event.promptTokens}</td>
                                <td className="py-1 pe-2">{event.completionTokens}</td>
                                <td className="py-1 pe-2">{event.totalTokens}</td>
                                <td className="py-1 pe-2">
                                  {event.costUsd == null ? '—' : `$${event.costUsd.toFixed(4)}`}
                                </td>
                                <td className="py-1 pe-2">
                                  {event.durationMs} {localize('com_superagent_ms')}
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                )}
                {selectedTask.nodes.length === 0 ? (
                  <p className="text-text-secondary text-sm">
                    {localize('com_superagent_no_nodes')}
                  </p>
                ) : (
                  <ol className="flex flex-col gap-3">
                    {selectedTask.nodes.map((node) => (
                      <NodeCard key={node.id} node={node} />
                    ))}
                  </ol>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

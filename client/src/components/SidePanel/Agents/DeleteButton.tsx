import { memo } from 'react';
import { useFormContext } from 'react-hook-form';
import { useRecoilValue, useSetRecoilState } from 'recoil';
import { resolveStatefulCodeEnvironment } from 'librechat-data-provider';
import {
  Label,
  Button,
  OGDialog,
  TrashIcon,
  useToastContext,
  OGDialogTrigger,
  OGDialogTemplate,
} from '@librechat/client';
import type { Agent, AgentCreateParams } from 'librechat-data-provider';
import type { UseMutationResult } from '@tanstack/react-query';
import { useAuthContext, useGetAgentsConfig, useLocalize } from '~/hooks';
import { logger, getDefaultAgentFormValues } from '~/utils';
import { useDeleteAgentMutation } from '~/data-provider';
import { isEphemeralAgent } from '~/common';
import store from '~/store';

function DeleteButton({
  agent_id,
  agentName,
  setCurrentAgentId,
  createMutation,
}: {
  agent_id: string;
  agentName?: string | null;
  setCurrentAgentId: React.Dispatch<React.SetStateAction<string | undefined>>;
  createMutation: UseMutationResult<Agent, Error, AgentCreateParams>;
}) {
  const localize = useLocalize();
  const { user } = useAuthContext();
  const { agentsConfig } = useGetAgentsConfig();
  /** The header action can render in isolation in tests; the app always supplies the form. */
  const reset = useFormContext()?.reset;
  const { showToast } = useToastContext();
  const setConversation = useSetRecoilState(store.conversationByIndex(0));
  const conversationAgentId = useRecoilValue(store.conversationAgentIdByIndex(0));

  const deleteAgent = useDeleteAgentMutation({
    onSuccess: (_, vars, context) => {
      const updatedList = Array.isArray(context) ? (context as Agent[]) : [];
      const nextAgent = updatedList[0];

      showToast({
        message: localize('com_ui_agent_deleted'),
        status: 'success',
      });

      if (createMutation.data?.id ?? '') {
        logger.log('agents', 'resetting createMutation');
        createMutation.reset();
      }

      if (vars.agent_id === conversationAgentId) {
        setConversation((prev) =>
          prev ? { ...prev, model: '', agent_id: nextAgent?.id ?? '' } : prev,
        );
      }

      /* Only the agent open in the builder needs its form cleared; deleting a
       * different agent from a future list action must not discard current edits. */
      if (vars.agent_id !== agent_id) {
        return;
      }

      reset?.(
        getDefaultAgentFormValues(
          resolveStatefulCodeEnvironment(
            user?.personalization?.statefulCodeEnvironment ?? 'user',
            agentsConfig?.statefulCodeSessions?.allowedEnvironments,
          ) ?? 'user',
        ),
      );
      setCurrentAgentId(nextAgent?.id);
    },
    onError: (error) => {
      console.error(error);
      showToast({
        message: localize('com_ui_agent_delete_error'),
        status: 'error',
      });
    },
  });

  if (isEphemeralAgent(agent_id)) {
    return null;
  }

  return (
    <OGDialog>
      <OGDialogTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          aria-label={localize('com_ui_delete_agent')}
          title={localize('com_ui_delete_agent')}
          type="button"
        >
          <div className="text-text-destructive flex w-full items-center justify-center gap-2">
            <TrashIcon />
          </div>
        </Button>
      </OGDialogTrigger>
      <OGDialogTemplate
        title={localize('com_ui_delete_agent')}
        className="max-w-[28.125rem]"
        main={
          <>
            <div className="flex w-full flex-col items-center gap-2">
              <div className="grid w-full items-center gap-2">
                <Label htmlFor="delete-agent" className="text-start text-sm font-medium">
                  {agentName
                    ? localize('com_ui_delete_agent_confirm_named', { name: agentName })
                    : localize('com_ui_delete_agent_confirm')}
                </Label>
                <p className="text-text-secondary text-xs">
                  {localize('com_ui_delete_agent_warning')}
                </p>
              </div>
            </div>
          </>
        }
        selection={{
          selectHandler: () => deleteAgent.mutate({ agent_id }),
          selectClasses:
            'bg-surface-destructive hover:bg-surface-destructive-hover text-text-on-status',
          selectText: localize('com_ui_delete'),
        }}
      />
    </OGDialog>
  );
}

const MemoizedDeleteButton = memo(
  DeleteButton,
  (prevProps, nextProps) =>
    prevProps.agent_id === nextProps.agent_id &&
    prevProps.setCurrentAgentId === nextProps.setCurrentAgentId &&
    prevProps.createMutation.data?.id === nextProps.createMutation.data?.id &&
    prevProps.createMutation.isLoading === nextProps.createMutation.isLoading,
);
MemoizedDeleteButton.displayName = 'DeleteButton';

export default MemoizedDeleteButton;

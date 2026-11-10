import { Globe } from 'lucide-react';
import { Button, Spinner } from '@librechat/client';
import { useWatch, useFormContext } from 'react-hook-form';
import {
  SystemRoles,
  Permissions,
  ResourceType,
  PermissionBits,
  PermissionTypes,
} from 'librechat-data-provider';
import type { AgentForm, AgentPanelProps } from '~/common';
import {
  useLocalize,
  useAuthContext,
  useHasAccess,
  useSelectAgent,
  useResourcePermissions,
} from '~/hooks';
import { GenericGrantAccessDialog } from '~/components/Sharing';
import { useUpdateAgentMutation } from '~/data-provider';
import AdvancedButton from './Advanced/AdvancedButton';
import VersionButton from './Version/VersionButton';
import { Panel, isEphemeralAgent } from '~/common';
import DuplicateAgent from './DuplicateAgent';
import AdminSettings from './AdminSettings';
import DeleteButton from './DeleteButton';

export default function AgentFooter({
  activePanel,
  createMutation,
  updateMutation,
  setActivePanel,
  setCurrentAgentId,
  isAvatarUploading = false,
}: Pick<
  AgentPanelProps,
  'setCurrentAgentId' | 'createMutation' | 'activePanel' | 'setActivePanel'
> & {
  updateMutation: ReturnType<typeof useUpdateAgentMutation>;
  isAvatarUploading?: boolean;
}) {
  const localize = useLocalize();
  const { user } = useAuthContext();
  const { onSelect: onSelectAgent } = useSelectAgent();

  const methods = useFormContext<AgentForm>();

  const { control } = methods;
  const agent = useWatch({ control, name: 'agent' });
  const agent_id = useWatch({ control, name: 'id' });
  const hasAccessToShareAgents = useHasAccess({
    permissionType: PermissionTypes.AGENTS,
    permission: Permissions.SHARE,
  });
  const hasAccessToShareRemoteAgents = useHasAccess({
    permissionType: PermissionTypes.REMOTE_AGENTS,
    permission: Permissions.SHARE,
  });
  const { hasPermission, isLoading: permissionsLoading } = useResourcePermissions(
    ResourceType.AGENT,
    agent?._id || '',
  );
  const { hasPermission: hasRemoteAgentPermission, isLoading: remotePermissionsLoading } =
    useResourcePermissions(ResourceType.REMOTE_AGENT, agent?._id || '');

  const canShareThisAgent = hasPermission(PermissionBits.SHARE);
  const canEditThisAgent = hasPermission(PermissionBits.EDIT);
  const canDeleteThisAgent = hasPermission(PermissionBits.DELETE);
  const canShareRemoteAgent = hasRemoteAgentPermission(PermissionBits.SHARE);
  const isAdmin = user?.role === SystemRoles.ADMIN;
  const isSaving = createMutation.isLoading || updateMutation.isLoading || isAvatarUploading;
  const saveLabel = agent_id ? localize('com_ui_save') : localize('com_ui_create');
  const renderSaveButton = () => (
    <span className="t-icon-swap" data-state={isSaving ? 'b' : 'a'} aria-hidden={false}>
      <span className="t-icon" data-icon="a">
        {saveLabel}
      </span>
      <span className="t-icon" data-icon="b">
        <Spinner className="icon-md" aria-hidden="true" />
      </span>
    </span>
  );

  const showButtons = activePanel === Panel.builder;
  const canSelect = agent_id != null && !isEphemeralAgent(agent_id);

  return (
    <div className="flex w-full flex-col gap-2">
      {showButtons && (
        <div className={`grid gap-2 ${agent_id ? 'grid-cols-2' : 'grid-cols-1'}`}>
          <AdvancedButton setActivePanel={setActivePanel} />
          {!!agent_id && <VersionButton setActivePanel={setActivePanel} />}
        </div>
      )}
      {user?.role === SystemRoles.ADMIN && showButtons && <AdminSettings />}
      {/* Context Button */}
      <div className="flex items-center justify-end gap-1.5">
        {(agent?.author === user?.id || user?.role === SystemRoles.ADMIN || canDeleteThisAgent) &&
          !permissionsLoading && (
            <DeleteButton
              agent_id={agent_id}
              agentName={agent?.name}
              setCurrentAgentId={setCurrentAgentId}
              createMutation={createMutation}
            />
          )}
        {(agent?.author === user?.id || isAdmin || canShareThisAgent) &&
          (hasAccessToShareAgents || isAdmin) &&
          !permissionsLoading && (
            <GenericGrantAccessDialog
              resourceDbId={agent?._id}
              resourceId={agent_id}
              resourceName={agent?.name ?? ''}
              resourceType={ResourceType.AGENT}
            />
          )}
        {(agent?.author === user?.id || user?.role === SystemRoles.ADMIN || canShareRemoteAgent) &&
          hasAccessToShareRemoteAgents &&
          !remotePermissionsLoading &&
          agent?._id && (
            <GenericGrantAccessDialog
              resourceDbId={agent?._id}
              resourceId={agent_id}
              resourceName={agent?.name ?? ''}
              resourceType={ResourceType.REMOTE_AGENT}
            >
              <Button
                variant="outline"
                size="dense"
                type="button"
                aria-label={localize('com_ui_remote_access')}
                title={localize('com_ui_remote_access')}
                className="h-9 w-auto"
              >
                <Globe className="h-4 w-4" aria-hidden="true" />
              </Button>
            </GenericGrantAccessDialog>
          )}
        {(agent?.author === user?.id || user?.role === SystemRoles.ADMIN || canEditThisAgent) &&
          !permissionsLoading && <DuplicateAgent agent_id={agent_id} />}
      </div>
      {canSelect ? (
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant="outline"
            className="h-9"
            disabled={isSaving}
            onClick={() => void onSelectAgent(agent_id)}
            aria-label={localize('com_ui_select_agent')}
          >
            {localize('com_ui_select')}
          </Button>
          <Button
            variant="submit"
            className="h-9"
            type="submit"
            disabled={isSaving}
            aria-busy={isSaving}
            aria-label={saveLabel}
          >
            {renderSaveButton()}
          </Button>
        </div>
      ) : (
        <Button
          variant="submit"
          className="h-9 w-full"
          type="submit"
          disabled={isSaving}
          aria-busy={isSaving}
          aria-label={saveLabel}
        >
          {renderSaveButton()}
        </Button>
      )}
    </div>
  );
}

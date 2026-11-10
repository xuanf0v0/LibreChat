import { useMemo, useState } from 'react';
import { PermissionTypes, Permissions } from 'librechat-data-provider';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@librechat/client';
import type { TranslationKeys } from '~/hooks';
import {
  useAgentCapabilities,
  useGetAgentsConfig,
  useHasAccess,
  useLocalize,
  useMCPServerManager,
} from '~/hooks';
import MCPBuilderPanel from '~/components/SidePanel/MCPBuilder/MCPBuilderPanel';
import { SkillsAccordion } from '~/components/Skills';

type PlazaTab = 'skills' | 'mcp';

/** One rail entry for the two capability catalogs: skills and MCP servers. */
export function SkillPlazaPanel() {
  const localize = useLocalize();
  const hasAccessToSkills = useHasAccess({
    permissionType: PermissionTypes.SKILLS,
    permission: Permissions.USE,
  });
  const hasAccessToUseMCPSettings = useHasAccess({
    permissionType: PermissionTypes.MCP_SERVERS,
    permission: Permissions.USE,
  });
  const hasAccessToCreateMCP = useHasAccess({
    permissionType: PermissionTypes.MCP_SERVERS,
    permission: Permissions.CREATE,
  });
  const { availableMCPServers } = useMCPServerManager();
  const { agentsConfig } = useGetAgentsConfig();
  const { skillsEnabled } = useAgentCapabilities(agentsConfig?.capabilities);

  const tabs = useMemo(() => {
    const next: Array<{ id: PlazaTab; label: TranslationKeys }> = [];
    if (hasAccessToSkills && skillsEnabled) {
      next.push({ id: 'skills', label: 'com_ui_skills' });
    }
    if (
      (hasAccessToUseMCPSettings &&
        availableMCPServers != null &&
        availableMCPServers.length > 0) ||
      hasAccessToCreateMCP
    ) {
      next.push({ id: 'mcp', label: 'com_ui_mcp_servers' });
    }
    return next;
  }, [
    availableMCPServers,
    hasAccessToCreateMCP,
    hasAccessToSkills,
    hasAccessToUseMCPSettings,
    skillsEnabled,
  ]);

  const [requestedTab, setRequestedTab] = useState<PlazaTab>('skills');
  const activeTab = tabs.some((tab) => tab.id === requestedTab) ? requestedTab : tabs[0]?.id;

  if (tabs.length === 0 || activeTab == null) {
    return null;
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden pt-2">
      <Tabs
        value={activeTab}
        onValueChange={(value) => setRequestedTab(value as PlazaTab)}
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        <TabsList
          variant="pills"
          aria-label={localize('com_ui_skill_plaza')}
          className="mx-3 mb-2 shrink-0"
        >
          {tabs.map((tab) => (
            <TabsTrigger key={tab.id} value={tab.id} variant="pills">
              {localize(tab.label)}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value={activeTab} variant="flush" className="min-h-0 flex-1 overflow-hidden">
          {activeTab === 'skills' ? <SkillsAccordion /> : <MCPBuilderPanel />}
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default SkillPlazaPanel;

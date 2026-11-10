/* eslint-disable i18next/no-literal-string */
import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import { SkillPlazaPanel } from '../SkillPlazaPanel';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
  useHasAccess: () => true,
  useAgentCapabilities: () => ({ skillsEnabled: true }),
  useGetAgentsConfig: () => ({ agentsConfig: {} }),
  useMCPServerManager: () => ({ availableMCPServers: [{ serverName: 'warehouse' }] }),
}));

jest.mock('~/components/Skills', () => ({
  SkillsAccordion: () => <div>skills-panel</div>,
}));

jest.mock('~/components/SidePanel/MCPBuilder/MCPBuilderPanel', () => ({
  __esModule: true,
  default: () => <div>mcp-panel</div>,
}));

describe('SkillPlazaPanel', () => {
  test('switches between the skills and MCP tabs', async () => {
    render(<SkillPlazaPanel />);

    expect(screen.getByText('skills-panel')).toBeInTheDocument();
    expect(screen.queryByText('mcp-panel')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'com_ui_mcp_servers' }));

    expect(screen.getByText('mcp-panel')).toBeInTheDocument();
    expect(screen.queryByText('skills-panel')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'com_ui_mcp_servers' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });
});

import { screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { fakeApi, renderWithWorkspace } from '../../test/harness.tsx';
import { McpConnections } from './mcp-connections.tsx';

it('disconnects database access for only the selected client', async () => {
  const clientId = 'd851d49f-5b15-4bfd-9a2d-63b0a76545fa';
  const api = fakeApi({ mcpConnections: async () => [{ clientId, name: 'Codex', spaceId: 'space', expiresAt: '2026-12-01T00:00:00Z' }], mcpRevokeClient: async () => ({ ok: true }) });
  renderWithWorkspace(<McpConnections />, api);
  await userEvent.setup().click(await screen.findByRole('button', { name: 'Disconnect' }));
  expect(api.mcpRevokeClient).toHaveBeenCalledWith(clientId);
});

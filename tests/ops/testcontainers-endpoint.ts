import { getContainerRuntimeClient } from 'testcontainers';

// Testcontainers 12.1.0 tries tc.host before DOCKER_HOST, and when an endpoint
// fails it logs at debug level and moves on to /var/run/docker.sock and other
// sockets. Its client does not record the endpoint it chose, so this reads the
// dockerode modem that dials every request of the client it caches.
export async function assertTestcontainersDialsDockerHost(
  dockerHost: string | undefined,
): Promise<void> {
  if (dockerHost === undefined) return;
  // Refused before resolving, so an ssh:// or tcp:// endpoint is never dialed.
  if (!dockerHost.startsWith('unix:///')) {
    throw new Error(
      `cannot verify DOCKER_HOST "${dockerHost}": only a unix:///absolute/path socket is checked`,
    );
  }
  const client = await getContainerRuntimeClient();
  const dialed = dialedEndpoint(client.container.dockerode.modem);
  if (dialed !== dockerHost) {
    throw new Error(`Testcontainers dials "${dialed}", not DOCKER_HOST "${dockerHost}"`);
  }
}

// docker-modem dials socketPath when set, otherwise protocol://host:port.
function dialedEndpoint(modem: object): string {
  const socketPath = 'socketPath' in modem ? modem.socketPath : undefined;
  if (typeof socketPath === 'string') return `unix://${socketPath}`;
  const host = 'host' in modem ? modem.host : undefined;
  if (typeof host !== 'string' || host === '') return 'an endpoint it does not expose';
  const protocol = 'protocol' in modem ? String(modem.protocol) : 'unknown';
  const port = 'port' in modem ? String(modem.port) : 'unknown';
  return `${protocol}://${host}:${port}`;
}

import { resolve } from 'node:path';
import { createRelay } from './relayServer';

// Configured by the systemd unit the install script writes
// (`src-tauri/src/deploy/install.sh`).
const dmKey = process.env.DMTOOL_DM_KEY ?? '';
const port = Number(process.env.DMTOOL_RELAY_PORT ?? '7718');
const host = process.env.DMTOOL_RELAY_HOST ?? '127.0.0.1';
const dataDir = resolve(process.env.DMTOOL_RELAY_DATA ?? 'relay-data');

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error(`DMTOOL_RELAY_PORT is not a port: ${process.env.DMTOOL_RELAY_PORT}`);
}
const relay = await createRelay({ dmKey, dataDir });
relay.server.listen(port, host, () => console.log(`DM tool relay on http://${host}:${port}, data in ${dataDir}`));
const stop = () => {
  relay.close().then(
    () => process.exit(0),
    (error: unknown) => {
      console.error('Relay shutdown failed:', error);
      process.exit(1);
    },
  );
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);

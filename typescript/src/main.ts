/** Entry point for the Kerb TEE extension. */

import { Server } from './base/server.js';
import { VERSION } from './app/config.js';
import { register, reportState, setSignPort } from './app/handlers.js';
import { readSupervisorConfig, startEngineSupervisor } from './app/supervisor.js';

const extPort = process.env.EXTENSION_PORT ?? '8080';
const signPort = process.env.SIGN_PORT ?? '9090';

setSignPort(signPort);

// The execution engine only starts when it is fully configured. Without it the
// extension still serves instructions and provisions mandates: it simply does
// not trade, which is the right behaviour for a node that has no XRPL endpoint
// or counter-currency issuer configured.
const supervisorConfig = readSupervisorConfig();
if (supervisorConfig === null) {
  console.log(
    '[main] execution engine disabled: set CHAIN_URL, INSTRUCTION_SENDER, ' +
      'XRPL_ENDPOINT, KERB_COUNTER_CURRENCY and KERB_COUNTER_ISSUER to enable it',
  );
} else {
  startEngineSupervisor(supervisorConfig);
  console.log(`[main] execution engine watching ${supervisorConfig.xrplEndpoint}`);
}

const srv = new Server(extPort, signPort, VERSION, register, reportState);
srv.listenAndServe();

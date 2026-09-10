import { createWorkerHandler, runtimeDependencies } from './handler.js';

const handler = createWorkerHandler(runtimeDependencies);

export default {
  fetch(request, environment): Promise<Response> {
    return handler.fetch(request, environment);
  },
} satisfies ExportedHandler<Env>;

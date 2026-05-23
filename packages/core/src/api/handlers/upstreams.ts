import { runtimeState } from '../../worker';
import { logger } from '../../logger';
import { loadConfig } from '../../config';

export class EndpointControlHandler {
  static async toggle(routePath: string, endpointIndex: number, disabled: boolean): Promise<Response> {
    const config = await loadConfig();
    const route = config.routes.find((candidate) => candidate.path === routePath);
    const service = config.services?.find((candidate) => candidate.name === routePath || candidate.name === route?.service);
    const state_key = service?.name ?? routePath;
    const routeState = runtimeState.get(state_key);

    if (!routeState) {
      return new Response(
        JSON.stringify({ error: `Route or service "${routePath}" not found or failover not enabled.` }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (endpointIndex < 0 || endpointIndex >= routeState.upstreams.length) {
      return new Response(
        JSON.stringify({ error: `Endpoint index ${endpointIndex} out of bounds for route or service "${routePath}" (has ${routeState.upstreams.length} endpoints)` }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const endpoint = routeState.upstreams[endpointIndex];

    endpoint.is_disabled = disabled;

    if (!disabled) {
      endpoint.consecutive_failures = 0;
      endpoint.consecutive_successes = 0;
    }

    logger.info(
      {
        route_path: routePath,
        state_key,
        index: endpointIndex,
        target: endpoint.target,
        disabled,
      },
      disabled ? 'Endpoint manually disabled via API' : 'Endpoint manually enabled via API'
    );

    return new Response(
      JSON.stringify({
        success: true,
        endpoint: {
          index: endpointIndex,
          target: endpoint.target,
          status: endpoint.status,
          is_disabled: endpoint.is_disabled,
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

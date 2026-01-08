import { runtimeState } from '../../worker';
import { logger } from '../../logger';

export class UpstreamControlHandler {
  static toggle(routePath: string, upstreamTarget: string, disabled: boolean): Response {
    const routeState = runtimeState.get(routePath);

    if (!routeState) {
      return new Response(
        JSON.stringify({ error: `Route "${routePath}" not found or failover not enabled.` }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const upstream = routeState.upstreams.find((u) => u.target === upstreamTarget);
    if (!upstream) {
      return new Response(
        JSON.stringify({ error: `Upstream "${upstreamTarget}" not found for route "${routePath}"` }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    upstream.disabled = disabled;

    if (!disabled) {
      upstream.consecutiveFailures = 0;
      upstream.consecutiveSuccesses = 0;
    }

    logger.info(
      {
        routePath,
        target: upstreamTarget,
        disabled,
      },
      disabled ? 'Upstream manually disabled via API' : 'Upstream manually enabled via API'
    );

    return new Response(
      JSON.stringify({
        success: true,
        upstream: {
          target: upstream.target,
          status: upstream.status,
          disabled: upstream.disabled,
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

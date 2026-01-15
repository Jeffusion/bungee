import { runtimeState } from '../../worker';
import { logger } from '../../logger';

export class UpstreamControlHandler {
  /**
   * Toggle upstream enabled/disabled state by index
   * @param routePath - Route path
   * @param upstreamIndex - Index of upstream in the upstreams array
   * @param disabled - Whether to disable the upstream
   */
  static toggle(routePath: string, upstreamIndex: number, disabled: boolean): Response {
    const routeState = runtimeState.get(routePath);

    if (!routeState) {
      return new Response(
        JSON.stringify({ error: `Route "${routePath}" not found or failover not enabled.` }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Validate index bounds
    if (upstreamIndex < 0 || upstreamIndex >= routeState.upstreams.length) {
      return new Response(
        JSON.stringify({ error: `Upstream index ${upstreamIndex} out of bounds for route "${routePath}" (has ${routeState.upstreams.length} upstreams)` }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const upstream = routeState.upstreams[upstreamIndex];

    upstream.disabled = disabled;

    if (!disabled) {
      upstream.consecutiveFailures = 0;
      upstream.consecutiveSuccesses = 0;
    }

    logger.info(
      {
        routePath,
        index: upstreamIndex,
        target: upstream.target,
        disabled,
      },
      disabled ? 'Upstream manually disabled via API' : 'Upstream manually enabled via API'
    );

    return new Response(
      JSON.stringify({
        success: true,
        upstream: {
          index: upstreamIndex,
          target: upstream.target,
          status: upstream.status,
          disabled: upstream.disabled,
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

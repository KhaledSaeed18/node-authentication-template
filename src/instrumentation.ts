// OpenTelemetry bootstrap. Loaded before the app with `node --import ./dist/instrumentation.js`
// so the instrumented modules (http, express, pg, pino) are patched as they load.
// Does nothing unless OTEL_EXPORTER_OTLP_ENDPOINT is set; the SDK reads the standard
// OTEL_* variables (service name, headers, sampling, ...).
import { register } from 'node:module';

if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    // ESM modules can only be patched through a loader hook
    register('@opentelemetry/instrumentation/hook.mjs', import.meta.url);

    const { NodeSDK } = await import('@opentelemetry/sdk-node');
    const { getNodeAutoInstrumentations } = await import('@opentelemetry/auto-instrumentations-node');
    const { OTLPTraceExporter } = await import('@opentelemetry/exporter-trace-otlp-http');
    const { OTLPMetricExporter } = await import('@opentelemetry/exporter-metrics-otlp-http');
    const { PeriodicExportingMetricReader } = await import('@opentelemetry/sdk-metrics');
    const { PrismaInstrumentation } = await import('@prisma/instrumentation');
    const { ParentBasedSampler, SamplingDecision } = await import('@opentelemetry/sdk-trace-base');

    // A database span without a parent comes from background work (outbox polling,
    // key cache refreshes, metric callbacks), not from a request. Those would create a
    // new trace every second, so they're dropped; database spans inside a request or an
    // outbox job are kept as usual.
    const dropBackgroundQueries = {
        shouldSample: (_context: unknown, _traceId: string, spanName: string) => ({
            decision: /^(prisma:|pg[.:])/.test(spanName)
                ? SamplingDecision.NOT_RECORD
                : SamplingDecision.RECORD_AND_SAMPLED,
        }),
        toString: () => 'DropBackgroundQueries',
    };

    const sdk = new NodeSDK({
        serviceName: process.env.OTEL_SERVICE_NAME ?? 'node-auth',
        sampler: new ParentBasedSampler({ root: dropBackgroundQueries }),
        traceExporter: new OTLPTraceExporter(),
        metricReaders: [
            new PeriodicExportingMetricReader({ exporter: new OTLPMetricExporter(), exportIntervalMillis: 15_000 }),
        ],
        instrumentations: [
            getNodeAutoInstrumentations({
                // Noisy and not useful here
                '@opentelemetry/instrumentation-fs': { enabled: false },
                '@opentelemetry/instrumentation-dns': { enabled: false },
                '@opentelemetry/instrumentation-net': { enabled: false },
            }),
            new PrismaInstrumentation(),
        ],
    });

    sdk.start();

    // Flush what's buffered before the process exits
    for (const signal of ['SIGTERM', 'SIGINT'] as const) {
        process.once(signal, () => {
            void sdk.shutdown();
        });
    }
}

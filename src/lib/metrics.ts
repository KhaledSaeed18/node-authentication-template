import { metrics } from '@opentelemetry/api';

// Business metrics. Instruments are looked up at call time from the global meter
// provider, so they are no-ops when telemetry is off and pick up whatever provider is
// registered (including the in-memory one used by the tests).
const meter = () => metrics.getMeter('node-auth');

type SigninMethod = 'password' | 'two_factor' | 'passkey';
type SigninResult = 'success' | 'failure' | 'locked' | 'second_factor_required';

export const recordSignin = (method: SigninMethod, result: SigninResult) => {
    meter()
        .createCounter('auth.signin.attempts', { description: 'Sign-in attempts by method and result' })
        .add(1, { method, result });
};

export const recordAccountLocked = () => {
    meter().createCounter('auth.account.lockouts', { description: 'Accounts locked after repeated failures' }).add(1);
};

export const recordRefreshTokenReuse = () => {
    meter()
        .createCounter('auth.refresh_token.reuse', { description: 'Reused refresh tokens (sessions revoked)' })
        .add(1);
};

export const recordOutboxJob = (type: string, outcome: 'done' | 'retry' | 'failed') => {
    meter().createCounter('outbox.jobs.processed', { description: 'Outbox jobs handled by outcome' }).add(1, { type, outcome });
};

// Jobs waiting to be delivered, read when metrics are exported
export const observeOutboxBacklog = (countPending: () => Promise<number>) => {
    meter()
        .createObservableGauge('outbox.jobs.pending', { description: 'Outbox jobs waiting to be delivered' })
        .addCallback(async (result) => {
            result.observe(await countPending());
        });
};

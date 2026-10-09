import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { hashPassword } from '../src/shared/utils/password.js';
import { API, createTestApp, resetDatabase, strongPassword } from './helpers.js';

const { app } = createTestApp();

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

describe('data export', () => {
    it('returns everything stored about the user, without any secret', async () => {
        const user = await prisma.user.create({
            data: {
                firstName: 'Jane',
                lastName: 'Doe',
                email: 'jane@acme.io',
                password: await hashPassword(strongPassword),
                isVerified: true,
                totpSecret: 'v1:secret-material',
            },
        });
        await request(app).post(`${API}/auth/signin`).send({ email: 'jane@acme.io', password: 'Wr0ng$Password' });
        const { body } = await request(app).post(`${API}/auth/signin`).send({ email: 'jane@acme.io', password: strongPassword });
        await prisma.recoveryCode.create({ data: { userId: user.id, codeHash: 'hmac-of-a-code' } });

        const res = await request(app)
            .get(`${API}/users/me/export`)
            .set('Authorization', `Bearer ${body.data.accessToken}`)
            .expect(200);

        expect(res.headers['content-disposition']).toContain('account-data.json');
        expect(res.body).toMatchObject({ id: user.id, email: 'jane@acme.io', recoveryCodes: { total: 1, unused: 1 } });
        expect(res.body.loginHistory).toHaveLength(2);
        expect(res.body.sessions).toHaveLength(1);

        const raw = JSON.stringify(res.body);
        for (const secret of [user.password, 'v1:secret-material', 'hmac-of-a-code', 'tokenHash', 'totpSecret']) {
            expect(raw).not.toContain(secret);
        }
    });
});

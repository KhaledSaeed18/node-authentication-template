import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { hashPassword } from '../src/shared/utils/password.js';
import { API, InMemoryMailer, resetDatabase, strongPassword } from './helpers.js';

const app = createApp({ mailer: new InMemoryMailer() });

const createUser = async (email: string, role: 'USER' | 'ADMIN' = 'USER') =>
    prisma.user.create({
        data: { firstName: 'Jane', lastName: 'Doe', email, role, password: await hashPassword(strongPassword), isVerified: true },
    });

const tokenFor = async (email: string) => {
    const res = await request(app).post(`${API}/auth/signin`).send({ email, password: strongPassword }).expect(200);
    return `Bearer ${res.body.data.accessToken}`;
};

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

describe('profile', () => {
    it('returns the current user without sensitive fields', async () => {
        await createUser('jane@acme.io');
        const res = await request(app).get(`${API}/users/me`).set('Authorization', await tokenFor('jane@acme.io')).expect(200);

        expect(res.body.data.user).toMatchObject({ email: 'jane@acme.io', role: 'USER' });
        expect(res.body.data.user).not.toHaveProperty('password');
        expect(res.body.data.user).not.toHaveProperty('totpSecret');
    });

    it('updates the name', async () => {
        await createUser('jane@acme.io');
        const res = await request(app)
            .patch(`${API}/users/me`)
            .set('Authorization', await tokenFor('jane@acme.io'))
            .send({ firstName: 'Janet', email: 'hacker@evil.io', role: 'ADMIN' })
            .expect(200);

        // Only the name can change through this endpoint
        expect(res.body.data.user).toMatchObject({ firstName: 'Janet', email: 'jane@acme.io', role: 'USER' });
    });

    it('requires at least one field', async () => {
        await createUser('jane@acme.io');
        await request(app).patch(`${API}/users/me`).set('Authorization', await tokenFor('jane@acme.io')).send({}).expect(400);
    });

    it('requires authentication', async () => {
        await request(app).get(`${API}/users/me`).expect(401);
    });
});

describe('admin user list', () => {
    it('is forbidden for regular users', async () => {
        await createUser('jane@acme.io');
        const res = await request(app).get(`${API}/users`).set('Authorization', await tokenFor('jane@acme.io')).expect(403);
        expect(res.body.code).toBe('FORBIDDEN');
    });

    it('lists users for admins, paginated', async () => {
        await createUser('admin@acme.io', 'ADMIN');
        for (const name of ['a', 'b', 'c']) await createUser(`${name}@acme.io`);
        const admin = await tokenFor('admin@acme.io');

        const first = await request(app).get(`${API}/users`).query({ limit: 3 }).set('Authorization', admin).expect(200);
        expect(first.body.data.users).toHaveLength(3);
        expect(first.body.data.users[0]).not.toHaveProperty('password');

        const second = await request(app)
            .get(`${API}/users`)
            .query({ limit: 3, cursor: first.body.data.nextCursor })
            .set('Authorization', admin)
            .expect(200);
        expect(second.body.data.users).toHaveLength(1);
        expect(second.body.data.nextCursor).toBeNull();
    });
});

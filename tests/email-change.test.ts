import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { hashPassword } from '../src/shared/utils/password.js';
import { API, createTestApp, resetDatabase, strongPassword } from './helpers.js';

const { app, mailer, worker } = createTestApp();

const createUser = async (email: string) =>
    prisma.user.create({
        data: { firstName: 'Jane', lastName: 'Doe', email, password: await hashPassword(strongPassword), isVerified: true },
    });

const signin = async (email: string, password = strongPassword) => {
    const { body } = await request(app).post(`${API}/auth/signin`).send({ email, password });
    return `Bearer ${body.data?.accessToken}`;
};

const requestChange = (bearer: string, newEmail: string, password = strongPassword) =>
    request(app).post(`${API}/users/me/email`).set('Authorization', bearer).send({ newEmail, password });

beforeEach(async () => {
    mailer.clear();
    await resetDatabase();
});
afterAll(() => prisma.$disconnect());

describe('email change', () => {
    it('switches the address with the code sent to it, and tells the old address', async () => {
        await createUser('jane@acme.io');
        const laptop = await signin('jane@acme.io');
        const phone = await signin('jane@acme.io');

        await requestChange(laptop, 'Jane.New@Acme.io').expect(200);
        const code = await mailer.lastCode('jane.new@acme.io');
        // The code went to the new address only
        expect(mailer.sent.filter((m) => m.to === 'jane@acme.io')).toHaveLength(0);

        const res = await request(app)
            .post(`${API}/users/me/email/confirm`)
            .set('Authorization', laptop)
            .send({ code })
            .expect(200);
        expect(res.body.data.email).toBe('jane.new@acme.io');

        await worker.drain();
        expect(mailer.sent.map((m) => [m.to, m.content.subject])).toContainEqual([
            'jane@acme.io',
            'Node Auth: the email address of your account was changed to jane.new@acme.io',
        ]);

        // Signs in with the new address only; other sessions were signed out
        await request(app).post(`${API}/auth/signin`).send({ email: 'jane.new@acme.io', password: strongPassword }).expect(200);
        await request(app).post(`${API}/auth/signin`).send({ email: 'jane@acme.io', password: strongPassword }).expect(401);
        await request(app).get(`${API}/users/me`).set('Authorization', phone).expect(401);
        await request(app).get(`${API}/users/me`).set('Authorization', laptop).expect(200);
        expect(await prisma.securityEvent.count({ where: { type: 'email.changed' } })).toBe(1);
    });

    it('requires the password', async () => {
        await createUser('jane@acme.io');
        const res = await requestChange(await signin('jane@acme.io'), 'new@acme.io', 'Wr0ng$Password').expect(400);
        expect(res.body.code).toBe('INVALID_PASSWORD');
    });

    it("doesn't reveal that an address is taken, and warns its owner instead", async () => {
        await createUser('jane@acme.io');
        await createUser('sam@acme.io');
        const jane = await signin('jane@acme.io');

        const taken = await requestChange(jane, 'sam@acme.io').expect(200);
        const free = await requestChange(jane, 'free@acme.io').expect(200);
        expect(taken.body).toEqual(free.body);

        await worker.drain();
        const toSam = mailer.sent.filter((m) => m.to === 'sam@acme.io');
        expect(toSam).toHaveLength(1);
        expect(toSam[0].content.text).not.toMatch(/\b\d{6}\b/);
    });

    it('rejects a wrong code and leaves the address unchanged', async () => {
        await createUser('jane@acme.io');
        const bearer = await signin('jane@acme.io');
        await requestChange(bearer, 'new@acme.io').expect(200);
        const code = await mailer.lastCode('new@acme.io');

        await request(app)
            .post(`${API}/users/me/email/confirm`)
            .set('Authorization', bearer)
            .send({ code: code === '000000' ? '111111' : '000000' })
            .expect(400);
        expect((await prisma.user.findFirstOrThrow()).email).toBe('jane@acme.io');
    });
});

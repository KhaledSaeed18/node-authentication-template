import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { hashPassword, verifyPassword } from '../src/shared/utils/password.js';
import { API, InMemoryMailer, resetDatabase, strongPassword } from './helpers.js';

const app = createApp({ mailer: new InMemoryMailer() });

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

describe('password hashing', () => {
    it('hashes with Argon2id', async () => {
        const hashed = await hashPassword(strongPassword);

        expect(hashed).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
        expect(await verifyPassword(hashed, strongPassword)).toEqual({ valid: true, needsRehash: false });
        expect((await verifyPassword(hashed, 'wrong')).valid).toBe(false);
    });

    it('accepts legacy bcrypt hashes and upgrades them on signin', async () => {
        const user = await prisma.user.create({
            data: {
                firstName: 'Old',
                lastName: 'Timer',
                email: 'old@acme.io',
                password: await bcrypt.hash(strongPassword, 10),
                isVerified: true,
            },
        });

        await request(app).post(`${API}/auth/signin`).send({ email: user.email, password: strongPassword }).expect(200);

        const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
        expect(updated.password).toMatch(/^\$argon2id\$/);
        await request(app).post(`${API}/auth/signin`).send({ email: user.email, password: strongPassword }).expect(200);
    });
});

import nodemailer from "nodemailer";
import { env } from "../config/env.js";

// Gmail over OAuth2. Nodemailer fetches and refreshes the access token
// from the refresh token by itself, so no Google SDK is needed.
const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        type: "OAuth2",
        user: env.USER_EMAIL,
        clientId: env.CLIENT_ID,
        clientSecret: env.CLIENT_SECRET,
        refreshToken: env.REFRESH_TOKEN,
    },
});

export default transporter;

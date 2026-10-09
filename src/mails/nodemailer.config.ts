import nodemailer from "nodemailer";

// Gmail over OAuth2. Nodemailer fetches and refreshes the access token
// from the refresh token by itself, so no Google SDK is needed.
const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        type: "OAuth2",
        user: process.env.USER_EMAIL,
        clientId: process.env.CLIENT_ID,
        clientSecret: process.env.CLIENT_SECRET,
        refreshToken: process.env.REFRESH_TOKEN,
    },
});

export default transporter;

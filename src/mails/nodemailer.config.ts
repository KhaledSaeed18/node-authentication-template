import nodemailer from "nodemailer";
import dotenv from "dotenv";
import { google } from "googleapis";
import SMTPTransport from "nodemailer/lib/smtp-transport";

dotenv.config();

const OAuth2 = google.auth.OAuth2;

const oauth2Client = new OAuth2(
    process.env.CLIENT_ID,
    process.env.CLIENT_SECRET,
    process.env.REDIRECT_URI
);

oauth2Client.setCredentials({
    refresh_token: process.env.REFRESH_TOKEN,
});

async function createTransporter() {
    const accessToken = await oauth2Client.getAccessToken();

    const transportOptions: SMTPTransport.Options = {
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        auth: {
            type: "OAuth2",
            user: process.env.USER_EMAIL,
            clientId: process.env.CLIENT_ID,
            clientSecret: process.env.CLIENT_SECRET,
            refreshToken: process.env.REFRESH_TOKEN,
            accessToken: accessToken.token!,
        },
    };

    const transporter = nodemailer.createTransport(transportOptions);

    return transporter;
}

export default createTransporter;
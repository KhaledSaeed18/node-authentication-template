import { PASSWORD_RESET_EMAIL_TEMPLATE, VERIFICATION_EMAIL_TEMPLATE } from "./templates.js";
import transporter from "./transporter.js";
import { env } from "../config/env.js";

// Send verification email
export const sendVerificationEmail = async (email: string, otpCode: string, name: string) => {
    const recipient = [{ email }];

    try {
        const mailOptions = {
            from: `<${env.USER_EMAIL}>`,
            to: recipient[0].email,
            subject: "Verify your email",
            html: VERIFICATION_EMAIL_TEMPLATE
                .replace("{verificationCode}", otpCode)
                .replace("{name}", name),
        };

        await transporter.sendMail(mailOptions);
    } catch (error) {
        throw new Error(`Error sending verification email: ${error}`, { cause: error });
    }
};

// Send password reset email
export const sendPasswordResetEmail = async (email: string, resetCode: string, name: string) => {
    const recipient = [{ email }];

    try {
        const mailOptions = {
            from: `<${env.USER_EMAIL}>`,
            to: recipient[0].email,
            subject: "Reset your password",
            html: PASSWORD_RESET_EMAIL_TEMPLATE
                .replace("{resetCode}", resetCode)
                .replace("{name}", name),
        };

        await transporter.sendMail(mailOptions);
    } catch (error) {
        throw new Error(`Error sending password reset email: ${error}`, { cause: error });
    }
};
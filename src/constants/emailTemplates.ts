// Verification Email Template
export const VERIFICATION_EMAIL_TEMPLATE = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="color-scheme" content="light">
    <meta name="supported-color-schemes" content="light">
    <title>Verify Your Email Address</title>
</head>
<body
    style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background-color: #f5f5f5;">
    <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px; margin: 0 auto;">
        <tr>
            <td align="center" style="padding: 20px;">
                <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px;">
                    <tr>
                        <td bgcolor="#f9f9f9" style="padding: 20px; border-radius: 10px 10px 0 0;">
                            <table border="0" cellpadding="0" cellspacing="0" width="100%">
                    <tr>
            <td style="text-align: center;">
                <h1
                    style="margin: 0; color: #374151; font-size: 24px; font-family: Arial, Helvetica, sans-serif;">
                    Verify Your Email Address
                </h1>
            </td>
        </tr>
        </table>
    </td>
</tr>
                    <tr>
                        <td bgcolor="#ffffff"
                            style="padding: 30px; border-radius: 0 0 10px 10px; box-shadow: 0 2px 15px rgba(0, 0, 0, 0.05);">
                            <table border="0" cellpadding="0" cellspacing="0" width="100%">
                                <tr>
                                    <td style="padding-bottom: 20px;">
                                        <p style="margin: 0;">Hello <strong>{name}</strong>👋,</p>
                                    </td>
                                </tr>
                                <tr>
                                    <td style="padding-bottom: 20px;">
                                        <p style="margin: 0;">Thanks for signing up! Please use the verification code
                                            below to complete your registration:</p>
                                    </td>
                                </tr>
                                <tr>
                                    <td align="center" style="padding: 30px 0;">
                                        <div style="display: inline-block; padding: 16px 30px; background-color: #f2f6fc; border-radius: 8px; font-size: 26px; font-weight: bold; font-family: Courier, monospace; letter-spacing: 5px; color: #3b82f6; border: 1px solid #e5e7eb;"
                                            role="textbox" aria-label="Your verification code">
                                            {verificationCode}
                                        </div>
                                    </td>
                                </tr>
                                <tr>
                                    <td>
                                        <p
                                            style="margin: 0; padding-bottom: 10px; font-size: 15px; color: #6b7280; font-family: Arial, Helvetica, sans-serif;">
                                            This code will expire in 15 minutes for security reasons.
                                        </p>
                                    </td>
                                </tr>
                                <tr>
                                    <td>
                                        <p
                                            style="margin: 0; padding-bottom: 20px; font-size: 15px; color: #6b7280; font-family: Arial, Helvetica, sans-serif;">
                                            If you didn't request this email, please ignore it.
                                        </p>
                                    </td>
                                </tr>
                                <tr>
                                    <td>
                                        <div style="height: 1px; background-color: #e5e7eb; margin: 20px 0;"></div>
                                    </td>
                                </tr>
                                <tr>
                                    <td>
                                        <p
                                            style="margin: 0; padding-bottom: 20px; font-size: 15px; color: #6b7280; font-family: Arial, Helvetica, sans-serif;">
                                            Enter this code to verify your email address and complete your registration.
                                        </p>
                                    </td>
                                </tr>
                                <tr>
                                    <td>
                                        <p style="margin: 0; font-family: Arial, Helvetica, sans-serif;">
                                            Best regards,<br>"Name" Team
                                        </p>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding-top: 30px; text-align: center;">
                            <table border="0" cellpadding="0" cellspacing="0" width="100%">
                                <tr>
                                    <td
                                        style="text-align: center; font-size: 14px; color: #6b7280; font-family: Arial, Helvetica, sans-serif;">
                                        <p style="margin: 0;">&copy; 2025 "Name". All rights reserved.</p>
                                    </td>
                                </tr>
                                <tr>
                                    <td
                                        style="text-align: center; font-size: 12px; color: #6b7280; font-family: Arial, Helvetica, sans-serif; padding-top: 15px;">
                                        <p style="margin: 0;">This is an automated message, please do not reply to this
                                            email.</p>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
`;

// Password reset email template
export const PASSWORD_RESET_EMAIL_TEMPLATE = `
<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="color-scheme" content="light">
    <meta name="supported-color-schemes" content="light">
    <title>Reset Your Password</title>
</head>

<body
    style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background-color: #f5f5f5;">
    <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px; margin: 0 auto;">
        <tr>
            <td align="center" style="padding: 20px;">
                <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px;">
                    <tr>
                        <td bgcolor="#f9f9f9" style="padding: 20px; border-radius: 10px 10px 0 0;">
                            <table border="0" cellpadding="0" cellspacing="0" width="100%">
                                <tr>
                                    <td style="text-align: center;">
                                        <h1
                                            style="margin: 0; color: #374151; font-size: 24px; font-family: Arial, Helvetica, sans-serif;">
                                            Reset Your Password
                                        </h1>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                    <tr>
                        <td bgcolor="#ffffff"
                            style="padding: 30px; border-radius: 0 0 10px 10px; box-shadow: 0 2px 15px rgba(0, 0, 0, 0.05);">
                            <table border="0" cellpadding="0" cellspacing="0" width="100%">
                                <tr>
                                    <td style="padding-bottom: 20px;">
                                        <p style="margin: 0;">Hello <strong>{name}</strong>👋,</p>
                                    </td>
                                </tr>
                                <tr>
                                    <td style="padding-bottom: 20px;">
                                        <p style="margin: 0;">We received a request to reset your password. Use the code
                                            below to create a new password:</p>
                                    </td>
                                </tr>
                                <tr>
                                    <td align="center" style="padding: 30px 0;">
                                        <div style="display: inline-block; padding: 16px 30px; background-color: #f2f6fc; border-radius: 8px; font-size: 26px; font-weight: bold; font-family: Courier, monospace; letter-spacing: 5px; color: #3b82f6; border: 1px solid #e5e7eb;"
                                            role="textbox" aria-label="Your password reset code">
                                            {resetCode}
                                        </div>
                                    </td>
                                </tr>
                                <tr>
                                    <td>
                                        <p
                                            style="margin: 0; padding-bottom: 10px; font-size: 15px; color: #6b7280; font-family: Arial, Helvetica, sans-serif;">
                                            This code will expire in 15 minutes for security reasons.
                                        </p>
                                    </td>
                                </tr>
                                <tr>
                                    <td>
                                        <p
                                            style="margin: 0; padding-bottom: 20px; font-size: 15px; color: #6b7280; font-family: Arial, Helvetica, sans-serif;">
                                            If you didn't request a password reset, please ignore this email or contact
                                            support if you have concerns.
                                        </p>
                                    </td>
                                </tr>
                                <tr>
                                    <td>
                                        <div style="height: 1px; background-color: #e5e7eb; margin: 20px 0;"></div>
                                    </td>
                                </tr>
                                <tr>
                                    <td>
                                        <p
                                            style="margin: 0; padding-bottom: 20px; font-size: 15px; color: #6b7280; font-family: Arial, Helvetica, sans-serif;">
                                            Enter this code to reset your password and regain access to your account.
                                        </p>
                                    </td>
                                </tr>
                                <tr>
                                    <td>
                                        <p style="margin: 0; font-family: Arial, Helvetica, sans-serif;">
                                            Best regards,<br>"Name" Team
                                        </p>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding-top: 30px; text-align: center;">
                            <table border="0" cellpadding="0" cellspacing="0" width="100%">
                                <tr>
                                    <td
                                        style="text-align: center; font-size: 14px; color: #6b7280; font-family: Arial, Helvetica, sans-serif;">
                                        <p style="margin: 0;">&copy; 2025 "Name". All rights reserved.</p>
                                    </td>
                                </tr>
                                <tr>
                                    <td
                                        style="text-align: center; font-size: 12px; color: #6b7280; font-family: Arial, Helvetica, sans-serif; padding-top: 15px;">
                                        <p style="margin: 0;">This is an automated message, please do not reply to this
                                            email.</p>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>

</html>
`;
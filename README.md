# 🔐 Node Authentication Template

## Introduction

The Node Authentication Template is a robust, secure, and feature-rich authentication system built with Node.js and TypeScript. It provides a complete authentication solution with advanced security features including email verification, password reset, two-factor authentication (2FA), rate limiting, and more. This template is designed to be easily integrated into any Node.js project requiring secure user authentication.

[![Node.js](https://img.shields.io/badge/Node.js-43853D?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Express.js](https://img.shields.io/badge/Express.js-404D59?style=for-the-badge&logo=express&logoColor=white)](https://expressjs.com/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-316192?style=for-the-badge&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Prisma](https://img.shields.io/badge/Prisma-3982CE?style=for-the-badge&logo=Prisma&logoColor=white)](https://www.prisma.io/)
[![JWT](https://img.shields.io/badge/JWT-000000?style=for-the-badge&logo=JSON%20web%20tokens&logoColor=white)](https://jwt.io/)
[![bcrypt](https://img.shields.io/badge/bcrypt-CF1A12?style=for-the-badge&logo=npm&logoColor=white)](https://www.npmjs.com/package/bcryptjs)
[![2FA](https://img.shields.io/badge/2FA-FFA500?style=for-the-badge&logo=authy&logoColor=white)](https://www.npmjs.com/package/speakeasy)
[![Nodemailer](https://img.shields.io/badge/Nodemailer-0F9DCE?style=for-the-badge&logo=minutemailer&logoColor=white)](https://nodemailer.com/)
[![Google APIs](https://img.shields.io/badge/Google_APIs-4285F4?style=for-the-badge&logo=google&logoColor=white)](https://www.npmjs.com/package/googleapis)
[![Zod](https://img.shields.io/badge/Zod-3068b7?style=for-the-badge&logo=zod&logoColor=white)](https://github.com/colinhacks/zod)
[![dotenv](https://img.shields.io/badge/dotenv-ECD53F?style=for-the-badge&logo=dotenv&logoColor=black)](https://www.npmjs.com/package/dotenv)
[![ESLint](https://img.shields.io/badge/ESLint-4B32C3?style=for-the-badge&logo=eslint&logoColor=white)](https://eslint.org/)
[![Nodemon](https://img.shields.io/badge/Nodemon-76D04B?style=for-the-badge&logo=nodemon&logoColor=white)](https://nodemon.io/)

## Tech Stack & Dependencies

### Core Technologies

- Node.js
- TypeScript
- Express.js
- PostgreSQL
- Prisma ORM

### Key Dependencies

**Authentication & Security:**

- jsonwebtoken: JWT implementation for token-based authentication
- bcryptjs: Password hashing library
- speakeasy & qrcode: TOTP-based two-factor authentication
- express-rate-limit: API rate limiting to prevent abuse
- sanitize-html: Input sanitization to prevent XSS attacks

**Email Services:**

- nodemailer: Email sending functionality
- googleapis: Google OAuth2 integration for email services

**Validation:**

- zod: Schema validation and type checking

**Development Tools:**

- dotenv: Environment variable management
- eslint: Code linting
- prisma: ORM and database migration tool
- nodemon: Automatic server restarts during development
- ts-node: TypeScript execution environment

## Environment Variables

Create a .env file in the root directory with the following variables:

``` .env
# Server Configurations
PORT=
API_VERSION=
BASE_URL=

# App Configurations
SALT_ROUNDS=

# Database Configurations
DATABASE_URL=

#JWT Configurations
JWT_SECRET=
JWT_REFRESH_SECRET=

# Email Configurations
CLIENT_ID=
CLIENT_SECRET=
REFRESH_TOKEN=
USER_EMAIL=
REDIRECT_URI=
```

## Running the Application

### Setup

1. **Clone the repository**

   ```bash
   git clone https://github.com/KhaledSaeed18/node-authentication-template.git
   cd node-authentication-template
   ```

2. **Install dependencies with Yarn**

   ```bash
   yarn install
   ```

3. **Set up environment variables**
   - Create a `.env` file in the root directory
   - Add all required environment variables as described in the section above

### Development Mode

Run the server in development mode with hot-reloading:

```bash
yarn dev
```

### Production Mode

1. **Build the application**

   ```bash
   yarn build
   ```

2. **Start the production server**

   ```bash
   yarn start
   ```

### Additional Scripts

- **Apply database migrations**

  ```bash
  yarn prisma migrate dev
  ```

- **Generate Prisma client**

  ```bash
  yarn prisma generate
  ```

## Project Structure

The project follows a modular architecture for better organization and maintainability:

``` bash
├── .gitignore
├── eslint.config.mjs
├── package.json
├── prisma
│   └── schema.prisma
├── src
│   ├── api
│   │   └── auth
│   │       ├── auth.controller.ts
│   │       ├── auth.rateLimiting.ts
│   │       ├── auth.routes.ts
│   │       ├── auth.service.ts
│   │       └── auth.validation.ts
│   ├── constants
│   │   ├── auth.constants.ts
│   │   └── emailTemplates.ts
│   ├── index.ts
│   ├── mails
│   │   ├── email.ts
│   │   └── nodemailer.config.ts
│   ├── middlewares
│   │   ├── authorization.middleware.ts
│   │   ├── error.middleware.ts
│   │   ├── sanitizeBody.middleware.ts
│   │   └── securityHeaders.middleware.ts
│   └── utils
│       ├── errorHandler.ts
│       ├── generateOTP.ts
│       ├── generateTokens.ts
│       └── totp.ts
├── tsconfig.json
└── yarn.lock
```

### Key Components

- **api/auth**: Contains all authentication-related logic
- **constants**: Application-wide constants and configurations
- **mails**: Email service implementation
- **middlewares**: Express middlewares for security and request processing
- **utils**: Utility functions for common operations

## Features & Endpoints

### Authentication

#### User Registration & Verification

- `POST /api/v1/auth/signup`: Register a new user
  - Required fields: firstName, lastName, email, password
  - Creates user and sends verification email
- `POST /api/v1/auth/verify-email`: Verify email with OTP
  - Required fields: email, code (6-digit)
- `POST /api/v1/auth/resend-verification`: Resend verification code
  - Required fields: email

#### Login & Session Management

- `POST /api/v1/auth/signin`: User login
  - Required fields: email, password
  - Returns JWT tokens and user info
  - Handles 2FA if enabled
- `POST /api/v1/auth/refresh-token`: Refresh access token
  - Required fields: refreshToken
  - Returns new access token
- `GET /api/v1/auth/login-history`: Get user login history
  - Protected route (requires authorization)
  - Returns list of login attempts with device info

#### Password Management

- `POST /api/v1/auth/forgot-password`: Initiate password reset
  - Required fields: email
  - Sends password reset code via email
- `POST /api/v1/auth/reset-password`: Reset password with code
  - Required fields: email, code, newPassword

#### Two-Factor Authentication (2FA)

- `POST /api/v1/auth/2fa/setup`: Set up 2FA
  - Protected route
  - Returns QR code and secret for TOTP apps
- `POST /api/v1/auth/2fa/verify`: Verify and enable 2FA
  - Protected route
  - Required fields: token (6-digit TOTP code)
- `POST /api/v1/auth/2fa/signin`: Complete login with 2FA
  - Required fields: email, password, token
- `POST /api/v1/auth/2fa/disable`: Disable 2FA
  - Protected route
  - Required fields: token (6-digit TOTP code)

## Security Features

### Password Security

- Strong password requirements with complexity validation
- Bcrypt hashing with configurable salt rounds
- Common password detection and prevention

### Protection Against Attacks

- Rate limiting on all authentication endpoints
- CORS protection with configurable allowed origins
- Security headers (CSP, HSTS, XSS Protection, etc.)
- Input sanitization to prevent XSS attacks

### Session Management

- Short-lived JWT access tokens (20 minutes)
- Longer-lived refresh tokens (7 days)
- Login anomaly detection with IP, device tracking

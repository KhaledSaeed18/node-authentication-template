# Node Authentication Template

## Introduction

The Node Authentication Template is a robust, secure, and feature-rich authentication system built with Node.js and TypeScript. It provides a complete authentication solution with advanced security features including email verification, password reset, two-factor authentication (2FA), rate limiting, and more. This template is designed to be easily integrated into any Node.js project requiring secure user authentication.

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

**Validation & Parsing:**

- zod: Schema validation and type checking
- dotenv: Environment variable management

**Development Tools:**

- eslint: Code linting
- prisma: ORM and database migration tool
- nodemon: Automatic server restarts during development
- ts-node: TypeScript execution environment

## Installation & Setup

1. Clone the Repository
2. Install Dependencies
3. PostgreSQL & Prisma Setup
   - Install PostgreSQL: Ensure PostgreSQL is installed and running on your system. You can download it from postgresql.org.
   - Configure Environment Variables: Create a .env file (see Environment Variables section below).
   - Apply Database Migrations:
   - Explore Your Database:

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
   git clone https://github.com/yourusername/node-authentication-template.git
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

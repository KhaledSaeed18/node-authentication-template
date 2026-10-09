# Contributing to Node Authentication Template

## Table of Contents

1. Getting Started
2. How to Contribute
3. Code Style Guide
4. Commit Message Guidelines
5. Pull Request Process
6. Reporting Issues
7. Suggestions & Feature Requests

---

### 1. Getting Started

- Make sure you have Node.js 24 or newer and Yarn 1.x installed.
- Fork this repository.
- Clone your forked repository:

  ```bash
  git clone https://github.com/<your-username>/node-authentication-template.git
  ```

- Install dependencies (this also generates the Prisma client):

  ```bash
  yarn install
  ```

- Copy `.env.example` to `.env` and fill in the values.

---

### 2. How to Contribute

- Open an issue if you want to suggest something or report a bug.
- Pick an issue or suggest a feature and discuss it before working on it.
- Create a separate branch for each contribution:

  ```bash
  git checkout -b feature/your-feature-name
  ```

---

### 3. Code Style Guide

- Use TypeScript best practices.
- Keep the code lint-clean (`yarn lint`) and type-safe (`yarn typecheck`).
- Validate requests using Zod.
- Keep architecture modular and clean (separate routes, controllers, services).

---

### 4. Commit Message Guidelines

- Use clear, descriptive commit messages.
- Follow this format:

  ``` bash
  <type>: <short summary>
  ```

  **Types**: `feat`, `fix`, `chore`, `docs`, `test`, `refactor`
  
  Example:  

  ``` bash
  feat: add refresh token rotation
  fix: correct email verification token expiry handling
  ```

---

### 5. Pull Request Process

- Ensure `yarn lint`, `yarn typecheck` and `yarn build` pass.
- Reference the related issue in the PR.
- Add a clear description of what you’ve done.
- Mark PR as draft if still working, or ready for review once complete.

---

### 6. Reporting Issues

- Clearly describe the issue.
- Share error messages, screenshots (if applicable), and environment details.
- Suggest a possible solution if you have one.

---

### 7. Suggestions & Feature Requests

- Create an issue with a feature request label.
- Describe the feature and why it would improve the project.

# URSB Asset Management System

A full-featured asset lifecycle management system for the Uganda Registration Services Bureau. Built with zero external dependencies — pure Node.js + SQLite.

## Features

- **Asset Lifecycle** — Register, assign, transfer, maintain, and dispose assets
- **Request & Approval Workflow** — Employees submit requisitions; managers approve or reject
- **Role-Based Access Control** — Four distinct roles with granular permissions (see table below)
- **Dashboard** — Metrics, status distribution charts, and upcoming maintenance alerts
- **Asset Register** — Searchable, filterable, sortable table with CSV/PDF export _(restricted to Admin, AssetManager, AssetCustodian)_
- **Asset History Timeline** — Full lifecycle timeline per asset
- **Audit Trail** — Immutable system change logs
- **Session-Based Auth** — Secure PBKDF2 password hashing with rate-limited login
- **Login Slideshow** — ICT-themed rotating background images on the sign-in page (auto-switches every 10 s)

## Role Permissions

| Feature | Admin | AssetManager | AssetCustodian | Employee |
|---------|:-----:|:------------:|:--------------:|:--------:|
| Dashboard | ✅ | ✅ | ✅ | ✅ |
| Asset Register | ✅ | ✅ | ✅ | ❌ |
| Assignments | ✅ | ✅ | ✅ | ✅ |
| Transfers | ❌ | ✅ | ❌ | ❌ |
| Maintenance | ❌ | ✅ | ❌ | ❌ |
| Disposals | ❌ | ✅ | ❌ | ❌ |
| Requests | ✅ | ✅ | ✅ | ✅ |
| User Accounts | ✅ | ❌ | ❌ | ❌ |
| Audit Logs | ✅ | ✅ | ❌ | ❌ |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 22+ |
| Database | SQLite (`node:sqlite` built-in) |
| Frontend | Vanilla JS SPA |
| Auth | PBKDF2 (600K iterations) + session tokens |

## Getting Started: Step-by-Step Guide

Follow these instructions to set up and run the URSB Asset Management System locally.

### 1. Clone the Repository

First, clone the project repository from GitHub to your local machine:

```bash
git clone https://github.com/Nsimbi-Noel/ASSET-MANAGEMENT-.git
cd ASSET-MANAGEMENT-
```

### 2. Install Dependencies (Optional, for development)

This project is designed with zero external dependencies for its core functionality. However, if you plan to run tests or use development tools, you might need `npm`:

```bash
npm install
```

### 3. Configure Environment Variables (Optional)

The system uses environment variables for configuration. A `.env.example` file is provided. You can copy it to `.env` and customize the settings if needed. The default values are usually sufficient for local development.

```bash
cp .env.example .env
# Open .env in a text editor to modify variables like PORT, HOST, etc.
```

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |
| `HOST` | `0.0.0.0` | Bind address |
| `NODE_ENV` | `development` | Environment mode |
| `DB_PATH` | `./data/database.db` | SQLite database path |
| `SSL_KEY_PATH` | — | Path to TLS key (enables HTTPS) |
| `SSL_CERT_PATH` | — | Path to TLS cert (enables HTTPS) |
| `RATE_LIMIT_MAX_LOGIN` | `10` | Max login attempts per 15 min |
| `RATE_LIMIT_WINDOW_MS` | `900000` | Rate limit window in ms |

### 4. Initialize and Seed the Database

The application uses an SQLite database. You can initialize it and populate it with sample data using the `seed.js` script. This is highly recommended for first-time setup to have some data to work with.

```bash
node seed.js
```

This command will create a `data/database.db` file (if it doesn't exist) and insert default users, assets, and assignments.

### 5. Start the Application

Run the Node.js server. No build step is required for the frontend as it's a Vanilla JS SPA.

```bash
node server.js
```

The server will typically start on `http://localhost:3000` (or the port specified in your `.env` file).

### 6. Access the Application

Open your web browser and navigate to the address where the application is running:

```
http://localhost:3000
```

### 7. Login with Default Accounts

Use the following default credentials to log in and explore the system:

| Username | Password | Role |
|----------|----------|------|
| `admin` | `admin123` | Admin |
| `manager` | `manager123` | AssetManager |
| `custodian` | `custodian123` | AssetCustodian |
| `employee` | `employee123` | Employee |

> **Note:** Employees have restricted access. They can only view the Dashboard, submit asset requests, and manage their assigned assets.

## Docker

To run the application using Docker:

```bash
docker build -t ursb-ams .
docker run -p 3000:3000 -v $(pwd)/data:/app/data ursb-ams
```

## API Endpoints

All routes under `/api/`:

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/auth/login` | No | Login |
| POST | `/api/auth/logout` | No | Logout |
| GET | `/api/auth/session` | Yes | Current session |
| GET/POST | `/api/users` | Admin | List/create users |
| PUT | `/api/users/:id` | Admin | Update user |
| PUT | `/api/users/:id/password` | Admin | Reset password |
| GET/POST | `/api/assets` | Yes | List/register assets |
| GET | `/api/assets/:id` | Yes | Get asset details |
| GET/POST | `/api/assignments` | Yes | List/create assignments |
| PUT | `/api/assignments/:id/return` | Manager | Return asset |
| PUT | `/api/assignments/:id/confirm` | Custodian | Confirm receipt |
| GET/POST | `/api/transfers` | Manager | List/create transfers |
| GET/POST | `/api/maintenance` | Manager | List/create maintenance |
| PUT | `/api/maintenance/:id/complete` | Manager | Complete maintenance |
| POST | `/api/disposals` | Manager | Dispose asset |
| GET/POST | `/api/requests` | Yes | List/create requests |
| PUT | `/api/requests/:id/action` | Manager | Approve/reject request |
| GET | `/api/reports/dashboard` | Yes | Dashboard metrics |
| GET | `/api/reports/register` | Manager/Admin/Custodian | Asset register (filtered) |
| GET | `/api/reports/history/:id` | Yes | Asset lifecycle history |
| GET | `/api/reports/audits` | Manager+ | Audit logs |

## Changelog

### v1.2.0 — 2026-07-03

**Enhancements**
- **My Assets View**: Consolidated assigned assets and pending requests into a single "My Assets" dashboard for employees, providing a unified view of their current asset status and requests. Includes summary cards for total assigned assets, confirmed receipts, and pending requests.
- **Maintenance Dashboard**: Enhanced the Asset Manager's maintenance view with a comprehensive dashboard, including summary metrics for overdue, in-progress, scheduled, and completed service tickets. Added visual progress badges, countdown indicators, and advanced filtering options.

### v1.1.1 — 2026-07-03

**Bug Fixes**
- **Maintenance Modal User Dropdown**: Restored the visibility toggle for the user assignment dropdown in the maintenance completion modal, ensuring it appears correctly when selecting to assign an asset after maintenance.

### v1.1.0 — 2026-06-27

**Bug Fixes**
- Fixed asset registration form: the `<form>` element inside the modal was not participating in the CSS flex layout, causing the modal footer (with the *Register Asset* save button) to be clipped below the viewport and unclickable. Added `display: flex; flex-direction: column; flex: 1; min-height: 0` to `.modal > form` and `flex-shrink: 0` to `.modal-footer`.
- Same flex layout fix applied to the *Create User Account* modal and all other modals that wrap `<form>` inside `.modal`.
- Added `min-height: 0` to `.modal-body` so the scroll area correctly constrains within the modal height.

**Security & Access Control**
- Employees are now blocked from the Asset Register at three layers: (1) the sidebar nav item is hidden, (2) the client-side router redirects any direct navigation attempt to the dashboard, and (3) the `/api/reports/register` endpoint returns HTTP 403 for Employee sessions.

**UX Improvements**
- Logout button redesigned with a distinct red style (`btn-logout`) — no longer blends in with the sidebar; includes a hover animation.
- Login page background replaced with an auto-cycling ICT slideshow (5 images, 10-second interval, 1.5-second cross-fade transition). Images are sourced from Unsplash.

## Testing

To run the automated integration test suite:

```bash
npm test
```

This will execute `test_api.js` and verify core functionalities of the system.

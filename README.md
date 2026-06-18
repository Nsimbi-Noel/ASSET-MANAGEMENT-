# URSB Asset Management System

A full-featured asset lifecycle management system for the Uganda Registration Services Bureau. Built with zero external dependencies — pure Node.js + SQLite.

## Features

- **Asset Lifecycle** — Register, assign, transfer, maintain, and dispose assets
- **Request & Approval Workflow** — Employees submit requisitions, managers approve/reject
- **Role-Based Access Control** — Admin, AssetManager, AssetCustodian, Employee
- **Dashboard** — Metrics, status distribution charts, upcoming maintenance alerts
- **Asset Register** — Searchable, filterable, sortable with CSV export
- **Asset History Timeline** — Full lifecycle timeline per asset
- **Audit Trail** — Immutable system change logs
- **Session-Based Auth** — Secure PBKDF2 password hashing

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 22+ |
| Database | SQLite (`node:sqlite` built-in) |
| Frontend | Vanilla JS SPA |
| Auth | PBKDF2 (600K iterations) + session tokens |

## Quick Start

```bash
# 1. Clone
git clone https://github.com/Nsimbi-Noel/URSB-Asset-Management-System.git
cd URSB-Asset-Management-System

# 2. Start (no install needed — zero deps)
node server.js

# 3. Open http://localhost:3000
```

## Default Accounts

| Username | Password | Role |
|----------|----------|------|
| `admin` | `admin123` | Admin |
| `manager` | `manager123` | AssetManager |
| `custodian` | `custodian123` | AssetCustodian |
| `employee` | `employee123` | Employee |

## Environment Variables

Copy `.env.example` to `.env` and customize:

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

## Docker

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
| GET | `/api/reports/register` | Yes | Asset register (filtered) |
| GET | `/api/reports/history/:id` | Yes | Asset lifecycle history |
| GET | `/api/reports/audits` | Manager+ | Audit logs |

## Testing

```bash
npm test
```

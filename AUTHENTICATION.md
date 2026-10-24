# EcoGrid AI — Production Authentication & Authorization Architecture

## 1. Executive Summary

EcoGrid AI implements an end-to-end, production-grade authentication, authorization, and session governance system designed for municipal climate planners, researchers, and administrators. The system strictly follows modern web security standards:

- **Password Security**: Passwords are never stored in plaintext. They are hashed using **Argon2id** (memory-hard, resistant to GPU/ASIC cracking) with constant-time verification.
- **Server-Managed Hashed Sessions**: Sessions use cryptographically random 256-bit entropy tokens. Only their **SHA-256 cryptographic hashes** are persisted in the database; raw tokens are never saved on the server.
- **HttpOnly Secure Cookies**: Raw session tokens are transmitted exclusively in `HttpOnly`, `SameSite` cookies (`ecogrid_session`), preventing JavaScript access and neutralizing XSS token theft.
- **CSRF Defense**: Double-submit cookie pattern with `ecogrid_csrf` cookie and `X-CSRF-Token` header verification for all mutating state operations (`POST`, `PUT`, `PATCH`, `DELETE`).
- **Role-Based Access Control (RBAC)**: Enforced server-side through FastAPI dependencies across three privilege tiers: `ADMIN`, `PLANNER`, and `VIEWER`. Public registration enforces the least-privilege `VIEWER` role.
- **IDOR & Resource Isolation**: Multi-tenant authorization ensures study areas, optimization runs, and custom scenarios can only be accessed or modified by their authorized owner or workspace administrators, while preserving public demo datasets for exploration.
- **Brute-Force Rate Limiting**: In-memory sliding-window rate limiters throttle failed authentication and password reset attempts per IP and target identifier.
- **Single-Use Expiring Recovery**: Cryptographic password reset tokens expire after 15 minutes and automatically invalidate all existing active sessions upon successful reset.

---

## 2. Authentication Architecture

### 2.1 Session Storage & Transmission Model

```
+-------------------------------------------------------------+
|                      Client Browser                         |
|  - Reads user state from GET /api/auth/me                   |
|  - Cookie: ecogrid_session (HttpOnly, Secure, SameSite)     |
|  - Cookie: ecogrid_csrf    (Client-readable double submit)  |
|  - Header: X-CSRF-Token    (Attached to mutating requests)  |
+-------------------------------------------------------------+
                               |
                       HTTPS / Credentials
                               v
+-------------------------------------------------------------+
|                     FastAPI Gateway                         |
|  1. Security Middleware:                                    |
|     - X-Content-Type-Options: nosniff                       |
|     - X-Frame-Options: SAMEORIGIN                           |
|     - Referrer-Policy: strict-origin-when-cross-origin      |
|     - Double-Submit CSRF Verification                       |
|  2. Auth Dependencies:                                      |
|     - Extract ecogrid_session cookie                        |
|     - Compute SHA-256(token)                                |
|     - Query sessions table in PostgreSQL                    |
|     - Verify revoked_at IS NULL & expires_at > NOW()        |
+-------------------------------------------------------------+
                               |
                               v
+-------------------------------------------------------------+
|                PostgreSQL + PostGIS Database                |
|  - users (id, full_name, email, password_hash, role, ...)   |
|  - sessions (id, user_id, token_hash, expires_at, ...)      |
|  - password_reset_tokens (id, user_id, token_hash, ...)     |
|  - study_areas (..., owner_id, is_public)                   |
+-------------------------------------------------------------+
```

### 2.2 Cookie Attributes

| Attribute | Development (`PUBLIC_HTTPS=false`) | Production (`PUBLIC_HTTPS=true`) |
| :--- | :--- | :--- |
| **Name** | `ecogrid_session` | `ecogrid_session` |
| **HttpOnly** | `true` | `true` |
| **Secure** | `false` | `true` |
| **SameSite** | `Lax` (proxied by Vite) | `None` (for cross-origin Vercel -> Backend) |
| **Path** | `/` | `/` |
| **Max-Age** | 604,800s (7 days) | Configurable (`SESSION_TTL_SECONDS`) |

---

## 3. Role-Based Access Control (RBAC)

EcoGrid AI enforces access controls strictly on the server:

| Capability | VIEWER | PLANNER | ADMIN |
| :--- | :---: | :---: | :---: |
| Explore public demonstration study areas & cells | Yes | Yes | Yes |
| Inspect environmental risk, heat, & NDVI metrics | Yes | Yes | Yes |
| View pre-computed optimization plans & reports | Yes | Yes | Yes |
| Run OR-Tools budget optimization on study areas | No | Yes | Yes |
| Run Pareto multi-objective optimization (NSGA-II) | No | Yes | Yes |
| Create and save custom planning scenarios | No | Yes | Yes |
| Create new study areas / import geographic boundaries | No | Yes | Yes |
| Ingest satellite imagery (ISRO Bhuvan / Landsat / Sentinel) | No | Yes | Yes |
| Record ground-truth satellite temperature observations | No | Yes | Yes |
| Update human-in-the-loop approval workflows | No | Yes | Yes |
| Inspect workspace user directory (`/api/admin/users`) | No | No | Yes |
| Elevate or demote user roles (`/api/admin/users/{id}/role`) | No | No | Yes |
| Suspend or reactivate user accounts (`/status`) | No | No | Yes |

---

## 4. Resource Isolation & IDOR Protection

1. **Study Areas**:
   - `is_public = TRUE` study areas (e.g., `study-bengaluru-east`, `kerala-kochi`) are viewable by any user (including unauthenticated viewers).
   - User-created study areas set `owner_id = user.id` and `is_public = FALSE`.
   - Any query to `/api/studies/{id}/cells`, `/api/studies/{id}/report`, or `/api/export` evaluates `verify_study_access`:
     - If the study is public, read access is granted.
     - If private, only the resource owner or an `admin` can access it.
     - Unauthorized requests receive `403 Forbidden` (or `404 Not Found` if nonexistent).

2. **Optimization Runs & Scenarios**:
   - Scenarios and runs inherit the security boundary of their parent study area.

---

## 5. API Endpoints

### 5.1 Public & Session Endpoints

- `GET /api/auth/csrf`: Initializes the CSRF cookie and returns `{ "csrfToken": "..." }`.
- `POST /api/auth/register`: Public registration (Full Name, Email, Password, Confirm Password). Assigns `viewer` role and creates active session.
- `POST /api/auth/login`: Verifies credentials, rotates session token, and establishes `ecogrid_session` cookie.
- `POST /api/auth/logout`: Invalidates session record in database and clears session cookies.
- `GET /api/auth/me`: Returns `{ id, email, fullName, role, isActive, createdAt }` for the authenticated session.

### 5.2 Password Management

- `POST /api/auth/forgot-password`: Generates a single-use 15-minute reset token. Generic response prevents email enumeration. In development mode without SMTP, provides `dev_reset_token` for convenient local testing.
- `POST /api/auth/reset-password`: Validates token, hashes new password with Argon2id, marks token used, and revokes all user sessions.
- `POST /api/auth/change-password`: Authenticated endpoint to change password. Revokes other active sessions while preserving the current session.

### 5.3 Administrative Endpoints (Admin Only)

- `GET /api/admin/users`: Lists all users, emails, roles, active statuses, and registration dates.
- `PATCH /api/admin/users/{id}/role`: Updates user role (`admin`, `planner`, `viewer`).
- `PATCH /api/admin/users/{id}/status`: Activates or suspends user. Suspending an account immediately terminates all active sessions.

---

## 6. Environment Configuration

Copy `.env.example` to `.env` and configure appropriate secrets:

```bash
# Database Connection (PostgreSQL + PostGIS)
DATABASE_URL=postgresql://ecogrid:ecogrid@localhost:5433/ecogrid

# Networking
API_PORT=3001
WEB_ORIGIN=http://localhost:3000
PUBLIC_HTTPS=false

# Session Security
SECRET_KEY=generate_with_python_secrets_token_hex_32
SESSION_COOKIE_NAME=ecogrid_session
SESSION_TTL_SECONDS=604800
CSRF_COOKIE_NAME=ecogrid_csrf

# Rate Limiting
RATE_LIMIT_LOGIN_ATTEMPTS=5
RATE_LIMIT_WINDOW_SECONDS=900

# Bootstrap Admin
SEED_ADMIN_EMAIL=admin@ecogrid.internal
SEED_ADMIN_PASSWORD=AdminSecurePassword2026!
```

---

## 7. Deployment Guide

### Local Development
```bash
# 1. Install dependencies
pnpm install
cd backend && .venv\Scripts\pip install -r requirements.txt && cd ..

# 2. Run database migrations and bootstrap tables
backend\.venv\Scripts\python.exe -c "from app.models.database import init_db; init_db()"

# 3. Start development servers
pnpm dev
```

### Production Deployment (Vercel Frontend + Hosted FastAPI Backend)
1. **Frontend (Vercel)**:
   - Framework preset: Vite.
   - Build command: `pnpm run build`.
   - Set environment variable: `VITE_API_PROXY_TARGET=https://api.your-ecogrid-domain.com`.
2. **Backend (Container / Linux Host)**:
   - Set `PUBLIC_HTTPS=true`.
   - Set `WEB_ORIGIN=https://your-ecogrid-app.vercel.app`.
   - Set `SECRET_KEY` to a random 64-character secret.
   - Set `SEED_ADMIN_PASSWORD` to a strong unique bootstrap password.
   - Cookies will automatically use `Secure; SameSite=None; Partitioned` to enable seamless authenticated cross-origin requests from Vercel.

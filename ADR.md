# Architectural Decision Record (ADR): URSB Asset Management System

## Status
Pending Approval

## Context
The Uganda Registration Services Bureau (URSB) required a robust, lightweight, and maintainable Asset Management System (AMS) to track institutional assets. The system needed to support role-based access control, asset lifecycle management, and detailed audit trails while being easy to deploy in various environments.

## Decision
We have decided to build the refined URSB AMS using a **Node.js backend** with a **native SQLite database** and a **Vanilla JavaScript frontend**.

### 1. Backend: Node.js
- **Rationale**: Node.js provides a high-performance, event-driven environment suitable for handling multiple concurrent API requests. Its vast ecosystem (npm) allows for easy integration of utilities like password hashing and session management.
- **Consequences**: Fast development cycle and easy deployment.

### 2. Database: SQLite
- **Rationale**: SQLite is a serverless, zero-configuration database engine. It stores the entire database as a single file, making it extremely portable and easy to back up. It is ideal for the current scale of URSB's asset tracking needs without the overhead of managing a separate database server like PostgreSQL or MySQL.
- **Consequences**: Simplified deployment and zero infrastructure cost. If scaling requirements exceed SQLite's limits in the future, the relational schema can be migrated to PostgreSQL.

### 3. Frontend: Vanilla JavaScript (ES6+)
- **Rationale**: To minimize build complexity and dependency overhead, we chose a native approach using HTML5, CSS3, and Vanilla JS. This ensures the application is fast, has no "build step" requirements, and remains compatible with standard browsers.
- **Consequences**: High performance and long-term maintainability without worrying about framework deprecation.

### 4. Authentication: Session-based
- **Rationale**: Given the application is a centralized management tool, traditional session-based authentication provides a secure and straightforward way to manage user states and role-based permissions.
- **Consequences**: Secure access control with 24-hour token expiration.

### 5. Audit Logging: Comprehensive
- **Rationale**: For institutional accountability, every state-changing operation (CREATE, UPDATE, DELETE) must be logged with the user's identity and timestamp.
- **Consequences**: Full transparency and compliance with institutional auditing standards.

### 6. Role Model Simplification
- **Rationale**: The system is simplified to support only three roles: `Admin`, `AssetManager`, and `Employee`.
- **Consequences**: Deprecated `Custodian`/`AssetCustodian` terminology has been removed from the UI and backend. Legacy custodian accounts are migrated to `Employee` to preserve existing access while enforcing the updated role model.

### 7. Interactive Notification Center
- **Rationale**: Managers and admins require proactive, actionable operational alerts, while employees should only see notifications related to assets assigned to them.
- **Consequences**: The notification bell now supports hover and click to open a dropdown. Notifications are role-scoped and clickable, taking users directly to the asset or maintenance screen referenced by the alert.

## Alternatives Considered
- **React/Vue Frontend**: Rejected to avoid build-tool complexity and maintain a lightweight footprint.
- **PostgreSQL**: Rejected for the initial phase to simplify deployment, though the schema is designed to be compatible for future migration.
- **JWT Authentication**: Rejected in favor of sessions to allow for easier server-side session revocation if needed.

## Changelog
- Removed the deprecated `Custodian`/`AssetCustodian` role from the system and consolidated user roles to `Admin`, `AssetManager`, and `Employee`.
- Migrated legacy custodian accounts to the `Employee` role to preserve existing access while enforcing the updated role model.
- Updated the notification bell to open on hover and click, with an interactive dropdown for actionable alerts.
- Scoped notifications so `AssetManager` and `Admin` receive maintenance alerts while `Employee` users only see assignment-related alerts relevant to them.
- Added click routing from notifications to the related asset and maintenance views.

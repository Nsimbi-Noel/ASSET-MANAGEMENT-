# Detailed Database Schema: URSB Asset Management System

This document provides a comprehensive technical breakdown of the URSB Asset Management System (AMS) database architecture.

## 1. Entity Relationship Diagram (ERD)

![URSB AMS ERD](https://private-us-east-1.manuscdn.com/sessionFile/GGH1oQAyfJzmPPE7noJD4L/sandbox/xabngGtiBCFFFvgTy12tK6-images_1781858016931_na1fn_L2hvbWUvdWJ1bnR1L3Vyc2ItYW1zL2VyZA.png?Policy=eyJTdGF0ZW1lbnQiOlt7IlJlc291cmNlIjoiaHR0cHM6Ly9wcml2YXRlLXVzLWVhc3QtMS5tYW51c2Nkbi5jb20vc2Vzc2lvbkZpbGUvR0dIMW9RQXlmSnptUFBFN25vSkQ0TC9zYW5kYm94L3hhYm5nR3RpQkNGRkZ2Z1R5MTJ0SzYtaW1hZ2VzXzE3ODE4NTgwMTY5MzFfbmExZm5fTDJodmJXVXZkV0oxYm5SMUwzVnljMkl0WVcxekwyVnlaQS5wbmciLCJDb25kaXRpb24iOnsiRGF0ZUxlc3NUaGFuIjp7IkFXUzpFcG9jaFRpbWUiOjE3OTg3NjE2MDB9fX1dfQ__&Key-Pair-Id=K2HSFNDJXOU9YS&Signature=G3JWDQCZlcHHcBxy8E2mh6PjpAWAoQw~U6CRg~t~z1I2~tFtjadmHw8~dTd-ybnVIOBVuqahBT6DlMPWFO5SAyORsvhCAnch0xK-j~DqtCsc16d5Y73TjKVlcXEQCQezpWSdRVq-0ZCdXxYNQxbcL~cKKZDYSsGyFP0FAur7uemW19Jabpn7nLpckyeXrlSau7mZRVQHTuBsFt1aKWf6T02RGo0E6hWgU8bxa~am7~QMiq5s2f8yJnsckf7G2cZQ0lgZjhO-Es-1m9lGqvnM8Qatvfnoi~CSYa5TW4b5bgGnKSOmauNLgwke-fgyfwTwfyu7uUHZVDxfR7NZuA3hPw__)

The system is designed with a centralized `users` and `assets` architecture, where all transactions (assignments, transfers, maintenance, and disposals) are linked via foreign keys to ensure data integrity and full traceability.

---

## 2. Table Definitions & Constraints

### 2.1 Users (`users`)
Stores system user accounts and authentication data.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | INTEGER | PRIMARY KEY, AUTOINCREMENT | Unique identifier for each user |
| `username` | TEXT | UNIQUE, NOT NULL | Login credential |
| `password` | TEXT | NOT NULL | Hashed password string |
| `name` | TEXT | NOT NULL | Full name of the user |
| `role` | TEXT | NOT NULL | Admin, AssetManager, AssetCustodian, Employee |
| `department` | TEXT | NOT NULL | Institutional department name |
| `created_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP | Record creation timestamp |

### 2.2 Assets (`assets`)
The primary inventory for all institutional assets.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | TEXT | PRIMARY KEY | Custom ID (e.g., URSB-AST-0001) |
| `name` | TEXT | NOT NULL | Asset name/description |
| `type` | TEXT | NOT NULL | Asset type (e.g., Laptop, Router) |
| `category` | TEXT | NOT NULL | Category (e.g., IT Equipment, Furniture) |
| `serial_number` | TEXT | UNIQUE | Manufacturer serial number |
| `condition` | TEXT | NOT NULL | New, Good, Refurbished, Damaged |
| `acquisition_date`| DATE | NOT NULL | Date of purchase/acquisition |
| `cost` | REAL | NOT NULL, >= 0 | Purchase price in UGX |
| `supplier` | TEXT | NOT NULL | Vendor or source organization |
| `source` | TEXT | NOT NULL | Procurement, Donation, etc. |
| `status` | TEXT | NOT NULL | Active, In Storage, Under Maintenance, Disposed |
| `created_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP | Record creation timestamp |

### 2.3 Assignments (`assignments`)
Tracks the custody of assets assigned to specific users.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | INTEGER | PRIMARY KEY, AUTOINCREMENT | Assignment ID |
| `asset_id` | TEXT | FOREIGN KEY (assets.id) | Linked asset |
| `assigned_to` | INTEGER | FOREIGN KEY (users.id) | Custodian receiving the asset |
| `assigned_by` | INTEGER | FOREIGN KEY (users.id) | Manager authorizing the assignment |
| `assignment_date` | DATE | NOT NULL | Date of handover |
| `return_date` | DATE | NULLABLE | Date when asset was returned |
| `purpose` | TEXT | NOT NULL | Reason for assignment |
| `notes` | TEXT | NULLABLE | Additional handover details |
| `confirmed_receipt`| BOOLEAN | DEFAULT 0 | Whether custodian confirmed receipt |
| `status` | TEXT | DEFAULT 'Active' | Active, Returned |

### 2.4 Transfers (`transfers`)
Records the movement of assets between different custodians.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | INTEGER | PRIMARY KEY, AUTOINCREMENT | Transfer ID |
| `asset_id` | TEXT | FOREIGN KEY (assets.id) | Linked asset |
| `from_user_id` | INTEGER | FOREIGN KEY (users.id) | Previous custodian |
| `to_user_id` | INTEGER | FOREIGN KEY (users.id) | New custodian |
| `transfer_date` | DATE | NOT NULL | Date of transfer |
| `reason` | TEXT | NOT NULL | Reason for movement |
| `authorized_by` | INTEGER | FOREIGN KEY (users.id) | Manager authorizing the transfer |

### 2.5 Maintenance (`maintenance`)
Logs the service, repair, and maintenance history of assets.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | INTEGER | PRIMARY KEY, AUTOINCREMENT | Maintenance record ID |
| `asset_id` | TEXT | FOREIGN KEY (assets.id) | Linked asset |
| `service_provider`| TEXT | NOT NULL | Vendor performing the service |
| `description` | TEXT | NOT NULL | Details of work performed |
| `cost` | REAL | NOT NULL, >= 0 | Service cost |
| `service_date` | DATE | NOT NULL | Date of service |
| `next_service_date`| DATE | NULLABLE | Recommended next service date |
| `completed` | BOOLEAN | DEFAULT 0 | Service completion status |
| `completion_date` | DATE | NULLABLE | Actual completion date |

### 2.6 Disposals (`disposals`)
Archives information regarding assets that have been retired.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | INTEGER | PRIMARY KEY, AUTOINCREMENT | Disposal record ID |
| `asset_id` | TEXT | FOREIGN KEY (assets.id) | Retired asset |
| `disposal_date` | DATE | NOT NULL | Date of retirement |
| `method` | TEXT | NOT NULL | Sale, Scrap, Donation, etc. |
| `reason` | TEXT | NOT NULL | Justification for disposal |
| `authorized_by` | INTEGER | FOREIGN KEY (users.id) | Manager authorizing disposal |

### 2.7 Requests (`requests`)
Workflow for internal asset procurement or assignment requests.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | INTEGER | PRIMARY KEY, AUTOINCREMENT | Request ID |
| `requested_by` | INTEGER | FOREIGN KEY (users.id) | Employee making the request |
| `asset_name` | TEXT | NOT NULL | Name of requested item |
| `asset_type` | TEXT | NOT NULL | Type of requested item |
| `purpose` | TEXT | NOT NULL | Business justification |
| `status` | TEXT | DEFAULT 'Pending' | Pending, Approved, Rejected |
| `manager_notes` | TEXT | NULLABLE | Feedback from management |
| `actioned_by` | INTEGER | FOREIGN KEY (users.id) | Manager who reviewed request |
| `actioned_date` | DATE | NULLABLE | Date of review |

### 2.8 Audit Log (`audit_log`)
Immutable record of all state-changing operations in the system.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | INTEGER | PRIMARY KEY, AUTOINCREMENT | Log ID |
| `user_id` | INTEGER | NOT NULL | ID of user performing action |
| `username` | TEXT | NOT NULL | Name of user performing action |
| `action` | TEXT | NOT NULL | CREATE, UPDATE, DELETE, LOGIN |
| `table_name` | TEXT | NOT NULL | Target table affected |
| `record_id` | TEXT | NOT NULL | ID of the record affected |
| `details` | TEXT | NOT NULL | Descriptive log message |
| `timestamp` | DATETIME | DEFAULT CURRENT_TIMESTAMP | Event timestamp |

---

## 3. Data Integrity Rules

1. **Foreign Key Enforcement**: SQLite `PRAGMA foreign_keys = ON` is enabled to prevent orphaned records.
2. **Cascading Actions**: Deleting a user or asset is restricted if active assignments or maintenance records exist.
3. **Status Synchronization**: Updating an asset's status to 'Disposed' automatically terminates active assignments.
4. **Audit Immutability**: The `audit_log` table is designed for append-only operations.

---

## 4. Performance Optimization

- **Indexing**: Primary keys are automatically indexed. Additional indices are recommended for `assets.status` and `assignments.asset_id` for faster reporting.
- **SQLite Optimization**: The database uses Write-Ahead Logging (WAL) mode for better concurrency during high-frequency audit logging.

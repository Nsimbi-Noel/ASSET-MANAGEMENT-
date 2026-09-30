// ================= SHARED CONSTANTS =================
// Single source of truth for every enumerated value, magic number and
// formatting convention that was previously duplicated across db.js,
// controller.js, seed.js and the frontend. Nothing here imports other
// project modules so this can be required from anywhere (including db.js
// at schema-creation time) without creating a require cycle.

const path = require('path');

// --- Roles ---
const ROLES = {
  ADMIN: 'Admin',
  ASSET_MANAGER: 'AssetManager',
  EMPLOYEE: 'Employee'
};
const ROLE_VALUES = Object.values(ROLES);

// --- Asset lifecycle ---
const ASSET_STATUS = {
  ACTIVE: 'Active',
  IN_STORAGE: 'In Storage',
  UNDER_MAINTENANCE: 'Under Maintenance',
  DISPOSED: 'Disposed'
};
const ASSET_STATUS_VALUES = Object.values(ASSET_STATUS);

// Statuses an asset can be moved to once maintenance completes. A closed
// maintenance event cannot put an asset back "Under Maintenance".
const POST_MAINTENANCE_STATUS_VALUES = [
  ASSET_STATUS.ACTIVE,
  ASSET_STATUS.IN_STORAGE,
  ASSET_STATUS.DISPOSED
];

const ASSET_CONDITION = {
  NEW: 'New',
  GOOD: 'Good',
  REFURBISHED: 'Refurbished',
  DAMAGED: 'Damaged'
};
const ASSET_CONDITION_VALUES = Object.values(ASSET_CONDITION);

const ASSET_SOURCE = {
  PROCUREMENT: 'Procurement',
  DONATION: 'Donation',
  LEASE: 'Lease',
  OTHER: 'Other'
};
const ASSET_SOURCE_VALUES = Object.values(ASSET_SOURCE);

const DISPOSAL_METHODS = ['Scrapped', 'Auctioned', 'Donated', 'Destroyed'];
const DEFAULT_DISPOSAL_METHOD = DISPOSAL_METHODS[0];

// Categories are free-form in the DB (no CHECK constraint) so integrators can
// add their own; these are the values the UI offers.
const ASSET_CATEGORIES = [
  'IT Equipment', 'Office Equipment', 'Furniture', 'Fittings', 'IT Infrastructure', 'Vehicles', 'Other'
];

// --- Users ---
const USER_STATUS = { ACTIVE: 'Active', INACTIVE: 'Inactive' };
const USER_STATUS_VALUES = Object.values(USER_STATUS);

// --- Assignments ---
const ASSIGNMENT_STATUS = { ACTIVE: 'Active', RETURNED: 'Returned' };
const ASSIGNMENT_STATUS_VALUES = Object.values(ASSIGNMENT_STATUS);

// --- Requests ---
const REQUEST_STATUS = {
  PENDING: 'Pending',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  REVOKED: 'Revoked'
};
const REQUEST_STATUS_VALUES = Object.values(REQUEST_STATUS);
// Statuses a manager may set when actioning a request.
const REQUEST_ACTION_VALUES = [REQUEST_STATUS.APPROVED, REQUEST_STATUS.REJECTED];

const RECEIVED_STATUS = {
  PENDING: 'Pending',
  RECEIVED: 'Received',
  NOT_RECEIVED: 'Not Received'
};
const RECEIVED_STATUS_VALUES = Object.values(RECEIVED_STATUS);

// --- Maintenance (frontend-only states, kept here so both sides agree) ---
const MAINTENANCE_PROGRESS = {
  READY_FOR_REVIEW: 'Ready for Review',
  DUE_TODAY: 'Due Today',
  OVERDUE: 'Overdue',
  COMPLETED: 'Completed'
};
const MAINTENANCE_PROGRESS_VALUES = Object.values(MAINTENANCE_PROGRESS);

// --- Naming / formatting conventions ---
const ASSET_ID_PREFIX = 'AMS-AST-';
const ASSET_ID_PAD = 4;
const CURRENCY = 'UGX';
const DEFAULT_LOCALE = 'en-UG';

// --- Security / limits ---
const PASSWORD_MIN_LENGTH = 6;
const DEFAULT_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_BODY_SIZE = 1024 * 1024;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_RATE_LIMIT_MAX = 10;

// --- Filesystem defaults (kept here so server.js and db.js cannot drift) ---
const DEFAULT_DB_PATH = path.join(__dirname, 'data', 'database.db');
const PUBLIC_DIR = path.join(__dirname, 'public');

/**
 * Build a SQLite CHECK constraint from a list of allowed values.
 * Escapes single quotes so a value containing one cannot break the DDL.
 */
function sqlEnum(values) {
  return values.map(v => `'${String(v).replace(/'/g, "''")}'`).join(', ');
}

/**
 * Build a human-readable "Must be A, B, or C." fragment for error messages,
 * so validation text is derived from the same list it validates against.
 */
function humanList(values) {
  if (values.length === 0) return '';
  if (values.length === 1) return values[0];
  return `${values.slice(0, -1).join(', ')}, or ${values[values.length - 1]}`;
}

function assertOneOf(field, value, allowed) {
  if (!allowed.includes(value)) {
    throw new Error(`Invalid ${field}. Must be ${humanList(allowed)}.`);
  }
  return value;
}

module.exports = {
  ROLES,
  ROLE_VALUES,
  ASSET_STATUS,
  ASSET_STATUS_VALUES,
  POST_MAINTENANCE_STATUS_VALUES,
  ASSET_CONDITION,
  ASSET_CONDITION_VALUES,
  ASSET_SOURCE,
  ASSET_SOURCE_VALUES,
  DISPOSAL_METHODS,
  DEFAULT_DISPOSAL_METHOD,
  ASSET_CATEGORIES,
  USER_STATUS,
  USER_STATUS_VALUES,
  ASSIGNMENT_STATUS,
  ASSIGNMENT_STATUS_VALUES,
  REQUEST_STATUS,
  REQUEST_STATUS_VALUES,
  REQUEST_ACTION_VALUES,
  RECEIVED_STATUS,
  RECEIVED_STATUS_VALUES,
  MAINTENANCE_PROGRESS,
  MAINTENANCE_PROGRESS_VALUES,
  ASSET_ID_PREFIX,
  ASSET_ID_PAD,
  CURRENCY,
  DEFAULT_LOCALE,
  PASSWORD_MIN_LENGTH,
  DEFAULT_SESSION_TTL_MS,
  DEFAULT_MAX_BODY_SIZE,
  DEFAULT_RATE_LIMIT_WINDOW_MS,
  DEFAULT_RATE_LIMIT_MAX,
  DEFAULT_DB_PATH,
  PUBLIC_DIR,
  sqlEnum,
  humanList,
  assertOneOf
};

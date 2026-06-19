# URSB Asset Management System (AMS) - Refined Edition

A comprehensive Node.js-based asset management system for the Uganda Registration Services Bureau (URSB), designed to track, manage, and maintain institutional assets with role-based access control and detailed audit trails.

## 🎯 Project Overview

The URSB Asset Management System provides a complete solution for managing organizational assets including IT equipment, office furniture, infrastructure, and other institutional resources. The system supports complex workflows including asset registration, assignment, transfers, maintenance tracking, and disposal management.

### Key Features

- **Role-Based Access Control (RBAC)**: Admin, AssetManager, AssetCustodian, and Employee roles
- **Asset Lifecycle Management**: Registration, assignment, transfer, maintenance, and disposal
- **Real-time Dashboard**: Visual metrics and asset status overview
- **Comprehensive Audit Trail**: Complete system audit logs for compliance and accountability
- **Asset History Tracking**: Full lifecycle history for each asset
- **Maintenance Scheduling**: Track and manage asset maintenance schedules
- **Request Management**: Employees can request assets; managers can approve/reject
- **Transfer Management**: Track asset transfers between custodians
- **Advanced Reporting**: Asset register with filtering, dashboard metrics, and audit logs

## 🏗️ System Architecture

### Technology Stack

- **Backend**: Node.js with native SQLite database
- **Frontend**: Vanilla JavaScript with HTML5/CSS3
- **Database**: SQLite (file-based, no external dependencies)
- **Authentication**: Session-based with secure password hashing

### Database Schema

The system uses 9 main tables:

1. **users** - System user accounts with roles and departments
2. **assets** - Asset inventory with detailed specifications
3. **assignments** - Asset handover records to custodians
4. **transfers** - Asset movement between custodians
5. **maintenance** - Asset maintenance and service records
6. **disposals** - Asset disposal archive
7. **requests** - Employee asset requests
8. **audit_log** - Complete system audit trail
9. **sessions** - Active user sessions

## 📊 Sample Data

The system includes comprehensive sample data with:

- **35 Users**: Mix of Admin, AssetManagers, AssetCustodians, and Employees across 8 departments
- **50 Assets**: Diverse asset types including IT equipment, furniture, infrastructure, and office equipment
- **25 Assignments**: Active asset assignments to custodians
- **15 Maintenance Records**: Various maintenance and service scenarios
- **5 Disposal Records**: Asset disposal history
- **10 Requests**: Pending, approved, and rejected asset requests

### User Credentials

Default seeded users include:

```
Admin Account:
  Username: admin
  Password: admin123
  Role: Admin
  Department: Information Technology

Asset Manager:
  Username: manager1
  Password: manager1123
  Role: AssetManager
  Department: Administration

Asset Custodian:
  Username: custodian1
  Password: custodian1123
  Role: AssetCustodian
  Department: Finance

Employee:
  Username: employee1
  Password: employee1123
  Role: Employee
  Department: Registries
```

Additional users (manager2-3, custodian2-8, employee2-23) are automatically seeded.

## 🚀 Getting Started

### Prerequisites

- Node.js 22.x or higher
- npm or yarn package manager

### Installation

1. **Extract the project**:
   ```bash
   unzip ursb-ams-source.zip
   cd ursb-ams
   ```

2. **Install dependencies** (if needed):
   ```bash
   npm install
   ```

3. **Initialize database and seed sample data**:
   ```bash
   node seed.js
   ```

4. **Start the server**:
   ```bash
   node server.js
   ```

5. **Access the application**:
   - Open your browser and navigate to `http://localhost:3000`
   - Log in with any of the seeded user credentials

## 📡 API Endpoints

### Authentication

- `POST /api/auth/login` - User login
- `POST /api/auth/logout` - User logout
- `GET /api/auth/session` - Get current session details

### User Management (Admin Only)

- `GET /api/users` - List all users
- `POST /api/users` - Create new user
- `PUT /api/users/:id` - Update user details
- `PUT /api/users/:id/password` - Change user password

### Asset Management

- `GET /api/assets` - List all assets
- `GET /api/assets/:id` - Get asset details
- `POST /api/assets` - Register new asset (AssetManager only)

### Asset Assignments

- `GET /api/assignments` - List all assignments
- `POST /api/assignments` - Assign asset to custodian (AssetManager only)
- `PUT /api/assignments/:id/confirm` - Confirm receipt of asset
- `PUT /api/assignments/:id/return` - Return asset to storage (AssetManager only)

### Asset Transfers

- `GET /api/transfers` - List all asset transfers
- `POST /api/transfers` - Transfer asset between custodians (AssetManager only)

### Maintenance

- `POST /api/maintenance` - Record maintenance event (AssetManager only)
- `PUT /api/maintenance/:id/complete` - Mark maintenance as complete (AssetManager only)

### Disposals

- `POST /api/disposals` - Dispose of asset (AssetManager only)

### Asset Requests

- `GET /api/requests` - List asset requests
- `POST /api/requests` - Submit asset request (Employees)
- `PUT /api/requests/:id/action` - Action on request (AssetManager only)

### Reports & Analytics

- `GET /api/reports/dashboard` - Dashboard metrics and statistics
- `GET /api/reports/register` - Asset register with filters
- `GET /api/reports/history/:assetId` - Complete asset history
- `GET /api/reports/audits` - System audit logs (Admin/AssetManager only)

## 🔐 Role-Based Access Control

### Admin
- Full system access
- User account management
- View audit logs
- Access all reports

### AssetManager
- Asset registration and management
- Asset assignment and transfers
- Maintenance scheduling
- Asset disposal
- Request approval/rejection
- View audit logs

### AssetCustodian
- View assigned assets
- Confirm asset receipt
- Submit asset requests
- View asset details

### Employee
- View asset inventory
- Submit asset requests
- View own requests

## 🔄 Refinements Implemented

### Backend Enhancements

1. **New Transfers API Endpoint**: Added `GET /api/transfers` for proper transfer tracking instead of relying on audit logs
2. **Improved Error Handling**: Enhanced validation and error messages across all endpoints
3. **SQL Query Fixes**: Corrected quote handling in dashboard metrics queries
4. **Transaction Support**: Proper database transactions for multi-step operations

### Frontend Improvements

1. **Dashboard Visualization**: Canvas-based charts showing asset distribution by status and category
2. **Responsive Design**: Mobile-friendly interface with proper layout
3. **Enhanced Navigation**: Role-based sidebar navigation
4. **Real-time Alerts**: Maintenance due notifications
5. **Improved Data Display**: Better formatting and filtering options

### Data Model Enhancements

1. **Diverse Asset Types**: 30+ different asset types across multiple categories
2. **Realistic Scenarios**: Complex assignment, transfer, and maintenance workflows
3. **Comprehensive User Base**: 35 users with various roles and departments
4. **Historical Data**: Complete audit trail and transaction history

## 📋 File Structure

```
ursb-ams/
├── server.js              # Main HTTP server and routing
├── controller.js          # Business logic and database operations
├── db.js                  # Database initialization and schema
├── crypto_utils.js        # Password hashing utilities
├── seed.js                # Database seeding script
├── database.db            # SQLite database file
├── public/
│   ├── index.html         # Main HTML interface
│   ├── app.js             # Frontend application logic
│   └── styles.css         # Application styling
└── README.md              # This file
```

## 🧪 Testing the System

### Quick Test

1. Start the server: `node server.js`
2. Log in with admin credentials
3. Navigate through different views:
   - **Dashboard**: View overall asset metrics
   - **Asset Register**: Browse all assets with filtering
   - **Assignments**: View active asset assignments
   - **Transfers**: Track asset movements between custodians
   - **Maintenance**: View and manage maintenance schedules
   - **Disposals**: View disposed assets archive
   - **Requests**: Manage asset requests
   - **Users**: Manage system users (Admin only)
   - **Audit Logs**: Review system activity

### API Testing

Use curl or Postman to test API endpoints:

```bash
# Login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'

# Get assets
curl -X GET http://localhost:3000/api/assets \
  -H "Authorization: Bearer <session_id>"

# Get dashboard metrics
curl -X GET http://localhost:3000/api/reports/dashboard \
  -H "Authorization: Bearer <session_id>"
```

## 🔧 Customization

### Adding New Users

Edit `seed.js` to add more users or modify existing ones:

```javascript
insertUser.run('username', hashPassword('password'), 'Full Name', 'Role', 'Department');
```

### Adding New Assets

Modify the asset generation in `seed.js` or use the UI to register assets manually.

### Changing Database

To use a different database, modify `db.js` to connect to your preferred database system.

## 📝 Notes

- The database file (`database.db`) is created automatically on first run
- All passwords are hashed using bcrypt-like algorithms
- Session tokens expire after 24 hours
- The system maintains a complete audit trail of all operations
- Foreign key constraints are enforced for data integrity

## 🐛 Troubleshooting

### Server won't start
- Ensure Node.js 22.x is installed
- Check that port 3000 is not in use
- Verify all files are present in the project directory

### Login fails
- Verify credentials match the seeded users
- Check that the database was properly initialized with `node seed.js`
- Ensure the session cookie is being sent with requests

### Assets not appearing
- Confirm the database was seeded: `node seed.js`
- Check that the user has appropriate permissions
- Verify the asset status is not "Disposed" (unless viewing disposals)

## 📞 Support

For issues or questions about the URSB Asset Management System, please refer to the system documentation or contact the IT department.

## 📄 License

This system is proprietary to the Uganda Registration Services Bureau.

---

**Version**: 2.0 (Refined Edition)  
**Last Updated**: June 18, 2026  
**Database Records**: 35 users, 50 assets, 25+ transactions

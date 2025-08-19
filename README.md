# Kanban Project Management Tool

A single-page web application for managing projects through a 5-phase Kanban board with real-time collaboration using Firebase.

## Features

- **5-Phase Kanban Board**: Ideas → Discovery → Planning → Ready for Delivery → Delivery
- **Drag & Drop**: Move projects between phases with automatic validation
- **Phase Transition Validation**: Enforces required artifacts for each phase transition
- **Real-time Collaboration**: Multiple users can work simultaneously with instant updates
- **Project Management**: Full CRUD operations with detailed project tracking
- **Discovery Validation**: 4-point validation checklist (Value, Usability, Feasibility, Viability)
- **Artifact Management**: URL tracking for phase-specific documents
- **Phase History**: Complete audit trail of project progression

## Setup Instructions

### 1. Firebase Project Setup

1. Go to the [Firebase Console](https://console.firebase.google.com/)
2. Create a new project or use an existing one
3. Enable **Realtime Database**:
   - Go to "Realtime Database" in the left sidebar
   - Click "Create Database"
   - Choose "Start in test mode" for development (configure security rules later)
   - Select a location for your database

### 2. Firebase Configuration

1. In your Firebase project, go to "Project Settings" (gear icon)
2. In the "General" tab, scroll down to "Your apps"
3. Click "Add app" and select the web icon (`</>`)
4. Register your app with a nickname
5. Copy the Firebase configuration object

### 3. Update Configuration

1. Open `app.js` in your project
2. Replace the `firebaseConfig` object (lines 2-10) with your Firebase configuration:

```javascript
const firebaseConfig = {
    apiKey: "your-actual-api-key",
    authDomain: "your-project-id.firebaseapp.com",
    databaseURL: "https://your-project-id-default-rtdb.firebaseio.com/",
    projectId: "your-project-id",
    storageBucket: "your-project-id.appspot.com",
    messagingSenderId: "your-sender-id",
    appId: "your-app-id"
};
```

### 4. Database Rules (Optional)

For development, you can use these permissive rules in your Firebase Realtime Database:

```json
{
  "rules": {
    ".read": true,
    ".write": true
  }
}
```

For production, implement proper authentication and security rules.

### 5. Running the Application

1. Simply open `index.html` in your web browser
2. The application will automatically connect to Firebase
3. You can deploy to any static hosting service or use Firebase Hosting

### Firebase Hosting Deployment (Optional)

1. Install Firebase CLI: `npm install -g firebase-tools`
2. Login: `firebase login`
3. Initialize: `firebase init hosting`
4. Deploy: `firebase deploy`

## Usage

### Creating Projects
- Click "New Project" button
- Fill in project details (title is required)
- Select initial phase and priority
- Assign team members

### Managing Projects
- **View Details**: Click on any project card
- **Edit Project**: Click "Edit" in project detail modal
- **Delete Project**: Click "Delete" in project detail modal (requires confirmation)

### Phase Transitions
- **Drag & Drop**: Drag project cards between columns
- **Automatic Validation**: System checks for required artifacts
- **Transition Modal**: Fill in missing artifacts when prompted
- **Auto-Transition**: Skip modal if all requirements are met

### Required Artifacts by Phase

- **Ideas → Discovery**: Discovery Plan URL
- **Discovery → Planning**: Product Requirements URL, Discovery Notes URL (optional)
- **Planning → Ready**: PPC Deck URL, PPC Meeting Date
- **Ready → Delivery**: Release Date, Project Plan URL, GTM Plan URL

### Discovery Validation
For projects in Discovery phase, track the 4-point validation:
- **V**: Value - Is this valuable?
- **U**: Usability - Can customers use it?
- **F**: Feasibility - Can we build it?
- **Vi**: Viability - Will this work for our business?

## Technical Architecture

- **Frontend**: Vanilla JavaScript, HTML5, CSS3
- **Backend**: Firebase Realtime Database
- **Real-time**: Firebase listeners for instant collaboration
- **Drag & Drop**: HTML5 Drag and Drop API
- **Responsive**: Mobile-friendly design

## Data Structure

Projects are stored in Firebase with this structure:
```javascript
{
  "projects": {
    "projectId": {
      "id": "projectId",
      "title": "Project Name",
      "phase": "discovery",
      "priority": 50,
      "pm_owner": "Jane Smith",
      "dev_lead": "John Doe",
      "ux_lead": "Sarah Johnson",
      "artifacts": {
        "discovery_plan_url": "https://...",
        "product_requirements_url": "https://..."
      },
      "discovery_validation": {
        "value": true,
        "usability": false,
        "feasibility": true,
        "viability": false
      },
      "phase_history": {
        "0": {
          "phase": "idea",
          "entered_at": "2024-01-01T10:00:00Z",
          "entered_by": "user"
        }
      }
    }
  }
}
```

## Browser Compatibility

- Chrome 60+
- Firefox 55+
- Safari 12+
- Edge 79+

## Performance

- Supports 500+ projects
- Real-time updates < 100ms
- Optimistic UI updates
- Efficient Firebase queries

## Security

- Configure Firebase security rules for production
- All data is stored in Firebase (no local storage of sensitive data)
- URLs are validated before storage

## Support

For issues and questions, please refer to the product requirements document or create an issue in your project repository.
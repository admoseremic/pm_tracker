// Firebase Configuration
const firebaseConfig = {
    apiKey: "AIzaSyBoeyCEAO_uko1zuOSdifeU1n1fLr9YiRI",
    authDomain: "pm-kanban.firebaseapp.com",
    databaseURL: "https://pm-kanban-default-rtdb.firebaseio.com",
    projectId: "pm-kanban",
    storageBucket: "pm-kanban.firebasestorage.app",
    messagingSenderId: "381567178818",
    appId: "1:381567178818:web:51e6596a7fc0a899eff5db"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const database = firebase.database();

// Global variables
let projects = {};
let transitionProject = null;
let sortableInstances = {};
let currentFilters = {};
let filteredProjects = {};

// Phase configuration
const PHASES = {
    idea: { name: 'Ideas', color: '#e3f2fd' },
    discovery: { name: 'Discovery', color: '#f3e5f5' },
    planning: { name: 'Planning', color: '#e8f5e8' },
    ready: { name: 'Ready for Delivery', color: '#fff3e0' },
    delivery: { name: 'Delivery', color: '#ffebee' }
};

// Phase transition requirements
const TRANSITION_REQUIREMENTS = {
    'idea-discovery': [
        { key: 'discovery_plan_url', label: 'Discovery Plan URL', type: 'url', required: true }
    ],
    'discovery-planning': [
        { key: 'product_requirements_url', label: 'Product Requirements URL', type: 'url', required: true },
        { key: 'discovery_notes_url', label: 'Discovery Notes URL', type: 'url', required: false }
    ],
    'planning-ready': [
        { key: 'ppc_deck_url', label: 'PPC Deck URL', type: 'url', required: true },
        { key: 'ppc_meeting_date', label: 'PPC Meeting Date', type: 'date', required: true }
    ],
    'ready-delivery': [
        { key: 'release_date', label: 'Release Date', type: 'date', required: true },
        { key: 'project_plan_url', label: 'Project Plan URL', type: 'url', required: true },
        { key: 'gtm_plan_url', label: 'GTM Plan URL', type: 'url', required: true }
    ]
};

// Initialize the application
document.addEventListener('DOMContentLoaded', function() {
    setupEventListeners();
    setupConnectionMonitoring();
    loadProjects();
});

// Setup event listeners
function setupEventListeners() {
    // Close modals when clicking outside
    document.addEventListener('click', function(e) {
        if (e.target.classList.contains('modal')) {
            closeModal(e.target.id);
        }
    });

    // Close modals with ESC key
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            closeAllModals();
        }
    });

    // Initialize SortableJS for each column
    initializeSortableColumns();
    
    // Setup filter event listeners
    setupFilterEventListeners();
    
    // Setup engineering teams input
    setupEngineeringTeamsInput();
}

// Setup filter event listeners
function setupFilterEventListeners() {
    // Filter dropdowns
    document.getElementById('filter-engineering-team').addEventListener('change', applyFilters);
    document.getElementById('filter-pm-owner').addEventListener('change', applyFilters);
}

// Setup Firebase connection monitoring
function setupConnectionMonitoring() {
    const connectedRef = database.ref('.info/connected');
    const statusElement = document.getElementById('connection-status');
    const statusText = statusElement?.querySelector('.connection-text');
    
    connectedRef.on('value', (snapshot) => {
        const isConnected = snapshot.val() === true;
        console.log('Firebase connection status:', isConnected ? 'Connected' : 'Disconnected');
        
        // Update visual connection status
        if (statusElement) {
            if (isConnected) {
                statusElement.className = 'connection-status connected';
                if (statusText) statusText.textContent = 'Connected';
            } else {
                statusElement.className = 'connection-status disconnected';
                if (statusText) statusText.textContent = 'Disconnected';
            }
        }
        
        if (isConnected) {
            // When reconnected, ensure data is fresh
            console.log('Firebase reconnected - refreshing data');
            
            // Force a data refresh when reconnecting
            database.ref('projects').once('value', (projectSnapshot) => {
                const freshProjects = projectSnapshot.val() || {};
                if (Object.keys(freshProjects).length > 0) {
                    projects = freshProjects;
                    
                    // Refresh filter dropdowns with the latest data
                    updateFilterOptions();
                    
                    // Reapply current filters
                    applyFilters();
                } else {
                    // Even if no projects, still update filter options to clear them
                    updateFilterOptions();
                }
            });
        } else {
            console.log('Firebase disconnected - will reconnect automatically');
        }
    });
    
    // Also set up presence system to keep connection alive
    database.goOnline();
}

// Initialize SortableJS for all columns
function initializeSortableColumns() {
    Object.keys(PHASES).forEach(phase => {
        const columnElement = document.getElementById(`column-${phase}`);
        if (columnElement && !sortableInstances[phase]) {
            sortableInstances[phase] = new Sortable(columnElement, {
                group: 'kanban', // Allow dragging between columns
                animation: 300, // Smooth animation
                ghostClass: 'sortable-ghost',
                chosenClass: 'sortable-chosen', 
                dragClass: 'sortable-drag',
                fallbackClass: 'sortable-fallback',
                forceFallback: false, // Use native HTML5 DnD when possible
                scroll: true,
                scrollSensitivity: 100,
                scrollSpeed: 20,
                
                // Callback when drag starts
                onStart: function(evt) {
                    // Add visual feedback to all columns
                    Object.keys(PHASES).forEach(p => {
                        const col = document.getElementById(`column-${p}`);
                        if (col && p !== phase) {
                            col.closest('.kanban-column').classList.add('column-drag-over');
                        }
                    });
                },
                
                // Callback when drag ends
                onEnd: function(evt) {
                    // Remove visual feedback from all columns
                    Object.keys(PHASES).forEach(p => {
                        const col = document.getElementById(`column-${p}`);
                        if (col) {
                            col.closest('.kanban-column').classList.remove('column-drag-over');
                        }
                    });
                    
                    // Handle the reordering
                    handleSortableMove(evt);
                }
            });
        }
    });
}

// Handle SortableJS move event
function handleSortableMove(evt) {
    const projectId = evt.item.dataset.projectId;
    const newPhase = evt.to.closest('.kanban-column').dataset.phase;
    const oldPhase = evt.from.closest('.kanban-column').dataset.phase;
    const newIndex = evt.newIndex;
    
    if (!projectId || !projects[projectId]) {
        console.error('Invalid project or project not found:', projectId);
        return;
    }
    
    // Get the visible cards in the target column to determine reference points
    const visibleCards = Array.from(evt.to.children);
    const cardAbove = newIndex > 0 ? visibleCards[newIndex - 1] : null;
    const cardBelow = visibleCards[newIndex + 1] || null; // Card that was pushed down
    
    console.log(`Moving ${projects[projectId].title} from ${oldPhase} to ${newPhase} at visual position ${newIndex + 1}`);
    
    // If moving to a different phase, check transition requirements
    if (oldPhase !== newPhase) {
        const transitionKey = `${oldPhase}-${newPhase}`;
        const requirements = TRANSITION_REQUIREMENTS[transitionKey];
        
        if (requirements && !checkTransitionRequirements(projects[projectId], requirements)) {
            // Revert the move and show transition modal
            evt.item.remove(); // Remove from new position
            evt.from.insertBefore(evt.item, evt.from.children[evt.oldIndex]); // Put back in old position
            showPhaseTransitionModal(projects[projectId], newPhase, requirements);
            return;
        }
    }
    
    // Pass reference cards for smart priority assignment
    const referenceAboveId = cardAbove ? cardAbove.dataset.projectId : null;
    const referenceBelowId = cardBelow ? cardBelow.dataset.projectId : null;
    
    // Handle the reordering with batch updates
    handleSortableReorder(projectId, newPhase, newIndex, referenceAboveId, referenceBelowId);
}

// Handle reordering after SortableJS move
function handleSortableReorder(projectId, targetPhase, newIndex, referenceAboveId, referenceBelowId) {
    const draggedProject = projects[projectId];
    if (!draggedProject) return;
    
    // Get all projects in the target phase (excluding the dragged one)
    let phaseProjects = Object.values(projects)
        .filter(p => p.phase === targetPhase && p.id !== projectId)
        .sort((a, b) => (a.priority || 999999) - (b.priority || 999999));
    
    // Determine the target priority based on reference cards
    let targetPriority;
    const now = new Date().toISOString();
    const updates = {};
    
    if (phaseProjects.length === 0) {
        // First project in this phase
        targetPriority = 1;
    } else if (!referenceAboveId && !referenceBelowId) {
        // Edge case: no reference points (shouldn't happen in normal operation)
        targetPriority = newIndex + 1;
    } else if (!referenceAboveId) {
        // Placed at the top - set priority to be less than the card below
        const belowPriority = projects[referenceBelowId]?.priority || 1;
        targetPriority = Math.max(1, belowPriority - 1);
        
        // Shift all projects with priority >= targetPriority up by 1
        phaseProjects.forEach(project => {
            if (project.priority >= targetPriority) {
                updates[`projects/${project.id}/priority`] = project.priority + 1;
                updates[`projects/${project.id}/updated_at`] = now;
            }
        });
    } else if (!referenceBelowId) {
        // Placed at the bottom - set priority to be greater than the card above
        const abovePriority = projects[referenceAboveId]?.priority || 1;
        targetPriority = abovePriority + 1;
        
        // Shift all projects with priority > abovePriority up by 1
        phaseProjects.forEach(project => {
            if (project.priority > abovePriority) {
                updates[`projects/${project.id}/priority`] = project.priority + 1;
                updates[`projects/${project.id}/updated_at`] = now;
            }
        });
    } else {
        // Placed between two cards
        const abovePriority = projects[referenceAboveId]?.priority || 1;
        const belowPriority = projects[referenceBelowId]?.priority || abovePriority + 2;
        const originalPriority = draggedProject.priority || 999999;
        
        if (belowPriority - abovePriority === 1) {
            // No gap - need to make room
            targetPriority = belowPriority;
            
            // Shift all projects with priority >= belowPriority up by 1
            phaseProjects.forEach(project => {
                if (project.priority >= belowPriority) {
                    updates[`projects/${project.id}/priority`] = project.priority + 1;
                    updates[`projects/${project.id}/updated_at`] = now;
                }
            });
        } else {
            // There's a gap - determine position based on movement direction
            const movingUp = originalPriority > belowPriority;
            
            if (movingUp) {
                // Moving up - place immediately above the reference card below
                targetPriority = belowPriority - 1;
            } else {
                // Moving down - place immediately below the reference card above
                targetPriority = abovePriority + 1;
            }
        }
    }
    
    // Update the dragged project
    updates[`projects/${projectId}/priority`] = targetPriority;
    updates[`projects/${projectId}/updated_at`] = now;
    
    if (draggedProject.phase !== targetPhase) {
        // Add phase change updates
        const phaseHistory = draggedProject.phase_history || {};
        const newHistoryKey = Object.keys(phaseHistory).length.toString();
        phaseHistory[newHistoryKey] = {
            phase: targetPhase,
            entered_at: now,
            entered_by: 'user'
        };
        
        updates[`projects/${projectId}/phase`] = targetPhase;
        updates[`projects/${projectId}/phase_history`] = phaseHistory;
    }
    
    // Apply all updates atomically
    if (Object.keys(updates).length > 0) {
        console.log(`Batch updating ${Object.keys(updates).length / 2} projects in ${targetPhase}`);
        database.ref().update(updates);
    }
}

// Load projects from Firebase
function loadProjects() {
    database.ref('projects').on('value', (snapshot) => {
        projects = snapshot.val() || {};
        
        // Fix any negative or problematic priorities
        fixProjectPriorities();
        
        // Update filter options based on current data
        updateFilterOptions();
        
        // Apply current filters and render
        applyFilters();
    });
}

// Update filter dropdown options based on current data
function updateFilterOptions() {
    // Check if we have projects data
    if (!projects || Object.keys(projects).length === 0) {
        console.log('No projects data available for filter options');
        // Still initialize empty dropdowns
        updateFilterDropdown('filter-engineering-team', new Set(), 'All Teams');
        updateFilterDropdown('filter-pm-owner', new Set(), 'All PM Owners');
        return;
    }
    
    const engineeringTeams = new Set();
    const pmOwners = new Set();
    
    Object.values(projects).forEach(project => {
        if (project.engineering_teams && Array.isArray(project.engineering_teams)) {
            project.engineering_teams.forEach(team => {
                if (team && team.trim()) {
                    engineeringTeams.add(team.trim());
                }
            });
        }
        if (project.pm_owner && project.pm_owner.trim()) {
            pmOwners.add(project.pm_owner.trim());
        }
    });
    
    console.log(`Updating filter options: ${engineeringTeams.size} Teams, ${pmOwners.size} PMs`);
    
    // Update dropdowns
    updateFilterDropdown('filter-engineering-team', engineeringTeams, 'All Teams');
    updateFilterDropdown('filter-pm-owner', pmOwners, 'All PM Owners');
}

// Update a specific filter dropdown with options
function updateFilterDropdown(elementId, optionsSet, defaultText) {
    const select = document.getElementById(elementId);
    const currentValue = select.value;
    
    // Clear existing options except the first one
    select.innerHTML = `<option value="">${defaultText}</option>`;
    
    // Add sorted options
    const sortedOptions = Array.from(optionsSet).sort();
    sortedOptions.forEach(option => {
        const optionElement = document.createElement('option');
        optionElement.value = option;
        optionElement.textContent = option;
        select.appendChild(optionElement);
    });
    
    // Restore previous selection if it still exists
    if (currentValue && sortedOptions.includes(currentValue)) {
        select.value = currentValue;
    }
}

// Apply current filters to projects
function applyFilters() {
    // Get current filter values
    const filters = {
        engineering_team: document.getElementById('filter-engineering-team').value,
        pm_owner: document.getElementById('filter-pm-owner').value,
    };
    
    currentFilters = filters;
    
    // Filter projects
    filteredProjects = {};
    Object.values(projects).forEach(project => {
        if (passesFilters(project, filters)) {
            filteredProjects[project.id] = project;
        }
    });
    
    // Render filtered projects
    renderProjects();
    updateProjectCounts();
    updateFilterStatus();
}

// Check if a project passes the current filters (INTERSECTION/AND logic)
function passesFilters(project, filters) {
    // All filters must pass for the project to be included (AND logic)
    
    // Engineering Team filter - project must include the selected team
    if (filters.engineering_team) {
        if (!project.engineering_teams || !Array.isArray(project.engineering_teams)) {
            return false;
        }
        if (!project.engineering_teams.includes(filters.engineering_team)) {
            return false;
        }
    }
    
    // PM Owner filter - project must match selected PM owner
    if (filters.pm_owner && project.pm_owner !== filters.pm_owner) {
        return false;
    }
    
    
    // If we get here, the project passes all active filters
    return true;
}

// Update filter status display
function updateFilterStatus() {
    const totalProjects = Object.keys(projects).length;
    const filteredCount = Object.keys(filteredProjects).length;
    const statusElement = document.getElementById('filter-status');
    
    // Build list of active filters for display
    const activeFilters = [];
    if (currentFilters.pm_owner) activeFilters.push(`PM: ${currentFilters.pm_owner}`);
    if (currentFilters.engineering_team) activeFilters.push(`Team: ${currentFilters.engineering_team}`);
    
    if (totalProjects === filteredCount) {
        statusElement.textContent = `Showing all ${totalProjects} projects`;
    } else {
        const filterText = activeFilters.length > 0 ? ` (${activeFilters.join(' + ')})` : '';
        statusElement.textContent = `Showing ${filteredCount} of ${totalProjects} projects${filterText}`;
    }
}

// Clear all filters
function clearAllFilters(skipApply = false) {
    document.getElementById('filter-engineering-team').value = '';
    document.getElementById('filter-pm-owner').value = '';
    
    // Clear any active quick filter buttons
    document.querySelectorAll('.quick-filter-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    
    if (!skipApply) {
        applyFilters();
    }
}

// Fix negative or problematic priorities - renumber to 1, 2, 3...
function fixProjectPriorities() {
    const updates = {};
    let needsFix = false;
    
    // Check each phase
    Object.keys(PHASES).forEach(phase => {
        const phaseProjects = Object.values(projects)
            .filter(p => p.phase === phase)
            .sort((a, b) => {
                // Sort by existing priority, treating invalid as very high
                const aPriority = (typeof a.priority === 'number') ? a.priority : 999999;
                const bPriority = (typeof b.priority === 'number') ? b.priority : 999999;
                return aPriority - bPriority;
            });
        
        // Check if renumbering is needed (gaps, negatives, or duplicates)
        let expectedPriority = 1;
        const needsRenumber = phaseProjects.some(p => {
            const result = p.priority !== expectedPriority++;
            return result;
        });
        
        if (needsRenumber && phaseProjects.length > 0) {
            needsFix = true;
            console.log(`Renumbering priorities for phase: ${phase}`);
            
            // Assign clean 1, 2, 3... priorities
            phaseProjects.forEach((project, index) => {
                const newPriority = index + 1;
                updates[`projects/${project.id}/priority`] = newPriority;
                // Update local copy immediately
                projects[project.id].priority = newPriority;
            });
        }
    });
    
    // Apply all updates at once
    if (Object.keys(updates).length > 0) {
        console.log('Renumbering priorities:', updates);
        database.ref().update(updates).catch(error => {
            console.error('Error fixing priorities:', error);
        });
    }
}

// Render filtered projects on the board
function renderProjects() {
    // Clear all columns
    Object.keys(PHASES).forEach(phase => {
        const column = document.getElementById(`column-${phase}`);
        if (column) {
            column.innerHTML = '';
        }
    });

    // Use filtered projects, or empty object if no matches (don't fallback to all projects)
    const hasActiveFilters = Object.values(currentFilters).some(filter => filter && filter.trim());
    const hasQuickFilter = document.querySelector('.quick-filter-btn.active') !== null;
    const projectsToRender = (hasActiveFilters || hasQuickFilter) ? filteredProjects : projects;

    // Sort projects by priority within each phase
    const projectsByPhase = {};
    Object.values(projectsToRender).forEach(project => {
        // Ensure phase is valid
        if (!project.phase || !PHASES[project.phase]) {
            console.warn('Project has invalid phase:', project);
            return;
        }
        
        if (!projectsByPhase[project.phase]) {
            projectsByPhase[project.phase] = [];
        }
        projectsByPhase[project.phase].push(project);
    });

    // Render projects in each column
    Object.keys(projectsByPhase).forEach(phase => {
        // Sort by priority (lower number = higher in column, priority 1 is at top)
        const sortedProjects = projectsByPhase[phase].sort((a, b) => {
            const aPriority = typeof a.priority === 'number' ? a.priority : 999999;
            const bPriority = typeof b.priority === 'number' ? b.priority : 999999;
            return aPriority - bPriority; // Lower number comes first
        });
        
        const columnElement = document.getElementById(`column-${phase}`);
        if (columnElement) {
            sortedProjects.forEach(project => {
                const projectCard = createProjectCard(project);
                columnElement.appendChild(projectCard);
            });
        }
    });
    
    // Reinitialize SortableJS after rendering (in case new columns were added)
    initializeSortableColumns();
}

// Create a project card element
function createProjectCard(project) {
    const card = document.createElement('div');
    card.className = 'project-card';
    card.dataset.projectId = project.id;
    
    // Calculate days in current phase
    const daysInPhase = calculateDaysInPhase(project);
    
    // Get LOE size indicator
    const loeSize = getLOESize(project.loe_estimate);
    
    card.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: flex-start;">
            <div class="project-title" style="flex: 1;">${project.title || 'Untitled Project'}</div>
            ${project.jira_link ? `
                <a href="${project.jira_link}" target="_blank" class="jira-link" onclick="event.stopPropagation();" title="View in Jira">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/>
                    </svg>
                </a>
            ` : ''}
        </div>
        <div class="project-meta">
            <div class="meta-item">
                <span class="icon">👤</span>
                <span>${project.pm_owner || 'Unassigned'}</span>
            </div>
            <div class="meta-item">
                <span class="icon">🕐</span>
                <span>${daysInPhase} days</span>
            </div>
            ${project.loe_estimate ? `<div class="loe-indicator loe-${loeSize}">${project.loe_estimate}</div>` : ''}
            ${project.next_milestone_type ? `
                <div class="meta-item">
                    <span class="icon">📅</span>
                    <span>${project.next_milestone_type}</span>
                </div>
            ` : ''}
        </div>
        ${project.dev_lead || project.ux_lead ? `
            <div class="project-meta" style="margin-top: 0.25rem;">
                ${project.dev_lead ? `<span>D: ${project.dev_lead}</span>` : ''}
                ${project.ux_lead ? `<span>U: ${project.ux_lead}</span>` : ''}
            </div>
        ` : ''}
        ${project.phase === 'discovery' ? createDiscoveryValidation(project) : ''}
    `;

    // Add event listeners (only click - SortableJS handles drag)
    card.addEventListener('click', () => showProjectDetail(project.id));

    return card;
}

// Create discovery validation checkboxes
function createDiscoveryValidation(project) {
    const validation = project.discovery_validation || {};
    return `
        <div class="discovery-validation">
            <div class="validation-checkbox ${validation.value ? 'checked' : ''}" title="Value">V</div>
            <div class="validation-checkbox ${validation.usability ? 'checked' : ''}" title="Usability">U</div>
            <div class="validation-checkbox ${validation.feasibility ? 'checked' : ''}" title="Feasibility">F</div>
            <div class="validation-checkbox ${validation.viability ? 'checked' : ''}" title="Viability">Vi</div>
        </div>
    `;
}

// Calculate days in current phase
function calculateDaysInPhase(project) {
    if (!project.phase_history) return 0;
    
    const history = Object.values(project.phase_history);
    const currentPhaseEntry = history.find(entry => entry.phase === project.phase);
    
    if (!currentPhaseEntry) return 0;
    
    const enteredDate = new Date(currentPhaseEntry.entered_at);
    const now = new Date();
    const diffTime = Math.abs(now - enteredDate);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    return diffDays;
}

// Get LOE size indicator
function getLOESize(loe) {
    if (!loe) return 'medium';
    const loeStr = loe.toLowerCase();
    if (loeStr.includes('week') || loeStr.includes('1') || loeStr.includes('small')) return 'small';
    if (loeStr.includes('month') || loeStr.includes('large') || loeStr.includes('big')) return 'large';
    return 'medium';
}

// Update project counts in column headers (for filtered view)
function updateProjectCounts() {
    const hasActiveFilters = Object.values(currentFilters).some(filter => filter && filter.trim());
    const projectsToCount = hasActiveFilters ? filteredProjects : projects;
    const counts = {};
    Object.keys(PHASES).forEach(phase => counts[phase] = 0);
    
    Object.values(projectsToCount).forEach(project => {
        if (counts.hasOwnProperty(project.phase)) {
            counts[project.phase]++;
        }
    });
    
    Object.keys(counts).forEach(phase => {
        const countElement = document.getElementById(`count-${phase}`);
        if (countElement) {
            countElement.textContent = counts[phase];
        }
    });
}

// Quick filter implementations
function applyQuickFilter(filterType) {
    const clickedButton = event.target;
    
    // Check if this quick filter is already active
    if (clickedButton.classList.contains('active')) {
        // Unclick: clear all filters and remove active state
        clearAllFilters();
        return;
    }
    
    // Clear existing filters first (skip applyFilters since we'll render after setting quick filter)
    clearAllFilters(true);
    
    // Add active class to clicked button (clearAllFilters removes all active classes)
    clickedButton.classList.add('active');
    
    // Apply the specific quick filter
    switch (filterType) {
        case 'classic-apps':
            // Filter to Classic Apps teams
            const classicTeams = ['BIRT', 'Cognos', 'Dataviews', 'Healthcare', 'KPI Data Platform'];
            applyTeamFilter(classicTeams);
            break;
            
        case 'modern-reporting':
            // Filter to Modern Reporting teams
            const modernTeams = ['Conversational', 'Looker', 'Reporting Hub'];
            applyTeamFilter(modernTeams);
            break;
            
        case 'planning-overdue':
            // Filter to projects in planning phase for more than 2 weeks
            filterPlanningOverdue();
            break;
    }
    
    // Don't call applyFilters() here as it would overwrite our custom filtering
    renderProjects();
}

// Helper function to apply team filters for quick filters
function applyTeamFilter(teams) {
    // Clear existing filters and set custom filter logic
    filteredProjects = {};
    Object.values(projects).forEach(project => {
        if (project.engineering_teams && Array.isArray(project.engineering_teams)) {
            // Check if project has any of the specified teams
            const hasMatchingTeam = project.engineering_teams.some(team => 
                teams.includes(team)
            );
            if (hasMatchingTeam) {
                filteredProjects[project.id] = project;
            }
        }
    });
    
    // Update the filter status text
    const count = Object.keys(filteredProjects).length;
    const teamNames = teams.length > 2 ? `${teams[0]} and others` : teams.join(' and ');
    document.getElementById('filter-status').textContent = `Showing ${count} ${teamNames} project${count !== 1 ? 's' : ''}`;
}

// Helper function to filter planning overdue projects
function filterPlanningOverdue() {
    filteredProjects = {};
    const twoWeeksAgo = new Date();
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
    
    Object.values(projects).forEach(project => {
        if (project.phase === 'planning' && project.phase_history) {
            // Find when the project entered the planning phase
            const history = Object.values(project.phase_history);
            const planningEntry = history.find(entry => entry.phase === 'planning');
            
            if (planningEntry && planningEntry.entered_at) {
                const enteredDate = new Date(planningEntry.entered_at);
                if (enteredDate < twoWeeksAgo) {
                    filteredProjects[project.id] = project;
                }
            }
        }
    });
    
    // Update the filter status text
    const count = Object.keys(filteredProjects).length;
    document.getElementById('filter-status').textContent = `Showing ${count} project${count !== 1 ? 's' : ''} in planning for >2 weeks`;
}

// Note: Drag and drop is now handled by SortableJS
// The old drag handlers have been removed and replaced with SortableJS callbacks

// Check if transition requirements are met
function checkTransitionRequirements(project, requirements) {
    return requirements.every(req => {
        if (!req.required) return true;
        const artifacts = project.artifacts || {};
        return artifacts[req.key] && artifacts[req.key].trim() !== '';
    });
}

// Move project to new phase
function moveProjectToPhase(projectId, newPhase) {
    const project = projects[projectId];
    if (!project) return;
    
    const now = new Date().toISOString();
    const phaseHistory = project.phase_history || {};
    
    // Add new phase entry to history
    const newHistoryKey = Object.keys(phaseHistory).length.toString();
    phaseHistory[newHistoryKey] = {
        phase: newPhase,
        entered_at: now,
        entered_by: 'user'
    };
    
    // Update project
    const updates = {
        phase: newPhase,
        phase_history: phaseHistory,
        updated_at: now
    };
    
    database.ref(`projects/${projectId}`).update(updates);
}

// Note: Old reorderProjects and moveProjectToEndOfPhase functions removed
// Now handled by handleSortableReorder function above

// Show phase transition modal
function showPhaseTransitionModal(project, newPhase, requirements) {
    transitionProject = { project, newPhase, requirements };
    
    const modal = document.getElementById('phase-transition-modal');
    const title = document.getElementById('transition-modal-title');
    const content = document.getElementById('phase-transition-content');
    
    title.textContent = `Move to ${PHASES[newPhase].name}`;
    
    let html = `
        <p>Moving <strong>${project.title}</strong> from <strong>${PHASES[project.phase].name}</strong> to <strong>${PHASES[newPhase].name}</strong></p>
        <p>The following artifacts are required for this transition:</p>
    `;
    
    requirements.forEach(req => {
        const currentValue = project.artifacts && project.artifacts[req.key] ? project.artifacts[req.key] : '';
        const isValid = !req.required || (currentValue && currentValue.trim() !== '');
        
        html += `
            <div class="form-group">
                <label class="form-label">
                    ${req.label}${req.required ? ' *' : ''}
                    ${isValid ? ' ✅' : ''}
                </label>
                <input 
                    type="${req.type}" 
                    id="transition-${req.key}" 
                    class="form-input" 
                    value="${currentValue}"
                    ${req.required ? 'required' : ''}
                >
            </div>
        `;
    });
    
    content.innerHTML = html;
    modal.style.display = 'block';
}

// Confirm phase transition
function confirmPhaseTransition() {
    if (!transitionProject) return;
    
    const { project, newPhase, requirements } = transitionProject;
    const artifacts = project.artifacts || {};
    
    // Collect form values
    let valid = true;
    requirements.forEach(req => {
        const input = document.getElementById(`transition-${req.key}`);
        const value = input.value.trim();
        
        if (req.required && !value) {
            valid = false;
            input.style.borderColor = '#dc3545';
        } else {
            input.style.borderColor = '#ddd';
            artifacts[req.key] = value;
        }
    });
    
    if (!valid) {
        alert('Please fill in all required fields.');
        return;
    }
    
    // Update project with artifacts
    database.ref(`projects/${project.id}`).update({ artifacts }).then(() => {
        moveProjectToPhase(project.id, newPhase);
        closeModal('phase-transition-modal');
        transitionProject = null;
    });
}

// Show project detail modal
function showProjectDetail(projectId) {
    const project = projects[projectId];
    if (!project) return;
    
    const modal = document.getElementById('project-detail-modal');
    const title = document.getElementById('detail-modal-title');
    const content = document.getElementById('project-detail-content');
    
    title.textContent = project.title || 'Untitled Project';
    
    const daysInPhase = calculateDaysInPhase(project);
    const artifacts = project.artifacts || {};
    const validation = project.discovery_validation || {};
    
    let html = `
        <div style="margin-bottom: 2rem;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
                <span style="background: ${PHASES[project.phase].color}; padding: 0.25rem 0.75rem; border-radius: 12px; font-size: 0.75rem; font-weight: 500;">${PHASES[project.phase].name}</span>
                <div>
                    <button class="btn btn-secondary" onclick="editProject('${projectId}')">Edit</button>
                    <button class="btn" style="background: #dc3545; margin-left: 0.5rem;" onclick="deleteProject('${projectId}')">Delete</button>
                </div>
            </div>
            
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 1.5rem;">
                <div><strong>PM Owner:</strong> ${project.pm_owner || 'Unassigned'}</div>
                <div><strong>Dev Lead:</strong> ${project.dev_lead || 'Unassigned'}</div>
                <div><strong>UX Lead:</strong> ${project.ux_lead || 'Unassigned'}</div>
                <div><strong>LOE Estimate:</strong> ${project.loe_estimate || 'Not set'}</div>
                <div><strong>Days in Phase:</strong> ${daysInPhase}</div>
                <div><strong>Priority:</strong> ${project.priority || 0}</div>
            </div>
            
            ${project.engineering_teams && project.engineering_teams.length > 0 ? `
                <div style="margin-bottom: 1.5rem;">
                    <strong>Engineering Teams:</strong>
                    <div style="display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 0.5rem;">
                        ${project.engineering_teams.map(team => `
                            <span style="background: #007bff; color: white; padding: 0.25rem 0.75rem; border-radius: 20px; font-size: 0.875rem;">
                                ${team}
                            </span>
                        `).join('')}
                    </div>
                </div>
            ` : ''}
            
            ${project.description ? `
                <div style="margin-bottom: 1.5rem;">
                    <strong>Description:</strong>
                    <p style="margin-top: 0.5rem; padding: 1rem; background: #f8f9fa; border-radius: 4px;">${project.description}</p>
                </div>
            ` : ''}
            
            ${project.jira_link ? `
                <div style="margin-bottom: 1.5rem;">
                    <strong>Jira Issue:</strong>
                    <a href="${project.jira_link}" target="_blank" style="color: #007bff; margin-left: 0.5rem;">
                        View in Jira →
                    </a>
                </div>
            ` : ''}
            
            <div style="margin-bottom: 1.5rem;">
                <strong>Project Artifacts:</strong>
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 0.5rem; margin-top: 0.5rem;">
                    ${Object.entries(artifacts).map(([key, value]) => {
                        if (!value) return '';
                        const label = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                        return `<div><strong>${label}:</strong> <a href="${value}" target="_blank" style="color: #007bff;">View</a></div>`;
                    }).join('')}
                </div>
            </div>
            
            ${project.phase === 'discovery' ? `
                <div style="margin-bottom: 1.5rem;">
                    <strong>Discovery Validation:</strong>
                    <div style="display: flex; gap: 1rem; margin-top: 0.5rem;">
                        <div>Value: ${validation.value ? '✅' : '❌'}</div>
                        <div>Usability: ${validation.usability ? '✅' : '❌'}</div>
                        <div>Feasibility: ${validation.feasibility ? '✅' : '❌'}</div>
                        <div>Viability: ${validation.viability ? '✅' : '❌'}</div>
                    </div>
                </div>
            ` : ''}
            
            ${project.phase_history ? `
                <div>
                    <strong>Phase History:</strong>
                    <div style="margin-top: 0.5rem;">
                        ${Object.values(project.phase_history).map(entry => `
                            <div style="padding: 0.5rem; background: #f8f9fa; border-radius: 4px; margin-bottom: 0.25rem;">
                                <strong>${PHASES[entry.phase].name}</strong> - ${new Date(entry.entered_at).toLocaleDateString()}
                            </div>
                        `).join('')}
                    </div>
                </div>
            ` : ''}
        </div>
    `;
    
    content.innerHTML = html;
    modal.style.display = 'block';
}

// Modal functions
function openNewProjectModal() {
    resetNewProjectModal();
    document.getElementById('new-project-form').reset();
    document.getElementById('new-project-modal').style.display = 'block';
    document.getElementById('project-title').focus();
}

function closeModal(modalId) {
    document.getElementById(modalId).style.display = 'none';
}

function closeAllModals() {
    document.querySelectorAll('.modal').forEach(modal => {
        modal.style.display = 'none';
    });
}

// Create new project
function createProject() {
    const title = document.getElementById('project-title').value.trim();
    if (!title) {
        alert('Project title is required.');
        return;
    }
    
    const selectedPhase = document.getElementById('project-phase').value;
    
    // Calculate appropriate priority for new project (add to bottom)
    const phaseProjects = Object.values(projects)
        .filter(p => p.phase === selectedPhase)
        .sort((a, b) => (a.priority || 999999) - (b.priority || 999999));
    
    // New project gets priority = number of existing projects + 1
    const calculatedPriority = phaseProjects.length + 1;
    
    const projectData = {
        id: generateId(),
        title: title,
        description: document.getElementById('project-description').value.trim(),
        phase: selectedPhase,
        priority: calculatedPriority, // Use calculated priority instead of form value
        pm_owner: document.getElementById('project-pm-owner').value.trim(),
        dev_lead: document.getElementById('project-dev-lead').value.trim(),
        ux_lead: document.getElementById('project-ux-lead').value.trim(),
        loe_estimate: document.getElementById('project-loe').value.trim(),
        jira_link: document.getElementById('project-jira-link').value.trim(),
        engineering_teams: getEngineeringTeamsFromInput(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        phase_history: {
            '0': {
                phase: selectedPhase,
                entered_at: new Date().toISOString(),
                entered_by: 'user'
            }
        },
        discovery_validation: {
            value: false,
            usability: false,
            feasibility: false,
            viability: false
        },
        artifacts: {}
    };
    
    database.ref(`projects/${projectData.id}`).set(projectData).then(() => {
        closeModal('new-project-modal');
        document.getElementById('new-project-form').reset();
    }).catch(error => {
        console.error('Error creating project:', error);
        alert('Error creating project. Please try again.');
    });
}

// Edit project
function editProject(projectId) {
    const project = projects[projectId];
    if (!project) return;
    
    closeModal('project-detail-modal');
    
    // Populate the edit form
    document.getElementById('project-title').value = project.title || '';
    document.getElementById('project-description').value = project.description || '';
    document.getElementById('project-phase').value = project.phase || 'idea';
    document.getElementById('project-pm-owner').value = project.pm_owner || '';
    document.getElementById('project-dev-lead').value = project.dev_lead || '';
    document.getElementById('project-ux-lead').value = project.ux_lead || '';
    document.getElementById('project-loe').value = project.loe_estimate || '';
    document.getElementById('project-jira-link').value = project.jira_link || '';
    setEngineeringTeamsToInput(project.engineering_teams || []);
    
    // Show priority field for editing and populate it
    document.getElementById('priority-group').style.display = 'block';
    document.getElementById('project-priority').value = project.priority || '';
    
    // Change modal title and button
    document.querySelector('#new-project-modal .modal-header h2').textContent = 'Edit Project';
    const createButton = document.querySelector('#new-project-modal .modal-footer .btn:not(.btn-secondary)');
    createButton.textContent = 'Update Project';
    createButton.onclick = () => updateProject(projectId);
    
    document.getElementById('new-project-modal').style.display = 'block';
    document.getElementById('project-title').focus();
}

// Update existing project
function updateProject(projectId) {
    const title = document.getElementById('project-title').value.trim();
    if (!title) {
        alert('Project title is required.');
        return;
    }
    
    const currentProject = projects[projectId];
    const newPhase = document.getElementById('project-phase').value;
    const newPriority = parseInt(document.getElementById('project-priority').value);
    
    const updates = {
        title: title,
        description: document.getElementById('project-description').value.trim(),
        pm_owner: document.getElementById('project-pm-owner').value.trim(),
        dev_lead: document.getElementById('project-dev-lead').value.trim(),
        ux_lead: document.getElementById('project-ux-lead').value.trim(),
        loe_estimate: document.getElementById('project-loe').value.trim(),
        jira_link: document.getElementById('project-jira-link').value.trim(),
        engineering_teams: getEngineeringTeamsFromInput(),
        updated_at: new Date().toISOString()
    };
    
    // Handle phase change if different
    let targetPhase = currentProject.phase;
    if (newPhase !== currentProject.phase) {
        const transitionKey = `${currentProject.phase}-${newPhase}`;
        const requirements = TRANSITION_REQUIREMENTS[transitionKey];
        
        if (requirements && !checkTransitionRequirements(currentProject, requirements)) {
            alert('Phase change requires additional artifacts. Please use drag & drop to change phases with validation.');
            return;
        } else {
            // Update phase and history
            const phaseHistory = currentProject.phase_history || {};
            const newHistoryKey = Object.keys(phaseHistory).length.toString();
            phaseHistory[newHistoryKey] = {
                phase: newPhase,
                entered_at: new Date().toISOString(),
                entered_by: 'user'
            };
            updates.phase = newPhase;
            updates.phase_history = phaseHistory;
            targetPhase = newPhase;
        }
    }
    
    // Handle manual priority change
    if (newPriority && newPriority > 0 && newPriority !== currentProject.priority) {
        // Need to renumber all projects in the phase
        const phaseProjects = Object.values(projects)
            .filter(p => p.phase === targetPhase && p.id !== projectId)
            .sort((a, b) => (a.priority || 999999) - (b.priority || 999999));
        
        // Insert current project at the desired position
        const insertIndex = Math.min(newPriority - 1, phaseProjects.length);
        phaseProjects.splice(insertIndex, 0, currentProject);
        
        // Batch update all priorities
        const batchUpdates = {};
        phaseProjects.forEach((p, index) => {
            const priority = index + 1;
            if (p.id === projectId) {
                updates.priority = priority;
            } else if (p.priority !== priority) {
                batchUpdates[`projects/${p.id}/priority`] = priority;
                batchUpdates[`projects/${p.id}/updated_at`] = new Date().toISOString();
            }
        });
        
        // Apply project updates and batch updates together
        database.ref(`projects/${projectId}`).update(updates).then(() => {
            if (Object.keys(batchUpdates).length > 0) {
                return database.ref().update(batchUpdates);
            }
        }).then(() => {
            closeModal('new-project-modal');
            resetNewProjectModal();
            document.getElementById('new-project-form').reset();
        }).catch(error => {
            console.error('Error updating project:', error);
            alert('Error updating project. Please try again.');
        });
    } else {
        // No priority change, just update the project
        database.ref(`projects/${projectId}`).update(updates).then(() => {
            closeModal('new-project-modal');
            resetNewProjectModal();
            document.getElementById('new-project-form').reset();
        }).catch(error => {
            console.error('Error updating project:', error);
            alert('Error updating project. Please try again.');
        });
    }
}

// Reset new project modal to default state
function resetNewProjectModal() {
    document.querySelector('#new-project-modal .modal-header h2').textContent = 'Create New Project';
    const createButton = document.querySelector('#new-project-modal .modal-footer .btn:not(.btn-secondary)');
    createButton.textContent = 'Create Project';
    createButton.onclick = createProject;
    
    // Hide priority field (only shown for editing)
    document.getElementById('priority-group').style.display = 'none';
    document.getElementById('project-priority').value = '';
    document.getElementById('project-jira-link').value = '';
    document.getElementById('selected-teams').innerHTML = '';
    
    // Hide all suggestion dropdowns
    document.querySelectorAll('.suggestions-dropdown').forEach(dropdown => {
        dropdown.classList.remove('show');
    });
}

// Engineering Teams Helper Functions
function setupEngineeringTeamsInput() {
    const input = document.getElementById('engineering-team-input');
    const container = document.getElementById('selected-teams');
    
    if (!input) return;
    
    // Setup dropdown suggestions for all input fields
    setupInputSuggestions('engineering-team-input', 'team-suggestions', getAvailableTeams, true);
    setupInputSuggestions('project-pm-owner', 'pm-suggestions', getAvailablePMs, false);
    setupInputSuggestions('project-dev-lead', 'dev-suggestions', getAvailableDevs, false);
    setupInputSuggestions('project-ux-lead', 'ux-suggestions', getAvailableUX, false);
    
    input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            const teamName = input.value.trim();
            if (teamName) {
                addTeamTag(teamName);
                input.value = '';
                document.getElementById('team-suggestions').classList.remove('show');
            }
        }
    });
}

function addTeamTag(teamName) {
    const container = document.getElementById('selected-teams');
    const existingTags = Array.from(container.querySelectorAll('.team-tag')).map(tag => 
        tag.querySelector('span').textContent
    );
    
    if (!existingTags.includes(teamName)) {
        const tag = document.createElement('div');
        tag.className = 'team-tag';
        tag.innerHTML = `
            <span>${teamName}</span>
            <button class="remove-tag" onclick="removeTeamTag(this)">×</button>
        `;
        container.appendChild(tag);
    }
}

function removeTeamTag(button) {
    button.parentElement.remove();
}

function getEngineeringTeamsFromInput() {
    const container = document.getElementById('selected-teams');
    return Array.from(container.querySelectorAll('.team-tag')).map(tag => 
        tag.querySelector('span').textContent
    );
}

function setEngineeringTeamsToInput(teams) {
    const container = document.getElementById('selected-teams');
    container.innerHTML = '';
    teams.forEach(team => addTeamTag(team));
}

// Suggestion System Functions
function setupInputSuggestions(inputId, dropdownId, getSuggestionsFn, isMultiSelect) {
    const input = document.getElementById(inputId);
    const dropdown = document.getElementById(dropdownId);
    
    if (!input || !dropdown) return;
    
    let selectedIndex = -1;
    
    // Show suggestions on focus
    input.addEventListener('focus', function() {
        updateSuggestions(input, dropdown, getSuggestionsFn(), isMultiSelect);
        dropdown.classList.add('show');
    });
    
    // Filter suggestions on input
    input.addEventListener('input', function() {
        const value = input.value.toLowerCase();
        const allSuggestions = getSuggestionsFn();
        const filtered = value ? allSuggestions.filter(s => s.toLowerCase().includes(value)) : allSuggestions;
        updateSuggestions(input, dropdown, filtered, isMultiSelect);
        dropdown.classList.add('show');
        selectedIndex = -1;
    });
    
    // Handle keyboard navigation
    input.addEventListener('keydown', function(e) {
        const items = dropdown.querySelectorAll('.suggestion-item');
        
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            selectedIndex = Math.min(selectedIndex + 1, items.length - 1);
            updateSelectedSuggestion(items, selectedIndex);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            selectedIndex = Math.max(selectedIndex - 1, -1);
            updateSelectedSuggestion(items, selectedIndex);
        } else if (e.key === 'Enter' && selectedIndex >= 0) {
            e.preventDefault();
            items[selectedIndex].click();
        } else if (e.key === 'Escape') {
            dropdown.classList.remove('show');
            selectedIndex = -1;
        }
    });
    
    // Hide suggestions when clicking outside
    document.addEventListener('click', function(e) {
        if (!input.contains(e.target) && !dropdown.contains(e.target)) {
            dropdown.classList.remove('show');
            selectedIndex = -1;
        }
    });
}

function updateSuggestions(input, dropdown, suggestions, isMultiSelect) {
    dropdown.innerHTML = '';
    
    if (suggestions.length === 0) {
        const item = document.createElement('div');
        item.className = 'suggestion-item add-new';
        item.textContent = 'Type to add new...';
        dropdown.appendChild(item);
        return;
    }
    
    suggestions.forEach(suggestion => {
        const item = document.createElement('div');
        item.className = 'suggestion-item';
        item.textContent = suggestion;
        item.addEventListener('click', function() {
            if (isMultiSelect) {
                addTeamTag(suggestion);
                input.value = '';
            } else {
                input.value = suggestion;
            }
            dropdown.classList.remove('show');
        });
        dropdown.appendChild(item);
    });
}

function updateSelectedSuggestion(items, index) {
    items.forEach((item, i) => {
        if (i === index) {
            item.classList.add('selected');
        } else {
            item.classList.remove('selected');
        }
    });
}

// Get available values from existing projects
function getAvailableTeams() {
    const teams = new Set();
    Object.values(projects).forEach(project => {
        if (project.engineering_teams && Array.isArray(project.engineering_teams)) {
            project.engineering_teams.forEach(team => {
                if (team && team.trim()) teams.add(team.trim());
            });
        }
    });
    
    // Filter out already selected teams
    const selectedTeams = getEngineeringTeamsFromInput();
    return Array.from(teams).filter(team => !selectedTeams.includes(team)).sort();
}

function getAvailablePMs() {
    const pms = new Set();
    Object.values(projects).forEach(project => {
        if (project.pm_owner && project.pm_owner.trim()) {
            pms.add(project.pm_owner.trim());
        }
    });
    return Array.from(pms).sort();
}

function getAvailableDevs() {
    const devs = new Set();
    Object.values(projects).forEach(project => {
        if (project.dev_lead && project.dev_lead.trim()) {
            devs.add(project.dev_lead.trim());
        }
    });
    return Array.from(devs).sort();
}

function getAvailableUX() {
    const ux = new Set();
    Object.values(projects).forEach(project => {
        if (project.ux_lead && project.ux_lead.trim()) {
            ux.add(project.ux_lead.trim());
        }
    });
    return Array.from(ux).sort();
}

// Delete project
function deleteProject(projectId) {
    const project = projects[projectId];
    if (!project) return;
    
    if (confirm(`Are you sure you want to delete "${project.title}"? This action cannot be undone.`)) {
        database.ref(`projects/${projectId}`).remove().then(() => {
            closeModal('project-detail-modal');
        }).catch(error => {
            console.error('Error deleting project:', error);
            alert('Error deleting project. Please try again.');
        });
    }
}

// Utility function to generate unique IDs
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// Connection monitoring is now handled in setupConnectionMonitoring()
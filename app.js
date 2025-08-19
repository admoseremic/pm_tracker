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
let currentDraggedProject = null;
let transitionProject = null;
let dragOverElement = null;

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

    // Setup drag and drop for columns
    const columns = document.querySelectorAll('.column-content');
    columns.forEach(column => {
        column.addEventListener('dragover', handleDragOver);
        column.addEventListener('drop', handleDrop);
        column.addEventListener('dragenter', handleDragEnter);
        column.addEventListener('dragleave', handleDragLeave);
    });
}

// Load projects from Firebase
function loadProjects() {
    database.ref('projects').on('value', (snapshot) => {
        projects = snapshot.val() || {};
        
        // Fix any negative or problematic priorities
        fixProjectPriorities();
        
        renderProjects();
        updateProjectCounts();
    });
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

// Render all projects on the board
function renderProjects() {
    // Clear all columns
    Object.keys(PHASES).forEach(phase => {
        const column = document.getElementById(`column-${phase}`);
        if (column) {
            column.innerHTML = '';
        }
    });

    // Sort projects by priority within each phase
    const projectsByPhase = {};
    Object.values(projects).forEach(project => {
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
}

// Create a project card element
function createProjectCard(project) {
    const card = document.createElement('div');
    card.className = 'project-card';
    card.draggable = true;
    card.dataset.projectId = project.id;
    
    // Calculate days in current phase
    const daysInPhase = calculateDaysInPhase(project);
    
    // Get LOE size indicator
    const loeSize = getLOESize(project.loe_estimate);
    
    card.innerHTML = `
        <div class="project-title">${project.title || 'Untitled Project'}</div>
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

    // Add event listeners
    card.addEventListener('click', () => showProjectDetail(project.id));
    card.addEventListener('dragstart', handleDragStart);
    card.addEventListener('dragend', handleDragEnd);
    card.addEventListener('dragover', handleCardDragOver);
    card.addEventListener('dragenter', handleCardDragEnter);
    card.addEventListener('dragleave', handleCardDragLeave);

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

// Update project counts in column headers
function updateProjectCounts() {
    const counts = {};
    Object.keys(PHASES).forEach(phase => counts[phase] = 0);
    
    Object.values(projects).forEach(project => {
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
    
    // Update total project count
    const totalCount = Object.keys(projects).length;
    document.getElementById('project-count').textContent = `${totalCount} project${totalCount !== 1 ? 's' : ''}`;
}

// Drag and drop handlers
function handleDragStart(e) {
    currentDraggedProject = e.target.dataset.projectId;
    e.target.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
}

function handleDragEnd(e) {
    e.target.classList.remove('dragging');
    currentDraggedProject = null;
    dragOverElement = null;
    
    // Remove drag-over classes from all elements
    document.querySelectorAll('.column-content').forEach(col => {
        col.parentElement.classList.remove('drag-over');
    });
    document.querySelectorAll('.project-card').forEach(card => {
        card.classList.remove('drag-over-top', 'drag-over-bottom');
    });
}

function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
}

function handleDragEnter(e) {
    e.preventDefault();
    e.target.closest('.kanban-column').classList.add('drag-over');
}

function handleDragLeave(e) {
    if (!e.target.closest('.kanban-column').contains(e.relatedTarget)) {
        e.target.closest('.kanban-column').classList.remove('drag-over');
    }
}

// Card-specific drag handlers for reordering
function handleCardDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    
    if (!currentDraggedProject) return;
    
    const card = e.currentTarget;
    const cardId = card.dataset.projectId;
    
    // Don't show drop indicator on the dragged card itself
    if (cardId === currentDraggedProject) return;
    
    const rect = card.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    const isTopHalf = e.clientY < midY;
    
    // Remove all drag-over classes from cards
    document.querySelectorAll('.project-card').forEach(c => {
        c.classList.remove('drag-over-top', 'drag-over-bottom');
    });
    
    // Add appropriate class
    if (isTopHalf) {
        card.classList.add('drag-over-top');
    } else {
        card.classList.add('drag-over-bottom');
    }
    
    dragOverElement = { card, position: isTopHalf ? 'before' : 'after' };
}

function handleCardDragEnter(e) {
    e.preventDefault();
    e.stopPropagation();
}

function handleCardDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    
    const card = e.currentTarget;
    if (!card.contains(e.relatedTarget)) {
        card.classList.remove('drag-over-top', 'drag-over-bottom');
    }
}

function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    
    const column = e.target.closest('.kanban-column');
    const card = e.target.closest('.project-card');
    
    if (column) {
        column.classList.remove('drag-over');
    }
    
    if (!currentDraggedProject) return;
    
    const project = projects[currentDraggedProject];
    if (!project) return;
    
    // Check if we're dropping on a card (for reordering) or on a column (for phase change)
    if (card && dragOverElement && card.dataset.projectId !== currentDraggedProject) {
        // Reordering within same phase or different phase
        const targetCardId = card.dataset.projectId;
        const targetProject = projects[targetCardId];
        
        if (targetProject) {
            reorderProjects(currentDraggedProject, targetCardId, dragOverElement.position, targetProject.phase);
        }
    } else if (column) {
        // Dropping on column (phase change or adding to end)
        const newPhase = column.dataset.phase;
        
        if (project.phase !== newPhase) {
            // Phase change
            const transitionKey = `${project.phase}-${newPhase}`;
            const requirements = TRANSITION_REQUIREMENTS[transitionKey];
            
            if (requirements && !checkTransitionRequirements(project, requirements)) {
                showPhaseTransitionModal(project, newPhase, requirements);
            } else {
                moveProjectToPhase(currentDraggedProject, newPhase);
            }
        } else {
            // Same phase, move to end
            moveProjectToEndOfPhase(currentDraggedProject, newPhase);
        }
    }
    
    // Clean up
    document.querySelectorAll('.project-card').forEach(c => {
        c.classList.remove('drag-over-top', 'drag-over-bottom');
    });
}

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

// Reorder projects within or between phases
function reorderProjects(draggedProjectId, targetProjectId, position, targetPhase) {
    const draggedProject = projects[draggedProjectId];
    const targetProject = projects[targetProjectId];
    
    if (!draggedProject || !targetProject) return;
    
    // Check for phase transition requirements first
    if (draggedProject.phase !== targetPhase) {
        const transitionKey = `${draggedProject.phase}-${targetPhase}`;
        const requirements = TRANSITION_REQUIREMENTS[transitionKey];
        
        if (requirements && !checkTransitionRequirements(draggedProject, requirements)) {
            showPhaseTransitionModal(draggedProject, targetPhase, requirements);
            return;
        }
    }
    
    // Get all projects in the target phase (including dragged if same phase)
    let phaseProjects = Object.values(projects)
        .filter(p => p.phase === targetPhase && p.id !== draggedProjectId)
        .sort((a, b) => (a.priority || 999999) - (b.priority || 999999)); // Sort ascending (1 is top)
    
    // Find where to insert the dragged project
    const targetIndex = phaseProjects.findIndex(p => p.id === targetProjectId);
    if (targetIndex === -1) return;
    
    // Insert the dragged project at the appropriate position
    const insertIndex = position === 'before' ? targetIndex : targetIndex + 1;
    phaseProjects.splice(insertIndex, 0, draggedProject);
    
    // Now update ALL projects in the phase with new priorities (1, 2, 3, ...)
    const updates = {};
    const now = new Date().toISOString();
    
    phaseProjects.forEach((project, index) => {
        const newPriority = index + 1; // Start at 1
        
        if (project.id === draggedProjectId) {
            // Update the dragged project (may include phase change)
            updates[`projects/${project.id}/priority`] = newPriority;
            updates[`projects/${project.id}/updated_at`] = now;
            
            if (draggedProject.phase !== targetPhase) {
                // Add phase change updates
                const phaseHistory = draggedProject.phase_history || {};
                const newHistoryKey = Object.keys(phaseHistory).length.toString();
                phaseHistory[newHistoryKey] = {
                    phase: targetPhase,
                    entered_at: now,
                    entered_by: 'user'
                };
                
                updates[`projects/${project.id}/phase`] = targetPhase;
                updates[`projects/${project.id}/phase_history`] = phaseHistory;
            }
        } else if (project.priority !== newPriority) {
            // Only update if priority actually changed
            updates[`projects/${project.id}/priority`] = newPriority;
            updates[`projects/${project.id}/updated_at`] = now;
        }
    });
    
    // Apply all updates atomically
    if (Object.keys(updates).length > 0) {
        console.log(`Reordering ${phaseProjects.length} projects in ${targetPhase}`, updates);
        database.ref().update(updates);
    }
}

// Move project to end of phase (when dropping on empty space)
function moveProjectToEndOfPhase(projectId, phase) {
    const project = projects[projectId];
    if (!project) return;
    
    // Get all projects in phase and add dragged one at the end
    const phaseProjects = Object.values(projects)
        .filter(p => p.phase === phase && p.id !== projectId)
        .sort((a, b) => (a.priority || 999999) - (b.priority || 999999));
    
    // Add dragged project at the end
    phaseProjects.push(project);
    
    // Reindex all with priorities 1, 2, 3...
    const updates = {};
    const now = new Date().toISOString();
    
    phaseProjects.forEach((p, index) => {
        const newPriority = index + 1;
        if (p.priority !== newPriority) {
            updates[`projects/${p.id}/priority`] = newPriority;
            updates[`projects/${p.id}/updated_at`] = now;
        }
    });
    
    if (Object.keys(updates).length > 0) {
        console.log(`Moving to end of ${phase}, updating ${Object.keys(updates).length} priorities`);
        database.ref().update(updates);
    }
}

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
            
            ${project.description ? `
                <div style="margin-bottom: 1.5rem;">
                    <strong>Description:</strong>
                    <p style="margin-top: 0.5rem; padding: 1rem; background: #f8f9fa; border-radius: 4px;">${project.description}</p>
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

// Error handling for Firebase
database.ref('.info/connected').on('value', function(snapshot) {
    if (snapshot.val() === true) {
        console.log('Connected to Firebase');
    } else {
        console.log('Disconnected from Firebase');
    }
});
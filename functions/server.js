// =============================================================================
// MCP server definition for the PM Tracker.
//
// Exposes 11 tools that read and modify the `projects/` tree in the
// pm-kanban Firebase Realtime Database. The data shape matches what the
// web app at pm.trevorwithdata.com writes (see /app.js for the source of
// truth). Field-level invariants we mirror here:
//
//   - phase: one of idea | discovery | planning | ready | delivery
//   - boards: array containing any of: cr | wih | hp | classicapps | trevor
//   - priority: 1-indexed integer, unique within a phase column
//   - phase_history: object keyed by string indices ("0", "1", ...) where
//     each entry is { phase, entered_at, entered_by }
//   - comments: object keyed by generated comment IDs
//
// All write tools stamp `updated_at` with the current ISO timestamp.
// =============================================================================

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Constants mirrored from /app.js so the tools enforce the same vocabulary.
// ---------------------------------------------------------------------------

const PHASES = ["idea", "discovery", "planning", "ready", "delivery"];
const BOARDS = ["cr", "wih", "hp", "classicapps", "trevor"];
const RELEASE_CONFIDENCES = ["green", "yellow", "red"];

// Known artifact keys per the transition requirements in /app.js. Tools accept
// these as freeform strings so we don't have to redeploy when a new artifact
// kind is added — but documenting them helps the LLM pick the right key.
const KNOWN_ARTIFACT_KEYS = [
    "discovery_plan_url",
    "product_requirements_url",
    "discovery_notes_url",
    "ppc_deck_url",
    "ppc_meeting_date",
    "release_date",
    "project_plan_url",
    "gtm_plan_url",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Mirrors the ID generator in /app.js so IDs created via MCP look the same as
// IDs created via the web UI (timestamp-base36 + random suffix).
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function nowIso() {
    return new Date().toISOString();
}

// Wrap a JS value as a CallToolResult. MCP tool responses must include a
// `content` array of typed parts; we serialize structured data as JSON text
// so the LLM can read it directly.
function ok(value) {
    return {
        content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    };
}

// Wrap an error message as a CallToolResult with `isError: true` so the LLM
// sees it as a failed call rather than data.
function err(message) {
    return {
        content: [{ type: "text", text: message }],
        isError: true,
    };
}

// Read all projects from the DB once. The Realtime DB doesn't support rich
// queries on nested arrays (e.g. "boards contains cr"), so list_projects
// fetches everything and filters in-process. This is fine for the expected
// project count (hundreds, not millions) and matches what the web app does.
async function fetchAllProjects(db) {
    const snap = await db.ref("projects").once("value");
    return snap.val() || {};
}

async function fetchProject(db, id) {
    const snap = await db.ref(`projects/${id}`).once("value");
    return snap.val();
}

// Trim a project down to the most useful fields for list_projects. Used when
// the caller passes `slim: true` to keep the response token-cheap.
function slimProject(p) {
    return {
        id: p.id,
        title: p.title,
        phase: p.phase,
        priority: p.priority,
        pm_owner: p.pm_owner,
        dev_lead: p.dev_lead,
        ux_lead: p.ux_lead,
        boards: p.boards || [],
        released: !!p.released,
        release_confidence: p.release_confidence,
        jira_link: p.jira_link,
        updated_at: p.updated_at,
    };
}

// ---------------------------------------------------------------------------
// MCP server factory
// ---------------------------------------------------------------------------

export function buildMcpServer(db) {
    const server = new McpServer(
        { name: "pm-tracker", version: "1.0.0" },
        { capabilities: { tools: {} } }
    );

    // -----------------------------------------------------------------------
    // 1. list_projects
    // -----------------------------------------------------------------------
    server.registerTool(
        "list_projects",
        {
            title: "List projects",
            description:
                "List projects from the PM tracker, optionally filtered by board, phase, or owner. " +
                "By default, released projects are excluded (matching the web UI). " +
                "Use slim=true to get a compact response.",
            inputSchema: {
                board: z.enum(BOARDS).optional()
                    .describe("Filter to projects assigned to this board key."),
                phase: z.enum(PHASES).optional()
                    .describe("Filter to projects in this phase column."),
                pm_owner: z.string().optional()
                    .describe("Exact-match filter on pm_owner field."),
                dev_lead: z.string().optional()
                    .describe("Exact-match filter on dev_lead field."),
                ux_lead: z.string().optional()
                    .describe("Exact-match filter on ux_lead field."),
                include_released: z.boolean().optional().default(false)
                    .describe("If true, include projects marked as released."),
                slim: z.boolean().optional().default(false)
                    .describe("If true, return only the most useful fields per project."),
            },
        },
        async (args) => {
            const all = await fetchAllProjects(db);
            let projects = Object.values(all);

            if (!args.include_released) {
                projects = projects.filter((p) => !p.released);
            }
            if (args.board) {
                projects = projects.filter(
                    (p) => Array.isArray(p.boards) && p.boards.includes(args.board)
                );
            }
            if (args.phase) {
                projects = projects.filter((p) => p.phase === args.phase);
            }
            if (args.pm_owner) {
                projects = projects.filter((p) => p.pm_owner === args.pm_owner);
            }
            if (args.dev_lead) {
                projects = projects.filter((p) => p.dev_lead === args.dev_lead);
            }
            if (args.ux_lead) {
                projects = projects.filter((p) => p.ux_lead === args.ux_lead);
            }

            // Sort by phase order, then priority within phase. This makes the
            // output stable and predictable for the LLM to reason about.
            const phaseOrder = Object.fromEntries(
                PHASES.map((p, i) => [p, i])
            );
            projects.sort((a, b) => {
                const pa = phaseOrder[a.phase] ?? 99;
                const pb = phaseOrder[b.phase] ?? 99;
                if (pa !== pb) return pa - pb;
                return (a.priority || 999999) - (b.priority || 999999);
            });

            const out = args.slim ? projects.map(slimProject) : projects;
            return ok({ count: out.length, projects: out });
        }
    );

    // -----------------------------------------------------------------------
    // 2. get_project
    // -----------------------------------------------------------------------
    server.registerTool(
        "get_project",
        {
            title: "Get project",
            description:
                "Fetch a single project by ID, including artifacts, discovery_validation, " +
                "phase_history, comments, and (if set) jira_link.",
            inputSchema: {
                project_id: z.string().describe("The project's id field."),
            },
        },
        async ({ project_id }) => {
            const p = await fetchProject(db, project_id);
            if (!p) return err(`Project not found: ${project_id}`);
            return ok(p);
        }
    );

    // -----------------------------------------------------------------------
    // 3. create_project
    // -----------------------------------------------------------------------
    server.registerTool(
        "create_project",
        {
            title: "Create project",
            description:
                "Create a new project. The new project is appended to the bottom of its " +
                "phase column (priority = current count + 1), matching the web app's behavior.",
            inputSchema: {
                title: z.string().min(1).describe("Project title (required)."),
                description: z.string().optional(),
                phase: z.enum(PHASES).optional().default("idea"),
                pm_owner: z.string().optional(),
                dev_lead: z.string().optional(),
                ux_lead: z.string().optional(),
                loe_estimate: z.string().optional()
                    .describe("Free-text level-of-effort estimate (e.g., 'M', '2 sprints')."),
                jira_link: z.string().optional()
                    .describe("URL to the Jira ticket, if any."),
                engineering_teams: z.array(z.string()).optional(),
                boards: z.array(z.enum(BOARDS)).optional()
                    .describe("Boards to assign this project to."),
                release_date: z.string().optional()
                    .describe("ISO date string. Stored under artifacts.release_date."),
                release_confidence: z.enum(RELEASE_CONFIDENCES).optional()
                    .describe("Only meaningful for delivery-phase projects."),
            },
        },
        async (args) => {
            const phase = args.phase || "idea";

            // Compute priority = bottom of the chosen phase column + 1.
            const all = await fetchAllProjects(db);
            const phaseCount = Object.values(all).filter(
                (p) => p.phase === phase && !p.released
            ).length;
            const priority = phaseCount + 1;

            const id = generateId();
            const ts = nowIso();
            const project = {
                id,
                title: args.title,
                description: args.description || "",
                phase,
                priority,
                pm_owner: args.pm_owner || "",
                dev_lead: args.dev_lead || "",
                ux_lead: args.ux_lead || "",
                loe_estimate: args.loe_estimate || "",
                jira_link: args.jira_link || "",
                engineering_teams: args.engineering_teams || [],
                boards: args.boards || [],
                created_at: ts,
                updated_at: ts,
                phase_history: {
                    "0": { phase, entered_at: ts, entered_by: "mcp" },
                },
                discovery_validation: {
                    value: false,
                    usability: false,
                    feasibility: false,
                    viability: false,
                },
                artifacts: {},
            };

            // Release fields are only meaningful in delivery phase.
            if (phase === "delivery") {
                if (args.release_date) {
                    project.artifacts.release_date = args.release_date;
                }
                project.release_confidence = args.release_confidence || "green";
            }

            await db.ref(`projects/${id}`).set(project);
            return ok({ created: true, project });
        }
    );

    // -----------------------------------------------------------------------
    // 4. update_project
    // -----------------------------------------------------------------------
    // Updates scalar fields only. Phase changes go through move_project_phase
    // (which appends to phase_history). Priority changes go through
    // set_priority (which renumbers the column).
    server.registerTool(
        "update_project",
        {
            title: "Update project",
            description:
                "Update top-level fields on a project. Does NOT change phase or priority — " +
                "use move_project_phase or set_priority for those. Pass only the fields you " +
                "want to change.",
            inputSchema: {
                project_id: z.string(),
                title: z.string().optional(),
                description: z.string().optional(),
                pm_owner: z.string().optional(),
                dev_lead: z.string().optional(),
                ux_lead: z.string().optional(),
                loe_estimate: z.string().optional(),
                jira_link: z.string().optional(),
                engineering_teams: z.array(z.string()).optional(),
                boards: z.array(z.enum(BOARDS)).optional(),
                release_confidence: z.enum(RELEASE_CONFIDENCES).optional(),
                released: z.boolean().optional()
                    .describe("Set true to hide from board (still in DB), false to restore."),
            },
        },
        async (args) => {
            const { project_id, ...rest } = args;
            const existing = await fetchProject(db, project_id);
            if (!existing) return err(`Project not found: ${project_id}`);

            // Build an update object containing only the keys the caller passed.
            const updates = { updated_at: nowIso() };
            for (const [k, v] of Object.entries(rest)) {
                if (v !== undefined) updates[k] = v;
            }

            // Track release timestamp the same way the web app does.
            if (rest.released === true && !existing.released) {
                updates.released_at = nowIso();
            }

            await db.ref(`projects/${project_id}`).update(updates);
            const after = await fetchProject(db, project_id);
            return ok({ updated: true, project: after });
        }
    );

    // -----------------------------------------------------------------------
    // 5. move_project_phase
    // -----------------------------------------------------------------------
    // Per user direction, this does NOT enforce TRANSITION_REQUIREMENTS.
    // The caller can optionally pass artifacts which will be merged into
    // project.artifacts in the same write — useful so the LLM doesn't have
    // to chain update_artifacts + move_project_phase.
    server.registerTool(
        "move_project_phase",
        {
            title: "Move project to a new phase",
            description:
                "Change a project's phase and append an entry to phase_history. " +
                "Optionally set artifact URLs in the same operation. The new project is " +
                "placed at the bottom of the target phase column. " +
                "Note: artifact requirements (e.g., discovery_plan_url for idea→discovery) " +
                "are NOT enforced.",
            inputSchema: {
                project_id: z.string(),
                target_phase: z.enum(PHASES),
                artifacts: z
                    .record(z.string(), z.string())
                    .optional()
                    .describe(
                        "Optional artifact key/value map to merge into project.artifacts. " +
                            `Known keys include: ${KNOWN_ARTIFACT_KEYS.join(", ")}.`
                    ),
            },
        },
        async ({ project_id, target_phase, artifacts }) => {
            const existing = await fetchProject(db, project_id);
            if (!existing) return err(`Project not found: ${project_id}`);

            const ts = nowIso();
            const phaseHistory = existing.phase_history || {};
            const nextKey = Object.keys(phaseHistory).length.toString();
            phaseHistory[nextKey] = {
                phase: target_phase,
                entered_at: ts,
                entered_by: "mcp",
            };

            // Compute new priority = bottom of target phase column.
            const all = await fetchAllProjects(db);
            const phaseCount = Object.values(all).filter(
                (p) => p.phase === target_phase && p.id !== project_id && !p.released
            ).length;

            const updates = {
                phase: target_phase,
                priority: phaseCount + 1,
                phase_history: phaseHistory,
                updated_at: ts,
            };

            // Merge any provided artifacts. We preserve existing artifact keys
            // not mentioned in the call so this can't accidentally drop data.
            if (artifacts && Object.keys(artifacts).length > 0) {
                updates.artifacts = { ...(existing.artifacts || {}), ...artifacts };
            }

            await db.ref(`projects/${project_id}`).update(updates);
            const after = await fetchProject(db, project_id);
            return ok({ moved: true, project: after });
        }
    );

    // -----------------------------------------------------------------------
    // 6. set_priority
    // -----------------------------------------------------------------------
    // Renumbers all projects in the target phase so they stay 1..N contiguous.
    // Mirrors the batch-update logic at /app.js:1437-1446.
    server.registerTool(
        "set_priority",
        {
            title: "Set project priority",
            description:
                "Move a project to a new 1-indexed priority within its current phase column. " +
                "All other projects in the column are renumbered to stay contiguous.",
            inputSchema: {
                project_id: z.string(),
                priority: z
                    .number()
                    .int()
                    .min(1)
                    .describe("Target 1-indexed priority within the project's phase column."),
            },
        },
        async ({ project_id, priority }) => {
            const existing = await fetchProject(db, project_id);
            if (!existing) return err(`Project not found: ${project_id}`);

            const all = await fetchAllProjects(db);
            // Other projects in the same phase, sorted by current priority.
            const others = Object.values(all)
                .filter(
                    (p) =>
                        p.phase === existing.phase &&
                        p.id !== project_id &&
                        !p.released
                )
                .sort(
                    (a, b) => (a.priority || 999999) - (b.priority || 999999)
                );

            // Insert the moved project at the requested position (clamped).
            const insertIdx = Math.min(priority - 1, others.length);
            others.splice(insertIdx, 0, existing);

            // Build a multi-path update — one DB round-trip for all renumbers.
            const ts = nowIso();
            const batch = {};
            others.forEach((p, i) => {
                const newPriority = i + 1;
                if (p.priority !== newPriority) {
                    batch[`projects/${p.id}/priority`] = newPriority;
                    batch[`projects/${p.id}/updated_at`] = ts;
                }
            });

            if (Object.keys(batch).length > 0) {
                await db.ref().update(batch);
            }

            const after = await fetchProject(db, project_id);
            return ok({
                updated: true,
                project: after,
                column_size: others.length,
            });
        }
    );

    // -----------------------------------------------------------------------
    // 7. update_artifacts
    // -----------------------------------------------------------------------
    server.registerTool(
        "update_artifacts",
        {
            title: "Update project artifacts",
            description:
                "Set or clear artifact URLs/dates on a project. Pass keys with string values to " +
                "set them, or pass keys with null/empty string to remove them. Other artifact " +
                `keys are preserved. Known keys: ${KNOWN_ARTIFACT_KEYS.join(", ")}.`,
            inputSchema: {
                project_id: z.string(),
                artifacts: z
                    .record(z.string(), z.union([z.string(), z.null()]))
                    .describe(
                        "Map of artifact key to value. Use null or empty string to remove a key."
                    ),
            },
        },
        async ({ project_id, artifacts }) => {
            const existing = await fetchProject(db, project_id);
            if (!existing) return err(`Project not found: ${project_id}`);

            const merged = { ...(existing.artifacts || {}) };
            for (const [k, v] of Object.entries(artifacts)) {
                if (v === null || v === "") {
                    delete merged[k];
                } else {
                    merged[k] = v;
                }
            }

            await db.ref(`projects/${project_id}`).update({
                artifacts: merged,
                updated_at: nowIso(),
            });
            const after = await fetchProject(db, project_id);
            return ok({ updated: true, project: after });
        }
    );

    // -----------------------------------------------------------------------
    // 8. set_discovery_validation
    // -----------------------------------------------------------------------
    server.registerTool(
        "set_discovery_validation",
        {
            title: "Set discovery validation flags",
            description:
                "Toggle the V/U/F/Vi (Value/Usability/Feasibility/Viability) flags for a " +
                "project in the discovery phase. Only the flags you pass are changed.",
            inputSchema: {
                project_id: z.string(),
                value: z.boolean().optional(),
                usability: z.boolean().optional(),
                feasibility: z.boolean().optional(),
                viability: z.boolean().optional(),
            },
        },
        async ({ project_id, ...flags }) => {
            const existing = await fetchProject(db, project_id);
            if (!existing) return err(`Project not found: ${project_id}`);

            const merged = {
                value: false,
                usability: false,
                feasibility: false,
                viability: false,
                ...(existing.discovery_validation || {}),
            };
            for (const [k, v] of Object.entries(flags)) {
                if (v !== undefined) merged[k] = v;
            }

            await db.ref(`projects/${project_id}`).update({
                discovery_validation: merged,
                updated_at: nowIso(),
            });
            const after = await fetchProject(db, project_id);
            return ok({ updated: true, project: after });
        }
    );

    // -----------------------------------------------------------------------
    // 9. add_comment
    // -----------------------------------------------------------------------
    server.registerTool(
        "add_comment",
        {
            title: "Add a comment to a project",
            description:
                "Append a comment to a project's comments map. Stored at " +
                "projects/{id}/comments/{commentId}.",
            inputSchema: {
                project_id: z.string(),
                text: z.string().min(1),
                author: z.string().optional()
                    .describe("Author name; defaults to 'Claude' if omitted."),
            },
        },
        async ({ project_id, text, author }) => {
            const existing = await fetchProject(db, project_id);
            if (!existing) return err(`Project not found: ${project_id}`);

            const commentId = generateId();
            const comment = {
                text,
                author: author || "Claude",
                created_at: nowIso(),
            };
            await db
                .ref(`projects/${project_id}/comments/${commentId}`)
                .set(comment);

            return ok({ added: true, comment_id: commentId, comment });
        }
    );

    // -----------------------------------------------------------------------
    // 10. delete_comment
    // -----------------------------------------------------------------------
    server.registerTool(
        "delete_comment",
        {
            title: "Delete a comment",
            description: "Remove a single comment from a project.",
            inputSchema: {
                project_id: z.string(),
                comment_id: z.string(),
            },
        },
        async ({ project_id, comment_id }) => {
            const ref = db.ref(`projects/${project_id}/comments/${comment_id}`);
            const snap = await ref.once("value");
            if (!snap.exists()) {
                return err(
                    `Comment not found: project=${project_id} comment=${comment_id}`
                );
            }
            await ref.remove();
            return ok({ deleted: true });
        }
    );

    // -----------------------------------------------------------------------
    // 11. delete_project (gated behind confirm:true)
    // -----------------------------------------------------------------------
    // Hard-deletes the project and all its nested data. Per user direction,
    // this requires an explicit confirm flag so the LLM can't trigger it
    // by accident — the caller has to read the tool description, decide it's
    // really what they want, and pass confirm:true.
    server.registerTool(
        "delete_project",
        {
            title: "Delete a project (irreversible)",
            description:
                "Permanently delete a project from the database. This cannot be undone. " +
                "You MUST pass confirm=true; the call is rejected otherwise as a safety check.",
            inputSchema: {
                project_id: z.string(),
                confirm: z
                    .literal(true)
                    .describe("Must be the literal value true to proceed."),
            },
        },
        async ({ project_id, confirm }) => {
            // The Zod schema already requires confirm===true, but we double-
            // check defensively in case the schema is bypassed somehow.
            if (confirm !== true) {
                return err("Refusing to delete: confirm must be true.");
            }
            const existing = await fetchProject(db, project_id);
            if (!existing) return err(`Project not found: ${project_id}`);

            await db.ref(`projects/${project_id}`).remove();
            return ok({
                deleted: true,
                project_id,
                deleted_title: existing.title,
            });
        }
    );

    return server;
}

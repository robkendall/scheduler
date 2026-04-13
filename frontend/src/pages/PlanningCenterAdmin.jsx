import { useEffect, useMemo, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

import {
    createRole,
    deleteRole,
    getPlanningCenterHealth,
    getPlanningCenterServiceTypes,
    getPlanningCenterTeamMembers,
    getPlanningCenterTeams,
    getRoles,
    importPlanningCenterRole,
    updateRole,
} from "../api/scheduler";
import PageShell from "../components/PageShell";

function formatImportSummary(roleName, result) {
    return `${roleName}: ${result.imported.people} people, ${result.imported.positions} positions, ${result.imported.personPositionAssignments} assignments, ${result.imported.blockedOutRanges} blocked-out ranges, ${result.imported.schedulesImported ?? 0} schedules imported, ${result.imported.scheduleAssignmentsImported ?? 0} schedule assignments imported, ${result.imported.peopleWithPcoHistory ?? 0} with PCO history, ${result.imported.pcoWeeksDiscovered ?? 0} PCO weeks discovered, ${result.imported.normalWeeksInferred ?? 0} normal weeks inferred`;
}

function createRoleDraft(role) {
    return {
        id: role.id,
        name: role.name,
        teamId: role.external_role_id || "",
        applyStrategy: role.apply_strategy || "single_apply",
        globalMinAssignments: String(role.global_min_assignments ?? 1),
        globalMaxAssignments: String(role.global_max_assignments ?? 1),
    };
}

function applyStrategyLabel(value) {
    return value === "group_apply" ? "Group Apply" : "Single Apply";
}

function PlanningCenterAdmin() {
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(true);
    const [roles, setRoles] = useState([]);
    const [teams, setTeams] = useState([]);
    const [serviceTypes, setServiceTypes] = useState([]);
    const [health, setHealth] = useState(null);
    const [busyKey, setBusyKey] = useState("");
    const [importSummary, setImportSummary] = useState([]);
    const [teamMembersOpen, setTeamMembersOpen] = useState(false);
    const [selectedTeam, setSelectedTeam] = useState(null);
    const [selectedTeamMembers, setSelectedTeamMembers] = useState([]);
    const [newRoleName, setNewRoleName] = useState("");
    const [selectedRole, setSelectedRole] = useState(null);
    const [roleDraft, setRoleDraft] = useState(null);
    const [rolePendingDelete, setRolePendingDelete] = useState(null);

    async function loadRoles(preserveSelectedRoleId = selectedRole?.id || null) {
        const roleData = await getRoles();
        setRoles(roleData);

        if (preserveSelectedRoleId) {
            const nextSelectedRole = roleData.find((role) => role.id === preserveSelectedRoleId) || null;
            setSelectedRole(nextSelectedRole);
            setRoleDraft(nextSelectedRole ? createRoleDraft(nextSelectedRole) : null);
        }
    }

    async function loadBaseData() {
        setLoading(true);
        setError("");

        try {
            await loadRoles();
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        loadBaseData();
    }, []);

    const mappedRoles = useMemo(
        () => roles.filter((role) => role.external_source === "planning_center" && role.external_role_kind === "services_team" && role.external_role_id),
        [roles],
    );

    function openRole(role) {
        setSelectedRole(role);
        setRoleDraft(createRoleDraft(role));
        setError("");
    }

    function closeRoleModal() {
        if (busyKey.startsWith("save-role-") || busyKey.startsWith("import-") || busyKey.startsWith("delete-role-")) {
            return;
        }

        setSelectedRole(null);
        setRoleDraft(null);
    }

    async function handleHealthCheck() {
        setBusyKey("health");
        setError("");

        try {
            const result = await getPlanningCenterHealth();
            setHealth(result);
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setBusyKey("");
        }
    }

    async function handleLoadTeams() {
        setBusyKey("teams");
        setError("");

        try {
            const data = await getPlanningCenterTeams();
            setTeams(data);
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setBusyKey("");
        }
    }

    async function handleLoadServiceTypes() {
        setBusyKey("serviceTypes");
        setError("");

        try {
            const data = await getPlanningCenterServiceTypes();
            setServiceTypes(data);
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setBusyKey("");
        }
    }

    async function handleViewTeamMembers(team) {
        setBusyKey(`members-${team.id}`);
        setError("");

        try {
            const members = await getPlanningCenterTeamMembers(team.id);
            setSelectedTeam(team);
            setSelectedTeamMembers(members);
            setTeamMembersOpen(true);
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setBusyKey("");
        }
    }

    async function handleCreateRole(event) {
        event.preventDefault();
        const roleName = String(newRoleName || "").trim();
        if (!roleName) {
            setError("Role name is required.");
            return;
        }

        setBusyKey("create-role");
        setError("");

        try {
            await createRole({ name: roleName });
            setNewRoleName("");
            await loadRoles();
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setBusyKey("");
        }
    }

    async function saveRoleDraft() {
        if (!selectedRole || !roleDraft) {
            return;
        }

        const roleName = String(roleDraft.name || "").trim();
        if (!roleName) {
            setError("Role name is required.");
            return;
        }

        const globalMin = Number(roleDraft.globalMinAssignments);
        const globalMax = Number(roleDraft.globalMaxAssignments);
        if (!Number.isInteger(globalMin) || globalMin < 0) {
            setError("Global minimum assignments must be a non-negative integer.");
            return;
        }
        if (!Number.isInteger(globalMax) || globalMax < globalMin) {
            setError("Global maximum assignments must be greater than or equal to the global minimum.");
            return;
        }

        const teamId = String(roleDraft.teamId || "").trim();

        setBusyKey(`save-role-${selectedRole.id}`);
        setError("");

        try {
            const payload = {
                name: roleName,
                applyStrategy: roleDraft.applyStrategy,
                globalMinAssignments: globalMin,
                globalMaxAssignments: globalMax,
            };

            if (teamId) {
                payload.externalSource = "planning_center";
                payload.externalRoleKind = "services_team";
                payload.externalRoleId = teamId;
            }

            await updateRole(selectedRole.id, payload);
            await loadRoles(selectedRole.id);
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setBusyKey("");
        }
    }

    async function importRole(role) {
        setBusyKey(`import-${role.id}`);
        setError("");

        try {
            const result = await importPlanningCenterRole(role.id);
            setImportSummary((prev) => [
                formatImportSummary(role.name, result),
                ...prev,
            ].slice(0, 12));
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setBusyKey("");
        }
    }

    async function handleImportSelectedRole() {
        if (!selectedRole) {
            return;
        }

        await importRole(selectedRole);
    }

    async function confirmDeleteRole() {
        if (!rolePendingDelete) {
            return;
        }

        setBusyKey(`delete-role-${rolePendingDelete.id}`);
        setError("");

        try {
            const deletedRoleId = rolePendingDelete.id;
            await deleteRole(deletedRoleId);
            setRolePendingDelete(null);
            if (selectedRole?.id === deletedRoleId) {
                setSelectedRole(null);
                setRoleDraft(null);
            }
            await loadRoles();
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setBusyKey("");
        }
    }

    async function importAllMappedRoles() {
        setBusyKey("import-all");
        setError("");

        try {
            for (const role of mappedRoles) {
                const result = await importPlanningCenterRole(role.id);
                setImportSummary((prev) => [
                    formatImportSummary(role.name, result),
                    ...prev,
                ].slice(0, 12));
            }
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setBusyKey("");
        }
    }

    return (
        <PageShell
            eyebrow="Admin"
            title="Admin"
            description="Run Planning Center requests and manage role scheduling settings."
        >
            {error ? <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert> : null}
            {loading ? <Typography sx={{ mb: 2 }}>Loading admin tools...</Typography> : null}

            <Box className="hero-card form-stack" sx={{ mb: 2 }}>
                <Typography variant="h5">Role management</Typography>
                <Box component="form" onSubmit={handleCreateRole}>
                    <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                        <TextField
                            label="New role name"
                            value={newRoleName}
                            onChange={(event) => setNewRoleName(event.target.value)}
                            required
                        />
                        <Button type="submit" variant="contained" disabled={Boolean(busyKey)}>
                            {busyKey === "create-role" ? "Creating..." : "Create role"}
                        </Button>
                    </Stack>
                </Box>
            </Box>

            <Box className="hero-card form-stack" sx={{ mb: 2 }}>
                <Typography variant="h5">API Requests</Typography>
                <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                    <Button variant="contained" onClick={handleHealthCheck} disabled={Boolean(busyKey)}>
                        {busyKey === "health" ? "Checking..." : "Test connection"}
                    </Button>
                    <Button variant="outlined" onClick={handleLoadTeams} disabled={Boolean(busyKey)}>
                        {busyKey === "teams" ? "Loading teams..." : "Load teams"}
                    </Button>
                    <Button variant="outlined" onClick={handleLoadServiceTypes} disabled={Boolean(busyKey)}>
                        {busyKey === "serviceTypes" ? "Loading service types..." : "Load service types"}
                    </Button>
                </Stack>
                {health ? (
                    <Alert severity="success">
                        Connected to Planning Center{health.organizationName ? `: ${health.organizationName}` : ""}
                    </Alert>
                ) : null}
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                    <Chip label={`Teams loaded: ${teams.length}`} />
                    <Chip label={`Service types loaded: ${serviceTypes.length}`} />
                </Stack>

                {teams.length > 0 ? (
                    <TableContainer sx={{ border: 1, borderColor: "divider", borderRadius: 1 }}>
                        <Table size="small" aria-label="loaded planning center teams">
                            <TableHead>
                                <TableRow>
                                    <TableCell>Team Name</TableCell>
                                    <TableCell>Team ID</TableCell>
                                    <TableCell align="right">Members</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {teams.map((team) => (
                                    <TableRow key={team.id} hover>
                                        <TableCell>{team.name}</TableCell>
                                        <TableCell>{team.id}</TableCell>
                                        <TableCell align="right">
                                            <Button
                                                size="small"
                                                variant="outlined"
                                                onClick={() => handleViewTeamMembers(team)}
                                                disabled={Boolean(busyKey)}
                                            >
                                                {busyKey === `members-${team.id}` ? "Loading..." : "View members"}
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </TableContainer>
                ) : null}

                {serviceTypes.length > 0 ? (
                    <TableContainer sx={{ border: 1, borderColor: "divider", borderRadius: 1 }}>
                        <Table size="small" aria-label="loaded planning center service types">
                            <TableHead>
                                <TableRow>
                                    <TableCell>Service Type Name</TableCell>
                                    <TableCell>Service Type ID</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {serviceTypes.map((serviceType) => (
                                    <TableRow key={serviceType.id} hover>
                                        <TableCell>{serviceType.name}</TableCell>
                                        <TableCell>{serviceType.id}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </TableContainer>
                ) : null}
            </Box>

            <Box className="hero-card form-stack" sx={{ mb: 2 }}>
                <Typography variant="h5">Roles</Typography>
                <Typography variant="body2" color="text.secondary">
                    Click a role to edit its scheduling mode, global assignment limits, and Planning Center mapping.
                </Typography>
                <Stack spacing={1}>
                    {roles.map((role) => (
                        <Box
                            key={role.id}
                            onClick={() => openRole(role)}
                            sx={{
                                border: "1px solid rgba(15, 118, 110, 0.18)",
                                borderRadius: 0.5,
                                p: 1.25,
                                backgroundColor: "rgba(255, 250, 242, 0.85)",
                                cursor: "pointer",
                                "&:hover": {
                                    backgroundColor: "rgba(255, 245, 232, 0.95)",
                                },
                            }}
                        >
                            <Stack direction={{ xs: "column", sm: "row" }} spacing={1} justifyContent="space-between" alignItems={{ sm: "center" }}>
                                <Typography sx={{ fontWeight: 600 }}>{role.name}</Typography>
                                <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                                    <Chip size="small" label={applyStrategyLabel(role.apply_strategy)} />
                                    <Chip size="small" variant="outlined" label={`${role.global_min_assignments ?? 1}-${role.global_max_assignments ?? 1} assignments`} />
                                    {role.external_role_id ? <Chip size="small" variant="outlined" label={`Team ${role.external_role_id}`} /> : null}
                                </Stack>
                            </Stack>
                        </Box>
                    ))}
                </Stack>
            </Box>

            <Box className="hero-card form-stack">
                <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" spacing={1}>
                    <Typography variant="h5">Batch Import</Typography>
                    <Button
                        variant="contained"
                        onClick={importAllMappedRoles}
                        disabled={Boolean(busyKey) || mappedRoles.length === 0}
                    >
                        {busyKey === "import-all" ? "Importing mapped roles..." : `Import all mapped roles (${mappedRoles.length})`}
                    </Button>
                </Stack>
                <Divider />
                {importSummary.length === 0 ? (
                    <Typography color="text.secondary">No imports run yet.</Typography>
                ) : (
                    <Stack spacing={0.5}>
                        {importSummary.map((line) => (
                            <Typography key={line} variant="body2">{line}</Typography>
                        ))}
                    </Stack>
                )}
            </Box>

            <Dialog open={Boolean(selectedRole && roleDraft)} onClose={closeRoleModal} fullWidth maxWidth="sm">
                <DialogTitle>{selectedRole ? selectedRole.name : "Role"}</DialogTitle>
                <DialogContent dividers>
                    {roleDraft ? (
                        <Stack spacing={2} sx={{ pt: 0.5 }}>
                            <TextField
                                label="Role name"
                                value={roleDraft.name}
                                onChange={(event) => setRoleDraft((prev) => ({ ...prev, name: event.target.value }))}
                                fullWidth
                            />
                            <TextField
                                select
                                label="Scheduling mode"
                                value={roleDraft.applyStrategy}
                                onChange={(event) => setRoleDraft((prev) => ({ ...prev, applyStrategy: event.target.value }))}
                                fullWidth
                            >
                                <MenuItem value="single_apply">Single Apply</MenuItem>
                                <MenuItem value="group_apply">Group Apply</MenuItem>
                            </TextField>
                            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                                <TextField
                                    label="Global minimum assignments"
                                    type="number"
                                    value={roleDraft.globalMinAssignments}
                                    onChange={(event) => setRoleDraft((prev) => ({ ...prev, globalMinAssignments: event.target.value }))}
                                    inputProps={{ min: 0 }}
                                    fullWidth
                                />
                                <TextField
                                    label="Global maximum assignments"
                                    type="number"
                                    value={roleDraft.globalMaxAssignments}
                                    onChange={(event) => setRoleDraft((prev) => ({ ...prev, globalMaxAssignments: event.target.value }))}
                                    inputProps={{ min: Number(roleDraft.globalMinAssignments) || 0 }}
                                    fullWidth
                                />
                            </Stack>
                            <Divider />
                            <TextField
                                label="Planning Center Team ID"
                                placeholder="e.g. 12345"
                                value={roleDraft.teamId}
                                onChange={(event) => setRoleDraft((prev) => ({ ...prev, teamId: event.target.value }))}
                                fullWidth
                            />
                            <Typography variant="body2" color="text.secondary">
                                Set a team ID if this role should import from a Planning Center services team.
                            </Typography>
                        </Stack>
                    ) : null}
                </DialogContent>
                <DialogActions sx={{ justifyContent: "space-between", px: 3, py: 1.5 }}>
                    <Button color="error" onClick={() => setRolePendingDelete(selectedRole)} disabled={!selectedRole || Boolean(busyKey)}>
                        Delete role
                    </Button>
                    <Stack direction="row" spacing={1}>
                        <Button variant="outlined" onClick={handleImportSelectedRole} disabled={!selectedRole || Boolean(busyKey)}>
                            {selectedRole && busyKey === `import-${selectedRole.id}` ? "Importing..." : "Import role"}
                        </Button>
                        <Button onClick={closeRoleModal} disabled={Boolean(busyKey)}>Close</Button>
                        <Button variant="contained" onClick={saveRoleDraft} disabled={!selectedRole || Boolean(busyKey)}>
                            {selectedRole && busyKey === `save-role-${selectedRole.id}` ? "Saving..." : "Save changes"}
                        </Button>
                    </Stack>
                </DialogActions>
            </Dialog>

            <Dialog
                open={teamMembersOpen}
                onClose={() => setTeamMembersOpen(false)}
                fullWidth
                maxWidth="md"
            >
                <DialogTitle>
                    {selectedTeam ? `Team members: ${selectedTeam.name} (${selectedTeam.id})` : "Team members"}
                </DialogTitle>
                <DialogContent dividers>
                    {selectedTeamMembers.length === 0 ? (
                        <Typography color="text.secondary">No members were returned for this team.</Typography>
                    ) : (
                        <Table size="small" aria-label="selected team members">
                            <TableHead>
                                <TableRow>
                                    <TableCell>Name</TableCell>
                                    <TableCell>Person ID</TableCell>
                                    <TableCell>Email</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {selectedTeamMembers.map((member) => (
                                    <TableRow key={member.id} hover>
                                        <TableCell>{member.name}</TableCell>
                                        <TableCell>{member.id}</TableCell>
                                        <TableCell>{member.email || "-"}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setTeamMembersOpen(false)}>Close</Button>
                </DialogActions>
            </Dialog>

            <Dialog
                open={Boolean(rolePendingDelete)}
                onClose={() => {
                    if (!busyKey.startsWith("delete-role-")) {
                        setRolePendingDelete(null);
                    }
                }}
                fullWidth
                maxWidth="xs"
            >
                <DialogTitle>Delete role?</DialogTitle>
                <DialogContent dividers>
                    <Typography>
                        {rolePendingDelete
                            ? `Delete the role "${rolePendingDelete.name}"? This action cannot be undone.`
                            : "Delete this role?"}
                    </Typography>
                </DialogContent>
                <DialogActions>
                    <Button
                        onClick={() => setRolePendingDelete(null)}
                        disabled={busyKey.startsWith("delete-role-")}
                    >
                        Cancel
                    </Button>
                    <Button
                        color="error"
                        variant="contained"
                        onClick={confirmDeleteRole}
                        disabled={busyKey.startsWith("delete-role-")}
                    >
                        {busyKey.startsWith("delete-role-") ? "Deleting..." : "Delete role"}
                    </Button>
                </DialogActions>
            </Dialog>
        </PageShell>
    );
}

export default PlanningCenterAdmin;

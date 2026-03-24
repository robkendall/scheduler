import { useEffect, useMemo, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
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
    getPlanningCenterHealth,
    getPlanningCenterTeamMembers,
    getPlanningCenterServiceTypes,
    getPlanningCenterTeams,
    getRoles,
    importPlanningCenterRole,
    updateRole,
} from "../api/scheduler";
import PageShell from "../components/PageShell";

function PlanningCenterAdmin() {
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(true);
    const [roles, setRoles] = useState([]);
    const [teams, setTeams] = useState([]);
    const [serviceTypes, setServiceTypes] = useState([]);
    const [teamIdByRole, setTeamIdByRole] = useState({});
    const [health, setHealth] = useState(null);
    const [busyKey, setBusyKey] = useState("");
    const [importSummary, setImportSummary] = useState([]);
    const [teamMembersOpen, setTeamMembersOpen] = useState(false);
    const [selectedTeam, setSelectedTeam] = useState(null);
    const [selectedTeamMembers, setSelectedTeamMembers] = useState([]);

    async function loadRoles() {
        const roleData = await getRoles();
        setRoles(roleData);
        setTeamIdByRole(
            Object.fromEntries(
                roleData.map((role) => [role.id, role.external_role_id || ""]),
            ),
        );
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

    async function saveRoleMapping(role) {
        const teamId = String(teamIdByRole[role.id] || "").trim();
        if (!teamId) {
            setError(`Team ID is required for role ${role.name}.`);
            return;
        }

        setBusyKey(`save-${role.id}`);
        setError("");

        try {
            await updateRole(role.id, {
                name: role.name,
                externalSource: "planning_center",
                externalRoleKind: "services_team",
                externalRoleId: teamId,
            });
            await loadRoles();
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
                `${role.name}: ${result.imported.people} people, ${result.imported.positions} positions, ${result.imported.personPositionAssignments} assignments, ${result.imported.blockedOutRanges} blocked-out ranges, ${result.imported.schedulesImported ?? 0} schedules imported, ${result.imported.scheduleAssignmentsImported ?? 0} schedule assignments imported, ${result.imported.peopleWithPcoHistory ?? 0} with PCO history, ${result.imported.pcoWeeksDiscovered ?? 0} PCO weeks discovered, ${result.imported.normalWeeksInferred ?? 0} normal weeks inferred`,
                ...prev,
            ].slice(0, 12));
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
                // Keep imports deterministic and easy to troubleshoot.
                 
                const result = await importPlanningCenterRole(role.id);
                setImportSummary((prev) => [
                    `${role.name}: ${result.imported.people} people, ${result.imported.positions} positions, ${result.imported.personPositionAssignments} assignments, ${result.imported.blockedOutRanges} blocked-out ranges, ${result.imported.schedulesImported ?? 0} schedules imported, ${result.imported.scheduleAssignmentsImported ?? 0} schedule assignments imported, ${result.imported.peopleWithPcoHistory ?? 0} with PCO history, ${result.imported.pcoWeeksDiscovered ?? 0} PCO weeks discovered, ${result.imported.normalWeeksInferred ?? 0} normal weeks inferred`,
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
            description="Run Planning Center requests and import team data into scheduler roles."
        >
            {error ? <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert> : null}
            {loading ? <Typography sx={{ mb: 2 }}>Loading admin tools...</Typography> : null}

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

            <TableContainer className="hero-card" sx={{ mb: 2, overflowX: "auto" }}>
                <Table size="small" aria-label="planning center role mappings">
                    <TableHead>
                        <TableRow>
                            <TableCell>Role</TableCell>
                            <TableCell>Planning Center Team ID</TableCell>
                            <TableCell align="right">Actions</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {roles.map((role) => (
                            <TableRow key={role.id} hover>
                                <TableCell>{role.name}</TableCell>
                                <TableCell>
                                    <TextField
                                        size="small"
                                        placeholder="e.g. 12345"
                                        value={teamIdByRole[role.id] || ""}
                                        onChange={(event) => {
                                            const value = event.target.value;
                                            setTeamIdByRole((prev) => ({ ...prev, [role.id]: value }));
                                        }}
                                    />
                                </TableCell>
                                <TableCell align="right">
                                    <Stack direction="row" spacing={1} justifyContent="flex-end">
                                        <Button
                                            size="small"
                                            variant="outlined"
                                            onClick={() => saveRoleMapping(role)}
                                            disabled={Boolean(busyKey)}
                                        >
                                            {busyKey === `save-${role.id}` ? "Saving..." : "Save mapping"}
                                        </Button>
                                        <Button
                                            size="small"
                                            variant="contained"
                                            onClick={() => importRole(role)}
                                            disabled={Boolean(busyKey)}
                                        >
                                            {busyKey === `import-${role.id}` ? "Importing..." : "Import role"}
                                        </Button>
                                    </Stack>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </TableContainer>

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
        </PageShell>
    );
}

export default PlanningCenterAdmin;

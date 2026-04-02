import { useEffect, useMemo, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";

import { getRoles, syncPlanningCenterRoleBlockouts } from "../api/scheduler";
import PageShell from "../components/PageShell";
import { formatDisplayDate } from "../utils/date";

function formatBlockoutSyncSummary(roleName, result) {
    return `${roleName}: future blockouts synced for ${result.sync.peopleSeen} people, ${result.sync.futureRemoteRanges} remote ranges seen, ${result.sync.inserted} inserted, ${result.sync.updated} updated, ${result.sync.deleted} deleted, ${result.sync.matchedLegacy} matched legacy rows`;
}

function Roles({ user }) {
    const [roles, setRoles] = useState([]);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(true);
    const [busyKey, setBusyKey] = useState("");
    const [actionSummary, setActionSummary] = useState([]);

    async function loadRoles() {
        setLoading(true);
        setError("");

        try {
            const data = await getRoles();
            setRoles(data);
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        loadRoles();
    }, []);

    const sortedRoles = useMemo(
        () => [...roles].sort((left, right) => left.name.localeCompare(right.name)),
        [roles],
    );

    async function handleSyncRoleBlockouts(role) {
        setBusyKey(`sync-blockouts-${role.id}`);
        setError("");

        try {
            const result = await syncPlanningCenterRoleBlockouts(role.id);
            setActionSummary((prev) => [
                formatBlockoutSyncSummary(role.name, result),
                ...prev,
            ].slice(0, 12));
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setBusyKey("");
        }
    }

    return (
        <PageShell
            eyebrow="Workspace"
            title="Roles"
            description="View the roles you can access and import future Planning Center blockout dates for mapped roles."
        >
            {error ? <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert> : null}

            <Box className="hero-card form-stack" sx={{ mb: 2 }}>
                <Typography variant="h5">Accessible roles</Typography>
                <Typography color="text.secondary">
                    You can view roles you have access to here. Future blockout import is available on roles mapped to Planning Center.
                </Typography>
            </Box>

            {loading ? <Typography>Loading roles...</Typography> : null}

            <TableContainer className="hero-card" sx={{ mb: 2, overflowX: "auto" }}>
                <Table size="small" aria-label="roles table">
                    <TableHead>
                        <TableRow>
                            <TableCell>Name</TableCell>
                            <TableCell>Created</TableCell>
                            <TableCell align="right">Actions</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {sortedRoles.map((role) => (
                            <TableRow key={role.id} hover>
                                <TableCell>{role.name}</TableCell>
                                <TableCell>{formatDisplayDate(role.created_at)}</TableCell>
                                <TableCell align="right">
                                    <Button
                                        size="small"
                                        variant="outlined"
                                        onClick={() => handleSyncRoleBlockouts(role)}
                                        disabled={Boolean(busyKey) || !(role.external_source === "planning_center" && role.external_role_kind === "services_team" && role.external_role_id)}
                                    >
                                        {busyKey === `sync-blockouts-${role.id}` ? "Importing..." : "Import future blockouts"}
                                    </Button>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </TableContainer>

            <Box className="hero-card form-stack">
                <Typography variant="h5">Recent role actions</Typography>
                {actionSummary.length === 0 ? (
                    <Typography color="text.secondary">No role actions run yet.</Typography>
                ) : (
                    <Stack spacing={0.5}>
                        {actionSummary.map((line) => (
                            <Typography key={line} variant="body2">{line}</Typography>
                        ))}
                    </Stack>
                )}
            </Box>
        </PageShell>
    );
}

export default Roles;
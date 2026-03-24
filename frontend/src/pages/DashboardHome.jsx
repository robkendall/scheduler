import { useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { Link as RouterLink } from "react-router-dom";

import { getDashboard } from "../api/scheduler";
import PageShell from "../components/PageShell";
import RoleSelector from "../components/RoleSelector";
import { formatDisplayDate } from "../utils/date";

function DashboardHome({ activeRoleId, onRoleChange, user }) {
    const [dashboard, setDashboard] = useState(null);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(true);

    const activeRole = user?.roles?.find((role) => role.id === activeRoleId) || null;

    useEffect(() => {
        if (!activeRoleId) {
            // Defer setState to avoid cascading renders
            Promise.resolve().then(() => {
                setDashboard(null);
                setLoading(false);
            });
            return;
        }

        let active = true;
        setLoading(true);
        setError("");

        getDashboard(activeRoleId)
            .then((data) => {
                if (active) {
                    setDashboard(data);
                }
            })
            .catch((requestError) => {
                if (active) {
                    setError(requestError.message);
                }
            })
            .finally(() => {
                if (active) {
                    setLoading(false);
                }
            });

        return () => {
            active = false;
        };
    }, [activeRoleId]);

    return (
        <PageShell
            eyebrow="Dashboard"
            title="Team dashboard"
            description="This is the landing page for the active role. More role-specific tools can be added here later."
        >
            {error ? <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert> : null}

            {!activeRoleId ? (
                <Alert severity="warning">No role is assigned to this account yet. An admin needs to add at least one role.</Alert>
            ) : null}

            <Box className="hero-card form-stack" sx={{ mb: 2 }}>
                <Typography variant="h5">Current role</Typography>
                <Stack direction={{ xs: "column", sm: "row" }} spacing={2} alignItems={{ sm: "center" }}>
                    <RoleSelector
                        activeRoleId={activeRoleId}
                        label="Viewing role"
                        onChange={onRoleChange}
                        roles={user?.roles || []}
                    />
                    <Box>
                        <Typography variant="h4">{activeRole?.name || "No role selected"}</Typography>
                        <Typography color="text.secondary" variant="body2">
                            Your people, positions, and calendar are isolated to this role.
                        </Typography>
                    </Box>
                </Stack>
            </Box>

            <Stack spacing={2}>
                <Box className="hero-card form-stack">
                    <Typography variant="h5">Overview</Typography>
                    {loading ? <Typography>Loading dashboard...</Typography> : null}
                    {!loading && dashboard ? (
                        <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
                            <Box sx={{ flex: 1 }}>
                                <Typography variant="overline">People</Typography>
                                <Typography variant="h3">{dashboard.counts.people}</Typography>
                            </Box>
                            <Box sx={{ flex: 1 }}>
                                <Typography variant="overline">Positions</Typography>
                                <Typography variant="h3">{dashboard.counts.positions}</Typography>
                            </Box>
                            <Box sx={{ flex: 1 }}>
                                <Typography variant="overline">Scheduled Sundays</Typography>
                                <Typography variant="h3">{dashboard.counts.schedules}</Typography>
                            </Box>
                        </Stack>
                    ) : null}
                </Box>

                <Box className="hero-card form-stack">
                    <Typography variant="h5">Upcoming calendar entries</Typography>
                    {!loading && dashboard?.upcoming?.length === 0 ? (
                        <Typography color="text.secondary">No upcoming Sundays are scheduled for this role.</Typography>
                    ) : null}
                    <Stack spacing={1}>
                        {(dashboard?.upcoming || []).map((entry) => (
                            <Box key={entry.id} sx={{ border: "1px solid rgba(15, 118, 110, 0.16)", borderRadius: 0.5, p: 1.5 }}>
                                <Typography sx={{ fontWeight: 700 }}>{formatDisplayDate(entry.track_date)}</Typography>
                                <Typography color="text.secondary" variant="body2">
                                    Week {entry.week_number} • {entry.assignment_count} assignment{entry.assignment_count === 1 ? "" : "s"}
                                </Typography>
                            </Box>
                        ))}
                    </Stack>
                    <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                        <Button component={RouterLink} to="/calendar" variant="contained">
                            Open calendar
                        </Button>
                        {user?.isAdmin ? (
                            <Button component={RouterLink} to="/roles" variant="outlined">
                                Manage roles
                            </Button>
                        ) : null}
                    </Stack>
                </Box>
            </Stack>
        </PageShell>
    );
}

export default DashboardHome;
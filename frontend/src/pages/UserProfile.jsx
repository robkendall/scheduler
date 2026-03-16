import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import PageShell from "../components/PageShell";

function UserProfile({ user }) {
    return (
        <PageShell
            eyebrow="Profile"
            title="Authenticated profile"
            description="Session-backed profile details for the scheduler app."
        >
            <section className="route-card">
                <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: "wrap" }}>
                    <Chip label="Session auth" color="primary" />
                    <Chip label={user?.isAdmin ? "Admin" : "Standard user"} color="secondary" variant="outlined" />
                </Stack>
                <Typography variant="body1" sx={{ mb: 1 }}>
                    Username
                </Typography>
                <Typography variant="h5" sx={{ mb: 2 }}>
                    {user?.username || "Unknown user"}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                    Use the Auth Users page to modify accounts and privileges.
                </Typography>
            </section>
        </PageShell>
    );
}

export default UserProfile;

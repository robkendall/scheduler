import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import PageShell from "../components/PageShell";

function UserProfile({ user }) {
    return (
        <PageShell
            eyebrow="Profile"
            title="Authenticated starter profile"
            description="This page is intentionally thin. It exists to prove the session and route protection model without carrying devotional-specific business logic."
        >
            <section className="route-card">
                <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: "wrap" }}>
                    <Chip label="Session auth enabled" color="primary" />
                    <Chip label="PostgreSQL store" color="secondary" variant="outlined" />
                </Stack>
                <Typography variant="body1" sx={{ mb: 1 }}>
                    Email
                </Typography>
                <Typography variant="h5" sx={{ mb: 2 }}>
                    {user?.email || "Unknown user"}
                </Typography>
                <Typography variant="body1" sx={{ mb: 1 }}>
                    Type
                </Typography>
                <Typography variant="h6" sx={{ mb: 2 }}>
                    {user?.type || "Other"}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                    Register another account or extend the authenticated routes from this trimmed starter.
                </Typography>
            </section>
        </PageShell>
    );
}

export default UserProfile;

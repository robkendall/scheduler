import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";

function PageShell({ children, description, eyebrow = "Starter", title }) {
    return (
        <Box className="app-shell">
            <Box className="page-shell">
                <Box className="hero-card">
                    <Typography className="hero-kicker">{eyebrow}</Typography>
                    <Typography variant="h3" sx={{ mb: 1.5 }}>
                        {title}
                    </Typography>
                    {description ? (
                        <Typography className="hero-copy" variant="body1">
                            {description}
                        </Typography>
                    ) : null}
                </Box>
                <Box sx={{ mt: 2 }}>{children}</Box>
            </Box>
        </Box>
    );
}

export default PageShell;

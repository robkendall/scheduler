import { useEffect } from "react";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import Typography from "@mui/material/Typography";
import { useNavigate } from "react-router-dom";

import { logout } from "../api/auth";

function Logout({ onLoggedOut }) {
    const navigate = useNavigate();

    useEffect(() => {
        let active = true;

        logout()
            .catch(() => null)
            .finally(() => {
                if (!active) {
                    return;
                }

                onLoggedOut();
                navigate("/login", { replace: true });
            });

        return () => {
            active = false;
        };
    }, [navigate, onLoggedOut]);

    return (
        <Box className="auth-layout">
            <Box className="auth-card" sx={{ textAlign: "center" }}>
                <CircularProgress color="secondary" sx={{ mb: 2 }} />
                <Typography variant="h5">Signing you out</Typography>
            </Box>
        </Box>
    );
}

export default Logout;

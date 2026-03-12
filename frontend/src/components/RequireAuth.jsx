import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import { Navigate, useLocation } from "react-router-dom";

function RequireAuth({ authLoading, children, user }) {
    const location = useLocation();

    if (authLoading) {
        return (
            <Box sx={{ display: "grid", minHeight: "100vh", placeItems: "center" }}>
                <CircularProgress color="secondary" />
            </Box>
        );
    }

    if (!user) {
        return <Navigate to="/login" replace state={{ from: location }} />;
    }

    return children;
}

export default RequireAuth;

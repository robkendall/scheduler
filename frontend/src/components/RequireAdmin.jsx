import { Navigate, useLocation } from "react-router-dom";

function RequireAdmin({ children, user }) {
    const location = useLocation();

    if (!user?.isAdmin) {
        return <Navigate to="/" replace state={{ from: location }} />;
    }

    return children;
}

export default RequireAdmin;
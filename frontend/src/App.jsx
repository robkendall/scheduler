import { useEffect, useState } from "react";
import {
    BrowserRouter,
    Navigate,
    Route,
    Routes,
    useLocation,
} from "react-router-dom";
import { CssBaseline, ThemeProvider, createTheme } from "@mui/material";

import { getCurrentUser } from "./api/auth";
import Navigation from "./components/Navigation";
import RequireAdmin from "./components/RequireAdmin";
import RequireAuth from "./components/RequireAuth";
import DashboardHome from "./pages/DashboardHome";
import Dashboard from "./pages/Dashboard";
import Login from "./pages/Login";
import Logout from "./pages/Logout";
import People from "./pages/People";
import PlanningCenterAdmin from "./pages/PlanningCenterAdmin";
import Positions from "./pages/Positions";
import Roles from "./pages/Roles";
import UserProfile from "./pages/UserProfile";
import UsersManagement from "./pages/UsersManagement";
import "./App.css";

const ACTIVE_ROLE_STORAGE_KEY_PREFIX = "scheduler.activeRoleId.user";

function roleStorageKeyForUser(userId) {
    return `${ACTIVE_ROLE_STORAGE_KEY_PREFIX}.${userId}`;
}

function readStoredRoleId(userId) {
    if (!userId || typeof window === "undefined") {
        return null;
    }

    const raw = window.localStorage.getItem(roleStorageKeyForUser(userId));
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        return null;
    }

    return parsed;
}

function writeStoredRoleId(userId, roleId) {
    if (!userId || !roleId || typeof window === "undefined") {
        return;
    }

    window.localStorage.setItem(roleStorageKeyForUser(userId), String(roleId));
}

const theme = createTheme({
    palette: {
        mode: "light",
        primary: {
            main: "#0f766e",
        },
        secondary: {
            main: "#c2410c",
        },
        background: {
            default: "#f4efe6",
            paper: "#fffaf2",
        },
    },
    typography: {
        fontFamily: '"Avenir Next", "Segoe UI", sans-serif',
    },
    shape: {
        borderRadius: 4,
    },
});

function AppRoutes({ activeRoleId, authLoading, onLoggedOut, onRoleChange, onUserChange, user }) {
    const location = useLocation();
    const isAuthPage = location.pathname === "/login";

    const appRoutes = (
        <Routes>
            <Route
                path="/login"
                element={
                    user ? <Navigate to="/" replace /> : <Login onAuthenticated={onUserChange} />
                }
            />
            <Route path="/logout" element={<Logout onLoggedOut={onLoggedOut} />} />
            <Route
                path="/"
                element={
                    <RequireAuth authLoading={authLoading} user={user}>
                        <DashboardHome activeRoleId={activeRoleId} onRoleChange={onRoleChange} user={user} />
                    </RequireAuth>
                }
            />
            <Route
                path="/calendar"
                element={
                    <RequireAuth authLoading={authLoading} user={user}>
                        <Dashboard activeRoleId={activeRoleId} onRoleChange={onRoleChange} user={user} />
                    </RequireAuth>
                }
            />
            <Route
                path="/profile"
                element={
                    <RequireAuth authLoading={authLoading} user={user}>
                        <UserProfile activeRoleId={activeRoleId} user={user} />
                    </RequireAuth>
                }
            />
            <Route
                path="/people"
                element={
                    <RequireAuth authLoading={authLoading} user={user}>
                        <People activeRoleId={activeRoleId} user={user} />
                    </RequireAuth>
                }
            />
            <Route
                path="/users"
                element={
                    <RequireAuth authLoading={authLoading} user={user}>
                        <RequireAdmin user={user}>
                            <UsersManagement />
                        </RequireAdmin>
                    </RequireAuth>
                }
            />
            <Route
                path="/roles"
                element={
                    <RequireAuth authLoading={authLoading} user={user}>
                        <RequireAdmin user={user}>
                            <Roles />
                        </RequireAdmin>
                    </RequireAuth>
                }
            />
            <Route
                path="/admin"
                element={
                    <RequireAuth authLoading={authLoading} user={user}>
                        <RequireAdmin user={user}>
                            <PlanningCenterAdmin />
                        </RequireAdmin>
                    </RequireAuth>
                }
            />
            <Route path="/planning-center" element={<Navigate to="/admin" replace />} />
            <Route
                path="/positions"
                element={
                    <RequireAuth authLoading={authLoading} user={user}>
                        <Positions activeRoleId={activeRoleId} user={user} />
                    </RequireAuth>
                }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
    );

    if (isAuthPage) {
        return appRoutes;
    }

    return (
        <div className="workspace-shell">
            <Navigation user={user} />
            <main className="workspace-main">{appRoutes}</main>
        </div>
    );
}

function App() {
    const [user, setUser] = useState(null);
    const [authLoading, setAuthLoading] = useState(true);
    const [activeRoleId, setActiveRoleId] = useState(null);

    useEffect(() => {
        let active = true;

        getCurrentUser()
            .then((currentUser) => {
                if (active) {
                    setUser(currentUser);
                }
            })
            .finally(() => {
                if (active) {
                    setAuthLoading(false);
                }
            });

        return () => {
            active = false;
        };
    }, []);

    useEffect(() => {
        if (!user?.roles?.length) {
            // Defer setState to avoid cascading renders
            Promise.resolve().then(() => setActiveRoleId(null));
            return;
        }

        const hasCurrentRole = user.roles.some((role) => role.id === activeRoleId);
        if (hasCurrentRole) {
            writeStoredRoleId(user.id, activeRoleId);
            return;
        }

        const storedRoleId = readStoredRoleId(user.id);
        const hasStoredRole = user.roles.some((role) => role.id === storedRoleId);
        const nextRoleId = hasStoredRole ? storedRoleId : user.roles[0].id;

        // Defer setState to avoid cascading renders
        Promise.resolve().then(() => setActiveRoleId(nextRoleId));
        writeStoredRoleId(user.id, nextRoleId);
    }, [activeRoleId, user]);

    return (
        <ThemeProvider theme={theme}>
            <CssBaseline />
            <BrowserRouter>
                <AppRoutes
                    activeRoleId={activeRoleId}
                    authLoading={authLoading}
                    onLoggedOut={() => setUser(null)}
                    onRoleChange={setActiveRoleId}
                    onUserChange={setUser}
                    user={user}
                />
            </BrowserRouter>
        </ThemeProvider>
    );
}

export default App;

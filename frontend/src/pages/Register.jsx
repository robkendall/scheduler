import { useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { Link as RouterLink, useNavigate } from "react-router-dom";

import { register } from "../api/auth";

const USER_TYPES = ["Deacon", "Pastor", "Yokefellow", "Other"];

function Register({ onAuthenticated }) {
    const navigate = useNavigate();
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [type, setType] = useState("Other");
    const [error, setError] = useState("");
    const [submitting, setSubmitting] = useState(false);

    async function handleSubmit(event) {
        event.preventDefault();
        setSubmitting(true);
        setError("");

        try {
            const user = await register(name, email, password, type);
            onAuthenticated(user);
            navigate("/", { replace: true });
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <Box className="auth-layout">
            <Box component="form" className="auth-card form-stack" onSubmit={handleSubmit}>
                <Typography variant="overline" sx={{ color: "secondary.main", letterSpacing: "0.18em" }}>
                    Fresh install
                </Typography>
                <Typography variant="h3">Create account</Typography>
                <Typography variant="body1" color="text.secondary">
                    The backend starter includes registration, login, and a protected resource flow so the environment is initialized with useful defaults.
                </Typography>
                {error ? <Alert severity="error">{error}</Alert> : null}
                <TextField
                    label="Name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    required
                />
                <TextField
                    label="Email"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    required
                />
                <TextField
                    label="Password"
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                    helperText="Use any password for local starter development."
                />
                <TextField
                    select
                    label="Type"
                    value={type}
                    onChange={(event) => setType(event.target.value)}
                    required
                >
                    {USER_TYPES.map((userType) => (
                        <MenuItem key={userType} value={userType}>
                            {userType}
                        </MenuItem>
                    ))}
                </TextField>
                <Stack direction="row" spacing={1}>
                    <Button type="submit" variant="contained" color="secondary" disabled={submitting}>
                        {submitting ? "Creating..." : "Create account"}
                    </Button>
                    <Button component={RouterLink} to="/login" variant="text">
                        Back to login
                    </Button>
                </Stack>
            </Box>
        </Box>
    );
}

export default Register;

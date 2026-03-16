import { useEffect, useMemo, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

import { createUser, deleteUser, getUsers, updateUser } from "../api/scheduler";
import PageShell from "../components/PageShell";
import { formatDisplayDate } from "../utils/date";

function UsersManagement() {
    const [users, setUsers] = useState([]);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [form, setForm] = useState({
        username: "",
        password: "",
        isAdmin: false,
    });

    async function loadUsers() {
        setLoading(true);
        setError("");

        try {
            const data = await getUsers();
            setUsers(data);
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        loadUsers();
    }, []);

    const sortedUsers = useMemo(
        () => [...users].sort((left, right) => left.username.localeCompare(right.username)),
        [users],
    );

    function beginEdit(user) {
        setEditingId(user.id);
        setForm({
            username: user.username,
            password: "",
            isAdmin: Boolean(user.is_admin),
        });
    }

    function clearEdit() {
        setEditingId(null);
        setForm({ username: "", password: "", isAdmin: false });
    }

    async function handleSubmit(event) {
        event.preventDefault();
        setSaving(true);
        setError("");

        try {
            if (editingId) {
                await updateUser(editingId, {
                    username: form.username,
                    password: form.password,
                    isAdmin: form.isAdmin,
                });
            } else {
                await createUser({
                    username: form.username,
                    password: form.password,
                    isAdmin: form.isAdmin,
                });
            }

            clearEdit();
            await loadUsers();
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setSaving(false);
        }
    }

    async function removeUser(id) {
        setError("");

        try {
            await deleteUser(id);
            if (editingId === id) {
                clearEdit();
            }
            await loadUsers();
        } catch (requestError) {
            setError(requestError.message);
        }
    }

    return (
        <PageShell
            eyebrow="Admin"
            title="Auth Users"
            description="Manage application login accounts. This controls authentication access only."
        >
            {error ? <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert> : null}

            <Box component="form" className="hero-card form-stack" onSubmit={handleSubmit} sx={{ mb: 2 }}>
                <Typography variant="h5">{editingId ? `Edit user #${editingId}` : "Create user"}</Typography>
                <TextField
                    label="Username"
                    value={form.username}
                    onChange={(event) => setForm((prev) => ({ ...prev, username: event.target.value }))}
                    required
                />
                <TextField
                    label={editingId ? "New password (optional)" : "Password"}
                    type="password"
                    value={form.password}
                    onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))}
                    required={!editingId}
                />
                <Stack direction="row" spacing={1} alignItems="center">
                    <Switch
                        checked={form.isAdmin}
                        onChange={(event) => setForm((prev) => ({ ...prev, isAdmin: event.target.checked }))}
                    />
                    <Typography>Admin access</Typography>
                </Stack>
                <Stack direction="row" spacing={1}>
                    <Button type="submit" variant="contained" disabled={saving}>
                        {saving ? "Saving..." : editingId ? "Save user" : "Create user"}
                    </Button>
                    {editingId ? (
                        <Button type="button" variant="outlined" onClick={clearEdit}>
                            Cancel
                        </Button>
                    ) : null}
                </Stack>
            </Box>

            {loading ? <Typography>Loading users...</Typography> : null}

            <TableContainer className="hero-card" sx={{ overflowX: "auto" }}>
                <Table size="small" aria-label="auth users table">
                    <TableHead>
                        <TableRow>
                            <TableCell>Username</TableCell>
                            <TableCell>Admin</TableCell>
                            <TableCell>Created</TableCell>
                            <TableCell align="right">Actions</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {sortedUsers.map((user) => (
                            <TableRow key={user.id} hover selected={editingId === user.id}>
                                <TableCell>{user.username}</TableCell>
                                <TableCell>{user.is_admin ? "Yes" : "No"}</TableCell>
                                <TableCell>{formatDisplayDate(user.created_at)}</TableCell>
                                <TableCell align="right">
                                    <Stack direction="row" spacing={1} justifyContent="flex-end">
                                        <Button size="small" variant="outlined" onClick={() => beginEdit(user)}>
                                            Edit
                                        </Button>
                                        <Button size="small" color="error" onClick={() => removeUser(user.id)}>
                                            Delete
                                        </Button>
                                    </Stack>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </TableContainer>
        </PageShell>
    );
}

export default UsersManagement;
